# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/review-next-tasks-uK0sn`
**Session date:** 2026-03-24
**Last updated:** 2026-03-24 wrap-up

---

## In Progress

Nothing — session wrapped.

---

## Completed This Session

- T-08 Phase 3 added to TICKETS.md (dynamic feature-tier admin UI)
- `authority-service` crate created: `src/main.rs`, `src/auth.rs` (OPAQUE), `src/tiers.rs` (tier CRUD + features), `src/verify.rs` (`POST /authority/verify`)
- `services/Cargo.toml` — added `authority-service` to workspace members
- `services/Dockerfile.authority` created (mirrors Dockerfile.auth pattern)
- Gateway modularised into 5 modules: `rate.rs`, `proxy.rs`, `guards.rs`, `handlers.rs`, `ws.rs` — `main.rs` trimmed to ~260 lines (Config + AppState + main + router)
- Gateway env var `AUTH_SERVICE_URL` → `AUTHORITY_SERVICE_URL` (covers auth + tiers + verify)
- `TIERS_SERVICE_URL` removed from gateway — all tier routes now point to authority-service
- `common/src/auth.rs` — added `GatewayIdentity`, `AuthedByGateway`, `RegisteredByGateway`, `TokenProfile`, `ProfileFromToken`
- `messages-service`, `favourites-service`, `blocks-service` — `RequireRegistered` → `RegisteredByGateway`
- `location-service` — `AuthToken` → `AuthedByGateway + ProfileFromToken`; `get_nearby` uses `identity.radii.nearby_m` directly (eliminates tiers-service round-trip when gateway headers present)
- All changed crates: `cargo check` clean (warnings only)
- Hotfix: added `authority-service` workspace stub to all 9 existing Dockerfiles (commit `59cb51a`) — fixes Railway build failures after authority-service was added to workspace

---

## Key Decisions Made

- **gateway modules**: `main.rs` is now only Config + AppState + main(). All handlers, guards, proxy helpers, rate limiting, and WS logic are in their own modules. Requested by owner.
- **`proxy()` takes `Option<VerifyResponse>` by value** (not by ref) — avoids async borrow lifetime issues when closures own the identity.
- **`AUTH_SERVICE_URL` renamed to `AUTHORITY_SERVICE_URL`** — single URL for auth + tiers + verify. Old `TIERS_SERVICE_URL` removed from gateway config. Admin tiers routes now go to authority-service.
- **`ProfileFromToken`** extractor added to common — decodes nickname/sex/age from JWT without tokenVersion check. Used by location-service's `put_location` because those profile fields aren't in GatewayIdentity.
- **Backwards-compatible**: `AuthedByGateway` falls back to `AuthToken` (JWT decode + DB check) when X-Auth-Sub is absent. Services continue to work before gateway is updated.
- **`fetch_favourite_ids` refactored** in location-service to take `(sub: &str, role: &str)` instead of `&UserClaims` — simpler, no type dependency.

---

## Blockers / Parked Items

- MAINT-2.3 (per-handler role guards scattered in services): partially resolved — gateway now uses `authority_guard` + `role_guard` consistently; services are now using `RegisteredByGateway` which is role-aware.
- `authority-service` not yet deployed on Railway — see handoff notes below for required actions.

---

## Handoff Notes

### What was built

The full T-08 Phase 2 code is done:

1. **`authority-service`** — new crate that merges auth-service + tiers-service. Exposes all auth routes, all tier routes, and the new `POST /authority/verify`. Build with `Dockerfile.authority`.

2. **Gateway modularised** — `main.rs` is now ~260 lines. Five new module files. All compile clean.

3. **Gateway env var change** — `AUTH_SERVICE_URL` is gone. Gateway now reads `AUTHORITY_SERVICE_URL` (required). `TIERS_SERVICE_URL` is also gone from gateway config. The old tiers-service can remain running on Railway — gateway just won't call it anymore.

4. **Downstream services** updated: messages, favourites, blocks, location all use `AuthedByGateway`/`RegisteredByGateway`. They are fully backwards-compatible (fall back to AuthToken when X-Auth-Sub header absent).

### Railway deployment steps (owner must do manually)

**Before deploying authority-service:**
1. Create a new Railway service named `authority-service`.
2. Set build command: `docker build -f services/Dockerfile.authority -t authority-service .` (or configure Railway to use `Dockerfile.authority`).
3. Set env vars (copy from existing `auth-service` Railway service — they are the same):
   - `MONGO_URI`
   - `JWT_SECRET`
   - `SERVICE_SECRET`
   - `EMAIL_PEPPER`
   - `OPAQUE_SERVER_SETUP`
   - `DB_NAME` (optional, defaults to `boomboom`)

**After authority-service is running:**
4. In the **gateway** Railway service, set:
   - `AUTHORITY_SERVICE_URL` = internal URL of the new authority-service
   - Remove `AUTH_SERVICE_URL` (no longer needed)
   - Remove `TIERS_SERVICE_URL` (no longer needed)
5. Redeploy gateway.

**Auth-service** can remain running until confirmed stable; then retire it.

### Phase 2 step status

Steps from the T-08 Phase 2 ticket:
1. ✅ Merge auth-service + tiers-service → authority-service (code done, not yet deployed)
2. ✅ `POST /authority/verify` endpoint (done)
3. ✅ Gateway updated — calls authority/verify, injects X-Auth-* headers (code done, not yet deployed)
4. ✅ Downstream services updated to read X-Auth-* (done, backwards-compatible)
5. ⬜ Retire tiers-service on Railway (pending deployment of authority-service)

### Next work

- Deploy authority-service (see Railway steps above) and verify all services behave correctly
- Retire auth-service and tiers-service on Railway after confirming authority-service is healthy
- T-08 Phase 3: dynamic feature-tier admin UI (see TICKETS.md)
- T-16 Phase 2: meta collection runtime-configurable settings

### Dockerfile stub pattern (future reference)

Every time a new crate is added to the Cargo workspace (`services/Cargo.toml`), all existing Dockerfiles must gain a stub for it:
```
COPY services/<new-service>/Cargo.toml ./<new-service>/Cargo.toml
RUN mkdir -p ./<new-service>/src && echo 'fn main(){}' > ./<new-service>/src/main.rs
```
This session missed it for `authority-service` and required a hotfix. Check all Dockerfiles whenever the workspace member list changes.
