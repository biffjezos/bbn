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

1. Read `.claude/AUDIT.md` (the index and global summary table). Do not read individual concern files speculatively — open them only when you need full context on a specific item. Do not read the rest of the codebase speculatively.
2. Read `.claude/TICKETS.md` for pending tickets relevant to this session.
3. Greet the owner, present the last audit summary, and ask what to do.

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

## Before Each Commit / Push

- **Update tickets.** Reflect the current state of any ticket touched this session:
  move completed phases/tickets to `TICKETS_DONE.md` (leave a stub), update status
  lines, add any newly discovered tickets. Do this before every commit, not only at wrap-up.
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

## Session Wrap-Up Checklist

When the owner signals a wrap-up (see Definitions), run these steps in order
without asking for permission:

1. Update audit files — add new findings to the correct concern file, move resolved items
   to `AUDIT_DONE.md`, update existing entries, and **keep the global summary table in
   `AUDIT.md` in sync** (update the status cell for any item that changed). File names
   and their concerns are listed in the Persistent Files section below.
2. Update `.claude/TICKETS.md` — move completed tickets/phases to
   `TICKETS_DONE.md`, leave stubs, add any new tickets discovered during the
   session.
3. If there are 10 or more `REFLECTION` entries in the `Log`-section of the `CHANGELOG.md`,
   compact them into the section `Reflection`. The essentials must remain in the Summary
5. If there are 25 or more entries `CHANGE` in the `Log`-section of the `CHANGELOG.md, remove
   the oldest entries (by date) until the total counts 15.
7. Commit all outstanding changes to the session branch, including all updated files.
8. Inform the owner the branch is pushed and ready — they will open the PR from the UI.

---

## Persistent Files

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

### `.claude/TICKETS.md` — Feature backlog
Contains: planned features, postponed work, architectural proposals,
implementation strategies. You maintain it. The project owner may also add
items directly. Do not remove tickets unless the owner explicitly says to.

### `.claude/TICKETS_DONE.md` — Completed tickets archive
Contains: tickets and phases that are fully implemented and deployed. Move
tickets/phases here when complete — never delete them.

Rules for moving:
- Move a **whole ticket** only when **all its phases and sub-tasks are done**.
- Move a **phase** (e.g. T-06 Phase 1) individually if it is self-contained and
  complete, even if other phases of the same ticket remain pending.
- Never move a ticket or phase that has unresolved sub-tasks.
- After moving, leave a one-line stub in TICKETS.md pointing to TICKETS_DONE.md
  (e.g. `Phase 1 ✅ complete (date). Details in TICKETS_DONE.md.`).
- Read TICKETS_DONE.md only when you need historical context for a specific
  ticket — not on session start, not speculatively.

### `.claude/CHANGELOG.md` — Change history and reflections
Append an entry during every wrap-up. Two entry types:
- **CHANGE:** a modification to CLAUDE.md or persistent file structure — what changed and why.
- **REFLECTION:** a mistake or friction from the session — what went wrong and what rule was added or changed to prevent recurrence.

Format: `YYYY-MM-DD — [CHANGE|REFLECTION]: <description>`.
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
