# CLAUDE.md — Change History

Two entry types:
- **CHANGE:** a modification to CLAUDE.md or persistent file structure
- **REFLECTION:** a mistake or friction identified during wrap-up; what it was and what rule was added or changed to prevent recurrence

Never edit or remove existing entries.

---

2026-03-19 — Clarified "Backend changes required" to list only manual owner actions, not code already committed.
2026-03-19 — Split AUDIT.md into three files (AUDIT.md, AUDIT_SECURITY.md, AUDIT_PERFORMANCE.md) and added AUDIT_DONE.md for resolved items; updated Pre-Session Checklist, Wrap-Up Checklist, and Persistent Files section accordingly.
2026-03-19 — Full rewrite: restructured into labelled sections (Definitions, Pre-Session Checklist, Ticket Workflow, After Each Commit, Wrap-Up Checklist, Persistent Files, Rules); added session-start and wrap-up signal definitions; added Ticket Workflow pre-flight steps; added structured post-commit reporting requirement; added self-improvement step to wrap-up; added CHANGELOG.md as a fourth persistent file; removed harness branch-check from session start; removed orphaned Branch definition.
2026-03-19 — Wrap-Up Checklist step 6: removed "create a PR" instruction; owner creates PRs from the UI.
2026-03-19 — Split AUDIT.md infrastructure/maintainability/usability sections into AUDIT_INFRASTRUCTURE.md, AUDIT_MAINTAINABILITY.md, AUDIT_USABILITY.md; AUDIT.md is now an index with a global summary table; updated Pre-Session Checklist, Wrap-Up Checklist step 3, and Persistent Files accordingly.
2026-03-19 — Added INFRA-/MAINT-/UX- prefixes to audit item IDs to match existing SEC-/PERF- convention; updated all concern files, AUDIT.md global summary, and AUDIT_DONE.md.
2026-03-19 — Removed redundant file list from Wrap-Up Checklist step 3 (already in Persistent Files); removed "See also" nav lines from all concern files.
2026-03-19 — REFLECTION: Missed applying INFRA-/MAINT-/UX- ID prefixes when splitting audit files, even though SEC-/PERF- were already established as the convention. Owner had to correct it. Fix: added prefix convention to Persistent Files section in CLAUDE.md so it is explicit and cannot be missed again.
2026-03-19 — CHANGE: Updated CHANGELOG.md description in CLAUDE.md — it now records both CHANGE and REFLECTION entries, not just CLAUDE.md edits; format updated accordingly.
2026-03-19 — CHANGE: Added ID prefixes (INFRA-, MAINT-, UX-, SEC-, PERF-) explicitly to each audit file description in Persistent Files section.
