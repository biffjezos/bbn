# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-pwa-android-install-efOUW`
**Session date:** 2026-03-26
**Last updated:** 2026-03-26T10:00Z

---

## In Progress

(nothing — second PWA fix committed, see below)

---

## Completed This Session

- **Fix: PWA install button not visible on Android Chrome/Firefox (follow-up)**
  - Root causes:
    1. `#installSection` was hidden until `beforeinstallprompt` fired — but on Chrome Android the event can fire with a delay (engagement heuristic), leaving the section invisible. On Firefox the event never fires at all.
    2. No Firefox-specific install hint. Firefox Android uses its own browser-menu install UI; `beforeinstallprompt` is not fired.
    3. Stale SW cache (`app-v1`) could serve old HTML that lacks `#installSection`, causing DOM lookup to return null even when event fires.
  - Fixes:
    - `service-worker.js`: bumped `CACHE_NAME` to `app-v2` to force cache refresh.
    - `offcanvas-menu.html`: install button now starts `disabled` with visible fallback text ("use browser menu → Install app"); added `#firefoxInstallHint` div.
    - `app.js`: added `_isFirefox`, `_isMobile` detection. On Chrome/Edge Android, `#installSection` is shown immediately on DOMContentLoaded (button disabled + fallback text visible). Button activates (`disabled=false`, fallback hidden) when `beforeinstallprompt` fires. Firefox mobile shows `#firefoxInstallHint`. Race condition handled: if event fires before DOMContentLoaded, `_activateInstallBtn()` is called again in DOMContentLoaded.


- **Fix: PWA not installable on Android Chrome/Firefox or iOS**
  - Root causes:
    1. `manifest.json` icons missing `"purpose"` field — Chrome Android requires a maskable icon entry to show the install prompt.
    2. No Apple-specific meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`) or `apple-touch-icon` link — iOS Safari can't add the app properly to the home screen without these.
    3. Install button had `position:fixed` inside the offcanvas, floating over the whole page at bottom-right; it was also inside the footer div rather than the offcanvas body.
    4. No handling for iOS (Safari never fires `beforeinstallprompt`) — iOS users had no guidance.
    5. Firefox on Android also doesn't fire `beforeinstallprompt`; it uses its own install UI driven by a valid manifest.
  - Fixes:
    - `ui/manifest.json`: split each icon into two entries with `"purpose": "any"` and `"purpose": "maskable"` (Chrome Android requires maskable icon).
    - `ui/_layouts/default.html`: added `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and `apple-mobile-web-app-title` meta tags.
    - `ui/_includes/offcanvas-menu.html`: moved install button out of fixed-position footer into a proper `#installSection` div in the offcanvas body; added `#iosInstallHint` div with "Share → Add to Home Screen" instructions.
    - `ui/scripts/app.js`: added iOS detection (`_isIOS`) and standalone-mode check (`_isInStandalone`); show `#iosInstallHint` for iOS when not already installed; show `#installSection` on `beforeinstallprompt`; hide after install.

---

## Key Decisions Made

- Maskable icons use the same source PNG files (192 and 512) — no new assets needed. The icons should be designed with a safe zone, but this is a best-effort fix without redesigning the icons.
- Firefox on Android handles its own install UI from the address bar when the manifest is valid; no code changes needed for Firefox specifically.
- `_isInStandalone` check prevents showing iOS hint when already running as an installed app.

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]` to bypass protection.
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service, favourites-service, gateway need review. See codeql-alerts.md on origin/dev.

---

## Handoff Notes

### What to do next
1. Merge `claude/fix-pwa-android-install-efOUW` → `dev` and deploy.
2. Test on Android Chrome: visit the site, wait a moment, open the offcanvas menu — the "Install App" button should appear.
3. Test on iOS Safari: open the offcanvas menu — the Share → Add to Home Screen hint should show.
4. Merge the previous `claude/fix-venue-messaging-MKdDl` branch if not done yet.
5. CodeQL SSRF alerts (18 open) — take priority after merges.

### Notes for next session
- PWA install button is in `#installSection` (hidden by default). It's shown by `beforeinstallprompt` (Chrome/Edge Android) or `#iosInstallHint` is shown for iOS.
- The maskable icon entries in manifest.json reuse the same PNG files — they will have coloured padding rather than true safe-zone masking, but this satisfies Chrome's installability check.
- Firefox on Android doesn't use `beforeinstallprompt`; it shows its own install UI when the manifest is valid.
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
