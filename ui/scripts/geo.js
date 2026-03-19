// ============================================================
// GeoModule — runs on every page
// Handles geolocation, location push, and status bar updates.
// Exposes window.GeoState = { pos, accuracy } for map.js.
// Fires 'geo:position' CustomEvent whenever position updates.
// Fires 'geo:nearby'   CustomEvent with { users } from WS push.
// ============================================================
(function () {

  window.GeoState = { pos: null, accuracy: null };

  // ── Location WebSocket ────────────────────────────────────
  // Replaces the HTTP PUT polling interval. Falls back to HTTP
  // if the WS is unavailable (e.g. gateway cold-start).

  var _locWs      = null;
  var _locWsRetry = 1000;
  var _locWsTimer = null;

  function locWsUrl() {
    var api  = window.BOOMBOOM_API_URL;
    var base = api.replace(/^https?:\/\//, 'wss://').replace(/\/api\/?$/, '');
    return base + '/ws/location';
  }

  function sendLocWS(lat, lon, accuracy) {
    if (_locWs && _locWs.readyState === WebSocket.OPEN) {
      _locWs.send(JSON.stringify({ type: 'position', lat: lat, lon: lon, accuracy: accuracy || 'gps' }));
      return true;
    }
    return false;
  }

  function connectLocWS() {
    var token = window.Auth?.getToken?.();
    if (!token) return;
    if (_locWs && (_locWs.readyState === WebSocket.OPEN || _locWs.readyState === WebSocket.CONNECTING)) return;

    _locWs = new WebSocket(locWsUrl());

    _locWs.onopen = function () {
      _locWsRetry = 1000;
      if (DEBUG) console.log('[Geo] WS connected');
      _locWs.send(JSON.stringify({ type: 'auth', token: window.Auth?.getToken?.() || '' }));
      if (DEBUG) console.log('[Geo] WS auth sent, token tier:', window.Auth?.getTier?.() || 'unknown');
      var pos = window.GeoState.pos;
      if (pos) sendLocWS(pos.lat, pos.lng, window.GeoState.accuracy);
    };

    _locWs.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'nearby') {
          if (DEBUG) console.log('[Geo] WS ← nearby:', (msg.users || []).length, 'users', msg.users);
          window.dispatchEvent(new CustomEvent('geo:nearby', { detail: { users: msg.users || [] } }));
        }
      } catch { /* silent */ }
    };

    _locWs.onclose = function () {
      _locWs = null;
      if (!window.Auth?.getToken?.()) return;
      if (_locWsTimer) clearTimeout(_locWsTimer);
      _locWsTimer = setTimeout(connectLocWS, _locWsRetry);
      _locWsRetry = Math.min(_locWsRetry * 2, 30000);
      if (DEBUG) console.log('[Geo] WS closed, retrying in', _locWsRetry + 'ms');
    };
  }

  function closeLocWS() {
    if (_locWsTimer) { clearTimeout(_locWsTimer); _locWsTimer = null; }
    if (_locWs) { _locWs.onclose = null; _locWs.close(); _locWs = null; }
  }

  // ── Location push — WS first, HTTP fallback ───────────────

  async function pushLocation(lat, lng, accuracy) {
    if (!window.Auth?.getToken()) return;
    if (isVenueAccount()) return; // venues have a fixed location — never push any position
    if (sendLocWS(lat, lng, accuracy)) {
      if (DEBUG) console.log('[Geo] WS → position sent:', lat, lng, accuracy);
      return;
    }
    if (DEBUG) console.log('[Geo] WS not open, falling back to HTTP PUT:', lat, lng, accuracy);
    try {
      await window.Api.putLocation(lat, lng, accuracy || 'gps');
    } catch (e) {
      if (DEBUG) console.warn('[Geo] HTTP location push failed:', e.message);
    }
  }

  // ── Status bar ────────────────────────────────────────────

  function setStatus(text, state) {
    var dot  = document.getElementById('statusDot');
    var span = document.getElementById('statusText');
    if (dot)  dot.className    = 'bbm-status-dot' + (state ? ' ' + state : '');
    if (span) span.textContent = text;
  }

  function dispatchPosition(lat, lng) {
    window.GeoState.pos = { lat: lat, lng: lng };
    window.dispatchEvent(new CustomEvent('geo:position', { detail: { lat: lat, lng: lng } }));
  }

  // ── Geolocation ───────────────────────────────────────────

  var MIN_SEND_DISTANCE_M = 5;

  function approxDistM(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * 111000;
    var dLng = (lng2 - lng1) * 111000 * Math.cos(lat1 * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  function onPosition(pos, accurate) {
    var lat      = pos.coords.latitude;
    var lng      = pos.coords.longitude;
    var accuracy = 'gps';
    window.GeoState.accuracy = accuracy;
    dispatchPosition(lat, lng);
    setStatus(accurate ? 'live' : 'approximate location', 'live');
    var last = window.GeoState.lastSent;
    if (!last || approxDistM(last.lat, last.lng, lat, lng) >= MIN_SEND_DISTANCE_M) {
      window.GeoState.lastSent = { lat: lat, lng: lng };
      pushLocation(lat, lng, accuracy);
    }
  }

  async function tryIpFallback() {
    setStatus('locating…', 'locating');
    var services = [
      { url: 'https://ipwho.org/',                    lat: 'latitude', lon: 'longitude' },
      { url: 'https://iplocate.io/api/lookup/',       lat: 'latitude', lon: 'longitude' },
      { url: 'https://api.ipapi.is/',                 lat: 'latitude', lon: 'longitude' },
    ];
    for (var s = services.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var tmp = services[s]; services[s] = services[j]; services[j] = tmp;
    }
    for (var i = 0; i < services.length; i++) {
      try {
        var r    = await fetch(services[i].url);
        var data = await r.json();
        var lat  = data[services[i].lat];
        var lon  = data[services[i].lon];
        if (lat && lon) {
          if (DEBUG) console.log('[Geo] IP location from', services[i].url);
          window.GeoState.accuracy = 'ip';
          dispatchPosition(lat, lon);
          setStatus('approximate location', 'live');
          pushLocation(lat, lon, 'ip');
          return;
        }
      } catch (e) {
        if (DEBUG) console.warn('[Geo] IP fallback failed for', services[i].url, e.message);
      }
    }
    if (DEBUG) console.warn('[Geo] All IP fallbacks failed');
    setStatus('location unavailable', 'off');
  }

  function startWatch() {
    if (!('geolocation' in navigator)) {
      console.warn('[Geo] Geolocation not available');
      tryIpFallback();
      return;
    }
    setStatus('locating…', 'locating');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var acc = pos.coords.accuracy;
        if (DEBUG) console.log('[Geo] Low-accuracy fix:', Math.round(acc) + 'm');
        onPosition(pos, acc < 5000);
        navigator.geolocation.watchPosition(
          function (pos) { onPosition(pos, true); },
          function (err) { console.warn('[Geo] watchPosition error:', err.code, err.message); },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
      },
      function (err) {
        if (DEBUG) console.warn('[Geo] Low-accuracy failed:', err.code, err.message);
        navigator.geolocation.getCurrentPosition(
          function (pos) { onPosition(pos, true); },
          function (err2) {
            if (DEBUG) console.warn('[Geo] High-accuracy failed:', err2.code, err2.message, '— falling back to IP');
            tryIpFallback();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );
  }

  // ── Boot ──────────────────────────────────────────────────

  window.__authReady.then(function () {
    if (DEBUG) console.log('[Geo] Auth ready, starting geolocation');
    if (isVenueAccount()) {
      // Fetch the fixed location from the profile and initialise the map.
      // Connect WS so the gateway's nearby-push timer fires (PUT /location
      // will be rejected by the backend — that's fine and harmless).
      window.Api.getMe().then(function (data) {
        var lat = data.fixedLat;
        var lng = data.fixedLon;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          if (DEBUG) console.warn('[Geo] Venue has no fixedLat/fixedLon');
          setStatus('location unavailable', 'off');
          return;
        }
        window.GeoState.accuracy = 'fixed';
        dispatchPosition(lat, lng);
        setStatus('fixed location', 'live');
        connectLocWS(); // receives geo:nearby pushes; onopen sends fixed pos to gateway
      }).catch(function (e) {
        if (DEBUG) console.warn('[Geo] Failed to load venue position:', e);
        setStatus('location unavailable', 'off');
      });
      return;
    }
    connectLocWS();
    startWatch();
  });

  // ── Auth hooks ────────────────────────────────────────────

  function isVenueAccount() {
    try {
      var t = window.Auth?.getToken?.();
      if (!t) return false;
      return JSON.parse(atob(t.split('.')[1])).account_type === 'venue';
    } catch (e) { return false; }
  }

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    // Reconnect WS with fresh user token (guest token no longer valid)
    closeLocWS();
    // Venue accounts have a fixed location — fetch fixedLat/fixedLon first so
    // GeoState.pos is correct before the WS opens and sends the first position.
    if (isVenueAccount()) {
      window.Api.getMe().then(function (meData) {
        var lat = meData.fixedLat;
        var lng = meData.fixedLon;
        if (typeof lat === 'number' && typeof lng === 'number') {
          window.GeoState.accuracy = 'fixed';
          dispatchPosition(lat, lng);
          setStatus('fixed location', 'live');
        }
        connectLocWS();
      }).catch(function () { connectLocWS(); });
      return;
    }
    connectLocWS();
    var pos = window.GeoState.pos;
    if (pos) {
      window.Api.deleteLocation().catch(function() {});
      pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    window.MapModule && window.MapModule.onLogout();  // clear markers + pill immediately
    closeLocWS();
    window.Api.deleteLocation().catch(function() {});
    if (_origOnLogout) _origOnLogout();
  };

  var _origOnGuestReady = Auth.onGuestReady;
  Auth.onGuestReady = function () {
    if (_origOnGuestReady) _origOnGuestReady();
    connectLocWS();                               // reconnect as guest after logout/init
    window.MapModule && window.MapModule.refreshSelf();   // update self-pin to guest style
    window.MapModule && window.MapModule.refreshRadius(); // fetch correct guest radius (500m)
  };

  var _origOnGuestExpired = Auth.onGuestExpired;
  Auth.onGuestExpired = function () {
    if (_origOnGuestExpired) _origOnGuestExpired();
    closeLocWS();
    window.Api.deleteLocation().catch(function() {});
    setStatus('session expired', 'off');
    window.MapModule && window.MapModule.onGuestExpired();
  };

})();
