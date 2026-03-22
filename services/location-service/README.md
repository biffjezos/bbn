# location-service

Stores and expires location documents, serves nearby-user queries filtered by tier radius and block list, exposes an internal per-user location endpoint used by messages-service and favourites-service.

# Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)