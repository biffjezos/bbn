# gateway

Entry point for all client traffic. Routes HTTP requests to downstream services, injects `X-Service-Token` on every proxied request, enforces per-IP rate limits (login, register, guest, general API), handles WebSocket connections for live location and messaging, and runs database migrations on boot.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, `LOC_SERVICE_URL`, `MSG_SERVICE_URL`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`. Optional: `ALLOWED_ORIGINS` (default `https://biffjezos.github.io`), `PORT` (default 8080)