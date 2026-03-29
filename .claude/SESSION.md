# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/add-specs-document-7bxNJ`
**Session date:** 2026-03-29
**Last updated:** 2026-03-29T22:00Z

---

## In Progress

Planning complete for T-28/T-29/T-30. Awaiting owner decision on emergency JS hotfix
before starting T-28 Phase 1 implementation.

---

## Completed This Session

- **Planned T-28 / T-29 / T-30 — server migration + JS cleanup**
  - T-28: Rust `server` service (Tera templates, API/WS proxy facade) — 4 phases
  - T-29: JS cleanup — fix broken ES6 refactor, trim to UI-only — 3 phases
  - T-30: Deployment — Railway, CORS removal, CI/CD migration — 3 phases
  - All three tickets created in `.claude/tickets/`
  - TICKETS.md index updated

- **Full JS audit completed** (see T-29 for detail)
  - Site is currently broken: `settings.js` has stub implementations (all functions empty)
  - `auth.js` calls `window.Api.*` which is never set — login/register/guest auth all fail
  - `geo.js`, `messages.js`, `notifications.js`, `warmup.js` use `window.BOOMBOOM_API_URL` and other window globals
  - `favourites.js` is the only correctly modularised file
  - `boomboom.js` has `window.Api.getProfile()` and hardcoded `USER_ID`/`NICKNAME` stubs

- **Renamed `specs/ui/01.yaml` → `specs/ui/auth-modal.yaml`**
  - Fixed schema, added naming convention to specs/README.md

- **Introduced spec workflow into CLAUDE.md**
  - Spec Workflow section, Before Each Commit step, Wrap-Up Checklist step, Persistent Files entry

---

## Key Decisions Made

- **Service name**: `server` (not `ui-service`) — `services/server/`, `Dockerfile.server`
- **Template engine**: Tera (not Handlebars) — Liquid-like syntax, easier migration from Jekyll, template inheritance
- **Architecture**: separate `server` + `gateway` — gateway untouched; server is HTML server + pure API/WS proxy
- **CORS**: removed from gateway once server is the sole browser entry point (T-30 Phase 2)
- **JWT cookie**: `bbn_tok` cookie set by `auth.js` on login, read by server for route guards + SSR context
- **Base path**: `/bbn` prefix dropped entirely — server serves from `/`
- **`window.BOOMBOOM_API_URL`**: eliminated — all API calls use relative `/api/*`
- Spec coverage grows incrementally (Option B)

---

## Blockers / Parked Items

- **URGENT: Site is currently broken** — `settings.js` has no real code (all stubs); `auth.js`
  uses `window.Api` (never set). Owner must decide: emergency hotfix now, or accept broken
  state while T-28 is built?
- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch).
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service,
  favourites-service, gateway.
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### What to do next
1. **Owner decision needed**: emergency JS hotfix vs. accept broken state during T-28 build.
2. Start T-28 Phase 1: scaffold `services/server/` Rust crate with Axum + Tera + API proxy.
3. Merge pending branches → `dev` when ready.
4. CodeQL SSRF alerts take priority after merges.

### Notes for next session
- T-28 Phase 1 = scaffold only: Axum routes, ServeDir for static files, proxy `/api/*` and `/ws/*` to gateway, health endpoint, Dockerfile.server. No templates yet.
- Template engine is Tera. Liquid → Tera migration is nearly mechanical: `{% include %}` → `{% include %}` (same!), `{{ var | filter }}` same, `{% if %}` same, layouts use `{% extends %}` + `{% block %}`.
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
- `_includes/` JS files (boomboom.js, admin.js, i8n.js, profile.js) — pre-module remnants, confirm if still referenced before deleting.
