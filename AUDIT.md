# bOOmbOOm.NOW! — Codebase Audit
**Date:** 2026-03-09
**Scope:** `/services/` — all microservices and gateway

---

## SECURITY

### S1. ✅ FIXED — Token revocation not enforced in location-service and favourites-service
**Files:** `services/location-service.js` (line 94), `services/favourites-service.js` (line 58)

`users-service` and `messages-service` check `tokenVersion` against the DB to honour password-change revocation. `location-service` and `favourites-service` do not — a user who changed their password can still push location updates and read/modify favourites with their old token until it expires (up to 7 days).

**Fix:** Add the same `tokenVersion` DB check that `users-service.js` uses to `verifyToken` in both services.

---

### S2. ✅ FIXED — Any authenticated user can look up any other user's precise location by ID
**File:** `services/location-service.js` (line 224)

`GET /location/user/:userId` is used internally by messages-service to enforce proximity, but it is protected only by a service token — not a user token. The gateway does not expose this route directly, so it is not reachable from the public internet. However, any compromised internal service can call it to pinpoint any user.

**Fix:** Add an `Authorization` header check in addition to the service token check, or restrict calls to messages-service only (e.g. verify `payload.sub === 'messages'`).

---

### S3. MEDIUM — WS send rate limit is per-connection, not per-user
**File:** `services/server.js` (line 363)

`sendCount` is a closure variable per WebSocket connection. A user with two browser tabs open gets 2× the send budget. The limit is easy to bypass without any coordination.

**Fix:** Move rate-limit state to a shared `Map<userId, count>` keyed by `userId` so all connections for the same account share one bucket.

---

### S4. LOW — `favourites-service` defaults DB_NAME to `'test'`
**File:** `services/favourites-service.js` (line 12)

```js
DB_NAME: process.env.DB_NAME || 'test',
```

Every other service defaults to `'boomboom'`. If `DB_NAME` is not set in the environment, favourites reads and writes to a different database than the rest of the platform — silently producing empty results or orphaned data.

**Fix:** Change the default to `'boomboom'` to match all other services.

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

### P2. HIGH — Polling instead of push (WS intervals)
**File:** `services/server.js` (location WS line 253, message WS lines 360, 377)

The server runs `setInterval` per connected client: location every 5 s, conversation list every 3 s, message thread every 2 s. With N clients that's N × 3 live timers, each doing a service fetch regardless of whether anything changed. The hash-comparison optimisation avoids unnecessary WS frames but not the upstream service calls.

**Fix:** Use MongoDB change streams or a lightweight pub/sub (e.g. Redis) to push on change. Fall back to longer polling intervals (15–30 s) until then.

---

### P3. MEDIUM — No MongoDB connection pool config
**Files:** all services

`MongoClient` is created with default settings. The Node.js driver default pool size is 5; under load this serialises DB queries.

**Fix:** Pass `{ maxPoolSize: 20 }` (tune per service load profile) to `MongoClient`.

---

### P4. LOW — Dynamic `bcryptjs` import inside route handler
**File:** `services/users-service.js` (line 141)

```js
const bcrypt = await import('bcryptjs');
```

The module cache warms after the first call so this has no runtime cost after that, but it is a misleading pattern that could cause confusion or be copied incorrectly.

**Fix:** Hoist to a top-level static import.

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

### M6. LOW — Migration service creates indexes that services also create at boot
**Files:** `migration-service.js`, `messages-service.js` (line 43), `favourites-service.js` (line 27)

Both `messages-service` and `favourites-service` call `createIndex` during startup. The same indexes are also created by migration `001_indexes`. This is harmless (MongoDB is idempotent on `createIndex`) but confusing — it is unclear which definition is authoritative.

**Fix:** Remove the inline `createIndex` calls from the service files and rely on migrations as the sole index authority.

---

## USABILITY

### U1. MEDIUM — Favourites is premium-only but there is no UI path to upgrade
**File:** `services/tiers-service.js` (line 67)

`manage_favourites` requires `premium` tier. A `regular` user hitting `/api/favourites` gets a 403. If the UI doesn't gate the Favourites page based on tier, users will see a loading spinner or an unexplained error instead of a clear upgrade prompt.

**Fix:** Return the user's `tier` from the gateway tier-check 403 response (already done) and ensure the frontend reads it to show an upgrade CTA instead of an infinite loader.

---

### U2. LOW — No client-visible error codes
All error responses are free-text strings: `{ error: "Internal error." }`. Clients must string-match to handle specific cases, which is fragile across locales and refactors.

**Fix:** Add a machine-readable `code` field: `{ error: "…", code: "TOKEN_REVOKED" }`.

---

### U3. LOW — No API versioning
All routes are `/api/*` with no version prefix. Any breaking change requires a coordinated frontend deploy.

**Fix:** Prefix routes `/api/v1/*` and document a deprecation policy.

---

### U4. LOW — `age` is stored and validated but has no product use
**File:** `services/auth-service.js` (line 140), `services/users-service.js` (line 213)

`age` is accepted on registration and returned in public profiles. No route filters by age and the value is not displayed anywhere in documented UI flows. This is unnecessary PII storage.

**Fix:** Remove `age` from the data model, or document exactly where and how it will be used.

---

## SUMMARY

| Area | Grade | Key issues |
|---|---|---|
| Security | B | Token revocation gap in 2 services, per-connection rate limit, wrong DB default |
| Performance | C+ | All-users nearby query O(N) on every WS tick, N×3 polling timers per client |
| Maintainability | C+ | 7× copy-pasted service auth, haversine and ObjectId helpers duplicated |
| Usability | B | No upgrade CTA for premium features, no error codes, no API versioning |

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
