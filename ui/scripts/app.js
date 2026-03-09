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

// ============================================================
// bOOmbOOm.NOW! — app.js  (plain script, NOT a module)
// Runs synchronously after auth.js loads.
// Sets Auth hooks, then triggers Auth.init().
// Also wires modals, offcanvas, FAB after DOMContentLoaded.
// ============================================================

(function () {

  function $(id) { return document.getElementById(id); }

  // ── Desktop nav links ─────────────────────────────────────
  var BASE = (window.BOOMBOOM_BASE || '');
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
    }
  }

  // ── Offcanvas state ───────────────────────────────────────
  function syncOffcanvas(isReg) {
    var guestMenu = $('guestMenu');
    var userMenu  = $('userMenu');
    if (!guestMenu || !userMenu) return;
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
    console.log('[App] onLogin fired, sex:', Auth.getSex());
    if (window.MapModule) {
      window.MapModule.refreshMarkers();
      setTimeout(function() { window.MapModule && window.MapModule.refreshMarkers(); }, 1000);
    }
  };

  Auth.onLogout = function () {
    applyAuthState(false);
    window.MapModule && window.MapModule.refreshMarkers();
    var prot = [BASE + '/messages', BASE + '/favourites', BASE + '/profile'];
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

    // Delete account
    var deleteBtn = $('deleteAccountBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var oc = bootstrap.Offcanvas.getInstance($('appMenu'));
        if (oc) oc.hide();
        new bootstrap.Modal($('deleteConfirmModal')).show();
      });
    }

    var confirmDeleteBtn = $('confirmDeleteBtn');
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', async function () {
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

      var avatarEl = $('pinAvatar');
      if (avatarEl) avatarEl.className = 'pin-avatar ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
      var iconEl = $('pinAvatarIcon');
      if (iconEl) iconEl.textContent = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';
      if ($('pinNickname')) $('pinNickname').textContent = nickname || 'Anonymous';
      if ($('pinAge'))      $('pinAge').textContent      = age ? age + ' yrs' : '—';
      if ($('pinSex'))      $('pinSex').textContent      = sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—';

      if (targetIsReg && userId && !age) {
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
        if (msgLink) msgLink.href = BASE + '/messages/thread/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

        var favBtn   = $('pinFavBtn');
        var favIcon  = $('pinFavIcon');
        var favLabel = $('pinFavLabel');
        if (favBtn) {
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
                alert(err.message);
              } finally {
                favBtn.disabled = false;
              }
            };
          }).catch(function() { /* ignore */ });
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
    var api   = window.BOOMBOOM_API_URL || '';
    var base  = api.replace(/^https?:\/\//, 'wss://').replace(/\/api\/?$/, '');
    var token = window.Auth?.getToken?.() || '';
    return base + '/ws/location?token=' + encodeURIComponent(token);
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
      console.log('[Geo] WS connected');
      var pos = window.GeoState.pos;
      if (pos) sendLocWS(pos.lat, pos.lng, window.GeoState.accuracy);
    };

    _locWs.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'nearby') {
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
      console.log('[Geo] WS closed, retrying in', _locWsRetry + 'ms');
    };
  }

  function closeLocWS() {
    if (_locWsTimer) { clearTimeout(_locWsTimer); _locWsTimer = null; }
    if (_locWs) { _locWs.onclose = null; _locWs.close(); _locWs = null; }
  }

  // ── Location push — WS first, HTTP fallback ───────────────

  async function pushLocation(lat, lng, accuracy) {
    if (!window.Auth?.getToken()) return;
    if (sendLocWS(lat, lng, accuracy)) return;
    try {
      await window.Api.putLocation(lat, lng, accuracy || 'gps');
    } catch (e) {
      console.warn('[Geo] HTTP location push failed:', e.message);
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
          console.log('[Geo] IP location from', services[i].url);
          window.GeoState.accuracy = 'ip';
          dispatchPosition(lat, lon);
          setStatus('approximate location', 'live');
          pushLocation(lat, lon, 'ip');
          return;
        }
      } catch (e) {
        console.warn('[Geo] IP fallback failed for', services[i].url, e.message);
      }
    }
    console.warn('[Geo] All IP fallbacks failed');
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
        console.log('[Geo] Low-accuracy fix:', Math.round(acc) + 'm');
        onPosition(pos, acc < 5000);
        navigator.geolocation.watchPosition(
          function (pos) { onPosition(pos, true); },
          function (err) { console.warn('[Geo] watchPosition error:', err.code, err.message); },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
      },
      function (err) {
        console.warn('[Geo] Low-accuracy failed:', err.code, err.message);
        navigator.geolocation.getCurrentPosition(
          function (pos) { onPosition(pos, true); },
          function (err2) {
            console.warn('[Geo] High-accuracy failed:', err2.code, err2.message, '— falling back to IP');
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
    console.log('[Geo] Auth ready, starting geolocation');
    connectLocWS();
    startWatch();
  });

  // ── Auth hooks ────────────────────────────────────────────

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    // Reconnect WS with fresh user token (guest token no longer valid)
    closeLocWS();
    connectLocWS();
    var pos = window.GeoState.pos;
    if (pos) {
      window.Api.deleteLocation().catch(function() {});
      pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    closeLocWS();
    window.Api.deleteLocation().catch(function() {});
    if (_origOnLogout) _origOnLogout();
  };

  var _origOnGuestExpired = Auth.onGuestExpired;
  Auth.onGuestExpired = function () {
    if (_origOnGuestExpired) _origOnGuestExpired();
    closeLocWS();
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
      if (el) _modal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });
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
    console.log('[Lock] Session locked.');
  }

  // ── Unlock ────────────────────────────────────────────────

  function unlock() {
    _locked = false;
    resetInactivityTimer();
    var modal = getModal();
    if (modal) modal.hide();
    window.dispatchEvent(new CustomEvent('bbm:unlocked'));
    console.log('[Lock] Session unlocked.');
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
        if (document.hidden) { console.log('[Lock] Tab hidden too long — locking.'); lock(); }
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
        var keys = await window.Api.getMyKeys();
        if (keys.encryptedPrivateKey && keys.publicKey) {
          var ok = await window.BBMCrypto.unlock(keys.encryptedPrivateKey, password, keys.publicKey);
          if (!ok) throw new Error('Wrong password.');
        } else {
          // No keys on server yet (legacy account) — generate and save now
          var setup = await window.BBMCrypto.setup(password);
          await window.Api.saveKeys(setup.publicKeyB64, setup.encBlob);
        }
        if (pwInput) pwInput.value = '';
        unlock();
      } catch (e) {
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
      var modal = getModal();
      if (modal) modal.hide();
      _locked = false;
      window.Auth.logout();
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