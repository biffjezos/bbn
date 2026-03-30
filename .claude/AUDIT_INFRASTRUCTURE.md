# bOOmbOOm.NOW! — Infrastructure Audit

**Last updated:** 2026-03-30
**Concern:** Infrastructure — Railway/MongoDB environment, service dependencies, deployment constraints.

---

## Open Items

### INFRA-1.3 🔲 CORS_ORIGINS env var now required in Railway gateway service
<!-- ITEM id:INFRA-1.3 status:open priority:high concern:infrastructure -->

**Finding (2026-03-30):** `ALLOWED_ORIGINS` was hardcoded to `["https://biffjezos.github.io"]` (old GitHub Pages domain). Changed to required env var `CORS_ORIGINS`. Gateway panics on startup if not set.

**Owner action required:** Set `CORS_ORIGINS=https://boom.up.railway.app` in Railway **gateway** service environment variables (comma-separate multiple origins if needed).

**Priority:** HIGH — without this, all cross-origin requests (API + WS) return 403/CORS errors.

---

### INFRA-1.4 🔲 JWT_SECRET must be identical in server and gateway Railway services
<!-- ITEM id:INFRA-1.4 status:open priority:high concern:infrastructure -->

**Finding (2026-03-30):** Server validates `bbn_tok` cookie with its own `JWT_SECRET`. Gateway signs JWTs with its own `JWT_SECRET`. If they differ, every protected page (`/messages/`, `/profile/`, `/favourites/`, `/settings/`, `/admin/`) rejects the cookie and redirects to `/`. Most likely root cause of the `/favourites` logout reported this session.

**Owner action required:** In Railway, verify that **both** the `server` service and the `gateway` service have the exact same value for `JWT_SECRET`.

**Priority:** HIGH — every protected route silently fails when mismatch exists.

---

## Resolved

INFRA-1.0 ✅ resolved 2026-03-24 — details in AUDIT_DONE.md
INFRA-1.1 ✅ resolved 2026-03-24 — details in AUDIT_DONE.md
INFRA-1.2 ✅ resolved 2026-03-24 — details in AUDIT_DONE.md

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| 🔲 | INFRA-1.3 | HIGH | CORS_ORIGINS now required env var in gateway — owner must set in Railway. |
| 🔲 | INFRA-1.4 | HIGH | JWT_SECRET must match in server and gateway — mismatch causes all protected routes to redirect. |
| ✅ | INFRA-1.1 | HIGH | migration-service not running — Railway disk too small. Resolved: upgraded to new Railway plan (1 TB storage). |
| ✅ | INFRA-1.0 | MEDIUM | MongoDB disk space — superseded by INFRA-1.1, resolved same. |
| ✅ | INFRA-1.2 | LOW | Sessions TTL index carried old 2 h value — resolved via migration 010 (2026-03-24). |

Resolved items → AUDIT_DONE.md
