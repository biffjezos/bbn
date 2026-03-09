// ============================================================
// bOOmbOOm.NOW! — API Client
// All communication with the middleware lives here.
// BASE_URL is injected at build time by CI (see _config.yml / env).
// ============================================================

const API_BASE = window.BOOMBOOM_API_URL || 'https://bbn-e86d0c.gitlab.io/api';

async function apiFetch(path, options = {}) {
  const token = window.Auth?.getToken?.();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = `${API_BASE}${path}`;
  console.log('[API] Fetching:', options.method || 'GET', url);

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (networkErr) {
    console.error('[API] Network error:', networkErr.message, 'URL:', url);
    throw networkErr;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 403 && data.required) {
      document.dispatchEvent(new CustomEvent('bbm:tier-gate', { detail: data }));
    }
    throw err;
  }

  return data;
}

// ---- Auth --------------------------------------------------

const Api = {

  /** Request a guest token for a given UUID */
  guestAuth(guestId) {
    return apiFetch('/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ guestId }),
    });
  },

  register({ email, nickname, password, age, sex }) {
    return apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, nickname, password, age: Number(age), sex }),
    });
  },

  login({ email, password }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // ---- User profile ---------------------------------------

  getMe() {
    return apiFetch('/users/me');
  },

  updateMe(fields) {
    return apiFetch('/users/me', {
      method: 'PUT',
      body: JSON.stringify(fields),
    });
  },

  deleteMe() {
    return apiFetch('/users/me', { method: 'DELETE' });
  },

  getProfile(userId) {
    return apiFetch(`/users/${encodeURIComponent(userId)}/profile`);
  },

  // ---- Crypto keys ----------------------------------------

  saveKeys(publicKey, encryptedPrivateKey) {
    return apiFetch('/users/me/keys', {
      method: 'PUT',
      body: JSON.stringify({ publicKey, encryptedPrivateKey }),
    });
  },

  getMyKeys() {
    return apiFetch('/users/me/keys');
  },

  // ---- Location -------------------------------------------

  putLocation(lat, lon, accuracy) {
    return apiFetch('/location', {
      method: 'PUT',
      body: JSON.stringify({ lat, lon, accuracy: accuracy || 'gps' }),
    });
  },

  deleteLocation() {
    return apiFetch('/location', { method: 'DELETE' });
  },

  getNearby(lat, lon) {
    return apiFetch(`/location/nearby?lat=${lat}&lon=${lon}`);
  },

  // ---- Messages -------------------------------------------

  getConversations() {
    return apiFetch('/messages');
  },

  getConversation(userId) {
    return apiFetch(`/messages/${encodeURIComponent(userId)}`);
  },

  sendMessage(userId, text) {
    return apiFetch(`/messages/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  deleteMessage(id) {
    return apiFetch(`/messages/${id}`, { method: 'DELETE' });
  },

  // ---- Favourites -----------------------------------------

  getFavourites() {
    return apiFetch('/favourites');
  },

  addFavourite(userId) {
    return apiFetch(`/favourites/${encodeURIComponent(userId)}`, { method: 'POST' });
  },

  removeFavourite(userId) {
    return apiFetch(`/favourites/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },

};

// Expose globally (no bundler)
window.Api = Api;

// Global tier-gate handler — shows modal whenever any apiFetch call returns
// 403 with a { required } field (tier enforcement). No per-page code needed.
document.addEventListener('bbm:tier-gate', function () {
  var el = document.getElementById('tierGateModal');
  if (el && window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).show();
});
