# location-service

Stores and expires location documents, serves nearby-user queries filtered by tier radius and block list, exposes an internal per-user location endpoint used by messages-service and favourites-service.

# Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

| Setting | Value | Effect |
|---|---|---|
| Location TTL | 10 min | Documents older than this are excluded from nearby queries |
| Min update interval | 15 sec | DB write suppressed if last write was more recent |
| Min update distance | 100 m | DB write suppressed if movement is below this threshold |
| Nearby results cache TTL | 2 sec | Per-user cache on the nearby endpoint |
| Block list cache TTL | 30 sec | Per-user block list cached to reduce DB reads |
| Tier radius cache TTL | 5 min | Radius values fetched from tiers-service and cached |