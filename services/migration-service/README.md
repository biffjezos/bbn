# migration-service

Applies idempotent database migrations in order on every gateway boot. Tracks applied migrations in a `_migrations` collection. Runs before the gateway opens to traffic.

## Required Environment Variables

`MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 3099)