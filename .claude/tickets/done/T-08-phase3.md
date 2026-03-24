# T-08 Phase 3 — Dynamic feature-tier mapping (admin UI)

**Completed:** 2026-03-24
**Branch:** `claude/verify-t08-phase2-deployment-z6h0n`

## What was done

- **migration-service** — migration `010_meta_rename_and_features`: renames `tiers`→`meta_tiers`, `admin_settings`→`meta_settings`, drops stale `sessions.createdAt_1` TTL index (INFRA-1.2 fix), creates `meta_features` collection seeded with 6 default features.
- **authority-service/tiers.rs** — `FeatureDoc` struct, `FeaturesCache` with 60s TTL, `load_features()` (DB-backed, falls back to static), `FeatureInput` struct, admin CRUD handlers (`admin_list_features`, `admin_create_feature`, `admin_update_feature`, `admin_delete_feature`); all `"tiers"` references → `"meta_tiers"`; routes `/admin/features` and `/admin/features/{name}` added to router.
- **authority-service/main.rs** — `features_cache: Arc<TokioRwLock<Option<FeaturesCache>>>` added to AppState; `"admin_settings"` → `"meta_settings"`.
- **authority-service/verify.rs** — loads features from cache via `load_features()`; passes features map to `can()` and includes in verify response.
- **users-service/main.rs** — `"admin_settings"` → `"meta_settings"` (4 occurrences).
- **messages-service/main.rs** — `"admin_settings"` → `"meta_settings"` (1 occurrence).
- **gateway/handlers.rs** — 4 admin features proxy handlers (`admin_features_list`, `admin_features_post`, `admin_features_put`, `admin_features_delete`).
- **gateway/main.rs** — routes `/api/admin/features` and `/api/admin/features/{name}`.
- **ui/scripts/api.js** — `adminListFeatures`, `adminCreateFeature`, `adminUpdateFeature`, `adminDeleteFeature`.
- **ui/scripts/admin.js** — Features tab in admin panel with `renderFeaturesTab()` and `saveFeatureMinTier()`.

All 5 Rust services compile with zero errors (warnings only).

## Deployment note

Migration 010 runs automatically on gateway boot. Redeploy all services after merging. After migration: old `tiers` and `admin_settings` collections are renamed; `meta_features` is seeded.
