# bOOmbOOm.NOW! — Technical Audit Log

**This file is for Claude only.** It contains unresolved technical findings:
security bugs, performance issues, architectural debt, and deferred decisions.
Feature requests and roadmap items live in `TICKETS.md`.

Last full audit: 2026-03-10 (9 backend services, 9 frontend scripts)
Carries forward items from AUDIT-20260310-1425.md

---

## 1. Security

### 1.1 Gateway send-rate limit bypassable at messages-service level

**File:** `services/server.js` (`_wsSendCounts`), `services/messages-service.js`

The per-user send rate (10 msg / 10 s) is enforced only at the WebSocket layer in
the gateway. The messages-service HTTP endpoint has no independent rate limit.
A client that opens multiple tabs, or an attacker with a valid JWT hitting the
HTTP endpoint directly, can exceed the per-user budget. The messages-service
must add its own per-userId rate check (in-memory is fine for single-instance).

**Priority:** Medium — actual spam risk before blocking/reporting is built.

---

### 1.2 JWT tier claim goes stale after admin tier change (future risk)

**Files:** `services/server.js` (`checkTier`), `services/auth-service.js`

The `tier` claim is baked into the JWT at login. `checkTier` in the gateway
reads the tier from the token payload, not from the DB. When the planned admin
tier-change feature (T-01) is built, changing a user's tier in the DB will have
no effect until their token expires (TTL dependent). Must be resolved before
the admin tier-change endpoint goes live. Options:
- (a) `checkTier` fetches tier from DB on every request (adds latency + DB load).
- (b) Short JWT TTL with silent refresh (already worth doing for other reasons).
- (c) A token-version bump (same pattern as `tokenVersion` used for password changes) — this is the cleanest fit with existing architecture.

**Priority:** Low now, blocks T-01 when built.

---

## 2. Non-Security Bugs

### 2.1 `haversineDistance` duplicated across three files

**Files:** `services/server.js`, `services/messages-service.js`, `services/location-service.js`

Three independent copy-paste implementations. If a precision bug is found, all
three need patching. `services/lib/geo.js` exists but is unused.

**Context:** Shared internal library not possible yet (no monorepo tooling, no
private registry). MongoDB geospatial indexes also unavailable (free-tier RAM +
migration 002 failure), so haversine-in-JS is correct regardless. Deferred
until infrastructure supports a shared lib. See T-04 (Rust port) — this becomes
a non-issue if the service is rewritten.

---

## 3. Performance

### 3.1 In-process send-rate bucket — not safe for multi-instance gateway

**File:** `services/server.js` (`_wsSendCounts`)

Bucket is in-process. Two connections from the same user on different instances
have separate budgets. Safe while Railway runs a single gateway instance.

**Context:** Redis not available. Migrate to Redis `INCR + TTL` when scaling.
Documented prerequisite for horizontal gateway scaling.

---

### 3.2 Notification poll adds one HTTP request per active user per 30 s

**File:** `ui/scripts/app.js` (NotifModule), `services/favourites-service.js`

Each logged-in user polls `GET /api/notifications` every 30 s. At small scale
(< 1 000 concurrent) this is negligible. At larger scale, push delivery
(WebSocket or SSE) would be more efficient. Acceptable for current load.

---

## 4. Maintainability

### 4.1 Core utilities duplicated across all services

**Files:** All services

| Utility | Duplicated in |
|---|---|
| `verifyToken` | auth, users, messages, location, favourites |
| `requireServiceToken` | all 6 services |
| `serviceToken` (caching) | server.js, messages-service.js |
| `haversineDistance` | server.js, messages-service.js, location-service.js |
| `safeObjectId` | users, messages, favourites |
| `issueUserToken` | auth-service.js, users-service.js |

All intentional at this stage — no monorepo tooling. If the JWT payload
structure changes, every `issueUserToken` and `verifyToken` copy must be
updated. Recurring risk. Resolved naturally as services are ported to Rust (T-04).

---

### 4.2 `app.js` mixes three distinct module concerns

**File:** `ui/scripts/app.js`

Main shell + GeoModule + LockModule + NotifModule in one file (~800 lines).
Each is wrapped in an IIFE, which helps. Low priority; split via Jekyll
`extra_js` when the file becomes unwieldy.

---

## 5. Summary Table

| Status | # | Area | Severity | Finding |
|---|---|---|---|---|
| 🔲 | 1.1 | Security | MEDIUM | Gateway send-rate bypassable at messages-service level |
| 🔲 | 1.2 | Security | LOW (future) | JWT tier claim stale after admin tier change |
| 🔲 | 2.1 | Bug | LOW | haversineDistance copy-pasted in 3 files |
| 🔲 | 3.1 | Performance | LOW | In-process send-rate bucket not safe for multi-instance |
| 🔲 | 3.2 | Performance | LOW | Notification poll scales linearly with active users |
| 🔲 | 4.1 | Maintainability | MEDIUM | Core utilities duplicated across all services |
| 🔲 | 4.2 | Maintainability | LOW | app.js mixes four module concerns |
