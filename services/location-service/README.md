# location-service

Stores and expires location documents, serves nearby-user queries filtered by tier radius and block list, exposes an internal per-user location endpoint used by messages-service and favourites-service.

Supports two storage backends selected at startup via `LOCATION_STORE`:

- **`memory`** (default) — in-process sharded store; zero latency, survives only while the process is running. **Single-replica only.** Locations are lost on restart; clients re-publish within `LOCATION_TTL_SECS`.
- **`db`** — MongoDB-backed; survives restarts, safe for multiple replicas reading/writing the same collection. Slightly higher latency (one DB round-trip per write, one per query). Requires migration `007_shard_index` (applied automatically by migration-service on boot).

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Listening port |
| `DB_NAME` | `boomboom` | MongoDB database name |
| `LOCATION_STORE` | `memory` | Storage backend: `memory` or `db` |
| `LOCATION_SHARD_SIZE_M` | `2000` | Shard cell size in metres. Smaller = fewer candidates per query in dense areas |
| `LOCATION_NEARBY_LIMIT` | `200` | Max users returned by `/location/nearby` (0 = unlimited) |
| `LOCATION_TTL_SECS` | `600` | Location entry lifetime in seconds (10 min) |
| `LOCATION_UPDATE_INTERVAL_SECS` | `15` | Minimum seconds between accepted location writes per user |
| `LOCATION_UPDATE_DISTANCE_M` | `100` | Minimum metres moved before a write is accepted |
| `LOCATION_SWEEP_INTERVAL_SECS` | `300` | How often (seconds) the background sweep removes stale entries |

## Behaviour Settings (fixed)

| Setting | Value | Effect |
|---|---|---|
| Nearby results cache TTL | 2 sec | Per-user in-memory cache on the nearby endpoint |
| Block list cache TTL | 30 sec | Per-user block list cached to reduce DB reads |
| Tier radius cache TTL | 5 min | Radius values fetched from tiers-service and cached |

## Multi-replica deployment

| Backend | Multiple replicas safe? |
|---|---|
| `memory` | **No.** Each replica holds a disjoint subset of users; nearby queries will miss users on other replicas. Run exactly **1 replica** with the memory backend. |
| `db` | **Yes.** All replicas share the same MongoDB collection. Scale freely up to Railway's replica limit. |

## Production — Railway (5 replicas × 8 vCPU / 8 GB, ≤ 69 % target)

For a dense city deployment with `LOCATION_STORE=db`:

| Variable | Recommended | Reason |
|---|---|---|
| `LOCATION_STORE` | `db` | Required for > 1 replica |
| `LOCATION_SHARD_SIZE_M` | `500` | Tighter shards → fewer candidates per query in dense areas |
| `LOCATION_NEARBY_LIMIT` | `200` | Keeps response payloads lean |
| `LOCATION_TTL_SECS` | `600` | 10 min — reasonable for mobile users |
| `LOCATION_UPDATE_INTERVAL_SECS` | `20` | Reduces write load slightly |
| `LOCATION_UPDATE_DISTANCE_M` | `50` | More responsive to small movements |
| `LOCATION_SWEEP_INTERVAL_SECS` | `60` | Keeps the collection lean under high churn |
