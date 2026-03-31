# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-ui-pages-session-30ZSB`
**Session date:** 2026-03-31
**Last updated:** 2026-03-31T00:00Z

---

## In Progress

Committing fix for multiple UI page regressions.

---

## Completed This Session

- **map.js**: Fixed `bbm-marker` → `bbn-marker` class name and `--bbm-bearing` → `--bbn-bearing` CSS var — these mismatches made all map icons unstyled (wrong size, no colour, no ring)
- **lock.js**: Removed `document.addEventListener('DOMContentLoaded', ...)` wrapper from `initUnlockButton()` — DOMContentLoaded had already fired by the time this was called from initApp(), so the unlock/logout buttons in the lock modal were never wired, leaving users stuck when the session locked
- **lock.js**: Extracted new `wireAuthHooks()` export — the old module-level Auth hook code ran at import time when `window.Auth` was undefined; now called explicitly from boomboom.js after `window.Auth` is set
- **settings.js**: Fixed preference localStorage keys from `bbn_pref_map_zoom` / `bbn_pref_show_fav_pins` to `bbm_pref_map_zoom` / `bbm_pref_show_fav_pins` — mismatched keys meant zoom preference was never read by map.js
- **boomboom.js**: Imported `prefs.js` and exposed `window.BbmPrefs` — map.js reads zoom via `window.BbmPrefs.mapZoom()`, which was always undefined before
- **boomboom.js**: Called `wireAuthHooks()` after `window.Auth` is assigned — lock module now starts inactivity timer correctly on login
- **boomboom.js**: Added `renderFavourites(true)` call to `Auth.onLogin` hook and after `await window.__authReady` — favourites page was rendering before auth, showing "Log in" state forever
- **boomboom.js**: Added `Messages.initMessagesPage({ convList: true })` after auth for messages list page — `convListWrap` was never populated
- **boomboom.js**: Added `Messages.initMessagesPage({ thread: true })` after auth for messages thread page — thread was never rendered
- **boomboom.js**: Added dynamic `<script src="/scripts/admin.js">` injection after auth if `adminPanel` element exists — admin.js was never loaded, admin panel was always empty
- **boomboom.js**: Called `BbmPrefs.sync()` in `Auth.onLogin` hook — syncs server-side preferences into localStorage on login

---

## Key Decisions Made

- Tera templates (`services/server/templates/`) are the ones actually served — not Jekyll `ui/_includes/`. Always fix Tera first.
- `wireAuthForms()` must run synchronously, before `await window.__authReady`, to prevent form race conditions.
- `CORS_ORIGINS` must be set in Railway for the **gateway** service. No default value — gateway panics if missing.
- `JWT_SECRET` must be **identical** in both server and gateway Railway services.
- WS proxy Origin forwarding: server's `proxy_ws` now extracts the browser `Origin` and re-inserts it into the upstream WS handshake.
- `admin.js` is a non-module script that uses `window.Auth`, `window.Api`, `window.__authReady`. It must be loaded AFTER boomboom.js has run and auth has resolved — dynamic injection is the correct approach.
- Lock module `initUnlockButton()` must be called after DOM is ready but MUST NOT wrap button wiring in a DOMContentLoaded listener (that event already fired).
- `wireAuthHooks()` in lock.js must be called after `window.Auth` is set in initApp().

---

## Blockers / Parked Items

- **`/settings` non-editable account info** — if `ssr_me` is None (gateway down), shows "Loading…" via SSR fallback; JS `initAccountInfo()` also fails silently. This is a backend/gateway availability issue, not a JS bug.
- **`/favourites` redirect (and other protected routes)** — most likely `JWT_SECRET` mismatch between server and gateway Railway services.
- **`/admin` page empty** — was dead code; now fixed by dynamic loading from boomboom.js after auth.
- **User icon changed** — sex-aware circle icon was missing because map.js used wrong CSS class `bbm-marker` instead of `bbn-marker`. Now fixed.
- **502 on `/api/auth/guest`** — owner must verify `GATEWAY_URL` is set correctly in Railway for the server service.
- `JWT_SECRET`, `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION`, `CORS_ORIGINS` must be set in Railway.
- 18 CodeQL alerts open (fetched 2026-03-25).

---

## Handoff Notes

### Root causes fixed this session

1. **Map icons unstyled** — CSS class name `bbn-marker` vs JS `bbm-marker` mismatch (and `--bbn-bearing` vs `--bbm-bearing`). All fixed in map.js.
2. **Lock modal unusable** — `initUnlockButton()` wrapped button wiring in `DOMContentLoaded` which had already fired. Buttons never got listeners. User was stuck when session locked.
3. **Admin panel empty** — `admin.js` was never loaded. Fixed with dynamic script injection from boomboom.js after auth.
4. **Favourites empty** — `renderFavourites()` was called before auth → showed "Log in" state. Not re-rendered after auth. Fixed: re-render after `__authReady` and on `Auth.onLogin`.
5. **Messages page empty** — `Messages.initMessagesPage()` was never called. Fixed: called after auth for both convList and thread pages.
6. **Zoom setting has no effect** — `prefs.js` was not imported → `window.BbmPrefs` undefined → map used DEFAULT_ZOOM. Also settings.js used wrong key names. Both fixed.
7. **Lock module auth hooks** — `wireAuthHooks()` ran at module import time when `window.Auth` was undefined. Now called explicitly after `window.Auth` is set.

### Owner — no Railway env var changes needed for this commit.
All fixes are client-side JS only.
