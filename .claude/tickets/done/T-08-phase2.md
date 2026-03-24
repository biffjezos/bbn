---
id: T-08-phase2
title: Authority Service (Phase 2)
completed: 2026-03-24
branch: claude/review-next-tasks-uK0sn
---

## What was done

- `authority-service` Rust crate created — absorbs all routes from `auth-service` and `tiers-service`; adds `POST /authority/verify` endpoint that returns `{ sub, role, account_type, tier, tv, features[], radii{} }`
- Gateway modularised into 5 modules (`rate.rs`, `proxy.rs`, `guards.rs`, `handlers.rs`, `ws.rs`); `main.rs` trimmed to ~260 lines
- Gateway env var `AUTH_SERVICE_URL` → `AUTHORITY_SERVICE_URL`; `TIERS_SERVICE_URL` removed
- `common/src/auth.rs`: added `GatewayIdentity`, `AuthedByGateway`, `RegisteredByGateway`, `TokenProfile`, `ProfileFromToken`
- `messages-service`, `favourites-service`, `blocks-service`: use `RegisteredByGateway`
- `location-service`: uses `AuthedByGateway` + `ProfileFromToken`; `get_nearby` reads `identity.radii.nearby_m` directly (no tiers-service round-trip)
- All Dockerfiles updated with `authority-service` workspace stub
- Deployed on Railway: authority-service live, auth-service and tiers-service retired; verified by owner 2026-03-24
