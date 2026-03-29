# Claude Code — Standing Instructions

---

## Definitions

**Session-start signal** — Any of the following triggers the pre-session
checklist: a new, otherwise empty session; the owner writing *"I am back"*,
*"I want to start a new session"*, or any similar phrasing that clearly
indicates a fresh start.

**Wrap-up signal** — Any phrase that clearly signals the owner wants to close
the current session: *"wrap it up"*, *"end the session"*, *"take a break"*,
*"let's close"*, *"we're done for today"*, or similar. A polite sign-off
(*"thank you"*, *"goodbye"*, *"good night"*) said **after** a wrap-up was
already completed is **not** a second wrap-up trigger. Do not repeat the
wrap-up procedure.

---

## Pre-Session Checklist

Run this on every session-start signal, in order:

1. Read `.claude/SESSION.md` **first** — this is the most recent context and bridges any prior compaction.
2. Read `.claude/AUDIT.md` (the index and global summary table). Do not read individual concern files speculatively — open them only when you need full context on a specific item. Do not read the rest of the codebase speculatively.
3. Read `.claude/TICKETS.md` (the index) for pending tickets. Open individual ticket files in `.claude/tickets/` only when you need full detail on a specific ticket.
4. **CodeQL alerts** — run `git fetch origin dev --quiet && git show origin/dev:.claude/codeql-alerts.md 2>/dev/null`. If the file exists and was written since the most recent Wednesday, report the alerts — they take priority over tickets.
5. Greet the owner, present the last audit summary and SESSION.md "In Progress" state, and ask what to do.

---

## Friction Awareness

Before acting on any task, scan the Friction Label Taxonomy in `.claude/CHANGELOG.md`
and ask whether the current situation matches a known pattern. This is a pre-action
check, not a retrospective. Examples:

- Splitting or creating files → check for **pattern blindness** (scan existing conventions first)
- Writing output for the owner → check for **mixed scope** (is everything here their action?)
- Adding structure or content → check for **redundancy** (does this already exist?)

If a match is found, apply the known fix before proceeding.

---

## Ticket Workflow

Before writing any code for a ticket:

1. **Re-read the ticket.** Check whether its implementation plan is still
   valid. Flag any prerequisites that were not met when the ticket was written
   (missing env vars, dependent tickets not yet done, schema changes needed
   first, etc.).
2. **Check for consequences.** If the implementation touches auth, encryption,
   privacy, the business model, or requires backend/infrastructure changes not
   already in place, state this clearly before proceeding.
3. **Propose alternatives if warranted.** If a simpler or safer path exists,
   briefly describe it and let the owner decide. Create an alternative ticket
   rather than silently deviating.
4. **Confirm scope.** State what you are about to do in one or two sentences
   and proceed — do not ask for permission if the ticket is clear.

---

## Spec Workflow

Behavioral specs live in `.claude/specs/` as YAML files, organized by concern folder (e.g. `specs/ui/`, `specs/services/gateway`). Schema and general rules are defined in `.claude/specs/README.md`.

**Before touching any script or module:**

1. **Check for a spec.** Look in the relevant subfolder of `.claude/specs/` for a YAML file covering the component or behavior you are about to change.
2. **If a spec exists:** read it. Ensure your changes comply with `expected_behaviour` and `pre_conditions`. Flag any contradiction to the owner before proceeding.
3. **If no spec exists:** create one before setting the task in-progress. At minimum, define `id`, `description`, and `expected_behaviour` — in collaboration with the owner if behavior is unclear. Fill in `sources`, `pre_conditions`, and `tests` yourself.
4. **After the work:** update the spec's `status` and `qa_report` to reflect the current state.

Specs are living documents. Update them whenever behavior changes, a refactor alters the contract, or an inconsistency is found — not only when creating new features.

---

## Before Each Commit / Push

- **Update SESSION.md.** Refresh the "In Progress", "Completed This Session", and "Handoff Notes" sections. This must happen before every commit so the file is never stale when the PreCompact hook checks it.
- **Update tickets.** Reflect the current state of any ticket touched this session:
  update the frontmatter `status`/`phase` in the individual ticket file, move completed
  phases/tickets to `.claude/tickets/done/` (create a stub there), update the TICKETS.md
  index row, add any newly discovered tickets as new files. Do this before every commit,
  not only at wrap-up.
- **Update specs.** For every module touched this session, ensure the relevant spec file in `.claude/specs/` reflects the current state — update `status`, `qa_report`, or `expected_behaviour` as needed. If no spec existed and one was created, confirm it is committed.
- **Update audit files.** If any audit item was resolved or its status changed during this
  session, move it to `AUDIT_DONE.md` (leave a stub), update the source concern file, and
  keep the global summary table in `AUDIT.md` in sync. Do this before every commit, not only at wrap-up.
- **Run verify.sh.** After staging and before pushing, run `bash .claude/verify.sh`. Reconcile any ❌ failures — missing stubs, stale SESSION.md — before pushing. Do not push if verify.sh exits 1.
- **Reflect.** Identify anything that slowed the session down or caused
   friction: unclear rules, missing context, a workflow step that broke, a
   ticket structure that wasn't useful. Be brief and honest. You may ask the
   Project Owner about their perspective if uncertain.
- **Improve.** If a change to CLAUDE.md or the ticket file structure would
   prevent the identified friction in future sessions, apply it now. Log every change
   made to CLAUDE.md in `.claude/CHANGELOG.md` — one sentence per change, with
   date and tag `CHANGE`or `REFLECTION` (see Persistent Files).

## After Each Commit / Push

After every commit and push, always report — even if there is nothing to report:

- **Backend changes required:** list only actions **the owner must take manually** —
  env vars to add, update, or remove in Railway; shell commands to run; Railway
  settings to change. Do NOT list code changes already committed. If none, write
  *"No backend changes required."*
- **Expected behavior:** one sentence describing what is now different or new,
  if not obvious from the commit message or ticket title (e.g. *"User documents
  in the `users` collection now include a `preferences` sub-object."*).
---

## Context Window Awareness

The PreCompact hook will automatically fire before auto-compaction and block until SESSION.md is updated. But do not wait for the hook — be proactive:

- After any large file-loading operation (reading 5+ files, ingesting a full service), note this explicitly.
- If a session has been running for many exchanges or you have loaded significant context, say so: *"This session is getting deep — I'll update SESSION.md now as a precaution."*
- Never let SESSION.md go stale for more than one commit cycle.

If the PreCompact hook blocks you (you see the ⚠️ message): immediately update SESSION.md, inform the owner that compaction is about to happen, then proceed. The hook will allow compaction once SESSION.md is fresh.

---

## Session Wrap-Up Checklist

When the owner signals a wrap-up (see Definitions), run these steps in order
without asking for permission:

1. Update `.claude/SESSION.md` — write a complete "Handoff Notes" section covering everything the next session needs that isn't in TICKETS.md or AUDIT.md.
2. Update audit files — add new findings to the correct concern file, move resolved items
   to `AUDIT_DONE.md`, update existing entries, and **keep the global summary table in
   `AUDIT.md` in sync** (update the status cell for any item that changed). File names
   and their concerns are listed in the Persistent Files section below.
3. Update spec files — for every module touched this session, ensure its spec in `.claude/specs/` is current (`status`, `qa_report`, `expected_behaviour`). Newly created specs must be committed.
4. Update ticket files — move completed tickets/phases to `.claude/tickets/done/`
   (create a stub file there), update the individual ticket file's frontmatter,
   update the TICKETS.md index row, add any new tickets as new files in `.claude/tickets/`.
5. If there are 10 or more `REFLECTION` entries in the `Log`-section of the `CHANGELOG.md`,
   compact them into a 250 words max. summary in the `Reflection` section including the essence of the existing reflections and **remove them from the Log**. The Log retains only `CHANGE` entries after compaction.
6. If there are 25 or more entries `CHANGE` in the `Log`-section of the `CHANGELOG.md`, remove
   the oldest entries (by date) until the total counts 15.
7. Commit all outstanding changes to the session branch, including all updated files.
8. Inform the owner the branch is pushed and ready — they will open the PR from the UI.

---

## Persistent Files

### `.claude/SESSION.md` — Rolling session state *(read first)*
Contains: current branch, what is in progress, key decisions made this session (not yet in TICKETS.md),
completed work with commit hashes, and handoff notes for the next session.
Updated by Claude at session-start and before every commit. The PreCompact hook checks this file's
freshness — if stale (>5 min), it blocks auto-compaction until updated.

### `.claude/session-audit.log` — Automated action log
Contains: timestamped TSV entries for every Edit, Write, and Bash tool call this session.
Written by the PostToolUse hook — not by Claude directly. Read it via `verify.sh` to confirm
what was actually done. Do not edit this file manually. Append-only.

### `.claude/AUDIT.md` — Audit index
Contains: links to all concern files (with descriptions), owner notes / open questions,
and the **global summary table** of every open and resolved finding across all concerns.
Cross-concern items that don't fit any single concern file also go here.
You are the owner. Keep the global summary table in sync whenever any concern file changes.
Do not put feature requests or roadmap items here.

### `.claude/AUDIT_INFRASTRUCTURE.md` — Infrastructure log (`INFRA-` prefix)
Contains: Railway/MongoDB environment issues, service dependencies, deployment constraints,
one-time backend operations required. Same ownership rules as AUDIT.md.

### `.claude/AUDIT_MAINTAINABILITY.md` — Maintainability log (`MAINT-` prefix)
Contains: code structure issues, duplication, architectural debt, patterns that complicate
future changes. Same ownership rules as AUDIT.md.

### `.claude/AUDIT_USABILITY.md` — Usability log (`UX-` prefix)
Contains: user-facing friction, UX issues, interaction flows that degrade the user experience.
Same ownership rules as AUDIT.md.

### `.claude/AUDIT_SECURITY.md` — Security log (`SEC-` prefix)
Contains: security bugs, vulnerabilities, auth/privacy concerns. Filed
separately so security issues are never buried. Same ownership rules as AUDIT.md.

### `.claude/AUDIT_PERFORMANCE.md` — Performance log (`PERF-` prefix)
Contains: performance bottlenecks, slow queries, inefficient patterns, scaling concerns.
Filed separately for the same reason. Same ownership rules as AUDIT.md.

### `.claude/AUDIT_DONE.md` — Resolved audit items archive
Contains: resolved findings from any audit file. Move items here when fixed —
never delete them. Note which file they came from and when they were resolved.

Rules for moving:
- Move an item only when the fix is confirmed in code (not just planned).
- After moving, leave a one-line stub in the source concern file pointing to AUDIT_DONE.md
  (e.g. `SEC-1.7 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md`).
- Items that are code-complete but have outstanding deployment steps (env vars, DB ops)
  stay in the concern file until fully live.
- Read AUDIT_DONE.md only when you need historical context for a specific item —
  not on session start, not speculatively.

### `.claude/TICKETS.md` — Ticket index *(read at session start)*
Contains: one-row summary per open/active/planned/deferred ticket with link, status, priority, title, and phase.
Also contains cross-ticket architectural decisions. Done tickets are not listed here — they live in `tickets/done/`.
The project owner may add items directly. Do not remove rows unless the ticket moves to done or the owner says to.

### `.claude/tickets/<id>.md` — Individual ticket files
Contains: full spec, implementation phases, owner comments, and current status for one ticket.
Frontmatter fields: `id`, `title`, `status`, `priority`, `concern`, `phase`, `prereqs`, `relates`.
Read individual files only when you need full detail — not on session start, not speculatively.

Rules for creating and moving:
- **New ticket:** create `.claude/tickets/T-XX.md` with YAML frontmatter; add a row to TICKETS.md index.
- **Move a whole ticket to done:** create `.claude/tickets/done/T-XX.md` (summary + what was done);
  update the TICKETS.md index row to link to `tickets/done/`. Move a whole ticket only when
  **all its phases are done**.
- **Move a phase to done:** create `.claude/tickets/done/T-XX-phaseN.md`; update the parent
  ticket file to show the phase as complete; update the TICKETS.md index phase column.
- Never delete ticket files — archive, don't remove.
- Read `tickets/done/` only when you need historical context for a specific ticket.

### `.claude/specs/` — Behavioral specifications *(read before touching any module)*
Contains: one YAML file per feature/component/behavior, organized by concern subfolder (`specs/ui/`, `specs/services/<name>`, etc.). Each file defines `id`, `description`, `expected_behaviour`, `pre_conditions`, `sources`, `tests`, and `status`. Schema and general rules are in `specs/README.md`.

Rules:
- Read the relevant spec before modifying any module — do not proceed without it.
- Create a spec if none exists; at minimum define `expected_behaviour` before starting work.
- Update `status` and `qa_report` after changes are complete.
- Do not read spec files speculatively — only load the ones relevant to the current task.
- Specs carry forward across sessions via git — no separate index needed; SESSION.md notes which specs were created or updated.

### `.claude/CHANGELOG.md` — Change history and reflections
Append an entry during every wrap-up. Two entry types:
- **CHANGE:** a modification to CLAUDE.md or persistent file structure — what changed and why.
- **REFLECTION:** a mistake or friction from the session — what went wrong and what rule was added or changed to prevent recurrence.

Format: `YYYY-MM-DD — [CHANGE|REFLECTION]: <description>`. Newest entries go at the top of the Log section.
Never edit or remove existing entries.

---

## Rules — Never Do

- **Do not change the business model.** No changes to account types, tier
  definitions, or features available per tier without explicit permission.
- **Do not touch encryption or hashing.** Never remove, replace, or modify any
  working hash or encryption function.
- **This is a privacy-by-design app.** Never allow data leaks, plain passwords,
  email addresses, or encrypted data to be stored or transmitted unless strictly
  required for one specific action.
- **Do not make changes that require unplanned backend modifications**, such as
  running multiple service instances, adding geospatial database filtering,
  switching databases, or adding infrastructure (e.g. Redis).
- **Do not read the `docs` folder.** Do not open, reference, or base
  suggestions on those files without explicit permission.
- **Do not change `var DEBUG` in `ui/scripts/api.js`** without explicit
  permission.
- **Do not change CI/CD workflow files** (`.github/workflows/`) beyond what was explicitly requested. If a CI quality or configuration issue is observed, log it as an audit item and ask the owner — do not self-authorize a fix.
- **Do not tell me what the project is about.** I already know.
- **Do not hallucinate errors.** If you cannot find the reported bug, say so.
  Check whether other components are down, environment variables are missing, or
  URLs are wrong before drawing conclusions.

---

## Rules — Always Do

- Load only files relevant to the task. Think before reading — be token-sparing.
- If you identify a change you are not allowed to make (backend, infrastructure,
  business model), add it to `.claude/TICKETS.md` with a short rationale and
  prerequisites. Do not implement it.
- Always create pull requests targeting `dev`, never `main` or any other branch.
- If the owner suggests something that is a chore to implement, has severe
  implications, strays from privacy-by-design, or is not feasible: explain why,
  propose a better path, and break it into feasible milestones.
