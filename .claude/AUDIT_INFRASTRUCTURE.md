# bOOmbOOm.NOW! — Infrastructure Audit

**Last updated:** 2026-03-24
**Concern:** Infrastructure — Railway/MongoDB environment, service dependencies, deployment constraints.

---

## Open Items

### INFRA-1.2 Sessions TTL index stale — drop `createdAt_1` to apply 20 min TTL
<!-- ITEM id:INFRA-1.2 status:open priority:low concern:infrastructure -->

**Date:** 2026-03-18
**File:** MongoDB `sessions` collection

Guest session TTL was corrected from 2 h to 20 min (2026-03-18). The TTL index on `sessions.createdAt` still carries the old `expireAfterSeconds: 7200` value — MongoDB silently ignores `createIndex()` when an index with the same key pattern already exists, so the new value (1200 s) will not take effect until the old index is dropped.

**Resolution (can now run with upgraded Railway plan):** Include a `dropIndex("sessions", "createdAt_1")` step in migration `010`. The gateway will recreate the index with `expireAfterSeconds: 1200` on next boot.

**Priority:** LOW — guest sessions expire after 2 h instead of 20 min. No privacy regression (they do expire); just looser than intended.

---

## Resolved

INFRA-1.0 ✅ resolved 2026-03-24 — details in AUDIT_DONE.md
INFRA-1.1 ✅ resolved 2026-03-24 — details in AUDIT_DONE.md

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| ✅ | INFRA-1.1 | HIGH | migration-service not running — Railway disk too small. Resolved: upgraded to new Railway plan (1 TB storage). |
| ✅ | INFRA-1.0 | MEDIUM | MongoDB disk space — superseded by INFRA-1.1, resolved same. |
| 🔲 | INFRA-1.2 | LOW | Sessions TTL index carries old 2 h value — fix via migration 010. |

Resolved items → AUDIT_DONE.md
