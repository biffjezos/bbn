# bOOmbOOm.NOW! — Codebase Audit
**Date:** 2026-03-09
**Scope:** `/services/` — all microservices and gateway

---

## NEXT SESSION: Security Issues 5–8

> Copy-pasted from the security audit for tomorrow's work.

### 5. HIGH — Tier system not enforced in Gateway
**File:** `services/server.js`
Routes proxy directly to services without calling `/tiers/check`, so a guest or regular user can attempt any action and only gets rejected deep in the service layer.

```js
// Current — no tier check before proxying
app.post('/api/messages/:userId', (req, res) =>
  proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.userId}`)
);
```

**Fix:** Add a gateway middleware that calls `tiers-service /tiers/check` before forwarding, so unauthorized requests are rejected early and tier logic is centralised.

---

### 6. MEDIUM — Service token regenerated on every request
**File:** `services/server.js` (`proxy()`) and `services/messages-service.js`
`serviceToken()` calls `jwt.sign()` on every proxied request — JWT signing is CPU-bound.

```js
headers: {
  'X-Service-Token': serviceToken(),  // new token per request
}
```

**Fix:** Cache the token and only regenerate when it's about to expire:
```js
let _svcToken = null, _svcExpiry = 0;
function serviceToken() {
  if (Date.now() < _svcExpiry - 5000) return _svcToken;
  _svcToken = jwt.sign({ sub: 'gateway', role: 'service' }, CFG.JWT_SECRET, { expiresIn: '60s' });
  _svcExpiry = Date.now() + 60_000;
  return _svcToken;
}
```

---

### 7. MEDIUM — Messages stored as plaintext on server
**File:** `services/messages-service.js`
`text` is inserted verbatim into MongoDB. A compromised database, a DBA, or a snapshot exposes all message content.

```js
await db.collection('messages').insertOne({
  fromUserId, toUserId,
  text: text.trim(),   // plaintext
  sentAt: now, expiresAt,
});
```

**Fix:** Require clients to encrypt before sending (E2EE enforced at API boundary). The server should reject any message where `text` is not a valid ciphertext envelope, or add server-side AES-256-GCM encryption at rest as a second layer.

---

### 8. MEDIUM — Race condition on location update (TOCTOU)
**File:** `services/location-service.js`
A read (`findOne`) is followed by a conditional write (`updateOne`). A second concurrent request can slip between the two, causing both to write or both to skip.

```js
const existing = await db.collection('locations').findOne({ userId: id });
if (existing && !shouldUpdate(existing, { lat, lon }))
  return res.json({ ok: true, skipped: true });
// ← another request can arrive here
await db.collection('locations').updateOne({ userId: id }, { $set: { … } }, { upsert: true });
```

**Fix:** Use a single atomic `findOneAndUpdate` with `$set` and version-guard, or push the `shouldUpdate` logic into the MongoDB query filter so the write only happens when the condition is true server-side.

---

---

## PERFORMANCE AUDIT

### P1 — Polling instead of push (WS intervals)
**Files:** `server.js` (location WS, messages WS)
The server runs `setInterval` per connected client: location every 5 s, message thread every 2 s, conversation list every 3 s. With N connected clients that's N × 3 live intervals, each doing a fetch to an internal service.

- **Impact:** At 100 concurrent users: ~300 inflight fetches/s to internal services at all times, regardless of whether data changed.
- **Fix:** Push on change (use MongoDB change streams or an event bus). Fall back to longer polling intervals (10–30 s) until then.

### P2 — No DB connection pooling config
**Files:** all services
`MongoClient` is created with default settings. Default pool size is 5 in the Node.js driver; under load this serialises queries.

- **Fix:** Pass `{ maxPoolSize: 20 }` (tune per service) to `MongoClient`.

### P3 — Geospatial query on every WS tick
**File:** `services/location-service.js` (`GET /location/nearby`)
A `$nearSphere` query runs every 5 s per connected client. These are index-scanned but still O(nearby users) per tick.

- **Fix:** Cache results per cell with a short TTL (e.g. 3 s). Only invalidate when a user in that cell moves.

### P4 — Service token signing on hot path (see Security #6 above)
Already documented; the CPU cost also affects latency under load.

### P5 — No HTTP keep-alive between gateway and internal services
**File:** `services/server.js` (`proxy()`)
`fetch()` without a custom `Agent` creates a new TCP connection per request.

- **Fix:** Create a shared `undici.Agent` or Node.js `http.Agent` with `keepAlive: true` and reuse it across all `fetch()` calls.

### P6 — `import bcryptjs` inside route handler
**File:** `services/users-service.js`
```js
const bcrypt = await import('bcryptjs');  // dynamic import inside handler
```
This works but the module cache is warm after the first call. It's a minor anti-pattern; hoist to a top-level static import.

---

## USABILITY / DX AUDIT

### U1 — No client-visible error codes
All error responses are free-text strings: `{ error: "Internal error." }`. Clients must string-match to handle specific cases, which is fragile.

- **Fix:** Add a machine-readable `code` field: `{ error: "…", code: "USER_NOT_FOUND" }`.

### U2 — No API versioning
All routes are `/api/*` with no version prefix. Any breaking change requires coordinated frontend deploy.

- **Fix:** Prefix routes `/api/v1/*` and document a deprecation policy.

### U3 — Guest → registered account transition is destructive
On registration the guest's location is immediately deleted. If the user was mid-browse they lose context.

- **Fix:** Keep the location record and re-associate it with the new `userId` rather than deleting it.

### U4 — WebSocket disconnect is silent to client
When the server destroys a WS connection (auth failure, wrong origin) the client receives a bare `1006 Abnormal Closure` with no reason code.

- **Fix:** Send a `close` frame with a reason before destroying:
  `socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')` or use `ws.close(4001, 'auth_failed')`.

### U5 — No health/status endpoint aggregation
Each service exposes `GET /health` but there is no single endpoint that aggregates all service health for ops dashboards.

- **Fix:** Add `GET /api/health` to the gateway that fans out to all internal `/health` endpoints and returns a combined summary.

### U6 — Nickname has no maximum length
**File:** `services/auth-service.js`
Minimum length (2) is enforced but there is no upper bound. A 10 000-character nickname would be stored and returned to every nearby user.

- **Fix:** Add `nickname.length <= 32` (or similar) check.

### U7 — Age is validated but never used
`age` is stored and validated (18–120) on registration but no route filters by age, and it is not returned in public profiles. If it is not needed, remove it to reduce PII exposure. If it is needed, document where it will be used.

### U8 — Messages `DELETE` only works on own messages, but error is generic
**File:** `services/messages-service.js`
If user A tries to delete user B's message they get `404` (because the query adds `fromUserId` to the filter). A `403 Forbidden` would be more accurate and less confusing.

---

## MAINTAINABILITY / CODE QUALITY

### M1 — Haversine duplicated
Identical function in `location-service.js` and `messages-service.js`. Move to `services/lib/geo.js`.

### M2 — CORS origin list duplicated
HTTP CORS and WS origin check are separate hardcoded arrays. Move to a single `ALLOWED_ORIGINS` constant or env var (see Security #10 in full audit).

### M3 — No shared request validation
Each service hand-rolls its own validation. A single schema validation middleware (e.g. with `zod`) would reduce boilerplate and standardise error messages.

### M4 — Inconsistent ObjectId handling
Some services use `new ObjectId(id)` with a try-catch, others pass the raw string. Standardise on a helper: `safeObjectId(str)` → `ObjectId | null`.

### M5 — Migration service embedded in server startup
`server.js` blocks startup while waiting for `migration-service` to respond. If migrations are slow or the service is down, the gateway never starts.

- **Fix:** Run migrations as a one-shot init container in Docker Compose / Railway, separate from the gateway process.

---

## SUMMARY

| Area | Grade | Key blocker |
|---|---|---|
| Security | C+ | JWT in URL, proximity disabled, tiers unenforced |
| Performance | B- | Per-client polling intervals, no connection reuse |
| Usability | B | Silent WS errors, no error codes, no API versioning |
| Maintainability | B- | Duplicated code, no shared validation, no structured logging |

**Tomorrow's focus (Security 5–8):** tier enforcement at gateway, service token caching, plaintext message storage, location race condition.
