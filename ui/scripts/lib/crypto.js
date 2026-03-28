// ============================================================
// bOOmbOOm.NOW! — crypto.js (ES6 module)
// Thin proxy to crypto-worker.js.
// ============================================================

const BASE = window.BOOMBOOM_BASE || '';
const workerUrl = `${BASE}/scripts/crypto-worker.js`;

let port = null;

// ------------------ Worker Init ------------------
function initWorker() {
  try {
    if (typeof SharedWorker !== 'undefined') {
      const sw = new SharedWorker(workerUrl);
      port = sw.port;
      port.start();
      console.log('[Crypto] SharedWorker started.');
    } else {
      port = new Worker(workerUrl);
      console.log('[Crypto] Worker started (fallback).');
    }
  } catch (e) {
    console.error('[Crypto] Failed to start worker:', e);
    port = null;
  }
}

initWorker();

// ------------------ Internal State ------------------
let nextId = 0;
const pending = new Map();

// Shadow lock state (sync access)
let unlocked = false;

// ------------------ Message Handling ------------------
if (port) {
  port.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;

    pending.delete(data.id);

    if (data.ok) {
      p.resolve(data.result);
    } else {
      p.reject(new Error(data.error));
    }
  };
}

// ------------------ Core Send ------------------
function send(cmd, args = {}) {
  if (!port) {
    return Promise.reject(new Error('Crypto worker unavailable.'));
  }

  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    port.postMessage({ id, cmd, args });
  });
}

// ------------------ Ready State ------------------
const readyPromise = send('isUnlocked')
  .then(r => { unlocked = r.unlocked; })
  .catch(() => {});

// ------------------ Public API ------------------
const BBNCrypto = {

  async ready() {
    return readyPromise;
  },

  isUnlocked() {
    return unlocked;
  },

  async setup(password) {
    const r = await send('setup', { password });
    unlocked = true;
    return r; // { publicKeyB64, encBlob }
  },

  async unlock(encBlob, password, publicKeyB64) {
    const r = await send('unlock', { encBlob, password, publicKeyB64 });
    unlocked = r.ok;
    return r.ok;
  },

  lock() {
    unlocked = false;
    send('lock'); // fire-and-forget
  },

  async reencrypt(oldPassword, newPassword, encBlob) {
    const r = await send('reencrypt', { oldPassword, newPassword, encBlob });
    return r.encBlob;
  },

  async getPublicKeyB64() {
    const r = await send('getPublicKeyB64');
    return r.publicKeyB64;
  },

  async encryptMessage(plaintext, theirPublicKeyB64) {
    return send('encryptMessage', { plaintext, theirPublicKeyB64 });
  },

  async decryptMessage(payload, theirPublicKeyB64) {
    const r = await send('decryptMessage', { payload, theirPublicKeyB64 });
    return r.plaintext;
  }

};

// ------------------ Exports ------------------
export { BBNCrypto };
export default BBNCrypto;

// ------------------ Optional Global (compat) ------------------
if (typeof window !== 'undefined') {
  window.BBNCrypto = BBNCrypto;
}