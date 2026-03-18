// --- Debug console (activate with ?dbg in URL) --------------
(function () {
  if (!window.location.search.includes('dbg')) return;
  var logs = [];
  ['log','warn','error','info'].forEach(function(m){
    var orig = console[m].bind(console);
    console[m] = function(){
      orig.apply(console, arguments);
      var line = '['+m.toUpperCase()+'] ' + Array.from(arguments).map(function(a){
        try { return typeof a==='object' ? JSON.stringify(a) : String(a); } catch(e){ return String(a); }
      }).join(' ');
      logs.push(line);
      var el = document.getElementById('dbgOut');
      if(el) el.textContent = logs.join('\n');
    };
  });
  window.addEventListener('error', function(e){ console.error('Uncaught: '+e.message+' @ '+e.filename+':'+e.lineno); });
  window.addEventListener('unhandledrejection', function(e){ console.error('Promise rejected: '+e.reason); });
  document.addEventListener('DOMContentLoaded', function(){
    var div = document.createElement('div');
    div.innerHTML = '<div id="dbgBox" style="position:fixed;bottom:0;left:0;right:0;max-height:40vh;background:#000;color:#0f0;font-size:11px;font-family:monospace;z-index:99999;overflow-y:auto;border-top:2px solid #0f0;padding:4px"><div style="display:flex;justify-content:space-between;padding:2px 4px"><strong>🐛 DEBUG</strong><button onclick="document.getElementById(\'dbgBox\').style.display=\'none\'">✕</button></div><pre id="dbgOut" style="margin:0;white-space:pre-wrap;word-break:break-all"></pre></div>';
    document.body.appendChild(div);
    console.log('Debug ready — URL: ' + location.href);
  });
})();
// ------------------------------------------------------------

// Pre-warm all backend services (they may be sleeping on Railway free tier).
// Skipped if already pinged in this browser session (sessionStorage flag).
(function () {
  var WARM_KEY = 'bbm_warm';
  var WARM_TTL = 5 * 60 * 1000; // 5 min — re-warm if tab is idle for a long time
  var last = parseInt(sessionStorage.getItem(WARM_KEY) || '0', 10);
  if (Date.now() - last < WARM_TTL) return;
  fetch((window.BOOMBOOM_API_URL) + '/health')
    .then(function (r) {
      console.log('[warm-up] ' + r.status + (r.status === 503 ? ' (cold-start)' : ' — ready'));
      sessionStorage.setItem(WARM_KEY, Date.now());
    })
    .catch(function () { console.log('[warm-up] ping failed (network error)'); });
})();

// ============================================================
// bOOmbOOm.NOW! — app.js  (plain script, NOT a module)
// Runs synchronously after auth.js loads.
// Sets Auth hooks, then triggers Auth.init().
// Also wires modals, offcanvas, FAB after DOMContentLoaded.
// ============================================================

(function () {

  function $(id) { return document.getElementById(id); }

  // ── Desktop nav links ─────────────────────────────────────
  var BASE = (window.BOOMBOOM_BASE);
  function getRole() {
    try {
      var t = Auth.getToken();
      return t ? JSON.parse(atob(t.split('.')[1])).role : null;
    } catch (e) { return null; }
  }
  function buildDesktopNav(isReg) {
    var el = $('navLinksDesktop');
    if (!el) return;
    var p = location.pathname;
    if (!isReg) {
      el.innerHTML =
        '<button class="btn btn-bbm-ghost btn-sm" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>' +
        '<button class="btn btn-bbm-primary btn-sm" data-bs-toggle="modal" data-bs-target="#registerModal">Sign Up</button>';
    } else {
      el.innerHTML =
        '<a href="' + BASE + '/messages/"   class="nav-link ' + (p.startsWith(BASE + '/messages/')   ? 'active' : '') + '"><i class="bi bi-chat-dots me-1"></i>Messages</a>' +
        '<a href="' + BASE + '/favourites/" class="nav-link ' + (p.startsWith(BASE + '/favourites/') ? 'active' : '') + '"><i class="bi bi-star me-1"></i>Favourites</a>' +
        '<a href="' + BASE + '/profile/"    class="nav-link ' + (p.startsWith(BASE + '/profile/')    ? 'active' : '') + '"><i class="bi bi-person-circle me-1"></i>Profile</a>';
      if (getRole() === 'admin') {
        el.innerHTML +=
          '<a href="' + BASE + '/admin/" class="nav-link ' + (p.startsWith(BASE + '/admin/') ? 'active' : '') + '"><i class="bi bi-shield-lock me-1"></i>Admin</a>';
      }
    }
  }

  // ── Offcanvas state ───────────────────────────────────────
  function syncOffcanvas(isReg) {
    var guestMenu  = $('guestMenu');
    var userMenu   = $('userMenu');
    var adminLink  = $('adminNavLink');
    if (!guestMenu || !userMenu) return;
    if (adminLink) adminLink.classList.toggle('d-none', !(isReg && getRole() === 'admin'));
    if (isReg) {
      guestMenu.classList.add('d-none');
      userMenu.classList.remove('d-none');
      var nickEl  = $('menuNickname');
      if (nickEl) {
        var profile = Auth.getProfile();
        nickEl.textContent = profile.nickname || '—';
        var color = profile.sex === 'f' ? 'var(--bbm-pink-light)'
                  : profile.sex === 'm' ? 'var(--bbm-blue-light)'
                  : 'var(--bbm-text)';
        nickEl.style.cssText = '-webkit-text-fill-color:' + color + ';color:' + color + ';background:none';
      }
    } else {
      guestMenu.classList.remove('d-none');
      userMenu.classList.add('d-none');
    }
  }

  function applyAuthState(isReg) {
    buildDesktopNav(isReg);
    syncOffcanvas(isReg);
  }

  // ── Auth hooks — set NOW, before Auth.init() runs ─────────
  Auth.onLogin = function () {
    applyAuthState(true);
    if (DEBUG) console.log('[App] onLogin fired, sex:', Auth.getSex());
    if (window.MapModule) {
      window.MapModule.refreshMarkers();
      window.MapModule.refreshRadius();
      setTimeout(function() { window.MapModule && window.MapModule.refreshMarkers(); }, 1000);
    }
  };

  Auth.onLogout = function () {
    applyAuthState(false);
    window.MapModule && window.MapModule.refreshMarkers();
    var prot = [BASE + '/messages', BASE + '/favourites', BASE + '/profile', BASE + '/admin'];
    if (prot.some(function(p) { return location.pathname.startsWith(p); })) {
      window.location.href = BASE + '/';
    }
  };

  Auth.onGuestReady   = function () { /* status owned by GeoModule */ };
  Auth.onGuestExpired = function () { /* handled by GeoModule */ };

  // ── Kick off Auth.init() now — hooks are ready ────────────
  window.__authReady = Auth.init();

  // ── Wire UI interactions after DOM is ready ───────────────
  document.addEventListener('DOMContentLoaded', function () {

    // Login modal
    var loginBtn = $('loginSubmitBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', async function () {
        var email    = $('loginEmail') ? $('loginEmail').value.trim() : '';
        var password = $('loginPassword') ? $('loginPassword').value : '';
        var errEl    = $('loginError');
        if (errEl) errEl.classList.add('d-none');

        if (!email || !password) {
          if (errEl) { errEl.textContent = 'Please enter your email and password.'; errEl.classList.remove('d-none'); }
          return;
        }
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logging in…';
        try {
          await Auth.login({ email: email, password: password });
          var modal = bootstrap.Modal.getInstance($('loginModal'));
          if (modal) modal.hide();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Log In';
        }
      });

      ['loginEmail', 'loginPassword'].forEach(function(id) {
        var el = $(id);
        if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') loginBtn.click(); });
      });
    }

    // Register modal
    var regBtn = $('regSubmitBtn');
    if (regBtn) {
      regBtn.addEventListener('click', async function () {
        var email    = $('regEmail')    ? $('regEmail').value.trim()    : '';
        var nickname = $('regNickname') ? $('regNickname').value.trim() : '';
        var password = $('regPassword') ? $('regPassword').value        : '';
        var age      = $('regAge')      ? parseInt($('regAge').value, 10) : 0;
        var sex      = $('regSex')      ? $('regSex').value              : '';
        var errEl    = $('registerError');
        if (errEl) errEl.classList.add('d-none');

        if (!email || !nickname || !password || !age || !sex) {
          if (errEl) { errEl.textContent = 'All fields are required.'; errEl.classList.remove('d-none'); }
          return;
        }
        if (nickname.length < 2) {
          if (errEl) { errEl.textContent = 'Nickname must be at least 2 characters.'; errEl.classList.remove('d-none'); }
          return;
        }
        regBtn.disabled = true;
        regBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating account…';
        try {
          await Auth.register({ email: email, nickname: nickname, password: password, age: age, sex: sex });
          var modal = bootstrap.Modal.getInstance($('registerModal'));
          if (modal) modal.hide();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
        } finally {
          regBtn.disabled = false;
          regBtn.textContent = 'Create Account';
        }
      });
    }

    // Logout
    var logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        var oc = bootstrap.Offcanvas.getInstance($('appMenu'));
        if (oc) oc.hide();
        Auth.logout();
      });
    }

    // Delete account — button lives on /profile, modal wired here globally
    var deleteConfirmModal = $('deleteConfirmModal');
    if (deleteConfirmModal) {
      deleteConfirmModal.addEventListener('shown.bs.modal', function () {
        var input = $('deleteNicknameInput');
        var btn   = $('confirmDeleteBtn');
        if (!input || !btn) return;
        input.focus();
        input.addEventListener('input', function () {
          btn.disabled = input.value.trim() !== (Auth.getNickname() || '');
        });
      });
      deleteConfirmModal.addEventListener('hidden.bs.modal', function () {
        var input = $('deleteNicknameInput');
        var btn   = $('confirmDeleteBtn');
        if (input) input.value = '';
        if (btn)   btn.disabled = true;
      });
    }

    var confirmDeleteBtn = $('confirmDeleteBtn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async function () {
        var input = $('deleteNicknameInput');
        if (!input || input.value.trim() !== (Auth.getNickname() || '')) return;
        try {
          await Auth.deleteAccount();
          var modal = bootstrap.Modal.getInstance($('deleteConfirmModal'));
          if (modal) modal.hide();
        } catch (err) {
          alert('Error deleting account: ' + err.message);
        }
      });
    }

    // Pin modal
    window.openPinModal = function (user) {
      var userId      = user.userId;
      var nickname    = user.nickname;
      var age         = user.age;
      var sex         = user.sex;
      var distanceM   = user.distanceM;
      var targetIsReg = user.isRegistered;
      var accuracy    = user.accuracy;

      var isVenuePin = user.accountType === 'venue';
      var avatarEl = $('pinAvatar');
      if (avatarEl) avatarEl.className = 'pin-avatar ' + (isVenuePin ? 'venue' : sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
      var iconEl = $('pinAvatarIcon');
      if (iconEl) {
        if (isVenuePin) {
          iconEl.innerHTML = '<i class="bi bi-house-fill"></i>';
        } else {
          iconEl.textContent = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';
        }
      }
      if ($('pinNickname')) $('pinNickname').textContent = nickname || 'Anonymous';
      if ($('pinAge'))      $('pinAge').textContent      = isVenuePin ? '—' : (age ? age + ' yrs' : '—');
      if ($('pinSex'))      $('pinSex').textContent      = isVenuePin ? 'Venue' : (sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—');

      if (targetIsReg && userId && !age && !isVenuePin) {
        window.Api.getProfile(userId).then(function(profile) {
          if (profile.age && $('pinAge')) $('pinAge').textContent = profile.age + ' yrs';
        }).catch(function() {});
      }
      if ($('pinDist'))     $('pinDist').textContent     = distanceM != null
        ? (distanceM < 1000 ? Math.round(distanceM) + 'm away' : (distanceM / 1000).toFixed(1) + 'km away')
        : '';

      var accWrap = $('pinAccuracyWrap');
      if (accWrap) accWrap.classList.toggle('d-none', accuracy !== 'ip');

      var viewerIsReg = Auth.isRegistered();
      var pinActions  = $('pinActions');
      var pinGuest    = $('pinGuestPrompt');
      if (pinActions) pinActions.classList.toggle('d-none', !viewerIsReg || !targetIsReg);
      if (pinGuest)   pinGuest.classList.toggle('d-none', viewerIsReg);

      if (viewerIsReg && targetIsReg && userId) {
        var profileLink = $('pinProfileLink');
        if (profileLink) profileLink.href = BASE + '/profile/view/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

        var msgLink = $('pinMessageLink');
        if (msgLink) {
          msgLink.href = BASE + '/messages/thread/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');
          msgLink.classList.add('d-none');
          if (isVenuePin) {
            window.Api.getProfile(userId).then(function(profile) {
              if (profile.canReceiveMessages === false) return;
              window.Api.isMutualFavourite(userId).then(function(data) {
                if (data.mutual) msgLink.classList.remove('d-none');
              }).catch(function() {});
            }).catch(function() {});
          } else {
            window.Api.isMutualFavourite(userId).then(function(data) {
              if (data.mutual) msgLink.classList.remove('d-none');
            }).catch(function() { /* leave hidden on error */ });
          }
        }

        var favBtn   = $('pinFavBtn');
        var favIcon  = $('pinFavIcon');
        var favLabel = $('pinFavLabel');
        if (favBtn) {
          if (!window.Auth || !window.Auth.isRegistered()) {
            favBtn.classList.add('d-none');
          } else {
          favBtn.disabled = false;
          if (favIcon)  { favIcon.className  = 'bi bi-star me-2'; }
          if (favLabel) { favLabel.textContent = 'Add to Favourites'; }

          window.Api.getFavourites().then(function(data) {
            var isFav = (data.favourites || []).some(function(f) { return f.userId === userId; });
            if (isFav) {
              if (favIcon)  favIcon.className   = 'bi bi-star-fill text-pink me-2';
              if (favLabel) favLabel.textContent = 'Favourited';
            }
            favBtn.onclick = async function () {
              favBtn.disabled = true;
              try {
                if (isFav) {
                  await window.Api.removeFavourite(userId);
                  isFav = false;
                  if (favIcon)  favIcon.className   = 'bi bi-star me-2';
                  if (favLabel) favLabel.textContent = 'Add to Favourites';
                } else {
                  await window.Api.addFavourite(userId);
                  isFav = true;
                  if (favIcon)  favIcon.className   = 'bi bi-star-fill text-pink me-2';
                  if (favLabel) favLabel.textContent = 'Favourited';
                }
              } catch (err) {
                if (err.status !== 403) alert(err.message);
              } finally {
                favBtn.disabled = false;
              }
            };
          }).catch(function() { /* ignore */ });
          } // end isRegistered
        }

        var pinBlockBtn = $('pinBlockBtn');
        if (pinBlockBtn) {
          pinBlockBtn.onclick = function () {
            bootstrap.Modal.getInstance($('pinModal'))?.hide();
            window.BlockModule?.prompt(userId, nickname || 'this user');
          };
        }
      }

      new bootstrap.Modal($('pinModal')).show();
    };

    // FAB
    var fab = $('fabCentre');
    if (fab) fab.addEventListener('click', function () {
      window.MapModule && window.MapModule.centreOnSelf();
    });

    // Apply UI state now that DOM exists
    window.__authReady.then(function () {
      applyAuthState(Auth.isRegistered());
    });

  }); // DOMContentLoaded

})();

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

// ============================================================
// LockModule
// Keys live in the crypto worker (SharedWorker where supported,
// regular Worker on Safari). The SharedWorker survives full-page
// navigations so no sessionStorage key export is needed.
// ============================================================
(function () {

  var INACTIVITY_LOCK_MS = 3 * 60 * 1000;
  var HIDE_LOCK_MS       = 30 * 1000;

  var _inactivityTimer = null;
  var _hiddenTimer     = null;
  var _modal           = null;
  var _locked          = false;

  // ── Modal ─────────────────────────────────────────────────

  function getModal() {
    if (!_modal) {
      var el = document.getElementById('lockModal');
      if (el) _modal = new bootstrap.Modal(el);
    }
    return _modal;
  }

  // ── Lock ──────────────────────────────────────────────────

  function lock() {
    if (!window.Auth.isRegistered()) return;
    if (_locked) return;
    _locked = true;
    clearInactivityTimer();
    window.BBMCrypto?.lock();
    if (DEBUG) console.log('[Lock] Keys locked.');
    var modal = getModal();
    if (modal) modal.show();
  }

  // ── Unlock ────────────────────────────────────────────────

  function unlock() {
    _locked = false;
    resetInactivityTimer();
    var modal = getModal();
    if (modal) modal.hide();
    window.dispatchEvent(new CustomEvent('bbm:unlocked'));
    if (DEBUG) console.log('[Lock] Keys unlocked.');
  }

  // ── Inactivity timer ──────────────────────────────────────

  function clearInactivityTimer() {
    if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
  }

  function resetInactivityTimer() {
    if (!window.Auth.isRegistered()) return;
    clearInactivityTimer();
    _inactivityTimer = setTimeout(lock, INACTIVITY_LOCK_MS);
  }

  ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      if (!_locked) resetInactivityTimer();
    }, { passive: true });
  });

  // ── Visibility ────────────────────────────────────────────

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      _hiddenTimer = setTimeout(function () {
        if (document.hidden) { if (DEBUG) console.log('[Lock] Tab hidden too long — locking.'); lock(); }
      }, HIDE_LOCK_MS);
    } else {
      if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
      if (!_locked) resetInactivityTimer();
    }
  });

  // ── Unlock button ─────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    var unlockBtn = document.getElementById('lockUnlockBtn');
    var logoutBtn = document.getElementById('lockLogoutBtn');
    var pwInput   = document.getElementById('lockPassword');
    var errorEl   = document.getElementById('lockError');

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.classList.remove('d-none');
    }
    function clearError() {
      if (errorEl) errorEl.classList.add('d-none');
    }

    async function tryUnlock() {
      var password = pwInput ? pwInput.value : '';
      if (!password) { showError('Please enter your password.'); return; }
      clearError();
      if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = 'Unlocking…'; }
      try {
        if (DEBUG) console.log('[Lock] Fetching encrypted key blob from server…');
        var keys = await window.Api.getMyKeys();
        if (DEBUG) console.log('[Lock] Key blob received, encryptedPrivateKey:', !!keys.encryptedPrivateKey, 'publicKey:', !!keys.publicKey);
        if (keys.encryptedPrivateKey && keys.publicKey) {
          if (DEBUG) console.log('[Lock] Decrypting private key with PBKDF2…');
          var ok = await window.BBMCrypto.unlock(keys.encryptedPrivateKey, password, keys.publicKey);
          if (!ok) throw new Error('Wrong password.');
          if (DEBUG) console.log('[Lock] Keys unlocked successfully.');
        } else {
          // No keys on server yet (legacy account) — generate and save now
          if (DEBUG) console.log('[Lock] No keys on server — generating new key pair…');
          var setup = await window.BBMCrypto.setup(password);
          if (DEBUG) console.log('[Lock] Key pair generated, saving to server…');
          await window.Api.saveKeys(setup.publicKeyB64, setup.encBlob);
          if (DEBUG) console.log('[Lock] New keys saved to server.');
        }
        if (pwInput) pwInput.value = '';
        unlock();
      } catch (e) {
        if (DEBUG) console.warn('[Lock] Unlock failed:', e.message);
        showError(e.message || 'Unlock failed.');
      } finally {
        if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.innerHTML = '<i class="bi bi-unlock me-2"></i>Unlock'; }
      }
    }

    if (unlockBtn) unlockBtn.addEventListener('click', tryUnlock);
    if (pwInput)   pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (pwInput) pwInput.value = '';
      clearError();
      _locked = false;
      window.Auth.logout();
      // modal will be hidden by Auth.onLogout → clearInactivityTimer path,
      // but force-hide here too in case logout races with Bootstrap state
      var modal = getModal();
      if (modal) modal.hide();
    });
  });

  // ── requireUnlocked() ─────────────────────────────────────

  window.requireUnlocked = function () {
    if (window.BBMCrypto?.isUnlocked()) { _locked = false; return true; }
    _locked = true;
    var modal = getModal();
    if (modal) modal.show();
    return false;
  };

  // ── Auth hooks ────────────────────────────────────────────

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    _locked = false;
    resetInactivityTimer();
  };

  // On page load with a saved token: ask the crypto worker if the key is already
  // loaded (SharedWorker retains it across navigations). If yes, fire bbm:unlocked
  // silently. If no (new session, Safari regular Worker, or inactivity lock),
  // mark locked so messages.js shows the lock modal.
  Auth.onNeedsUnlock = async function () {
    await window.BBMCrypto?.ready?.();
    if (window.BBMCrypto?.isUnlocked()) {
      _locked = false;
      resetInactivityTimer();
      window.dispatchEvent(new CustomEvent('bbm:unlocked'));
    } else {
      _locked = true;
      var modal = getModal();
      if (modal) modal.show();
    }
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    if (_origOnLogout) _origOnLogout();
    clearInactivityTimer();
    if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
    _locked = false;
  };

})();

// ============================================================
// NotifModule — favourite notifications
// Polls GET /api/notifications on login and every 30 s.
// Shows dismissable banners below the navbar and a dot badge
// on the hamburger menu icon.
// ============================================================
(function () {

  var POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 min — notifications are low-urgency
  var _pollTimer = null;
  var _paused = false;

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function sexPronoun(sex) {
    return sex === 'f' ? 'her' : sex === 'm' ? 'his' : 'their';
  }

  function showBanners(notifications) {
    var container = document.getElementById('notifBanner');
    var dot        = document.getElementById('notifDot');
    if (!container) return;

    if (!notifications || notifications.length === 0) {
      container.innerHTML = '';
      if (dot) dot.classList.add('d-none');
      return;
    }

    if (dot) dot.classList.remove('d-none');

    container.innerHTML = notifications.map(function (n) {
      return '<div class="alert alert-info alert-dismissible d-flex align-items-center gap-2 mb-0 rounded-0" role="alert" data-notif-id="' + esc(n.id) + '" style="border-left:none;border-right:none;border-top:none">' +
        '<i class="bi bi-star-fill flex-shrink-0"></i>' +
        '<span><strong>' + esc(n.fromNickname) + '</strong> added you to ' + sexPronoun(n.fromSex) + ' favourites. ' +
        '<a href="' + esc((window.BOOMBOOM_BASE) + '/favourites/') + '" class="alert-link">Add them back</a> to start chatting!</span>' +
        '<button type="button" class="btn-close ms-auto flex-shrink-0" aria-label="Dismiss"></button>' +
        '</div>';
    }).join('');

    function dismiss(alertEl) {
      if (!alertEl) return;
      var id = alertEl.dataset.notifId;
      alertEl.remove();
      if (window.Api) window.Api.dismissNotification(id).catch(function () {});
      if (container.querySelectorAll('[data-notif-id]').length === 0) {
        if (dot) dot.classList.add('d-none');
      }
    }

    container.querySelectorAll('.btn-close').forEach(function (btn) {
      btn.addEventListener('click', function () { dismiss(btn.closest('[data-notif-id]')); });
    });

    container.querySelectorAll('.alert-link').forEach(function (link) {
      link.addEventListener('click', function () { dismiss(link.closest('[data-notif-id]')); });
    });
  }

  function pollNotifications() {
    if (_paused) return;
    if (!window.Auth || !window.Auth.isRegistered()) return;
    window.Api && window.Api.getNotifications().then(function (data) {
      showBanners(data.notifications || []);
    }).catch(function (e) {
      if (DEBUG) console.warn('[Notif] poll failed:', e.message);
    });
  }

  function startNotifPoll() {
    stopNotifPoll();
    pollNotifications();
    _pollTimer = setInterval(pollNotifications, POLL_INTERVAL_MS);
  }

  document.addEventListener('visibilitychange', function () {
    _paused = document.hidden;
    // Poll immediately when user returns to the tab
    if (!document.hidden && _pollTimer) pollNotifications();
  });

  function stopNotifPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    showBanners([]);
  }

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    startNotifPoll();
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    if (_origOnLogout) _origOnLogout();
    stopNotifPoll();
  };

  // On page load with an already-valid token
  window.__authReady && window.__authReady.then(function () {
    if (window.Auth && window.Auth.isRegistered()) startNotifPoll();
  });

})();
