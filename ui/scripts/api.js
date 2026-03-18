// ============================================================
// bOOmbOOm.NOW! — API Client
// All communication with the middleware lives here.
// BASE_URL is injected at build time by CI (see _config.yml / env).
// ============================================================

// ── Debug flag ───────────────────────────────────────────────
// Set to true to log every request, response, key event, and
// WebSocket message to the browser console.
// Must be false in production.
var DEBUG = true;
// ─────────────────────────────────────────────────────────────

const API_BASE = window.BOOMBOOM_API_URL;

async function apiFetch(path, options = {}, _retries = 1) {
  const token = window.Auth?.getToken?.();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = `${API_BASE}${path}`;
  if (DEBUG) console.log('[API] →', options.method || 'GET', url, options.body ? JSON.parse(options.body) : '');

  let res;
  try {
    res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(10000) });
  } catch (networkErr) {
    if (DEBUG) console.error('[API] Network error:', networkErr.message, 'URL:', url);
    if (_retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return apiFetch(path, options, _retries - 1);
    }
    throw networkErr;
  }

  const data = await res.json().catch(() => ({}));
  if (DEBUG) console.log('[API] ←', res.status, url, data);

  // Retry once on 5xx — services may be waking from sleep
  if (res.status >= 500 && _retries > 0) {
    if (DEBUG) console.warn('[API] 5xx, retrying in 1.5 s…', res.status, url);
    await new Promise(r => setTimeout(r, 1500));
    return apiFetch(path, options, _retries - 1);
  }

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 403 && data.required) {
      document.dispatchEvent(new CustomEvent('bbm:tier-gate', { detail: data }));
    }
    // Token is revoked or expired server-side — clear local session so the
    // user is prompted to log in again instead of seeing a raw error.
    if (res.status === 401 && (data.code === 'TOKEN_REVOKED' || data.code === 'TOKEN_INVALID')) {
      window.Auth?.logout?.();
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

  login({ email, password, guestId }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, guestId }),
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

  getNearbyRadius(tier) {
    return apiFetch(`/tiers/radius/nearby/${encodeURIComponent(tier)}`);
  },

  getTierInfo(tier) {
    return apiFetch(`/tiers/${encodeURIComponent(tier)}/info`);
  },

  searchUsers({ nickname, ageMin, ageMax, sex, online } = {}) {
    const qs = new URLSearchParams();
    if (nickname != null && nickname !== '') qs.set('nickname', nickname);
    if (ageMin   != null) qs.set('ageMin', ageMin);
    if (ageMax   != null) qs.set('ageMax', ageMax);
    if (sex      != null) qs.set('sex', sex);
    if (online   != null) qs.set('online', online ? 'yes' : 'no');
    return apiFetch(`/users/search?${qs.toString()}`);
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

  isMutualFavourite(userId) {
    return apiFetch(`/favourites/is-mutual/${encodeURIComponent(userId)}`);
  },

  // ---- Blocks -------------------------------------------------

  blockUser(userId, reason) {
    return apiFetch(`/blocks/${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  unblockUser(userId) {
    return apiFetch(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },

  getBlocks() {
    return apiFetch('/blocks');
  },

  // ---- Manager ------------------------------------------------

  getMyVenues() {
    return apiFetch('/manager/venues');
  },

  createVenue(payload) {
    return apiFetch('/manager/venues', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateVenue(venueId, payload) {
    return apiFetch(`/manager/venues/${encodeURIComponent(venueId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteVenue(venueId) {
    return apiFetch(`/manager/venues/${encodeURIComponent(venueId)}`, { method: 'DELETE' });
  },

  // ---- Admin --------------------------------------------------

  adminSearchUsers({ q, by } = {}) {
    const qs = new URLSearchParams();
    if (q  != null && q  !== '') qs.set('q',  q);
    if (by != null && by !== '') qs.set('by', by);
    return apiFetch(`/admin/users?${qs.toString()}`);
  },

  adminSetTier(userId, tier) {
    return apiFetch(`/admin/users/${encodeURIComponent(userId)}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({ tier }),
    });
  },

  adminSetRole(userId, role) {
    return apiFetch(`/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  adminListTiers() {
    return apiFetch('/admin/tiers');
  },

  adminCreateTier(data) {
    return apiFetch('/admin/tiers', { method: 'POST', body: JSON.stringify(data) });
  },

  adminUpdateTier(name, data) {
    return apiFetch(`/admin/tiers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  adminDeleteTier(name) {
    return apiFetch(`/admin/tiers/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // ---- Notifications ------------------------------------------

  getNotifications() {
    return apiFetch('/notifications');
  },

  dismissNotification(id) {
    return apiFetch(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
