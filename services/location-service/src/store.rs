/// In-memory sharded location store.
///
/// See `common/src/SHARD.md` for the full design explanation.
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use common::{
    geo::haversine_distance,
    shard::{intersecting_shards, min_dist_to_shard, shard_for_coords, ShardKey},
};
use tokio::sync::RwLock;

// ── Types ─────────────────────────────────────────────────────────────────────

/// A single live location entry held in the shard grid.
#[derive(Clone, Debug)]
pub struct LocationEntry {
    pub user_id:       String,
    pub lat:           f64,
    pub lon:           f64,
    pub is_registered: bool,
    pub sex:           Option<String>,
    pub nickname:      Option<String>,
    pub age:           Option<i32>,
    pub accuracy:      String,
    pub updated_at:    Instant,
}

/// Returned by `nearby` — entry plus the already-computed haversine distance.
#[derive(Clone, Debug)]
pub struct NearbyResult {
    pub entry:      LocationEntry,
    pub distance_m: f64,
}

#[derive(Debug, PartialEq)]
pub enum UpsertResult {
    /// Location written (new user or moved far enough / enough time elapsed).
    Written,
    /// Suppressed — user hasn't moved far enough and interval hasn't elapsed.
    Skipped,
}

// ── MemoryStore ───────────────────────────────────────────────────────────────

type Shard = Arc<RwLock<HashMap<String, LocationEntry>>>;

pub struct MemoryStore {
    /// Outer map: shard key → shard.  The outer RwLock guards structural
    /// changes (inserting / dropping shards).  Each shard has its own
    /// RwLock so concurrent reads to different shards do not block each other.
    shards: RwLock<HashMap<ShardKey, Shard>>,

    /// user_id → current ShardKey — allows O(1) lookup and removal.
    user_index: RwLock<HashMap<String, ShardKey>>,

    /// Suppression state: user_id → (last write time, lat, lon).
    suppression: RwLock<HashMap<String, (Instant, f64, f64)>>,

    pub shard_m:           f64,
    pub ttl:               Duration,
    pub update_interval:   Duration,
    pub update_distance_m: f64,
}

impl MemoryStore {
    pub fn new(
        shard_m:           f64,
        ttl:               Duration,
        update_interval:   Duration,
        update_distance_m: f64,
    ) -> Arc<Self> {
        Arc::new(Self {
            shards:            RwLock::new(HashMap::new()),
            user_index:        RwLock::new(HashMap::new()),
            suppression:       RwLock::new(HashMap::new()),
            shard_m,
            ttl,
            update_interval,
            update_distance_m,
        })
    }

    // ── upsert ────────────────────────────────────────────────────────────────

    /// Insert or update a user's location.  Returns `Skipped` if suppression
    /// rules prevent the write (hasn't moved far enough and interval hasn't
    /// elapsed).
    pub async fn upsert(&self, entry: LocationEntry) -> UpsertResult {
        let user_id = entry.user_id.clone();
        let lat = entry.lat;
        let lon = entry.lon;

        // Suppression check.
        {
            let sup = self.suppression.read().await;
            if let Some(&(last_t, last_lat, last_lon)) = sup.get(&user_id) {
                let moved =
                    haversine_distance(last_lat, last_lon, lat, lon) >= self.update_distance_m;
                if !moved && last_t.elapsed() < self.update_interval {
                    return UpsertResult::Skipped;
                }
            }
        }

        let new_key = shard_for_coords(lat, lon, self.shard_m);

        // If the user was in a different shard before, remove them from it.
        let old_key = self.user_index.read().await.get(&user_id).copied();
        if let Some(old_key) = old_key {
            if old_key != new_key {
                let shards_r = self.shards.read().await;
                if let Some(shard) = shards_r.get(&old_key) {
                    shard.write().await.remove(&user_id);
                }
            }
        }

        // Insert into the new shard, creating it if needed.
        {
            let shards_r = self.shards.read().await;
            if let Some(shard) = shards_r.get(&new_key) {
                shard.write().await.insert(user_id.clone(), entry);
            } else {
                // Shard doesn't exist yet — need a write lock on the outer map.
                drop(shards_r);
                let mut shards_w = self.shards.write().await;
                let shard = shards_w
                    .entry(new_key)
                    .or_insert_with(|| Arc::new(RwLock::new(HashMap::new())));
                shard.write().await.insert(user_id.clone(), entry);
            }
        }

        // Update index and suppression.
        self.user_index.write().await.insert(user_id.clone(), new_key);
        self.suppression
            .write()
            .await
            .insert(user_id, (Instant::now(), lat, lon));

        UpsertResult::Written
    }

    // ── remove ────────────────────────────────────────────────────────────────

    /// Remove a user's location entirely (e.g. on DELETE /location).
    pub async fn remove(&self, user_id: &str) {
        let key = {
            let index = self.user_index.read().await;
            match index.get(user_id).copied() {
                Some(k) => k,
                None => return,
            }
        };

        {
            let shards_r = self.shards.read().await;
            if let Some(shard) = shards_r.get(&key) {
                shard.write().await.remove(user_id);
            }
        }

        self.user_index.write().await.remove(user_id);
        self.suppression.write().await.remove(user_id);
    }

    // ── get_user ──────────────────────────────────────────────────────────────

    /// Look up a single user's current location. Returns `None` if not found
    /// or if the entry has exceeded TTL.
    pub async fn get_user(&self, user_id: &str) -> Option<LocationEntry> {
        let key = self.user_index.read().await.get(user_id).copied()?;
        let shard_arc = {
            let shards_r = self.shards.read().await;
            shards_r.get(&key)?.clone()
        };
        let shard_r = shard_arc.read().await;
        let entry = shard_r.get(user_id)?.clone();
        if entry.updated_at.elapsed() > self.ttl {
            return None;
        }
        Some(entry)
    }

    // ── online_ids ────────────────────────────────────────────────────────────

    /// Returns the subset of `user_ids` that have a non-stale location entry.
    pub async fn online_ids(&self, user_ids: &[String]) -> HashSet<String> {
        let now = Instant::now();
        let index = self.user_index.read().await;
        let shards_r = self.shards.read().await;
        let mut online = HashSet::new();
        for user_id in user_ids {
            if let Some(key) = index.get(user_id) {
                if let Some(shard) = shards_r.get(key) {
                    let shard_r = shard.read().await;
                    if let Some(entry) = shard_r.get(user_id.as_str()) {
                        if now.duration_since(entry.updated_at) <= self.ttl {
                            online.insert(user_id.clone());
                        }
                    }
                }
            }
        }
        online
    }

    // ── nearby ────────────────────────────────────────────────────────────────

    /// Returns up to `limit` nearest users within `radius_m` metres.
    ///
    /// `exclude_ids`: never returned (caller's own id, blocked users).
    /// `always_include`: favourite user ids — guaranteed slots within `limit`
    ///   (see SHARD.md for the reserved-slot model).
    /// `limit == 0` means unlimited.
    pub async fn nearby(
        &self,
        lat: f64,
        lon: f64,
        radius_m: f64,
        limit: usize,
        exclude_ids: &HashSet<String>,
        always_include: &HashSet<String>,
    ) -> Vec<NearbyResult> {
        let now = Instant::now();

        // Candidate shards sorted by minimum distance to query point.
        let mut candidates = intersecting_shards(lat, lon, radius_m, self.shard_m);
        candidates.sort_by(|a, b| {
            min_dist_to_shard(lat, lon, *a, self.shard_m)
                .partial_cmp(&min_dist_to_shard(lat, lon, *b, self.shard_m))
                .unwrap()
        });

        let mut results: Vec<(f64, LocationEntry)> = Vec::new();

        for (i, key) in candidates.iter().enumerate() {
            let shard_arc = {
                let shards_r = self.shards.read().await;
                match shards_r.get(key) {
                    Some(s) => s.clone(),
                    None => continue,
                }
            };

            let mut stale_keys: Vec<String> = Vec::new();
            {
                let shard_r = shard_arc.read().await;
                for (user_id, entry) in shard_r.iter() {
                    if exclude_ids.contains(user_id) {
                        continue;
                    }
                    if now.duration_since(entry.updated_at) > self.ttl {
                        stale_keys.push(user_id.clone());
                        continue;
                    }
                    let d = haversine_distance(lat, lon, entry.lat, entry.lon);
                    if d <= radius_m {
                        results.push((d, entry.clone()));
                    }
                }
            }

            // Evict stale entries discovered during the scan.
            if !stale_keys.is_empty() {
                let mut shard_w = shard_arc.write().await;
                for k in &stale_keys {
                    shard_w.remove(k);
                }
            }

            // Early exit: if we have enough results and the next shard's nearest
            // point is farther than the current Nth result, no remaining shard
            // can displace any result.
            if limit > 0 && results.len() >= limit {
                results.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
                let nth_dist = results[limit - 1].0;
                if let Some(next_key) = candidates.get(i + 1) {
                    if min_dist_to_shard(lat, lon, *next_key, self.shard_m) > nth_dist {
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        // Final sort.
        results.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));

        // For any always_include user not captured by the sorted traversal
        // (missed due to early exit), fetch them directly.
        let found_ids: HashSet<&str> = results.iter().map(|(_, e)| e.user_id.as_str()).collect();
        let mut extra_favs: Vec<(f64, LocationEntry)> = Vec::new();
        for fav_id in always_include {
            if found_ids.contains(fav_id.as_str()) || exclude_ids.contains(fav_id) {
                continue;
            }
            if let Some(entry) = self.get_user(fav_id).await {
                let d = haversine_distance(lat, lon, entry.lat, entry.lon);
                if d <= radius_m {
                    extra_favs.push((d, entry));
                }
            }
        }
        results.extend(extra_favs);
        results.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));

        // Reserved-slot model: favourites occupy their slots first, then
        // remaining slots go to nearest non-favourites. Total ≤ limit.
        let (fav_results, other_results): (Vec<_>, Vec<_>) = results
            .into_iter()
            .partition(|(_, e)| always_include.contains(&e.user_id));

        let fav_count = fav_results.len();
        let other_limit = if limit == 0 {
            other_results.len()
        } else {
            limit.saturating_sub(fav_count)
        };

        let mut final_results: Vec<(f64, LocationEntry)> = fav_results;
        final_results.extend(other_results.into_iter().take(other_limit));
        final_results.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));

        final_results
            .into_iter()
            .map(|(d, e)| NearbyResult { entry: e, distance_m: d })
            .collect()
    }

    // ── sweep ─────────────────────────────────────────────────────────────────

    /// Remove all entries whose `updated_at` has exceeded TTL.
    /// Called by the background sweep task every `LOCATION_SWEEP_INTERVAL_SECS`.
    pub async fn sweep(&self) {
        let now = Instant::now();
        let stale_users: Vec<String> = {
            let shards_r = self.shards.read().await;
            let mut stale = Vec::new();
            for shard in shards_r.values() {
                let shard_r = shard.read().await;
                for (user_id, entry) in shard_r.iter() {
                    if now.duration_since(entry.updated_at) > self.ttl {
                        stale.push(user_id.clone());
                    }
                }
            }
            stale
        };
        for user_id in stale_users {
            self.remove(&user_id).await;
        }

        // Drop empty shards.
        let empty_keys: Vec<ShardKey> = {
            let shards_r = self.shards.read().await;
            let mut empty = Vec::new();
            for (key, shard) in shards_r.iter() {
                if shard.read().await.is_empty() {
                    empty.push(*key);
                }
            }
            empty
        };
        if !empty_keys.is_empty() {
            let mut shards_w = self.shards.write().await;
            for key in empty_keys {
                shards_w.remove(&key);
            }
        }
    }

    // ── test helpers ──────────────────────────────────────────────────────────

    /// Insert an entry with an explicit timestamp. Test-only — allows injecting
    /// stale entries to verify TTL eviction.
    #[cfg(test)]
    pub async fn upsert_at(&self, entry: LocationEntry) {
        let user_id = entry.user_id.clone();
        let key = shard_for_coords(entry.lat, entry.lon, self.shard_m);
        {
            let shards_r = self.shards.read().await;
            if let Some(shard) = shards_r.get(&key) {
                shard.write().await.insert(user_id.clone(), entry);
            } else {
                drop(shards_r);
                let mut shards_w = self.shards.write().await;
                let shard = shards_w
                    .entry(key)
                    .or_insert_with(|| Arc::new(RwLock::new(HashMap::new())));
                shard.write().await.insert(user_id.clone(), entry);
            }
        }
        self.user_index.write().await.insert(user_id, key);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Berlin city centre — used as the query anchor in most tests.
    const LAT: f64 = 52.520_008;
    const LON: f64 = 13.404_954;

    const SHARD_M: f64 = 2_000.0;
    const TTL: Duration = Duration::from_secs(300);
    const INTERVAL: Duration = Duration::from_secs(15);
    const DIST_M: f64 = 100.0;

    fn store() -> Arc<MemoryStore> {
        MemoryStore::new(SHARD_M, TTL, INTERVAL, DIST_M)
    }

    fn entry(id: &str, lat: f64, lon: f64) -> LocationEntry {
        LocationEntry {
            user_id:       id.to_string(),
            lat,
            lon,
            is_registered: true,
            sex:           None,
            nickname:      Some(id.to_string()),
            age:           None,
            accuracy:      "gps".to_string(),
            updated_at:    Instant::now(),
        }
    }

    fn no_ids() -> HashSet<String> {
        HashSet::new()
    }

    // ── 0 users ───────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn empty_store_returns_nothing() {
        let s = store();
        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn get_user_on_empty_store() {
        let s = store();
        assert!(s.get_user("nobody").await.is_none());
    }

    #[tokio::test]
    async fn online_ids_on_empty_store() {
        let s = store();
        let ids = vec!["a".to_string(), "b".to_string()];
        assert!(s.online_ids(&ids).await.is_empty());
    }

    // ── 1 user ────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn single_user_within_radius_found() {
        let s = store();
        // 50 m north of query point — well within 1 000 m.
        s.upsert(entry("alice", LAT + 0.000_45, LON)).await;
        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.user_id, "alice");
        assert!(results[0].distance_m < 100.0);
    }

    #[tokio::test]
    async fn single_user_beyond_radius_not_found() {
        let s = store();
        // ~5 km north — beyond the 1 000 m radius.
        s.upsert(entry("bob", LAT + 0.045, LON)).await;
        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn get_user_returns_entry() {
        let s = store();
        s.upsert(entry("carol", LAT, LON)).await;
        let e = s.get_user("carol").await.unwrap();
        assert_eq!(e.user_id, "carol");
        assert!((e.lat - LAT).abs() < 1e-9);
    }

    #[tokio::test]
    async fn remove_then_not_found() {
        let s = store();
        s.upsert(entry("dave", LAT, LON)).await;
        assert!(s.get_user("dave").await.is_some());
        s.remove("dave").await;
        assert!(s.get_user("dave").await.is_none());
        let results = s.nearby(LAT, LON, 5_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty());
    }

    // ── 100 users in one shard ────────────────────────────────────────────────

    #[tokio::test]
    async fn hundred_users_in_home_shard_limit_respected() {
        let s = store();
        // Place 100 users within ~500 m of the query point (same shard).
        for i in 0..100u32 {
            let offset = (i as f64) * 0.000_004; // ~0.4 m spacing
            s.upsert(entry(&format!("u{i}"), LAT + offset, LON)).await;
        }
        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 50, "limit should cap at 50");
        // Verify ascending distance order.
        for w in results.windows(2) {
            assert!(w[0].distance_m <= w[1].distance_m);
        }
    }

    #[tokio::test]
    async fn hundred_users_unlimited_returns_all_within_radius() {
        let s = store();
        for i in 0..100u32 {
            let offset = (i as f64) * 0.000_004;
            s.upsert(entry(&format!("u{i}"), LAT + offset, LON)).await;
        }
        // limit = 0 → unlimited
        let results = s.nearby(LAT, LON, 1_000.0, 0, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 100);
    }

    // ── Users in surrounding shards ───────────────────────────────────────────

    #[tokio::test]
    async fn users_across_multiple_shards_ordered_by_distance() {
        let s = store();
        // close: ~50 m away (home shard)
        s.upsert(entry("close", LAT + 0.000_45, LON)).await;
        // mid: ~1 500 m away (likely adjacent shard)
        s.upsert(entry("mid", LAT + 0.013_5, LON)).await;
        // far: ~3 000 m away (two shards out)
        s.upsert(entry("far", LAT + 0.027, LON)).await;

        let results = s.nearby(LAT, LON, 5_000.0, 50, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].entry.user_id, "close");
        assert_eq!(results[1].entry.user_id, "mid");
        assert_eq!(results[2].entry.user_id, "far");
    }

    #[tokio::test]
    async fn early_exit_skips_distant_shards() {
        let s = store();
        // Fill home shard with limit+1 users so early exit fires before outer shards.
        for i in 0..10u32 {
            let offset = (i as f64) * 0.000_004;
            s.upsert(entry(&format!("home{i}"), LAT + offset, LON)).await;
        }
        // Plant one user ~10 km away — should NOT be returned when limit=5.
        s.upsert(entry("distant", LAT + 0.09, LON)).await;

        let results = s.nearby(LAT, LON, 20_000.0, 5, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 5);
        assert!(results.iter().all(|r| r.entry.user_id != "distant"));
    }

    // ── Users in shards too distant / not connected ───────────────────────────

    #[tokio::test]
    async fn user_outside_radius_not_returned_even_in_intersecting_shard() {
        let s = store();
        // Place user at exactly radius + 1 m.
        // Use a user due north: 1° lat ≈ 111 320 m, so 0.009° ≈ 1 002 m > 1 000 m.
        s.upsert(entry("just_outside", LAT + 0.009_02, LON)).await;
        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn disconnected_shard_users_not_returned() {
        let s = store();
        // User in Munich — ~500 km away.
        s.upsert(entry("munich", 48.137, 11.576)).await;
        let results = s.nearby(LAT, LON, 5_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty());
    }

    // ── Exclude ids ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn excluded_user_not_returned() {
        let s = store();
        s.upsert(entry("self", LAT, LON)).await;
        s.upsert(entry("other", LAT + 0.001, LON)).await;

        let mut exclude = HashSet::new();
        exclude.insert("self".to_string());

        let results = s.nearby(LAT, LON, 1_000.0, 50, &exclude, &no_ids()).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.user_id, "other");
    }

    // ── Favourites ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn favourite_within_radius_included_in_reserved_slot() {
        let s = store();
        // Fill 5 close non-favourite users.
        for i in 0..5u32 {
            s.upsert(entry(&format!("stranger{i}"), LAT + (i as f64) * 0.000_004, LON)).await;
        }
        // Favourite is a bit farther but still within radius.
        s.upsert(entry("fav", LAT + 0.000_5, LON)).await;

        let mut fav_ids = HashSet::new();
        fav_ids.insert("fav".to_string());

        // Limit = 3: without reservation, "fav" might be excluded.
        // With reserved slots, fav takes 1 slot, leaving 2 for strangers.
        let results = s.nearby(LAT, LON, 2_000.0, 3, &no_ids(), &fav_ids).await;
        assert_eq!(results.len(), 3);
        assert!(results.iter().any(|r| r.entry.user_id == "fav"), "favourite must appear");
    }

    #[tokio::test]
    async fn favourites_do_not_inflate_total_beyond_limit() {
        let s = store();
        // 10 non-favourite users.
        for i in 0..10u32 {
            s.upsert(entry(&format!("s{i}"), LAT + (i as f64) * 0.000_004, LON)).await;
        }
        // 3 favourite users (also close).
        for i in 0..3u32 {
            s.upsert(entry(&format!("f{i}"), LAT + 0.000_5 + (i as f64) * 0.000_004, LON)).await;
        }
        let mut fav_ids = HashSet::new();
        for i in 0..3u32 { fav_ids.insert(format!("f{i}")); }

        let results = s.nearby(LAT, LON, 5_000.0, 5, &no_ids(), &fav_ids).await;
        assert_eq!(results.len(), 5, "total must not exceed limit");
        let fav_count = results.iter().filter(|r| fav_ids.contains(&r.entry.user_id)).count();
        assert_eq!(fav_count, 3, "all 3 favourites must appear");
    }

    #[tokio::test]
    async fn favourite_beyond_radius_not_included() {
        let s = store();
        // Favourite is 10 km away — beyond the 1 000 m radius.
        s.upsert(entry("distant_fav", LAT + 0.09, LON)).await;

        let mut fav_ids = HashSet::new();
        fav_ids.insert("distant_fav".to_string());

        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &fav_ids).await;
        assert!(results.is_empty(), "favourite beyond radius must not appear");
    }

    #[tokio::test]
    async fn favourite_found_via_direct_lookup_after_early_exit() {
        let s = store();
        // Fill home shard beyond limit so early exit fires.
        for i in 0..20u32 {
            s.upsert(entry(&format!("s{i}"), LAT + (i as f64) * 0.000_002, LON)).await;
        }
        // Favourite is in an adjacent shard — might be missed by early exit.
        // Place it just beyond the home shard boundary (~2 100 m away).
        s.upsert(entry("fav_far", LAT + 0.019, LON)).await;

        let mut fav_ids = HashSet::new();
        fav_ids.insert("fav_far".to_string());

        // limit=10 — early exit will fire after home shard (20 users found > 10).
        // fav_far must still appear via direct lookup fallback.
        let results = s.nearby(LAT, LON, 10_000.0, 10, &no_ids(), &fav_ids).await;
        assert!(
            results.iter().any(|r| r.entry.user_id == "fav_far"),
            "favourite missed by early exit must be recovered via direct lookup"
        );
        assert!(results.len() <= 10, "total must not exceed limit");
    }

    // ── TTL / stale eviction ──────────────────────────────────────────────────

    #[tokio::test]
    async fn stale_entry_not_returned_by_nearby() {
        let s = MemoryStore::new(SHARD_M, Duration::from_millis(1), INTERVAL, DIST_M);
        // Insert with timestamp already expired.
        let mut e = entry("ghost", LAT, LON);
        e.updated_at = Instant::now() - Duration::from_secs(1);
        s.upsert_at(e).await;

        let results = s.nearby(LAT, LON, 1_000.0, 50, &no_ids(), &no_ids()).await;
        assert!(results.is_empty(), "stale entry must not appear in nearby");
    }

    #[tokio::test]
    async fn stale_entry_not_returned_by_get_user() {
        let s = MemoryStore::new(SHARD_M, Duration::from_millis(1), INTERVAL, DIST_M);
        let mut e = entry("ghost", LAT, LON);
        e.updated_at = Instant::now() - Duration::from_secs(1);
        s.upsert_at(e).await;

        assert!(s.get_user("ghost").await.is_none());
    }

    #[tokio::test]
    async fn sweep_removes_stale_entries() {
        let s = MemoryStore::new(SHARD_M, Duration::from_millis(1), INTERVAL, DIST_M);
        let mut e = entry("ghost", LAT, LON);
        e.updated_at = Instant::now() - Duration::from_secs(1);
        s.upsert_at(e).await;

        s.sweep().await;

        // After sweep, user_index should be empty.
        assert!(s.user_index.read().await.is_empty());
        assert!(s.get_user("ghost").await.is_none());
    }

    // ── Suppression ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn second_upsert_same_position_skipped() {
        let s = store();
        let r1 = s.upsert(entry("user", LAT, LON)).await;
        let r2 = s.upsert(entry("user", LAT, LON)).await;
        assert_eq!(r1, UpsertResult::Written);
        assert_eq!(r2, UpsertResult::Skipped);
    }

    #[tokio::test]
    async fn upsert_far_enough_not_suppressed() {
        let s = store();
        s.upsert(entry("user", LAT, LON)).await;
        // Move 200 m north — exceeds UPDATE_DISTANCE_M (100 m).
        let r = s.upsert(entry("user", LAT + 0.001_8, LON)).await;
        assert_eq!(r, UpsertResult::Written);
    }

    // ── Shard boundary crossing ───────────────────────────────────────────────

    #[tokio::test]
    async fn user_tracked_after_crossing_shard_boundary() {
        let s = store();
        s.upsert(entry("mover", LAT, LON)).await;

        // Move 3 km north — definitely crosses a 2 000 m shard boundary.
        let new_lat = LAT + 0.027;
        s.upsert(entry("mover", new_lat, LON)).await;

        // Should be found near new location.
        let results = s.nearby(new_lat, LON, 500.0, 50, &no_ids(), &no_ids()).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].entry.user_id, "mover");

        // Should NOT be found near old location.
        let old_results = s.nearby(LAT, LON, 500.0, 50, &no_ids(), &no_ids()).await;
        assert!(old_results.is_empty(), "user must not appear in old shard after crossing");
    }

    // ── online_ids ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn online_ids_returns_only_active_users() {
        let s = store();
        s.upsert(entry("online1", LAT, LON)).await;
        s.upsert(entry("online2", LAT + 0.001, LON)).await;

        let ids = vec![
            "online1".to_string(),
            "online2".to_string(),
            "offline".to_string(),
        ];
        let online = s.online_ids(&ids).await;
        assert!(online.contains("online1"));
        assert!(online.contains("online2"));
        assert!(!online.contains("offline"));
    }

    #[tokio::test]
    async fn online_ids_stale_user_reported_offline() {
        let s = MemoryStore::new(SHARD_M, Duration::from_millis(1), INTERVAL, DIST_M);
        let mut e = entry("ghost", LAT, LON);
        e.updated_at = Instant::now() - Duration::from_secs(1);
        s.upsert_at(e).await;

        let ids = vec!["ghost".to_string()];
        let online = s.online_ids(&ids).await;
        assert!(online.is_empty(), "stale user must be reported offline");
    }
}
