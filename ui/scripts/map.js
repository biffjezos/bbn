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
  let pollTimer  = null;

  const TILE_URL     = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR    = '&copy; OpenStreetMap contributors &copy; CARTO';
  const POLL_MS      = 5000;
  const DEFAULT_ZOOM = 17;

  // ── Emoji + CSS class by sex ─────────────────────────────
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

  // ── Init map ─────────────────────────────────────────────
  function initMap(lat, lng, accurate) {
    if (map) return;
    console.log('[Map] Initialising map at', lat, lng, accurate ? '(accurate)' : '(approximate)');
    map = L.map('map', { center: [lat, lng], zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
    placeSelfMarker(lat, lng);
    setStatus(accurate ? 'live' : 'approximate location', 'live');
    startPolling();
  }

  // ── Self marker ───────────────────────────────────────────
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

  // ── Other user markers ────────────────────────────────────
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

  // ── Geolocation ───────────────────────────────────────────
  function startWatch() {
    if (!('geolocation' in navigator)) {
      console.warn('[Map] Geolocation not available in this browser');
      setStatus('location unavailable', 'off');
      tryIpFallback();
      return;
    }
    setStatus('locating…', 'locating');
    console.log('[Map] Starting geolocation (low accuracy first)');

    // Step 1 — low accuracy, fast, works on desktop via Wi-Fi
    navigator.geolocation.getCurrentPosition(
      pos => {
        const acc = pos.coords.accuracy;
        console.log('[Map] Low-accuracy fix, accuracy:', Math.round(acc) + 'm');
        onPosition(pos, acc < 5000);  // accurate if within 5km
        // Start high-accuracy watch to refine on mobile GPS — silent on failure
        navigator.geolocation.watchPosition(
          pos => {
            console.log('[Map] High-accuracy fix, accuracy:', Math.round(pos.coords.accuracy) + 'm');
            onPosition(pos, true);
          },
          _err => { /* No GPS on this device — low accuracy fix is enough */ },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
      },
      _err => {
        console.warn('[Map] Low-accuracy geolocation failed, trying high accuracy');
        navigator.geolocation.getCurrentPosition(
          pos => onPosition(pos, true),
          _err2 => {
            console.warn('[Map] All geolocation failed, falling back to IP');
            tryIpFallback();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );
  }

  function onPosition(pos, accurate) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    myPos = { lat, lng };

    if (!map) {
      initMap(lat, lng, accurate);
    } else {
      placeSelfMarker(lat, lng);
      if (accurate) setStatus('live', 'live');
    }
    pushLocation(lat, lng);
  }

  // IP fallback
  async function tryIpFallback() {
    console.log('[Map] Trying IP geolocation fallback');
    setStatus('locating…', 'locating');
    try {
      const r    = await fetch('https://ipapi.co/json/');
      const data = await r.json();
      if (data.latitude && data.longitude) {
        console.log('[Map] IP location:', data.city, data.country_name);
        myPos = { lat: data.latitude, lng: data.longitude };
        if (!map) initMap(data.latitude, data.longitude, false);
        setStatus('approximate location', 'live');
        pushLocation(data.latitude, data.longitude);
        startPolling();
      } else {
        throw new Error('No coordinates in IP response');
      }
    } catch (e) {
      console.warn('[Map] IP fallback failed:', e.message);
      setStatus('location unavailable', 'off');
      if (!map) initMap(51.505, -0.09, false);
    }
  }

  // ── Push location to backend ──────────────────────────────
  async function pushLocation(lat, lng) {
    if (!window.Auth?.getToken()) return;  // no token — skip silently
    console.log('[Map] Pushing location to backend:', lat, lng);
    try {
      const data = await window.Api.putLocation(lat, lng);
      console.log('[Map] Location push response:', JSON.stringify(data));
    } catch (e) {
      console.warn('[Map] Location push failed:', e.message);
    }
  }

  // ── Poll nearby users ─────────────────────────────────────
  function startPolling() {
    if (pollTimer) return;
    console.log('[Map] Starting nearby poll every', POLL_MS + 'ms');
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  async function poll() {
    if (!myPos) return;
    if (!window.Auth?.getToken()) return;  // no token — skip silently
    try {
      const result = await window.Api.getNearby(myPos.lat, myPos.lng);
      const users = result.users || [];
      console.log('[Map] Nearby users:', users.length);
      renderMarkers(users);
    } catch (e) {
      console.warn('[Map] Nearby poll failed:', e.message);
    }
  }

  // ── Refresh markers after login/logout ────────────────────
  function refreshMarkers() {
    // Always update self marker if map exists — myPos may be set even if marker wasn't
    if (map && myPos) placeSelfMarker(myPos.lat, myPos.lng);
    // Re-poll so other markers update too
    poll();
  }

  // ── Centre on self ────────────────────────────────────────
  function centreOnSelf() {
    if (map && myPos) map.setView([myPos.lat, myPos.lng], DEFAULT_ZOOM, { animate: true });
  }

  // ── Guest session expired ─────────────────────────────────
  function onGuestExpired() {
    console.log('[Map] Guest session expired');
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

  // Wait for Auth.init() to complete before starting —
  // we need a valid token before we can push location or poll
  if (window.__authReady && typeof window.__authReady.then === 'function') {
    window.__authReady.then(function() {
      console.log('[Map] Auth ready, starting geolocation');
      startWatch();
    });
  } else {
    // __authReady not set yet — wait for it
    var authWait = setInterval(function() {
      if (window.__authReady && typeof window.__authReady.then === 'function') {
        clearInterval(authWait);
        window.__authReady.then(function() {
          console.log('[Map] Auth ready (waited), starting geolocation');
          startWatch();
        });
      }
    }, 50);
  }

})();