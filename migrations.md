# Migrations

*[← Tiers](tiers.md) · [← README (Technical Reference)](README.md#api-documentation)*

---

## Overview

The migration runner ensures the database is always in the correct state before any traffic is accepted. It runs automatically every time `server.js` boots — before the gateway opens.

Migrations are idempotent. Each one runs exactly once and is never repeated. They are tracked in a `_migrations` collection in MongoDB.

---

## How It Works

On boot, `server.js`:

1. Starts `migrationApp` on port 3099 (internal only)
2. Calls `POST http://localhost:3099/migrate/run`
3. Runner checks `_migrations` for already-applied IDs
4. Pending migrations run in order
5. Each applied migration is recorded with a timestamp
6. Returns `{ ok: true, applied: N }`
7. Gateway opens on port 3000

If the migration call fails, the gateway boots anyway with a warning. This prevents a broken migration from permanently taking the service down.

---

## Current Migrations

| ID | Description |
|---|---|
| `001_indexes` | Creates all MongoDB indexes: unique on `users.email`; TTL on `locations.updatedAt` (600s), `messages.expiresAt` (0s); compound unique on `favourites (ownerUserId + favouriteUserId)` |
| `002_user_tiers_backfill` | Writes `tier: "regular"` to all existing user documents missing a `tier` field |
| `003_user_tiers_index` | Creates an index on `users.tier` |

---

## Adding a Migration

Open `server.js` and add a new object at the bottom of the `migrations` array:

```js
{
  id: '004_your_description',
  async up(db) {
    await db.collection('your_collection').createIndex({ field: 1 }, { background: true });
  },
},
```

**Rules:**
- `id` must be unique, prefixed with the next sequential number
- Never edit or delete existing migrations — only add new ones
- Write idempotent operations (e.g. `createIndex` is a no-op if the index already exists)
- The migration runs once on next deploy and never again

---

## The `_migrations` Collection

```json
{
  "_id":       "ObjectId",
  "id":        "001_indexes",
  "appliedAt": "2024-01-01T00:00:00.000Z"
}
```

To re-run a migration: delete its record from `_migrations` and redeploy.

---

*[← Tiers](tiers.md) · [← README (Technical Reference)](README.md#api-documentation)*
