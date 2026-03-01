# Migrations

## Overview

The migration runner ensures the database is always in the correct state before any traffic is accepted. It runs automatically every time `server.js` boots — before the gateway opens.

Migrations are idempotent. Each one runs exactly once and is never repeated. They are tracked in a `_migrations` collection in MongoDB.

---

## How It Works

The migration runner is a small Express service running on an internal port (default: 3099) inside the same process as `server.js`. It is not exposed publicly.

On boot, `server.js` does the following before calling `app.listen`:

1. `migrationApp` starts listening on port 3099
2. `server.js` calls `POST http://localhost:3099/migrate/run`
3. The runner checks `_migrations` for already-applied migration IDs
4. Any pending migrations are run in order
5. Each applied migration is recorded in `_migrations` with a timestamp
6. The runner returns `{ ok: true, applied: N }`
7. `server.js` receives the response and opens the gateway on port 3000

If the migration call fails (e.g. DB is unreachable), the gateway boots anyway with a warning logged. This prevents a broken migration from taking the entire service down permanently.

---

## Current Migrations

| ID | Description |
|---|---|
| `001_indexes` | Creates all MongoDB indexes: unique on `users.email`, `users.nickname`, `sessions.guestId`, `favourites (ownerUserId + favouriteUserId)`; TTL on `locations.updatedAt` (600s), `messages.expiresAt` (0s) |
| `002_user_tiers_backfill` | Writes `tier: "regular"` to all existing user documents that do not have a `tier` field |
| `003_user_tiers_index` | Creates an index on `users.tier` for fast admin queries |

---

## Adding a Migration

Open `server.js` and add a new object at the bottom of the `migrations` array:

```js
{
  id: '004_your_description',
  async up(db) {
    // Your migration logic here
    await db.collection('your_collection').createIndex({ field: 1 }, { background: true });
  },
},
```

**Rules:**
- The `id` must be unique and should be prefixed with the next sequential number
- Never edit or delete an existing migration — only add new ones
- The `up` function receives the MongoDB `db` object directly
- Write idempotent operations where possible (e.g. `updateMany` with `$exists: false`, `createIndex` which is a no-op if the index already exists)
- The migration runs on the next deploy and never again

---

## The `_migrations` Collection

```json
{
  "_id":       "ObjectId",
  "id":        "001_indexes",
  "appliedAt": "2024-01-01T00:00:00.000Z"
}
```

Do not manually insert or delete documents in this collection. If you need to re-run a migration, delete its record from `_migrations` and redeploy — it will run again on next boot.

---

## Standalone Reference

The migration service is also maintained as a standalone file at `services/migration-service.js`. This file is the source of truth for the migration service in isolation. The version merged into `server.js` is kept in sync with it manually. Duplicated variables in `server.js` are commented to make the boundary clear.
