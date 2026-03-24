# bOOmbOOm.NOW! — Ticket Index

Each ticket lives in `.claude/tickets/<id>.md`. Done tickets live in `.claude/tickets/done/<id>.md`.
This file is the index — one row per ticket, sorted by priority.

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
| [T-16](tickets/T-16.md) | active | medium | meta collection: runtime-configurable settings | 1/2 |
| [T-19](tickets/T-19.md) | open | medium | Notification banner on the map | — |
| [T-02](tickets/T-02.md) | open | low | Analytics (anal.js / analytics-service) | — |
| [T-14](tickets/T-14.md) | deferred | low | Manager-tier venue quota | — |
| [T-15](tickets/T-15.md) | deferred | low | Orphan Venue Reassignment | — |
| [T-20](tickets/T-20.md) | deferred | low | Sharded Location Store — Phase 5 only | 4/5 |
| [T-21](tickets/T-21.md) | deferred | low | Continental location-service routing | — |

---

## Done

| ID | Completed | Title |
|---|---|---|
| [T-23](tickets/done/T-23.md) | 2026-03-24 | OPAQUE Authentication + Email Privacy |
| [T-22](tickets/done/T-22.md) | 2026-03-23 | Security Hardening & Capacity Tuning |
| [T-20 phases 1–4](tickets/done/T-20-phases1-4.md) | 2026-03-23 | Sharded Location Store (phases 1–4) |
| [T-18](tickets/done/T-18.md) | 2026-03-22 | Login modal filled after logout |
| [T-17](tickets/done/T-17.md) | 2026-03-19 | T-17 |
| [T-08](tickets/done/T-08.md) | 2026-03-24 | Authority Service + Identity Model (all 3 phases) |
| [T-08 Phase 1](tickets/done/T-08-phase1.md) | 2026-03-18 | Normalise accountType/tier/role (ex-T-13) |
| [T-07a](tickets/done/T-07a.md) | 2026-03-18 | Settings Page |
| [T-06 Phase 1 + T-06c](tickets/done/T-06-phase1.md) | 2026-03-18 | Venue Accounts Phase 1 + multi-venue |
| [T-05 Phase 1](tickets/done/T-05-phase1.md) | 2026-03-18 | Block mechanism + reason enum |
| [T-13](tickets/done/T-13.md) | 2026-03-18 | Merged into T-08 Phase 1 |
| [T-11](tickets/done/T-11.md) | 2026-03-18 | T-11 |
| [T-12](tickets/done/T-12.md) | 2026-03-18 | bbm_meet localStorage key (invalid) |
| [T-10](tickets/done/T-10.md) | 2026-03-23 | Restore migration-service (invalid) |

---

## Recommended Implementation Order

Before any marketing or scaling push:

1. **T-08 Phase 3** — Dynamic feature-tier admin UI (Phase 2 ✅ deployed 2026-03-24)
3. **T-16 Phase 2** — Remaining runtime-configurable settings
4. **T-09** — Role CRUD with Permissions UI (requires T-08 deployed)
5. **T-06b** — Venue messaging (requires T-08 for clean auth routing)
6. **T-19** — Rate-limit notification banner (quick win)
7. **T-02** — Analytics (low-risk, any time)
8. **T-05b** — Encrypted block note (requires T-24 key infrastructure)
9. **T-24** — Profile Data Encryption (HIGH complexity, HIGH privacy impact)
10. **T-14** — Manager-tier venue quota (deferred, requires T-08)
11. **T-15** — Orphan venue reassignment (deferred, requires multi-role)
12. **T-07b** — Device notifications (low priority)
13. **T-25** — Per-User OPRF Key Rotation (requires separate infrastructure)
14. **T-20 Phase 5** — Auto-adjustable shard size (deferred, needs real load data)
15. **T-21** — Continental routing (deferred, requires T-20)

---

## Architectural Decisions

**2026-03-16:** Access control model: Enhanced RBAC + access gates. No full ABAC policy engine. Roles stored as DB documents (T-09 schema). Dual-control access via a shared `access_requests` collection — not a policy engine.

---

## Owner's Comments

- Generally agreed on the implementation order. T-05, T-03 approved for implementation, but need clarification. See ticket comments.
- 2026-03-16: Agreed. Enhanced RBAC + access_requests. No encryption of the optional note for now.
- 2026-03-24: Ticket structure migrated to individual files in `.claude/tickets/`.
