// ============================================================
// bOOmbOOm.NOW! — crypto.js
// Thin proxy to crypto-worker.js.
// All crypto operations (including the PBKDF2 key derivation) run
// off the main thread. Private keys never leave the worker.
// Uses SharedWorker where available (Chrome, Firefox, Edge) so the
// key survives full-page navigations within the same origin.
// Falls back to a regular Worker on Safari/iOS — key is retained
// for the lifetime of the current page only.
// ============================================================

const BBNCrypto = (() => {

  const BASE      = window.BOOMBOOM_BASE || '';
  const workerUrl = `${BASE}/scripts/crypto-worker.js`;

  let _port;
  try {
    if (typeof SharedWorker !== 'undefined') {
      const sw = new SharedWorker(workerUrl);
      _port = sw.port;
      _port.start();
      console.log('[Crypto] SharedWorker started.');
    } else {
      _port = new Worker(workerUrl);
      console.log('[Crypto] Worker started (SharedWorker not available).');
    }
  } catch (e) {
    console.error('[Crypto] Failed to start worker:', e);
  }

  let _nextId   = 0;
  const _pending = new Map();

  // Shadow state — mirrors the worker's lock state so isUnlocked() stays synchronous.
  // Initialised to false; updated by ready(), unlock(), lock(), and setup().
  let _unlocked = false;

  if (_port) {
    _port.onmessage = function ({ data }) {
      const p = _pending.get(data.id);
      if (!p) return;
      _pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else         p.reject(new Error(data.error));
    };
  }

  function send(cmd, args) {
    if (!_port) return Promise.reject(new Error('Crypto worker unavailable.'));
    return new Promise((resolve, reject) => {
      const id = ++_nextId;
      _pending.set(id, { resolve, reject });
      _port.postMessage({ id, cmd, args: args || {} });
    });
  }

  // Query the worker's current lock state on startup.
  // With SharedWorker this may already be true if the user navigated from another page.
  const _ready = send('isUnlocked', {})
    .then(r => { _unlocked = r.unlocked; })
    .catch(() => {});

  return {

    // Await before first use to sync shadow state with the (possibly persistent) worker.
    ready() { return _ready; },

    // Synchronous — reliable after ready() has resolved.
    isUnlocked() { return _unlocked; },

    async setup(password) {
      const r = await send('setup', { password });
      _unlocked = true;
      return r;  // { publicKeyB64, encBlob }
    },

    async unlock(encBlob, password, publicKeyB64) {
      const r = await send('unlock', { encBlob, password, publicKeyB64 });
      _unlocked = r.ok;
      return r.ok;
    },

    lock() {
      _unlocked = false;
      send('lock', {});  // fire-and-forget
    },

    async reencrypt(oldPassword, newPassword, encBlob) {
      const r = await send('reencrypt', { oldPassword, newPassword, encBlob });
      return r.encBlob;
    },

    async getPublicKeyB64() {
      const r = await send('getPublicKeyB64', {});
      return r.publicKeyB64;
    },

    async encryptMessage(plaintext, theirPublicKeyB64) {
      return send('encryptMessage', { plaintext, theirPublicKeyB64 });
    },

    async decryptMessage(payload, theirPublicKeyB64) {
      const r = await send('decryptMessage', { payload, theirPublicKeyB64 });
      return r.plaintext;
    },

  };

})();

window.BBNCrypto = BBNCrypto;
