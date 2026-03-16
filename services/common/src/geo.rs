/// Haversine great-circle distance between two WGS-84 coordinates.
///
/// Mirrors the `haversineDistance()` function duplicated across
/// server.js, messages-service.js, and location-service.js (AUDIT.md 3.1).
/// Port each JS service to Rust and use this instead.
const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// Returns the distance in metres between (lat1, lon1) and (lat2, lon2).
pub fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let to_rad = |deg: f64| deg * std::f64::consts::PI / 180.0;
    let d_lat = to_rad(lat2 - lat1);
    let d_lon = to_rad(lon2 - lon1);
    let a = (d_lat / 2.0).sin().powi(2)
        + to_rad(lat1).cos() * to_rad(lat2).cos() * (d_lon / 2.0).sin().powi(2);
    EARTH_RADIUS_M * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_point_is_zero() {
        assert_eq!(haversine_distance(52.0, 13.0, 52.0, 13.0), 0.0);
    }

    #[test]
    fn known_distance() {
        // Berlin → Munich ≈ 504 km
        let d = haversine_distance(52.52, 13.405, 48.137, 11.576);
        assert!((d - 504_000.0).abs() < 5_000.0, "got {d}");
    }
}
