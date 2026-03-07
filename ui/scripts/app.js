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
    // map.js owns the status bar
  }

  // ── Auth hooks — set NOW, before Auth.init() runs ─────────
  Auth.onLogin = function () {
    applyAuthState(true);
    console.log('[App] onLogin fired, sex:', Auth.getSex());
    if (window.MapModule) {
      window.MapModule.refreshMarkers();
      // Retry after 1s in case map wasn't ready on first call
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

      // Fetch age from profile if not in nearby data (age isn't in JWT/location doc)
      if (targetIsReg && userId && !age) {
        window.Api.getProfile(userId).then(function(profile) {
          if (profile.age && $('pinAge')) $('pinAge').textContent = profile.age + ' yrs';
        }).catch(function() {});
      }
      if ($('pinDist'))     $('pinDist').textContent     = distanceM != null
        ? (distanceM < 1000 ? Math.round(distanceM) + 'm away' : (distanceM / 1000).toFixed(1) + 'km away')
        : '';

      // Accuracy badge
      var accWrap = $('pinAccuracyWrap');
      if (accWrap) accWrap.classList.toggle('d-none', accuracy !== 'ip');

      var viewerIsReg = Auth.isRegistered();
      var pinActions  = $('pinActions');
      var pinGuest    = $('pinGuestPrompt');
      if (pinActions) pinActions.classList.toggle('d-none', !viewerIsReg || !targetIsReg);
      if (pinGuest)   pinGuest.classList.toggle('d-none', viewerIsReg);

      if (viewerIsReg && targetIsReg && userId) {
        // Profile link
        var profileLink = $('pinProfileLink');
        if (profileLink) profileLink.href = '/profile/view/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

        // Message link
        var msgLink = $('pinMessageLink');
        if (msgLink) msgLink.href = '/messages/thread/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');

        // Favourites button
        var favBtn   = $('pinFavBtn');
        var favIcon  = $('pinFavIcon');
        var favLabel = $('pinFavLabel');
        if (favBtn) {
          // Reset state
          favBtn.disabled = false;
          if (favIcon)  { favIcon.className  = 'bi bi-star me-2'; }
          if (favLabel) { favLabel.textContent = 'Add to Favourites'; }

          // Check if already favourited
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

  var PUSH_INTERVAL_MS  = 30000;  // push location every 30s even if not moved
  var pushTimer         = null;
  var lastPushedPos     = null;

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
      lastPushedPos = { lat: lat, lng: lng };
      console.log('[Geo] Location pushed:', lat, lng, accuracy || 'gps');
    } catch (e) {
      console.warn('[Geo] Location push failed:', e.message);
    }
  }

  function startPushTimer(lat, lng, accuracy) {
    if (pushTimer) clearInterval(pushTimer);
    pushTimer = setInterval(function () {
      var pos = window.GeoState.pos;
      if (pos) pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }, PUSH_INTERVAL_MS);
  }

  function onPosition(pos, accurate) {
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    var accuracy = accurate ? 'gps' : 'gps';  // still gps, just lower accuracy
    window.GeoState.accuracy = accuracy;
    dispatchPosition(lat, lng);
    setStatus(accurate ? 'live' : 'approximate location', 'live');
    pushLocation(lat, lng, accuracy);
    startPushTimer();
  }

  async function tryIpFallback() {
    setStatus('locating…', 'locating');
    try {
      var r    = await fetch('https://ipapi.co/json/');
      var data = await r.json();
      if (data.latitude && data.longitude) {
        console.log('[Geo] IP location:', data.city, data.country_name);
        window.GeoState.accuracy = 'ip';
        dispatchPosition(data.latitude, data.longitude);
        setStatus('approximate location', 'live');
        pushLocation(data.latitude, data.longitude, 'ip');
        startPushTimer();
      } else {
        throw new Error('No coordinates in IP response');
      }
    } catch (e) {
      console.warn('[Geo] IP fallback failed:', e.message);
      setStatus('location unavailable', 'off');
    }
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
          function () { /* GPS not available — low accuracy is enough */ },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
      },
      function () {
        navigator.geolocation.getCurrentPosition(
          function (pos) { onPosition(pos, true); },
          function () { tryIpFallback(); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
    );
  }

  // Start after auth is ready — need a token to push location
  window.__authReady.then(function () {
    console.log('[Geo] Auth ready, starting geolocation');
    startWatch();
  });

  // On login: delete the guest location doc, then immediately push as the new user
  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    var pos = window.GeoState.pos;
    if (pos) {
      // Delete guest doc first (auth-service already cleaned up the guest session,
      // but the location doc is keyed by guestId which is a different token sub)
      window.Api.deleteLocation().catch(function() {});
      // Push immediately as the now-logged-in user
      pushLocation(pos.lat, pos.lng, window.GeoState.accuracy);
    }
  };

  // On logout: delete the user location doc immediately, guest session will push its own
  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    // Delete while we still have the user token (auth.js clears it after this hook)
    window.Api.deleteLocation().catch(function() {});
    if (_origOnLogout) _origOnLogout();
  };

  // Stop pushing on guest expired
  var _origOnGuestExpired = Auth.onGuestExpired;
  Auth.onGuestExpired = function () {
    if (_origOnGuestExpired) _origOnGuestExpired();
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    setStatus('session expired', 'off');
    window.MapModule && window.MapModule.onGuestExpired();
  };

})();
