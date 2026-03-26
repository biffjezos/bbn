// ============================================================
// bOOmbOOm.NOW! — app.js  (plain script, NOT a module)
// Runs synchronously after auth.js loads.
// Sets Auth hooks, then triggers Auth.init().
// Also wires modals, offcanvas, FAB after DOMContentLoaded.
// ============================================================


  // <<<< mobile app
// ============================================================
// bOOmbOOm.NOW! — app.js
// ============================================================

// ------------------ Service Worker ------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bbn/service-worker.js', { scope: '/bbn/' })
    .catch(err => console.error('SW registration failed:', err));
}

// ------------------ PWA Install ------------------
let deferredPrompt;

var _isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
var _isInStandalone = window.matchMedia('(display-mode: standalone)').matches
                   || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const sec = document.getElementById('installSection');
  if (sec) sec.style.display = '';
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const sec = document.getElementById('installSection');
  if (sec) sec.style.display = 'none';
});

window.addEventListener('DOMContentLoaded', () => {
  // iOS: show manual instructions if not already installed
  if (_isIOS && !_isInStandalone) {
    const hint = document.getElementById('iosInstallHint');
    if (hint) hint.style.display = '';
  }

  const btn = document.getElementById('installBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      const sec = document.getElementById('installSection');
      if (sec) sec.style.display = 'none';
    });
  }
});

// >>> mobile app  

(function () {
  function $(id) { return document.getElementById(id); }

  function showRateLimitBanner() {
    var container = $('notifBanner');
    if (!container) return;
    if (container.querySelector('.bbm-rate-limit-banner')) return;
    var div = document.createElement('div');
    div.className = 'alert alert-warning alert-dismissible d-flex align-items-center gap-2 mb-0 rounded-0 bbm-rate-limit-banner';
    div.setAttribute('role', 'alert');
    div.style.cssText = 'border-left:none;border-right:none;border-top:none';
    div.innerHTML =
      '<i class="bi bi-exclamation-triangle-fill flex-shrink-0"></i>' +
      '<span>You\'ve been rate-limited. Help keep bOOmbOOm.NOW! growing: ' +
      '<a href="' + (window.BOOMBOOM_BASE || '') + '/donate/" class="alert-link">Support us &#x2665;</a></span>' +
      '<button type="button" class="btn-close ms-auto flex-shrink-0" aria-label="Dismiss"></button>';
    div.querySelector('.btn-close').addEventListener('click', function () { div.remove(); });
    container.appendChild(div);
  }

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
    var prot = [BASE + '/messages', BASE + '/favourites', BASE + '/profile', BASE + '/admin', BASE + '/settings'];
    if (prot.some(function(p) { return location.pathname.startsWith(p); })) {
      window.location.href = BASE + '/';
    }
  };

  Auth.onGuestReady   = function () { /* status owned by GeoModule */ };
  Auth.onGuestExpired = function () { /* handled by GeoModule */ };
  Auth.onRateLimited  = function () { showRateLimitBanner(); };

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
          if (err.status === 429) showRateLimitBanner();
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

    // Clear login credentials whenever the modal closes (any path: success, dismiss, Escape)
    var loginModal = $('loginModal');
    if (loginModal) {
      loginModal.addEventListener('hidden.bs.modal', function () {
        var emailEl = $('loginEmail');
        var pwEl    = $('loginPassword');
        var errEl   = $('loginError');
        if (emailEl) emailEl.value = '';
        if (pwEl)    pwEl.value    = '';
        if (errEl)   errEl.classList.add('d-none');
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
          if (err.status === 429) showRateLimitBanner();
          if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
        } finally {
          regBtn.disabled = false;
          regBtn.textContent = 'Create Account';
        }
      });
    }

    // Clear register credentials whenever the modal closes
    var registerModal = $('registerModal');
    if (registerModal) {
      registerModal.addEventListener('hidden.bs.modal', function () {
        ['regEmail', 'regNickname', 'regPassword', 'regAge', 'regSex'].forEach(function(id) {
          var el = $(id);
          if (el) el.value = '';
        });
        var errEl = $('registerError');
        if (errEl) errEl.classList.add('d-none');
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
