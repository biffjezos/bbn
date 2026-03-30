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

**Under-reading** is the most recurring failure: acting before loading enough context — stale tickets treated as live priorities, migrations built for a DB that was already wiped, library behaviour assumed rather than verified, workflows written to push to a branch without checking whether it is protected. Fix: read first, confirm context, then act.

**Scope creep** is the second pattern: making unsolicited changes (CI/CD autobuild, auth storage rewrites, re-registration logic for non-existent legacy users, multi-file explorations triggered by a simple question). Fix: match the scope of action to the scope of the request. If it wasn't asked for, don't do it.

**False confidence / incomplete verification**: stating that something works before confirming it does (CodeQL Rust autobuild, Cargo.lock not staged after build). Fix: after any build/check command, run `git status`; before any CI change, verify the toolchain actually supports it.

**Over-explanation**: CLAUDE.md instructions written as design rationales rather than directives; answers to informational questions buried under file reads and exploratory tool use. Fix: instructions are directives — state the action, not the reasoning. Questions get prose answers first; tools follow only if a code change is actually implied.

**Wrong target / pattern blindness**: derive attributes left in wrong position after struct insertion; new Cargo workspace members added without updating Dockerfiles. Fix: when editing struct definitions include the derive in `old_string`; when adding a crate, grep Dockerfiles for stub blocks immediately.

Structural fixes applied across sessions: pre-commit ticket + audit update steps; friction awareness check before acting; CI/CD workflow changes require explicit instruction; SESSION.md harness-enforced via hooks; informational questions answered in prose before tools are used; `git status` after any build command.


---

## Log

- 2026-03-30 — REFLECTION: [Under-reading] Service worker was registering with scope `/bbn/` (Jekyll base path) — not caught during T-28 template migration because the service worker registration path wasn't checked. Fix: when migrating base paths in templates, always grep for `service-worker` and `navigator.serviceWorker.register` to confirm scope/path alignment.
- 2026-03-29 — CHANGE: T-28/T-29/T-30 planned and T-28 Phase 1 implemented — new `server` Rust crate (Axum + Tera) replaces Jekyll/GitHub Pages; HTTP+WS reverse proxy to gateway; Dockerfile.server; workspace updated.
- 2026-03-29 — CHANGE: Added Spec Workflow to CLAUDE.md — before touching any module, check for a spec in `.claude/specs/`; create one if absent; update `status` and `qa_report` after work. Added spec update step to Before Each Commit and Session Wrap-Up Checklist. Added `.claude/specs/` entry to Persistent Files. Spec coverage grows incrementally as modules are touched (Option B approach).
- 2026-03-25 — REFLECTION: [Pattern blindness] When fixing the partial-seeding bug in `verify.rs` (load_tiers() returns DB data when non-empty but specific tier is missing → wrong radius), I did not grep for other callers of `load_tiers()` with the same `.get(&tier).map_or(default, ...)` pattern. The same bug existed in `tiers.rs::nearby_radius` and `tiers.rs::message_radius` and surfaced the next session. Fix: after patching any "missing key in a loaded map" bug, always grep the whole service for the same access pattern before closing the ticket.
- 2026-03-25 — CHANGE: Added to "Never Do" in CLAUDE.md: do not change CI/CD workflow configuration (codeql.yml, deploy.yml, etc.) beyond what was explicitly requested. Observed issues go to AUDIT.md; fixes require owner instruction.
- 2026-03-25 — CHANGE: Added pre-session step 4 to CLAUDE.md: runs `git fetch origin dev + git show` to read `.claude/codeql-alerts.md` from `origin/dev`; reports open CodeQL alerts (priority over tickets) if file was written since last Wednesday. Added `.github/workflows/fetch-codeql-alerts.yml` to auto-fetch and commit the alert snapshot every Wednesday 11:15.
- 2026-03-24 — CHANGE: Simplified TICKETS.md — removed Done table (redundant; done tickets are inferred from `tickets/done/`), removed Recommended Implementation Order (unused; owner decides each session start). Fixed T-19 incorrectly listed in the open table. Updated CLAUDE.md TICKETS.md description to match.
- 2026-03-24 — CHANGE: Migrated ticket structure from flat TICKETS.md/TICKETS_DONE.md to individual files in `.claude/tickets/<id>.md` and `.claude/tickets/done/<id>.md`. TICKETS.md is now an index. CLAUDE.md Pre-Session Checklist, Before Each Commit, Wrap-Up Checklist, and Persistent Files section updated accordingly. verify.sh updated to check the new directory structure. AUDIT.md concern file descriptions tightened to one line each.
- 2026-03-24 — CHANGE: Added SessionStart hook (empty matcher = every session start) that outputs SESSION.md content directly into context via sessionstart.sh — makes session state harness-enforced rather than behavioral. Compact matcher now also uses sessionstart.sh instead of a raw echo.
- 2026-03-24 — CHANGE: Added SessionStart hook with matcher "compact" to .claude/settings.json — fires after every context compaction to remind Claude to re-read SESSION.md before continuing.
- 2026-03-24 — CHANGE: Added collaboration harness: SESSION.md (rolling session state, read first on session resume), PostToolUse audit hook (session-audit.log), PreCompact hook (blocks auto-compaction until SESSION.md is fresh), verify.sh (post-commit artifact verification), and project-level .claude/settings.json. Updated CLAUDE.md Pre-Session Checklist (SESSION.md first), Before Each Commit (SESSION.md update + verify.sh run), Wrap-Up Checklist (SESSION.md handoff notes), added Context Window Awareness section, and added SESSION.md + session-audit.log to Persistent Files.
- 2026-03-23 — CHANGE: Added "Update audit files" step to "Before Each Commit / Push" checklist and explicit stub/non-speculative-read rules to the AUDIT_DONE.md section — audit files now follow the same move-and-stub workflow as ticket files.
- 2026-03-23 — CHANGE: Added "Update tickets" step to "Before Each Commit / Push" checklist — requires moving completed phases/tickets to TICKETS_DONE.md and updating status lines before every commit, not only at wrap-up.
- 2026-03-19 — CHANGE: Added "Friction Awareness" section to CLAUDE.md — instructs future sessions to consult the friction label taxonomy as a pre-action check, not just a retrospective log.
- 2026-03-19 — CHANGE: Added ID prefixes (INFRA-, MAINT-, UX-, SEC-, PERF-) explicitly to each audit file description in Persistent Files section.
- 2026-03-19 — CHANGE: Updated CHANGELOG.md description in CLAUDE.md — it now records both CHANGE and REFLECTION entries, not just CLAUDE.md edits; format updated accordingly.
- 2026-03-19 — CHANGE: Split AUDIT.md infrastructure/maintainability/usability sections into AUDIT_INFRASTRUCTURE.md, AUDIT_MAINTAINABILITY.md, AUDIT_USABILITY.md; AUDIT.md is now an index with a global summary table; updated Pre-Session Checklist, Wrap-Up Checklist step 3, and Persistent Files accordingly.
- 2026-03-19 — CHANGE: Wrap-Up Checklist step 6: removed "create a PR" instruction; owner creates PRs from the UI.
- 2026-03-19 — CHANGE: Full rewrite: restructured into labelled sections (Definitions, Pre-Session Checklist, Ticket Workflow, After Each Commit, Wrap-Up Checklist, Persistent Files, Rules); added session-start and wrap-up signal definitions; added Ticket Workflow pre-flight steps; added structured post-commit reporting requirement; added self-improvement step to wrap-up; added CHANGELOG.md as a fourth persistent file; removed harness branch-check from session start; removed orphaned Branch definition.
- 2026-03-19 — CHANGE: Split AUDIT.md into three files (AUDIT.md, AUDIT_SECURITY.md, AUDIT_PERFORMANCE.md) and added AUDIT_DONE.md for resolved items; updated Pre-Session Checklist, Wrap-Up Checklist, and Persistent Files section accordingly.
