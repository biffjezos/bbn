# favourites-service

Manages one-directional favourite links, syncs range state (writes `withinRange` flag and fires a notification when a favourite comes into messaging range), delivers in-app notifications.

## Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `LOC_SERVICE_URL`, `TIERS_SERVICE_URL`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

| Setting | Value | Effect |
|---|---|---|
| Notifications TTL | 30 days | MongoDB TTL index on `notifications.createdAt` |
| Message radius cache | permanent (runtime) | Tier radius values fetched once from tiers-service and held for the lifetime of the process |