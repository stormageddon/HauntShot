#!/usr/bin/env node
/**
 * One-shot: create HauntShot Pro products/prices in Stripe and print the
 * wrangler secret commands.
 *
 *   STRIPE_SECRET_KEY=sk_… node apps/api/scripts/setup-stripe.mjs
 *
 * Organization keys (sk_org_…) also need:
 *   STRIPE_ACCOUNT_ID=acct_…
 */
const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY_HAUNTSHOT;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (or STRIPE_API_KEY_HAUNTSHOT) first");
  process.exit(1);
}

const accountId = process.env.STRIPE_ACCOUNT_ID;
const STRIPE_API_VERSION = "2026-07-29.dahlia";

if (key.startsWith("sk_org_") && !accountId) {
  console.error(
    "Organization API keys require STRIPE_ACCOUNT_ID=acct_…\n" +
      "Find it in Stripe Dashboard → Settings → Account details.",
  );
  process.exit(1);
}

async function form(path, params) {
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (accountId) headers["Stripe-Context"] = accountId;

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(path, json);
    process.exit(1);
  }
  return json;
}

const product = await form("/products", {
  name: "HauntShot Pro",
  description: "Unlimited temporary screenshot links",
});

const monthly = await form("/prices", {
  product: product.id,
  unit_amount: "499",
  currency: "usd",
  "recurring[interval]": "month",
  nickname: "pro_monthly",
});

const yearly = await form("/prices", {
  product: product.id,
  unit_amount: "2999",
  currency: "usd",
  "recurring[interval]": "year",
  nickname: "pro_yearly",
});

console.log(`
Created Stripe product ${product.id}
  monthly price: ${monthly.id} ($4.99/mo)
  yearly price:  ${yearly.id} ($29.99/yr)

Store these as Worker secrets (from apps/api):

  npx wrangler secret put STRIPE_SECRET_KEY
  npx wrangler secret put STRIPE_WEBHOOK_SECRET
  npx wrangler secret put STRIPE_PRICE_MONTHLY   # paste ${monthly.id}
  npx wrangler secret put STRIPE_PRICE_YEARLY    # paste ${yearly.id}${
    accountId
      ? `
  npx wrangler secret put STRIPE_ACCOUNT_ID     # paste ${accountId}`
      : ""
  }

Then in Stripe Dashboard → Developers → Webhooks → Add endpoint:
  URL:  https://app.hauntshot.com/webhooks/stripe
  Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted
`);
