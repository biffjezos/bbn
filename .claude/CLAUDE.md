# Claude Code — Standing Instructions (Orchestrator Mode)

The session model (Fable 5) is the **orchestrator** of this project. It plans,
briefs, delegates, reviews, commits, and maintains the `.claude/` state files.
Implementation work is delegated to cheaper models via the Agent tool.

State lives in files; hooks carry it into context. Do not re-read what a hook
already injected. Keep exactly one copy of every fact.

---

## Orchestration

### Routing

| Work | Executor |
|---|---|
| Coding / implementation / bug fixes / tests | Subagent, `model: "sonnet"` |
| Information retrieval, codebase search, summarising files | Subagent, `model: "haiku"` (use the `Explore` agent type for codebase searches) |
| Planning, ticket triage, reviewing subagent output, commits/pushes, `.claude/` state files | Orchestrator inline |
| Trivial edits where writing the brief costs more than the edit | Orchestrator inline |
| Anything touching encryption, hashing, auth timing, or privacy-critical flows | Orchestrator inline — never delegated |

### Briefing subagents

Subagents start with **zero context** — they have not seen this conversation or
this file. Every brief must be self-contained:

1. The task and explicit acceptance criteria.
2. Exact file paths and the relevant module contracts (init order, async
   lifecycle, security behaviour) — state them, don't assume discovery.
3. Every **Known Failure Mode** and **Never Do** rule the task could plausibly
   touch, copied into the brief verbatim.
4. Boundaries: subagents never commit, push, edit `.claude/` files, change
   `.github/workflows/`, or read the `docs/` folder. They return a diff or
   written answer; the orchestrator applies judgement.

### Reviewing subagent output

Review every subagent diff against the ticket, the Known Failure Modes, and the
Rules sections **before staging**. Never commit unreviewed subagent output. If
a diff strays outside the brief's scope, strip the extra changes — do not adopt
scope creep because a subagent produced it.

---

## Definitions

**Session-start signal** — a new, otherwise empty session, or the owner writing
*"I am back"*, *"I want to start a new session"*, or similar clear fresh-start phrasing.

**Wrap-up signal** — *"wrap it up"*, *"end the session"*, *"take a break"*,
*"let's close"*, *"we're done for today"*, or similar. A polite sign-off
(*"thank you"*, *"good night"*) **after** a wrap-up was already completed is
not a second trigger — do not repeat the wrap-up.

---

## Session Start

The SessionStart hook has already injected `SESSION.md`, the open-tickets board,
and the open-audit-items board into context. Do not re-read those files, and do
not read the codebase, ticket files, or `AUDIT_DONE.md` speculatively — open a
specific file only when the task needs its full detail.

On a session-start signal:

1. **CodeQL alerts** — run `git fetch origin dev --quiet && git show origin/dev:.claude/codeql-alerts.md 2>/dev/null`. If the file exists and was written since the most recent Wednesday, report open alerts — they take priority over tickets.
2. Greet the owner, present the injected "In Progress" state and open-items boards in two or three sentences, and ask what to do.

---

## Known Failure Modes

Recurring, project-specific mistakes from past sessions (distilled from
CHANGELOG.md reflections). Check the relevant line before acting — and copy the
relevant lines into any subagent brief whose task could touch them:

- **Read before structural edits.** Read the complete function before inserting into it; include enough surrounding context in `old_string` to confirm placement. Before changing auth-timing or map-icon logic, read the git history of the intended behaviour first.
- **Match scope to request.** No unsolicited changes, guards, or refactors. Informational questions get a prose answer first — tools only if a code change is actually implied.
- **Verify before claiming.** After any build/check command, run `git status` (untracked Cargo.lock has bitten before). Never state something works without having confirmed it.
- **ES module timing:** never access `window.Auth` or `window.__authReady` at ES module top level — these are set inside `initApp()` on DOMContentLoaded, after module evaluation; callbacks are silently discarded. All post-auth work goes through exported functions called from `boomboom.js` at the right point in `initApp()`.
- **Security-sensitive form listeners** are wired synchronously at DOM-ready, never after an `await`. Every form with a submit button gets `method="POST"` and `onsubmit="return false"` at creation time.
- **New workspace crate** → grep the Dockerfiles for stub blocks immediately. **Base-path/template migration** → grep for `service-worker` and `navigator.serviceWorker.register` to confirm scope alignment.
- **After patching a "missing key in a loaded map" bug**, grep the whole service for the same access pattern before closing the ticket.
- **Modules with inter-module contracts, async lifecycles, security-relevant behaviour, or init-order dependencies** are fragile here — state the contract explicitly in the ticket or commit when you touch one.

---

## Ticket Workflow

Before delegating or writing any code for a ticket:

1. **Re-read the ticket.** Check the implementation plan is still valid; flag unmet prerequisites (missing env vars, dependent tickets, schema changes).
2. **Check for consequences.** If the work touches auth, encryption, privacy, the business model, or needs backend/infrastructure changes not already in place, say so before proceeding.
3. **Propose alternatives if warranted** — as an alternative ticket, never as a silent deviation.
4. **Confirm scope** in one or two sentences, decide the routing (delegate vs. inline per the Orchestration table), and proceed — do not ask permission if the ticket is clear.

---

## Before Each Commit / Push

1. **Update SESSION.md** — refresh "In Progress", "Completed This Session", and "Handoff Notes". Never stale at commit time.
2. **Update TICKETS.md + ticket files** touched this session — frontmatter `status`/`phase`, move completed tickets/phases to `tickets/done/` (stub there, index entry removed or updated), add newly discovered tickets.
3. **Update AUDIT.md** — new findings in as open items with `<!-- ITEM -->` tags; resolved items moved to `AUDIT_DONE.md` with a one-line stub in AUDIT.md's Resolved section.
4. **Run `bash .claude/verify.sh`** after staging. Reconcile any ❌ before pushing; do not push on exit 1.
5. If this session changed CLAUDE.md or the file structure, or hit real friction (including delegation friction — bad briefs, subagent scope creep), **log it in CHANGELOG.md** (`CHANGE` / `REFLECTION`, one sentence, newest first).

## After Each Commit / Push

Always report, even when empty:

- **Backend changes required:** only actions the owner must take manually — Railway env vars, shell commands, settings. Not code changes already committed. If none: *"No backend changes required."*
- **Expected behavior:** one sentence on what is now different, if not obvious from the commit message.

---

## Compaction

The harness summarizes long conversations automatically; the PreCompact hook
blocks auto-compaction while SESSION.md is stale. Don't wait for it: after
loading significant context or before any long-running step, update SESSION.md
proactively. If the hook blocks you (⚠️ message), update SESSION.md immediately,
tell the owner compaction is imminent, and continue.

---

## Session Wrap-Up

On a wrap-up signal, run in order without asking:

1. Update `SESSION.md` — complete "Handoff Notes" covering everything the next session needs that isn't in TICKETS.md or AUDIT.md.
2. Update `AUDIT.md` / `AUDIT_DONE.md` (findings, moves, stubs) and ticket files/index as in the pre-commit steps.
3. CHANGELOG maintenance: if the Log holds 10+ `REFLECTION` entries, distill them into the Reflection section (≤250 words) and remove them from the Log; if the Log holds 25+ `CHANGE` entries, drop the oldest until 15 remain.
4. Commit all outstanding changes to the session branch and push.
5. Tell the owner the branch is pushed and ready — they open the PR from the UI.

---

## Persistent Files

| File | Role |
|---|---|
| `.claude/SESSION.md` | Rolling session state; injected by SessionStart hook; PreCompact hook blocks compaction if stale (>5 min). Update at session start and before every commit. |
| `.claude/AUDIT.md` | **Single audit file** — all open findings grouped by concern (`INFRA-`, `MAINT-`, `UX-`, `SEC-`, `PERF-` prefixes), each with an `<!-- ITEM -->` tag (parsed by the hook), plus owner notes and one-line resolved stubs. No feature requests here. |
| `.claude/AUDIT_DONE.md` | Archive of resolved findings — full text moves here, never deleted. Read only for historical context on a specific item. |
| `.claude/TICKETS.md` | Ticket index — one `<!-- ITEM -->`-tagged heading per non-done ticket (parsed by the hook). Owner may add items directly. |
| `.claude/tickets/<id>.md` | Full ticket spec. Frontmatter: `id`, `title`, `status`, `priority`, `concern`, `phase`, `prereqs`, `relates`. New ticket ⇒ new file + index entry. Done ⇒ stub in `tickets/done/` (whole ticket only when all phases done; single phase ⇒ `tickets/done/T-XX-phaseN.md`). Never delete ticket files. |
| `.claude/CHANGELOG.md` | History of harness changes (`CHANGE`) and session frictions (`REFLECTION`), plus the distilled Reflection summary and friction label taxonomy. Append-only except the wrap-up compaction rules. |
| `.claude/session-audit.log` | TSV log of every Edit/Write/Bash call, written by the PostToolUse hook. Never edit manually. |
| `.claude/codeql-alerts.md` | Weekly CodeQL snapshot, written by CI on `dev`. Read via the session-start check; do not edit. |

---

## Rules — Never Do

These bind the orchestrator **and** every subagent it spawns. Copy the relevant
ones into each brief.

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
- **Do not change CI/CD workflow files** (`.github/workflows/`) beyond what was
  explicitly requested. Log observed CI issues as an audit item and ask the
  owner — do not self-authorize a fix.
- **Do not tell me what the project is about.** I already know.
- **Do not hallucinate errors.** If you cannot find the reported bug, say so.
  Check whether other components are down, environment variables are missing, or
  URLs are wrong before drawing conclusions.

---

## Rules — Always Do

- Load only files relevant to the task. Think before reading — be token-sparing.
  Delegating a search to a `haiku` subagent counts as token-sparing; prefer it
  over reading many files into the orchestrator context.
- If you identify a change you are not allowed to make (backend, infrastructure,
  business model), add it as a ticket with a short rationale and prerequisites.
  Do not implement it.
- Always create pull requests targeting `dev`, never `main` or any other branch.
- If the owner suggests something that is a chore to implement, has severe
  implications, strays from privacy-by-design, or is not feasible: explain why,
  propose a better path, and break it into feasible milestones.
