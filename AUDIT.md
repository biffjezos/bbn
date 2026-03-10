# bOOmbOOm.NOW! — Code & Security Audit

**Date:** 2026-03-10
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)
**Note:** Carries forward postponed items from AUDIT-20260310-1425.md

---

## Executive Summary

---

## 1. Security Bugs

---

## 2. Non-Security Bugs

### 2.1 `haversineDistance` duplicated across three files

**Files:** `services/server.js`, `services/messages-service.js`, `services/location-service.js`

Three independent copy-paste implementations of the same function. If a precision bug is found, all three need patching. `services/lib/geo.js` exists but is not imported by the services that need it.

**Context:** A shared internal library is not currently possible (no private package registry, no monorepo tooling). Each service is intentionally self-contained. Consolidation is deferred until the infrastructure to support a shared lib is in place. MongoDB geospatial indexes are also unavailable (free tier RAM limits + migration 002 failure), so haversine-in-JS is the correct approach for distance filtering regardless.

---

## 3. Performance

### 3.1 Send-rate bucket is in-process — not safe for multi-instance gateway

**File:** `services/server.js` (in-memory `_wsSendCounts`)

The per-user send-rate bucket is stored in-process:

```js
const _wsSendCounts = new Map(); // userId -> { count, connections, timer }
```

If the gateway scales to multiple instances, two connections from the same user on different instances will have separate buckets, doubling the effective send rate. As long as Railway runs a single gateway instance this is fine, but it's worth noting before horizontal scaling.

**Context:** Redis is not currently available. Adding Redis is planned when the app scales, at which point the bucket can be migrated to a shared store (e.g. Redis `INCR` with a TTL key).

---

## 4. Usability

---

## 5. Maintainability

### 5.1 Core utilities duplicated across all services

**Files:** All services

The following utilities are copy-pasted across 3–4 files each:

**Note:** All duplication is intentional at this stage. A shared internal library is not currently possible (no private package registry, no monorepo tooling). Each service is intentionally self-contained. Consolidation is deferred until the infrastructure to support a shared lib is in place.

| Utility | Duplicated in |
|---|---|
| `verifyToken` | auth, users, messages, location, favourites — intentional copy per service |
| `requireServiceToken` | all 6 services — intentional copy per service |
| `serviceToken` (caching) | server.js, messages-service.js — intentional copy per service |
| `haversineDistance` | server.js, messages-service.js, location-service.js — intentional: MongoDB geospatial indexes unavailable (free tier RAM + migration 002 failure), distance filtering must run in JS per service; deferred with 2.1 |
| `safeObjectId` | users, messages, favourites — intentional copy per service |
| `issueUserToken` | auth-service.js, users-service.js — intentional copy per service |

If the JWT payload structure changes (e.g., adding a field), every `issueUserToken` and `verifyToken` in every service must be updated. This is a recurring maintenance risk.

### 5.2 `app.js` mixes three distinct module concerns

**File:** `ui/scripts/app.js`

The file contains the main app shell, `GeoModule`, and `LockModule` — three concerns with distinct lifecycles. Each wraps itself in an IIFE, which helps, but a 718-line file that must be loaded on every page adds cognitive overhead. As the app grows, splitting into separate files (which Jekyll already supports via `extra_js`) would improve navigation and testability.

---

## 6. Summary Table

| Status | # | Area | Severity | Finding |
|---|---|---|---|---|
| 🔲 | 2.1 | Bug | LOW | haversineDistance copy-pasted in 3 files (divergence risk) |
| 🔲 | 3.1 | Performance | LOW | Send-rate bucket is in-process — not safe for multi-instance gateway |
| 🔲 | 5.1 | Maintainability | MEDIUM | Core utilities (verifyToken, issueUserToken, haversine) duplicated across all services |
| 🔲 | 5.2 | Maintainability | LOW | app.js mixes three distinct module concerns |
