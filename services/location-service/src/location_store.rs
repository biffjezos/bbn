/// Enum-dispatch wrapper so `AppState.store` can hold either backend
/// without boxing or `dyn Trait`.
///
/// Selected at startup via `LOCATION_STORE=memory|db` (default `memory`).
use std::{collections::HashSet, sync::Arc};

use crate::db_store::DbStore;
use crate::store::{LocationEntry, MemoryStore, NearbyResult, UpsertResult};

pub enum Store {
    Memory(Arc<MemoryStore>),
    Db(Arc<DbStore>),
}

impl Store {
    pub async fn upsert(&self, entry: LocationEntry) -> UpsertResult {
        match self {
            Self::Memory(m) => m.upsert(entry).await,
            Self::Db(d)     => d.upsert(entry).await,
        }
    }

    pub async fn remove(&self, user_id: &str) {
        match self {
            Self::Memory(m) => m.remove(user_id).await,
            Self::Db(d)     => d.remove(user_id).await,
        }
    }

    pub async fn get_user(&self, user_id: &str) -> Option<LocationEntry> {
        match self {
            Self::Memory(m) => m.get_user(user_id).await,
            Self::Db(d)     => d.get_user(user_id).await,
        }
    }

    pub async fn online_ids(&self, user_ids: &[String]) -> HashSet<String> {
        match self {
            Self::Memory(m) => m.online_ids(user_ids).await,
            Self::Db(d)     => d.online_ids(user_ids).await,
        }
    }

    pub async fn nearby(
        &self,
        lat:            f64,
        lon:            f64,
        radius_m:       f64,
        limit:          usize,
        exclude_ids:    &HashSet<String>,
        always_include: &HashSet<String>,
    ) -> Vec<NearbyResult> {
        match self {
            Self::Memory(m) => m.nearby(lat, lon, radius_m, limit, exclude_ids, always_include).await,
            Self::Db(d)     => d.nearby(lat, lon, radius_m, limit, exclude_ids, always_include).await,
        }
    }

    pub async fn sweep(&self) {
        match self {
            Self::Memory(m) => m.sweep().await,
            Self::Db(d)     => d.sweep().await,
        }
    }
}
