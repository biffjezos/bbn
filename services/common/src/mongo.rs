/// MongoDB helpers shared across services.
///
/// Mirrors the `safeObjectId()` utility duplicated across
/// users-service.js, messages-service.js, and favourites-service.js (AUDIT.md 6.1).
use mongodb::bson::oid::ObjectId;
use std::str::FromStr;

/// Parse a string into a MongoDB ObjectId, returning `None` on invalid input.
/// Use this instead of `ObjectId::from_str(...).unwrap()` to avoid panics on
/// user-supplied IDs.
pub fn safe_object_id(id: &str) -> Option<ObjectId> {
    ObjectId::from_str(id).ok()
}
