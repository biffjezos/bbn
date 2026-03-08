// ============================================================
// bOOmbOOm.NOW! — crypto-worker.js
// Runs as a SharedWorker (with regular Worker fallback for Safari).
// Private key is imported with extractable:false — it never leaves
// this worker. Only encrypted blobs, public keys, and message
// ciphertext/plaintext cross the thread boundary.
// ============================================================

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS  = { name: 'AES-GCM', length: 256 };
const PBKDF2_ITER = 200000;
const PBKDF2_HASH = 'SHA-256';

let _privateKey = null;  // extractable: false — never exported
let _publicKey  = null;  // extractable: true  — public by definition

// ── Helpers ──────────────────────────────────────────────────

function buf2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b642buf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKeyFromPassword(password, saltB64) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b642buf(saltB64), iterations: PBKDF2_ITER, hash: PBKDF2_HASH },
    keyMaterial, AES_PARAMS, false, ['encrypt', 'decrypt']
  );
}

async function exportPublicKey(key) {
  return buf2b64(await crypto.subtle.exportKey('raw', key));
}

async function encryptPkcs8(pkcs8, password) {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = buf2b64(salt.buffer);
  const aesKey  = await deriveKeyFromPassword(password, saltB64);
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, pkcs8);
  return { saltB64, ivB64: buf2b64(iv.buffer), encryptedB64: buf2b64(encrypted) };
}

async function decryptPkcs8(blob, password) {
  const aesKey = await deriveKeyFromPassword(password, blob.saltB64);
  const iv     = new Uint8Array(b642buf(blob.ivB64));
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, b642buf(blob.encryptedB64));
}

async function deriveSharedKey(theirPublicKeyB64) {
  const theirKey = await crypto.subtle.importKey(
    'raw', b642buf(theirPublicKeyB64), ECDH_PARAMS, false, []
  );
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirKey }, _privateKey, AES_PARAMS, false, ['encrypt', 'decrypt']
  );
}

// ── Commands ─────────────────────────────────────────────────

const CMD = {

  async setup({ password }) {
    // Generate extractable:true to export PKCS8, then re-import as non-extractable
    const keypair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
    const pkcs8   = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
    const encBlob = await encryptPkcs8(pkcs8, password);
    _privateKey   = await crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, false, ['deriveKey']);
    _publicKey    = keypair.publicKey;
    return { publicKeyB64: await exportPublicKey(_publicKey), encBlob };
  },

  async unlock({ encBlob, password, publicKeyB64 }) {
    try {
      const pkcs8 = await decryptPkcs8(encBlob, password);
      _privateKey  = await crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, false, ['deriveKey']);
      _publicKey   = await crypto.subtle.importKey('raw', b642buf(publicKeyB64), ECDH_PARAMS, true, []);
      return { ok: true };
    } catch {
      _privateKey = null; _publicKey = null;
      return { ok: false };
    }
  },

  lock() {
    _privateKey = null;
    _publicKey  = null;
    return {};
  },

  async reencrypt({ oldPassword, newPassword, encBlob }) {
    const pkcs8      = await decryptPkcs8(encBlob, oldPassword);
    const newEncBlob = await encryptPkcs8(pkcs8, newPassword);
    _privateKey      = await crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, false, ['deriveKey']);
    return { encBlob: newEncBlob };
  },

  isUnlocked() {
    return { unlocked: _privateKey !== null };
  },

  async getPublicKeyB64() {
    if (!_publicKey) return { publicKeyB64: null };
    return { publicKeyB64: await exportPublicKey(_publicKey) };
  },

  async encryptMessage({ plaintext, theirPublicKeyB64 }) {
    if (!_privateKey) throw new Error('No private key loaded.');
    const sharedKey = await deriveSharedKey(theirPublicKeyB64);
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, sharedKey, enc.encode(plaintext)
    );
    return { ivB64: buf2b64(iv.buffer), cipherB64: buf2b64(encrypted) };
  },

  async decryptMessage({ payload, theirPublicKeyB64 }) {
    if (!_privateKey) throw new Error('No private key loaded.');
    const sharedKey = await deriveSharedKey(theirPublicKeyB64);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(b642buf(payload.ivB64)) },
      sharedKey,
      b642buf(payload.cipherB64)
    );
    return { plaintext: dec.decode(decrypted) };
  },

};

// ── Message dispatch ──────────────────────────────────────────

function makeHandler(port) {
  return async function ({ data }) {
    const { id, cmd, args } = data;
    try {
      const handler = CMD[cmd];
      if (!handler) throw new Error(`Unknown command: ${cmd}`);
      const result = await handler(args || {});
      port.postMessage({ id, ok: true, result });
    } catch (err) {
      port.postMessage({ id, ok: false, error: err.message });
    }
  };
}

// SharedWorker entry point
if (typeof SharedWorkerGlobalScope !== 'undefined') {
  self.onconnect = function (e) {
    const port = e.ports[0];
    port.onmessage = makeHandler(port);
    port.start();
  };
} else {
  // Regular Worker fallback (Safari, iOS) — keys survive the current page only
  self.onmessage = makeHandler({ postMessage: (msg) => self.postMessage(msg) });
}
