// ============================================================
// bOOmbOOm.NOW! — app.js
// Wires Auth hooks, navbar, offcanvas, modals, map FAB
// ============================================================

(async function () {

  // ── Helpers ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Status badge ─────────────────────────────────────────
  function setStatus(text, state) {
    const dot  = $('statusDot');
    const span = $('statusText');
    if (dot)  dot.className    = 'bbm-status-dot' + (state ? ' ' + state : '');
    if (span) span.textContent = text;
  }

  // ── Desktop nav links ────────────────────────────────────
  function buildDesktopNav(isReg) {
    const el = $('navLinksDesktop');
    if (!el) return;
    if (!isReg) {
      el.innerHTML = `
        <button class="btn btn-bbm-ghost btn-sm"
          data-bs-toggle="modal" data-bs-target="#loginModal">
          Log In
        </button>
        <button class="btn btn-bbm-primary btn-sm"
          data-bs-toggle="modal" data-bs-target="#registerModal">
          Sign Up
        </button>`;
    } else {
      const p = location.pathname;
      el.innerHTML = `
        <a href="/messages/"   class="nav-link ${p.startsWith('/messages/')  ? 'active' : ''}">
          <i class="bi bi-chat-dots me-1"></i>Messages
        </a>
        <a href="/favourites/" class="nav-link ${p.startsWith('/favourites/') ? 'active' : ''}">
          <i class="bi bi-star me-1"></i>Favourites
        </a>
        <a href="/profile/"    class="nav-link ${p.startsWith('/profile/')    ? 'active' : ''}">
          <i class="bi bi-person-circle me-1"></i>Profile
        </a>`;
    }
  }

  // ── Offcanvas state ───────────────────────────────────────
  function syncOffcanvas(isReg) {
    const guestMenu = $('guestMenu');
    const userMenu  = $('userMenu');
    if (!guestMenu || !userMenu) return;
    if (isReg) {
      guestMenu.classList.add('d-none');
      userMenu.classList.remove('d-none');
      const nickEl = $('menuNickname');
      if (nickEl) nickEl.textContent = Auth.getProfile?.()?.nickname || '—';
    } else {
      guestMenu.classList.remove('d-none');
      userMenu.classList.add('d-none');
    }
  }

  // ── Apply auth state to the whole UI ─────────────────────
  function applyAuthState(isReg) {
    buildDesktopNav(isReg);
    syncOffcanvas(isReg);
    if (isReg) {
      $('guestCountdown')?.classList.add('d-none');
      setStatus('live', 'locating');
    } else {
      setStatus('guest', 'off');
    }
  }

  // ── Auth hook callbacks (called by Auth internally) ───────
  // Auth.onLogin is invoked by auth.js after token is stored
  Auth.onLogin = function (data) {
    applyAuthState(true);
    window.MapModule?.refreshMarkers();
  };

  // Auth.onLogout is invoked by auth.js after token is cleared
  Auth.onLogout = function () {
    applyAuthState(false);
    // Redirect away from protected pages
    const prot = ['/messages', '/favourites', '/profile'];
    if (prot.some(p => location.pathname.startsWith(p))) {
      window.location.href = '/';
    }
  };

  // Guest session hooks (called by auth.js / map.js)
  Auth.onGuestReady   = function () { /* map polling handled by map.js */ };
  Auth.onGuestExpired = function () { window.MapModule?.onGuestExpired(); };

  // ── Login modal ───────────────────────────────────────────
  $('loginSubmitBtn')?.addEventListener('click', async () => {
    const email    = $('loginEmail')?.value.trim();
    const password = $('loginPassword')?.value;
    const errEl    = $('loginError');
    errEl?.classList.add('d-none');

    if (!email || !password) {
      if (errEl) { errEl.textContent = 'Please enter your email and password.'; errEl.classList.remove('d-none'); }
      return;
    }

    const btn = $('loginSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Logging in…';

    try {
      await Auth.login({ email, password });
      // Auth.onLogin callback fires inside Auth.login after token stored —
      // we just close the modal here.
      bootstrap.Modal.getInstance($('loginModal'))?.hide();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  // Enter key in login form
  [$('loginEmail'), $('loginPassword')].forEach(el => {
    el?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('loginSubmitBtn')?.click();
    });
  });

  // ── Register modal ────────────────────────────────────────
  $('regSubmitBtn')?.addEventListener('click', async () => {
    const email    = $('regEmail')?.value.trim();
    const nickname = $('regNickname')?.value.trim();
    const password = $('regPassword')?.value;
    const age      = parseInt($('regAge')?.value, 10);
    const sex      = $('regSex')?.value;
    const errEl    = $('registerError');
    errEl?.classList.add('d-none');

    if (!email || !nickname || !password || !age || !sex) {
      if (errEl) { errEl.textContent = 'All fields are required.'; errEl.classList.remove('d-none'); }
      return;
    }
    if (nickname.length < 2) {
      if (errEl) { errEl.textContent = 'Nickname must be at least 2 characters.'; errEl.classList.remove('d-none'); }
      return;
    }

    const btn = $('regSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Creating account…';

    try {
      await Auth.register({ email, nickname, password, age, sex });
      bootstrap.Modal.getInstance($('registerModal'))?.hide();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });

  // ── Offcanvas action buttons ──────────────────────────────
  $('logoutBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance($('appMenu'))?.hide();
    Auth.logout();
    // Auth.onLogout fires inside Auth.logout
  });

  $('deleteAccountBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance($('appMenu'))?.hide();
    new bootstrap.Modal($('deleteConfirmModal')).show();
  });

  $('confirmDeleteBtn')?.addEventListener('click', async () => {
    try {
      await Auth.deleteAccount();
      bootstrap.Modal.getInstance($('deleteConfirmModal'))?.hide();
      // Auth.onLogout will fire and redirect
    } catch (err) {
      alert('Error deleting account: ' + err.message);
    }
  });

  // ── Pin modal — populated by map.js ──────────────────────
  window.openPinModal = function (user) {
    const { userId, nickname, age, sex, distanceM, isRegistered: targetIsReg } = user;

    const avatarEl    = $('pinAvatar');
    const iconEl      = $('pinAvatarIcon');
    const nameEl      = $('pinNickname');
    const ageEl       = $('pinAge');
    const sexEl       = $('pinSex');
    const distEl      = $('pinDist');
    const actionsEl   = $('pinActions');
    const guestEl     = $('pinGuestPrompt');
    const profileLink = $('pinProfileLink');

    if (avatarEl) {
      avatarEl.className = 'pin-avatar ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
    }
    if (iconEl)  iconEl.textContent = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';
    if (nameEl)  nameEl.textContent = nickname || 'Anonymous';
    if (ageEl)   ageEl.textContent  = age ? `${age} yrs` : '—';
    if (sexEl)   sexEl.textContent  = sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—';
    if (distEl)  distEl.textContent = distanceM != null
      ? distanceM < 1000 ? `${Math.round(distanceM)}m away` : `${(distanceM / 1000).toFixed(1)}km away`
      : '';

    const viewerIsReg = Auth.isRegistered();
    if (actionsEl) actionsEl.classList.toggle('d-none', !viewerIsReg || !targetIsReg);
    if (guestEl)   guestEl.classList.toggle('d-none', viewerIsReg);

    if (viewerIsReg && targetIsReg && profileLink && userId) {
      profileLink.href = `/profile/view/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(nickname || '')}`;
    }

    new bootstrap.Modal($('pinModal')).show();
  };

  // ── FAB — centre map ──────────────────────────────────────
  $('fabCentre')?.addEventListener('click', () => {
    window.MapModule?.centreOnSelf();
  });

  // ── Guest countdown ───────────────────────────────────────
  window.startGuestCountdown = function (seconds) {
    const wrap  = $('guestCountdown');
    const timer = $('countdownTimer');
    if (!wrap || !timer || Auth.isRegistered()) return;

    wrap.classList.remove('d-none');
    let remaining = seconds;

    const iv = setInterval(() => {
      remaining--;
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      timer.textContent = `${m}:${s}`;
      if (remaining <= 0) {
        clearInterval(iv);
        window.MapModule?.onGuestExpired();
      }
    }, 1000);
  };

  // ── Init ─────────────────────────────────────────────────
  // Auth.init() restores token from localStorage and fires
  // onLogin or onGuestReady as appropriate. We MUST await it
  // before building UI or dispatching bbm:ready.
  await Auth.init();

  // Apply whatever state Auth.init() restored
  applyAuthState(Auth.isRegistered());

  // Signal page-specific modules that auth is ready.
  // Set flag first so any listener that registers late can still check it.
  window.__bbmReady = true;
  document.dispatchEvent(new Event('bbm:ready'));

})();