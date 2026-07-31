# HauntShot

Temporary screenshot sharing: capture → cloud link → auto-expire in 24h.

Modern successor to the original Mac [PicShare](https://github.com/stormageddon/PicShare).

## Stack

| Layer | Choice |
| --- | --- |
| Desktop | Tauri 2 (React + TS) — Mac + Windows |
| API / viewer | Cloudflare Workers + Hono |
| Images | R2 (`StoragePort` — S3-compatible) |
| Metadata / quota | D1 (portable SQL → Postgres later) |
| Payments | Stripe (not wired yet) |

## Monorepo

```
apps/desktop      Tauri client (capture → upload → clipboard)
apps/api          Workers API + public viewer `/s/:id` + image `/i/:id`
packages/shared   Shared types + constants (limits, hotkey, TTL)
```

## Product rules (MVP)

- Free: **10 concurrent live** screenshots; slot frees when a shot hits **24h TTL**
- Paid: unlimited live — **$4.99/mo** or **$29.99/yr** (Stripe TBD)
- View-only (no download)
- Hotkey default: **Control+Shift+5** (avoids macOS ⌘⇧5 / Windows Win+Shift+S)
- Desktop talks only to versioned HTTPS `/v1` — never to R2/D1 directly

## Migration boundaries

- `StoragePort` + our-domain URLs (`/s/:id`, `/i/:id`) — not raw `r2.dev`
- Plain SQL in `apps/api/migrations`
- CF bindings only at Worker edges

## Develop

```bash
npm install

# API — http://127.0.0.1:8787
npm run cf-typegen -w api   # regenerates worker-configuration.d.ts
npm run db:migrate:local -w api
npm run dev:api

# Desktop (separate terminal)
npm run dev:desktop
```

On Mac, grant **Screen Recording** if prompted. Hotkey or the Capture button runs region select → upload → clipboard URL + notification.

Create Cloudflare resources before production deploy:

```bash
npx wrangler d1 create hauntshot
npx wrangler r2 bucket create hauntshot-shots
# put real database_id into apps/api/wrangler.jsonc
npm run deploy -w api
```

## Status

Working: region capture → upload → clipboard → toast; history list; viewer + OG tags; free live quota.

Next: system tray, Stripe, expire/purge cron, production CF IDs.
