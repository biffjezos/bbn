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
  // Guest/unknown → yellow fist 👊
  // Male          → light-blue pointing finger 👆
  // Female        → pink ok hand 👌
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

  // ── Build Leaflet divIcon HTML string ────────────────────
  function buildIconHtml(sex, isSelf) {
    const cls   = 'bbm-marker' + (isSelf ? ' self' : '') + ' ' + markerClass(sex);
    const emoji = markerEmoji(sex);
    const title = isSelf ? 'You' : '';
    return `<div class="${cls}" title="${title}" style="display:flex;align-items:center;justify-content:center;">${emoji}</div>`;
  }

  function makeLeafIcon(sex, isSelf) {
    const size   = isSelf ? 46 : 38;
    const anchor = isSelf ? 23 : 19;
    return L.divIcon({
      html:       buildIconHtml(sex, isSelf),
      className:  '',
      iconSize:   [size, size],
      iconAnchor: [anchor, anchor],
    });
  }

  // ── Init map ─────────────────────────────────────────────
  function initMap(lat, lng) {
    if (map) return;

    map = L.map('map', {
      center:      [lat, lng],
      zoom:        DEFAULT_ZOOM,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);

    placeSelfMarker(lat, lng);
    setStatus('live', 'live');
    startPolling();
  }

  // ── Self marker ──────────────────────────────────────────
  function placeSelfMarker(lat, lng) {
    const sex = window.Auth?.getProfile?.()?.sex || null;

    if (selfMarker) {
      // Update both position AND icon (sex may have changed after login)
      selfMarker.setLatLng([lat, lng]);
      selfMarker.setIcon(makeLeafIcon(sex, true));
    } else {
      selfMarker = L.marker([lat, lng], {
        icon:          makeLeafIcon(sex, true),
        zIndexOffset:  1000,
      }).addTo(map);
    }
  }

  // ── Other user markers ───────────────────────────────────
  function renderMarkers(users) {
    const seen = new Set();

    users.forEach(u => {
      seen.add(u.userId);

      if (markers[u.userId]) {
        markers[u.userId].setLatLng([u.lat, u.lng]);
        return;
      }

      const m = L.marker([u.lat, u.lng], {
        icon: makeLeafIcon(u.sex, false),
      }).addTo(map);

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

  // ── Geolocation ──────────────────────────────────────────
  // Strategy:
  //   1. Try getCurrentPosition (low accuracy) immediately — fast, works on
  //      laptops without GPS using Wi-Fi/IP. Initialises the map right away.
  //   2. Then start watchPosition (high accuracy) for GPS devices / mobile.
  //      Updates position as it refines.
  //   3. If both fail, fall back to IP-based location via ipapi.co.

  function startWatch() {
    if (!('geolocation' in navigator)) {
      setStatus('location unavailable', 'off');
      tryIpFallback();
      return;
    }

    setStatus('locating…', 'locating');

    // Step 1 — quick coarse fix (works on laptop via Wi-Fi)
    navigator.geolocation.getCurrentPosition(
      pos => onPosition(pos),
      ()  => { /* ignore — watchPosition or IP fallback will handle */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );

    // Step 2 — continuous watch (high accuracy for GPS devices)
    navigator.geolocation.watchPosition(
      pos  => onPosition(pos),
      err  => {
        console.warn('[Map] watchPosition error:', err.message);
        // Only show error if we still have no position at all
        if (!myPos) {
          setStatus('location blocked', 'off');
          tryIpFallback();
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
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
      map.setView([lat, lng], DEFAULT_ZOOM);
    }

    pushLocation(lat, lng);
  }

  // Step 3 — IP geolocation fallback (no GPS, no Wi-Fi location)
  async function tryIpFallback() {
    try {
      setStatus('locating via IP…', 'locating');
      const r    = await fetch('https://ipapi.co/json/');
      const data = await r.json();
      if (data.latitude && data.longitude) {
        const fakPos = { coords: { latitude: data.latitude, longitude: data.longitude } };
        onPosition(fakPos);
        setStatus('IP location (approximate)', 'live');
      }
    } catch {
      setStatus('location unavailable', 'off');
      // Still init map at a world-view so the page isn't blank
      if (!map) initMap(51.505, -0.09); // London fallback
    }
  }

  // ── Push location to backend ─────────────────────────────
  async function pushLocation(lat, lng) {
    try {
      const data = await window.Api.putLocation(lat, lng);
      if (data?.sessionId && !sessionId) {
        sessionId = data.sessionId;
        const secs = data.guestTtlSeconds;
        if (secs && !window.Auth?.isRegistered()) {
          window.startGuestCountdown?.(secs);
        }
      }
    } catch { /* silent */ }
  }

  // ── Poll nearby users ────────────────────────────────────
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

  // ── Refresh markers after login (sex may have changed) ───
  function refreshMarkers() {
    if (selfMarker && myPos) placeSelfMarker(myPos.lat, myPos.lng);
    poll();
  }

  // ── Centre on self ───────────────────────────────────────
  function centreOnSelf() {
    if (map && myPos) {
      map.setView([myPos.lat, myPos.lng], DEFAULT_ZOOM, { animate: true });
    }
  }

  // ── Guest session expired ────────────────────────────────
  function onGuestExpired() {
    setStatus('session expired', 'off');
    Object.values(markers).forEach(m => map?.removeLayer(m));
    markers = {};
  }

  // ── Status helper ────────────────────────────────────────
  function setStatus(text, state) {
    const dot  = document.getElementById('statusDot');
    const span = document.getElementById('statusText');
    if (dot)  dot.className   = 'bbm-status-dot' + (state ? ' ' + state : '');
    if (span) span.textContent = text;
  }

  // ── Expose ───────────────────────────────────────────────
  window.MapModule = { centreOnSelf, refreshMarkers, onGuestExpired };

  // ── Start ────────────────────────────────────────────────
  startWatch();

})();
