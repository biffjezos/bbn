# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-wfizk`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T14:00Z

---

## In Progress

Nothing outstanding. Branch is ready to merge → dev and deploy.

---

## Completed This Session

- **T-28 done stub + T-31 done stub** created; TICKETS.md updated
- **T-29 Phase 2** — fixed all ES6 module globals, API base path (`/api`), service worker path
- **T-29 Phase 3 + T-29 done** — restored settings.js; removed BOOMBOOM_BASE refs; crypto.js worker URL fixed; T-32 created and immediately completed
- **T-32 done** — profile.js converted to ES6 module at `lib/profile.js`; wired into boomboom.js; venue API methods added to api.js
- **Specs created:** `ui/geo.yaml`, `ui/messages.yaml`, `ui/notifications.yaml`
- **CLAUDE.md updated:** relaxed UI spec rule (thin handlers don't need specs)

---

## Key Decisions Made

- `API_BASE = '/api'` in api.js — server proxies `/api/*` to gateway which has `/api/` prefix on all routes
- `window.Auth/Api/OpaqueClient` set in boomboom.js `initApp()` for backward-compat with modules that still do window.* lookups
- `window.BBNCrypto` retained in profile.js for crypto re-encryption (crypto.js sets it itself)
- crypto-worker.js URL: `/scripts/lib/crypto-worker.js` (was `/scripts/crypto-worker.js` — wrong path)
- `initSettings()`, `initMyProfile()`, `initPublicProfile()` all called after `await window.__authReady`
- profile.js moved to `lib/profile.js`; old `ui/scripts/profile.js` stubbed out

---

## Blockers / Parked Items

- `JWT_SECRET`, `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION` must be set in Railway for the server service (owner action — not yet confirmed done)
- 18 CodeQL alerts open (fetched 2026-03-25)
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch)
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`

---

## Handoff Notes

### For the next session (after owner tests the deployment)

Owner will report browser console errors and functional issues found during testing. Likely candidates:

1. **Auth flow** — login, register, guest auth — most critical; watch for any remaining `window.*` lookup failures
2. **Settings page** — account info, blocked users, preferences, danger zone
3. **Profile pages** — `/profile/` (own) and `/profile/view/` (public) now wired; first real test
4. **Map / geo** — location WS, nearby users
5. **Messages** — WS connect, E2EE send/receive
6. **Service worker** — scope `/` path `/service-worker.js` — check if existing cached SW with `/bbn/` scope causes issues on first load after deploy; may need `navigator.serviceWorker.getRegistrations()` cleanup

### T-30 (Railway deployment config) is still open
Requires owner to add/verify env vars in Railway for the server service. See T-30.md.

### admin.js and i8n.js
Still dead files in `ui/scripts/`. Not loaded by any template. Leave for now — admin panel is a future ticket.
