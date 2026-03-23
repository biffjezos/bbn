# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.
Completed tickets and phases live in `TICKETS_DONE.md`.

---

## T-22 — Security Hardening & Capacity Tuning

**Status:** Planned. Self-contained — no prerequisites. Plan: `docs/superpowers/plans/2026-03-23-security-hardening-capacity.md`

Closes SEC-1.2, SEC-1.3, SEC-1.4, SEC-1.5, SEC-1.6. Does not touch SEC-1.1 (OPAQUE — separate track).

*(Was incorrectly numbered T-21; renamed T-22 to avoid conflict with T-21 continental routing.)*

### Changes

| Service | Change |
|---|---|
| `common` | Add `ttl_secs: u64` to `UserTokenParams`; remove hardcoded 7-day constant from `issue_user_token` |
| `auth-service` | Read `JWT_USER_TTL_SECS` (default 86 400 s = 24 h); pass to token calls |
| `users-service` | Same `JWT_USER_TTL_SECS` pattern; thread through `make_token` helper |
| `messages-service` | Per-userId `FixedWindow` in `send_message` (fixes SEC-1.2). Env: `MSG_SEND_RATE_MAX` (default 10), `MSG_SEND_RATE_WINDOW_SECS` (default 10) |
| `gateway` | `real_ip()` prefers `CF-Connecting-IP` (SEC-1.3); `DefaultBodyLimit` via `HTTP_BODY_LIMIT_BYTES` (SEC-1.5); all 4 rate limits configurable via env vars with tighter production defaults; new `lim_msg` for `msg_send` (SEC-1.6) |
| All READMEs | Document every new env var and production capacity guidance |

### No backend changes required until deployment
New env vars have safe defaults — services behave as before if vars are not set. Set them in Railway when deploying.

### Multi-replica note
Gateway and all stateless services: safe to run 5 replicas. `location-service`: **1 replica only** until T-20 DB-mode is implemented (rate-limit buckets and memory store are in-process).

---

## T-20 — Sharded Location Store (performance at scale)

**Status:** Phases 1–4 ✅ complete (2026-03-23). Phase 5 deferred. Details in TICKETS_DONE.md.

### Phase 5 — Auto-adjustable shard size (deferred)

Track here, implement later. Idea: a background task monitors shard population sizes. If any shard exceeds a configurable `SHARD_MAX_USERS` threshold, halve `SHARD_SIZE_M` for the next startup (write to a `_meta` doc). If all shards fall below `SHARD_MIN_USERS`, double it. Requires graceful re-bucketing logic. Low priority until real load data exists.

---

## T-21 — Continental location-service routing

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

**Status:** Not started. Requires backend work.

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

### Problem

**Status:** Open. SERIOUS. HIGHEST PRIORITY.

When a user logs out immediatly after login, without interacting with the page the LOGIN MODAL HAS GOT THE FULL CREDENTIALS (EMAIL + PASSWORD) FILLED. ANYONE USING THE COMPUTER CAN TAKE OVER THE ACCOUNT. The credentials must be explicitly nulled / dropped immediately after a successful login and after the modal is closed!

Only happens if the logout happens immediately after login. If a user logs in, clicks somewhere and then logs out. The login modal is empty.

### Owner's Comments

This is a privacy-by-design app. Keep that in mind. Reflect on that and avoid any privacy related issue in the future. Always!

---

## T-19 Notification banner on the map

**Status:** Open

### Problem 

The app's rate limits (login, guest session) have strict rate limits. It's logged in the console, but the avg user doesn't see any notifaction, only an error. Since it affects only the login-, registration-modals and guest sessions, there should be a notification banner on the top of map just below that main mennu bar, stating that the actioned attempted is rate-limited in the development environment. Asking for support to open up the app and provide a link to /donate.

I think the notification banner already exists, just add the message.

