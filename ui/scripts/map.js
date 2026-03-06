// ============================================================
// bOOmbOOm.NOW! — map.js
// Only runs when #map exists (index.html)
// ============================================================

(function () {
  if (!document.getElementById('map')) return;

  let map        = null;
  let selfMarker = null;
  let markers    = {};
  let myPos      = null;
  let sessionId  = null;
  let pollTimer  = null;

  const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO';
  const POLL_MS   = 5000;
  const DEFAULT_ZOOM = 17;

  // ── Emoji + CSS class by sex ─────────────────────────────
  function markerEmoji(sex) {
    if (sex === 'f') return '👌';
    if (sex === 'm') return '👆';
    return '👊';
  }
  function markerClass(sex) {
    if (sex === 'f') return 'female';
    if (sex === 'm') return 'male';
    return 'guest';
  }

  // ── Build Leaflet divIcon as HTML string ─────────────────
  function makeLeafIcon(sex, isSelf) {
    const cls   = 'bbm-marker' + (isSelf ? ' self' : '') + ' ' + markerClass(sex);
    const emoji = markerEmoji(sex);
    const title = isSelf ? 'You' : '';
    const size  = isSelf ? 46 : 38;
    const anchor = isSelf ? 23 : 19;
    return L.divIcon({
      html:      `<div class="${cls}" title="${title}">${emoji}</div>`,
      className: '',
      iconSize:   [size, size],
      iconAnchor: [anchor, anchor],
    });
  }

  // ── Init map ─────────────────────────────────────────────
  function initMap(lat, lng) {
    if (map) return;
    map = L.map('map', { center: [lat, lng], zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    placeSelfMarker(lat, lng);
    setStatus('live', 'live');
    startPolling();
  }

  // ── Self marker — always re-reads sex from Auth ──────────
  function placeSelfMarker(lat, lng) {
    // Read sex fresh every call — it changes after login
    const profile = window.Auth?.getProfile?.() || {};
    const sex = profile.sex || null;

    if (selfMarker) {
      selfMarker.setLatLng([lat, lng]);
      selfMarker.setIcon(makeLeafIcon(sex, true));
    } else {
      selfMarker = L.marker([lat, lng], {
        icon: makeLeafIcon(sex, true),
        zIndexOffset: 1000,
      }).addTo(map);
    }
  }

  // ── Other user markers ───────────────────────────────────
  function renderMarkers(users) {
    const seen = new Set();
    users.forEach(u => {
      seen.add(u.userId);
      if (markers[u.userId]) {
        markers[u.userId].setLatLng([u.lat, u.lon ?? u.lng]);
        return;
      }
      const m = L.marker([u.lat, u.lon ?? u.lng], {
        icon: makeLeafIcon(u.sex, false),
      }).addTo(map);
      m.on('click', () => window.openPinModal?.(u));
      markers[u.userId] = m;
    });
    Object.keys(markers).forEach(uid => {
      if (!seen.has(uid)) { map.removeLayer(markers[uid]); delete markers[uid]; }
    });
  }

  // ── Geolocation — 3-tier strategy ────────────────────────
  function startWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('location unavailable', 'off');
      tryIpFallback();
      return;
    }
    setStatus('locating…', 'locating');

    // Step 1 — low accuracy, fast, works on desktop via Wi-Fi/IP
    navigator.geolocation.getCurrentPosition(
      pos => {
        onPosition(pos);
        // Step 1 succeeded — now start a high-accuracy watch to refine (mobile GPS)
        navigator.geolocation.watchPosition(
          pos => onPosition(pos),
          _err => { /* GPS unavailable — already have a fix, ignore silently */ },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
      },
      _err => {
        // Step 1 failed — try high accuracy once, then IP fallback
        navigator.geolocation.getCurrentPosition(
          pos => onPosition(pos),
          _err2 => tryIpFallback(),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );
  }

  function onPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    myPos = { lat, lng };

    if (!map) {
      initMap(lat, lng);
    } else {
      placeSelfMarker(lat, lng);
    }
    pushLocation(lat, lng);
  }

  // Tier 3: IP geolocation fallback
  async function tryIpFallback() {
    try {
      setStatus('locating via IP…', 'locating');
      const r    = await fetch('https://ipapi.co/json/');
      const data = await r.json();
      if (data.latitude && data.longitude) {
        onPosition({ coords: { latitude: data.latitude, longitude: data.longitude } });
        setStatus('IP location (approximate)', 'live');
      }
    } catch {
      setStatus('location unavailable', 'off');
      if (!map) initMap(51.505, -0.09); // London fallback — at least show a map
    }
  }

  // ── Push location to backend ─────────────────────────────
  async function pushLocation(lat, lng) {
    try {
      // Pass guestId for session tracking if guest
      const body = { lat, lon: lng };
      if (!window.Auth?.isRegistered()) {
        const gid = window.Auth?.getGuestId?.();
        if (gid) body.guestId = gid;
      }
      const data = await window.Api.putLocation(lat, lng);
      if (data?.sessionId && !sessionId) {
        sessionId = data.sessionId;
      }
      // Start countdown only once, using JWT expiry time
      if (!window._guestCountdownStarted && !window.Auth?.isRegistered()) {
        const ttl = window.Auth?.getGuestTtlRemaining?.();
        if (ttl && ttl > 0) {
          window._guestCountdownStarted = true;
          window.startGuestCountdown?.(ttl);
        }
      }
    } catch { /* silent */ }
  }

  // ── Poll nearby users — passes current coords ─────────────
  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  async function poll() {
    if (!myPos) return;
    try {
      // CRITICAL: pass lat/lon so the gateway can forward them
      const { users = [] } = await window.Api.getNearby(myPos.lat, myPos.lng);
      renderMarkers(users);
    } catch (e) {
      console.warn('[Map] poll error:', e.message);
    }
  }

  // ── Refresh markers after login ───────────────────────────
  function refreshMarkers() {
    if (selfMarker && myPos) placeSelfMarker(myPos.lat, myPos.lng);
    poll();
  }

  // ── Centre on self ────────────────────────────────────────
  function centreOnSelf() {
    if (map && myPos) map.setView([myPos.lat, myPos.lng], DEFAULT_ZOOM, { animate: true });
  }

  // ── Guest session expired ─────────────────────────────────
  function onGuestExpired() {
    setStatus('session expired', 'off');
    Object.values(markers).forEach(m => map?.removeLayer(m));
    markers = {};
    if (selfMarker) { map?.removeLayer(selfMarker); selfMarker = null; }
  }

  // ── Status helper ─────────────────────────────────────────
  function setStatus(text, state) {
    const dot  = document.getElementById('statusDot');
    const span = document.getElementById('statusText');
    if (dot)  dot.className    = 'bbm-status-dot' + (state ? ' ' + state : '');
    if (span) span.textContent = text;
  }

  window.MapModule = { centreOnSelf, refreshMarkers, onGuestExpired };
  startWatch();

})();