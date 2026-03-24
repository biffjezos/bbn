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

- 2026-03-24 — REFLECTION: [Pattern blindness] Added `authority-service` to `services/Cargo.toml` workspace without updating the stub blocks in the 9 existing Dockerfiles. Required a follow-up hotfix commit. Rule: whenever a new crate is added to the Cargo workspace, immediately check all Dockerfiles for stub blocks and add a matching stub for the new crate before committing.
- 2026-03-24 — CHANGE: Added SessionStart hook (empty matcher = every session start) that outputs SESSION.md content directly into context via sessionstart.sh — makes session state harness-enforced rather than behavioral. Compact matcher now also uses sessionstart.sh instead of a raw echo.
- 2026-03-24 — CHANGE: Added SessionStart hook with matcher "compact" to .claude/settings.json — fires after every context compaction to remind Claude to re-read SESSION.md before continuing.
- 2026-03-24 — CHANGE: Added collaboration harness: SESSION.md (rolling session state, read first on session resume), PostToolUse audit hook (session-audit.log), PreCompact hook (blocks auto-compaction until SESSION.md is fresh), verify.sh (post-commit artifact verification), and project-level .claude/settings.json. Updated CLAUDE.md Pre-Session Checklist (SESSION.md first), Before Each Commit (SESSION.md update + verify.sh run), Wrap-Up Checklist (SESSION.md handoff notes), added Context Window Awareness section, and added SESSION.md + session-audit.log to Persistent Files.
- 2026-03-24 — REFLECTION: [Under-reading] Rewrote T-25 without the auto-rotation design that had been agreed in a prior session. The prior session context was not in this window; the ticket text gave no hint of it. Rule: before rewriting any ticket that references a prior design discussion, explicitly ask the owner whether prior-session context exists that isn't captured in the ticket text.
- 2026-03-23 — REFLECTION: [Under-reading] T-22 was stated as "Planned" in TICKETS.md but a context-window summary indicated the implementation was complete. In the resumed session the repeated user message ("implement it") was a context artifact from the summary, not a new instruction. Rule: when resuming from a summary, re-read the persistent files before acting on user messages that may be replays from the previous context.
- 2026-03-23 — REFLECTION: [Scope creep + Under-reading] Introduced three regressions in commit 74973d1: (1) moved auth token from localStorage to sessionStorage with a "legacy cleanup" that deleted existing tokens on init — broke all pages for all users; (2) pagehide DELETE /location applied to venue accounts — deleted venue location immediately on tab close; (3) T-25 re-registration code added despite owner having explicitly said there are no pre-OPAQUE accounts. Rule: before touching auth storage, verify current behavior is broken first. Before adding compat code, confirm compat data exists. Before adding pagehide logic that fires on navigation (not just tab close), test that it won't break accounts that must not have their location deleted.
- 2026-03-23 — REFLECTION: [Under-reading + Scope creep] Implemented T-25 re-registration for pre-T-23 accounts despite the owner having already established that there are NO users before T-23 (the DB was wiped as part of T-23 deployment). Wasted significant tokens building unnecessary migration logic. Rule: before implementing any migration or compatibility shim, explicitly verify whether legacy data exists. If T-23 deployed = DB wiped = no legacy accounts — stop there.
- 2026-03-23 — CHANGE: Added "Update audit files" step to "Before Each Commit / Push" checklist and explicit stub/non-speculative-read rules to the AUDIT_DONE.md section — audit files now follow the same move-and-stub workflow as ticket files.
- 2026-03-23 — CHANGE: Added "Update tickets" step to "Before Each Commit / Push" checklist — requires moving completed phases/tickets to TICKETS_DONE.md and updating status lines before every commit, not only at wrap-up.
- 2026-03-19 — CHANGE: Added "Friction Awareness" section to CLAUDE.md — instructs future sessions to consult the friction label taxonomy as a pre-action check, not just a retrospective log.
- 2026-03-19 — CHANGE: Added ID prefixes (INFRA-, MAINT-, UX-, SEC-, PERF-) explicitly to each audit file description in Persistent Files section.
- 2026-03-19 — CHANGE: Updated CHANGELOG.md description in CLAUDE.md — it now records both CHANGE and REFLECTION entries, not just CLAUDE.md edits; format updated accordingly.
- 2026-03-19 — CHANGE: Split AUDIT.md infrastructure/maintainability/usability sections into AUDIT_INFRASTRUCTURE.md, AUDIT_MAINTAINABILITY.md, AUDIT_USABILITY.md; AUDIT.md is now an index with a global summary table; updated Pre-Session Checklist, Wrap-Up Checklist step 3, and Persistent Files accordingly.
- 2026-03-19 — CHANGE: Wrap-Up Checklist step 6: removed "create a PR" instruction; owner creates PRs from the UI.
- 2026-03-19 — CHANGE: Full rewrite: restructured into labelled sections (Definitions, Pre-Session Checklist, Ticket Workflow, After Each Commit, Wrap-Up Checklist, Persistent Files, Rules); added session-start and wrap-up signal definitions; added Ticket Workflow pre-flight steps; added structured post-commit reporting requirement; added self-improvement step to wrap-up; added CHANGELOG.md as a fourth persistent file; removed harness branch-check from session start; removed orphaned Branch definition.
- 2026-03-19 — CHANGE: Split AUDIT.md into three files (AUDIT.md, AUDIT_SECURITY.md, AUDIT_PERFORMANCE.md) and added AUDIT_DONE.md for resolved items; updated Pre-Session Checklist, Wrap-Up Checklist, and Persistent Files section accordingly.
