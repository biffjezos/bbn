# bOOmbOOm.NOW! — Completed Tickets

Archived completed work. **Do not read on session start.** Read only when
recapping prior implementation decisions relevant to an active task.

---

## T-01 — Admin UI (`/admin`)

**Status:** ✅ Complete (2026-03-16).

### Implemented (2026-03-16)

- `services/location-service.js` — replaced hardcoded inline radius table with cached fetch to tiers-service (5 min TTL, static fallback). New env var: `TIERS_SERVICE_URL`.
- `services/users-service.js` — fixed tokenVersion check to include `admin` role. Added `requireAdmin` middleware. Added `GET /admin/users`, `PATCH /admin/users/:id/tier`, `PATCH /admin/users/:id/role`.
- `services/tiers-service/src/main.rs` — admin tier CRUD: `GET/POST /admin/tiers`, `PUT/DELETE /admin/tiers/:name`. Each handler verifies adminUser JWT + tokenVersion from DB. Cache invalidated on every write.
- `services/common/src/auth.rs` — added `AdminUser` Axum extractor (signature + role check).
- `services/server.js` — added `requireAdmin` middleware, PATCH to CORS, admin proxy routes.
- `ui/_layouts/default.html` — extended layout guard: `/admin/*` requires `role === 'admin'`.
- `ui/_includes/offcanvas-menu.html` — admin nav link (hidden by default, shown by app.js for admin role).
- `ui/scripts/app.js` — `syncOffcanvas` and `buildDesktopNav` show admin link when `role === 'admin'`.
- `ui/scripts/api.js` — admin API methods: `adminSearchUsers`, `adminSetTier`, `adminSetRole`, `adminListTiers`, `adminCreateTier`, `adminUpdateTier`, `adminDeleteTier`.
- `ui/admin/admin-index.html` + `ui/scripts/admin.js` — admin UI: user search/expand/tier+role change; tier CRUD.

### Tiers CRUD polish (2026-03-16 — follow-up session)

- `tiers-service/src/main.rs` — `admin_list_tiers`: auto-seeds static tiers into the DB on first admin access (using `count_documents` guard, not deserialization result) so edit/delete immediately target real documents. Fetches the list as raw BSON `Document` to avoid silent `try_collect` failures causing spurious re-seeding.
- `tiers-service/src/main.rs` — `admin_create_tier`: shifts all existing tiers with `rank >= new rank` up by 1 before inserting, keeping ranks contiguous.
- `ui/scripts/admin.js` — edit form now expands inline below the clicked tier row instead of at the bottom of the list; heading removed; nearby/message radius fields on a dedicated second row; clicking a different row closes the previous form.
- `ui/scripts/admin.js` — "New Tier" rank field is a select (0 → maxRank+1) labelled with the occupant tier at each position; defaults to "append".

### Notes

- First use case: create a `developer` tier with expanded nearby and messaging radii.
- Auth: a dedicated `admin` role added to JWT. **Not** created manually in DB — see bootstrap mechanism below.
- The `/admin` route must be excluded from the Jekyll public build or served from a separate path with server-side auth checks.

### On `admin` role vs tiers

`admin` is a **role**, not a tier. A tier controls feature access (see_map, message_online, etc.). A role controls what actions the user can perform on other users and system data. A user can be `tier: premium, role: admin`. They are orthogonal. The JWT must carry both.

### Bootstrap mechanism

**Problem:** You need an admin to create an admin. Manual DB edits must not be the answer — they bypass auth and are not portable.

**Solution: `ADMIN_BOOTSTRAP_USER_ID` env var on auth-service (or gateway)**

1. Developer registers a normal account via the app.
2. Sets `ADMIN_BOOTSTRAP_USER_ID=<userId>` as an env var on Railway.
3. On next service boot: if no admin exists yet, the service promotes that userId to `role: admin`, bumps their `tokenVersion`.
4. Developer re-logs in → receives a JWT with `role: admin`.
5. Env var is removed from Railway (the service is a no-op if an admin already exists, but it should be removed as hygiene).

This is the only path to the first admin. All subsequent admin promotions go through the admin UI with an authenticated admin JWT. Raw DB edits to role/tier fields have no effect without a `tokenVersion` bump, which only the service can perform.

### Owner's Comments

- Confirmed: admin is a role, not a tier. Bootstrap via env var is the right approach. Raw DB edits must not grant access.
- Do not touch without explicit permission.

---

## T-03 — DB-stored Tiers + Configurable RBAC

**Status:** ✅ Complete (2026-03-16).

### What was done

Tiers were defined as static JSON in `services/tiers-service.js`. Moved to a
`tiers` MongoDB collection. The admin UI (T-01) can add, edit, and delete tiers
without code changes.

### Tier document schema

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

### ABAC vs RBAC decision

Enhanced RBAC chosen, not ABAC. The use cases are fully covered by RBAC with:
1. Tiers stored in DB (this ticket).
2. A separate `blocks` collection checked at the message/location layer (T-05).
3. Configurable named radii stored in the tier document.

Radius values stored directly in the tier document as integers in metres.

### Implemented (2026-03-16)

- `services/migration-service.js` — migration `004_tiers_seed`: seeds guest/regular/premium into `tiers` collection (`$setOnInsert`, idempotent).
- `services/tiers-service.js` — full rewrite: MongoDB connection, 60s TTL cache (`loadTiers()`), `STATIC_TIERS` fallback if collection empty, new `GET /tiers/:name/info` endpoint, async radius lookups.
- `services/server.js` — added `GET /api/tiers/:tier/info` proxy route.
- `services/location-service.js` — fixed inline radius table (guest was 23,000 m → correct 500 m).
- `ui/scripts/api.js` — added `getTierInfo(tier)` method.
- `ui/scripts/profile.js` — replaced hardcoded `TIER_DISPLAY` / `tierFeatureHtml` with API-driven version using `getTierInfo()` (fixes AUDIT.md 3.2).

**New env vars for tiers-service:** `MONGO_URI`, `DB_NAME` (same values as other services).

---

## T-04 — Port Services to Rust

**Status:** T-04a ✅ (2026-03-16). T-04b ✅ (2026-03-16). T-04c ✅ (2026-03-17). All services + gateway now in Rust. migration-service remains Node.js (intentional).

### T-04c — What was implemented (2026-03-17)

- `services/blocks-service/` — Rust port (axum 0.8, mongodb 3)
- `services/favourites-service/` — Rust port; fixed E0716 (tokio::join! temporaries), E0728 (await in non-async closure)
- `services/messages-service/` — Rust port; E2EE ciphertext validation, route conflict fix (`/messages/{id}` combined)
- `services/users-service/` — Rust port; bcrypt via spawn_blocking, regex_escape helper, find_one_and_update with ReturnDocument::After
- `services/gateway/` — Full Axum port of server.js: 28 HTTP proxy routes, fixed-window per-IP rate limiting, CORS via tower-http, WS location + WS messages handlers (mpsc channel pattern, auth timeout, push timers), 30s health cache, migration-on-boot call
- `services/Dockerfile.*` — per-service multi-stage Docker builds with workspace stubs
- `services/Cargo.toml` — workspace updated with all new members and tower-http dep
- **Deferred (see T-08):** signed internal auth context (X-Auth-* headers); requires updating all 7 downstream services + gateway simultaneously

**New env vars for gateway:** `JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USERS_SERVICE_URL`, `LOCATION_SERVICE_URL`, `MESSAGES_SERVICE_URL`, `FAVOURITES_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`, `ALLOWED_ORIGINS` (optional, default: `https://biffjezos.github.io`), `PORT` (optional, default: 8080). **`JWT_SECRET` and `SERVICE_SECRET` are separate** — `JWT_SECRET` signs user/guest tokens; `SERVICE_SECRET` signs inter-service `X-Service-Token` JWTs.

### T-04b — What was implemented (2026-03-16)

- `services/auth-service/` — full Rust port (axum 0.8, bcrypt, mongodb 3)
- `common/src/auth.rs` — added `email` to `UserClaims`, added `issue_user_token` / `issue_guest_token`
- `role` field added to JWT (`user` | `admin`). Read from DB on login; new users get `role: user` on register.
- Bootstrap mechanism: `ADMIN_BOOTSTRAP_USER_ID` env var. On boot, if set and no admin exists, promotes that user and bumps `tokenVersion`. Safe to leave set (no-op after first run, but should be removed).
- `services/Dockerfile.auth` for Railway deployment.

**New env vars for auth-service:** `MONGO_URI`, `DB_NAME`, `JWT_SECRET`, `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use).

### T-04b — OPAQUE/PAKE (deferred)

OPAQUE requires client-side protocol participation. The Rust infrastructure is now in place. Separate workstream — see AUDIT.md 1.1.

### T-04a — tiers-service ported first

Least-risk first: read-only at runtime, smallest codebase, stateless.

### Architectural notes

- `services/common` — shared Rust crate (JWT verification, ObjectId helpers, etc.)
- Per-service multi-stage Docker builds. Railway "Root Directory" per service in dashboard settings.

---

## T-05 — Blocking & Reporting (Phase 1)

**Status:** ✅ Phase 1 complete (2026-03-16). T-05b (encrypted note) is a separate pending ticket.

### Phase split

- **T-05 (done):** Block mechanism + reason enum.
- **T-05b (pending, in TICKETS.md):** Optional encrypted note field — blocked on T-13 + OPAQUE.

### Implemented (2026-03-16)

- `services/blocks-service.js` — new service, deployed on Railway
- `services/server.js` — proxy routes + health aggregator entry
- `services/location-service.js` — block filter on nearby results (30 s cache)
- `services/messages-service.js` — block check before message delivery
- `services/users-service.js` — directional block check on `/profile`: blockee gets 404; blocker sees profile with `blockedByViewer: true`
- `services/migration-service.js` — migration `003_blocks_indexes` (pending disk space — see AUDIT.md 2.0)
- `ui/scripts/blocks.js` — `BlockModule` global, reason select modal
- `ui/scripts/api.js` — `blockUser`, `unblockUser`, `getBlocks`
- `ui/_layouts/default.html` — loads `blocks.js` on every page
- `ui/_includes/modal-pin.html` — Report/Block in map pin modal
- `ui/scripts/app.js` — wired pin block button
- `ui/scripts/profile.js` — Block/Unblock button, Blocked badge, re-renders in-place
- `ui/scripts/favourites.js` — blocked badge + disabled message btn in list/search

### `blocks` collection schema (phase 1)

```json
{
  "blockerUserId": "...",
  "blockedUserId": "...",
  "reason": "spam",
  "createdAt": "..."
}
```

Note field deferred to T-05b. Reason enum: `spam`, `harassment`, `inappropriate_content`, `fake_profile`, `other` + optional free-text (max 500 chars).

### `access_requests` collection (dual-control gate pattern, seeded here)

```json
{
  "requestedBy":  "admin_userId",
  "resourceType": "block_note",
  "resourceId":   "block_id",
  "approvedBy":   "legal_userId",
  "expiresAt":    "...",
  "usedAt":       null
}
```

This pattern is generalised in T-13.

---

## T-10 — Restore migration-service.js

**Status:** ✅ Complete (2026-03-17).

`migration-service.js` was accidentally deleted in commit `4a8f547` along with
the other Node.js services. Restored from git history and redeployed to Railway.
The gateway calls `POST {MIGRATION_SERVICE_URL}/migrate/run` on boot — service
must remain Node.js (intentional; migration-service stays JS permanently).

---

## T-11 — Enforce 144-character plaintext limit on message send

**Status:** ✅ Complete (2026-03-17).

In `messages.js`, before calling `encryptFor()`, check `text.length > 144` and
show an inline error instead of proceeding. No backend change required.

---

## T-12 — Remove leftover `bbm_meet` localStorage key

**Status:** ✅ Complete (2026-03-17).

`bbm_meet` stored `{ uid, nickname, sex }` of an early "meet target" feature.
Feature was removed (gone by commit `99df018`) but the `clearUserStorage()`
cleanup call was left behind. Confirmed fully retired via git history.
