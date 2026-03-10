# Claude Code — Standing Instructions

## Things You Must Never Do

- **Do not change the business model.** No changes to account types, tier definitions, or the features available per tier.
- **Do not make changes that require backend modifications** such as: running multiple instances of the same service, adding geospatial filtering to the database, switching databases, or adding infrastructure (e.g. Redis) to handle higher load.
- **Do not read README.md or any other linked markdown files.** Do not open them, do not reference them.
- **Do not tell me what the project is about.** I already know.

## Things You Must Do

- **If a session begins:** Read `AUDIT.md` first. Do not read the entire codebase. Greet me, present the last `AUDIT.md`, and ask what to do. Only then load files relevant to the task.
- **If you identify a change you are not allowed to make** (e.g. requires backend changes, infrastructure, or affects the business model), add it to `AUDIT.md` under a section **"Suggested Changes / Features"** with a short rationale and prerequisites. Do not implement it.
- After each commit, tell me which files in (/services) must be redeployed and if any environment variables must be added, updated or can be removed from a serivce.
