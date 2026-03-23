/// MongoDB-backed location store — the `db` variant of `LOCATION_STORE`.
///
/// Shares the shard-key scheme with `MemoryStore` so both backends produce
/// identical query results.  Suppression (update-interval / update-distance)
/// is enforced in-process; MongoDB is the authoritative TTL source.
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use common::{
    geo::haversine_distance,
    shard::{intersecting_shards, shard_for_coords},
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, DateTime as BsonDateTime, Document},
    Collection,
};
use tokio::sync::RwLock;

use crate::store::{LocationEntry, NearbyResult, UpsertResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn shard_key_str(key: common::shard::ShardKey) -> String {
    format!("{}:{}", key.0, key.1)
}

/// BsonDateTime for `now - ttl`, used as a lower-bound in queries.
fn cutoff_dt(ttl: Duration) -> BsonDateTime {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    BsonDateTime::from_millis(now_ms - ttl.as_millis() as i64)
}

/// Reconstruct a `LocationEntry` from a BSON document.
///
/// `updated_at` is set to `Instant::now()` (elapsed ≈ 0) because the DB
/// query already filters by TTL — any returned document is live.
fn doc_to_entry(d: &Document) -> Option<LocationEntry> {
    Some(LocationEntry {
        user_id:       d.get_str("userId").ok()?.to_string(),
        lat:           d.get_f64("lat").ok()?,
        lon:           d.get_f64("lon").ok()?,
        is_registered: d.get_bool("isRegistered").unwrap_or(false),
        sex:           d.get_str("sex").ok().map(String::from),
        nickname:      d.get_str("nickname").ok().map(String::from),
        age:           d.get_i32("age").ok(),
        accuracy:      d.get_str("accuracy").unwrap_or("gps").to_string(),
        updated_at:    Instant::now(),
    })
}

// ── DbStore ───────────────────────────────────────────────────────────────────

pub struct DbStore {
    col:               Collection<Document>,
    pub shard_m:           f64,
    pub ttl:               Duration,
    pub update_interval:   Duration,
    pub update_distance_m: f64,
    /// In-process suppression state — avoids redundant DB writes.
    suppression: RwLock<HashMap<String, (Instant, f64, f64)>>,
}

impl DbStore {
    pub fn new(
        col:               Collection<Document>,
        shard_m:           f64,
        ttl:               Duration,
        update_interval:   Duration,
        update_distance_m: f64,
    ) -> Arc<Self> {
        Arc::new(Self {
            col,
            shard_m,
            ttl,
            update_interval,
            update_distance_m,
            suppression: RwLock::new(HashMap::new()),
        })
    }

    // ── upsert ────────────────────────────────────────────────────────────────

    pub async fn upsert(&self, entry: LocationEntry) -> UpsertResult {
        let user_id = entry.user_id.clone();
        let lat     = entry.lat;
        let lon     = entry.lon;

        // Suppression check — mirrors MemoryStore logic exactly.
        {
            let sup = self.suppression.read().await;
            if let Some(&(last_t, last_lat, last_lon)) = sup.get(&user_id) {
                let moved = haversine_distance(last_lat, last_lon, lat, lon)
                    >= self.update_distance_m;
                if !moved && last_t.elapsed() < self.update_interval {
                    return UpsertResult::Skipped;
                }
            }
        }

        let shard_key = shard_key_str(shard_for_coords(lat, lon, self.shard_m));

        let set_doc = doc! {
            "shard_key":   &shard_key,
            "lat":         lat,
            "lon":         lon,
            "isRegistered": entry.is_registered,
            "sex":         entry.sex,
            "nickname":    entry.nickname,
            "age":         entry.age,
            "accuracy":    &entry.accuracy,
            "updatedAt":   BsonDateTime::now(),
        };

        match self.col
            .update_one(
                doc! { "userId": &user_id },
                doc! {
                    "$set":         set_doc,
                    "$setOnInsert": { "userId": &user_id },
                },
            )
            .upsert(true)
            .await
        {
            Ok(_) => {
                self.suppression
                    .write()
                    .await
                    .insert(user_id, (Instant::now(), lat, lon));
                UpsertResult::Written
            }
            Err(e) => {
                eprintln!("[location/db_store] upsert: {e}");
                // Best-effort: return Written so the HTTP handler doesn't error.
                UpsertResult::Written
            }
        }
    }

    // ── remove ────────────────────────────────────────────────────────────────

    pub async fn remove(&self, user_id: &str) {
        if let Err(e) = self.col.delete_one(doc! { "userId": user_id }).await {
            eprintln!("[location/db_store] remove: {e}");
        }
        self.suppression.write().await.remove(user_id);
    }

    // ── get_user ──────────────────────────────────────────────────────────────

    pub async fn get_user(&self, user_id: &str) -> Option<LocationEntry> {
        let cutoff = cutoff_dt(self.ttl);
        match self.col
            .find_one(doc! {
                "userId":    user_id,
                "updatedAt": { "$gt": cutoff },
            })
            .await
        {
            Ok(Some(d)) => doc_to_entry(&d),
            Ok(None)    => None,
            Err(e)      => { eprintln!("[location/db_store] get_user: {e}"); None }
        }
    }

    // ── online_ids ────────────────────────────────────────────────────────────

    pub async fn online_ids(&self, user_ids: &[String]) -> HashSet<String> {
        let cutoff   = cutoff_dt(self.ttl);
        let ids_bson: Vec<Bson> = user_ids.iter().map(|s| Bson::String(s.clone())).collect();

        match self.col
            .find(doc! {
                "userId":    { "$in": ids_bson },
                "updatedAt": { "$gt": cutoff },
            })
            .projection(doc! { "userId": 1 })
            .await
        {
            Ok(cursor) => cursor
                .try_collect::<Vec<Document>>()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter_map(|d| d.get_str("userId").ok().map(String::from))
                .collect(),
            Err(e) => {
                eprintln!("[location/db_store] online_ids: {e}");
                HashSet::new()
            }
        }
    }

    // ── nearby ────────────────────────────────────────────────────────────────

    pub async fn nearby(
        &self,
        lat:            f64,
        lon:            f64,
        radius_m:       f64,
        limit:          usize,
        exclude_ids:    &HashSet<String>,
        always_include: &HashSet<String>,
    ) -> Vec<NearbyResult> {
        let shard_keys: Vec<Bson> = intersecting_shards(lat, lon, radius_m, self.shard_m)
            .into_iter()
            .map(|k| Bson::String(shard_key_str(k)))
            .collect();

        let cutoff = cutoff_dt(self.ttl);

        let docs: Vec<Document> = match self.col
            .find(doc! {
                "shard_key": { "$in": shard_keys },
                "updatedAt": { "$gt": cutoff },
            })
            .await
        {
            Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
            Err(e) => {
                eprintln!("[location/db_store] nearby: {e}");
                return vec![];
            }
        };

        // Haversine post-filter + exclude.
        let mut results: Vec<(f64, LocationEntry)> = docs
            .iter()
            .filter_map(doc_to_entry)
            .filter(|e| !exclude_ids.contains(&e.user_id))
            .map(|e| {
                let d = haversine_distance(lat, lon, e.lat, e.lon);
                (d, e)
            })
            .filter(|(d, _)| *d <= radius_m)
            .collect();

        results.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        // Reserved-slot model — identical to MemoryStore.
        let (fav_results, other_results): (Vec<_>, Vec<_>) = results
            .into_iter()
            .partition(|(_, e)| always_include.contains(&e.user_id));

        let fav_count   = fav_results.len();
        let other_limit = if limit == 0 {
            other_results.len()
        } else {
            limit.saturating_sub(fav_count)
        };

        let mut final_results = fav_results;
        final_results.extend(other_results.into_iter().take(other_limit));
        final_results.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

        final_results
            .into_iter()
            .map(|(d, e)| NearbyResult { entry: e, distance_m: d })
            .collect()
    }

    // ── sweep ─────────────────────────────────────────────────────────────────

    pub async fn sweep(&self) {
        let cutoff = cutoff_dt(self.ttl);
        match self.col
            .delete_many(doc! { "updatedAt": { "$lt": cutoff } })
            .await
        {
            Ok(r) if r.deleted_count > 0 =>
                println!("[location/db_store] sweep removed {} stale entries", r.deleted_count),
            Ok(_)  => {}
            Err(e) => eprintln!("[location/db_store] sweep: {e}"),
        }
    }
}
