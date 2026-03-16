/// Cached service-to-service JWT generator.
///
/// Mirrors the `serviceToken()` caching pattern used across all JS services.
/// Each service that calls another service should keep one `ServiceTokenCache`
/// instance in its app state and call `.get()` per outgoing request.
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize)]
struct Claims {
    sub:  String,
    role: String,
    exp:  u64,
    iat:  u64,
}

/// Thread-safe cached service JWT. Reuses the token until 5 seconds before expiry.
pub struct ServiceTokenCache {
    inner: Mutex<Option<(String, u64)>>, // (token, expiry_unix_secs)
}

impl ServiceTokenCache {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    /// Returns a valid service JWT for `service_name`, signed with `secret`.
    /// Generates a new 60-second token only when the cached one is stale.
    pub async fn get(
        &self,
        service_name: &str,
        secret: &str,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let mut guard = self.inner.lock().await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if let Some((token, expiry)) = guard.as_ref() {
            if *expiry > now + 5 {
                return Ok(token.clone());
            }
        }

        let exp = now + 60;
        let token = encode(
            &Header::new(Algorithm::HS256),
            &Claims { sub: service_name.to_string(), role: "service".to_string(), exp, iat: now },
            &EncodingKey::from_secret(secret.as_bytes()),
        )?;

        *guard = Some((token.clone(), exp));
        Ok(token)
    }
}

impl Default for ServiceTokenCache {
    fn default() -> Self {
        Self::new()
    }
}
