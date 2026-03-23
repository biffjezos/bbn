// ============================================================
// bOOmbOOm.NOW! — OPAQUE client bridge
//
// Loads the opaque-ke WASM module and exposes window.OpaqueClient.
// Must be loaded as <script type="module"> before api.js is used.
//
// Exposed API (all async):
//   OpaqueClient.hashEmail(email)                          → hex string
//   OpaqueClient.registerStart(password)                   → base64 RegistrationRequest
//   OpaqueClient.registerFinish(password, b64Response)     → base64 RegistrationUpload
//   OpaqueClient.loginStart(password)                      → base64 LoginRequest
//   OpaqueClient.loginFinish(password, b64Response)        → { finalization, exportKey }
//
// window.OpaqueClient.ready is a Promise that resolves when the WASM is loaded.
// ============================================================

import initWasm, { init, register_start, register_finish, login_start, login_finish }
  from './opaque-client/opaque_client_wasm.js';

const enc = new TextEncoder();

function toBytes(str) {
  return enc.encode(str);
}

async function hashEmail(email) {
  const lower   = email.trim().toLowerCase();
  const encoded = enc.encode(lower);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Initialise the WASM module exactly once.
const ready = initWasm().then(() => { init(); });

window.OpaqueClient = {
  ready,

  async hashEmail(email) {
    await ready;
    return hashEmail(email);
  },

  async registerStart(password) {
    await ready;
    return register_start(toBytes(password));
  },

  async registerFinish(password, serverResponse) {
    await ready;
    return register_finish(toBytes(password), serverResponse);
  },

  async loginStart(password) {
    await ready;
    return login_start(toBytes(password));
  },

  async loginFinish(password, serverResponse) {
    await ready;
    return login_finish(toBytes(password), serverResponse);
  },
};
