// ./lib/prefs.js
// ============================================================
// bOOmbOOm.NOW! — prefs.js
// User preferences: server-backed, localStorage-cached.
// Source of truth: GET/PUT /users/me/preferences
// localStorage keys are a read-through cache so map.js can
// read preferences synchronously without an async API call.
// ============================================================

const PREF_MAP_ZOOM  = 'bbn_pref_map_zoom';
const PREF_FAV_PINS  = 'bbn_pref_show_fav_pins';

function cache(zoom, showPins) {
  localStorage.setItem(PREF_MAP_ZOOM, zoom);
  localStorage.setItem(PREF_FAV_PINS, showPins ? 'true' : 'false');
}

function mapZoom()    { 
  const v = localStorage.getItem(PREF_MAP_ZOOM);
  return v !== null ? parseInt(v, 10) : 17;
}

function showFavPins() { 
  return localStorage.getItem(PREF_FAV_PINS) !== 'false'; 
}

async function sync() {
  if (!window.Api || !window.Auth || !window.Auth.isRegistered()) return;
  try {
    const prefs = await window.Api.getPreferences();
    cache(prefs.mapZoom, prefs.showFavPins);
  } catch (_) {}
}

// Hook into Auth.onLogin (chain pattern used throughout app.js)
const _orig = window.Auth?.onLogin;
if (window.Auth) {
  window.Auth.onLogin = function (data) {
    if (_orig) _orig(data);
    sync();
  };
}

// Also sync if a valid token is already present on page load
if (window.__authReady) {
  window.__authReady.then(function () {
    sync();
  });
}

// Exposed API
export const BbmPrefs = {
  mapZoom,
  showFavPins,
  sync,
  cache,
  KEYS: { MAP_ZOOM: PREF_MAP_ZOOM, FAV_PINS: PREF_FAV_PINS },
};

// Optionally, attach BbmPrefs to window for backward compatibility
window.BbmPrefs = BbmPrefs;