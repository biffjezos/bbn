# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.
Completed tickets and phases live in `TICKETS_DONE.md`.

---

## Recommended Implementation Order

Before any marketing or scaling push, the order of priority is:

1. ~~**T-05 Phase 1**~~ — ✅ Done (2026-03-16). Details in TICKETS_DONE.md.
2. ~~**T-03**~~ — ✅ Done (2026-03-16). Details in TICKETS_DONE.md.
3. ~~**T-04a**~~ — ✅ Done (2026-03-16). Details in TICKETS_DONE.md.
4. ~~**T-04b**~~ — ✅ Done (2026-03-16). Details in TICKETS_DONE.md.
5. ~~**T-01**~~ — ✅ Done (2026-03-16). Details in TICKETS_DONE.md.
6. **T-05b** — Add encrypted note field to blocks (still waiting on OPAQUE; existing BBMCrypto is a candidate but original privacy decision stands — revisit after OPAQUE lands)
7. **T-02** — Analytics (low-risk, can slot in any time)
8. ~~**T-06 Phase 1**~~ — ✅ Done (2026-03-18): Core venue + manager role implemented. Details in TICKETS_DONE.md.
   ~~**T-06c**~~ — ✅ Done (2026-03-18): Multiple venues per manager. Details in TICKETS_DONE.md.
   - **T-06b** — Venue messaging (deferred)
9. **T-07** — Settings page + device notifications (UX polish)
10. ~~**T-04c**~~ — ✅ Done (2026-03-17). Details in TICKETS_DONE.md.
11. **T-08** — Authority service: merge auth + tiers → single authority, centralise RBAC in gateway, retire tiers-service (after T-01 + T-04c underway)

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

**Status:** Not started. Blocked on OPAQUE (T-04b followup).

T-05 Phase 1 (block mechanism + reason enum) is complete — see TICKETS_DONE.md.

Add optional encrypted note field once OPAQUE-based key derivation is in place.
Note field (`note: "..."`) — storing free-text without proper client-side encryption (pending OPAQUE) would be a privacy regression. Reason enum is not sensitive.

**Prerequisite:** OPAQUE / PAKE client-side key derivation (AUDIT.md 1.1).

---

## T-06 — Venue Accounts + Manager Role

**Status:** Phase 1 ✅ complete (2026-03-18). T-06c ✅ complete (2026-03-18). T-06b deferred.

Phase 1 implementation details are in TICKETS_DONE.md.
T-06c (multiple venues per manager): venue limit lifted — `venue_manager` can create, manage, and delete multiple venues. Details in TICKETS_DONE.md.

### Axis definitions (agreed 2026-03-18)

| Axis | Purpose | Example |
|---|---|---|
| `accountType` | What the entity IS — determines profile shape, location behaviour, UI rendering | `"venue"` has `venueName`, fixed GPS, `openingHours`; `"user"` has age, sex, live GPS |
| `tier` | What the account can REACH — feature gates and radius limits | `"premium"` = wider nearby radius, messaging enabled *(actual values are admin-configured in the DB; not defined here)* |
| `role` | What the account can DO to the system — privileged actions on other accounts | `"venue_manager"` = edit linked venue accounts (venues only); `"admin"` = full system access |

These three axes are fully orthogonal. A venue manager is `accountType: "user", role: "venue_manager"` — a regular human on the map with their own tier, who additionally has management rights over their linked venue account(s). Venues are `accountType: "venue", role: "user"`. The `venue_manager` role is scoped exclusively to `accountType: "venue"` documents — it confers no rights over other user accounts.

---

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

---

### Resolved Decisions (2026-03-18)

**1. Deletion cascades**

- Venue deleted → cascade delete: all messages where `senderId` or `recipientId` = venue `_id`, all favourites containing venue `_id`, all blocks involving venue `_id`.
- Manager account deleted → delete all linked venues first (same cascade), then delete the manager account. No orphan venue is ever left in the DB.
- Future: auto-reassignment of orphaned venues deferred to **T-09**.

**2. Venue map visibility**

- `GET /location/venues` filters server-side: returns only venues within the calling user's `nearbyRadiusM` of the user's current position. Same logic as nearby-users endpoint.

**3. Favouriting a venue in Phase 1**

- Users can favourite venues in Phase 1. The favourite is stored and the venue appears in the favourites list (quick access to opening hours, description, etc.). Messaging via the favourites channel is not enabled until Phase 2 (T-06b). No special UI state needed beyond the existing favourites card.

**4. Venue profile page**

- Reuses `/profile/:id`. The same route renders different content based on `accountType`. Venue variant shows: `venueName`, `locationType` badge, `openingHours`, `description`. No edit controls visible to non-managers.

### Owner's Comments

- 2026-03-18: Design agreed. Venue has no credentials, no login. Manager is a regular user with an added role. One venue per manager for now. Venue name/address/location immutable after creation. Tier is fixed (admin-only), no subscription yet.
- 2026-03-18: Phase 1 complete.

---

## T-09 — Orphan Venue Reassignment

**Status:** Not started. Deferred until multi-role support exists.

**Prerequisite:** A user account must be able to hold more than one role simultaneously (e.g. `admin` + `venue_manager`). Currently the system supports a single role per account, so an admin cannot also be a `venue_manager`.

**Problem:** When a `venue_manager` account is deleted, their venue(s) are currently cascade-deleted (T-06 decision). This is a data loss risk for venues that should persist under new management.

**Proposed approach (to be designed):**
- Option A: A configurable "fallback manager" per venue (set by admin at creation time). If the primary manager is deleted, ownership transfers to the fallback.
- Option B: A new interim role (e.g. `orphan_manager`) that can hold venue documents without appearing on the map as a regular user. Admin can reassign from the orphan pool.
- Option C: Venues are held in a soft-deleted / suspended state for N days after manager deletion, giving admin time to reassign before permanent deletion.

No implementation until multi-role support is landed and a preferred option is chosen.

---

## T-07 — Settings Page + Device Notifications

**Status:** Not started.

### Settings page requirements

- Route: `/settings/`
- Managed options:
  - View and remove blocked users (T-05).
  - (future) Notification preferences (opt in/out per event type).
  - (future) Privacy settings.

### Device notification requirements

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

### Owner's Comments

- Not a priority at the moment. May be postponed until after the rust port. Remind me.

---

## T-08 — Authority Service (auth + tiers consolidation + gateway-centralised RBAC)

**Status:** Not started. Addresses AUDIT.md 6.3 definitively.

### Problem

There is no single authority for user rights and limits.
Today's distribution:

| What | Where |
|---|---|
| JWT issue & tokenVersion | `auth-service` (Rust) |
| Tier definitions & feature flags | `tiers-service` (Rust) |
| Radius lookups | `tiers-service` (Rust) + hardcoded table in `location-service.js` |
| Token verification | Copy-pasted `verifyToken` in every JS service (×5) |
| Role enforcement | Copy-pasted role check in every JS service (×5) |

Any role model change (new role, new field) currently requires edits in 6+ places. This was the root cause of the admin-role cascade bug documented in AUDIT.md 6.3.

### Proposed architecture

**Step 1 — Merge auth-service and tiers-service into a single `authority-service` Rust binary:**

- All JWT issuing and verification
- tokenVersion DB check (single place, with short cache)
- Tier definitions, feature flag checks, radius lookups
- Admin role management (promote/demote, tokenVersion bumps)

Exposes a single internal endpoint:

```
POST /authority/verify
Body: { token: "...", feature?: "message_online" }
→ 200 { sub, role, tier, tv, features[], radii{} }
→ 401/403 on invalid/expired/insufficient
```

**Step 2 — Gateway becomes the single enforcer (implements AUDIT.md 6.3):**

Gateway calls `/authority/verify` once per incoming request.
On success, injects trusted headers into the proxied request:
- `X-Auth-Sub`, `X-Auth-Role`, `X-Auth-Tier`, `X-Auth-TV`
- `X-Auth-Features` (JSON array), `X-Auth-Radii` (JSON object)

Gateway's `checkTier()` becomes a header read — no separate tiers-service call.

**Step 3 — Services drop `verifyToken` copy-paste:**

Each service reads `X-Auth-*` headers instead of re-verifying the JWT.
`X-Service-Token` still protects services from external callers.
tokenVersion DB check moves entirely to the gateway step.

**Step 4 — Retire tiers-service:**

Remove from Railway once authority-service is live and all services have been migrated to header-based auth.

### Security properties

- Role and tier changes take effect immediately — gateway re-verifies on every request, not just at login.
- Stale JWT carrying a downgraded role is rejected at the gateway as soon as `tokenVersion` is bumped.
- New roles or features require changes in exactly **one place** (authority-service).
- `X-Auth-*` headers are only trusted because they are injected by the gateway; services are unreachable from the outside without `X-Service-Token`.

### Prerequisites

- T-01 complete (admin CRUD for tiers is established and tested before the service is merged)
- T-04c in progress (JS services being ported to Rust; authority header pattern is adopted as services are ported)
- No new infrastructure required

### What this is NOT

- Not a policy engine (no ABAC). The `authority/verify` response is a flat permission set, not a policy tree.
- Not a reverse proxy. The gateway remains the routing layer. Authority is a verification call only.
- Does not replace `X-Service-Token` inter-service authentication.

### Implementation order (within this ticket)

1. Extend auth-service to absorb tiers-service routes (internally, same binary, same DB).
2. Add `POST /authority/verify` endpoint.
3. Update gateway to call authority and inject headers (replaces `checkTier` + `verifyToken`).
4. Update each JS service to read headers (one service at a time, backwards-compatible).
5. When all services are updated, retire tiers-service on Railway.

### Owner's Comments

- 2026-03-16: Proposed by Claude based on the admin-role cascade bug post-mortem (AUDIT.md 6.3). Makes auth-service the true single authority for all rights and limits. Feasible once T-01 is done and T-04c is underway. tiers-service to be retired after merge.

---

## T-10 — Restore migration-service

**Status:** 🔲 Railway deployment unverified. A Rust port exists at `services/migration-service/src/main.rs`. Project owner reports service not working (2026-03-17).

### Problem

`services/migration-service.js` was accidentally deleted in commit `4a8f547`
("chore: retire Node.js services") along with the other Node.js services.
TICKETS.md T-04c explicitly states "migration-service stays Node.js (intentional)".

The gateway (`services/gateway/src/main.rs`) still calls
`POST {MIGRATION_SERVICE_URL}/migrate/run` on every boot and logs an error if
the service is unreachable. Without a running migration-service:

- MongoDB TTL indexes for `messages` and `locations` are not applied on new
  deployments (data is filtered in-query as a fallback, but not auto-purged at
  the DB level — privacy regression for data at rest).
- Migration `003_blocks_indexes` (unique index on `blocks`, index on
  `blockedUserId`) is not applied — duplicate block documents can be inserted
  (see also AUDIT.md 2.0 and 3.1-related context).
- Migration `004_tiers_seed` is not applied — tiers-service falls back to
  static tiers.

### Fix

Restore `services/migration-service.js` from git history (last known good:
commit `09f266b` or earlier) and redeploy to Railway. The file is ~179 lines of
Node.js. The Railway service for migration-service was not removed, so
redeployment should be straightforward once the file is back in the repo.

### Prerequisites

None — this is a pure restoration. The gateway already expects it.

### Priority

**HIGH** — data at rest is not being auto-purged from MongoDB; this is a
privacy regression in a privacy-by-design app.

---

## T-13 — Define and stabilise accountType / tier / role as a coherent system

**Status:** Not started.

### Problem

The three orthogonal axes that govern user identity and access are currently
ad-hoc, inconsistently applied, and underdocumented:

- **`accountType`** — `null` for regular users, `"venue"` for venue accounts.
  `null` is used as the implicit default, which means missing-field and
  "normal user" are indistinguishable. No enum or validation exists.
- **`tier`** — DB-backed (`guest`, `regular`, `premium`, `unrestricted`, …).
  Controls feature access flags and radius limits. Added to JWT. Stored in
  `users` collection. Managed via admin UI. Broadly correct but the `unrestricted`
  tier was added manually and is not in the seed migrations yet. The interaction
  between tier and accountType is undefined (e.g. does a venue get a tier?
  what does `nearbyRadiusM` mean for a venue with a fixed location?).
- **`role`** — `"user"` | `"admin"`. Controls admin actions. Added to JWT.
  Currently only two values; hardcoded in every service's `verifyToken` copy.

### Goal

Produce a written spec (in this ticket) agreed by the owner, then implement
it so every service, every JWT claim, and every UI check is consistent.

### Proposed definitions

| Axis | Values | Meaning | Who sets it | In JWT? |
|---|---|---|---|---|
| `accountType` | `"user"` (not `null`), `"venue"` | **What kind of entity** the account represents. Determines which profile fields exist, how location is handled, and which UI view renders. | Admin only (admin UI convert-to-venue / revert). New registrations always `"user"`. | Yes — `account_type` claim |
| `tier` | `guest`, `regular`, `premium`, `unrestricted`, … | **What features and radii** the account is allowed. Fully DB-backed; admin-configurable. Venue accounts can have a tier (controls their message radius). | Admin only. New registrations default to `regular`. Guests always `guest`. | Yes — `tier` claim |
| `role` | `"user"`, `"admin"`, `"venue_manager"` | **What system actions** the account may perform (read/write other users' data, call admin endpoints, manage linked venue accounts). Orthogonal to tier and accountType. | Bootstrap env var for first admin; admin UI for subsequent promotions. `venue_manager` granted by admin. | Yes — `role` claim |

### Concrete changes required

1. **Rename `accountType: null` → `accountType: "user"`** everywhere:
   - `auth-service`: set `account_type: "user"` on every new registration.
   - `users-service`: migration that sets `accountType: "user"` on all
     existing documents where the field is absent or null.
   - All services that read `account_type` from JWT or DB: treat absent/null
     as `"user"` as a backwards-compat fallback (belt-and-suspenders only).
   - Frontend `isVenueAccount()` check: remains `=== "venue"`, no change needed.

2. **Add migration `006_default_account_type`** in migration-service:
   ```
   db.users.updateMany({ accountType: { $in: [null, undefined] } },
                       { $set: { accountType: "user" } })
   ```

3. **JWT `issue_user_token`** in `common/src/auth.rs`: always emit
   `account_type` (never omit it). For non-venue accounts emit `"user"`.

4. **Tiers and venues**: document and enforce that a venue account MUST have
   a tier assigned. The tier's `messageRadiusM` is the distance within which
   a user must be to message the venue (and vice versa). The tier's
   `nearbyRadiusM` is irrelevant for venues (venues don't broadcast GPS;
   they are always visible to users within the *user's* own nearby radius).
   Document this in the tiers-service and in the admin UI tooltip.

5. **Role enum validation**: `users-service` `PATCH /admin/users/:id/role`
   currently accepts any string. Restrict to `["user", "admin", "venue_manager"]` (or the
   DB-backed roles list if T-09 is implemented first).

6. **Admin UI**: show `accountType` field as a read-only badge on every user
   row in the search results (alongside tier and role). Make it clear which
   axis is being changed when the admin clicks "Convert to Venue" vs
   "Change Tier" vs "Change Role".

7. **TICKETS.md / AUDIT.md**: once implemented, record the final definitions
   here so they can be referenced in future sessions without re-deriving them.

### Prerequisites

- T-08 (authority service) would centralise these checks, but this ticket can
  be implemented independently service-by-service.
- Migration-service must be running to apply migration 006.

### Owner's note to self

`unrestricted` stays a tier (agreed 2026-03-18). No `developer` role or accountType will be introduced. Admin role provides sufficient developer access.

---

## T-11 — Enforce 144-character plaintext limit on message send

**Status:** Not started.

### Problem

The UI input counter in `ui/scripts/messages.js` (line 254) correctly counts
down from 144 characters, but there is no enforcement on send. A user can type
more than 144 characters and the message will be submitted without error. The
messages-service validates only the *encrypted* text length (`MESSAGE_MAX_CHARS
= 4096`), which is the ciphertext length, not the plaintext.

The 144-character limit is intentional product behaviour. It must be enforced
before encryption, on the client side.

### Fix

In `messages.js`, before calling `encryptFor()`, check `text.length > 144` and
show an inline error instead of proceeding. No backend change required.

### Prerequisites

None.

---

## T-12 — Remove leftover `bbm_meet` localStorage key

**Status:** Not started.

### Problem

`ui/scripts/auth.js` `clearUserStorage()` (line 44) removes a localStorage key
`bbm_meet` that is not defined as a constant anywhere in the codebase. It
appears to be a leftover from a removed feature. The key name is undocumented
and may silently conflict with future features.

### Fix

Identify what `bbm_meet` was used for (git history), confirm it is fully
retired, then remove the `localStorage.removeItem('bbm_meet')` line from
`clearUserStorage()`.

### Prerequisites

None.

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
