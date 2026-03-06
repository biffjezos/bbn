// ============================================================
// bOOmbOOm.NOW! — map.js
// Only runs when #map exists (index.html)
// ============================================================

(function () {
  if (!document.getElementById('map')) return;

  let map        = null;
  let selfMarker = null;
  let markers    = {};      // userId → L.marker
  let watchId    = null;
  let myPos      = null;
  let sessionId  = null;

  const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR  = '&copy; OpenStreetMap contributors &copy; CARTO';
  const POLL_MS    = 5000;

  // ── Init map ────────────────────────────────────────────
  function initMap(lat, lng) {
    if (map) return;

    map = L.map('map', {
      center: [lat, lng],
      zoom: 17,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);

    placeSelfMarker(lat, lng);
    setStatus('live', 'live');
    startPolling();
  }

  // ── Self marker ─────────────────────────────────────────
  function placeSelfMarker(lat, lng) {
    const profile   = window.Auth?.getProfile() || {};
    const sex       = profile.sex || null;
    const cls       = 'bbm-marker self ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
    const icon      = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '📍';

    const el = document.createElement('div');
    el.className = cls;
    el.textContent = icon;
    el.title = 'You';

    const leafIcon = L.divIcon({ html: el, className: '', iconSize: [46, 46], iconAnchor: [23, 23] });

    if (selfMarker) {
      selfMarker.setLatLng([lat, lng]);
    } else {
      selfMarker = L.marker([lat, lng], { icon: leafIcon, zIndexOffset: 1000 }).addTo(map);
    }
  }

  // ── Other user markers ───────────────────────────────────
  function renderMarkers(users) {
    const seen = new Set();

    users.forEach(u => {
      seen.add(u.userId);

      const cls   = 'bbm-marker ' + (u.sex === 'f' ? 'female' : u.sex === 'm' ? 'male' : 'guest');
      const emoji = u.sex === 'f' ? '👌' : u.sex === 'm' ? '👆' : '👤';

      if (markers[u.userId]) {
        markers[u.userId].setLatLng([u.lat, u.lng]);
        return;
      }

      const el = document.createElement('div');
      el.className = cls;
      el.textContent = emoji;
      el.title = u.nickname || 'User';

      const leafIcon = L.divIcon({ html: el, className: '', iconSize: [38, 38], iconAnchor: [19, 19] });
      const m = L.marker([u.lat, u.lng], { icon: leafIcon }).addTo(map);

      m.on('click', () => window.openPinModal?.(u));
      markers[u.userId] = m;
    });

    // Remove stale markers
    Object.keys(markers).forEach(uid => {
      if (!seen.has(uid)) {
        map.removeLayer(markers[uid]);
        delete markers[uid];
      }
    });
  }

  // ── Geolocation ─────────────────────────────────────────
  function startWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('location unavailable', 'off');
      return;
    }

    setStatus('locating…', 'locating');

    watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        myPos = { lat, lng };

        if (!map) {
          initMap(lat, lng);
        } else {
          placeSelfMarker(lat, lng);
        }

        pushLocation(lat, lng);
      },
      err => {
        console.warn('[Map] Geo error', err.message);
        setStatus('location blocked', 'off');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
  }

  // ── POST location to backend ─────────────────────────────
  async function pushLocation(lat, lng) {
    try {
      const data = await window.Api.updateLocation(lat, lng);
      if (data.sessionId && !sessionId) {
        sessionId = data.sessionId;
        const secs = data.guestTtlSeconds;
        if (secs && !window.Auth?.isRegistered()) {
          window.startGuestCountdown?.(secs);
        }
      }
    } catch { /* silent */ }
  }

  // ── Poll nearby users ────────────────────────────────────
  let pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  async function poll() {
    if (!myPos) return;
    try {
      const { users = [] } = await window.Api.getNearby();
      renderMarkers(users);
    } catch { /* silent */ }
  }

  // ── Refresh markers (called on login) ───────────────────
  function refreshMarkers() {
    // Re-draw self marker with new profile sex
    if (selfMarker && myPos) placeSelfMarker(myPos.lat, myPos.lng);
    poll();
  }

  // ── Centre on self ───────────────────────────────────────
  function centreOnSelf() {
    if (map && myPos) {
      map.setView([myPos.lat, myPos.lng], 17, { animate: true });
    }
  }

  // ── Guest expired ────────────────────────────────────────
  function onGuestExpired() {
    setStatus('session expired', 'off');
    if (map) {
      markers && Object.values(markers).forEach(m => map.removeLayer(m));
      markers = {};
    }
  }

  // ── Status helper (delegates to app.js) ─────────────────
  function setStatus(text, state) {
    const dot  = document.getElementById('statusDot');
    const span = document.getElementById('statusText');
    if (dot)  { dot.className  = 'bbm-status-dot' + (state ? ' ' + state : ''); }
    if (span) { span.textContent = text; }
  }

  // ── Expose API ───────────────────────────────────────────
  window.MapModule = { centreOnSelf, refreshMarkers, onGuestExpired };

  // ── Start ────────────────────────────────────────────────
  startWatch();

})();
