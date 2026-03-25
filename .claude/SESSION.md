# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-frontend-loading-sDYxq`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T14:30Z

---

## In Progress

Nothing.

---

## Completed This Session

- **Restore `ui/_config.yml`** — The owner's `cleanup` commit (8810126) deleted `ui/_config.yml`, which Jekyll uses as the build config when deploying from the `ui/` working directory. Without it, `baseurl` defaulted to empty, breaking all `relative_url` paths (CSS, JS, page links). Restored the file with `baseurl: "/bbn"` and correct `url`/`api_url` values.

---

## Key Decisions Made

- `ui/_config.yml` is required for Jekyll Pages deploy — it must never be deleted.
- Rust CodeQL `build-mode` must remain `none`.
- CI/CD workflow files are explicitly off-limits for unsolicited changes.

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]` to bypass protection or redirect the push to an unprotected branch.

---

## Handoff Notes

### What to do next
1. Merge `claude/fix-frontend-loading-sDYxq` → `dev` to trigger a Pages redeploy and restore the site.
2. Next ticket: **T-24** (Profile Data Encryption, high priority) or **T-09** (Role CRUD).

### Notes for next session
- Do NOT delete `ui/_config.yml`. It is the Jekyll config for the Pages deploy and sets `baseurl: "/bbn"`.
- Do NOT change Rust CodeQL `build-mode` from `none`. Rust only supports `none`.
- No open audit items or tickets were created or changed this session.
