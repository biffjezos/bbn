# bOOmbOOm.NOW! — Resolved Audit Items

All resolved audit findings, regardless of concern category.
Items moved here from AUDIT.md, AUDIT_SECURITY.md, and AUDIT_PERFORMANCE.md when confirmed fixed or accepted.

---

## From AUDIT_SECURITY.md (2026-03-24)

### DONE — SEC-1.1 Plain password and email in POST request

**Original severity:** HIGH
**Resolved:** 2026-03-24 (T-23 fully deployed)

OPAQUE two-round auth implemented in auth-service (Rust, `opaque-ke`). WASM client (`opaque-client.js`) loaded as ES module; `window.OpaqueClient` exposes `hashEmail`, `registerStart/Finish`, `loginStart/Finish`. Email hashed with PBKDF2-SHA256 (100k iters, fixed domain salt `boomboom-email-v2`) before leaving the browser. No plaintext email or password ever transmitted.

Login and register modals route through `Auth.login()` / `Auth.register()` → `Api.login()` / `Api.register()` — both OPAQUE flows.

Password change in `profile.js` was still using the old `Api.updateMe({ currentPassword, password })` plaintext route. Fixed 2026-03-24: replaced with `Api.changePassword({ password })` OPAQUE flow + separate `Api.saveKeys()` for the key blob re-encryption.

Backend deployment confirmed by owner: users collection wiped, `EMAIL_PEPPER` set, `OPAQUE_SERVER_SETUP` set, migration `008_opaque_emailhash` run.

---

## From AUDIT_SECURITY.md (2026-03-23)

### DONE — SEC-1.2 Gateway send-rate bypassable at messages-service HTTP endpoint

**Original severity:** MEDIUM
**Resolved:** 2026-03-23 (T-22)

**File:** `services/messages-service/src/main.rs` — `send_message` handler

Gateway's per-IP rate limiter on `msg_send` could be bypassed by a caller that reached `messages-service` directly (e.g. via a leaked internal URL). Fix: `send_message` now maintains a per-userId `FixedWindow` bucket in-process (`UserBuckets = Arc<Mutex<HashMap<String, (u32, Instant)>>>`). Every call to send a message is checked against this bucket; callers exceeding `msg_user_rate_max` (default 10) within `msg_user_rate_window` (default 10 s) receive `429`. This is a defence-in-depth layer — the gateway IP limiter still applies first.

---

### DONE — SEC-1.3 `real_ip()` trusts spoofable `X-Forwarded-For`

**Original severity:** MEDIUM
**Resolved:** 2026-03-23 (T-22)

**File:** `services/gateway/src/main.rs` — `real_ip()`

`real_ip()` previously read only `X-Forwarded-For`, which any caller can spoof by sending a forged header. Fix: `real_ip()` now checks `CF-Connecting-IP` first (set by Cloudflare and not spoofable by end users when all traffic flows through Cloudflare). `X-Forwarded-For` is used only as a fallback (for local dev without Cloudflare). Fallback: `127.0.0.1`.

---

### DONE — SEC-1.4 User JWT TTL hardcoded at 7 days

**Original severity:** MEDIUM
**Resolved:** 2026-03-23 (T-22)

**Files:** `services/common/src/auth.rs`, `services/auth-service/src/main.rs`, `services/users-service/src/main.rs`

JWT TTL was a hardcoded constant of 7 days with no mechanism to change it. Fix: `UserTokenParams` now has an optional `ttl_secs: Option<u64>` field. `issue_user_token` uses it, defaulting to 86 400 s (24 h) when not provided. Both `auth-service` and `users-service` read the live value from the `admin_settings` MongoDB collection at startup and refresh it every 60 s via a background task. Admins can update it without a redeploy via the admin Settings tab.

---

### DONE — SEC-1.5 No request body size cap in gateway

**Original severity:** LOW
**Resolved:** 2026-03-23 (T-22)

**File:** `services/gateway/src/main.rs`

Gateway accepted request bodies of arbitrary size, enabling memory exhaustion / slow-request attacks. Fix: `DefaultBodyLimit::max(body_limit_bytes)` layer added to the Axum router. `body_limit_bytes` is seeded from `admin_settings` (`http_body_limit_bytes`, default 65 536 bytes) at startup. Requests exceeding the limit are rejected with `413` before the body is read. This setting requires a gateway restart to take effect (`restartRequired: true`).

---

### DONE — SEC-1.6 `msg_send` shares the general API rate bucket

**Original severity:** LOW
**Resolved:** 2026-03-23 (T-22)

**File:** `services/gateway/src/main.rs`

`POST /api/messages/:id` shared the general `lim_api` rate bucket (120 req / 60 s by default), meaning a user could flood messages up to the general API cap. Fix: a dedicated `lim_msg` `LiveLimiter` (30 req / 60 s by default, `msg_ip_rate_max` / `msg_ip_rate_window_secs` in `admin_settings`) is now applied to `msg_send` in addition to the existing general limiter. Both limiters must pass for the request to proceed.

---

### DONE — SEC-1.7 CWE-918 SSRF — JWT sub interpolated raw into internal service URLs

**Original severity:** MEDIUM
**Resolved:** 2026-03-23

**File:** `services/messages-service/src/main.rs` (previously lines 341, 372)
**Flagged by:** GitHub CodeQL (commit `037735f2`)

`claims.sub` (JWT token subject) was validated with `safe_object_id()` but the raw string — not the validated output — was interpolated directly into internal HTTP URLs. Fix: capture the parsed `ObjectId`, then use `.to_hex()` at every URL interpolation point. URL components now derive from a structured Rust type, not the raw JWT string.

---

### DONE — SEC-1.8 Panic on NaN in location sort (`partial_cmp().unwrap()`)

**Original severity:** MEDIUM
**Resolved:** 2026-03-23

**File:** `services/location-service/src/store.rs` (previously lines 280, 293, 311, 328)

Four `sort_unstable_by` calls used `.partial_cmp().unwrap()` on `f64` distance values. `partial_cmp` returns `None` when either operand is `NaN`, causing an unwrap panic. Fix: replaced all four with `.total_cmp()`, which defines a total order on all `f64` values including `NaN` (NaN sorts last).

---

### DONE — SEC-1.9 Panic on pre-epoch system clock (`SystemTime::unwrap()`)

**Original severity:** LOW
**Resolved:** 2026-03-23

**Files:** `services/common/src/auth.rs` (`now_unix()`), `services/messages-service/src/main.rs` (`now_ms()`), `services/favourites-service/src/main.rs` (range-sync cutoff)

`duration_since(UNIX_EPOCH)` returns `Err` if the system clock is set before 1970-01-01. All three call sites used `.unwrap()`. Fix: replaced with `.unwrap_or_default()` — a clock-before-epoch condition now returns 0 s / 0 ms instead of panicking.

---

## From AUDIT_MAINTAINABILITY.md (2026-03-19)

### DONE — MAINT-2.1 `haversine_distance` duplicated across three Rust services

**Original severity:** LOW
**Resolved:** 2026-03-19 (confirmed in code)

`haversine_distance` is implemented exactly once in `services/common/src/geo.rs` and exported via the `common` crate. `gateway`, `messages-service`, `location-service`, and `favourites-service` are all callers — there are no independent copy-paste implementations. Audit item was already resolved before it was written (the Rust port included the consolidation).

---

### DONE — MAINT-2.2 Core utilities (`verify_token`, `require_service_token`) duplicated across services

**Original severity:** MEDIUM
**Resolved:** 2026-03-19 (confirmed in code)

All token utilities are centralised in `services/common/src/auth.rs` as Axum extractors: `ServiceToken` (replaces `require_service_token`), `AuthToken` (replaces per-service `verify_token`), `RequireRegistered`, `AdminUser`. No per-service re-implementations exist. The duplication described in the audit was eliminated as part of T-04 (Rust port). T-08 Phase 2 (gateway header injection) is still a future improvement but is no longer required to eliminate duplication.

---

## From AUDIT.md (cross-concern items, 2026-03-18)

### DONE — JWT tier claim goes stale after admin tier change

**Resolved:** 2026-03-16 (T-01)

Admin tier/role change now bumps `tokenVersion`. All services reject the old JWT with `TOKEN_REVOKED` on the next request, forcing the user to re-login and receive a token with the updated claim.

---

### DONE — Admin can modify their own tier and role (self-promotion guard missing)

**Resolved:** 2026-03-19

Guard implemented in `services/users-service/src/main.rs`. Both `PATCH /admin/users/:id/tier` and `PATCH /admin/users/:id/role` return `403 SELF_MODIFICATION_FORBIDDEN` when the requesting admin's `sub` matches the target `id`. Guard is env-gated via `SELF_PROMOTION_GUARD=1` in Railway.

---

### DONE — Tier badge in /profile has hard-coded values

**Resolved:** 2026-03-16 (T-03)

`GET /api/tiers/:tier/info` added. Profile badge now fetches label, cls, and nearbyRadiusM dynamically from tiers-service. Also fixed a pre-existing bug where location-service had guest radius at 23,000 m instead of 500 m.

---

### DONE — Port of all /services to Rust

**Resolved:** 2026-03-17 (T-04)

All services ported to Rust. See T-04 in TICKETS_DONE.md. migration-service intentionally remains Node.js.

---

## From AUDIT-20260310-1425.md (archived audit, 2026-03-10)

### DONE — Password change does not verify the current password

**Original severity:** HIGH
**Resolved:** (date unrecorded; confirmed in code)

`services/users-service/src/main.rs` line 322: `currentPassword` is now required and verified with bcrypt before accepting the new password. Returns `400` with an explicit error if missing or incorrect.

---

### DONE — Ghost marker after login (guest location not cleaned up)

**Original severity:** MEDIUM
**Resolved:** (date unrecorded; confirmed in code)

`guestId` is now included in the login POST body in `ui/scripts/api.js` (line 89). The auth-service correctly calls `cleanupGuest` with the guestId on login. Ghost marker no longer persists.

---

### DONE — JWT token in WebSocket URL query string

**Original severity:** LOW
**Resolved:** (date unrecorded; confirmed in code)

`locWsUrl()` in `ui/scripts/app.js` no longer appends the token to the URL. Token is not exposed in server logs or browser history. Authentication happens via the first WS frame only.

---

### DONE — Meeting mode pill (`bbm_meet`) persists in localStorage after logout

**Original severity:** LOW
**Resolved:** (date unrecorded; confirmed in code — and reconfirmed 2026-03-18 as not a bug)

`clearUserStorage()` in `ui/scripts/auth.js` (line 44) calls `localStorage.removeItem('bbm_meet')` on logout. Investigated 2026-03-18 (T-12): `bbm_meet` is the active compass feature key — removing it on logout is intentional correct behaviour.

---

### DONE — `/api/tiers/*` routes missing from gateway

**Original severity:** HIGH (broken feature)
**Resolved:** 2026-03-16 (T-03)

Proxy routes for `/api/tiers/*` added to gateway. `getTierInfo()` and related calls now resolve correctly.

---

### DONE — `currentPassword` sent to server but ignored

**Original severity:** LOW
**Resolved:** same fix as "Password change does not verify current password" above.

---

### DONE — Public key and profile caches never invalidated

**Original severity:** LOW
**Resolved:** (marked resolved in 2026-03-10 audit summary)

`_pubKeyCache` and `_profileCache` in `ui/scripts/messages.js` addressed.

---

### DONE — `buf2b64` uses spread on potentially large ArrayBuffer

**Original severity:** LOW
**Resolved:** (marked resolved in 2026-03-10 audit summary)

`buf2b64` in `ui/scripts/crypto-worker.js` updated to avoid call-stack overflow on large payloads.

---

### DONE — Age validation check is falsy-skipped in profile update

**Original severity:** LOW
**Resolved:** (marked resolved in 2026-03-10 audit summary)

Truthiness check replaced with explicit `!== undefined` guard in users-service. Age 0 no longer bypasses validation.

---

### DONE — Full collection scan for nearby query

**Original severity:** HIGH
**Resolved / accepted:** 2026-03-16 (T-03 + T-04)

Tier radii are now finite (per-tier, DB-stored). Bounded radius + `MAX_VISIBLE_REGISTERED` cap limits scan size. MongoDB geospatial indexes remain unavailable on the free tier — haversine-in-Rust remains the correct approach. Accepted as mitigated at current scale.

---

### DONE — Poll-based WebSocket pushes hit MongoDB on every tick

**Original severity:** MEDIUM
**Resolved / accepted:** (marked resolved in 2026-03-10 audit summary)

All services ported to Rust (T-04). Push architecture unchanged but performance is acceptable at current scale. MongoDB change streams / Redis deferred until scale warrants it.

---

### DONE — TokenVersion DB lookup on every authenticated request

**Original severity:** MEDIUM
**Resolved / accepted:** (marked resolved in 2026-03-10 audit summary)

Accepted as the correct security trade-off for immediate token revocation. Short-lived JWTs (15-minute access tokens) deferred — tokenVersion check is a single indexed read and acceptable at current scale. Revisit if this becomes a bottleneck under load.

---

### DONE — `LOCATION_TTL_SEC` duplicated in favourites-service

**Original severity:** LOW
**Resolved:** (marked resolved in 2026-03-10 audit summary)

Constant consolidated — no longer duplicated with a comment "must match location-service".

---

### DONE — Password-change flow couples three operations without rollback

**Original severity:** LOW
**Resolved:** (marked resolved in 2026-03-10 audit summary)

Rollback path added to the password-change flow in `profile.js` / users-service to prevent the private key blob being encrypted with a new password while the server still holds the old hash.
