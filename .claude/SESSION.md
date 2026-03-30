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

T-28 Phase 3 — Server-side route guards and auth context injection (next session)

---

## Completed This Session

- **T-28 Phase 2 — Tera template migration** ✅
  - `services/server/templates/base.html`: Tera layout, drops `window.BOOMBOOM_API_URL`/`BOOMBOOM_BASE` injections, inline guard script cleaned of Liquid, base path `/` throughout
  - `services/server/templates/partials/`: navbar, offcanvas-menu, modal-login, modal-register, modal-pin, modal-lock, modal-tier-gate, modal-block, modal-delete (9 partials)
  - `services/server/templates/pages/`: index, messages, messages-thread, profile, profile-view, favourites, settings, admin, donate (9 pages)
  - `services/server/src/main.rs`: Tera init, `TEMPLATES_DIR`/`ASSET_VERSION` env vars, `AppState` extended with `tera`/`asset_version`, 9 page handlers, all routes added
  - `ui/scripts/lib/api.js`: `API_BASE = ''` (relative paths, no more `window.BOOMBOOM_API_URL`)
  - `cargo build -p server` — zero errors, zero warnings

---

## Key Decisions Made

- **modal-block and modal-delete** included in `base.html` globally (not in original `default.html` but referenced by boomboom.js — including them fixes the oversight)
- **Inline route guard** kept in `base.html` for Phase 2 (removed in Phase 3 when server-side guards land)
- **Build info** in offcanvas simplified to `v{{ asset_version }}` (Liquid `site.github.build_revision` block removed)
- **`TEMPLATES_DIR`** defaults to `./templates`; `ASSET_VERSION` defaults to `"0"`

---

## Blockers / Parked Items

- Site is offline (owner aware). All JS fixes deferred until T-29 (after T-28).
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]`.
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service, favourites-service, gateway.
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### Start here next session
**T-28 Phase 3 — Server-side route guards and auth context injection.** Read `specs/services/server/route-guards.yaml` before starting.

The work is:
1. Add `JWT_SECRET` env var to server
2. Axum middleware: read `bbn_tok` cookie → decode/verify JWT → extract `sub` (nickname), `role`, `tier`, `exp`
3. Protected routes: `/messages/`, `/favourites/`, `/profile/`, `/settings/` — redirect to `/` if JWT missing or expired
4. Admin-only: `/admin/` — redirect to `/` if role ≠ admin
5. Inject into template context: `is_logged_in: true`, `nickname`, `tier`, `role` when valid JWT present
6. `auth.js` Phase 3 changes: on login set `bbn_tok` cookie (`SameSite=Strict; Secure; Path=/`); on logout clear it; remove inline guard script from `base.html`

**Dependencies:**
- `jsonwebtoken` crate needed for JWT decode/verify — add to workspace + server Cargo.toml
- Cookie parsing: `axum-extra` with `cookie` feature, or `tower-cookies` — check what's already in workspace

**Tera template context note:**
`base_context()` in main.rs already inserts `is_logged_in: false`, `nickname: None`, etc. Phase 3 middleware overrides these from the JWT.

### Other notes
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
- `auth.js` `initGuest()` uses `window.Api.guestAuth()` — this will be fixed in T-29.
- Phase 2 templates don't include `modal-block` in original `default.html` but we added it globally — this is intentional (fix for existing omission).
