# bOOmbOOm.NOW! — Performance Audit

**Last updated:** 2026-03-19
**Concern:** Performance only.

---

## Open Items

### PERF-4.1 Send-rate bucket is in-process — not safe for multi-instance gateway

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**File:** `services/gateway/src/main.rs` (in-memory rate bucket)

The per-user send-rate bucket is stored in-process. If the gateway scales to multiple instances, two connections from the same user on different instances will have separate buckets, doubling the effective send rate. As long as Railway runs a single gateway instance this is fine, but it's worth noting before horizontal scaling.

**Context:** Redis is not currently available. Adding Redis is planned when the app scales, at which point the bucket can be migrated to a shared store (e.g. Redis `INCR` with a TTL key).

**Priority:** LOW (deferred until horizontal scaling).

---

### PERF-4.2 Notification poll scales linearly with active users

**File:** `ui/scripts/app.js` (NotifModule), `services/favourites-service/src/main.rs`

Each logged-in user polls `GET /api/notifications` every **2 minutes** (`POLL_INTERVAL_MS = 2 * 60 * 1000`). Negligible at current scale (< 1,000 concurrent). At larger scale, push delivery via the existing message WebSocket would be more efficient.

**Priority:** LOW (acceptable for now, revisit before scaling push).

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| ⏸️ | PERF-4.1 | LOW | Send-rate bucket in-process — not safe for multi-instance gateway (deferred) |
| 🔲 | PERF-4.2 | LOW | Notification poll scales linearly with active users |

Resolved items → AUDIT_DONE.md
