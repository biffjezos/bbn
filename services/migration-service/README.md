# migration-service

Applies idempotent database migrations in order on every gateway boot. Tracks applied migrations in a `_migrations` collection. Runs before the gateway opens to traffic.

## Required Environment Variables

`MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` / `MIGRATION_PORT` (default 3099)

## Migrations (applied in order, idempotent)

| ID | What it does |
|---|---|
| `001_indexes` | Core indexes on users, messages, locations, sessions, favourites |
| `002_locations_2dsphere` | 2dsphere index on `locations.loc` |
| `003_blocks_indexes` | Unique index on blocks, index on `blockedUserId` |
| `004_tiers_seed` | Seeds the `tiers` collection with default tier documents |
| `005_rename_developer_tier` | Renames the legacy `developer` tier |
| `006_email_index_sparse` | Recreates the email index as sparse (allows null email for venues) |