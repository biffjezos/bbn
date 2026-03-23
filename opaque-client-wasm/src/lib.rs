// ============================================================
// bOOmbOOm.NOW! — opaque-client-wasm
// OPAQUE client-side protocol steps compiled to WebAssembly.
//
// Exposes four functions to JavaScript:
//   register_start(password)         → base64 RegistrationRequest
//   register_finish(password, resp)  → base64 RegistrationUpload
//   login_start(password)            → base64 CredentialRequest
//   login_finish(password, resp)     → { finalization: string, exportKey: string }
//
// Thread-local state holds the in-progress ClientRegistration /
// ClientLogin between the start and finish calls. Only one
// registration and one login can be in progress at a time —
// the crypto-worker is single-threaded so this is always true.
// ============================================================

use std::cell::RefCell;
use base64::prelude::*;
use js_sys::Object;
use wasm_bindgen::prelude::*;
use opaque_ke::{
    ciphersuite::CipherSuite,
    ClientLogin, ClientLoginFinishParameters,
    ClientRegistration, ClientRegistrationFinishParameters,
    CredentialResponse, RegistrationResponse,
};

// ── Cipher suite ──────────────────────────────────────────────────────────────
//
// Must match the server-side DefaultCs in auth-service exactly.
// Ristretto255 OPRF + TripleDH AKE with SHA-512 + Argon2 KSF.

struct DefaultCs;

impl CipherSuite for DefaultCs {
    type OprfCs     = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf        = opaque_ke::argon2::Argon2<'static>;
}

// ── Thread-local client state ─────────────────────────────────────────────────

thread_local! {
    static REG_STATE:   RefCell<Option<ClientRegistration<DefaultCs>>> = RefCell::new(None);
    static LOGIN_STATE: RefCell<Option<ClientLogin<DefaultCs>>>        = RefCell::new(None);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn enc<B: AsRef<[u8]>>(b: B) -> String { BASE64_STANDARD.encode(b) }

fn dec(s: &str) -> Result<Vec<u8>, JsValue> {
    BASE64_STANDARD.decode(s).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn rng() -> opaque_ke::rand::rngs::OsRng { opaque_ke::rand::rngs::OsRng }

// ── Init ──────────────────────────────────────────────────────────────────────

/// Call once after loading the WASM module to set up error reporting.
#[wasm_bindgen]
pub fn init() {
    console_error_panic_hook::set_once();
}

// ── Registration ──────────────────────────────────────────────────────────────

/// Start registration. Returns base64-encoded RegistrationRequest to send
/// to the server. Stores client state internally — call register_finish() next.
#[wasm_bindgen]
pub fn register_start(password: &[u8]) -> Result<String, JsValue> {
    let res = ClientRegistration::<DefaultCs>::start(&mut rng(), password)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    REG_STATE.with(|s| *s.borrow_mut() = Some(res.state));
    Ok(enc(res.message.serialize()))
}

/// Finish registration. `server_response` is the base64 RegistrationResponse
/// from the server. Returns base64-encoded RegistrationUpload to send to the
/// server for storage.
#[wasm_bindgen]
pub fn register_finish(password: &[u8], server_response: &str) -> Result<String, JsValue> {
    let resp = RegistrationResponse::<DefaultCs>::deserialize(&dec(server_response)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let state = REG_STATE.with(|s| s.borrow_mut().take())
        .ok_or_else(|| JsValue::from_str("no registration in progress — call register_start first"))?;
    let res = state
        .finish(&mut rng(), password, resp, ClientRegistrationFinishParameters::default())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(enc(res.message.serialize()))
}

// ── Login ─────────────────────────────────────────────────────────────────────

/// Start login. Returns base64-encoded CredentialRequest to send to the server.
/// Stores client state internally — call login_finish() next.
#[wasm_bindgen]
pub fn login_start(password: &[u8]) -> Result<String, JsValue> {
    let res = ClientLogin::<DefaultCs>::start(&mut rng(), password)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    LOGIN_STATE.with(|s| *s.borrow_mut() = Some(res.state));
    Ok(enc(res.message.serialize()))
}

/// Finish login. `server_response` is the base64 CredentialResponse from the
/// server. Returns a JS object `{ finalization: string, exportKey: string }`
/// (both base64). Throws if the password is wrong.
#[wasm_bindgen]
pub fn login_finish(password: &[u8], server_response: &str) -> Result<JsValue, JsValue> {
    let resp = CredentialResponse::<DefaultCs>::deserialize(&dec(server_response)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let state = LOGIN_STATE.with(|s| s.borrow_mut().take())
        .ok_or_else(|| JsValue::from_str("no login in progress — call login_start first"))?;
    let res = state
        .finish(&mut rng(), password, resp, ClientLoginFinishParameters::default())
        .map_err(|_| JsValue::from_str("Incorrect password."))?;

    let obj = Object::new();
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("finalization"),
        &JsValue::from_str(&enc(res.message.serialize())),
    )?;
    js_sys::Reflect::set(
        &obj,
        &JsValue::from_str("exportKey"),
        &JsValue::from_str(&enc(res.export_key.as_slice())),
    )?;
    Ok(obj.into())
}
