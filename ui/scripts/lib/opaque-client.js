// ./lib/opaque-client.js
// ============================================================
// bOOmbOOm.NOW! — OPAQUE client bridge (ES6 module version)
//
// Loads the opaque-ke WASM module and exposes OpaqueClient as an export.
//
// Exposed API (all async):
//   OpaqueClient.hashEmail(email)                          → hex string
//   OpaqueClient.registerStart(password)                   → base64 RegistrationRequest
//   OpaqueClient.registerFinish(password, b64Response)     → base64 RegistrationUpload
//   OpaqueClient.loginStart(password)                      → base64 LoginRequest
//   OpaqueClient.loginFinish(password, b64Response)        → { finalization, exportKey }
//
// OpaqueClient.ready is a Promise that resolves when the WASM is loaded.
// ============================================================

import initWasm, { init, register_start, register_finish, login_start, login_finish } 
  from '../opaque-client/opaque_client_wasm.js';

const enc = new TextEncoder();

function toBytes(str) {
  return enc.encode(str);
}

// PBKDF2 hash of email with a fixed domain salt
async function hashEmail(email) {
  const lower = email.trim().toLowerCase();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(lower),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode('boomboom-email-v2'),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Initialise the WASM module exactly once
const ready = initWasm().then(() => init());

export const OpaqueClient = {
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
