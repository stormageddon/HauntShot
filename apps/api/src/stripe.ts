/** Minimal Stripe REST client for Workers — Checkout, Portal, webhooks. */

export type StripeEnv = {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_MONTHLY: string;
  STRIPE_PRICE_YEARLY: string;
  /** Required when STRIPE_SECRET_KEY is an org key (sk_org_…). */
  STRIPE_ACCOUNT_ID?: string;
};

/** Pin API version — required for organization API keys. */
export const STRIPE_API_VERSION = "2026-07-29.dahlia";

const API = "https://api.stripe.com/v1";

function stripeHeaders(secret: string, accountId?: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  // Org keys (sk_org_…) must target an account via Stripe-Context.
  if (accountId || secret.startsWith("sk_org_")) {
    if (!accountId) {
      throw new Error("STRIPE_ACCOUNT_ID required for organization API keys");
    }
    headers["Stripe-Context"] = accountId;
  }
  return headers;
}

async function stripeForm(
  secret: string,
  path: string,
  params: Record<string, string>,
  accountId?: string,
): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: stripeHeaders(secret, accountId),
    body: new URLSearchParams(params),
  });
}

export async function createCheckoutSession(opts: {
  secret: string;
  priceId: string;
  deviceId: string;
  successUrl: string;
  cancelUrl: string;
  accountId?: string;
}): Promise<{ id: string; url: string }> {
  const res = await stripeForm(
    opts.secret,
    "/checkout/sessions",
    {
      mode: "subscription",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      "line_items[0][price]": opts.priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: opts.deviceId,
      "metadata[device_id]": opts.deviceId,
      "subscription_data[metadata][device_id]": opts.deviceId,
      allow_promotion_codes: "true",
    },
    opts.accountId,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe checkout failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { id: string; url: string };
  if (!json.url) throw new Error("Stripe checkout missing url");
  return json;
}

export async function createBillingPortalSession(opts: {
  secret: string;
  customerId: string;
  returnUrl: string;
  accountId?: string;
}): Promise<{ url: string }> {
  const res = await stripeForm(
    opts.secret,
    "/billing_portal/sessions",
    {
      customer: opts.customerId,
      return_url: opts.returnUrl,
    },
    opts.accountId,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe portal failed (${res.status}): ${text}`);
  }
  return (await res.json()) as { url: string };
}

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/** Verify Stripe-Signature and return the event payload. */
export async function verifyWebhookEvent(
  body: string,
  signatureHeader: string,
  webhookSecret: string,
): Promise<StripeEvent> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v?.trim() ?? ""];
    }),
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) throw new Error("Malformed Stripe-Signature");

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || age > 300 || age < -60) {
    throw new Error("Stripe webhook timestamp out of range");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!timingSafeEqual(expected, v1)) {
    throw new Error("Stripe webhook signature mismatch");
  }

  return JSON.parse(body) as StripeEvent;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function priceIdForPlan(
  env: Pick<StripeEnv, "STRIPE_PRICE_MONTHLY" | "STRIPE_PRICE_YEARLY">,
  plan: "monthly" | "yearly",
): string {
  return plan === "yearly" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
}
