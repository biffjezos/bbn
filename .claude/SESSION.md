# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-path-bugs-HhisD`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T20:00Z

---

## In Progress

Session closed — wrap-up complete.

---

## Completed This Session (round 4)

- **map.js initMap()**: added `if (!document.getElementById('map')) return;` guard — fixes Leaflet "Map container not found" error thrown on every non-index page
- **modal-login.html / modal-register.html**: removed `name="password"` from password fields — belt-and-suspenders guard against password appearing in URL if native form submission fires despite other protections
- **gateway/src/main.rs**: `CORS_ORIGINS` promoted from hardcoded constant to required env var; `cors_origins: Vec<String>` added to `Config` and `AppState`; CORS layer and WS origin check both use it
- **gateway/src/ws.rs**: `origin_ok()` signature changed to `allowed: &[String]`; both `ws_location` and `ws_messages` pass `&state.cors_origins`
- **server/src/proxy.rs**: `proxy_ws` extracts browser `Origin` header and passes it to `tunnel_ws`; `tunnel_ws` inserts it into the upstream WebSocket handshake — fixes WS 403 caused by gateway origin check seeing no Origin from the proxy
- **server/src/main.rs**: `ASSET_VERSION` now falls back to first 7 chars of `RAILWAY_GIT_COMMIT_SHA`, then `"dev"` — fixes "v0" version display
- **specs/ui/boomboom.yaml**: created — documents initApp() initialization order contract
- **specs/ui/map.yaml**: created — documents initMap() no-op guard and Leaflet preconditions
- **specs/ui/auth-modal.yaml**: updated — Tera paths as sources, `onsubmit="return false"` and `name` removal in pre_conditions
- **CLAUDE.md**: Spec Workflow rule tightened — "any module with inter-module contracts, async lifecycles, security-relevant behaviour, or initialization-order dependencies requires a spec; when in doubt, write the spec"

## Completed This Session (round 3)

- **boomboom.js**: extracted `wireAuthForms()` — wires login/register submit listeners BEFORE `await window.__authReady`, so the forms can never submit natively during the auth warm-up window. Race condition that put credentials in the URL is eliminated.
- **modal-login.html / modal-register.html**: added `onsubmit="return false"` as unconditional backstop against native form submission at the HTML level

## Completed This Session (round 2)

- **boomboom.js initApp()**: fixed `__authReady` initialization order — `window.__authReady = Auth.init()` now set BEFORE `initGeo()`. geo.js checks `window.__authReady instanceof Promise`; before this fix it was always `undefined` → geo never started → map never rendered.
- **service-worker.js**: bumped `CACHE_NAME` from `app-v2` to `app-v3` to force browser to evict old SW cache (which had wrong `/bbn/` paths and stale asset list).

## Completed This Session (round 1)

- **manifest.json** — replaced all `/bbn/` paths with `/` (start_url, scope, icon srcs)
- **service-worker.js ASSETS** — fixed wrong paths: `app.js` → `boomboom.js`; `/scripts/X.js` → `/scripts/lib/X.js` for crypto-worker, crypto, geo, lock, map, opaque-client
- **Tera base.html** — replaced deprecated `apple-mobile-web-app-capable` with `mobile-web-app-capable`
- **Tera modal-login.html** — wrapped fields in `<form id="loginForm">`, button changed to `type="submit"`, added `required` attrs
- **Tera modal-register.html** — wrapped fields in `<form id="registerForm">`, button changed to `type="submit"`, added `required`/`autocomplete` attrs
- **boomboom.js wireUI()** — wired `loginForm` and `registerForm` submit events → call `Auth.login()` / `Auth.register()`, show errors in error divs, clear password field after attempt, close modal on success

---

## Key Decisions Made

- Tera templates (`services/server/templates/`) are the ones actually served — not Jekyll `ui/_includes/`. Always fix Tera first.
- `wireAuthForms()` must run synchronously, before `await window.__authReady`, to prevent form race conditions.
- `CORS_ORIGINS` must be set in Railway for the **gateway** service. No default value — gateway panics if missing.
- `JWT_SECRET` must be **identical** in both server and gateway Railway services. Mismatch → `bbn_tok` cookie validated differently → all protected routes redirect to `/`.
- WS proxy Origin forwarding: server's `proxy_ws` now extracts the browser `Origin` and re-inserts it into the upstream WS handshake so gateway's `origin_ok()` passes.
- `ALLOWED_ORIGINS` was hardcoded as `["https://biffjezos.github.io"]` — this is gone, replaced by `CORS_ORIGINS` env var.

---

## Blockers / Parked Items

- **`/favourites` redirect (and other protected routes)** — most likely `JWT_SECRET` mismatch between server and gateway Railway services. Server validates `bbn_tok` with its own `JWT_SECRET`; if it doesn't match the gateway's key, the guard rejects the cookie and redirects to `/`. **Owner must verify JWT_SECRET is identical in both services.**
- **`/admin` page empty** — `admin.js` is dead code, never loaded. Ticket T-33 created. Needs investigation.
- **User icon changed** — sex-aware circle icon reported missing from map. Not investigated this session.
- **502 on `/api/auth/guest`** — owner must verify `GATEWAY_URL` is set correctly in Railway for the server service, and that the gateway service is running.
- `JWT_SECRET`, `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION`, `CORS_ORIGINS` must be set in Railway.
- 18 CodeQL alerts open (fetched 2026-03-25).

---

## Handoff Notes

### Owner — Railway env vars to set before next test

**gateway service** (new required var):
- `CORS_ORIGINS` = `https://boom.up.railway.app` (or comma-separated list including staging URLs)

**Both server AND gateway services** (must match exactly):
- `JWT_SECRET` — verify they are identical. Mismatch is the root cause of `/favourites` redirect.

**server service** (optional, will auto-use git SHA):
- `ASSET_VERSION` = leave unset to auto-use `RAILWAY_GIT_COMMIT_SHA` first 7 chars, or set explicitly.

### WS 403 root cause — now fixed
Gateway's `origin_ok()` was always rejecting WS connections from the server proxy because the proxy did not forward the browser's `Origin` header. Now fixed: `proxy_ws` in `server/src/proxy.rs` extracts `Origin` and re-inserts it into the upstream WS handshake.

### CORS_ORIGINS root cause — now fixed
`ALLOWED_ORIGINS` was hardcoded as `["https://biffjezos.github.io"]` in `gateway/src/main.rs`. It is now a required env var (`CORS_ORIGINS`). Gateway panics on startup if missing — this is intentional.

### Credential-in-URL race condition — now fixed (SEC-1.15)
Login/register forms had no `name="password"` and `onsubmit="return false"` in HTML, but `wireAuthForms()` was wired AFTER `await window.__authReady`. During the auth warm-up window, a fast submit could fire native GET form submission. Fix: `wireAuthForms()` runs before the await; `onsubmit="return false"` is unconditional backstop; no `name` attr on password fields.

### Template duality — Tera vs Jekyll
The Rust server serves Tera templates from `services/server/templates/`. The Jekyll files in `ui/_includes/` are NOT used. Always fix Tera first.

### Admin panel (T-33)
Owner reported `/admin` page is empty. `admin.js` is likely dead code not loaded by any template. Needs investigation next session.

### JWT_SECRET mismatch — likely root cause of /favourites redirect
Server's `guards::check_auth` / `guards::require_user` decode `bbn_tok` cookie using server's `JWT_SECRET`. Gateway signs JWTs with its own `JWT_SECRET`. If they differ, the server rejects every cookie. Both services must share the same secret.
