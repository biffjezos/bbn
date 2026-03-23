# CLAUDE.md — Change History

Two entry types:
- **CHANGE:** a modification to CLAUDE.md or persistent file structure
- **REFLECTION:** a mistake or friction identified during wrap-up; what it was and what rule was added or changed to prevent recurrence.

Never edit or remove existing entries.

---

## Friction Label Taxonomy

Short labels used to tag REFLECTION entries. Enables pattern detection across sessions.

- **Mixed scope** — Claude included things outside the intended audience or responsibility boundary (e.g. reporting its own commits as owner actions).
- **Pattern blindness** — An existing convention was visible by example in the codebase but Claude failed to infer and apply it.
- **Redundancy** — Claude produced output or structure that duplicated something already present elsewhere.
- **Premature rule** — A rule was added before the actual problem was confirmed; rule didn't match reality.
- **Scope creep** — Claude made changes beyond what was asked, touching things that weren't part of the task.
- **Wrong target** — Claude applied a change, output, or action to the wrong file, location, or recipient.
- **Silent deviation** — Claude changed approach without stating it, making the owner discover the change after the fact.
- **Over-explanation** — Claude produced more prose or steps than the situation warranted, burying the key point.
- **Under-reading** — Claude acted without reading enough context, leading to a decision based on incomplete information.
- **False confidence** — Claude stated something as certain that was actually ambiguous or unverified.

---
## Reflection

The most recurring failure mode is **acting before reading enough context** (under-reading): stale tickets listed as priorities, migrations designed for a dev environment with no users, library behaviour assumed without verification. The fix is always the same — read first, confirm context, then act.

A second pattern is **circular reasoning on agreed designs**: once the owner confirms an approach (cryptographic or otherwise), stop re-opening it. Propose once, get confirmation, commit to it. Related: never design for production migration complexity when the owner has already said the DB is empty.

Structural fixes already applied: pre-commit ticket + audit update steps, friction awareness check before acting, explicit ID prefix conventions in audit files, post-commit reporting scope limited to owner actions only.


---

## Log

- 2026-03-23 — CHANGE: Added "Update audit files" step to "Before Each Commit / Push" checklist and explicit stub/non-speculative-read rules to the AUDIT_DONE.md section — audit files now follow the same move-and-stub workflow as ticket files.
- 2026-03-23 — CHANGE: Added "Update tickets" step to "Before Each Commit / Push" checklist — requires moving completed phases/tickets to TICKETS_DONE.md and updating status lines before every commit, not only at wrap-up.
- 2026-03-19 — CHANGE: Added "Friction Awareness" section to CLAUDE.md — instructs future sessions to consult the friction label taxonomy as a pre-action check, not just a retrospective log.
- 2026-03-19 — CHANGE: Added ID prefixes (INFRA-, MAINT-, UX-, SEC-, PERF-) explicitly to each audit file description in Persistent Files section.
- 2026-03-19 — CHANGE: Updated CHANGELOG.md description in CLAUDE.md — it now records both CHANGE and REFLECTION entries, not just CLAUDE.md edits; format updated accordingly.
- 2026-03-19 — CHANGE: Split AUDIT.md infrastructure/maintainability/usability sections into AUDIT_INFRASTRUCTURE.md, AUDIT_MAINTAINABILITY.md, AUDIT_USABILITY.md; AUDIT.md is now an index with a global summary table; updated Pre-Session Checklist, Wrap-Up Checklist step 3, and Persistent Files accordingly.
- 2026-03-19 — CHANGE: Wrap-Up Checklist step 6: removed "create a PR" instruction; owner creates PRs from the UI.
- 2026-03-19 — CHANGE: Full rewrite: restructured into labelled sections (Definitions, Pre-Session Checklist, Ticket Workflow, After Each Commit, Wrap-Up Checklist, Persistent Files, Rules); added session-start and wrap-up signal definitions; added Ticket Workflow pre-flight steps; added structured post-commit reporting requirement; added self-improvement step to wrap-up; added CHANGELOG.md as a fourth persistent file; removed harness branch-check from session start; removed orphaned Branch definition.
- 2026-03-19 — CHANGE: Split AUDIT.md into three files (AUDIT.md, AUDIT_SECURITY.md, AUDIT_PERFORMANCE.md) and added AUDIT_DONE.md for resolved items; updated Pre-Session Checklist, Wrap-Up Checklist, and Persistent Files section accordingly.
