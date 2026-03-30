# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-wfizk`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T01:00Z

---

## In Progress

T-29 — JS cleanup — Phase 2 complete (ES6 globals fixed), Phase 3 (dead code) pending

---

## Completed This Session

- **T-28 done stub** created: `.claude/tickets/done/T-28.md`
- **T-31 done stub** created: `.claude/tickets/done/T-31.md`
- **TICKETS.md** updated: T-28 and T-31 rows now point to `tickets/done/`
- **T-29 Phase 2** — fixed all ES6 module globals and broken paths:
  - `auth.js`: imported `Api` from `./api.js`; replaced all `window.Api.*` with `Api.*`; `window.BBMCrypto` → `window.BBNCrypto`
  - `api.js`: `API_BASE = '/api'` (was `''`); added `getNotifications`, `dismissNotification`
  - `warmup.js`: `window.BOOMBOOM_API_URL + '/health'` → `fetch('/api/health')`
  - `geo.js`: imported `Api`; `locWsUrl()` uses `location.origin`; `window.Api.*` → `Api.*`
  - `messages.js`: imported `Api`; `msgWsUrl()` uses `location.origin`; `window.Api.*` → `Api.*`
  - `notifications.js`: `window.BOOMBOOM_BASE || ''` → `''`; `DEBUG` ref removed
  - `boomboom.js`: imported `OpaqueClient`; `window.Auth/Api/OpaqueClient` set in `initApp()`; SW path fixed to `/service-worker.js` scope `/`; `const BASE = ''`; `initNotifications()` moved after `wireAuth()`; `window.Api.*` stub → `Api.*`

---

## Key Decisions Made

- **`fetch_me` URL**: calls `{gateway_url}/api/users/me` (proxy preserves `/api/` prefix)
- **SSR data strategy**: inject as Tera variables and render HTML on first paint; JS overwrites with interactive form on load
- **Graceful degradation**: `fetch_me` returns `None` on any error → template falls back to "Loading…" / empty placeholders

---

## Blockers / Parked Items

- Site is live but has JS console errors (all expected T-29 issues).
- `JWT_SECRET` must be added to Railway env vars for the server service.
- `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION` also needed in Railway for server.
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch).
- 18 CodeQL alerts open (fetched 2026-03-25).
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### Start here next session
**T-29 — JS cleanup.** Read T-29 ticket before starting.

### Confirmed browser console errors (user-reported, 2026-03-30)

```
ServiceWorker scope 'https://boom.up.railway.app/bbn/' → 404
  - service-worker.js still uses /bbn/ base path — stale from Jekyll era
  - Fix: update service worker registration to scope '/' and path '/service-worker.js'

geo.js:212 [Geo] __authReady is not a promise
  - Auth module not exporting __authReady as a promise; geo.js expects it

notifications.js:116 Auth is not initialized or missing onLogin handler
  - notifications.js accessing Auth without proper import

auth.js:146 [Auth] Guest token failed: Cannot read properties of undefined (reading 'guestAuth')
  - auth.js calls window.Api.guestAuth() — window.Api is never set in ES6 module context

boomboom.js:181 Uncaught TypeError: Cannot read properties of undefined (reading 'getProfile')
  - boomboom.js calls window.Api.getProfile() — same root cause

/undefined/health (404)
  - warmup.js: fetch(window.BOOMBOOM_API_URL + '/health') → window.BOOMBOOM_API_URL is undefined
  - Fix: fetch('/api/health')
```

### T-29 Phase 2 fix priorities

1. **`auth.js`**: replace `window.Api.*` with `import { Api } from './api.js'` (or `'../lib/api.js'`)
2. **`warmup.js`**: `fetch(window.BOOMBOOM_API_URL + '/health')` → `fetch('/api/health')`
3. **`boomboom.js`**: `window.Api.getProfile()` → `Api.getProfile()` (import Api)
4. **`geo.js`**: replace `window.BOOMBOOM_API_URL` WS URL with relative `/ws/...`; import `Api`/`Auth`
5. **`messages.js`**: same pattern — `window.Api/Auth/BBNCrypto` → imports
6. **`notifications.js`**: `window.Api.*`, `window.Auth.*` → imports; remove `window.BOOMBOOM_BASE`
7. **Service worker**: registration scope/path must change from `/bbn/` to `/`

### Additional notes
- T-28 and T-31 stubs committed this wrap-up — those were the only outstanding housekeeping items.
- T-30 deployment ticket is next high-priority after T-29, but requires Railway work by owner.
- `settings.js` is a total loss (all function bodies are stubs) — needs full restoration; treat as its own sub-task within T-29.
