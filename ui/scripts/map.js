// ============================================================
// bOOmbOOm.NOW! — Map Module
// Leaflet map, custom emoji markers, geolocation, nearby poll.
// ============================================================

const MapModule = (() => {

  // --- Config (mirrors server CONFIG for client-side logic) --
  const CFG = {
    TILE_URL:      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    TILE_ATTR:     '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    DEFAULT_ZOOM:  16,   // ~1 km radius view
    NEARBY_POLL_MS: 8000, // how often to refresh other users' pins
    LOC_INTERVAL_MS: 15000,
    LOC_DIST_M:     100,
    UPDATE_INTERVAL_MS: 15000,
  };

  // Emoji icons per sex/role
  // 👆 = pointing up (registered user)  👌 = ok hand (self marker)
  // ✊ = fist (unregistered)
  const ICONS = {
    self_m:    { emoji: '👌', cls: 'self male'   },
    self_f:    { emoji: '👌', cls: 'self female' },
    self_o:    { emoji: '👌', cls: 'self other'  },
    user_m:    { emoji: '👆', cls: 'male'        },
    user_f:    { emoji: '👆', cls: 'female'      },
    user_o:    { emoji: '👆', cls: 'other'       },
    guest:     { emoji: '✊', cls: 'guest'       },
  };

  let _map         = null;
  let _selfMarker  = null;
  let _userMarkers = {};   // userId → L.Marker
  let _selfLat     = null;
  let _selfLon     = null;
  let _prevLat     = null;
  let _prevLon     = null;
  let _prevUpdateTime = 0;
  let _watchId     = null;
  let _pollTimer   = null;
  let _geoAvailable = 'geolocation' in navigator;

  // ---- Marker factory --------------------------------------

  function makeIcon(type) {
    const def = ICONS[type] || ICONS.guest;
    return L.divIcon({
      html: `<div class="bbm-marker ${def.cls}">${def.emoji}</div>`,
      className: '',
      iconSize:   [36, 36],
      iconAnchor: [18, 32],
      popupAnchor:[0, -34],
    });
  }

  function iconTypeFor(isRegistered, sex) {
    if (!isRegistered) return 'guest';
    const s = sex === 'm' ? 'm' : sex === 'f' ? 'f' : 'o';
    return `user_${s}`;
  }

  function selfIconType() {
    const sex = window.Auth?.getSex?.() || 'o';
    const s = sex === 'm' ? 'm' : sex === 'f' ? 'f' : 'o';
    return `self_${s}`;
  }

  // ---- Status bar ------------------------------------------

  function setStatus(state, text) {
    const dot  = document.getElementById('statusDot');
    const span = document.getElementById('statusText');
    if (dot) {
      dot.className = `bi bi-circle-fill ${state}`;
    }
    if (span) span.textContent = text;
  }

  // ---- Map init --------------------------------------------

  function initMap(lat, lon) {
    if (_map) return;
    _map = L.map('map', {
      center: [lat, lon],
      zoom: CFG.DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(CFG.TILE_URL, {
      attribution: CFG.TILE_ATTR,
      maxZoom: 19,
    }).addTo(_map);
  }

  // Load map immediately with a random world location.
  // onPosition() will pan to the real location once found.
  function initMapNow() {
    const lat = (Math.random() * 140) - 70;
    const lon = (Math.random() * 360) - 180;
    initMap(lat, lon);
  }

  // ---- Self marker -----------------------------------------

  function placeSelfMarker(lat, lon) {
    const icon = makeIcon(selfIconType());
    if (_selfMarker) {
      _selfMarker.setLatLng([lat, lon]).setIcon(icon);
    } else {
      _selfMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 })
        .addTo(_map);
    }
  }

  // ---- Nearby users ----------------------------------------

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toR = d => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  async function refreshNearby() {
    if (_selfLat === null) return;
    try {
      const data = await window.Api.getNearby(_selfLat, _selfLon);
      const incoming = data.users || [];
      const seen = new Set();

      for (const u of incoming) {
        seen.add(u.userId);
        const iconType = iconTypeFor(u.isRegistered, u.sex);
        const icon     = makeIcon(iconType);

        if (_userMarkers[u.userId]) {
          _userMarkers[u.userId].setLatLng([u.lat, u.lon]).setIcon(icon);
        } else {
          const marker = L.marker([u.lat, u.lon], { icon })
            .addTo(_map)
            .on('click', () => MapModule.onUserClick(u));
          _userMarkers[u.userId] = marker;
        }
      }

      // Remove markers for users that have left
      for (const [uid, marker] of Object.entries(_userMarkers)) {
        if (!seen.has(uid)) {
          marker.remove();
          delete _userMarkers[uid];
        }
      }
    } catch (err) {
      console.warn('[Map] refreshNearby error', err);
    }
  }

  // ---- Location push ---------------------------------------

  function shouldPush(lat, lon) {
    if (_prevLat === null) return true;
    const timePassed = Date.now() - _prevUpdateTime >= CFG.LOC_INTERVAL_MS;
    const moved = haversineM(_prevLat, _prevLon, lat, lon) >= CFG.LOC_DIST_M;
    return timePassed || moved;
  }

  async function pushLocation(lat, lon) {
    if (!shouldPush(lat, lon)) return;
    try {
      await window.Api.putLocation(lat, lon);
      _prevLat = lat;
      _prevLon = lon;
      _prevUpdateTime = Date.now();
    } catch (err) {
      console.warn('[Map] pushLocation error', err);
    }
  }

  // ---- Geolocation handler ---------------------------------

  function onPosition(pos) {
    const { latitude: lat, longitude: lon } = pos.coords;
    _selfLat = lat;
    _selfLon = lon;

    // Pan to real location and zoom in
    _map.setView([lat, lon], CFG.DEFAULT_ZOOM);

    placeSelfMarker(lat, lon);
    setStatus('active', 'live');
    pushLocation(lat, lon);
  }

  function onGeoError(err) {
    console.warn('[Map] Geolocation error', err.code, err.message);
    setStatus('locating', 'searching…');
    // Map is already visible with random location from initMapNow()
  }

  // ---- Start / stop ----------------------------------------

  function startWatching() {
    if (!_geoAvailable) {
      onGeoError({ code: 0, message: 'Geolocation not supported.' });
      return;
    }

    const geoOpts = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    };

    // Prefer watchPosition; fall back to repeated getCurrentPosition
    if (navigator.geolocation.watchPosition) {
      _watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, geoOpts);
    } else {
      // Fallback polling
      navigator.geolocation.getCurrentPosition(onPosition, onGeoError, geoOpts);
      _watchId = setInterval(() => {
        navigator.geolocation.getCurrentPosition(onPosition, onGeoError, geoOpts);
      }, CFG.UPDATE_INTERVAL_MS);
    }
  }

  function startNearbyPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(refreshNearby, CFG.NEARBY_POLL_MS);
    refreshNearby(); // immediate first call
  }

  function stopNearbyPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
    // Remove all user markers
    for (const marker of Object.values(_userMarkers)) marker.remove();
    _userMarkers = {};
  }

  // ---- Public API ------------------------------------------

  return {

    init() {
      setStatus('locating', 'locating…');
      initMapNow();      // map visible immediately with random location
      startWatching();   // will pan to real location when found
      startNearbyPoll();
    },

    refreshSelfIcon() {
      if (_selfMarker) {
        _selfMarker.setIcon(makeIcon(selfIconType()));
      }
    },

    stopNearbyPoll,
    startNearbyPoll,

    getSelfPosition() {
      return { lat: _selfLat, lon: _selfLon };
    },

    // Hook for app.js to attach profile modal logic
    onUserClick: null, // assigned in app.js
  };

})();

window.MapModule = MapModule;
