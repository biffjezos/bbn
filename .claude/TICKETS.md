# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.
Completed tickets live in `TICKETS_DONE.md`.

---

## Recommended Implementation Order

Before any marketing or scaling push, the order of priority is:

1. **AUDIT 1.2** — Rate limit at messages-service level (security fix, small)
2. **T-07** — Settings page: blocks list (partial scope, self-contained, real user value)
3. **T-13** — Admin action approval gates (formalises access_requests pattern; prerequisite for T-05b and AUDIT 1.4)
4. **T-08** — Authority service: merge auth + tiers → single authority, centralise RBAC in gateway, retire tiers-service
5. **T-09** — Role CRUD with permissions UI (needs T-08)
6. **T-05b** — Encrypted block note field (needs T-13 for approval gate + OPAQUE for key derivation)
7. **T-02** — Analytics (low-risk, can slot in any time)
8. **T-06** — Venue accounts

### Architectural Decision (2026-03-16)

**Access control model: Enhanced RBAC + access gates. No full ABAC policy engine.**

Roles are stored as DB documents (T-03 schema). Dual-control access (e.g. admin
requesting block note decryption, legal approving it) is handled via a shared
`access_requests` collection — not a policy engine. New gates are new
`resourceType` values in that collection. This pattern ports cleanly to Rust and
requires no new infrastructure.

### Owner's Comments

- Generally agreed on the implementation order. T-05, T-03 approved for implementation, but need clarification. See my comments in the tickets and clarify open questions in the upcoming meeting.
- I wonder if T-04 should have a higher priority. Probably less code to port, we could use common libraries earlier.
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

## T-05b — Encrypted Block Note Field

**Status:** Not started. Blocked on T-13 (approval gate) and T-04b/OPAQUE (key derivation).

### What this is

Phase 2 of T-05 (see `TICKETS_DONE.md`). Adds an optional encrypted free-text
note to a block record. The note is written by the blocking user at block time,
encrypted client-side, and is only decryptable by the blocking user (via their
own key) or by an admin with an active, approved `access_request` (T-13 gate).

### Prerequisites

- T-13 ✅ (approval gate — admin access to block note requires `legal`-role approval)
- OPAQUE / T-04b key derivation (client-side encryption key derived from password, never transmitted)

### Owner's Comments

- Since blocking information may contain personal data, the note must be encrypted.
- Only the blocking user (through the UI) and an elevated account should be able to decrypt it.
- A two-dimensional access system: a higher-tier account (e.g. `legal` role) must permit access before content can be decrypted. Admin role alone is insufficient.

---

## T-06 — Venue Accounts

**Status:** Not started. T-01 ✅ and T-03 ✅ prerequisites met. Feasible now.

### Conversion workflow (confirmed 2026-03-17)

```
1. Venue owner registers a normal account (regular or premium tier) via the app.
2. Venue owner contacts admin out-of-band (email or any channel) to request conversion.
3. Admin opens admin UI → finds user → clicks "Convert to Venue".
4. Admin fills in fixed venue fields: venueName, address, fixedLat, fixedLon,
   public contact email (can differ from login email).
5. Backend: $unset { age, sex } on the user document; $set { accountType: 'venue',
   venueName, address, fixedLat, fixedLon, venueEmail }; $inc { tokenVersion: 1 }.
   Preserved: email (login), passwordHash, publicKey, encryptedPrivateKey, createdAt.
6. Backend writes (or upserts) a permanent location doc: { userId, lat: fixedLat,
   lon: fixedLon, permanent: true, updatedAt: now }.
7. Venue owner logs out and back in → receives new JWT with accountType: 'venue'.
8. Frontend detects accountType === 'venue' and renders venue profile / edit form.
9. Venue owner fills in owner-editable fields: description, openingHours,
   specialOffers (free text), website URL. Saved via PUT /users/me.
```

### DB document additions

**User document (venue):**
```json
{
  "accountType": "venue",
  "venueName":    "The Rusty Anchor",
  "address":      "12 Harbour St",
  "fixedLat":     51.5074,
  "fixedLon":     -0.1278,
  "venueEmail":   "info@rustyanchor.example",
  "description":  "...",
  "openingHours": "Mon–Sun 12:00–23:00",
  "specialOffers":"Happy hour 17:00–19:00"
}
```
`age` and `sex` are removed (`$unset`) on conversion.
`email`, `passwordHash`, `publicKey`, `encryptedPrivateKey`, `createdAt` are untouched.

**Location document (venue):**
```json
{ "userId": "...", "lat": 51.5074, "lon": -0.1278, "permanent": true, "updatedAt": "..." }
```
`permanent: true` means location-service never expires this entry from the nearby list.

### What needs to change

**`services/common/src/auth.rs`** (shared crate — ripples to all token issuers):
- Add `accountType: &str` to `UserTokenParams` and `IssuedUserClaims` / `UserClaims`.
- Default: `"user"` for all existing accounts.
- auth-service: read from DB on login; set `"user"` on register.
- users-service: pass through when re-issuing tokens.

**`services/users-service/src/main.rs`**:
- New `PATCH /admin/users/:id/account-type` endpoint (admin only): accepts venue fields, $unsets user fields, $sets venue fields, bumps tokenVersion, upserts permanent location doc.
- `UserForToken` + `make_token`: include `accountType`.
- `ProfileDoc`: include venue fields so `/users/:id/profile` returns them.
- `PUT /users/me`: allow venue-editable fields (`description`, `openingHours`, `specialOffers`, `website`); block modification of fixed fields (`venueName`, `address`, `fixedLat`, `fixedLon`) by non-admin.
- `GET /users/search`: exclude `accountType: 'venue'` from results (venues are found via map, not search).

**`services/auth-service/src/main.rs`**:
- Read `accountType` from DB and pass to `issue_user_token` on login and register.

**`services/location-service/src/main.rs`**:
- `GET /location/nearby`: include venues whose location doc has `permanent: true`
  within range, regardless of `updatedAt`. Simple: add `{ permanent: true }` as a
  second `$or` arm in the nearby query, bypassing the TTL check.
- Venues do not push GPS; their location is static after conversion.

**`services/gateway/src/main.rs`**:
- Add proxy route for `PATCH /api/admin/users/:id/account-type`.

**Frontend:**

| File | Change |
|---|---|
| `ui/scripts/api.js` | `adminSetAccountType(userId, venueData)` |
| `ui/scripts/admin.js` | "Convert to Venue" button in user row; form with fixed fields |
| `ui/scripts/profile.js` | Branch on `jwt.accountType === 'venue'`; render venue view; editable section for owner-fillable fields |
| `ui/scripts/app.js` | Map pin: `bi-house-fill` icon for venues; pin modal shows venueName + address + link to profile |
| `ui/_layouts/default.html` or `profile.html` | Venue profile section (no age/sex; add venue fields) |

### Open questions

| # | Question |
|---|---|
| OQ-1 | Can venues message users first, or only reply? (Favourites model implies mutual — confirm.) |
| OQ-2 | Should venues appear in the favourites search/list? (Probably yes — "follow a venue".) |
| OQ-3 | Can a venue be converted back to a regular user account? (Admin: $set accountType: 'user', restore age/sex fields?) |
| OQ-4 | Tier semantics for venues: does `regular` vs `premium` mean anything? Or is `venue` its own implicit tier? |
| OQ-5 | `venueEmail` on the profile — displayed publicly? Or only to users who have messaged the venue? |

### Complexity estimate

Moderate. The `accountType` addition to `common/auth.rs` is the most careful
change (touches all token-issuing paths). Everything else is additive. No new
infrastructure or new services. Realistically 1–2 sessions.

**Prerequisites:** T-01 ✅, T-03 ✅, T-04c ✅ (all Rust services in place).

### Owner's Comments

- 2026-03-17: Workflow confirmed: normal registration → out-of-band email request
  → admin converts. Fixed fields set by admin; variable fields (opening hours,
  special offers, description) set by venue owner on first login.
  Feasible to implement now — all prerequisites done.

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

**Step 3 — Services drop `verifyToken` copy-paste:**

Each service reads `X-Auth-*` headers instead of re-verifying the JWT.
`X-Service-Token` still protects services from external callers.

**Step 4 — Retire tiers-service.**

### Security properties

- Role and tier changes take effect immediately — gateway re-verifies on every request.
- Stale JWT is rejected at the gateway as soon as `tokenVersion` is bumped.
- New roles or features require changes in exactly **one place** (authority-service).

### Prerequisites

- T-01 ✅ (admin CRUD for tiers established and tested)
- T-04c ✅ (all services in Rust; authority header pattern adopted as services are ported)
- No new infrastructure required

### Owner's Comments

- 2026-03-16: Proposed by Claude based on the admin-role cascade bug post-mortem (AUDIT.md 6.3). Makes auth-service the true single authority for all rights and limits. tiers-service to be retired after merge.

---

## T-09 — Role CRUD with Permissions UI

**Status:** Not started. Requires T-08.

### Problem

Roles are currently hardcoded strings (`user`, `admin`) validated inline in each service. The admin Roles tab (added T-01 follow-up, 2026-03-16) is read-only. Adding custom roles or per-role permission sets requires:

1. A `roles` MongoDB collection: `{ name, label, permissions[], rank, createdAt }`
2. Role validation in `users-service` updated from hardcoded list to DB lookup
3. Gateway or authority service reads role permissions at request time (see T-08)
4. Admin UI: form to define role name, label, and permission toggles

### Standalone guard (can be done without T-09)

**Admin self-modification block** (AUDIT.md 1.4): prevent admins from changing their own tier or role via the API. Deferred to T-13 (approval gates) which handles it more correctly.

### Prerequisites

- T-08 (Authority service) is the natural home for role-to-permissions resolution. Without T-08, the change touches 5+ services.
- T-09 full implementation should follow T-08.

### Owner's Comments

- 2026-03-16: Raised by owner — need ability to add/edit/remove roles with permissions. Custom roles and permissions require backend work; tracked here.

---

## T-13 — Admin Action Approval Gates

**Status:** Not started. Supersedes the standalone fix in AUDIT.md 1.4.

### Problem

Admin actions currently have no tiered approval model. Any authenticated admin
can perform any admin action — including modifying their own account — without
a second check. As the app grows, some actions are sensitive enough to require
oversight (e.g. reading a user's encrypted block note) while others are routine
and can remain self-approved.

### Confirmed design decisions (2026-03-17)

| Decision | Resolved |
|---|---|
| Approval rules stored in DB, not code | ✅ Yes (DB-stored matrix, configurable via UI) |
| Auto-execute on approval | ✅ Yes (requesting admin sees "approved & executed", not "re-trigger") |
| No hardcoded roles | ✅ Yes (all roles are DB documents — depends on T-09) |
| Multiple roles per account | ✅ Yes (`roles: ["admin", "legal"]` on user document) |
| Per-action approval config | ✅ Yes (each action type: self-approval OR approval-by-{ROLE}) |
| First approver via env var bootstrap | ✅ Yes (same pattern as `ADMIN_BOOTSTRAP_USER_ID`) |
| `legal` is an example, not a hardcoded role | ✅ Yes |

---

### Existing foundation

T-05 (see `TICKETS_DONE.md`) already defines the `access_requests` collection
and the dual-control gate pattern. T-13 generalises this to a configurable,
DB-stored approval matrix covering all admin actions.

---

### Full request lifecycle (auto-execute model)

```
1. Admin triggers a gated action (e.g. role change on another user)
   → gateway detects action requires approval (reads action_gates collection)
   → access_request created: { resourceType, resourceId, requestedBy,
       actionPayload (full request: method + endpoint + body), status: pending }
   → 202 returned to admin — UI shows "Awaiting approval"

2. Approver logs into admin UI
   → Approval inbox lists pending requests visible to their role(s)
   → Approver clicks Approve (or Reject + optional comment)
   → access_request: { approvedBy, approvedAt, status: approved }
   → System immediately executes the stored actionPayload internally
   → access_request: { executedAt, status: executed }

3. Requesting admin checks status (poll or notification)
   → Sees "Approved and executed" / "Rejected: {comment}"
   → No manual re-trigger required
```

**Technical implication of auto-execute:** The `access_requests` document must
store the full intended action (`actionPayload`). On approval, the authority
service (T-08) or gateway re-dispatches the stored request internally,
authenticated as the original requester.

---

### Collection: `action_gates` (new — the configurable matrix)

Each document defines the approval rule for one action type:

```json
{
  "_id": "...",
  "resourceType": "role_change",
  "label": "Change a user's role",
  "approvalMode": "role",
  "approverRole": "owner",
  "selfApprovalAllowed": false,
  "expiryHours": 48,
  "updatedAt": "...",
  "updatedBy": "userId"
}
```

`approvalMode` values:
- `"self"` — no second approval required; action executes immediately (gate is a no-op, but still logged)
- `"role"` — approval required from any account holding `approverRole`

Changes to `action_gates` are themselves a gated action.

---

### Collection: `access_requests` (extended from T-05)

```json
{
  "_id": "...",
  "resourceType": "role_change",
  "resourceId":   "target_userId",
  "requestedBy":  "admin_userId",
  "requestedAt":  "...",
  "actionPayload": {
    "method": "PATCH",
    "endpoint": "/admin/users/:id/role",
    "body": { "role": "admin" }
  },
  "status":        "pending | approved | executed | rejected | expired",
  "approvedBy":    null,
  "approvedAt":    null,
  "executedAt":    null,
  "rejectedBy":    null,
  "rejectedAt":    null,
  "rejectComment": null,
  "expiresAt":     "..."
}
```

---

### Role model (depends on T-09)

Roles are DB documents. Any role can be assigned as approver for any action type.
An account may hold multiple roles (`roles: ["admin", "owner"]`). The approval
inbox shows requests approvable by any of the logged-in user's roles.

**The `owner` role** has authority to:
- Create, edit, and delete other roles (via T-09)
- Configure the `action_gates` matrix
- Approve any action configured to require `owner` approval

The owner role is not special in code — it is a DB role whose name is configured
to be the approver for the most sensitive action types.

**Bootstrap:** The first `owner`-role account is promoted via env var on boot:

```
OWNER_BOOTSTRAP_USER_ID=<userId>
```

Same pattern as `ADMIN_BOOTSTRAP_USER_ID`. Safe to leave set (no-op if an owner
already exists). Should be removed after first use.

---

### Action types (examples — owner configures the matrix)

| resourceType | Default approvalMode | Default approverRole | Notes |
|---|---|---|---|
| `role_change` | `role` | `owner` | Privilege escalation |
| `self_modification` | `role` | `owner` | Closes AUDIT.md 1.4 |
| `account_delete` | `role` | `admin` | Destructive |
| `block_note` | `role` | `legal` (example role) | Sensitive user data (T-05b) |
| `tier_change` | `self` | — | Routine admin task |
| `action_gate_edit` | `role` | `owner` | Editing the matrix itself |

The defaults above are seeded at first boot. Unknown action types are blocked by
default (fail-closed) — new features must register a row in `action_gates`.

---

### Admin UI additions (within T-01 scope)

- **Approval inbox** — visible to any role listed as approver; shows pending requests with requestedBy, action type, resource, timestamp
- **Approve / Reject** — one click, optional reject comment
- **Audit log** — all `access_requests`, read-only, filterable by status/type/user
- **Action Gates config** — `owner`-role only; table of `action_gates` documents; toggle self/role, assign approver role per action type

---

### Open design questions

| # | Question | Options / Notes |
|---|---|---|
| OQ-1 | What is the expiry behaviour? | (a) expired request is re-requestable; (b) original admin is notified and must re-request; (c) auto-re-request on next login |
| OQ-2 | What if auto-execution fails? | e.g. target user deleted before approval. Execution must validate preconditions; return error status if invalid. |
| OQ-3 | Must ALL members of a role approve, or any one? | Currently: any one member suffices. Unanimous quorum deferred unless needed. |
| OQ-4 | Can an action require approval from MULTIPLE roles? | Not in current schema. Would need `approverRoles: []` + quorum field. Defer unless needed. |
| OQ-5 | How are new action types registered? | Unknown types blocked by default (fail-closed). `action_gates` is the authoritative registry. |
| OQ-6 | How does `OWNER_BOOTSTRAP_USER_ID` interact with `ADMIN_BOOTSTRAP_USER_ID`? | Both can be set simultaneously (one account gets both roles). Or: owner bootstrap implies admin. Needs decision. |
| OQ-7 | Who approves edits to `action_gates` during initial bootstrap? | First owner can edit the matrix freely before a second owner exists. Gate applies once ≥2 owners exist, or immediately if configured to require owner approval. |

---

### Relationship to other tickets

| Ticket | Relationship |
|---|---|
| AUDIT.md 1.4 | Superseded. Self-modification becomes a `self_modification` gate, not a hard 403. |
| T-05b | Blocked on T-13 for the approval gate; also blocked on OPAQUE for key derivation. |
| T-08 | Auto-execute dispatch naturally lives in the authority service / gateway enforcement layer. |
| T-09 | T-13 depends on T-09 for DB-stored roles. `action_gates.approverRole` references a role document by name. |

### Prerequisites

- T-01 ✅ (admin UI foundation)
- T-05 ✅ (`access_requests` collection and pattern)
- **T-08** — auto-execute dispatch belongs in the authority service / gateway
- **T-09** — DB-stored roles required for `approverRole` references and multi-role accounts

### Owner's Comments

- 2026-03-17: Raised from AUDIT 1.4 discussion. Goal: tiered approval model;
  routine actions self-approved, sensitive actions require a second account.
  `access_requests` pattern from T-05 is the right foundation.
- 2026-03-17: Confirmed DB-stored rules, auto-execute, no hardcoded roles,
  multiple roles per account, `legal` is an example. First `owner`-role account
  bootstrapped via env var. All open design questions captured above — answer
  before implementation begins.
