# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.

---

## Recommended Implementation Order

Before any marketing or scaling push, the order of priority is:

1. ~~**T-05**~~ — ✅ Done (2026-03-16)
2. ~~**T-03**~~ — ✅ Done (2026-03-16)
3. ~~**T-04a**~~ — ✅ Done (2026-03-16): Rust tiers-service live on Railway. Static fallback active; migration 004 still blocked on disk space (AUDIT.md 2.0).
4. ~~**T-04b**~~ — ✅ Done (2026-03-16): Rust auth-service live. `role` in JWT, bootstrap mechanism. OPAQUE deferred (see T-04b note below).
5. **T-05b** — Add encrypted note field to blocks (now has correct key derivation foundation)
6. **T-01** — Admin UI (needs T-03; benefits from auth being stable)
7. **T-02** — Analytics (low-risk, can slot in any time)
8. **T-06** — Venue accounts (needs T-01 and T-03)
9. **T-07** — Settings page + device notifications (UX polish)
10. **T-04c** — Rust port: remaining services (incremental, parallel with features)

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

## T-01 — Admin UI (`/admin`)

**Status:** Not started. Blocked by T-03 (tiers must be in DB to be editable).

### Requirements

- Search users by nickname, email, or userId.
- Click a search result → expands core profile details (same fields as `/profile`).
- Change a user's tier (e.g. `regular` → `developer`). On save:
  - Backend updates `users.tier` in MongoDB.
  - Issues a new JWT for the user (bump `tokenVersion` to invalidate the old one — same pattern as password change). See AUDIT.md 1.2.
- Create, edit, and delete account types (see T-03).
- Assign account types to existing users.
- Manage tier feature flags and radii (see T-03).
- Manage venue accounts (see T-06).
- Protected route — admin-only JWT role (`role: 'admin'`). Must not be accessible to regular users.

### Notes

- First use case: create a `developer` tier with expanded nearby and messaging radii.
- Auth: a dedicated `admin` role added to JWT. **Not** created manually in DB — see bootstrap mechanism below.
- The `/admin` route must be excluded from the Jekyll public build or served from a separate path with server-side auth checks.

### On `admin` role vs tiers

`admin` is a **role**, not a tier. A tier controls feature access (see_map, message_online, etc.). A role controls what actions the user can perform on other users and system data. A user can be `tier: premium, role: admin`. They are orthogonal. The JWT must carry both.

Currently only `tier` is in the JWT. `role` needs to be added when T-01 is built. A plain DB edit to the `tier` field does not grant admin access — roles are separate and enforced separately.

### Bootstrap mechanism (prerequisite for T-01)

**Problem:** You need an admin to create an admin. Manual DB edits must not be the answer — they bypass auth and are not portable.

**Solution: `ADMIN_BOOTSTRAP_USER_ID` env var on auth-service (or gateway)**

1. Developer registers a normal account via the app.
2. Sets `ADMIN_BOOTSTRAP_USER_ID=<userId>` as an env var on Railway.
3. On next service boot: if no admin exists yet, the service promotes that userId to `role: admin`, bumps their `tokenVersion`.
4. Developer re-logs in → receives a JWT with `role: admin`.
5. Env var is removed from Railway (the service is a no-op if an admin already exists, but it should be removed as hygiene).

This is the only path to the first admin. All subsequent admin promotions go through the admin UI with an authenticated admin JWT. Raw DB edits to role/tier fields have no effect without a `tokenVersion` bump, which only the service can perform.

**Implementation note:** Must be part of T-04b (auth-service Rust port) or implemented in the current `auth-service.js` as a startup hook. Cannot be done before `role` is added to the JWT.

### Owner's Comments

- I think there are a few things to clarify, what's a developer tier vs n admin role?
- How do I create an elevated account? A change in the db ("regular" -> "admin") should not be permitted.
- Maybe T-03 answers open questions.
- Do not touch without explicit permission.
- **2026-03-16:** Confirmed: admin is a role, not a tier. Bootstrap via env var is the right approach. Raw DB edits must not grant access.

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

## T-03 — DB-stored Tiers + Configurable RBAC

**Status:** ✅ Complete (2026-03-16). Prerequisite for T-01 — now unblocked.

### Current state

Tiers are defined as static JSON in `services/tiers-service.js`. Adding or
editing a tier requires a code change and redeployment.

### Goal

Move tier definitions to a `tiers` MongoDB collection. The admin UI (T-01) can
then add, edit, and delete tiers without code changes.

### Tier document schema (proposed)

```json
{
  "name": "premium",
  "label": "Premium",
  "features": ["see_nearby", "message_online", "manage_favourites"],
  "radii": {
    "nearby_m": 5000,
    "message_m": 2000
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### ABAC vs RBAC analysis

**The question:** Should we implement ABAC (Attribute-Based Access Control) or
stick with enhanced RBAC (Role-Based Access Control)?

**Current model:** RBAC — user has a tier, tier has feature flags and radii.
`checkTier` in `server.js` checks if the user's tier allows a feature.

**ABAC** would allow policies like: *"user may send message IF tier=premium AND
distance < 500m AND recipient has not blocked sender."* More expressive but
significantly more complex: requires a policy engine, policy storage, and
context evaluation at request time.

**Recommendation: Enhanced RBAC, not ABAC.**

The use cases described (different radii per tier, features on/off per tier,
block system) are fully covered by RBAC with these additions:
1. Tiers stored in DB (this ticket).
2. A separate `blocks` collection checked at the message/location layer (T-05).
3. Configurable named radii stored in the tier document.

ABAC adds "context-aware" policy evaluation (time of day, device type, session
state). None of the described features require this. The complexity cost
outweighs the benefit at this stage.

### On decoupling distances

The proposed named distances (`hyper_close: 50m`, `very_close: 500m`, etc.) are
a cosmetic improvement over direct values in the tier document. They add an
extra lookup (distance name → metres) with no functional gain for the described
use cases. **Recommendation:** Store radius values directly in the tier document
as integers in metres. If a future admin UI needs a human-friendly name, add an
optional `label` field to the radius value — no separate collection needed.

### Migration path

1. Write a migration that reads the current static tier definitions from
   `tiers-service.js` and inserts them as documents into the `tiers` collection.
2. `tiers-service.js` switches from static JSON to DB reads (with a short cache,
   e.g. 60 s TTL, to avoid a DB hit on every `checkTier` call).
3. Admin UI endpoints for CRUD on tier documents.

### Implemented (2026-03-16)

- `services/migration-service.js` — migration `004_tiers_seed`: seeds guest/regular/premium into `tiers` collection (`$setOnInsert`, idempotent). Pending disk space (AUDIT.md 2.0) — static fallback active until applied.
- `services/tiers-service.js` — full rewrite: MongoDB connection, 60s TTL cache (`loadTiers()`), `STATIC_TIERS` fallback if collection empty, new `GET /tiers/:name/info` endpoint, async radius lookups
- `services/server.js` — added `GET /api/tiers/:tier/info` proxy route
- `services/location-service.js` — fixed inline radius table (guest was 23,000 m → correct 500 m)
- `ui/scripts/api.js` — added `getTierInfo(tier)` method
- `ui/scripts/profile.js` — replaced hardcoded `TIER_DISPLAY` / `tierFeatureHtml` with API-driven version using `getTierInfo()` (fixes AUDIT.md 3.2)

**New env vars for tiers-service:** `MONGO_URI`, `DB_NAME` (same values as other services).

### Owner's Comments

- Agreed to be of high priority, but needs clarification. Please elaborate in the upcoming meeting.
- **2026-03-16:** Approved for implementation.

---

## T-04 — Port Services to Rust

**Status:** T-04a ✅ Complete (2026-03-16). T-04b ✅ Complete (2026-03-16). T-01 now unblocked. Sequenced as T-04a/b/c — see Implementation Order.

### T-04b — What was implemented (2026-03-16)

- `services/auth-service/` — full Rust port (axum 0.8, bcrypt, mongodb 3)
- `common/src/auth.rs` — added `email` to `UserClaims`, added `issue_user_token` / `issue_guest_token` (reusable for future service ports)
- `role` field added to JWT (`user` | `admin`). Read from DB on login; new users get `role: user` on register.
- Bootstrap mechanism: `ADMIN_BOOTSTRAP_USER_ID` env var. On boot, if set and no admin exists, promotes that user and bumps `tokenVersion`. Safe to leave set (no-op after first run, but should be removed).
- `services/Dockerfile.auth` for Railway deployment.
- Identical HTTP contract to `auth-service.js` — gateway unchanged.

**New env vars for auth-service:** `MONGO_URI`, `DB_NAME`, `JWT_SECRET` (same values as other services), `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use).

### T-04b — OPAQUE/PAKE (deferred)

OPAQUE requires client-side protocol participation (JS changes to login/register forms). The Rust infrastructure is now in place. This is a separate workstream — see AUDIT.md 1.1.

### Rationale

The microservice architecture allows porting one service at a time.
Each service is isolated behind the gateway (`server.js`). As long as the
HTTP API contract (routes, request/response JSON shape) is preserved, the
gateway does not change when a service is ported.

### Recommended porting order (least risky first)

1. **tiers-service** — read-only at runtime, smallest codebase, stateless.
2. **location-service** — straightforward read/write, haversine already
   implemented in Rust's geo crates.
3. **favourites-service** — slightly more complex (range-sync, notifications),
   but self-contained.
4. **messages-service** — E2EE envelope pass-through; complex validation logic.
5. **users-service** — touches many fields; port last of the "regular" services.
6. **auth-service** — highest risk; port only after all others are stable.
7. **server.js (gateway)** — can be replaced with Axum or Actix as the final
   step, or left as Node (it's not CPU-bound).

### Directory strategy

- Keep `/services` as the current Node.js codebase.
- Create `/services-rs` for Rust services as they are developed.
- Each Rust service lives in its own subdirectory: `/services-rs/tiers/`.
- **Railway deployment:** Each Railway service has a "Root Directory" setting
  in the service dashboard (Settings → Source → Root Directory). When a Rust
  service is ready, change that one service's root directory from
  `/services/tiers-service` to `/services-rs/tiers`. No other services are
  affected. This is the correct way to do this — no folder renaming needed.
- Build command for Rust on Railway: `cargo build --release`
  Start command: `./target/release/tiers-service`

### Note on shared code

The utilities duplicated across Node services (AUDIT.md 6.1) become a Rust
shared crate. In a Cargo workspace at `/services-rs/Cargo.toml`, a `common`
crate can hold JWT verification, ObjectId helpers, etc. This is the monorepo
tooling situation Node currently lacks.

### Owner's Comments

- I wonder, if the port to rust should get a higher priority. If we port sooner, we could use common libs earlier and have less code to port.
- Tell me what you think in the upcoming meeting.
- **2026-03-16:** Priority elevated. Tiers-service first (T-04a), then auth-service + OPAQUE (T-04b) which unblocks T-05 block-note encryption. Remaining services (T-04c) follow incrementally.

> **Reminder (2026-03-16):** Once T-04 (full Rust port) is complete, upgrade the
> Railway MongoDB plan to free up disk space. This will unblock migration
> `003_blocks_indexes` (see AUDIT.md 2.0) and should be done before any growth
> push. Dev-alpha state is acceptable until then.

---

## T-05 — Blocking & Reporting

**Status:** ✅ Phase 1 complete (2026-03-16). Deployed. Blocked on T-04b for phase 2.

### Phase split

- **T-05 (done):** Block mechanism + reason enum. Deployed 2026-03-16.
- **T-05b (after T-04b):** Add optional encrypted note field once OPAQUE-based key derivation is in place.

### Requirements

- Any user can block any other user.
- When A blocks B:
  - B no longer sees A in nearby results (location-service must check the block list).
  - B cannot send messages to A (messages-service must check).
  - B cannot see A's profile (users-service must check `/profile` endpoint).
  - Any existing favourite entry between them remains (for audit), but the mutual
    requirement fails, so messaging is already prevented.
- Block requires a reason. Options: `spam`, `harassment`, `inappropriate_content`,
  `fake_profile`, `other` + optional free-text (max 500 chars).
- The block + reason is stored as a report for future moderation review.
- Blocks are visible in the user's settings page (T-07) and can be removed.
- Blocked user receives no notification that they have been blocked.

### Architecture

New `blocks` collection (T-05, phase 1 — no note field yet):
```json
{
  "blockerUserId": "...",
  "blockedUserId": "...",
  "reason": "spam",
  "createdAt": "..."
}
```

Note field (`note: "..."`) is deferred to T-05b. Storing free-text without
proper client-side encryption (pending T-04b + OPAQUE) would be a privacy
regression. Reason enum is not sensitive.

New `access_requests` collection (dual-control gate for future admin access to block data):
```json
{
  "requestedBy": "admin_userId",
  "resourceType": "block_note",
  "resourceId": "block_id",
  "approvedBy": "legal_userId",
  "expiresAt": "...",
  "usedAt": null
}
```

Admin can request access to a block record. A `legal`-role account approves
the request (time-limited). The decryption endpoint checks: `role === admin AND
active approval EXISTS for (admin_id, block_id)`. This is the access gate
pattern — no ABAC policy engine required. New resource types follow the same
pattern.

New endpoints on a new `blocks-service`:
- `POST /blocks/:userId` — block a user with reason
- `DELETE /blocks/:userId` — unblock
- `GET /blocks` — list my blocked users (for settings page)

The `location-service`, `messages-service`, and `users-service` check the
`blocks` collection directly (same MongoDB instance).

### Implemented (2026-03-16)

- `services/blocks-service.js` — new service, deployed on Railway
- `services/server.js` — proxy routes + health aggregator entry
- `services/location-service.js` — block filter on nearby results (30 s cache)
- `services/messages-service.js` — block check before message delivery
- `services/users-service.js` — directional block check on `/profile`:
  blockee gets 404; blocker sees profile with `blockedByViewer: true`
- `services/migration-service.js` — migration `003_blocks_indexes`
  (pending disk space — see AUDIT.md 2.0)
- `ui/scripts/blocks.js` — `BlockModule` global, reason select modal
- `ui/scripts/api.js` — `blockUser`, `unblockUser`, `getBlocks`
- `ui/_layouts/default.html` — loads `blocks.js` on every page
- `ui/_includes/modal-pin.html` — Report/Block in map pin modal
- `ui/scripts/app.js` — wired pin block button
- `ui/scripts/profile.js` — Block/Unblock button, Blocked badge, re-renders in-place
- `ui/scripts/favourites.js` — blocked badge + disabled message btn in list/search

### Rate limiting improvement (related — AUDIT.md 1.2)

While building the blocking feature: add per-userId rate limiting at the
messages-service level (not just the gateway WebSocket). A simple in-process
`Map<userId, { count, resetAt }>` in messages-service is sufficient for
single-instance deployment.

### Owner's Comments

- Relates to T-05. 
- Since the blocking information may contain personal information about the blocked user, I think the db entry or parts of it should be encrypted. 
- Only the blocking user (through the UI) and an elevated account (admin / dev) should be able to  decrypt and read the blocking information. 
- I could also think of a two-dimensional access system, in which a higher tier user (legal) must permit acccess (decryption in the admin ui) before the content can be decrypted. I want to avoid unrestricted access to the information. So, just because a user is an admin, access should not be granted, admins may access the information, but only if necessary and that is determined by a second account (ie a "legal"-role).
- Short: Protected content can only be accessed by certain account types, but only if really necessary. Necessity must be approved by another account (or account type)

---

## T-06 — Venue Accounts

**Status:** Not started. Requires T-01 (admin UI) and T-03 (DB tiers).

### Requirements

- Account type `venue`. Cannot be self-registered — admin converts a regular
  account to `venue` type via the admin UI (T-01).
- Venue profile fields replace `sex` and `age` with:
  - `venueName` (string)
  - `description` (text)
  - `address` (string, display only)
  - `fixedLat`, `fixedLon` (stored location — does not move with GPS)
- On map: venue appears as a house icon (`bi-house-fill` or similar), always
  visible to users within range (uses the venue's `fixedLat/fixedLon`).
- Map pin modal for venues shows name + description + link to venue profile page.
- Messaging: standard two-sided favourites required. Venues can send messages to
  users; users can message venues.
- Venues can be blocked by regular users (T-05). Blocked venues see nothing
  about that user.
- Admin flow: user registers normally → admin changes `accountType` to `venue`
  in admin UI → admin fills venue-specific fields → token is re-issued (see T-01
  + AUDIT.md 1.2).
- Venue login: same email/password, same JWT flow. Frontend detects
  `accountType: 'venue'` from the token and renders the venue profile view.

### Owner's Comments

- Not a high priority. Postponed until the rest is done. Remind me.

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

- **Web Push (Service Worker + Push API):** True device notifications, works
  when app is closed. Requires VAPID keys, a push subscription stored per user,
  and a push-sending step in the relevant service. Most powerful but most
  complex. Requires HTTPS (already satisfied).
- **In-app notifications (current NotifModule approach):** Banner + badge while
  app is open. Already built for new-favourite events. Extend the polling to
  cover other event types.
- **Recommendation:** Extend the existing NotifModule + `notifications`
  collection to cover all in-app events first. Add Web Push in a second pass
  when the event types are stable.

The existing `notifications` collection (added 2026-03-16) already supports
arbitrary `type` values. New event types are additive — no schema change needed.


### Owner's Comments

- Not a priority at the moment. May be postponed until after the rust port. Remind me.