# Environment Variables

Reference for deploying the services (e.g. on Railway). Variables with a
default are optional; everything listed under **Required** makes the service
exit (or misbehave) at startup when missing.

Shared secrets must hold the **same value in every service that lists them**:
`JWT_SECRET`, `SERVICE_SECRET`, `EMAIL_PEPPER`, `OPAQUE_SERVER_SETUP`.

Every `*_SERVICE_URL` has a paired `*_ALLOWED_HOST` (SSRF guard): the URL's
hostname must match it exactly.

---

## All services

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | see per-service | HTTP listen port (Railway injects this) |
| `RUST_LOG` | no | unset | log level filter |

## gateway (default port 3000)

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | yes | HS256 user-JWT key (same everywhere) |
| `SERVICE_SECRET` | yes | inter-service token key (same everywhere) |
| `CORS_ORIGINS` | yes | comma-separated allowed origins (also used for WS Origin check) |
| `AUTHORITY_SERVICE_URL` / `AUTHORITY_SERVICE_ALLOWED_HOST` | yes | authority-service base URL + host pin |
| `USER_SERVICE_URL` / `USER_SERVICE_ALLOWED_HOST` | yes | users-service |
| `LOC_SERVICE_URL` / `LOC_SERVICE_ALLOWED_HOST` | yes | location-service |
| `MSG_SERVICE_URL` / `MSG_SERVICE_ALLOWED_HOST` | yes | messages-service |
| `FAV_SERVICE_URL` / `FAV_SERVICE_ALLOWED_HOST` | yes | favourites-service |
| `BLOCKS_SERVICE_URL` / `BLOCKS_SERVICE_ALLOWED_HOST` | yes | blocks-service |
| `MIGRATION_SERVICE_URL` / `MIGRATION_SERVICE_ALLOWED_HOST` | yes | migration-service (called once at boot) |

## server — SSR frontend (default port 8080)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GATEWAY_URL` | yes | — | gateway base URL for /api and /ws proxying |
| `GATEWAY_ALLOWED_HOST` | yes | — | host pin for `GATEWAY_URL` |
| `JWT_SECRET` | yes | — | decode user JWT for SSR auth context |
| `STATIC_DIR` | no | `./static` | static asset directory |
| `TEMPLATES_DIR` | no | `./templates` | Tera templates directory |
| `ASSET_VERSION` | no | `RAILWAY_GIT_COMMIT_SHA` or `dev` | cache-bust string |

## authority-service (default port 8080)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB connection string |
| `DB_NAME` | no | `boomboom` | database name |
| `JWT_SECRET` | yes | — | signs user/guest JWTs |
| `SERVICE_SECRET` | yes | — | inter-service token key |
| `EMAIL_PEPPER` | yes | — | HMAC pepper for email hashes (≥32 bytes) |
| `OPAQUE_SERVER_SETUP` | yes | — | base64 OPAQUE server setup; if unset the service prints a freshly generated value and exits — set that value once and never change it |
| `ADMIN_BOOTSTRAP_USER_ID` | no | unset | ObjectId promoted to admin at startup |

## users-service (default port 3002)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB |
| `DB_NAME` | no | `boomboom` | database name |
| `JWT_SECRET` | yes | — | verify/issue user JWTs |
| `SERVICE_SECRET` | yes | — | inter-service token key |
| `OPAQUE_SERVER_SETUP` | yes | — | same value as authority-service (password change) |
| `SELF_PROMOTION_GUARD` | no | unset | set to `1` to block admins editing their own role/tier |

## location-service (default port 8080)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI`, `DB_NAME`, `JWT_SECRET`, `SERVICE_SECRET` | yes / `boomboom` | | as above |
| `FAV_SERVICE_URL` / `FAV_SERVICE_ALLOWED_HOST` | yes | — | favourites-service (range-sync) |
| `AUTHORITY_SERVICE_URL` / `AUTHORITY_SERVICE_ALLOWED_HOST` | yes | — | tier radius lookups |
| `LOCATION_STORE` | no | `memory` | `memory` or `db` |
| `LOCATION_SHARD_SIZE_M` | no | `2000` | shard size (m) |
| `LOCATION_NEARBY_LIMIT` | no | `200` | max nearby results |
| `LOCATION_TTL_SECS` | no | `600` | location entry TTL |
| `LOCATION_UPDATE_INTERVAL_SECS` | no | `15` | min interval between updates |
| `LOCATION_UPDATE_DISTANCE_M` | no | `100` | min movement to store an update |
| `LOCATION_SWEEP_INTERVAL_SECS` | no | `300` | stale-entry sweep interval |

## messages-service (default port 8080)

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI`, `DB_NAME`, `JWT_SECRET`, `SERVICE_SECRET` | yes (`DB_NAME` optional) | as above |
| `LOC_SERVICE_URL` / `LOC_SERVICE_ALLOWED_HOST` | yes | proximity checks |
| `AUTHORITY_SERVICE_URL` / `AUTHORITY_SERVICE_ALLOWED_HOST` | yes | tier radius lookups |
| `FAV_SERVICE_URL` / `FAV_SERVICE_ALLOWED_HOST` | yes | mutual-favourite checks |

## favourites-service (default port 8080)

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI`, `DB_NAME`, `JWT_SECRET`, `SERVICE_SECRET` | yes (`DB_NAME` optional) | as above |
| `LOC_SERVICE_URL` / `LOC_SERVICE_ALLOWED_HOST` | yes | range checks |
| `AUTHORITY_SERVICE_URL` / `AUTHORITY_SERVICE_ALLOWED_HOST` | yes | tier lookups |

## blocks-service (default port 8080)

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI`, `DB_NAME`, `JWT_SECRET`, `SERVICE_SECRET` | yes (`DB_NAME` optional) | as above |

## migration-service (default port 3099)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB |
| `DB_NAME` | no | `boomboom` | database name |
| `JWT_SECRET` | yes | — | (shared config pattern) |
| `SERVICE_SECRET` | yes | — | validates the gateway's migrate call |
| `MIGRATION_PORT` | no | `3099` | overrides `PORT` |
