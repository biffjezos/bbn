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
        '<a href="/messages/"   class="nav-link ' + (p.startsWith('/messages/')   ? 'active' : '') + '"><i class="bi bi-chat-dots me-1"></i>Messages</a>' +
        '<a href="/favourites/" class="nav-link ' + (p.startsWith('/favourites/') ? 'active' : '') + '"><i class="bi bi-star me-1"></i>Favourites</a>' +
        '<a href="/profile/"    class="nav-link ' + (p.startsWith('/profile/')    ? 'active' : '') + '"><i class="bi bi-person-circle me-1"></i>Profile</a>';
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
    var prot = ['/messages', '/favourites', '/profile'];
    if (prot.some(function(p) { return location.pathname.startsWith(p); })) {
      window.location.href = '/';
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
        if (profileLink) profileLink.href = '/profile/view/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

        var msgLink = $('pinMessageLink');
        if (msgLink) msgLink.href = '/messages/thread/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

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
// ============================================================
(function () {

  var PUSH_INTERVAL_MS  = 30000;
  var pushTimer         = null;

  window.GeoState = { pos: null, accuracy: null };

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

  async function pushLocation(lat, lng, accuracy) {
    if (!window.Auth?.getToken()) return;
    try {
      await window.Api.putLocation(lat, lng, accuracy || 'gps');
      console.log('[Geo] Location pushed:', lat, lng, accuracy || 'gps');
    } catch (e) {
      console.warn('[Geo] Location push failed:', e.message);
    }
  }

  function startPushTimer() {
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(function () {
      var pos = window.GeoState.pos;
      if (pos) pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }, PUSH_INTERVAL_MS);
  }

  function onPosition(pos, accurate) {
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var accuracy = 'gps';
    window.GeoState.accuracy = accuracy;
    dispatchPosition(lat, lng);
    setStatus(accurate ? 'live' : 'approximate location', 'live');
    pushLocation(lat, lng, accuracy);
    startPushTimer();
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
          startPushTimer();
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

  window.__authReady.then(function () {
    console.log('[Geo] Auth ready, starting geolocation');
    startWatch();
  });

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    var pos = window.GeoState.pos;
    if (pos) {
      window.Api.deleteLocation().catch(function() {});
      pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    window.Api.deleteLocation().catch(function() {});
    if (_origOnLogout) _origOnLogout();
  };

  var _origOnGuestExpired = Auth.onGuestExpired;
  Auth.onGuestExpired = function () {
    if (_origOnGuestExpired) _origOnGuestExpired();
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    setStatus('session expired', 'off');
    window.MapModule && window.MapModule.onGuestExpired();
  };

})();

// ============================================================
// LockModule — inactivity lock for registered users
//
// Lock triggers:
//   • Tab hidden for > HIDE_LOCK_MS (30s) — switching apps/browser
//   • No user interaction for > INACTIVITY_LOCK_MS (3 min)
//
// NOT a lock trigger:
//   • Navigation between pages within the same site
//   • Page load / reload (keys rehydrated lazily on demand)
//
// Keys are wiped from memory on lock. Re-entering password
// re-derives them from the encrypted server blob without
// a full re-login (US7).
//
// requireUnlocked() is the single gate used by pages that
// need crypto. It shows the modal only if keys are actually
// locked (US6 — shown once per lock event, not per page).
// ============================================================
(function () {

  // ── Timers ────────────────────────────────────────────────
  var INACTIVITY_LOCK_MS = 3 * 60 * 1000;   // US5: 3 minutes of no interaction
  var HIDE_LOCK_MS       = 30 * 1000;        // US4: 30 seconds hidden / backgrounded

  var _inactivityTimer = null;
  var _hiddenTimer     = null;
  var _modal           = null;

  // _locked tracks whether keys have been explicitly locked.
  // It starts false — a fresh login or a page navigation within
  // the site does NOT set this to true.
  var _locked = false;

  // ── Modal ─────────────────────────────────────────────────
  function getModal() {
    if (!_modal) {
      var el = document.getElementById('lockModal');
      if (el) _modal = new bootstrap.Modal(el, { backdrop: 'static', keyboard: false });
    }
    return _modal;
  }

  // ── Lock ─────────────────────────────────────────────────
  function lock() {
    if (!window.Auth.isRegistered()) return;
    if (_locked) return;
    _locked = true;
    clearInactivityTimer();
    window.BBMCrypto?.lock();
    console.log('[Lock] Session locked.');
    // Modal is shown lazily by requireUnlocked() when the user
    // actually tries to access a protected feature (US3, US6).
  }

  // ── Unlock ────────────────────────────────────────────────
  function unlock() {
    _locked = false;
    resetInactivityTimer();
    var modal = getModal();
    if (modal) modal.hide();
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

  // Reset on any real user interaction (US5)
  ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      if (!_locked) resetInactivityTimer();
    }, { passive: true });
  });

  // ── Visibility / focus — tab switch / app backgrounded ────
  // Only lock if hidden for longer than HIDE_LOCK_MS (US4).
  // This tolerates rapid tab switching within the same browser
  // session but catches genuine app-switch / phone-lock events.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      // Start the hide timer
      _hiddenTimer = setTimeout(function () {
        if (document.hidden) {
          console.log('[Lock] Tab hidden too long — locking.');
          lock();
        }
      }, HIDE_LOCK_MS);
    } else {
      // Tab came back — cancel any pending hide-lock
      if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
      // If not locked, reset the inactivity timer
      if (!_locked) resetInactivityTimer();
    }
  });

  // ── Unlock button (modal-lock.html) ──────────────────────
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
        var ok   = await window.BBMCrypto.unlock(keys.encryptedPrivateKey, password, keys.publicKey);
        if (!ok) throw new Error('Wrong password.');
        if (pwInput) pwInput.value = '';
        unlock();
      } catch (e) {
        showError(e.message || 'Unlock failed.');
      } finally {
        if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.innerHTML = '<i class="bi bi-unlock me-2"></i>Unlock'; }
      }
    }

    unlockBtn?.addEventListener('click', tryUnlock);
    pwInput?.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });

    logoutBtn?.addEventListener('click', function () {
      if (pwInput) pwInput.value = '';
      clearError();
      var modal = getModal();
      if (modal) modal.hide();
      _locked = false;
      window.Auth.logout();
    });
  });

  // ── requireUnlocked() — single gate for all crypto actions ─
  // Returns true immediately if keys are available.
  // If locked, shows the modal and returns false.
  // The caller should bail out and re-attempt after the modal
  // fires its 'hidden' event (pages already do this). (US6)
  window.requireUnlocked = function () {
    if (window.BBMCrypto?.isUnlocked()) {
      // Keys are live — ensure _locked is consistent
      _locked = false;
      return true;
    }
    // Keys are gone — need password
    _locked = true;
    var modal = getModal();
    if (modal) {
      var descEl = document.querySelector('#lockModal .modal-body p');
      if (descEl) descEl.textContent = 'Enter your password to continue.';
      modal.show();
    }
    return false;
  };

  // ── Auth lifecycle hooks ──────────────────────────────────

  // onLogin: fresh login — keys are already unlocked by Auth.login().
  // Start the inactivity timer. Do NOT show the lock modal. (US1, US2)
  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    _locked = false;
    resetInactivityTimer();
  };

  // onNeedsUnlock: page loaded with a saved token (no password available).
  // Keys cannot be recovered without the password. Mark as locked silently.
  // The modal will appear lazily when requireUnlocked() is called. (US3)
  Auth.onNeedsUnlock = function () {
    if (window.BBMCrypto?.isUnlocked()) {
      // Shouldn't normally happen on page load, but handle gracefully
      _locked = false;
      resetInactivityTimer();
    } else {
      _locked = true;
      // Do NOT show modal here — wait until the user visits a crypto feature
    }
  };

  // onLogout: stop all timers, clear state. (US8)
  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    if (_origOnLogout) _origOnLogout();
    clearInactivityTimer();
    if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
    _locked = false;
  };

})();
