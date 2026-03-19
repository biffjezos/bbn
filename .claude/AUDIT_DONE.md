# bOOmbOOm.NOW! — Resolved Audit Items

All resolved audit findings, regardless of concern category.
Items moved here from AUDIT.md, AUDIT_SECURITY.md, and AUDIT_PERFORMANCE.md when confirmed fixed or accepted.

---

## From AUDIT.md (maintainability, 2026-03-19)

### DONE — 2.1 `haversine_distance` duplicated across three Rust services

**Original severity:** LOW
**Resolved:** 2026-03-19 (confirmed in code)

`haversine_distance` is implemented exactly once in `services/common/src/geo.rs` and exported via the `common` crate. `gateway`, `messages-service`, `location-service`, and `favourites-service` are all callers — there are no independent copy-paste implementations. Audit item was already resolved before it was written (the Rust port included the consolidation).

---

### DONE — 2.2 Core utilities (`verify_token`, `require_service_token`) duplicated across services

**Original severity:** MEDIUM
**Resolved:** 2026-03-19 (confirmed in code)

All token utilities are centralised in `services/common/src/auth.rs` as Axum extractors: `ServiceToken` (replaces `require_service_token`), `AuthToken` (replaces per-service `verify_token`), `RequireRegistered`, `AdminUser`. No per-service re-implementations exist. The duplication described in the audit was eliminated as part of T-04 (Rust port). T-08 Phase 2 (gateway header injection) is still a future improvement but is no longer required to eliminate duplication.

---

## From AUDIT.md (active audit, 2026-03-18)

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
