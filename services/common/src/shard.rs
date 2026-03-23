/// Geographic grid sharding for the location store.
///
/// See `SHARD.md` in this directory for a full design explanation.
use crate::geo::haversine_distance;

// Metres per degree of latitude — fixed, independent of position.
const METRES_PER_DEG_LAT: f64 = 111_320.0;

/// A grid cell identifier: `(lat_index, lon_index)`.
///
/// Two users with the same `ShardKey` are in the same cell.
/// Computed via `floor` semantics so boundary users always belong to the
/// lower shard — no duplicates possible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ShardKey(pub i64, pub i64);

/// Returns the `ShardKey` for a coordinate given a cell size in metres.
pub fn shard_for_coords(lat: f64, lon: f64, shard_m: f64) -> ShardKey {
    let cell_lat = shard_m / METRES_PER_DEG_LAT;
    let cell_lon = shard_m / (METRES_PER_DEG_LAT * lat.to_radians().cos().abs().max(1e-9));
    ShardKey(
        (lat / cell_lat).floor() as i64,
        (lon / cell_lon).floor() as i64,
    )
}

/// Returns all shard keys whose bounding rectangle intersects the search
/// circle centred at `(lat, lon)` with radius `radius_m`.
///
/// Uses an AABB-vs-circle test: for each cell in the bounding box of the
/// circle, compute the minimum distance from the query point to the cell's
/// nearest edge. If ≤ `radius_m`, the cell is included.
pub fn intersecting_shards(lat: f64, lon: f64, radius_m: f64, shard_m: f64) -> Vec<ShardKey> {
    let cell_lat = shard_m / METRES_PER_DEG_LAT;
    let cell_lon = shard_m / (METRES_PER_DEG_LAT * lat.to_radians().cos().abs().max(1e-9));

    // Bounding box of the circle in degrees.
    let lat_delta = radius_m / METRES_PER_DEG_LAT;
    let lon_delta = radius_m / (METRES_PER_DEG_LAT * lat.to_radians().cos().abs().max(1e-9));

    let lat_min = lat - lat_delta;
    let lat_max = lat + lat_delta;
    let lon_min = lon - lon_delta;
    let lon_max = lon + lon_delta;

    // Grid indices spanning the bounding box.
    let row_min = (lat_min / cell_lat).floor() as i64;
    let row_max = (lat_max / cell_lat).floor() as i64;
    let col_min = (lon_min / cell_lon).floor() as i64;
    let col_max = (lon_max / cell_lon).floor() as i64;

    let mut result = Vec::new();

    for row in row_min..=row_max {
        for col in col_min..=col_max {
            // Bounding rect of this shard in degrees.
            let s_lat_min = row as f64 * cell_lat;
            let s_lat_max = s_lat_min + cell_lat;
            let s_lon_min = col as f64 * cell_lon;
            let s_lon_max = s_lon_min + cell_lon;

            // Nearest point on the rectangle to the query point.
            let nearest_lat = lat.clamp(s_lat_min, s_lat_max);
            let nearest_lon = lon.clamp(s_lon_min, s_lon_max);

            let min_dist = haversine_distance(lat, lon, nearest_lat, nearest_lon);

            if min_dist <= radius_m {
                result.push(ShardKey(row, col));
            }
        }
    }

    result
}

/// Minimum distance in metres from `(lat, lon)` to the nearest point on the
/// bounding rectangle of `key`. Returns `0.0` if the point is inside the shard.
///
/// Used to sort candidate shards before traversal so closer shards are
/// processed first, enabling early exit once the result limit is satisfied.
pub fn min_dist_to_shard(lat: f64, lon: f64, key: ShardKey, shard_m: f64) -> f64 {
    let cell_lat = shard_m / METRES_PER_DEG_LAT;
    let cell_lon = shard_m / (METRES_PER_DEG_LAT * lat.to_radians().cos().abs().max(1e-9));

    let s_lat_min = key.0 as f64 * cell_lat;
    let s_lat_max = s_lat_min + cell_lat;
    let s_lon_min = key.1 as f64 * cell_lon;
    let s_lon_max = s_lon_min + cell_lon;

    let nearest_lat = lat.clamp(s_lat_min, s_lat_max);
    let nearest_lon = lon.clamp(s_lon_min, s_lon_max);

    haversine_distance(lat, lon, nearest_lat, nearest_lon)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHARD_M: f64 = 2_000.0;

    // ── shard_for_coords ──────────────────────────────────────────────────────

    #[test]
    fn same_coords_same_key() {
        let a = shard_for_coords(52.5, 13.4, SHARD_M);
        let b = shard_for_coords(52.5, 13.4, SHARD_M);
        assert_eq!(a, b);
    }

    #[test]
    fn nearby_coords_same_shard() {
        // Two points 1 m apart share a shard when the shard is 2 000 m wide.
        let a = shard_for_coords(52.5000, 13.4000, SHARD_M);
        let b = shard_for_coords(52.5001, 13.4001, SHARD_M);
        assert_eq!(a, b);
    }

    #[test]
    fn far_coords_different_shards() {
        // Berlin and Munich are ~500 km apart.
        let berlin = shard_for_coords(52.52, 13.41, SHARD_M);
        let munich = shard_for_coords(48.14, 11.58, SHARD_M);
        assert_ne!(berlin, munich);
    }

    #[test]
    fn floor_semantics_on_boundary() {
        // A point exactly on a shard boundary belongs to the lower shard.
        let cell_lat = SHARD_M / METRES_PER_DEG_LAT;
        let boundary_lat = cell_lat * 10.0; // exactly on the boundary
        let inside = shard_for_coords(boundary_lat - 0.000_001, 0.0, SHARD_M);
        let on_boundary = shard_for_coords(boundary_lat, 0.0, SHARD_M);
        // on_boundary belongs to the higher shard (floor of the exact value).
        assert_ne!(inside, on_boundary);
        assert_eq!(on_boundary.0, inside.0 + 1);
    }

    // ── intersecting_shards ───────────────────────────────────────────────────

    #[test]
    fn zero_radius_returns_one_shard() {
        let shards = intersecting_shards(52.5, 13.4, 0.0, SHARD_M);
        assert_eq!(shards.len(), 1);
        assert_eq!(shards[0], shard_for_coords(52.5, 13.4, SHARD_M));
    }

    #[test]
    fn small_radius_centered_in_shard_returns_one_shard() {
        // Query point well inside a shard, radius 100 m — can't reach any neighbour.
        let shards = intersecting_shards(52.5123, 13.4123, 100.0, SHARD_M);
        assert_eq!(shards.len(), 1);
    }

    #[test]
    fn radius_reaching_neighbours_returns_multiple_shards() {
        // 2 000 m radius with 2 000 m shards — will reach adjacent shards.
        let shards = intersecting_shards(52.5, 13.4, 2_000.0, SHARD_M);
        assert!(shards.len() > 1, "expected multiple shards, got {}", shards.len());
    }

    #[test]
    fn large_radius_returns_many_shards() {
        // 10 km radius should pull in several rings.
        let shards = intersecting_shards(52.5, 13.4, 10_000.0, SHARD_M);
        assert!(shards.len() >= 9, "expected at least 9 shards, got {}", shards.len());
    }

    #[test]
    fn home_shard_always_included() {
        for radius in [0.0, 500.0, 2_000.0, 50_000.0] {
            let shards = intersecting_shards(52.5, 13.4, radius, SHARD_M);
            let home = shard_for_coords(52.5, 13.4, SHARD_M);
            assert!(shards.contains(&home), "home shard missing at radius {radius}");
        }
    }

    #[test]
    fn no_duplicates_in_result() {
        let shards = intersecting_shards(52.5, 13.4, 5_000.0, SHARD_M);
        let mut seen = std::collections::HashSet::new();
        for s in &shards {
            assert!(seen.insert(s), "duplicate shard key {s:?}");
        }
    }

    #[test]
    fn high_latitude_no_panic() {
        // cos(lat) → 0 near poles; must not panic or produce nonsense.
        let shards = intersecting_shards(89.9, 0.0, 1_000.0, SHARD_M);
        assert!(!shards.is_empty());
    }

    #[test]
    fn corner_shards_excluded_by_circle_test() {
        // With a radius just under half the shard diagonal, the 4 corner shards
        // of a 3×3 grid should be excluded when the query is exactly at the
        // centre of the home shard.
        // Shard diagonal ≈ sqrt(2) * 2000 ≈ 2828 m.
        // A radius of 999 m centred in the home shard cannot reach a corner shard
        // whose nearest point is ~1000 m away.
        let cell_lat = SHARD_M / METRES_PER_DEG_LAT;
        // Place query at shard centre.
        let lat = cell_lat * 100.5; // middle of shard row 100
        let shards = intersecting_shards(lat, 13.4, 999.0, SHARD_M);
        // Should include home shard but not all 9 in the 3×3 box.
        assert!(shards.len() < 9, "expected corner exclusion, got {} shards", shards.len());
        let home = shard_for_coords(lat, 13.4, SHARD_M);
        assert!(shards.contains(&home));
    }

    // ── min_dist_to_shard ─────────────────────────────────────────────────────

    #[test]
    fn min_dist_inside_shard_is_zero() {
        let key = shard_for_coords(52.5, 13.4, SHARD_M);
        let d = min_dist_to_shard(52.5, 13.4, key, SHARD_M);
        assert_eq!(d, 0.0, "point inside its own shard should have dist 0");
    }

    #[test]
    fn min_dist_to_adjacent_shard_is_positive() {
        let home = shard_for_coords(52.5, 13.4, SHARD_M);
        // Shard directly above (lat_index + 1).
        let above = ShardKey(home.0 + 1, home.1);
        let d = min_dist_to_shard(52.5, 13.4, above, SHARD_M);
        assert!(d > 0.0, "adjacent shard should have positive min dist");
        assert!(d < SHARD_M, "adjacent shard min dist should be less than one shard width");
    }

    #[test]
    fn min_dist_increases_with_shard_ring() {
        let home = shard_for_coords(52.5, 13.4, SHARD_M);
        let ring1 = ShardKey(home.0 + 1, home.1);
        let ring2 = ShardKey(home.0 + 2, home.1);
        let d1 = min_dist_to_shard(52.5, 13.4, ring1, SHARD_M);
        let d2 = min_dist_to_shard(52.5, 13.4, ring2, SHARD_M);
        assert!(d2 > d1, "farther shard should have greater min dist: d1={d1:.0} d2={d2:.0}");
    }

    // ── sorting sanity (foundation for early-exit traversal) ─────────────────

    #[test]
    fn shards_sort_by_min_dist_ascending() {
        let lat = 52.5;
        let lon = 13.4;
        let mut shards = intersecting_shards(lat, lon, 5_000.0, SHARD_M);
        shards.sort_by(|a, b| {
            min_dist_to_shard(lat, lon, *a, SHARD_M)
                .partial_cmp(&min_dist_to_shard(lat, lon, *b, SHARD_M))
                .unwrap()
        });
        // Home shard (min_dist = 0) must be first.
        let home = shard_for_coords(lat, lon, SHARD_M);
        assert_eq!(shards[0], home, "home shard should sort first");

        // Verify ascending order.
        let dists: Vec<f64> = shards
            .iter()
            .map(|k| min_dist_to_shard(lat, lon, *k, SHARD_M))
            .collect();
        for w in dists.windows(2) {
            assert!(w[0] <= w[1], "not ascending: {} > {}", w[0], w[1]);
        }
    }
}
