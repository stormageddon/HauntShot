# Future work

Known gaps and next moves, with enough context to pick any of them up cold.
Nothing here is scheduled or ordered — it's a list, not a plan.

## Quota and accounts

**Device identity is self-asserted.** The free limit keys off the
`X-HauntShot-Device-Id` header, which the client generates itself and any string
matching `[a-zA-Z0-9_-]{8,128}` is accepted and auto-created on first use.
Deleting that file — or just sending a different header — grants a fresh ten
slots. Nothing is signed or attested, so today's quota only inconveniences the
honest. Needs an account or device-attestation story before the paid tier means
anything.

**Nothing can promote a device to paid.** `getDeviceTier` reads `devices.tier`,
which defaults to `free`, and no code path ever writes `paid`. The `users` table
already carries the Stripe columns and `devices.user_id` exists, but nothing
joins them. Wiring Stripe checkout and webhooks is the obvious half; the other
half is deciding that tier belongs to a person rather than a device, since as
written two machines get ten free links each.

**The quota check isn't atomic.** `POST /v1/shots` counts live shots and then
inserts, so two captures fired at once while sitting at nine live can both read
nine and both succeed. Rare when captures come one hotkey at a time, but it's a
real hole — close it with a conditional insert or a transaction.

## Lifecycle

**Expired shots are never actually deleted.** Rows simply stop matching
`expires_at > datetime('now')`, so links go dead on schedule, but the R2 objects
stay forever. `R2Storage.delete` exists and has no callers. That's an accruing
storage bill and a privacy claim we don't yet honor: the viewer page tells people
their screenshot is "deleted automatically after 24 hours". Needs a scheduled
purge over expired rows plus their objects.

## Shipping and updates

**App update path.** There's no way to update an installed client. Whatever a
user downloads is what they keep running, which is a poor fit for a menubar app
that sits untouched for months — and it means a bad build can't be recalled.
Needs signed releases, an update feed, and in-app update checks (Tauri's updater
plugin covers most of this), plus a decision about whether updates install
silently or prompt.

## Product and launch

**Create a product page.** A real landing page at hauntshot.com covering what it
does, the ephemeral-by-default promise, pricing, and downloads for Mac and
Windows. Also the natural home for the privacy and retention claims we make in
the viewer.

**Production Cloudflare resources.** The D1 id and R2 bucket in
`apps/api/wrangler.jsonc` are local dev placeholders; production needs real ones
plus the domains registered.
