# bOOmbOOm.NOW! — Audit

**Last updated:** 2026-07-02
**Scope:** Full codebase (9 backend services, frontend scripts, config)

This is the **single audit file**. All open findings live here, grouped by concern.
ID prefixes are kept: `INFRA-`, `MAINT-`, `UX-`, `SEC-`, `PERF-`.
Each open item carries an `<!-- ITEM -->` tag — the SessionStart hook parses these
into the open-items board, so there is no separate summary table. One copy per fact.

**When a finding is resolved:** move its full text to `AUDIT_DONE.md`, leave a
one-line stub in the Resolved section below. Move only when the fix is confirmed
in code. Items that are code-complete but have outstanding deployment steps
(env vars, DB ops) stay open here until fully live.

---

## Infrastructure (`INFRA-`)

### INFRA-1.3 CORS_ORIGINS env var now required in Railway gateway service
<!-- ITEM id:INFRA-1.3 status:open priority:high concern:infrastructure -->

**Finding (2026-03-30):** `ALLOWED_ORIGINS` was hardcoded to `["https://biffjezos.github.io"]` (old GitHub Pages domain). Changed to required env var `CORS_ORIGINS`. Gateway panics on startup if not set.

**Owner action required:** Set `CORS_ORIGINS=https://boom.up.railway.app` in Railway **gateway** service environment variables (comma-separate multiple origins if needed).

**Priority:** HIGH — without this, all cross-origin requests (API + WS) return 403/CORS errors.

---

### INFRA-1.4 JWT_SECRET must be identical in server and gateway Railway services
<!-- ITEM id:INFRA-1.4 status:open priority:high concern:infrastructure -->

**Finding (2026-03-30):** Server validates `bbn_tok` cookie with its own `JWT_SECRET`. Gateway signs JWTs with its own `JWT_SECRET`. If they differ, every protected page (`/messages/`, `/profile/`, `/favourites/`, `/settings/`, `/admin/`) rejects the cookie and redirects to `/`. Most likely root cause of the `/favourites` logout reported 2026-03-30.

**Owner action required:** In Railway, verify that **both** the `server` service and the `gateway` service have the exact same value for `JWT_SECRET`.

**Priority:** HIGH — every protected route silently fails when mismatch exists.

---

## Maintainability (`MAINT-`)

### MAINT-2.3 Per-handler role guards still scattered across services
<!-- ITEM id:MAINT-2.3 status:open priority:low concern:maintainability -->

**Date:** 2026-03-16 (updated 2026-03-24)
**Files:** `services/users-service/src/main.rs`, `ui/_layouts/default.html`

**Resolved so far (T-08 Phase 2, 2026-03-24):** Gateway uses a single `authority_guard()` + `role_guard()` pattern; messages, favourites, blocks, location services use `RegisteredByGateway`/`AuthedByGateway` from common; `common/src/auth.rs` has `GatewayIdentity` with pre-verified role.

**What remains:** `users-service` still has `AdminUser`/`RequireRegistered` extractors for its own admin routes (separate from gateway), running an independent tokenVersion DB check. Intentional (services must validate independently when not behind the gateway) but inconsistent with the newer `AuthedByGateway` approach.

**Suggested next step:** Migrate `users-service` admin handlers to `AuthedByGateway` in a focused follow-up session.

**Priority:** LOW — role guards are correct; this is a consistency improvement.

---

### MAINT-2.5 No explicit WebSocket disconnect on message-page navigation
<!-- ITEM id:MAINT-2.5 status:open priority:low concern:maintainability -->

**File:** `ui/scripts/messages.js`

The `beforeunload` handler sends `{ type: 'view', userId: null }` to clear the thread subscription, but the WebSocket itself is not explicitly closed on navigation. The server's `onclose` handler clears timers and releases the send bucket. The browser closes the WS on unload anyway, but there is no explicit `_msgWs.close()` call — inconsistent with the location WS (`closeLocWS()` is called on logout).

**Priority:** LOW — no functional impact; cosmetic inconsistency.

---

### MAINT-2.6 Per-service Config struct duplication — acceptable, not worth refactoring now
<!-- ITEM id:MAINT-2.6 status:open priority:low concern:maintainability -->

**Date:** 2026-03-19
**Files:** `services/*/src/main.rs` (all 9 services)

Each service defines its own `Config` struct with a `from_env()` impl sharing a common core (`port`, `jwt_secret`, `service_secret`, `mongo_uri`, `db_name`). The duplication is intentional and appropriate for independent microservices — the alternatives add build coupling without meaningful benefit at current scale (~30 lines per service), and the `from_env()` impls are not identical.

**When to revisit:** if a new standard env var must be added to all services simultaneously (e.g. `OTEL_ENDPOINT`), a shared `common::BaseConfig` would be justified. Reassess at ~15+ services.

**Priority:** LOW.

---

## Usability (`UX-`)

### UX-3.1 Users enter password twice in the cold login → messages flow
<!-- ITEM id:UX-3.1 status:open priority:medium concern:usability -->

**Files:** `ui/scripts/auth.js`, `ui/scripts/crypto-worker.js`

Login authenticates the user (issues JWT) but does **not** load the E2EE crypto keys into the worker. When the user navigates to `/messages/`, `requireUnlocked()` finds `BBMCrypto.isUnlocked() === false` and shows the lock screen — requiring the password a second time (PBKDF2 derivation ~1 s, plus a network round-trip for the encrypted key blob).

**Mitigating factors:**
- SharedWorker on Chrome/Firefox/Edge: keys survive full-page navigations within the same browser session. Double-entry only happens on the first access after a cold login.
- Safari / iOS: regular Worker is destroyed on every page navigation — password required on every page load that touches messages.
- Inactivity lock: intentional (3 min idle / 30 s hidden tab).

**Possible improvement (no security downgrade):** after a successful login, automatically attempt to unlock the crypto keys using the password the user just typed — it is available in-memory at that moment. The lock screen on inactivity/tab-hide still protects keys at rest.

**Priority:** MEDIUM — real friction for returning users, especially on Safari.

---

## Performance (`PERF-`)

### PERF-4.1 Send-rate bucket is in-process — not safe for multi-instance gateway
<!-- ITEM id:PERF-4.1 status:deferred priority:low concern:performance -->

***Postponed by project owner (12 March 2026):*** postponed until further notice.

**File:** `services/gateway/src/main.rs` (in-memory rate bucket)

The per-user send-rate bucket is stored in-process. If the gateway scales to multiple instances, two connections from the same user on different instances get separate buckets, doubling the effective send rate. Fine while Railway runs a single gateway instance. Migrate to a shared store (e.g. Redis `INCR` with TTL key) when Redis lands.

**Priority:** LOW (deferred until horizontal scaling).

---

### PERF-4.2 Notification poll scales linearly with active users
<!-- ITEM id:PERF-4.2 status:open priority:low concern:performance -->

**Files:** `ui/scripts/app.js` (NotifModule), `services/favourites-service/src/main.rs`

Each logged-in user polls `GET /api/notifications` every 2 minutes (`POLL_INTERVAL_MS`). Negligible at current scale (< 1,000 concurrent). At larger scale, push delivery via the existing message WebSocket would be more efficient.

**Priority:** LOW (revisit before scaling push).

---

## Owner Notes / Open Questions

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

## Resolved

One-line stubs only — full details in [AUDIT_DONE.md](AUDIT_DONE.md).

- INFRA-1.0 ✅ resolved 2026-03-24 — MongoDB disk space, superseded by INFRA-1.1
- INFRA-1.1 ✅ resolved 2026-03-24 — migration-service not running (Railway plan upgrade)
- INFRA-1.2 ✅ resolved 2026-03-24 — stale sessions TTL index (migration 010)
- MAINT-2.1 ✅ resolved — haversineDistance single impl in common/src/geo.rs
- MAINT-2.2 ✅ resolved — core utilities centralised in common/src/auth.rs extractors
- MAINT-2.4 ✅ resolved 2026-03-19 — app.js split into 6 focused files
- SEC-1.1 ✅ resolved 2026-03-24 — plain password/email in POST; OPAQUE fully deployed
- SEC-1.2 ✅ fixed 2026-03-23 — gateway send-rate bypass at messages-service (T-22)
- SEC-1.3 ✅ fixed 2026-03-23 — spoofable X-Forwarded-For; CF-Connecting-IP preferred (T-22)
- SEC-1.4 ✅ fixed 2026-03-23 — JWT TTL configurable via admin_settings, default 24 h (T-22)
- SEC-1.5 ✅ fixed 2026-03-23 — request body size cap added (T-22)
- SEC-1.6 ✅ fixed 2026-03-23 — dedicated lim_msg rate bucket for msg_send (T-22)
- SEC-1.7 ✅ fixed 2026-03-23 — CWE-918 SSRF, JWT sub interpolated into internal URLs
- SEC-1.8 ✅ fixed 2026-03-23 — NaN panic in location sort
- SEC-1.9 ✅ fixed 2026-03-23 — pre-epoch clock panic in now_unix/now_ms
- SEC-1.10 ✅ resolved 2026-03-24 — email pre-hash upgraded to PBKDF2-SHA256 (100k iters), deployed
- SEC-1.11 ✅ resolved 2026-03-24 — per-user emailSalt added at registration, deployed
- SEC-1.12 ✅ fixed 2026-03-23 — auth token moved localStorage → sessionStorage + pagehide DELETE /location
- SEC-1.13 ✅ fixed 2026-03-25 — CWE-312 clear-text sessionStorage `sex` key removed, read from JWT
- SEC-1.14 ✅ fixed 2026-03-25 — CWE-312 `sex` removed from `bbm_meet` localStorage
- SEC-1.15 ✅ fixed 2026-03-30 — CWE-319 credentials in URL, login form GET race condition
