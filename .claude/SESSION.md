# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-path-bugs-HhisD`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T16:15Z

---

## In Progress

Fixing browser console bugs reported by owner after first live deployment test.

---

## Completed This Session (round 2)

- **boomboom.js initApp()**: fixed `__authReady` initialization order — `window.__authReady = Auth.init()` now set BEFORE `initGeo()`. geo.js checks `window.__authReady instanceof Promise`; before this fix it was always `undefined` → geo never started → map never rendered.
- **service-worker.js**: bumped `CACHE_NAME` from `app-v2` to `app-v3` to force browser to evict old SW cache (which had wrong `/bbn/` paths and stale asset list).

## Completed This Session (round 1)

- **manifest.json** — replaced all `/bbn/` paths with `/` (start_url, scope, icon srcs)
- **service-worker.js ASSETS** — fixed wrong paths: `app.js` → `boomboom.js`; `/scripts/X.js` → `/scripts/lib/X.js` for crypto-worker, crypto, geo, lock, map, opaque-client
- **Tera base.html** — replaced deprecated `apple-mobile-web-app-capable` with `mobile-web-app-capable`
- **Tera modal-login.html** — wrapped fields in `<form id="loginForm">`, button changed to `type="submit"`, added `required` attrs and `name` attrs
- **Tera modal-register.html** — wrapped fields in `<form id="registerForm">`, button changed to `type="submit"`, added `required`/`name`/`autocomplete` attrs
- **boomboom.js wireUI()** — wired `loginForm` and `registerForm` submit events → call `Auth.login()` / `Auth.register()`, show errors in error divs, clear password field after attempt, close modal on success

---

## Key Decisions Made

- Tera templates are the ones actually served (not Jekyll ui/_includes/ — those are only used if/when Jekyll builds). Always fix both if keeping them in sync.
- Login/register submit was **completely unwired** before this session — clicking the button did nothing.
- `GATEWAY_URL` env var in Railway is the root cause of `POST /api/auth/guest 502` — this is an owner action item, not a code fix.

---

## Blockers / Parked Items

- **502 on `/api/auth/guest`** — owner must verify `GATEWAY_URL` is set correctly in Railway for the server service, and that the gateway service is running. The server proxies `/api/*` to `GATEWAY_URL` and returns 502 if it can't reach it. This is the single biggest blocker — everything auth-related fails until this is resolved.
- `JWT_SECRET`, `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION` must be set in Railway for the server service
- 18 CodeQL alerts open (fetched 2026-03-25)
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch)
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`

---

## Handoff Notes

### 502 root cause — owner must check Railway

The Rust server (`services/server`) proxies all `/api/*` requests to `GATEWAY_URL`. If that env var is wrong or the gateway service isn't running, every API call returns 502.

Steps to diagnose:
1. In Railway, open the **server** service → Settings → Environment variables → confirm `GATEWAY_URL` is set to the gateway service's internal URL (e.g. `http://gateway.railway.internal:PORT` or the public Railway URL of the gateway)
2. Open the **gateway** service → confirm it's deployed and healthy
3. Check gateway logs for startup errors (`AUTHORITY_SERVICE_URL` not set = gateway panics)

### Template duality — Tera vs Jekyll
The Rust server serves Tera templates from `services/server/templates/`. The Jekyll files in `ui/_includes/` and `ui/_layouts/` are NOT used by the deployed server. Keep both in sync when making changes, or we'll keep seeing divergence.

### Login/register now wired
`wireUI()` in `boomboom.js` now handles `loginForm#submit` and `registerForm#submit`. Errors show in `#loginError` / `#registerError`. Password cleared from DOM after every attempt.

### Service worker cache version
`CACHE_NAME = 'app-v2'` — if paths changed and old cached SW is in user's browser, they may need a hard refresh or cache clear once. Consider bumping to `app-v3` after the fixed SW is live.
