# bOOmbOOm.NOW! — Maintainability Audit

**Last updated:** 2026-03-19
**Concern:** Maintainability — code structure, duplication, architectural debt, patterns that complicate future changes.

---

## Resolved (see AUDIT_DONE.md)

### MAINT-2.1 `haversine_distance` — resolved, see AUDIT_DONE.md
<!-- ITEM id:MAINT-2.1 status:resolved priority:low concern:maintainability -->

### MAINT-2.2 Core utilities duplication — resolved, see AUDIT_DONE.md
<!-- ITEM id:MAINT-2.2 status:resolved priority:medium concern:maintainability -->

---

## Open Items

### MAINT-2.3 Per-handler role guards still scattered across services
<!-- ITEM id:MAINT-2.3 status:open priority:low concern:maintainability -->

**Date:** 2026-03-16 (updated 2026-03-24)
**Files:** `services/users-service/src/main.rs`, `ui/_layouts/default.html`

**What is now resolved (2026-03-24 T-08 Phase 2):**
- Gateway now uses a single `authority_guard()` + `role_guard()` pattern — no more `admin_guard()`/`manager_guard()` helpers.
- Messages, favourites, blocks, location services now use `RegisteredByGateway`/`AuthedByGateway` from common — no per-service JWT decoding or role checks in those handlers.
- `common/src/auth.rs` has `GatewayIdentity` with pre-verified role — a role change in authority now propagates automatically.

**What remains:** `users-service` still has `AdminUser`/`RequireRegistered` extractors for its own admin routes (separate from gateway). These run an independent tokenVersion DB check. This is intentional (services must still validate independently when not behind the gateway), but the pattern is inconsistent with the newer `AuthedByGateway` approach.

**Suggested next step:** Migrate `users-service` admin handlers to `AuthedByGateway` in a focused follow-up session.

**Priority:** LOW — role guards are correct; this is a consistency improvement.

---

### MAINT-2.4 `app.js` mixes six distinct module concerns
<!-- ITEM id:MAINT-2.4 status:resolved priority:low concern:maintainability -->

**Date updated:** 2026-03-19 (split completed)
**File:** `ui/scripts/app.js` (formerly ~990 lines; now split)

The original file contained **6 IIFEs** with distinct responsibilities. Each has been moved to its own file, all loaded globally via `default.html` in the correct dependency order:

- `ui/scripts/debug.js` — Debug console overlay (~24 lines); activate with `?dbg` in URL
- `ui/scripts/warmup.js` — Pre-warm backend services on first tab load (~12 lines)
- `ui/scripts/app.js` — Main app shell: Auth hooks, nav/offcanvas wiring, modals, FAB (~336 lines)
- `ui/scripts/geo.js` — GeoModule: geolocation, WS location push, status bar, IP fallback (~282 lines)
- `ui/scripts/lock.js` — LockModule: inactivity/tab-hide key locking, unlock modal (~183 lines)
- `ui/scripts/notif.js` — NotifModule: notification polling, dismissable banners (~117 lines)

**Load order is preserved** in `default.html`; each module wraps the previous `Auth.onLogin/onLogout` hooks via the same chaining pattern used before the split.

**Priority:** ✅ DONE — 2026-03-19

---

### MAINT-2.5 No explicit WebSocket disconnect on message-page navigation
<!-- ITEM id:MAINT-2.5 status:open priority:low concern:maintainability -->

**File:** `ui/scripts/messages.js`

The `beforeunload` handler sends `{ type: 'view', userId: null }` to clear the thread subscription, but the WebSocket itself is not explicitly closed on navigation. The server's `onclose` handler clears timers and releases the send bucket. The browser closes the WS on unload anyway, but there is no explicit `_msgWs.close()` call — inconsistent with the location WS (`closeLocWS()` is called on logout).

**Priority:** LOW — no functional impact; cosmetic inconsistency.

---

### MAINT-2.6 Per-service Config struct duplication — acceptable, not worth refactoring now
<!-- ITEM id:MAINT-2.6 status:open priority:low concern:maintainability -->

**Date:** 2026-03-19
**Files:** `services/*/src/main.rs` (all 9 services)

Each service defines its own `Config` struct with a `from_env()` impl. All share a common core (`port`, `jwt_secret`, `service_secret`, `mongo_uri`, `db_name`); some add service-specific URL fields (`fav_service_url`, `tiers_service_url`, etc.).

**Assessment:** The duplication is intentional and appropriate for independent microservices. Rust has no inheritance; the alternatives (shared `common` crate, proc macros) add build coupling and complexity without meaningful benefit at the current scale (~30 lines per service). The `from_env()` impls are not identical — port defaults and required fields differ per service.

**When this becomes worth revisiting:** If a new standard env var must be added to all services simultaneously (e.g., `OTEL_ENDPOINT` for tracing) and the manual update across 9 files becomes painful, a shared `common::BaseConfig` struct would be justified at that point.

**Priority:** LOW — not a maintenance burden today; reassess at ~15+ services or frequent cross-service config drift.

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| ✅ | MAINT-2.1 | LOW | haversineDistance — resolved, single impl in common/src/geo.rs |
| ✅ | MAINT-2.2 | MEDIUM | Core utilities — resolved, all in common/src/auth.rs extractors |
| 🔲 | MAINT-2.3 | LOW | Per-handler role guards still scattered; token verification now centralised |
| ✅ | MAINT-2.4 | LOW | app.js split into 6 focused files — 2026-03-19 |
| 🔲 | MAINT-2.5 | LOW | No explicit WS close on message-page navigation |
| 🔲 | MAINT-2.6 | LOW | Per-service Config struct duplication — acceptable today, reassess at 15+ services |

Resolved items → AUDIT_DONE.md
