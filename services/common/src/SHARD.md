# Shard Module — Design Reference

`common::shard` — geographic grid sharding for the location store.

---

## Why sharding?

The naive nearby query scans every active user and runs haversine on each one.
That is O(n) in total users. With 10 000 active users and a 500 m search radius
in a dense city, 99% of those scans are wasted on people who are kilometres away.

Sharding divides the map into a grid of fixed-size cells. A nearby query then
only touches the cells that geometrically overlap the search circle. In a dense
city most queries touch 1–4 shards. Cost drops from O(total users) to
O(users in intersecting shards), which is O(1) for typical radii.

---

## The grid

The map is divided into a rectangular grid of cells. Each cell is a square of
approximately `SHARD_SIZE_M` metres on a side (default 2 000 m, configurable
via `LOCATION_SHARD_SIZE_M`).

Because the Earth is a sphere, a fixed metre distance corresponds to different
degree spans at different latitudes:

```
cell_deg_lat = shard_m / 111_320.0
cell_deg_lon = shard_m / (111_320.0 × cos(lat))
```

Longitude cells are wider near the poles and narrower at the equator. The
`cell_deg_lon` is computed from the **query latitude** at query time, not stored
per-shard — this is the standard Web Mercator approximation. It introduces
small distortions near the poles (above ±70°) but is accurate enough for
human-scale distances.

### ShardKey

```rust
pub struct ShardKey(pub i64, pub i64);  // (lat_index, lon_index)
```

Given a coordinate `(lat, lon)`:

```
lat_index = floor(lat / cell_deg_lat)
lon_index = floor(lon / cell_deg_lon)
```

Two users with the same `ShardKey` are in the same cell. Users on the boundary
of a shard always belong to the lower shard (floor semantics), which avoids
duplicates. A user moving across a shard boundary is detected in `upsert` and
moved to the new shard atomically.

---

## Finding intersecting shards

Given a search circle (centre `(lat, lon)`, radius `radius_m`):

1. Compute the axis-aligned bounding box (AABB) of the circle in degrees.
2. Enumerate every shard key that falls within that bounding box (integer
   arithmetic — fast).
3. For each candidate shard, compute the **minimum distance** from the query
   point to the nearest point on the shard's bounding rectangle. If that
   distance ≤ `radius_m`, the shard intersects the circle and must be queried.

Step 3 eliminates the corner shards that the AABB contains but the circle does
not reach. For a radius of 500 m with 2 000 m shards, the AABB typically spans
a 3×3 grid (9 shards); the circle test reduces this to 5–7 shards depending
on the query point's position within its shard.

### Minimum distance from a point to a shard rectangle

```
clamp the query point's latitude  into [shard_lat_min, shard_lat_max]  → nearest_lat
clamp the query point's longitude into [shard_lon_min, shard_lon_max]  → nearest_lon
min_dist = haversine(query_lat, query_lon, nearest_lat, nearest_lon)
```

If the query point is inside the shard, both clamps are no-ops and
`min_dist = 0`.

---

## Sorted-shard traversal with early exit

`intersecting_shards` returns a set — order does not matter for correctness.
But it matters enormously for performance when a result limit is in play.

The `nearby` function sorts candidate shards by `min_dist_to_shard` ascending,
then processes them one at a time:

```
for each shard in sorted order:
    acquire shard read lock
    evict stale entries (updated_at + ttl < now)
    for each surviving entry:
        d = haversine(query, entry)
        if d <= radius_m → add to result heap (keyed by distance)

    if heap.len() >= limit
       AND heap.worst().distance < next_shard.min_dist:
        STOP ← no entry in any remaining shard can improve the result
```

The early-exit condition is geometrically sound: every point in all remaining
shards is at least `next_shard.min_dist` metres away from the query point.
If the current Nth result is closer than that, it cannot be displaced.

### Example — dense city, limit 50

```
Shard 0 (you are here):          min_dist =    0 m  → 80 users found
After shard 0: heap has 50, worst = 340 m.
Next shard min_dist = 0 m (adjacent, you're near the border) → continue.

Shard 1 (left neighbour):        min_dist =    0 m  → 30 users, heap still 50
After shard 1: worst = 290 m.
Next shard min_dist = 320 m → 290 < 320 → STOP.
```

2 shards queried out of a possible 7. The other 5 are never touched.

### Example — rural area, limit 50

```
Shard 0: 3 users. Shard 1–8: 6 more. Shard 9–24: 12 more.
Never reach 50. Expand until radius_m exhausted or all shards done.
Returns fewer than 50.
```

### Example — unrestricted tier, 9 700 km radius, limit 50

The AABB covers the entire world — every populated shard is a candidate.
But the sorted traversal starts with the nearest shards. If 50 users are
found within a few kilometres, the early-exit fires and the remaining
thousands of shards are never touched. The large radius only matters for
genuinely isolated users with few neighbours.

---

## Favourites — reserved slots within the limit

Favourites get guaranteed visibility but do **not** expand the total result
count. The algorithm:

1. Collect all favourite users found within `radius_m` (separate pass over
   their known shards). Call this set F, size K.
2. Fill the remaining `limit - K` slots with the nearest non-favourite users
   from the sorted-shard traversal above.
3. Return F ∪ nearest non-favourites. Total ≤ limit.

**Why this design:** adding a user as a favourite cannot increase the number
of visible pins on the map. It only protects those K users from being displaced
by strangers who happen to be closer. The map stays bounded.

A favourite who is within the radius but would normally fall outside the
Nth-nearest cutoff is shown; a stranger at the same distance is not. Favourites
beyond `radius_m` are never shown regardless.

---

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `LOCATION_SHARD_SIZE_M` | `2000` | Cell size in metres. Smaller = more precise pruning, more shards to manage. Tune to match expected user density (target: ≤ 500 users per shard at peak). |
| `LOCATION_NEARBY_LIMIT` | `200` | Maximum pins returned per nearby query (favourites count within this). |
| `LOCATION_STORE` | `memory` | `memory` or `db`. Memory is single-process only. |
| `LOCATION_UPDATE_INTERVAL_SECS` | `15` | Minimum seconds between location writes for the same user. |
| `LOCATION_UPDATE_DISTANCE_M` | `100` | Minimum movement in metres before a write is accepted within the interval. |
| `LOCATION_TTL_SECS` | `300` | Entries older than this are considered stale and evicted. |
| `LOCATION_SWEEP_INTERVAL_SECS` | `300` | How often the background sweep task runs (memory store only). |

---

## Edge cases

**User exactly on a shard boundary:** floor semantics assign them to the lower
shard. The AABB intersection test starts one shard-width before the circle
boundary so boundary users are never missed.

**High latitudes (> ±70°):** `cos(lat)` approaches 0, making `cell_deg_lon`
very large. Longitude shards become wide slices. The AABB test still works
correctly — it just covers fewer longitude shards. Haversine post-filtering
remains the source of truth.

**Zero-radius query:** `intersecting_shards` returns the single shard containing
the query point. Only exact-location matches pass haversine.

**Empty store / no users:** `nearby` returns an empty vec. No shard locks are
acquired.

**Single user in a shard:** normal path. No early exit fires before that shard
is processed (min_dist = 0 for the home shard).

**10 000 users in one shard:** haversine scans all 10 000 in that shard. This
is the degenerate case — reduce `LOCATION_SHARD_SIZE_M` to split the load.
Phase 5 (auto-adjustable shard size) addresses this automatically.

**Shard boundary crossed during upsert:** the user is removed from the old
shard and inserted into the new one. The outer shard-map `RwLock` is held for
write only during the shard-map structural change (insert/remove shard entries),
not during the inner shard update.

---

## Not in scope for this module

- Tier-specific radius values — resolved by location-service before calling `nearby`.
- Block list filtering — `exclude_ids` is computed by location-service and passed in.
- Favourite id resolution — location-service fetches favourite user-ids and passes them as `always_include`.
- Venue accounts — fixed-location venues are handled by a separate pass in location-service after `nearby` returns.
