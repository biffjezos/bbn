# gateway

Entry point for all client traffic. Routes HTTP requests to downstream services, injects `X-Service-Token` on every proxied request, enforces per-IP rate limits (login, register, guest, general API), handles WebSocket connections for live location and messaging, and runs database migrations on boot.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, `LOC_SERVICE_URL`, `MSG_SERVICE_URL`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`. Optional: `ALLOWED_ORIGINS` (default `https://biffjezos.github.io`), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

**Rate limits — per IP, fixed window**

| Limiter | Max requests | Window |
|---|---|---|
| Login | 20 | 15 min |
| Register | 5 | 60 min |
| Guest auth | 40 | 60 min |
| All other API | 120 | 60 sec |

**WebSocket**

| Setting | Value |
|---|---|
| Max message size | 4 096 bytes |
| Send rate limit | 10 messages / 10 sec per connection |
| Auth timeout | 3 sec |
| Location min delta | 5 m (updates suppressed below this movement) |

**Other**

| Setting | Value |
|---|---|
| Health check cache TTL | 30 sec |