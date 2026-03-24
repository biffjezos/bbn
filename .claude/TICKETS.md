# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.
Completed tickets and phases live in `TICKETS_DONE.md`.

---

## T-23 — OPAQUE Authentication + Email Privacy (SEC-1.1)

✅ Fully deployed 2026-03-24. Details in `TICKETS_DONE.md`.

Backend confirmed live by owner: users wiped, EMAIL_PEPPER set, OPAQUE_SERVER_SETUP set, migration 008 applied.
UI modals verified 2026-03-24: login and register modals use OPAQUE two-round flow via Api.login()/Api.register(); password change in profile.js fixed to use Api.changePassword() (was incorrectly sending plaintext password via Api.updateMe).

---

## T-24 — Profile Data Encryption
<!-- ITEM id:T-24 status:planned priority:high concern:auth phase:0/4 prereqs:T-23,SEC-1.10,SEC-1.11 relates:T-05b -->

**Status:** Planned. Prerequisites: T-23 deployed ✅ (OPAQUE live, `exportKey` available), SEC-1.10/1.11 deployed ✅ (PBKDF2 + `emailSalt` in DB).

**Relates to:** SEC-1.10, SEC-1.11, T-23, T-05b (block note — same key infrastructure).

**Complexity:** HIGH — touches auth-service, users-service, location-service, frontend, JWT claims, and all profile read paths.

---

### The Problem

Profile fields (`nickname`, `age`, `sex`) currently sit in MongoDB in plaintext. Anyone with DB read access — a breach, a leaked connection string, a malicious operator — sees every user's personal data immediately. OPAQUE protects passwords, but the profile is completely unprotected.

---

### The Approach

Use the cryptographic material OPAQUE already produces to build a layered encryption scheme:

**Layer 1 — User keypair.** Each user has an X25519 keypair. The private key is wrapped with AES-GCM using `exportKey` (the key OPAQUE's `loginFinish` derives from the user's password and the server's OPRF — it has full password entropy and never leaves the client). The wrapped private key (`encryptedPrivateKey`) and the raw public key are stored in the DB. The server never has the unwrapped private key.

**Layer 2 — Profile symmetric key.** A random 256-bit `profileKey` (AES-GCM) encrypts the profile fields. `profileKey` is separately encrypted for each party who needs to read the profile (owner + currently-nearby viewers) using ECDH shared secrets derived from their X25519 keypairs. The server stores `profileCiphertext` and a set of per-viewer key blobs. It never has `profileKey` in plaintext.

**Layer 3 — Viewer access via location coupling.** Profile access is gated on proximity. When user B updates their location, B's client receives the public keys of currently nearby users from location-service. For each nearby user A, B computes `sharedSecret = ECDH(B.privateKey, A.publicKey)`, wraps `profileKey` with `sharedSecret`, and sends the resulting blob to the server, keyed by `(B.userId, A.userId)`. When A wants B's profile, A computes the same `sharedSecret = ECDH(A.privateKey, B.publicKey)` (identical by ECDH symmetry), decrypts the blob, and decrypts the profile. No blob → no access, no fallback.

**Why `exportKey`, not `emailSalt`:**
`exportKey` carries full password entropy and is produced by the existing WASM `loginFinish` path. It is session-bound (client memory only) and never transmitted. `emailSalt` remains a defence-in-depth measure for email privacy only (SEC-1.11) — it is not an input to profile encryption. The comment in SEC-1.11 about `profileKey = PBKDF2(email, emailSalt)` predates this design and is superseded by it.

---

### What This Protects Against

- **DB breach:** attacker sees only `profileCiphertext` and per-viewer blobs — both are meaningless without the private keys.
- **Malicious infra operator:** profile data is never in plaintext in MongoDB or in transit to/from the DB.
- **Accidental log exposure:** no profile field ever appears in a log line or admin query result.
- **Bulk harvesting:** even with full DB access, an attacker cannot recover profiles without also compromising individual users' OPAQUE credentials.

### What This Does NOT Protect Against

- **A legitimate viewer saving or sharing the decrypted profile.** Once A has decrypted B's profile, A's client has it in memory. Nothing prevents A from exfiltrating it.
- **Server-sided public key substitution.** A's public key is stored plaintext on the server. If the server is malicious, it could swap A's public key with an attacker-controlled key; B would then encrypt `profileKey` for the attacker. There is no way to prevent this without a separate PKI or key pinning, neither of which is planned.
- **Social graph inference.** The per-viewer blob table — keyed by `(B.userId, A.userId)` — tells the server exactly who is near whom at each location update. This is partially inherent to the app's proximity model, but it is a de-facto social graph even if the profiles are opaque.
- **Compromised client.** If malware runs on the user's device, it can read the decrypted profile from memory and intercept the `exportKey`.
- **Forward secrecy on per-viewer blobs.** If A's private key is compromised later, an attacker who stored old blobs can decrypt them retroactively.

---

### Caveats and Logic Holes

**1. `exportKey` is only available after login, not registration.**
`registerFinish` returns only `RegistrationUpload`; there is no `exportKey` at that point. Registration must trigger an immediate auto-login so the client can obtain `exportKey`, generate the keypair, encrypt the private key, encrypt the initial profile, and upload everything. This is a multi-step async sequence behind a single "Register" button tap — it must be atomic from the user's perspective. A failure midway (network drop) leaves the account in a partially-initialised state.

**2. Password change is a critical failure path.**
A password change creates a new OPAQUE record → new `exportKey`. The client must immediately re-derive `encryptedPrivateKey` with the new key in the same session. If this step fails (network error, tab closed), the private key becomes permanently unreadable — there is no recovery path without the old `exportKey`. `profileCiphertext` and per-viewer blobs remain in the DB but are now inaccessible. This needs either: (a) a retry mechanism with a clear "finalise security update" prompt, or (b) a session flag that blocks logout until key re-encryption succeeds.

**3. Profile inaccessible until first location update.**
A newly-registered user's profile is visible to nobody until B posts at least one location update that generates viewer blobs. A user who never shares location (account created but map not opened) has a permanently inaccessible profile. Similarly, when A first enters B's radius, A must wait up to one full location-update interval before B's client produces A's blob. This is an inherent attack window in usability terms — it must be handled gracefully in the UI ("Profile loading…" vs "Profile unavailable").

**4. JWT `prof` claim chain is deep.**
The current design threads profile data through the JWT `prof` claim, requiring four decrypt steps just for the owner to read their own profile: `exportKey` → `privateKey` → `encryptedProfileKeyForOwner` → `profileKey` → plaintext. This adds size to every JWT and couples profile data to auth flows. A simpler alternative: decrypt once at login, hold plaintext in JS memory for the session, skip the JWT claim entirely. Decision needed before Phase 2 begins.

**5. Per-viewer blob scale.**
If B has 50 nearby users, each location update requires 50 ECDH computations and a payload containing 50 encrypted blobs sent to the server. This is linear in active nearby users. At the scale this app targets (dozens of nearby users per urban area), it is manageable with WebCrypto, but the location update path becomes significantly heavier.

**6. Blob cleanup / TTL.**
Old blobs for users who are no longer nearby are not addressed. Two options: (a) blobs get a TTL matching `LOCATION_TTL` and expire automatically; (b) each location update overwrites the full blob set for B (regenerate for current nearby, implicitly removing stale ones). Option B is cleaner and recommended — it also means a viewer who moves away loses access on B's next location update, which is the correct access model.

**7. Key revocation on block.**
When B blocks A, B must generate a new `profileKey`, re-encrypt all profile data, and exclude A from the next location update's blob list. This is correct but not instantaneous: A retains access until B's next location update (one full update interval as attack window). If A's client cached the old blob, A can still decrypt offline until B re-encrypts `profileCiphertext` with the new key. This should be addressed in Phase 4 (revocation) and coordinated with T-05b.

---

### Implementation Phases

**Phase 1 — Key infrastructure (no profile encryption yet)**
- Generate X25519 keypair on the client after first login (post-registration auto-login, or first regular login if no keypair exists).
- Wrap private key with AES-GCM(`exportKey`) → `encryptedPrivateKey`.
- Store `{ publicKey, encryptedPrivateKey }` via new `POST /users/me/keys` endpoint.
- On password change: immediately re-encrypt `encryptedPrivateKey` with new `exportKey`; block logout until complete.
- Location-service response for location update: include `{ userId, publicKey }[]` for nearby users (needed in Phase 3).
- DB schema: `publicKey` and `encryptedPrivateKey` fields on user document (may already exist from T-23).
- No profile encryption yet — owner can still read/write plaintext profile fields. Profiles remain exposed in DB during this phase.

**Phase 2 — Profile self-encryption (owner only)**
- Generate random `profileKey` (AES-GCM, 256-bit) on the client.
- Encrypt `{ nickname, age, sex }` → `profileCiphertext`.
- Encrypt `profileKey` for owner's own access using self-ECDH or by wrapping with the owner's public key — same code path as Phase 3 viewer blobs, just where B = A.
- Store `{ profileCiphertext, encryptedProfileKeyForOwner }` in DB via updated profile endpoint.
- Owner reads their own profile: decrypt `encryptedProfileKeyForOwner` → `profileKey` → `profileCiphertext`. Decide here whether to use the JWT `prof` claim or hold in session memory (see caveat 4).
- At end of this phase: profile data is encrypted in DB; no one else can read it yet. Existing profile read routes for other users return empty/placeholder.

**Phase 3 — Viewer blob generation (location update integration)**
- Location update response includes public keys of nearby users (added in Phase 1).
- Client computes `sharedSecret = ECDH(B.privateKey, A.publicKey)` for each nearby user A.
- Wraps `profileKey` with `sharedSecret` → per-viewer blob.
- Sends blob set to new `POST /users/me/profile-keys` endpoint alongside the location update.
- Server stores blobs with TTL (matching or slightly exceeding `LOCATION_TTL`).
- Profile read endpoint (`GET /users/:id/profile`) returns `profileCiphertext` + the requester's blob.
- If no blob exists for the requester: `403` with a specific code the UI handles gracefully.

**Phase 4 — Key revocation / block integration**
- On block: client generates new `profileKey`, re-encrypts `profileCiphertext`, uploads new profile ciphertext.
- Next location update excludes blocked user from blob generation.
- Old blob for blocked user is deleted server-side immediately on block action (best-effort; TTL handles remainder).
- Coordinate with T-05b (encrypted block note) — same key infrastructure.

---

## T-25 — Per-User OPRF Key Rotation (Auto-Rotation)
<!-- ITEM id:T-25 status:planned priority:medium concern:auth phase:0/3 prereqs:T-23 -->

**Status:** Planned. Prerequisites: T-23 deployed ✅. Requires a separate key service (see infrastructure note).

**Relates to:** SEC-1.1, T-23, T-24.

---

### The Problem

With a single global `OPAQUE_SERVER_SETUP`, a breach of the key service + DB gives an attacker a consistent snapshot they can attack offline indefinitely. Every `opaqueRecord` in the DB is permanently at risk for as long as the attacker has that snapshot.

---

### The Approach

Move from a single global OPRF key to per-user OPRF keys stored in a separate key service. When a user logs in and their OPAQUE blob is 30 or more days old, the client — which just proved knowledge of the password via the login flow — immediately runs `registerStart → registerFinish` again. The server replaces the old blob with a new one encrypted under a fresh per-user OPRF key and deletes the old key. The user sees nothing; it is two extra round trips on login, once every 30 days.

Accounts untouched for 90 days are auto-deleted. This means the worst-case exposure window for any active account in a split breach is 30 days.

---

### What This Protects Against

- **Split breach.** Attacker steals the DB at day 0 and the key service at day 45. Any account whose blob was rotated in those 45 days is already under a new key the attacker doesn't have. Only accounts that went the full 45 days without logging in still have a matching blob + key from the breach. Combined with 90-day auto-deletion, the maximum exposure window for any active account is 30 days.

### What This Does NOT Protect Against

- **Simultaneous breach.** Attacker takes both DB and key service in a single operation and has a consistent snapshot. Rotation after the fact does not touch their copy.

---

### Infrastructure Note

The per-user OPRF keys must live in genuinely separate infrastructure from the `users` collection — different credentials, different blast radius. If they share the same MongoDB instance or the same Railway project, a single credential compromise gives both, collapsing this back to the simultaneous breach case. This requires a second data store that is not Railway MongoDB.

---

### Implementation Phases

**Phase 1 — Key service**
- Stand up a separate key store (separate infrastructure from the main DB).
- Each user document gets a `keyId` reference. The key service maps `keyId → oprf_key`.
- Auth-service looks up the per-user OPRF key from the key service on every login/registration instead of using the global `OPAQUE_SERVER_SETUP`.

**Phase 2 — Auto-rotation on login**
- On `loginFinish`: auth-service checks the `opaqueRecord` age.
- If age ≥ 30 days: server signals the client to re-run `registerStart → registerFinish` in the same session.
- Server replaces `opaqueRecord`, generates a new `keyId`, stores the new key in the key service, deletes the old key.
- No UX change for the user.

**Phase 3 — 90-day account auto-deletion**
- Background task (migration-service or auth-service) deletes user documents where `lastLoginAt < now - 90 days`.
- Deletes corresponding key from key service on account deletion.

---

## T-22 — Security Hardening & Capacity Tuning

✅ Implemented 2026-03-23. Details in `TICKETS_DONE.md`.

---

## T-20 — Sharded Location Store (performance at scale)
<!-- ITEM id:T-20 status:deferred priority:low concern:db phase:4/5 -->

**Status:** Phases 1–4 ✅ complete (2026-03-23). Phase 5 deferred. Details in TICKETS_DONE.md.

### Phase 5 — Auto-adjustable shard size (deferred)

Track here, implement later. Idea: a background task monitors shard population sizes. If any shard exceeds a configurable `SHARD_MAX_USERS` threshold, halve `SHARD_SIZE_M` for the next startup (write to a `_meta` doc). If all shards fall below `SHARD_MIN_USERS`, double it. Requires graceful re-bucketing logic. Low priority until real load data exists.

---

## T-21 — Continental location-service routing
<!-- ITEM id:T-21 status:deferred priority:low concern:infra prereqs:T-20 -->

**Status:** Deferred. Prerequisite: T-20 complete and deployed.

### Goal

Run one `location-service` instance per continent (e.g. `americas`, `europe`, `africa-asia`). Users in different continents never appear in each other's nearby queries, so there is no cross-instance state or coordination needed. Each instance runs `LOCATION_STORE=memory` independently.

### Design

- **Gateway routing:** the gateway derives the continent from the lat/lon in every location request (a simple bounding-box lookup — no geospatial library needed) and forwards to the appropriate upstream. Clients remain unaware of the topology.
- **Location-service:** no code changes required. Each deployment is a standard location-service instance with its own env vars.
- **User travel:** when a user crosses a continent boundary their old entry expires via `LOCATION_TTL` on the old instance and they appear on the new one after their next update. No explicit migration needed.
- **Boundary placement:** draw boundaries conservatively away from dense border regions (e.g. Atlantic mid-ocean, Sahara) to avoid edge cases where two users at a boundary cannot see each other.

### What this unlocks

Removes the single-instance ceiling entirely without switching to `LOCATION_STORE=db`. Each continental instance scales to ~50,000–200,000 active users independently.

### Infrastructure required (owner action, not code)

- 2–3 additional Railway service deployments of `location-service`.
- Gateway env vars for each continental upstream URL.
- Continent bounding-box table added to gateway config.

---

## Recommended Implementation Order

Before any marketing or scaling push, the order of priority is:

1. **T-10** — Fix migration-service (HIGH: privacy regression — TTL indexes not running, data not auto-purged)
2. **T-08 Phase 2** — Authority service: merge auth + tiers → single authority, centralise RBAC in gateway, retire tiers-service (T-08 Phase 1 ✅ complete)
3. **T-06b** — Venue messaging (ideally after T-08 Phase 2 for clean auth routing)
4. **T-09** — Role CRUD with Permissions UI (prerequisite: T-08 Phase 2)
5. **T-02** — Analytics (low-risk, can slot in any time)
6. **T-05b** — Encrypted block note (blocked on OPAQUE implementation — see AUDIT.md 1.1)
7. **T-14** — Manager-tier venue quota (deferred, prerequisite: T-08)
8. **T-15** — Orphan venue reassignment (deferred, prerequisite: multi-role support)
9. **T-07b** — Device notifications (low priority)

### Architectural Decision (2026-03-16)

**Access control model: Enhanced RBAC + access gates. No full ABAC policy engine.**

Roles are stored as DB documents (T-03 schema). Dual-control access (e.g. admin
requesting block note decryption, legal approving it) is handled via a shared
`access_requests` collection — not a policy engine. New gates are new
`resourceType` values in that collection. This pattern ports cleanly to Rust and
requires no new infrastructure.

### Owner's Comments

- Generally agreed on the implementation order. T-05, T-03 approved for implementation, but need clarification. See my comments in the tickets and clarify open questions in the upcoming meeting.
- I wonder if T-04 should have a higher priority. Probably less code to port, we could make use of common libraries earlier.
- **2026-03-16:** Agreed. Enhanced RBAC + access_requests. No encryption of the optional note for now. Tiers-service Rust port moves up after T-05 and T-03. Then the rest.

---

## T-02 — Analytics (`anal.js` / analytics-service)
<!-- ITEM id:T-02 status:open priority:low concern:services -->

**Status:** Not started.

### Requirements

- Logins per day (guest + registered, separate counts).
- New registrations per day.
- Active users (sent at least one message or location update) per day.
- Messages sent per day.
- Favourites added per day.

### Architecture notes

- **Option A — Event counters in MongoDB:** On each relevant action, `$inc` a counter document (e.g. `{ date: '2026-03-16', event: 'login', count: N }`). Near-zero overhead. No new infrastructure.
- **Option B — Log parsing:** Parse existing `console.log` output from Railway's log drain. Zero app changes, but requires a log aggregator.
- **Recommendation:** Option A. One `analytics` collection, one `$inc` per event. The `anal.js` frontend script reads from a new `analytics-service` endpoint and renders simple charts (Chart.js is already included or trivial to add).
- Do not add analytics writes to the hot path of high-frequency operations (location updates). Limit to: login, register, message sent, favourite added.

### Owner's Comments

- Option A it is.
- Not a high priority at the moment. May be postponed.

---

## T-05b — Encrypted note field in blocks
<!-- ITEM id:T-05b status:planned priority:medium concern:auth prereqs:T-23 relates:T-24 -->

**Status:** Not started. Blocked on OPAQUE implementation.

T-05 Phase 1 (block mechanism + reason enum) is complete — see TICKETS_DONE.md.
T-04b (Rust auth-service port) is complete, but OPAQUE/PAKE was deferred during the port — see AUDIT.md 1.1.

Add optional encrypted note field once OPAQUE-based key derivation is in place.
Note field (`note: "..."`) — storing free-text without proper client-side encryption would be a privacy regression. Reason enum is not sensitive.

**Prerequisite:** OPAQUE / PAKE client-side key derivation (AUDIT.md 1.1).

---

## T-06 — Venue Accounts + Manager Role

**Status:** Phase 1 ✅ complete (2026-03-18). T-06c ✅ complete (2026-03-18). T-06b deferred. Details in TICKETS_DONE.md.

### Phase 2 — Venue messaging (T-06b, deferred)
<!-- ITEM id:T-06b status:deferred priority:medium concern:services prereqs:T-08 -->

- Manager inbox context ("acting as venue X")
- `GET /manager/venues/:id/messages`
- `POST /manager/venues/:id/messages` — send as venue
- Favourites: user adds venue as favourite → messaging channel opens

**Message delivery routing:** venue has no JWT/session. Messages-service resolves `recipientId` accountType on delivery; if `"venue"`, notifies `venue.managerId`'s session instead. Stored document is type-agnostic.

**Message radius:** effective radius = min(user tier `messageRadiusM`, venue tier `messageRadiusM`). Lower tier always wins.

---

### Phase 3 — Multiple venues per manager (T-06c)

✅ Complete (2026-03-18). Venue limit lifted. Details in TICKETS_DONE.md.
T-14 tracks future tiered quota (per-tier venue limits) — still deferred.
T-15 tracks orphan venue reassignment (when manager is deleted) — still deferred.

---

## T-15 — Orphan Venue Reassignment
<!-- ITEM id:T-15 status:deferred priority:low concern:db -->

**Status:** Not started. Deferred until multi-role support exists.

**Prerequisite:** A user account must be able to hold more than one role simultaneously (e.g. `admin` + `venue_manager`). Currently the system supports a single role per account, so an admin cannot also be a `venue_manager`.

**Problem:** When a `venue_manager` account is deleted, their venue(s) are currently cascade-deleted (T-06 decision). This is a data loss risk for venues that should persist under new management.

**Proposed approach (to be designed):**
- Option A: A configurable "fallback manager" per venue (set by admin at creation time). If the primary manager is deleted, ownership transfers to the fallback.
- Option B: A new interim role (e.g. `orphan_manager`) that can hold venue documents without appearing on the map as a regular user. Admin can reassign from the orphan pool.
- Option C: Venues are held in a soft-deleted / suspended state for N days after manager deletion, giving admin time to reassign before permanent deletion.

No implementation until multi-role support is landed and a preferred option is chosen.

---

## T-07a — Settings Page

✅ Complete (2026-03-18). Details in TICKETS_DONE.md.

---

## T-07b — Device Notifications
<!-- ITEM id:T-07b status:open priority:medium concern:services -->

**Status:** Not started. **Priority: medium.**

### Requirements

Notification events (priority order):

| Event | Notes |
|---|---|
| Received a new message | Already partially handled by message WS polling |
| Added to someone's favourites | Implemented (NotifModule, 2026-03-16) |
| A favourite came online | Requires presence tracking improvement |
| A favourite is now in range | Derived from range-sync events |
| Admin changed your account type | Triggered by T-01 admin action |
| Compass activated by a favourite | Future feature |

**Delivery mechanism options:**

- **Web Push (Service Worker + Push API):** True device notifications, works when app is closed. Requires VAPID keys, a push subscription stored per user, and a push-sending step in the relevant service. Most powerful but most complex. Requires HTTPS (already satisfied).
- **In-app notifications (current NotifModule approach):** Banner + badge while app is open. Already built for new-favourite events. Extend the polling to cover other event types.
- **Recommendation:** Extend the existing NotifModule + `notifications` collection to cover all in-app events first. Add Web Push in a second pass when the event types are stable.

The existing `notifications` collection (added 2026-03-16) already supports arbitrary `type` values. New event types are additive — no schema change needed.

### Prerequisites

None for in-app extension. Web Push requires HTTPS (already satisfied) and VAPID key setup in Railway.

### Owner's Comments

- Not a priority at the moment.

---

## T-08 — Coherent Identity Model + Authority Service

**Status:** Phase 1 ✅ complete. Phase 2 pending.

**Rationale for merge with T-13:** T-13 (normalise the data model) and T-08 (enforce it centrally) solve opposite ends of the same structural problem. T-13 defines what the system should say; T-08 builds the single voice that says it. Phase 1 must be deployed before Phase 2 begins.

---

Phase 1 ✅ complete (2026-03-18). Details in TICKETS_DONE.md.

---

### Phase 2 — Authority Service (ex-T-08)
<!-- ITEM id:T-08 status:active priority:high concern:services phase:1/2 prereqs:T-01,T-04c -->

**Problem:** No single authority for user rights and limits.

| What | Where |
|---|---|
| JWT issue & tokenVersion | `auth-service` (Rust) |
| Tier definitions & feature flags | `tiers-service` (Rust) |
| Radius lookups | `tiers-service` (Rust) + hardcoded table in `location-service/src/main.rs` |
| Token verification | Copy-pasted `verifyToken` in every Rust service (×5) |
| Role enforcement | Copy-pasted role check in every Rust service (×5) |

Any role model change currently requires edits in 6+ places. Root cause of the admin-role cascade bug (AUDIT.md 6.3).

**Proposed architecture:**

**Step 1 — Merge auth-service and tiers-service into a single `authority-service` Rust binary:**
- All JWT issuing and verification
- tokenVersion DB check (single place, with short cache)
- Tier definitions, feature flag checks, radius lookups
- Admin role management (promote/demote, tokenVersion bumps)

Exposes a single internal endpoint:
```
POST /authority/verify
Body: { token: "...", feature?: "message_online" }
→ 200 { sub, role, account_type, tier, tv, features[], radii{} }
→ 401/403 on invalid/expired/insufficient
```

**Step 2 — Gateway becomes the single enforcer:**
Gateway calls `/authority/verify` once per request and injects trusted headers:
- `X-Auth-Sub`, `X-Auth-Role`, `X-Auth-AccountType`, `X-Auth-Tier`, `X-Auth-TV`
- `X-Auth-Features` (JSON array), `X-Auth-Radii` (JSON object)

Gateway's `checkTier()` becomes a header read — no separate tiers-service call.

**Step 3 — Services drop `verifyToken` copy-paste:**
Each service reads `X-Auth-*` headers. `X-Service-Token` still protects services from external callers. tokenVersion check moves entirely to gateway.

**Step 4 — Retire tiers-service on Railway.**

**Security properties:**
- Role/tier changes take effect immediately — gateway re-verifies on every request.
- Stale JWT with downgraded role rejected at gateway as soon as `tokenVersion` is bumped.
- New roles or features require changes in exactly one place (authority-service).
- `X-Auth-*` headers trusted only because injected by gateway; services unreachable externally without `X-Service-Token`.

**What this is NOT:** Not a policy engine (no ABAC). Not a reverse proxy. Does not replace `X-Service-Token`.

**Prerequisites:**
- T-08 Phase 1 complete and deployed
- T-01 ✅ complete
- T-04c ✅ complete (all services now in Rust)
- No new infrastructure required

**Implementation order:**
1. Extend auth-service to absorb tiers-service routes (same binary, same DB).
2. Add `POST /authority/verify` endpoint.
3. Update gateway to call authority and inject headers.
4. Update each Rust service to read `X-Auth-*` headers (one at a time, backwards-compatible).
5. Retire tiers-service on Railway.

### Owner's Comments

- 2026-03-16: Proposed by Claude based on admin-role cascade bug post-mortem (AUDIT.md 6.3).
- 2026-03-18: T-13 merged into T-08 as Phase 1 — data model normalisation is prerequisite for the authority service. All prerequisites met (T-01 ✅, T-04c ✅). Ready to begin Phase 1.

---

## T-10 — Restore migration-service

✅ Closed (2026-03-23) — migration-service is already in Rust (`services/migration-service/src/main.rs`). Node.js restoration was incorrect. Details in TICKETS_DONE.md.

---

## T-13 — ✅ Merged into T-08 Phase 1 (2026-03-18)

Scope (normalise accountType/tier/role data model) absorbed into T-08 as Phase 1. See T-08 for full spec and implementation plan.

---

## T-11 — ✅ Complete (2026-03-18). Details in TICKETS_DONE.md.

---

## T-12 — Remove leftover `bbm_meet` localStorage key

✅ Closed as invalid (2026-03-18). Details in TICKETS_DONE.md.

---

## T-09 — Role CRUD with Permissions UI
<!-- ITEM id:T-09 status:open priority:medium concern:ui prereqs:T-08 -->

**Status:** Not started. Requires backend changes.

### Problem

Roles are currently hardcoded strings (`user`, `admin`) validated inline in each service. The admin Roles tab (added T-01 follow-up, 2026-03-16) is read-only. Adding custom roles or per-role permission sets requires:

1. A `roles` MongoDB collection: `{ name, label, permissions[], rank, createdAt }`
2. Role validation in `users-service` updated from hardcoded list to DB lookup
3. Gateway or authority service reads role permissions at request time (see T-08)
4. Admin UI: form to define role name, label, and permission toggles

### Standalone guard (can be done without T-09)

**Admin self-modification block** (AUDIT.md 1.4): prevent admins from changing their own tier or role via the API. One-line fix per handler in `users-service.js`:

```
if (targetId === req.auth.sub)
  return res.status(403).json({ error: 'Cannot modify your own tier or role.', code: 'SELF_MODIFICATION_FORBIDDEN' })
```

This does not require a `roles` collection and can be implemented at any time.

### Prerequisites

- T-08 (Authority service) is the natural home for role-to-permissions resolution. Without T-08, the change touches 5+ services (same anti-pattern as AUDIT.md 6.3).
- T-09 full implementation should follow T-08.

### Owner's Comments

- 2026-03-16: Raised by owner — need ability to add/edit/remove roles with permissions. Custom roles and permissions require backend work; tracked here. Standalone self-modification guard (AUDIT 1.4) can be patched sooner.

---

## T-16 — meta collection: runtime-configurable settings
<!-- ITEM id:T-16 status:active priority:medium concern:db phase:1/2 prereqs:T-08 -->

**Status:** Partially implemented (2026-03-23). The `admin_settings` MongoDB collection (seeded by migration `009_admin_settings`) and the admin Settings tab are live. Remaining: location/sharding settings (SHARD_SIZE_M — Phase 5 of T-20 deferred), and user-scope keys already handled by T-07a preferences. See below for what is still open.

### Problem

Several constants that affect user experience are currently hardcoded in services
and cannot be changed without a redeploy. The owner's 2026-03-18 audit identified
a clear split between safe runtime-editable values and constants that must stay
in code.

### Proposed schema

```
meta: {
  key:             string   // e.g. "message_ttl_ms"
  value:           any
  type:            "number" | "string" | "boolean"
  scope:           "admin" | "user" | "system"
  description:     string
  restartRequired: boolean
  affects:         string   // service name or "ui"
}
```

### Safe to make runtime-editable (first pass, 9 entries)

| Key | Current value | Scope | Notes |
|---|---|---|---|
| `message_ttl_ms` | 14 400 000 (4 h) | admin | Stamped at write time — safe to change |
| `favourite_expiry_days` | 30 | admin | Same pattern |
| `rate_limit_login` | 10 / 15 min | admin | Immediate effect |
| `rate_limit_register` | 5 / 1 hr | admin | Immediate effect |
| `rate_limit_api` | 120 / 60 sec | admin | Immediate effect |
| `ws_location_min_delta_m` | 5 m | admin | Immediate effect |
| `location_update_min_distance_m` | 100 m | admin | Immediate effect |
| `map_default_zoom` | 17 | user | UI-only; currently localStorage |
| `show_favourite_pins_on_map` | true | user | UI-only; currently localStorage |

### NOT safe to make runtime-editable

MongoDB index TTLs (sessions `15 min`, locations `10 min`) require a `collMod`
or migration to take effect — track as a separate migration step when these
become configurable.

Everything crypto, bcrypt cost, JWT structure, CORS — hard-code, no exceptions.

### Prerequisites

- T-08 Phase 2 (Authority service) ideally precedes the backend half, so
  there is a single place to read/cache `meta` values.
- The `map_default_zoom` and `show_favourite_pins_on_map` user-scope keys are
  **already implemented as server-side per-user preferences** in T-07a (2026-03-18)
  via `GET/PUT /users/me/preferences` — these two `meta` entries are obsolete for
  the user scope. They remain listed here only for completeness; no further action
  needed unless a global admin default (separate from per-user overrides) is wanted.

### Owner's Comments

- 2026-03-18: Audit provided by owner. First-pass scope agreed: 9 entries,
  zero unsafe side-effects. DB-index TTLs tracked separately.

---

## T-14 — Manager-tier venue quota (tiered multi-venue)
<!-- ITEM id:T-14 status:deferred priority:low concern:db prereqs:T-08 -->

**Status:** Deferred — no tier infrastructure exists for managers yet.

### Idea

Combine the user `tier` concept with manager roles so that a "regular manager"
can manage up to N venues and a "premium manager" can manage more. This would
require:

1. A manager-specific tier dimension (separate from or layered on top of the
   existing user tiers which are for consumers).
2. The tiers-service to know about manager quotas.
3. `POST /manager/venues` to query the manager's quota from tiers-service
   before allowing creation.

### Current state

Venue limit is set to 9999 (effectively unlimited) in `POST /manager/venues`.
Becoming a venue manager requires a manual approval process, so abuse is
low-risk for now.

### Prerequisites

T-08 (Authority service) should land first so there is a single source of
truth for roles + tiers before adding a second tier dimension.

---

## T-17 ✅ Complete (2026-03-19). Details in TICKETS_DONE.md.

---

## T-18 The login.modal is filled with user credentials after logout

✅ Complete (2026-03-22). Details in TICKETS_DONE.md.

---

## T-19 — Notification banner on the map
<!-- ITEM id:T-19 status:open priority:medium concern:ui -->

**Status:** Open

### Problem 

The app's rate limits (login, guest session) have strict rate limits. It's logged in the console, but the avg user doesn't see any notifaction, only an error. Since it affects only the login-, registration-modals and guest sessions, there should be a notification banner on the top of map just below that main mennu bar, stating that the actioned attempted is rate-limited in the development environment. Asking for support to open up the app and provide a link to /donate.

I think the notification banner already exists, just add the message.

