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

~~**Finish hauntshot.com apex on the Worker.**~~ Done — parking A/CNAME removed;
`hauntshot.com` + `www` attached as Worker custom domains. Clients should use
`https://hauntshot.com` (`HAUNTSHOT_API_BASE`). Subdomains `app` / `api` /
`share` remain as aliases.

~~**Product page with downloads.**~~ Done — `/download/mac` and `/download/windows`
redirect to the latest GitHub Release assets; landing CTAs use those URLs.

~~**App update path (minimum viable).**~~ Done — Tauri updater plugin; Settings →
Check; quiet notice when an update exists; manifest at
`https://hauntshot.com/updates/latest.json` (proxied from Releases). Updater
artifacts are produced by the Release workflow (minisign key already in CI).

**Code signing.** Pipeline is wired (Release workflow + `docs/RELEASE.md`). Still
needs Apple Developer ID + notarization secrets and a Windows Authenticode
certificate in GitHub Secrets before installers are trusted by Gatekeeper /
SmartScreen. Unsigned builds remain CI smoke only.

### The ephemeral promise

~~**Purge expired shots.**~~ Done — hourly cron deletes R2 objects then D1 rows.

~~**Free tier = 5/day.**~~ Done — UTC day meter; panel badge shows used/limit.

### Paid tier that means something

~~**Accounts + Stripe.**~~ Done — Checkout + Customer Portal + webhooks; tier on
user (devices inherit); Settings Upgrade opens Checkout. Free remains
device-id metered until a paid account is linked.

~~**Privacy policy + terms.**~~ Done — `/privacy` and `/terms` on the Worker.

### Desktop must feel like a finished tray app

~~**Launch at login.**~~ Done — enabled once on first run; Settings toggle.

~~**Windows tray + installer icons.**~~ Done — color tray glyph + regenerated
`icon.ico` from the HS mark.

~~**Print Screen on Windows.**~~ Done — registered alongside Control+Shift+5.

~~**First-run permission guidance.**~~ Done — panel error points at Screen
Recording settings when capture is denied.

~~**Capture shutter sound.**~~ Done — short click plays when a region is captured
(hotkey, tray menu, or panel Capture).

~~**Hide panel before in-app capture.**~~ Done — `run_capture_and_share` hides the
tray panel and waits a beat before the OS region UI appears.

### Already done (do not re-litigate)

Menubar/tray panel · region capture → upload → clipboard → HUD · history with
thumbnails (click opens viewer) · viewer + OG · free quota (5/day) · hourly
purge · CI installers · Release + updater pipeline · branded downloads · API on
Workers/D1/R2 · branded `hauntshot.com` · Stripe Checkout + portal · shutter
sound · hide panel before capture · launch at login · Print Screen · permission
guidance.

---

## V2 (not required for initial launch)

### Capture and platform

**Own the region-select UI.** Replace `screencapture` / `ms-screenclip` with an
in-app overlay so branding, cancel, and behavior match on every OS. Also the
path to Linux later.

**Full-screen capture hotkey.** Separate binding from region select (e.g.
Control+Shift+4 vs Control+Shift+5) that grabs the whole display in one shot.

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
than “someday.” Print Screen, Windows icons, 5/day quota, autostart, Stripe,
apex domain, shutter sound, and hide-before-capture are done under Critical
Path.

**Still Critical Path:** Apple + Windows **code signing certificates** in CI
secrets (pipeline and updater are otherwise ready). See `docs/RELEASE.md`.

Intentionally still V2: custom capture UI, full-screen hotkey, remappable
hotkeys, theme toggle, atomic quota, attestation theater, Linux, store
listings.
