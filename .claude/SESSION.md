# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/add-specs-document-7bxNJ`
**Session date:** 2026-03-29
**Last updated:** 2026-03-29T00:00Z

---

## In Progress

(nothing)

---

## Completed This Session

- **Introduced spec workflow into CLAUDE.md**
  - Added "Spec Workflow" section: check for spec before touching any module; create if absent; update after work.
  - Added spec update step to "Before Each Commit" and "Session Wrap-Up Checklist".
  - Added `.claude/specs/` entry to "Persistent Files".
  - Fixed wrap-up checklist numbering (old step 4 became 5 after inserting spec step as 3).
  - Logged CHANGE entry in CHANGELOG.md.

---

## Key Decisions Made

- Spec coverage grows incrementally (Option B) — specs are created as modules are touched, not upfront.
- No separate specs index file needed; SESSION.md notes which specs were created/updated per session; directory structure is navigable directly.
- `expected_behaviour` must be owner-seeded when behavior is unclear; Claude fills `sources`, `pre_conditions`, `tests`.

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]` to bypass protection.
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service, favourites-service, gateway need review. See codeql-alerts.md on origin/dev.
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### What to do next
1. Merge `claude/add-specs-document-7bxNJ` → `dev`.
2. Merge `claude/fix-pwa-android-install-efOUW` → `dev` and deploy if not done yet.
3. CodeQL SSRF alerts (18 open) — take priority after merges.

### Notes for next session
- Spec workflow is now active. Before touching any module, check `.claude/specs/` for a relevant YAML file.
- Only one spec exists so far: `specs/ui/01.yaml` (login/registration modal form clearing). Coverage grows as work proceeds.
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
- PWA install button is in `#installSection`; shown by `beforeinstallprompt` (Chrome/Edge Android) or `#iosInstallHint` for iOS.
