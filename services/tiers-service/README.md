# tiers-service

DB-stored tier definitions with admin CRUD. Serves tier info and radius lookups to other services. In-memory cache (5-minute TTL) with static fallback if the collection is empty.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

| Setting | Value | Effect |
|---|---|---|
| Tiers cache TTL | 60 sec | In-memory cache of DB tier documents; refreshed on expiry |
| Static fallback tiers | `regular`, `premium` | Used if the `tiers` collection is empty or unreachable |