# HauntShot release & code signing

How we ship Mac/Windows installers and in-app updates for V1.

## What ships where

| Surface | Behavior |
| --- | --- |
| `https://hauntshot.com/download/mac` | 302 → latest GitHub Release DMG |
| `https://hauntshot.com/download/windows` | 302 → latest GitHub Release NSIS `.exe` |
| `https://hauntshot.com/updates/latest.json` | Proxies Tauri updater manifest from the latest Release |
| GitHub Release `vX.Y.Z` | Signed (when certs present) installers + `.sig` + `latest.json` |

Workflow: `.github/workflows/release.yml` (tag `v*` or manual dispatch).

## Already configured

- **Updater signing key** — public key is baked into `tauri.conf.json`. Private key is the GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (minisign). Do not rotate casually; existing installs verify against the pub key.
- **Repo variable** `HAUNTSHOT_API_BASE=https://hauntshot.com`

Local release-style build (optional):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat .keys/hauntshot.key)"
npm run build:desktop --workspace=desktop -- --config '{"bundle":{"createUpdaterArtifacts":true}}'
```

(`.keys/` is gitignored. Keep a backup of the private key offline.)

## Ship a version

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and matching `Cargo.toml` / package.json if you care about lockstep).
2. Merge to `main` (or release from `v1.0`).
3. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`
4. Watch the **Release** workflow; it creates the GitHub Release and uploads assets.
5. Confirm `https://hauntshot.com/download/mac` and `/updates/latest.json`.

## Code signing secrets (you must provide)

Without these, builds still upload, but Gatekeeper / SmartScreen will block or scare users. Critical Path is not complete until they are set.

### macOS — Apple Developer ID + notarization

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) (~$99/yr).
2. Create a **Developer ID Application** certificate; export as `.p12`.
3. Create an [app-specific password](https://appleid.apple.com/) for notarization.
4. Add GitHub secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | `openssl base64 -A -in cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

Tauri signs and notarizes automatically when these are present.

### Windows — Authenticode

1. Buy an OV (or EV) **code signing** certificate (not an SSL cert).
2. Export `.pfx` and base64-encode it.
3. Add GitHub secrets:

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | Base64 of the `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` password |

The Release workflow imports the PFX on the Windows runner and writes a temporary Tauri config with `certificateThumbprint`.

## Smoke builds (unsigned OK)

`macos-build.yml` / `windows-build.yml` on `main` still produce Action artifacts for CI smoke tests. Product downloads and the updater use **Releases** only.
