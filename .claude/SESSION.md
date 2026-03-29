# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/add-specs-document-7bxNJ`
**Session date:** 2026-03-29
**Last updated:** 2026-03-29T23:30Z

---

## In Progress

T-28 Phase 2 — Tera template migration (next session)

---

## Completed This Session

- **T-28 Phase 1 — server crate scaffold** ✅
  - `services/server/src/main.rs`: Axum routes, static serving (ServeDir/ServeFile), health, gateway URL validation
  - `services/server/src/proxy.rs`: HTTP proxy all methods `/api/*` + WebSocket tunnel `/ws/*`
  - `services/Dockerfile.server`: multi-stage build, copies `ui/` assets into `/app/static`
  - Added to workspace: `server` member, `tera`, `tokio-tungstenite`, `url` deps
  - `cargo build -p server` and `cargo check` — zero errors, zero warnings

- **5 behavioral specs written** (T-28/T-29 scope)
  - `services/server/proxy.yaml`, `services/server/route-guards.yaml`, `services/server/static-serving.yaml`
  - `ui/auth.yaml`, `ui/api.yaml`

- **T-28/T-29/T-30 planned** — tickets created with full phase breakdown

- **Full JS audit** — site is currently offline (owner aware)
  - `settings.js`: all function bodies are comment stubs — total loss, deferred
  - `auth.js`: uses `window.Api.*` (never set in ES6 module context)
  - `geo.js`, `messages.js`, `notifications.js`, `warmup.js`: use `window.BOOMBOOM_API_URL`
  - `favourites.js`: only correctly modularised file
  - All JS fixes deferred until after T-28 (T-29)

- **Spec workflow introduced into CLAUDE.md** — specs checked/created before every module touch
  - `specs/ui/01.yaml` → `specs/ui/auth-modal.yaml`, schema fixed, naming convention added to README

---

## Key Decisions Made

- **Service name**: `server` — `services/server/`, `Dockerfile.server`, binary `server`
- **Template engine**: Tera — Liquid-like syntax, template inheritance, easier Jekyll migration
- **Architecture**: separate `server` + `gateway` — gateway untouched; server is HTML + proxy only
- **CORS**: to be removed from gateway once server is sole browser entry point (T-30 Phase 2)
- **JWT cookie**: `bbn_tok` set by `auth.js` on login, read by server for route guards + SSR context
- **Base path**: `/bbn` prefix dropped — server serves from `/`
- **`window.BOOMBOOM_API_URL`**: eliminated — JS uses relative `/api/*`
- **Spec coverage**: Option B (incremental) — create specs as modules are touched

---

## Blockers / Parked Items

- Site is offline (owner aware). All JS fixes deferred until T-29 (after T-28).
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]`.
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service, favourites-service, gateway.
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### Start here next session
**T-28 Phase 2 — Tera template migration.** Read `specs/services/server/static-serving.yaml` before starting.

The work is:
1. Port `ui/_layouts/default.html` → `services/server/templates/base.html` (Tera layout with `{% block content %}`)
2. Port each `ui/_includes/*.html` → `services/server/templates/partials/` (Tera partials, `{% include "partials/navbar.html" %}`)
3. Port each page HTML → `services/server/templates/pages/` (extend base, fill content block)
4. Add page routes in `main.rs` (one route per page, render template with base context)
5. Remove Jekyll frontmatter (`---` blocks) and Liquid syntax from all templates

**Liquid → Tera conversion cheatsheet:**
- `{% include navbar.html %}` → `{% include "partials/navbar.html" %}`
- `{{ '/' | relative_url }}` → `/`
- `{{ site.baseurl }}` → `` (empty — base is `/`)
- `{% if page.title %}{{ page.title }}{% endif %}` → `{% if title %}{{ title }}{% endif %}`
- Layout: `{{ content }}` → `{% block content %}{% endblock content %}`
- Pages use `{% extends "base.html" %}` + `{% block content %}...{% endblock %}`

**Client-side changes in Phase 2 (do alongside templates):**
- `api.js`: change `const API_BASE = window.BOOMBOOM_API_URL` → `const API_BASE = ''` (relative)
- Remove `window.BOOMBOOM_API_URL` injection from base template
- Remove `window.BOOMBOOM_BASE` injection from base template

### Other notes
- `_includes/` contains JS files (`boomboom.js`, `admin.js`, `i8n.js`, `profile.js`) — pre-module remnants; confirm if still referenced in any template before deleting.
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
- `auth.js` `initGuest()` uses `window.Api.guestAuth()` — this will be fixed in T-29, not T-28. Phase 2 template work doesn't require a working site.
