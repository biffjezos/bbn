// ./lib/geo.js 
// ============================================================
// GeoModule — ES6 module version
// Handles geolocation, location push, and status updates.
// Exports: GeoState, initGeo, pushLocation
// ============================================================

export const GeoState = { pos: null, accuracy: null, lastSent: null };

let _locWs = null;
let _locWsRetry = 10000;
let _locWsTimer = null;

function locWsUrl() {
  const api = window.BOOMBOOM_API_URL;
  const base = api.replace(/^https?:\/\//, 'wss://').replace(/\/api\/?$/, '');
  return base + '/ws/location';
}

function sendLocWS(lat, lon, accuracy) {
  if (_locWs?.readyState === WebSocket.OPEN) {
    _locWs.send(JSON.stringify({ type: 'position', lat, lon, accuracy: accuracy || 'gps' }));
    return true;
  }
  return false;
}

export function connectLocWS() {
  const token = window.Auth?.getToken?.();
  if (!token) return;
  if (_locWs && (_locWs.readyState === WebSocket.OPEN || _locWs.readyState === WebSocket.CONNECTING)) return;

  _locWs = new WebSocket(locWsUrl());

  _locWs.onopen = () => {
    _locWsRetry = 1000;
    console.log('[Geo] WS connected');
    _locWs.send(JSON.stringify({ type: 'auth', token: window.Auth?.getToken?.() || '' }));
    const pos = GeoState.pos;
    if (pos) sendLocWS(pos.lat, pos.lng, GeoState.accuracy);
  };

  _locWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'nearby') {
        console.log('[Geo] WS ← nearby:', (msg.users || []).length, 'users');
        window.dispatchEvent(new CustomEvent('geo:nearby', { detail: { users: msg.users || [] } }));
      }
    } catch {}
  };

  _locWs.onclose = () => {
    _locWs = null;
    if (!window.Auth?.getToken?.()) return;
    if (_locWsTimer) clearTimeout(_locWsTimer);
    _locWsTimer = setTimeout(connectLocWS, _locWsRetry);
    _locWsRetry = Math.min(_locWsRetry * 2, 30000);
    console.log('[Geo] WS closed, retrying in', _locWsRetry + 'ms');
  };
}

export function closeLocWS() {
  if (_locWsTimer) { clearTimeout(_locWsTimer); _locWsTimer = null; }
  if (_locWs) { _locWs.onclose = null; _locWs.close(); _locWs = null; }
}

export async function pushLocation(lat, lng, accuracy) {
  if (!window.Auth?.getToken()) return;
  if (isVenueAccount()) return;
  if (sendLocWS(lat, lng, accuracy)) {
    console.log('[Geo] WS → position sent:', lat, lng, accuracy);
    return;
  }
  console.log('[Geo] WS not open, falling back to HTTP PUT:', lat, lng, accuracy);
  try {
    await window.Api.putLocation(lat, lng, accuracy || 'gps');
  } catch (e) {
    console.warn('[Geo] HTTP location push failed:', e.message);
  }
}

function setStatus(text, state) {
  const dot = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  if (dot) dot.className = 'bbm-status-dot' + (state ? ' ' + state : '');
  if (span) span.textContent = text;
}

function dispatchPosition(lat, lng) {
  GeoState.pos = { lat, lng };
  window.dispatchEvent(new CustomEvent('geo:position', { detail: { lat, lng } }));
}

function approxDistM(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * 111000;
  const dLng = (lng2 - lng1) * 111000 * Math.cos(lat1 * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function onPosition(pos, accurate) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  GeoState.accuracy = 'gps';
  dispatchPosition(lat, lng);
  setStatus(accurate ? 'live' : 'approximate location', 'live');

  const last = GeoState.lastSent;
  if (!last || approxDistM(last.lat, last.lng, lat, lng) >= 5) {
    GeoState.lastSent = { lat, lng };
    pushLocation(lat, lng, GeoState.accuracy);
  }
}

async function tryIpFallback() {
  setStatus('locating…', 'locating');
  const services = [
    { url: 'https://ipwho.org/', lat: 'latitude', lon: 'longitude' },
    { url: 'https://iplocate.io/api/lookup/', lat: 'latitude', lon: 'longitude' },
    { url: 'https://api.ipapi.is/', lat: 'latitude', lon: 'longitude' },
  ];

  for (let i = services.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [services[i], services[j]] = [services[j], services[i]];
  }

  for (const s of services) {
    try {
      const r = await fetch(s.url);
      const data = await r.json();
      const lat = data[s.lat];
      const lon = data[s.lon];
      if (lat && lon) {
        GeoState.accuracy = 'ip';
        dispatchPosition(lat, lon);
        setStatus('approximate location', 'live');
        pushLocation(lat, lon, 'ip');
        return;
      }
    } catch (e) {
      console.warn('[Geo] IP fallback failed for', s.url, e.message);
    }
  }
  console.warn('[Geo] All IP fallbacks failed');
  setStatus('location unavailable', 'off');
}

function startWatch() {
  if (!navigator.geolocation) {
    console.warn('[Geo] Geolocation not available');
    tryIpFallback();
    return;
  }

  setStatus('locating…', 'locating');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const acc = pos.coords.accuracy;
      console.log('[Geo] Low-accuracy fix:', Math.round(acc) + 'm');
      onPosition(pos, acc < 5000);

      navigator.geolocation.watchPosition(
        (p) => onPosition(p, true),
        (err) => console.warn('[Geo] watchPosition error:', err.code, err.message),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
      );
    },
    (err) => {
      console.warn('[Geo] Low-accuracy failed:', err.code, err.message);
      navigator.geolocation.getCurrentPosition(
        (pos) => onPosition(pos, true),
        () => tryIpFallback(),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
  );
}

function isVenueAccount() {
  try {
    const t = window.Auth?.getToken?.();
    if (!t) return false;
    return JSON.parse(atob(t.split('.')[1])).account_type === 'venue';
  } catch { return false; }
}

export function initGeo() {
  if (window.__authReady instanceof Promise) {
    window.__authReady.then(async () => {
      if (isVenueAccount()) {
        try {
          const me = await window.Api.getMe();
          const { fixedLat: lat, fixedLon: lng } = me;
          if (typeof lat === 'number' && typeof lng === 'number') {
            GeoState.accuracy = 'fixed';
            dispatchPosition(lat, lng);
            setStatus('fixed location', 'live');
          }
          connectLocWS();
        } catch {
          setStatus('location unavailable', 'off');
        }
      } else {
        connectLocWS();
        startWatch();
      }
    });
  } else {
    console.warn('[Geo] __authReady is not a promise');
  }
}