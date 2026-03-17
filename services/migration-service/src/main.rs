// ============================================================
// bOOmbOOm.NOW! — migration-service
//
// One-shot binary: runs all pending migrations against the
// database, records each applied migration in the `_migrations`
// collection, then exits 0.
//
// Run manually (Railway one-off / local):
//   MONGO_URI=... DB_NAME=... cargo run -p migration-service
// ============================================================

use std::env;

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, DateTime},
    options::IndexOptions,
    Client, Database, IndexModel,
};
use serde::{Deserialize, Serialize};

// ── Migration record ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct MigrationRecord {
    id:         String,
    applied_at: DateTime,
}

// ── Migration registry ────────────────────────────────────────────────────────

/// A migration is a (id, async fn) pair.
/// IDs must be stable and unique — once applied they are never re-run.
/// Naming convention: `NNNN_short_description`
type MigFn = fn(db: Database) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send>>;

struct Migration {
    id: &'static str,
    run: MigFn,
}

/// All migrations in chronological order.
/// ADD NEW MIGRATIONS AT THE BOTTOM. Never reorder or remove.
const MIGRATIONS: &[Migration] = &[
    Migration { id: "0001_locations_permanent_index", run: |db| Box::pin(m0001_locations_permanent_index(db)) },
];

// ── Migration implementations ─────────────────────────────────────────────────

/// 0001 — Index supporting the venue "always visible" query.
///
/// The nearby / online-batch queries use:
///   { $or: [ { updatedAt: { $gt: cutoff } }, { permanent: true } ] }
///
/// Without this index MongoDB scans every location document to find permanent
/// venues.  A sparse index on `permanent` (only documents where the field is
/// present/true) keeps it lean.
async fn m0001_locations_permanent_index(db: Database) -> Result<(), String> {
    let opts = IndexOptions::builder()
        .name("permanent_sparse".to_string())
        .sparse(true)
        .build();

    db.collection::<mongodb::bson::Document>("locations")
        .create_index(
            IndexModel::builder()
                .keys(doc! { "permanent": 1 })
                .options(opts)
                .build(),
        )
        .await
        .map_err(|e| format!("create index: {e}"))?;

    Ok(())
}

// ── Runner ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let mongo_uri = env::var("MONGO_URI").expect("MONGO_URI not set");
    let db_name   = env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string());

    let client = Client::with_uri_str(&mongo_uri).await.expect("MongoDB connect failed");
    let db     = client.database(&db_name);

    // Load already-applied migrations
    let col = db.collection::<MigrationRecord>("_migrations");
    let applied: std::collections::HashSet<String> = col
        .find(doc! {})
        .await
        .expect("query _migrations")
        .try_collect::<Vec<_>>()
        .await
        .expect("collect _migrations")
        .into_iter()
        .map(|r| r.id)
        .collect();

    let mut ran = 0u32;

    for m in MIGRATIONS {
        if applied.contains(m.id) {
            println!("[migration] skip  {}", m.id);
            continue;
        }

        print!("[migration] apply {} … ", m.id);

        match (m.run)(db.clone()).await {
            Ok(()) => {
                col.insert_one(MigrationRecord {
                    id:         m.id.to_string(),
                    applied_at: DateTime::now(),
                })
                .await
                .expect("record migration");
                println!("ok");
                ran += 1;
            }
            Err(e) => {
                eprintln!("FAILED: {e}");
                std::process::exit(1);
            }
        }
    }

    println!("[migration] done — {ran} migration(s) applied.");
}
