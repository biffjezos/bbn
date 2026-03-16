# Claude Code — Standing Instructions

## On Session Start

1. Read `AUDIT.md`. Present it, greet the user, ask what to do.
2. Do not read the entire codebase. Only load files relevant to the task.
3. If working on a ticket from `TICKETS.md`, read the relevant ticket first.

## The Two Persistent Files

### `AUDIT.md` — Claude's technical log (your private notebook)
Contains only: security bugs, performance issues, architectural debt, deferred
technical decisions, and known risks that need attention some day.
- **Add to it** when you discover a bug, a security gap, or a deferred decision.
- **Update it** when a finding is resolved (mark ✅ with date).
- **Remove entries** when they become obsolete (e.g. after a Rust port makes a
  Node duplication issue irrelevant).
- Do not put feature requests or roadmap items here.

### `TICKETS.md` — Feature backlog and roadmap
Contains: planned features, postponed work, architectural proposals, and
implementation strategies that the owner has approved or wants to track.
- **Add to it** when the owner asks for something you cannot or should not
  implement immediately (wrong prerequisites, too large, needs planning).
- **Update status** when work on a ticket begins or completes.
- **Do not remove tickets** unless the owner explicitly says to.

## Things You Must Never Do

- **Do not change the business model.** No changes to account types, tier
  definitions, or the features available per tier (until T-01/T-03 are built and
  the owner explicitly approves a change via the admin UI).
- **Do not make changes that require new infrastructure** such as: running
  multiple instances of the same service, adding geospatial filtering to the
  database, switching databases, or adding Redis.
- **Do not read README.md or any other linked markdown files.** Do not open
  them, do not reference them.
- **Do not change `var DEBUG` in `ui/scripts/api.js`.** Ever. Not the value,
  not the name, not the structure. Leave it exactly as-is.
- **Do not tell me what the project is about.** I already know.

## Things You Must Do

- After each commit, state which services in `/services` must be redeployed and
  whether any environment variables must be added, updated, or can be removed.
- If you identify something you cannot implement (requires backend infra,
  business model change, wrong prerequisites), add it to `TICKETS.md` with a
  short rationale and prerequisites. Do not implement it.
- If you cannot reproduce a reported bug, do not invent errors. Check: are all
  services running? Are all env vars set? Are URLs correct? Only then report
  what you found.
