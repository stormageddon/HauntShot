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

## Desktop shell

Menubar/tray app — no Dock or taskbar icon.

- Left-click the tray icon toggles the panel, anchored under (macOS) or above (Windows) the icon
- Right-click opens the menu: Capture, Open HauntShot, Quit
- The panel hides on `Esc` or when it loses focus
- List rows show a thumbnail built from the capture itself and cached under the app
  data dir, so previews never re-download full screenshots
- A capture shows its own HUD under the tray icon rather than a system notification:
  in dev those are posted under Terminal's bundle id, and in release they're one
  System Settings toggle away from silence
- macOS ships `LSUIElement`; dev runs use `ActivationPolicy::Accessory`
- The tray glyph (a capture frame around `HS`, dissolving to the right) is generated
  geometrically — rerun `python3 tools/gen-tray-icon.py` after changing it

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

On Windows, capture drives the `ms-screenclip` overlay (the one behind Win+Shift+S)
and waits for a *new* clipboard image, so cancelling can't upload something you
copied earlier. There is no headless region capture on Windows to use instead.

## Windows builds

Tauri can't cross-compile, so Windows installers come from the `Windows build`
workflow (`windows-latest`), which uploads the MSI and NSIS artifacts on every
push to `main` and on manual dispatch.

The API base is baked in at build time from the `HAUNTSHOT_API_BASE` repo
variable — set it once the Worker is deployed, or pass one to a manual run.
Without it a build points at `127.0.0.1:8787`, which only works if the tester
is running the API themselves. A runtime `HAUNTSHOT_API_BASE` env var still
wins, for local work.

Installers are unsigned, so Windows SmartScreen will warn on first run.

## Deploy the API

```bash
npx wrangler login
npx wrangler d1 create hauntshot          # put the real database_id in wrangler.jsonc
npx wrangler r2 bucket create hauntshot-shots
npx wrangler d1 migrations apply hauntshot --remote
npm run deploy -w api
```

Viewer links are built from the request origin, so a deployed Worker hands out
its own URLs with no extra config.

## Status

Working: menubar tray + panel; region capture → upload → clipboard → toast; history list with previews; viewer + OG tags; free live quota.

Next: see [ROADMAP.md](ROADMAP.md) — Stripe and real accounts, expiry purge, product page, production CF IDs.
