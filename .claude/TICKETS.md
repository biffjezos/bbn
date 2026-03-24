# bOOmbOOm.NOW! — Ticket Index

Each ticket lives in `.claude/tickets/<id>.md`. Completed tickets are in `.claude/tickets/done/`.
This file lists only open, active, planned, and deferred tickets — one row each, sorted by priority.

---

## Open / Active / Planned

| ID | Status | Priority | Title | Phase |
|---|---|---|---|---|
| [T-24](tickets/T-24.md) | planned | high | Profile Data Encryption | 0/4 |
| [T-25](tickets/T-25.md) | planned | medium | Per-User OPRF Key Rotation | 0/3 |
| [T-05b](tickets/T-05b.md) | planned | medium | Encrypted note field in blocks | — |
| [T-06](tickets/T-06.md) | deferred | medium | Venue Accounts — Phase 2 (venue messaging) | 2/3 |
| [T-07b](tickets/T-07b.md) | open | medium | Device Notifications | — |
| [T-09](tickets/T-09.md) | open | medium | Role CRUD with Permissions UI | — |
| [T-02](tickets/T-02.md) | open | low | Analytics (anal.js / analytics-service) | — |
| [T-14](tickets/T-14.md) | deferred | low | Manager-tier venue quota | — |
| [T-15](tickets/T-15.md) | deferred | low | Orphan Venue Reassignment | — |
| [T-20](tickets/T-20.md) | deferred | low | Sharded Location Store — Phase 5 only | 4/5 |
| [T-21](tickets/T-21.md) | deferred | low | Continental location-service routing | — |

---

## Architectural Decisions

**2026-03-16:** Access control model: Enhanced RBAC + access gates. No full ABAC policy engine. Roles stored as DB documents (T-09 schema). Dual-control access via a shared `access_requests` collection — not a policy engine.

---

## Owner's Comments

- Generally agreed on the implementation order. T-05, T-03 approved for implementation, but need clarification. See ticket comments.
- 2026-03-16: Agreed. Enhanced RBAC + access_requests. No encryption of the optional note for now.
- 2026-03-24: Ticket structure migrated to individual files in `.claude/tickets/`.
