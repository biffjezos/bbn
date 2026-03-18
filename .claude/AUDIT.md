# bOOmbOOm.NOW! — Code & Security Audit

**Date:** 2026-03-18 (last updated)
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)
**Note:** Carries forward postponed items from AUDIT-20260310-1425.md

---

## Executive Summary

---

## 1. Security Bugs

### 1.1 Plain password in a POST request

***Note:*** added by project owner (12 March 2026)

```json
[API] → POST https://boom.up.railway.app/api/auth/login
{
    email: ' {plain email address}',
    password: '{plain password}',
    guestId: '{guest id}'
}

//found /ui/scripts/api.js

login({ email, password, guestId }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, guestId }),
    });
  },
```

Why is that? Hash the email address and password right in the client. The app doesn't have any purpose for a plain text eMail address. Find the issue. Show me the concrete code snippet. If `/services` encrypt or hash data a second time, that's ok. I do not want any unencrypted/unhashed communication between server and clients (later also encrypt location data). Look into SRP or even better OPAQUE / PAKE to solve this. Include items 6.* before contemplating about this ticket. Could we implement OPAQUE if we would port the auth-service to rust as a test run?

On account creation the eMail should be hashed, just like the password, sent and stored in the db.

The eMail address and password should always be hashed right after it was added into the text field (of the account creation, login-modal).

**Sequencing decision (2026-03-16):** OPAQUE is deferred until `auth-service` is
ported to Rust (T-04b). `opaque-ke` (Rust) is production-ready; no equivalent
exists for JS. Implementing OPAQUE in JS now would require a full re-implementation
once the Rust port lands. T-04a (tiers-service) establishes the Rust infra first;
T-04b (auth-service + OPAQUE) follows and unblocks this ticket and T-05b (block
note encryption). This ticket remains HIGH priority but is intentionally blocked
on T-04b.

---

### 1.2 Gateway send-rate limit bypassable at messages-service level

**File:** `services/gateway/src/main.rs` (`_wsSendCounts`), `services/messages-service/src/main.rs`

The per-user send rate (10 msg / 10 s) is enforced only at the WebSocket layer
in the gateway. The messages-service HTTP endpoint has no independent rate
limit. A client with a valid JWT hitting the HTTP endpoint directly (or via
multiple tabs) can exceed the per-user budget. messages-service needs its own
per-userId in-memory rate check.

**Priority:** Medium — T-05 (blocking) is now live which reduces abuse risk, but the HTTP bypass remains.

---

### 1.4 Admin can modify their own tier and role (self-promotion guard missing)

**Date:** 2026-03-16
**Files:** `services/users-service/src/main.rs` (`PATCH /admin/users/:id/tier`, `PATCH /admin/users/:id/role`)

No server-side check prevents an admin from using the admin API to change their own tier or role. A rogue or compromised admin account could self-promote without a second approval. The fix is one line per handler: if `targetId === req.auth.sub`, reject with 403.

Full per-role permission scoping (e.g. only allow tier assignments within a permitted range) requires T-09. The minimal standalone guard can be applied without T-09.

**Priority:** LOW — requires a compromised or rogue admin account; no external attack vector. Also documented in T-09 as a standalone prerequisite patch.

---

### 1.3 JWT tier claim goes stale after admin tier change

✅ **Resolved (2026-03-16, T-01):** Admin tier/role change bumps `tokenVersion`.
All services reject the old JWT with `TOKEN_REVOKED` on the next request,
forcing the user to re-login and receive a token with the updated claim.

---

## 2. Infrastructure

### 2.1 migration-service ported to Rust — Railway deployment needs verification

**Date:** 2026-03-17 (updated 2026-03-17)
**Files:** `services/migration-service/src/main.rs` (Rust port),
`services/gateway/src/main.rs` (calls `MIGRATION_SERVICE_URL` on boot)

The original `migration-service.js` was removed and a Rust port was created at
`services/migration-service/src/main.rs` (workspace member, compiles correctly).
T-04c noted migration-service stays Node.js — the Rust port went ahead anyway.
Project owner reports service "doesn't work". Likely cause: Railway service root
directory for migration-service must be `services/` (workspace root, where
`Cargo.toml` is), **not** `services/migration-service/`. Build command:
`cargo build --release --bin migration-service`. Start command:
`./target/release/migration-service`.

**Consequences if not running:**
- MongoDB TTL indexes for `messages` and `locations` not applied — expired data
  not auto-purged at DB level (privacy regression).
- Migration `003_blocks_indexes` not enforced — duplicate block entries possible.
- Migrations `004_tiers_seed` / `005_rename_developer_tier` not applied.

**Priority:** HIGH — privacy regression in a privacy-by-design app.

---

### 2.0 MongoDB disk space — migration 003 not applied

**Date:** 2026-03-16

Railway MongoDB volume has ~221 MB free; WiredTiger requires ≥ 500 MB for write
operations. Migration `003_blocks_indexes` cannot apply. Retries on every gateway
boot with the same failure.

**Current impact:**
- `blocks` collection has no unique index on `{ blockerUserId, blockedUserId }` —
  duplicate block documents can be inserted.
- No index on `{ blockedUserId }` — block lookups in location/messages/users
  services do full collection scans. Negligible at dev-alpha scale.

**Acceptable for now:** app is in dev-alpha, no real users at risk.

**Resolution:** Upgrade the Railway MongoDB plan. Do this after T-04 (Rust port)
is complete — see TICKETS.md T-04 reminder. Migration 003 will apply automatically
on the next gateway boot after disk space is freed.

---

### 2.2 Sessions TTL index must be dropped and recreated after guest-TTL change

**Date:** 2026-03-18
**File:** MongoDB `sessions` collection

Guest session TTL was corrected from 2 h to 20 min (2026-03-18). The TTL index on `sessions.createdAt` still carries the old `expireAfterSeconds: 7200` value — MongoDB silently ignores `createIndex()` when an index with the same key pattern already exists, so the new value (1200 s) will not take effect until the old index is dropped.

**One-time action required (Railway MongoDB shell or Compass):**

```
db.sessions.dropIndex("createdAt_1")
```

The gateway will recreate it with `expireAfterSeconds: 1200` on next boot.

**Priority:** LOW — guest sessions currently expire after 2 h instead of 20 min. No privacy regression (they do expire); just looser than intended.

---



### 3.1 `haversine_distance` duplicated across three Rust services

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**Files:** `services/gateway/src/main.rs`, `services/messages-service/src/main.rs`, `services/location-service/src/main.rs`

Three independent copy-paste implementations of the same function. If a precision bug is found, all three need patching. All services now in Rust — consolidation into a `common` crate is possible but deferred.

**Context:** Each service is intentionally self-contained. MongoDB geospatial indexes are unavailable (free tier RAM limits), so haversine-in-Rust is the correct approach for distance filtering. Consolidation deferred.

### 3.2 Tier badge in /profile has hard-coded values

✅ **Resolved (2026-03-16, T-03):** `GET /api/tiers/:tier/info` added. Profile badge
now fetches label, cls, and nearbyRadiusM dynamically from tiers-service. Also fixed
a pre-existing bug where location-service had guest radius at 23,000 m instead of 500 m.

---

## 4. Performance

### 4.1 Send-rate bucket is in-process — not safe for multi-instance gateway

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**File:** `services/gateway/src/main.rs` (in-memory rate bucket)

The per-user send-rate bucket is stored in-process:

```js
const _wsSendCounts = new Map(); // userId -> { count, connections, timer }
```

If the gateway scales to multiple instances, two connections from the same user on different instances will have separate buckets, doubling the effective send rate. As long as Railway runs a single gateway instance this is fine, but it's worth noting before horizontal scaling.

**Context:** Redis is not currently available. Adding Redis is planned when the app scales, at which point the bucket can be migrated to a shared store (e.g. Redis `INCR` with a TTL key).

---

### 4.2 Notification poll scales linearly with active users

**File:** `ui/scripts/app.js` (NotifModule), `services/favourites-service/src/main.rs`

Each logged-in user polls `GET /api/notifications` every **2 minutes**
(`POLL_INTERVAL_MS = 2 * 60 * 1000`). Negligible at current scale (< 1 000
concurrent). At larger scale, push delivery via the existing message WebSocket
would be more efficient. Acceptable for now.

---

## 5. Usability

---

## 6. Maintainability

### 6.1 Core utilities duplicated across all Rust services

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**Files:** All services (now all Rust, using the shared `common` crate for auth — partial consolidation already exists)

The following utilities are copy-pasted across services. The `common` crate (`services/common/src/`) already centralises JWT types and `issue_user_token` / `issue_guest_token`. Remaining duplication:

| Utility | Duplicated in |
|---|---|
| `verify_token` | messages, location, favourites, blocks, users — each service re-verifies the JWT independently |
| `require_service_token` | all Rust services |
| `haversine_distance` | gateway, messages-service, location-service — see 3.1 |

T-08 Phase 2 (authority service + gateway-centralised verification) will eliminate `verify_token` duplication entirely. Remaining items deferred until T-08 is complete.

### 6.3 Auth validation is duplicated across every service (root cause of the admin-role bug cascade)

**Date:** 2026-03-16 (updated 2026-03-18: all services now in Rust)
**Files:** `services/messages-service/src/main.rs`, `services/favourites-service/src/main.rs`, `services/blocks-service/src/main.rs`, `services/users-service/src/main.rs`, `services/gateway/src/main.rs`, `ui/_layouts/default.html`

**What happened.**
Adding a second privileged role (`admin`) required changes in 6 separate files. The bug had *three* distinct failure layers, all hit in sequence:

1. **Frontend layout guard** (`default.html` inline `<script>`) — hard-coded `payload.role === 'user'`, rejecting admin tokens before the page even loaded. Redirected to `/` immediately.
2. **Backend `verifyToken` functions** — every service independently checks `payload.role !== 'user'` and returns 403 `REGISTERED_REQUIRED`. Four services had this guard.
3. **`issueUserToken` in `users-service.js`** — hard-coded `role: 'user'`, silently downgrading the admin to a regular user token after a password change.

None of these components communicates with each other. Each enforces its own auth rules from a local copy-paste of `verifyToken`. Changing the role model (any new role, any new field) requires finding and updating every copy.

**Why the design ended up this way.**
The microservice architecture was chosen to allow services to be deployed and scaled independently. Each service is intentionally self-contained (no shared library, no private package registry — see 6.1). The consequence is that shared logic like token validation must be replicated verbatim. This is a well-known microservice trade-off and was noted in 6.1 as deferred. The admin role was added *after* the pattern was established, so the role check in every existing `verifyToken` was never updated.

**Root cause (design).**
There is no single point of auth enforcement. The gateway (`services/gateway/src/main.rs`) already sits in front of all services and already decodes the JWT for tier checks. But it does not validate role or tokenVersion — it passes the raw `Authorization` header to each service. Each Rust service therefore re-implements the same auth logic independently.

**Suggested solution — centralise auth validation in the gateway.**

The gateway already:
- Holds the JWT secret
- Decodes the token for tier checks
- Forwards the raw `Authorization` header to services

The minimal change: add a `verifyUserToken` step in the gateway proxy that validates signature + role + tokenVersion, then injects `X-Auth-Sub`, `X-Auth-Role`, `X-Auth-Tier`, `X-Auth-TV` as trusted headers. Services would read these headers instead of re-verifying the JWT. They are already protected from external callers by `X-Service-Token`.

Benefits:
- Role-model changes touch exactly **one file** (gateway).
- tokenVersion DB check runs in one place (with one cache).
- Individual services become thinner; no JWT dependency.

**Prerequisites / cost:**
- Medium refactor: gateway `proxy()` helper grows a `verifyUserToken` step; each service's `verifyToken` is replaced by a header read.
- The frontend layout guard is a separate concern (client-side gate for UX); must stay but should be the *only* client-side check, not duplicated.
- Requires careful handling of routes that allow guests (header `X-Auth-Role: guest` for unauthenticated requests).
- Token: ~1–2 days for a careful port + test across all services.

**Priority:** MEDIUM. The immediate bug is fixed. The risk persists for any future role or field change. **T-08** tracks the full architectural resolution (authority service + gateway centralisation).

---

### 6.2 `app.js` mixes four distinct module concerns

**File:** `ui/scripts/app.js`

The file contains the main app shell, `GeoModule`, `LockModule`, and `NotifModule` — four concerns with distinct lifecycles. Each wraps itself in an IIFE, which helps, but the file must be loaded on every page. As the app grows, splitting into separate files (which Jekyll already supports via `extra_js`) would improve navigation and testability.

---

## 7. Other Tickets (new features, evaluations, questions)

### 7.1 TTL for inactive users

***Note:*** added by project owner (12 March 2026)

Related to 1.1.

I want to follow a (lost password - lost access)-approach. If a user forgets the password, there should be no way to recover the account, set a new password, being able to login, (and) or delete the account or read existing messages.

Therefore, inactive users should be auto-deleted after 90 days. I prefer a TTL initially set on account creation and updated on each login.

### 7.2 Evaluate stricter data protection feasibility

***Note:*** added by project owner (12 March 2026)

In the best case, all information stored in the database is either hashed or encrypted. No user related data should be transmitted in any direction unencrypted or unhashed. Services should get their own private / public key pairs with which they can encrypt/decrypt data if necessary.

Evaluate in which way it's feasible to:

- encrypt geo location data on the client side
- being transmitted from a client (user) in an encrypted fashion
- stored only encrypted in the backend (mongodb)
- geo location sent out encrypted to all other `/location/nearby..`)
- decrypted by various clients (users) with different private keys.

### 7.3 ✅ Port of all `/services` to Rust — complete (2026-03-17)

All services ported. See T-04 in TICKETS_DONE.md. migration-service intentionally remains the only exception (Node.js, by design).

### 7.4 Question: Is there a secure way to prove that the running service matches the public repo?

***Note:*** added by project owner (12 March 2026)

I want to give users a way to validate the code that runs the services, by matching a signature of the binary or in another way. Please elaborate on the feasible options.

### 7.5 Simple admin UI

***Note:*** added by project owner (14 March 2026)

I need an admin UI, in which I can as a developer change the current profile information (including current tier) of a specific user. It should look similar to the /profile page with the search bar. I would be able to search for a user using the same filters, then a click on a user entry expands the profile information. If I change the tier make sure that this change is effectively working (token generation etc) and not just changing the tier string in the db of the user.

### 7.6 Admin UI > Adding, changing, removing tiers

***Note:*** added by project owner (14 March 2026)

The admin UI should be able to add, edit, change, remove tiers. Therefore, I think it's also necessary to store the tier information in the db, rather than in a js. Please prepare a concrete plan for the implementation, estimate how difficult the implementation is.

---

## 8. Summary Table

| Status | # | Area | Severity | Finding |
|---|---|---|---|---|
| 🔲 | 1.1 | Security | HIGH | Plain password/email in POST request — needs OPAQUE/PAKE |
| 🔲 | 1.2 | Security | MEDIUM | Gateway send-rate bypassable at messages-service level |
| ✅ | 1.3 | Security | LOW (future) | JWT tier claim stale after admin tier change — resolved T-01 |
| 🔲 | 1.4 | Security | LOW | Admin self-promotion guard missing — can modify own tier/role via API |
| 🔲 | 2.1 | Infrastructure | HIGH | migration-service.js deleted — migrations not running, TTL indexes absent, privacy regression |
| 🔲 | 2.0 | Infrastructure | MEDIUM | MongoDB disk space — migration 003 not applied (dev-alpha: acceptable) |
| 🔲 | 3.1 | Bug | LOW | haversineDistance copy-pasted in 3 files (divergence risk) |
| ✅ | 3.2 | Bug | LOW | Tier badge in /profile has hard-coded values — resolved T-03 |
| 🔲 | 4.1 | Performance | LOW | Send-rate bucket is in-process — not safe for multi-instance |
| 🔲 | 2.2 | Infrastructure | LOW | Sessions TTL index carries old 2 h value — drop `createdAt_1` index to apply 20 min TTL |
| 🔲 | 4.2 | Performance | LOW | Notification poll scales linearly with active users |
| 🔲 | 6.1 | Maintainability | MEDIUM | Core utilities (verifyToken, issueUserToken, haversine) duplicated |
| 🔲 | 6.2 | Maintainability | LOW | app.js mixes four module concerns |
| 🔲 | 6.3 | Maintainability | MEDIUM | Auth validation duplicated per-service — role changes require 6+ file edits |
