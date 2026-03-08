// ============================================================
// bOOmbOOm.NOW! — map.js
// Map rendering only. Geolocation lives in app.js (GeoModule).
// Only runs when #map exists (index.html).
// Nearby users arrive via 'geo:nearby' CustomEvent pushed from
// the location WebSocket — no HTTP polling here.
// ============================================================

(function () {
  if (!document.getElementById('map')) return;

  let map        = null;
  let selfMarker = null;
  let markers    = {};

  const TILE_URL     = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR    = '&copy; OpenStreetMap contributors &copy; CARTO';
  const DEFAULT_ZOOM = 17;

  function markerEmoji(sex) { return sex==='f'?'👌':sex==='m'?'👆':'👊'; }
  function markerClass(sex) { return sex==='f'?'female':sex==='m'?'male':'guest'; }

  function makeLeafIcon(sex, isSelf) {
    const cls    = 'bbm-marker' + (isSelf ? ' self' : '') + ' ' + markerClass(sex);
    const size   = isSelf ? 46 : 38;
    const anchor = isSelf ? 23 : 19;
    return L.divIcon({
      html:       `<div class="${cls}" title="${isSelf?'You':''}">${markerEmoji(sex)}</div>`,
      className:  '',
      iconSize:   [size, size],
      iconAnchor: [anchor, anchor],
    });
  }

  function initMap(lat, lng) {
    if (map) return;
    console.log('[Map] Initialising at', lat, lng);
    map = L.map('map', { center: [lat, lng], zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    placeSelfMarker(lat, lng);
  }

  function placeSelfMarker(lat, lng) {
    const sex = window.Auth?.getSex?.() || null;
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

  function renderMarkers(users) {
    const seen = new Set();
    users.forEach(u => {
      const ulat = u.lat;
      const ulng = u.lon ?? u.lng;
      seen.add(u.userId);
      if (markers[u.userId]) {
        markers[u.userId].setLatLng([ulat, ulng]);
        return;
      }
      const m = L.marker([ulat, ulng], { icon: makeLeafIcon(u.sex, false) }).addTo(map);
      m.on('click', () => window.openPinModal?.(u));
      markers[u.userId] = m;
    });
    Object.keys(markers).forEach(uid => {
      if (!seen.has(uid)) { map.removeLayer(markers[uid]); delete markers[uid]; }
    });
  }

  function refreshMarkers() {
    const pos = window.GeoState?.pos;
    if (map && pos) placeSelfMarker(pos.lat, pos.lng);
  }

  function centreOnSelf() {
    const pos = window.GeoState?.pos;
    if (map && pos) map.setView([pos.lat, pos.lng], DEFAULT_ZOOM, { animate: true });
  }

  function onGuestExpired() {
    Object.values(markers).forEach(m => map?.removeLayer(m));
    markers = {};
    if (selfMarker) { map?.removeLayer(selfMarker); selfMarker = null; }
  }

  // Nearby users pushed from the location WS via GeoModule
  window.addEventListener('geo:nearby', function (e) {
    if (map) renderMarkers(e.detail.users || []);
  });

  // Self-marker updates from GeoModule
  window.addEventListener('geo:position', function (e) {
    const { lat, lng } = e.detail;
    if (!map) initMap(lat, lng);
    else placeSelfMarker(lat, lng);
  });

  window.MapModule = { centreOnSelf, refreshMarkers, onGuestExpired };

  // GeoState may already have a position if geo resolved before map.js ran
  window.__authReady.then(function () {
    const pos = window.GeoState?.pos;
    if (pos) initMap(pos.lat, pos.lng);
  });

})();
