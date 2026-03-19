# bOOmbOOm.NOW! — Infrastructure Audit

**Last updated:** 2026-03-19
**Concern:** Infrastructure — Railway/MongoDB environment, service dependencies, deployment constraints.

---

## Open Items

### INFRA-1.1 migration-service not running — root cause: Railway disk too small

**Date:** 2026-03-17 (updated 2026-03-18)
**Files:** `services/migration-service/src/main.rs` (Rust port),
`services/gateway/src/main.rs` (calls `MIGRATION_SERVICE_URL` on boot)

The migration-service itself is working correctly (responds, connects to MongoDB, reports the failure). The root cause is the Railway MongoDB volume: total disk is only **454 MB**, with 222 MB used by the OS and MongoDB process overhead, leaving 232 MB free. MongoDB's WiredTiger engine requires a **minimum of 524 MB free** for write operations (index creation, inserts). This requirement exceeds the available free space and cannot be resolved by deleting data — the MongoDB database contains only ~614 KB of data across all collections.

**Confirmed 2026-03-18:** All collections inspected via `db.getCollectionNames()`. No bloated collections. The disk constraint is structural, not data-related.

**Attempted workarounds (all failed — 2026-03-18):**
- `/migrate/reset` endpoint: same OutOfDiskSpace error (drop operations succeed, but `createIndex` is a write op and is blocked by the same threshold).
- Standalone Bun script connecting directly via `MONGO_URI`: identical error. MongoDB code 14031 blocks **all** write operations below 524 MB free — there is no way to run migrations against this instance without first freeing disk space at the filesystem level.

**Only remaining resolution: migrate MongoDB to Atlas free tier (M0).**
- Atlas manages storage independently; WiredTiger journal overhead is not charged against the 512 MB data limit.
- The dataset is ~614 KB / 53 documents — trivially small.
- Update `MONGO_URI` in Railway env vars for all services.
- Migration-service will apply all 6 pending migrations on next gateway boot.
- The `/migrate/reset` endpoint is available for a clean slate after migration.

**Consequences while not running:**
- MongoDB TTL indexes for `messages`, `locations`, `sessions` not applied — expired data not auto-purged at DB level (privacy regression).
- Migration `003_blocks_indexes` not enforced — duplicate block entries possible.
- Migrations `004_tiers_seed` / `005_rename_developer_tier` / `006_email_index_sparse` not applied.

**Priority:** HIGH — privacy regression in a privacy-by-design app. Tracked as T-10.

---

### INFRA-1.0 MongoDB disk space — superseded by INFRA-1.1

**Date:** 2026-03-16 (superseded 2026-03-18)

Merged into INFRA-1.1. Root cause confirmed: Railway volume is structurally too small (454 MB total). Upgrading the plan to 1 GB is not available on the current Railway tier. Resolution: migrate to MongoDB Atlas (see INFRA-1.1).

---

### INFRA-1.2 Sessions TTL index must be dropped and recreated after guest-TTL change

**Date:** 2026-03-18
**File:** MongoDB `sessions` collection

Guest session TTL was corrected from 2 h to 20 min (2026-03-18). The TTL index on `sessions.createdAt` still carries the old `expireAfterSeconds: 7200` value — MongoDB silently ignores `createIndex()` when an index with the same key pattern already exists, so the new value (1200 s) will not take effect until the old index is dropped.

**One-time action required (Railway MongoDB shell or Compass):**

```
db.sessions.dropIndex("createdAt_1")
```

The gateway will recreate it with `expireAfterSeconds: 1200` on next boot.

**Priority:** LOW — guest sessions currently expire after 2 h instead of 20 min. No privacy regression (they do expire); just looser than intended.

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| 🔲 | INFRA-1.1 | HIGH | migration-service not running — Railway volume too small (454 MB total, WiredTiger needs 524 MB free). Migrate to MongoDB Atlas. |
| ~~🔲~~ | ~~INFRA-1.0~~ | ~~MEDIUM~~ | ~~MongoDB disk space~~ — superseded by INFRA-1.1 |
| 🔲 | INFRA-1.2 | LOW | Sessions TTL index carries old 2 h value — drop `createdAt_1` index to apply 20 min TTL |

Resolved items → AUDIT_DONE.md
