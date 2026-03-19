# bOOmbOOm.NOW! — Audit

**Last updated:** 2026-03-19 (maintainability items verified against codebase)
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)

**This file covers:** Infrastructure · Maintainability · Usability · Owner notes / open questions
**See also:** AUDIT_SECURITY.md · AUDIT_PERFORMANCE.md · AUDIT_DONE.md (resolved items)

---

## 1. Infrastructure

### 1.1 migration-service not running — root cause: Railway disk too small

**Date:** 2026-03-17 (updated 2026-03-18)
**Files:** `services/migration-service/src/main.rs` (Rust port),
`services/gateway/src/main.rs` (calls `MIGRATION_SERVICE_URL` on boot)

The migration-service itself is working correctly (responds, connects to MongoDB, reports the failure). The root cause is the Railway MongoDB volume: total disk is only **454 MB**, with 222 MB used by the OS and MongoDB process overhead, leaving 232 MB free. MongoDB's WiredTiger engine requires a **minimum of 524 MB free** for write operations (index creation, inserts). This requirement exceeds the available free space and cannot be resolved by deleting data — the MongoDB database contains only ~614 KB of data across all collections.

**Confirmed 2026-03-18:** All collections inspected via `db.getCollectionNames()`. No bloated collections. The disk constraint is structural, not data-related.

**Attempted workarounds (all failed — 2026-03-18):**
- `/migrate/reset` endpoint: same OutOfDiskSpace error (drop operations succeed, but `createIndex` is a write op and is blocked by the same threshold).
- Standalone Bun script connecting directly via `MONGO_URI`: identical error. MongoDB code 14031 blocks **all** write operations below 524 MB free — there is no way to run migrations against this instance without first freeing disk space at the filesystem level.

**Only remaining resolution: migrate MongoDB to Atlas free tier (M0).**
- Atlas manages storage independently; WiredTiger journal overhead is not charged against the 512 MB data limit.
- The dataset is ~614 KB / 53 documents — trivially small.
- Update `MONGO_URI` in Railway env vars for all services.
- Migration-service will apply all 6 pending migrations on next gateway boot.
- The `/migrate/reset` endpoint is available for a clean slate after migration.

**Consequences while not running:**
- MongoDB TTL indexes for `messages`, `locations`, `sessions` not applied — expired data not auto-purged at DB level (privacy regression).
- Migration `003_blocks_indexes` not enforced — duplicate block entries possible.
- Migrations `004_tiers_seed` / `005_rename_developer_tier` / `006_email_index_sparse` not applied.

**Priority:** HIGH — privacy regression in a privacy-by-design app. Tracked as T-10.

---

### 1.0 MongoDB disk space — superseded by 1.1

**Date:** 2026-03-16 (superseded 2026-03-18)

Merged into 1.1. Root cause confirmed: Railway volume is structurally too small (454 MB total). Upgrading the plan to 1 GB is not available on the current Railway tier. Resolution: migrate to MongoDB Atlas (see 1.1).

---

### 1.2 Sessions TTL index must be dropped and recreated after guest-TTL change

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

## 2. Maintainability

### 2.1 `haversine_distance` — resolved, see AUDIT_DONE.md

### 2.2 Core utilities duplication — resolved, see AUDIT_DONE.md

---

### 2.3 Per-handler role guards still scattered across services

**Date:** 2026-03-16 (updated 2026-03-19)
**Files:** `services/users-service/src/main.rs`, `services/gateway/src/main.rs`, `ui/_layouts/default.html`

**What is now resolved:** Token *verification* is fully centralised — `AuthToken`, `RequireRegistered`, `ServiceToken`, and `AdminUser` Axum extractors in `services/common/src/auth.rs` handle all JWT validation. No per-service re-implementations remain. The original three-layer bug (frontend guard, backend verifyToken, issueUserToken) is fixed.

**What remains:** Individual *role guards* inside handler bodies are still per-service (e.g., `claims.role != "admin"` repeated in `users-service` for every admin endpoint; gateway has its own `admin_guard()` / `manager_guard()` helpers). The gateway does **not** inject `X-Auth-Role` or similar trusted headers — it passes the raw `Authorization` header downstream. Adding a new role still requires auditing handler-level checks across multiple files.

**Suggested resolution:** T-08 Phase 2 — gateway injects `X-Auth-Sub`, `X-Auth-Role`, `X-Auth-Tier`, `X-Auth-TV` as trusted headers; services drop JWT re-verification and read headers. Role-model changes would then require only one file.

**Priority:** LOW — token verification is solid; the remaining scatter is a future-maintenance risk, not an active bug.

---

### 2.4 `app.js` mixes six distinct module concerns

**Date updated:** 2026-03-19 (corrected count)
**File:** `ui/scripts/app.js`

The file contains **6 IIFEs** with distinct responsibilities: Debug console (~24 lines), Warm-up (~12 lines), Main App shell (~336 lines), `GeoModule` (~282 lines), `LockModule` (~183 lines), and `NotifModule` (~117 lines). Each wraps itself in an IIFE, which helps, but the entire file (~990 lines) is loaded on every page. As the app grows, splitting into separate files (Jekyll supports `extra_js`) would improve navigation and testability.

---

### 2.5 No explicit WebSocket disconnect on message-page navigation

**File:** `ui/scripts/messages.js`

The `beforeunload` handler sends `{ type: 'view', userId: null }` to clear the thread subscription, but the WebSocket itself is not explicitly closed on navigation. The server's `onclose` handler clears timers and releases the send bucket. The browser closes the WS on unload anyway, but there is no explicit `_msgWs.close()` call — inconsistent with the location WS (`closeLocWS()` is called on logout).

**Priority:** LOW — no functional impact; cosmetic inconsistency.

---

## 3. Usability

### 3.1 Users enter password twice in the cold login → messages flow

**File:** `ui/scripts/auth.js`, `ui/scripts/crypto-worker.js`

Login authenticates the user (issues JWT) but does **not** load the E2EE crypto keys into the worker. When the user navigates to `/messages/`, `requireUnlocked()` finds `BBMCrypto.isUnlocked() === false` and shows the lock screen — requiring the password a second time (PBKDF2 derivation, ~1 s, plus a network round-trip for the encrypted key blob).

**Net result: two password entries in the typical "log in → read messages" flow.**

**Mitigating factors:**
- SharedWorker on Chrome/Firefox/Edge: keys survive full-page navigations within the same browser session. Double-entry only happens on the first access after a cold login.
- Safari / iOS: regular Worker is destroyed on every page navigation — password required on every page load that touches messages.
- Inactivity lock: intentional (3 min idle / 30 s hidden tab).

**Possible improvement (no security downgrade):** After a successful login, automatically attempt to unlock the crypto keys using the password the user just typed — without requiring a second prompt. The password is available in-memory at that moment. The lock screen on inactivity/tab-hide would still protect keys at rest.

**Priority:** MEDIUM — real friction for returning users, especially on Safari.

---

## 4. Owner Notes / Open Questions

### 4.1 TTL for inactive users

***Note:*** added by project owner (12 March 2026)

Related to SEC-1.1.

I want to follow a (lost password - lost access)-approach. If a user forgets the password, there should be no way to recover the account, set a new password, being able to login, (and) or delete the account or read existing messages.

Therefore, inactive users should be auto-deleted after 90 days. I prefer a TTL initially set on account creation and updated on each login.

---

### 4.2 Evaluate stricter data protection feasibility

***Note:*** added by project owner (12 March 2026)

In the best case, all information stored in the database is either hashed or encrypted. No user related data should be transmitted in any direction unencrypted or unhashed. Services should get their own private / public key pairs with which they can encrypt/decrypt data if necessary.

Evaluate in which way it's feasible to:

- encrypt geo location data on the client side
- being transmitted from a client (user) in an encrypted fashion
- stored only encrypted in the backend (mongodb)
- geo location sent out encrypted to all other `/location/nearby..`
- decrypted by various clients (users) with different private keys.

---

### 4.3 Question: Is there a secure way to prove the running service matches the public repo?

***Note:*** added by project owner (12 March 2026)

I want to give users a way to validate the code that runs the services, by matching a signature of the binary or in another way. Please elaborate on the feasible options.

---

### 4.4 Simple admin UI

***Note:*** added by project owner (14 March 2026)

I need an admin UI, in which I can as a developer change the current profile information (including current tier) of a specific user. It should look similar to the /profile page with the search bar. I would be able to search for a user using the same filters, then a click on a user entry expands the profile information. If I change the tier make sure that this change is effectively working (token generation etc) and not just changing the tier string in the db of the user.

---

### 4.5 Admin UI > Adding, changing, removing tiers

***Note:*** added by project owner (14 March 2026)

The admin UI should be able to add, edit, change, remove tiers. Therefore, I think it's also necessary to store the tier information in the db, rather than in a js. Please prepare a concrete plan for the implementation, estimate how difficult the implementation is.

---

## 5. Summary Table

| Status | ID | Area | Severity | Finding |
|---|---|---|---|---|
| 🔲 | 1.1 | Infrastructure | HIGH | migration-service not running — Railway volume too small (454 MB total, WiredTiger needs 524 MB free). Migrate to MongoDB Atlas. |
| ~~🔲~~ | ~~1.0~~ | ~~Infrastructure~~ | ~~MEDIUM~~ | ~~MongoDB disk space~~ — superseded by 1.1 |
| 🔲 | 1.2 | Infrastructure | LOW | Sessions TTL index carries old 2 h value — drop `createdAt_1` index to apply 20 min TTL |
| ✅ | 2.1 | Maintainability | LOW | haversineDistance — resolved, single impl in common/src/geo.rs |
| ✅ | 2.2 | Maintainability | MEDIUM | Core utilities — resolved, all in common/src/auth.rs extractors |
| 🔲 | 2.3 | Maintainability | LOW | Per-handler role guards still scattered; token verification now centralised |
| 🔲 | 2.4 | Maintainability | LOW | app.js mixes six module concerns (~990 lines) |
| 🔲 | 2.5 | Maintainability | LOW | No explicit WS close on message-page navigation |
| 🔲 | 3.1 | Usability | MEDIUM | Users enter password twice in cold login → messages flow |
