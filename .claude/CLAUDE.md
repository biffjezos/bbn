# Claude Code — Standing Instructions

## On Session Start

- Create a new branch and pull from the default `dev`-branch. Do not read the codebase on session start.
- Read `.claude/audit/AUDIT.md` first. Do not start reading the entire codebase. Greet me, present the last audit, and ask me what to do.

## Things You Must Never Do

- **Do not change the business model.** No changes to account types, tier definitions, or the features available per tier without explicit permission.
- **Do not make changes, that require backend modifications, new service plans** such as: running multiple instances of the same service, adding geospatial filtering to the database, switching databases, or adding infrastructure (e.g. Redis) to handle higher load.
- **Do not read the `docs`-folder.** Do not open the files in it, do not reference them. Do not base your suggestions on those files without explicit permission.
- **Do not change `var DEBUG` in `ui/scripts/api.js`** without explicit permission. 
- **Do not tell me what the project is about.** I already know.

## Things You Must Do

- Only load files relevant to the task.
- **If you identify a change you are not allowed to make** (e.g. requires backend changes, infrastructure, or affects the business model), add it to the `AUDIT.md` under a section **"Suggested Changes / Features"** with a short rationale and prerequisites. Do not implement it. You are the onwer of the `AUDIT.md`. You may add, remove or edit content any time without permission.
- After each commit, tell me which files in (/services) must be redeployed and if any environment variables must be added, updated or can be removed from a serivce.
- If you cannot find an error for the bug reported, do not fucking invent (hallucinate) errors that don't exist. Analyze, if other components of the app are down, running incorrectly, if all environment variables are set, URLs are correct.
