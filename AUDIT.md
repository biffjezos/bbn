# bOOmbOOm.NOW! — Codebase Audit
**Date:** 2026-03-09
**Scope:** `/services/` — all microservices and gateway

---

## SECURITY

### S2. ✅ FIXED — Any authenticated user can look up any other user's precise location by ID
**File:** `services/location-service.js` (line 224)

`GET /location/user/:userId` is used internally by messages-service to enforce proximity, but it is protected only by a service token — not a user token. The gateway does not expose this route directly, so it is not reachable from the public internet. However, any compromised internal service can call it to pinpoint any user.

**Fix:** Add an `Authorization` header check in addition to the service token check, or restrict calls to messages-service only (e.g. verify `payload.sub === 'messages'`).

---

### S3. ✅ FIXED — WS send rate limit is per-connection, not per-user
**File:** `services/server.js` (line 363)

`sendCount` is a closure variable per WebSocket connection. A user with two browser tabs open gets 2× the send budget. The limit is easy to bypass without any coordination.

**Fix:** Move rate-limit state to a shared `Map<userId, count>` keyed by `userId` so all connections for the same account share one bucket.

---

## PERFORMANCE

### P1. ⏸ POSTPONED — Location nearby fetches all active users globally
**File:** `services/location-service.js` (line 192)

The 2dsphere index is created by migrations but the nearby query is a plain `find()` with no geospatial filter:

```js
const nearby = await db.collection('locations').find({
  userId:    { $ne: callerId },
  updatedAt: { $gt: cutoff },
}).toArray();
```

All active location records are loaded into Node.js memory and distance is computed in JS. At scale this is O(all users) per query, executed every 5 seconds per connected client.

**Fix:** Re-introduce the `$nearSphere` / `$geoWithin` filter to let MongoDB do the radius scan using the 2dsphere index, passing a sensible `maxDistance` (e.g. from the tiers service radius config).
**Postponed:** Moving distance filtering from haversine JS to MongoDB geospatial queries is not feasible at the moment.

---

### P2. ⏸ POSTPONED — Polling instead of push (WS intervals)
**File:** `services/server.js` (location WS line 253, message WS lines 360, 377)

The server runs `setInterval` per connected client: location every 5 s, conversation list every 3 s, message thread every 2 s. With N clients that's N × 3 live timers, each doing a service fetch regardless of whether anything changed. The hash-comparison optimisation avoids unnecessary WS frames but not the upstream service calls.

**Fix:** Use MongoDB change streams or a lightweight pub/sub (e.g. Redis) to push on change. Fall back to longer polling intervals (15–30 s) until then.
**Postponed:** Requires infrastructure changes (change streams or pub/sub layer). Partially mitigated by the 5m movement threshold that suppresses redundant location forwards when users are stationary.

---

### P3. ⏸ POSTPONED — No MongoDB connection pool config
**Files:** all services

`MongoClient` is created with default settings. The Node.js driver default pool size is 5; under load this serialises DB queries.

**Fix:** Pass `{ maxPoolSize: 20 }` (tune per service load profile) to `MongoClient`.
**Postponed:** Not an issue at current traffic levels. Revisit if query queuing becomes observable under load.

---

## MAINTAINABILITY

### M1. ⏸ POSTPONED — `requireServiceToken` copy-pasted into every service
**Files:** `auth-service.js`, `users-service.js`, `location-service.js`, `messages-service.js`, `favourites-service.js`, `tiers-service.js`, `migration-service.js`

Identical 10-line function in every file. A bug fix or security change must be applied 7 times.

**Fix:** Extract to `services/lib/serviceAuth.js` and import it.
**Postponed:** Requires a shared lib — not feasible while each service must be self-contained on Railway.

---

### M2. ⏸ POSTPONED — `haversineDistance` inlined in two services
**Files:** `services/location-service.js` (line 34), `services/messages-service.js` (line 30)

`services/lib/geo.js` exists but is not used. Both services carry an identical copy of the function.

**Fix:** Import from `./lib/geo.js` in both services and delete the inlined copies.
**Postponed:** Requires a shared lib — not feasible while each service must be self-contained on Railway.

---

### M3. ⏸ POSTPONED — `safeObjectId` duplicated across three services
**Files:** `users-service.js`, `messages-service.js`, `favourites-service.js`

**Fix:** Move to `services/lib/db.js` alongside a shared MongoClient factory (which would also solve P3).
**Postponed:** Requires a shared lib — not feasible while each service must be self-contained on Railway.

---

### M4. ⏸ POSTPONED — `verifyToken` implementations diverge across services
Each service implements its own `verifyToken` with subtle differences (tokenVersion check: yes in users/messages, no in location/favourites; `requireRegistered` flag: present in users/location, absent in messages/favourites). This makes it hard to reason about auth correctness globally and caused S1 above.

**Fix:** Extract a single `makeVerifyToken(db, jwtSecret, options)` factory to a shared lib.
**Postponed:** Requires a shared lib — not feasible while each service must be self-contained on Railway. The concrete divergence issue (tokenVersion gap) is tracked separately as S1.

---

### M5. ⏸ POSTPONED — No shared request validation
Each service hand-rolls its own field checks. A schema library (e.g. `zod`) would reduce boilerplate and standardise error shapes.
**Postponed:** Requires a shared lib — not feasible while each service must be self-contained on Railway.

---

### U3. ⏸ POSTPONED — No API versioning
All routes are `/api/*` with no version prefix. Any breaking change requires a coordinated frontend deploy.

**Fix:** Prefix routes `/api/v1/*` and document a deprecation policy.
**Postponed:** Too much churn during active development; revisit when API surface stabilises.

---

## SUMMARY

| Area | Grade | Key issues |
|---|---|---|
| Security | B+ | Shared lib gap means verifyToken must be kept in sync manually |
| Performance | C+ | All-users nearby query O(N) on every WS tick, N×3 polling timers per client |
| Maintainability | C+ | 7× copy-pasted service auth, haversine and ObjectId helpers duplicated |
| Usability | A- | Error codes added; tier-gate CTA global; age now consistent end-to-end |

### Fixed since last audit
- Tier enforcement at gateway (`checkTier` middleware) ✅
- Service token caching in gateway and messages-service ✅
- Plaintext message storage — E2EE envelope validated at API boundary ✅
- Location TOCTOU race — atomic time-gated `updateOne` ✅
- HTTP keep-alive between gateway and internal services (undici Agent) ✅
- CORS origin list consolidated to single `ALLOWED_ORIGINS` constant ✅
- Guest → registered account transition preserves location (`migrateGuestLocation`) ✅
- WebSocket disconnect reason codes (`ws.close(4001, …)`) ✅
- Aggregated health endpoint (`GET /api/health`) ✅
- Nickname maximum length enforced (32 chars) ✅
- `DELETE /messages/:id` returns 403 instead of misleading 404 ✅
- S1: Token revocation enforced in all services; legacy users without `tokenVersion` field no longer falsely rejected ✅
- S4: `favourites-service` DB_NAME default corrected to `'boomboom'` ✅
- P4: Dynamic `bcryptjs` import hoisted to top-level ✅
- M6: Migration service is sole index authority ✅
- U1: Tier-gate CTA shown globally via modal on any 403 with `required` field ✅
- U2: Machine-readable `code` field added to all auth error responses (`TOKEN_REVOKED`, `TOKEN_INVALID`, `NO_TOKEN`, `REGISTERED_REQUIRED`); frontend auto-logouts on revoked/invalid token ✅
- U4: `age` now included in JWT payload, stored in location documents, returned in nearby response — consistent everywhere ✅
- Minor: `apiFetch` now has a 10 s timeout and auto-retries once on network errors or 5xx (sleeping services) ✅
