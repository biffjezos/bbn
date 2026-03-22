# favourites-service

Manages one-directional favourite links, syncs range state (writes `withinRange` flag and fires a notification when a favourite comes into messaging range), delivers in-app notifications.

## Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `LOC_SERVICE_URL`, `TIERS_SERVICE_URL`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)