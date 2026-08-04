# Roadmap

Product goals for V1: Mac + Windows tray app; capture → HTTPS link → 24h
expiry; free tier with a real limit; paid unlimited at $4.99/mo or $29.99/yr;
view-only; branded hauntshot.com links; downloadable from a real product page.

Nothing here is scheduled day-by-day — but the buckets are ordered roughly by
dependency. Critical Path is what has to be true before calling it launched.
V2 is everything else that can wait without breaking the product promise.

---

## Critical Path (required for launch)

### Distribution and trust

**Finish hauntshot.com on the Worker.** Zone must be Active on Cloudflare,
custom domains deployed, clients rebuilt against `https://hauntshot.com`. Share
links that say `*.workers.dev` are not a shippable brand.

**Product page with downloads.** Landing at hauntshot.com: what it is, the
24h promise, free vs paid pricing, Mac + Windows download buttons. Without this
there is no acquisition surface.

**Code signing.** Unsigned Windows MSIs are already being blocked as malware;
unsigned Mac builds trip Gatekeeper. V1 needs Authenticode (Windows) and
Developer ID + notarization (macOS). Self-signed does not count.

**App update path (minimum viable).** A tray app that cannot be updated or
recalled is a liability the day after launch. Ship Tauri updater (or at least a
version check that points at the download page) with signed artifacts.

### The ephemeral promise

**Purge expired shots.** Viewer copy says screenshots are deleted after 24h;
today only the query filter hides them — R2 objects and rows remain. Cron (or
Queues) over expired rows + `R2Storage.delete` before launch, or the privacy
claim is false.

**Free tier = 5/day.** Product has moved off “10 concurrent live.” Implement a
daily meter in D1, update panel badge and upgrade copy, pick a reset timezone
(UTC is fine if stated). Keep paid as unlimited.

### Paid tier that means something

**Accounts + Stripe.** Device-id quota is bypassable by deleting a file, and
nothing can write `devices.tier = paid`. V1 needs a person (email magic-link or
OAuth is enough), Stripe Checkout + webhooks, and tier attached to the user —
not the device — so two machines share one paid plan. Wire the existing Settings
“Upgrade” stub to Checkout.

**Privacy policy + terms.** Required for a public product page and for Stripe.
Short and honest is fine; host them on hauntshot.com.

### Desktop must feel like a finished tray app

**Launch at login.** Default on for new installs (Tauri autostart). A menubar
app that vanishes after reboot fails the basic job.

**Windows tray + installer icons.** Stock Tauri logo in the system tray and
Start menu is not a launchable brand. Full-color tray glyph + HauntShot
`icon.ico` (and related store assets).

**Print Screen on Windows.** Control+Shift+5 works, but Windows muscle memory
is PrtSc. Register it for V1 (decide: replace OS clipboard capture vs. run
alongside).

**First-run permission guidance.** Mac Screen Recording denial fails silently
from the user’s point of view. One clear prompt/state in the panel when capture
is blocked.

### Already done (do not re-litigate)

Menubar/tray panel · region capture → upload → clipboard → HUD · history with
thumbnails · viewer + OG · free quota enforcement (old model) · CI installers ·
API on Workers/D1/R2 · API URL bake-in for release builds.

---

## V2 (not required for initial launch)

### Capture and platform

**Own the region-select UI.** Replace `screencapture` / `ms-screenclip` with an
in-app overlay so branding, cancel, and behavior match on every OS. Also the
path to Linux later.

**Hotkey remapping.** Settings stub exists; ship after the defaults (including
PrtSc) are right.

**Light / dark appearance.** Settings stub; follow system until then.

**Intel / universal Mac builds.** Local and CI Mac artifacts are Apple Silicon
today. Add `x86_64` or universal when Intel users show up.

**Linux.** Out of MVP scope (Mac + Windows only).

### Quota hardening

**Atomic free-tier check.** Concurrent check-then-insert can overrun by one
under overlap. Conditional insert / transaction once daily meter exists.

**Harder device attestation.** Beyond accounts — attest installs, rate-limit
anonymous abuse, revoke. Paid + email covers honest users for V1.

### Product surface

**hauntshot.app** (and any other defensive domains) pointed at the same Worker
or redirecting to `.com`.

**In-app theme polish, richer settings, about/version screen.**

**Analytics / crash reporting.** Useful after there are users; not a launch
gate.

**Abuse tooling.** Manual kill switches, takedown for reported links — add when
volume warrants.

### Shipping maturity

**Microsoft Store / Mac App Store.** Direct download is the V1 path; stores are
a distribution expansion.

**EV / Trusted Signing reputation, SmartScreen submission pipeline.** Signing
gets you launchable; reputation polish continues after.

---

## Gaps this list closed vs the old roadmap

Previously missing for a real V1: code signing / notarization, first-run
permission UX, privacy/terms, and treating updates as launch-critical rather
than “someday.” Print Screen, Windows icons, 5/day quota, and autostart were
already noted and are now under Critical Path.

Intentionally still V2: custom capture UI, remappable hotkeys, theme toggle,
atomic quota, attestation theater, Linux, store listings.
