# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-ui-pages-session-30ZSB`
**Session date:** 2026-03-31
**Last updated:** 2026-03-31T08:00Z

---

## In Progress

Session closed — wrap-up complete.

---

## Completed This Session

### UI page regression fixes (commits 2c030c3, 5651baa)

- **map.js**: `bbm-marker` → `bbn-marker`, `--bbm-bearing` → `--bbn-bearing` — markers were completely unstyled (wrong size, no colour, no ring)
- **lock.js**: Removed `DOMContentLoaded` wrapper from `initUnlockButton()` — buttons were never wired; users got stuck at lock modal
- **lock.js**: Extracted `wireAuthHooks()` — module-level Auth hook code ran at import time when `window.Auth` was undefined; now called explicitly from boomboom.js
- **settings.js**: Fixed pref keys `bbn_pref_map_zoom` / `bbn_pref_show_fav_pins` (were `bbn_pref_*` after earlier rename but still mismatched prefs.js)
- **boomboom.js**: Imported `prefs.js`, exposed `window.BbmPrefs`, called `wireAuthHooks()`, called `BbmPrefs.sync()` on login
- **boomboom.js**: `renderFavourites(true)` after auth resolves and in `Auth.onLogin` — favourites page was showing "log in" state forever
- **boomboom.js**: `Messages.initMessagesPage({ convList/thread })` after auth — conversation list and thread were never rendered
- **boomboom.js**: Dynamic `<script src="/scripts/admin.js">` injection after auth if `adminPanel` exists — T-33 fixed

### Full bbm→bbn rename (commit 5651baa)

- All `bbm-` CSS class names, `--bbm-*` CSS variable references, and `bbm_*` storage keys renamed to `bbn-`/`bbn_` across 13 files
- `BBNCrypto` was already correct (was never `BBMCrypto` in codebase)
- localStorage keys renamed: `bbn_meet`, `bbn_token`, `bbn_guest_id`, `bbn_guest_exp`, `bbn_pref_*` — existing users' preferences reset on first deploy (acceptable)

### Security specs (commit 6a9aa05)

- **NEW** `specs/ui/lock.yaml` — inactivity timer, key locking, unlock modal, `wireAuthHooks()`
- **NEW** `specs/ui/crypto.yaml` — BBNCrypto proxy, worker communication contract
- **NEW** `specs/ui/crypto-worker.yaml` — ECDH P-256, AES-GCM-256, PBKDF2-200k, non-extractable key boundary
- **NEW** `specs/services/gateway/cors.yaml` — `CORS_ORIGINS` env var, WS `origin_ok()`, single source of truth
- **UPDATED** `specs/ui/auth.yaml` — `bbn_meet` key, refreshed qa_report
- **UPDATED** `specs/ui/auth-modal.yaml` — filled status/qa_report, full SEC-1.15 detail
- **UPDATED** `specs/ui/boomboom.yaml` — `implemented`, added all new behaviours
- **UPDATED** `specs/services/server/proxy.yaml` — `implemented`, Origin forwarding added

### Tickets

- **T-33** closed — admin panel empty root cause found and fixed (dynamic script injection)

---

## Key Decisions Made

- `bbm` was a global typo throughout; canonical prefix is `bbn`. All CSS classes, CSS vars, localStorage/sessionStorage keys, DOM class queries updated.
- `BBNCrypto` was already the correct name (crypto.js always used `BBN`). No rename needed.
- sessionStorage for JWT token is intentional (privacy-by-design: clears on tab close). localStorage is used only for data that should survive tab close: guest ID, expiry, meeting target, preferences.
- `admin.js` is a non-module legacy script; it cannot be imported. Dynamic injection after auth is the correct loading strategy — `window.Auth`, `window.Api`, `window.__authReady` are all guaranteed set at that point.
- `initUnlockButton()` must never be wrapped in `DOMContentLoaded` — it is called from `initApp()` which itself runs on `DOMContentLoaded`, so the event has already fired.

---

## Blockers / Parked Items

- **`/settings` non-editable account info** — if `ssr_me` is None (gateway down or unreachable), shows "Loading…". JS `initAccountInfo()` also fails silently. Backend/infra issue.
- **`/favourites` and other protected routes redirect** — most likely `JWT_SECRET` mismatch between server and gateway Railway services. Both must use the same secret.
- **502 on `/api/auth/guest`** — verify `GATEWAY_URL` is set correctly in Railway server service and gateway is running.
- **`specs/ui/opaque-client.yaml` missing** — OPAQUE protocol client has clear security contracts (SEC-1.10 PBKDF2 email hash). Needs a spec next session.
- `JWT_SECRET`, `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION`, `CORS_ORIGINS` must be set in Railway.
- 18 CodeQL alerts open (fetched 2026-03-25).

---

## Handoff Notes

### Railway env vars — no changes needed for this commit
All fixes in this session are client-side JS and specs only.

### Spec gap to fill next session
`specs/ui/opaque-client.yaml` — covers the OPAQUE WASM client, the PBKDF2 email hash (SEC-1.10), and the two-step login/register flow contract. Medium priority.

### bbn_ storage key rename — deploy impact
Users will lose stored preferences and meeting targets on first deployment after this branch merges. The JWT is in sessionStorage (per-tab) so login state is unaffected. Guest ID (`bbn_guest_id`) will regenerate silently.

### T-27 (App Architecture Specs) — still planned
Several spec gaps remain for the gateway service (JWT signing/validation, rate limiting, WS auth). T-27 is the umbrella ticket.
