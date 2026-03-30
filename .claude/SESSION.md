# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-wfizk`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T00:00Z

---

## In Progress

T-28 Phase 4 — Minimal SSR data injection (next session)

---

## Completed This Session

- **T-31 — Modal scope fix** ✅ (quick fix, no separate commit)
  - Removed `modal-block` and `modal-delete` from `base.html`
  - Added `{% include "partials/modal-block.html" %}` to index, messages-thread, profile-view
  - Added `{% include "partials/modal-delete.html" %}` to settings

- **T-28 Phase 2 — Tera template migration** ✅
  - `services/server/templates/base.html`: Tera layout
  - `templates/partials/`: 9 partials (navbar, offcanvas, 7 modals)
  - `templates/pages/`: 9 page templates
  - `main.rs`: Tera init, page routes
  - `ui/scripts/lib/api.js`: `API_BASE = ''`

- **T-28 Phase 3 — Server-side route guards** ✅
  - `services/server/src/guards.rs`: `extract_cookie`, `decode_bbn_tok`, `check_auth`, `require_user`, `require_admin`
  - `services/server/src/main.rs`: `JWT_SECRET` env var, `AppState.jwt_secret`, `render()` accepts `AuthContext`, all 9 handlers updated (3 public, 5 user-protected, 1 admin)
  - `services/server/Cargo.toml`: `jsonwebtoken` added
  - `ui/scripts/lib/auth.js`: `setBbnCookie`/`clearBbnCookie` — cookie set on `init` (restore), `login`, `register`, `refreshToken`; cleared in `clearUserStorage` (logout, deleteAccount)
  - `services/server/templates/base.html`: inline client-side guard script removed
  - `cargo build -p server` — zero errors, zero warnings

---

## Key Decisions Made

- **`bbn_tok` cookie**: `SameSite=Strict; Secure; Path=/` — not set for guest sessions
- **`guards.rs`**: standalone module (no `common` crate dependency — keeps server independent of MongoDB)
- **`check_auth`**: always succeeds; returns `AuthContext::guest()` on missing/invalid/expired cookie
- **Cookie set in `init()`**: when restoring an existing sessionStorage token, the cookie is re-set so the next navigation benefits from server-side guards
- **T-31 modal scoping**: modal-block/modal-delete moved to specific page templates using `{% include %}`, not inlined

---

## Blockers / Parked Items

- Site is offline (owner aware). All JS fixes deferred until T-29 (after T-28).
- `JWT_SECRET` must be added to Railway env vars for the server service before T-30 deploy.
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]`.
- 18 CodeQL alerts open (fetched 2026-03-25).
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### Start here next session
**T-28 Phase 4 — Minimal SSR data injection.** Read T-28 ticket Phase 4 section.

The work is:
1. In `page_profile` and `page_settings` handlers: if `auth.is_logged_in`, call `GET GATEWAY_URL/api/users/me` with `Authorization: Bearer <jwt_from_cookie>`
2. Inject response fields (`nickname`, `age`, `sex`, `bio`, `tier`, `account_type`) into Tera context
3. On gateway error (timeout, 5xx): render page with empty fields (graceful degradation — JS loads them normally)
4. Need the raw JWT token accessible in the handler — the cookie value is currently discarded after claims extraction. Thread it through or re-read the cookie in handlers.

**Note on raw JWT access:**
Currently `decode_bbn_tok` discards the raw token string. For Phase 4, `check_auth`/`require_user` need to also return the raw token string so handlers can forward it as `Authorization: Bearer`. One approach: add `pub raw_token: Option<String>` to `AuthContext`.

### Other notes
- T-31 (modal scope fix) was done inline this session without a separate commit — it's included in the Phase 2 commit.
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`.
- `auth.js` `initGuest()` uses `window.Api.guestAuth()` — T-29 fixes this.
