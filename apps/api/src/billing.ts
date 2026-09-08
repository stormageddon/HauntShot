import type { Context } from "hono";
import {
  ensureUserByEmail,
  getUserByStripeCustomer,
  linkDeviceToUser,
  setUserFree,
  setUserPaid,
} from "./db/billing";
import {
  createBillingPortalSession,
  createCheckoutSession,
  priceIdForPlan,
  verifyWebhookEvent,
  type StripeEnv,
} from "./stripe";
import { requestOrigin } from "./origin";

export type BillingEnv = {
  DB: D1Database;
  ENVIRONMENT?: string;
  PUBLIC_ORIGIN?: string;
} & Partial<StripeEnv>;

type StripeCheckoutEnv = Pick<
  StripeEnv,
  | "STRIPE_SECRET_KEY"
  | "STRIPE_PRICE_MONTHLY"
  | "STRIPE_PRICE_YEARLY"
  | "STRIPE_ACCOUNT_ID"
>;

function requireCheckoutEnv(env: BillingEnv): StripeCheckoutEnv {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY,
    STRIPE_ACCOUNT_ID,
  } = env;
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_MONTHLY || !STRIPE_PRICE_YEARLY) {
    throw new Error("billing_not_configured");
  }
  if (STRIPE_SECRET_KEY.startsWith("sk_org_") && !STRIPE_ACCOUNT_ID) {
    throw new Error("billing_not_configured");
  }
  return {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY,
    STRIPE_ACCOUNT_ID,
  };
}

function requireWebhookEnv(env: BillingEnv): StripeEnv {
  const checkout = requireCheckoutEnv(env);
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("billing_not_configured");
  return { ...checkout, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET };
}

function originOf(c: Context): string {
  return requestOrigin(c);
}

export async function startCheckout(
  c: Context<{ Bindings: BillingEnv }>,
  deviceId: string,
  plan: "monthly" | "yearly",
): Promise<Response> {
  let stripe: StripeCheckoutEnv;
  try {
    stripe = requireCheckoutEnv(c.env);
  } catch {
    return c.json(
      { error: "Billing is not configured yet", code: "internal" },
      503,
    );
  }

  try {
    const origin = originOf(c);
    const session = await createCheckoutSession({
      secret: stripe.STRIPE_SECRET_KEY,
      priceId: priceIdForPlan(stripe, plan),
      deviceId,
      successUrl: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/billing/upgrade?device_id=${encodeURIComponent(deviceId)}`,
      accountId: stripe.STRIPE_ACCOUNT_ID,
    });
    return c.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error(
      JSON.stringify({ msg: "stripe_checkout_failed", error: String(e) }),
    );
    return c.json(
      { error: "Could not start checkout", code: "internal" },
      502,
    );
  }
}

export async function startPortal(
  c: Context<{ Bindings: BillingEnv }>,
  deviceId: string,
): Promise<Response> {
  let stripe: StripeCheckoutEnv;
  try {
    stripe = requireCheckoutEnv(c.env);
  } catch {
    return c.json(
      { error: "Billing is not configured yet", code: "internal" },
      503,
    );
  }

  const row = await c.env.DB.prepare(
    `SELECT u.stripe_customer_id AS customer_id
     FROM devices d
     JOIN users u ON u.id = d.user_id
     WHERE d.id = ?`,
  )
    .bind(deviceId)
    .first<{ customer_id: string | null }>();

  if (!row?.customer_id) {
    return c.json(
      { error: "No billing account linked to this device", code: "bad_request" },
      400,
    );
  }

  const session = await createBillingPortalSession({
    secret: stripe.STRIPE_SECRET_KEY,
    customerId: row.customer_id,
    returnUrl: `${originOf(c)}/`,
    accountId: stripe.STRIPE_ACCOUNT_ID,
  });
  return c.json({ url: session.url });
}

export async function handleStripeWebhook(
  c: Context<{ Bindings: BillingEnv }>,
): Promise<Response> {
  let stripe: StripeEnv;
  try {
    stripe = requireWebhookEnv(c.env);
  } catch {
    return c.text("billing not configured", 503);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) return c.text("missing signature", 400);

  const body = await c.req.text();
  let event;
  try {
    event = await verifyWebhookEvent(
      body,
      signature,
      stripe.STRIPE_WEBHOOK_SECRET,
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        msg: "stripe_webhook_verify_failed",
        error: String(e),
      }),
    );
    return c.text("invalid signature", 400);
  }

  try {
    await applyStripeEvent(c.env.DB, event);
  } catch (e) {
    console.error(
      JSON.stringify({
        msg: "stripe_webhook_apply_failed",
        type: event.type,
        id: event.id,
        error: String(e),
      }),
    );
    return c.text("handler error", 500);
  }

  return c.json({ received: true });
}

async function applyStripeEvent(
  db: D1Database,
  event: {
    type: string;
    data: { object: Record<string, unknown> };
  },
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return;
      const email =
        (typeof session.customer_details === "object" &&
          session.customer_details &&
          typeof (session.customer_details as { email?: string }).email ===
            "string" &&
          (session.customer_details as { email: string }).email) ||
        (typeof session.customer_email === "string"
          ? session.customer_email
          : null);
      const customerId =
        typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;
      const deviceId =
        (typeof session.client_reference_id === "string"
          ? session.client_reference_id
          : null) ||
        (typeof session.metadata === "object" &&
        session.metadata &&
        typeof (session.metadata as { device_id?: string }).device_id ===
          "string"
          ? (session.metadata as { device_id: string }).device_id
          : null);

      if (!email || !customerId || !subscriptionId) {
        throw new Error("checkout.session.completed missing fields");
      }

      const user = await ensureUserByEmail(db, email);
      await setUserPaid(db, user.id, customerId, subscriptionId);
      if (deviceId) await linkDeviceToUser(db, deviceId, user.id);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId =
        typeof sub.customer === "string" ? sub.customer : null;
      if (!customerId) return;
      const user = await getUserByStripeCustomer(db, customerId);
      if (!user) return;

      const status = typeof sub.status === "string" ? sub.status : "";
      const paid =
        event.type !== "customer.subscription.deleted" &&
        (status === "active" || status === "trialing");

      if (paid) {
        const subId = typeof sub.id === "string" ? sub.id : user.stripe_subscription_id ?? "";
        await setUserPaid(db, user.id, customerId, subId);
      } else {
        await setUserFree(db, user.id);
      }
      break;
    }
    default:
      break;
  }
}

export function billingSuccessHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>HauntShot Pro</title>
<style>body{font-family:system-ui;background:#0a0212;color:#f0e8fa;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center}
a{color:#c9a8ff}</style></head>
<body>
  <h1>You're on HauntShot Pro</h1>
  <p>Unlimited captures are active on this account. Open the HauntShot tray app — the quota badge should read Paid.</p>
  <p><a href="/">Back to HauntShot</a></p>
</body></html>`;
}

export function billingCancelHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Checkout cancelled</title>
<style>body{font-family:system-ui;background:#0a0212;color:#f0e8fa;max-width:28rem;margin:4rem auto;padding:0 1rem;text-align:center}
a{color:#c9a8ff}</style></head>
<body>
  <h1>Checkout cancelled</h1>
  <p>No charge was made. You can upgrade anytime from the HauntShot settings gear.</p>
  <p><a href="/">Back to HauntShot</a></p>
</body></html>`;
}

/** Plan picker before Stripe Checkout — monthly and yearly on one page. */
export function billingUpgradeHtml(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Upgrade · HauntShot Pro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    :root { --bg:#0a0212; --ink:#f0e8fa; --muted:#a898bf; --accent:#c9a8ff; --line:#2a1a3d; --card:#1a0f28; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: "DM Sans", system-ui, sans-serif;
      color: var(--ink); background: radial-gradient(900px 500px at 20% -10%, #2a1540, transparent 55%), var(--bg);
      display: flex; align-items: center; justify-content: center; padding: 2rem 1rem;
    }
    .box { width: min(28rem, 100%); }
    .brand { font-family: "Fraunces", Georgia, serif; font-size: 1.75rem; margin: 0 0 0.35rem; }
    .lead { color: var(--muted); margin: 0 0 1.5rem; font-size: 0.95rem; }
    .plans { display: grid; gap: 0.75rem; }
    button.plan {
      display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
      width: 100%; text-align: left; cursor: pointer;
      background: var(--card); color: var(--ink); border: 1px solid var(--line);
      border-radius: 10px; padding: 1rem 1.1rem; font: inherit;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    button.plan:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-1px); }
    button.plan:disabled { opacity: 0.55; cursor: default; }
    .plan strong { font-size: 1.05rem; }
    .plan .price { color: var(--accent); font-weight: 600; white-space: nowrap; }
    .plan .hint { display: block; color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem; }
    .err { color: #ff8f8f; font-size: 0.9rem; margin-top: 1rem; min-height: 1.2em; }
    .foot { margin-top: 1.25rem; font-size: 0.8rem; color: var(--muted); }
    .foot a { color: var(--muted); }
  </style>
</head>
<body>
  <main class="box">
    <p class="brand">HauntShot Pro</p>
    <p class="lead">Unlimited captures. Pick monthly or yearly — Stripe handles payment.</p>
    <div class="plans">
      <button type="button" class="plan" data-plan="monthly">
        <span><strong>Monthly</strong><span class="hint">Cancel anytime</span></span>
        <span class="price">$4.99/mo</span>
      </button>
      <button type="button" class="plan" data-plan="yearly">
        <span><strong>Yearly</strong><span class="hint">Best value</span></span>
        <span class="price">$29.99/yr</span>
      </button>
    </div>
    <p class="err" id="err" hidden></p>
    <p class="foot"><a href="${origin}/">HauntShot</a> · secure checkout by Stripe</p>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const deviceId = params.get("device_id") || "";
    const err = document.getElementById("err");
    const buttons = [...document.querySelectorAll("button.plan")];

    if (!deviceId) {
      err.hidden = false;
      err.textContent = "Open Upgrade from the HauntShot app settings.";
      buttons.forEach((b) => { b.disabled = true; });
    }

    async function start(plan) {
      err.hidden = true;
      buttons.forEach((b) => { b.disabled = true; });
      try {
        const res = await fetch("/v1/billing/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-HauntShot-Device-Id": deviceId,
          },
          body: JSON.stringify({ plan }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || ("Checkout failed (" + res.status + ")"));
        location.href = data.url;
      } catch (e) {
        err.hidden = false;
        err.textContent = e instanceof Error ? e.message : String(e);
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    buttons.forEach((b) => b.addEventListener("click", () => start(b.dataset.plan)));
  </script>
</body>
</html>`;
}
