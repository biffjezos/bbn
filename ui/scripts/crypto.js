// ============================================================
// bOOmbOOm.NOW! — crypto.js
// End-to-end encryption using Web Crypto API.
// ECDH key exchange + AES-GCM message encryption.
// Private key is encrypted with a key derived from the user's
// password (PBKDF2) and stored on the server as a blob.
// The private key never leaves the browser in plaintext.
// ============================================================

const BBMCrypto = (() => {

  const ECDH_PARAMS   = { name: 'ECDH', namedCurve: 'P-256' };
  const AES_PARAMS    = { name: 'AES-GCM', length: 256 };
  const PBKDF2_ITER   = 200000;
  const PBKDF2_HASH   = 'SHA-256';

  // In-memory only — never persisted to localStorage
  let _privateKey = null;
  let _publicKey  = null;

  // ── Helpers ───────────────────────────────────────────────

  function buf2b64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  function b642buf(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToStr(buf) {
    return new TextDecoder().decode(buf);
  }

  // ── PBKDF2 — derive AES key from password ─────────────────

  async function deriveKeyFromPassword(password, saltB64) {
    const salt       = b642buf(saltB64);
    const keyMaterial = await crypto.subtle.importKey(
      'raw', strToBytes(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: PBKDF2_HASH },
      keyMaterial,
      AES_PARAMS,
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── Keypair generation ────────────────────────────────────

  async function generateKeypair() {
    return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
  }

  async function exportPublicKey(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return buf2b64(raw);
  }

  async function exportPrivateKey(key) {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
    return pkcs8;
  }

  // ── Encrypt/decrypt private key with password ─────────────

  async function encryptPrivateKey(privateKey, password) {
    const salt    = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = buf2b64(salt.buffer);
    const aesKey  = await deriveKeyFromPassword(password, saltB64);
    const iv      = crypto.getRandomValues(new Uint8Array(12));
    const pkcs8   = await exportPrivateKey(privateKey);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      pkcs8
    );
    return {
      saltB64,
      ivB64:        buf2b64(iv.buffer),
      encryptedB64: buf2b64(encrypted),
    };
  }

  async function decryptPrivateKey(blob, password) {
    const aesKey    = await deriveKeyFromPassword(password, blob.saltB64);
    const iv        = b642buf(blob.ivB64);
    const encrypted = b642buf(blob.encryptedB64);
    const pkcs8     = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      aesKey,
      encrypted
    );
    return crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, true, ['deriveKey']);
  }

  // ── ECDH shared secret → AES key ─────────────────────────

  async function deriveSharedKey(myPrivateKey, theirPublicKeyB64) {
    const raw = b642buf(theirPublicKeyB64);
    const theirKey = await crypto.subtle.importKey(
      'raw', raw, ECDH_PARAMS, true, []
    );
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirKey },
      myPrivateKey,
      AES_PARAMS,
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ── Message encrypt/decrypt ───────────────────────────────

  async function encryptMessage(plaintext, theirPublicKeyB64) {
    if (!_privateKey) throw new Error('No private key loaded.');
    const sharedKey = await deriveSharedKey(_privateKey, theirPublicKeyB64);
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKey,
      strToBytes(plaintext)
    );
    return {
      ivB64:        buf2b64(iv.buffer),
      cipherB64:    buf2b64(encrypted),
    };
  }

  async function decryptMessage(payload, theirPublicKeyB64) {
    if (!_privateKey) throw new Error('No private key loaded.');
    const sharedKey  = await deriveSharedKey(_privateKey, theirPublicKeyB64);
    const iv         = b642buf(payload.ivB64);
    const cipher     = b642buf(payload.cipherB64);
    const decrypted  = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      sharedKey,
      cipher
    );
    return bytesToStr(decrypted);
  }

  // ── Public API ────────────────────────────────────────────

  return {

    // Called on register — generate keypair, encrypt private key, return blobs for server
    async setup(password) {
      const keypair      = await generateKeypair();
      _privateKey        = keypair.privateKey;
      _publicKey         = keypair.publicKey;
      const publicKeyB64 = await exportPublicKey(_publicKey);
      const encBlob      = await encryptPrivateKey(_privateKey, password);
      console.log('[Crypto] Keypair generated.');
      return { publicKeyB64, encBlob };
    },

    // Called on login — decrypt the stored blob to recover private key
    async unlock(encBlob, password, publicKeyB64) {
      try {
        _privateKey = await decryptPrivateKey(encBlob, password);
        const raw   = b642buf(publicKeyB64);
        _publicKey  = await crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
        console.log('[Crypto] Keys unlocked.');
        return true;
      } catch (e) {
        console.warn('[Crypto] Failed to unlock keys:', e.message);
        return false;
      }
    },

    // Called on logout — wipe keys from memory
    lock() {
      _privateKey = null;
      _publicKey  = null;
      console.log('[Crypto] Keys wiped.');
    },

    // Re-encrypt private key with new password (password change)
    async reencrypt(oldPassword, newPassword, encBlob) {
      const privateKey   = await decryptPrivateKey(encBlob, oldPassword);
      const newEncBlob   = await encryptPrivateKey(privateKey, newPassword);
      // Update in-memory key too
      _privateKey = privateKey;
      return newEncBlob;
    },

    isUnlocked() { return _privateKey !== null; },

    getPublicKeyB64() {
      if (!_publicKey) return null;
      return exportPublicKey(_publicKey);
    },

    // Export raw PKCS8 bytes as base64 — used by LockModule to persist
    // the key in sessionStorage across same-tab page navigations.
    async exportPrivateKeyPkcs8() {
      if (!_privateKey) return null;
      const pkcs8 = await exportPrivateKey(_privateKey);
      return buf2b64(pkcs8);
    },

    // Re-import key from sessionStorage bytes — no password needed.
    async importFromSession(skB64, pkB64) {
      try {
        const pkcs8 = b642buf(skB64);
        _privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, ECDH_PARAMS, true, ['deriveKey']);
        const raw   = b642buf(pkB64);
        _publicKey  = await crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
        return true;
      } catch (e) {
        console.warn('[Crypto] importFromSession failed:', e.message);
        _privateKey = null;
        _publicKey  = null;
        return false;
      }
    },

    encryptMessage,
    decryptMessage,
  };

})();

window.BBMCrypto = BBMCrypto;