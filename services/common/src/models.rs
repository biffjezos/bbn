/// Shared MongoDB document models used across multiple services.

use serde::{Deserialize, Serialize};

/// Minimal user projection for tokenVersion check.
/// Used by [`crate::auth::AuthToken`] to validate that a JWT has not been revoked.
#[derive(Deserialize)]
pub struct UserTv {
    #[serde(rename = "tokenVersion")]
    pub token_version: Option<i32>,
}

/// Block document as stored in the `blocks` collection.
/// Shared across location-service, messages-service, and users-service for block filtering.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BlockDoc {
    #[serde(rename = "blockerUserId")]
    pub blocker_user_id: String,
    #[serde(rename = "blockedUserId")]
    pub blocked_user_id: String,
}
