// ============================================================
// bOOmbOOm.NOW! — app.js
// ============================================================

(async function () {

  function $(id) { return document.getElementById(id); }

  // ── Status badge ─────────────────────────────────────────
  function setStatus(text, state) {
    const dot  = $('statusDot');
    const span = $('statusText');
    if (dot)  dot.className    = 'bbm-status-dot' + (state ? ' ' + state : '');
    if (span) span.textContent = text;
  }

  // ── Read JWT payload directly (Auth.getProfile may not exist) ──
  function getJwtPayload() {
    try {
      const token = window.Auth?.getToken?.();
      if (!token) return null;
      return JSON.parse(atob(token.split('.')[1]));
    } catch { return null; }
  }

  function getNickname() {
    return window.Auth?.getProfile?.()?.nickname
      || getJwtPayload()?.nickname
      || null;
  }

  function getSex() {
    return window.Auth?.getProfile?.()?.sex
      || getJwtPayload()?.sex
      || null;
  }

  // ── Desktop nav links ─────────────────────────────────────
  function buildDesktopNav(isReg) {
    const el = $('navLinksDesktop');
    if (!el) return;
    const p = location.pathname;
    if (!isReg) {
      el.innerHTML = `
        <button class="btn btn-bbm-ghost btn-sm" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>
        <button class="btn btn-bbm-primary btn-sm" data-bs-toggle="modal" data-bs-target="#registerModal">Sign Up</button>`;
    } else {
      el.innerHTML = `
        <a href="/messages/"   class="nav-link ${p.startsWith('/messages/')  ? 'active' : ''}"><i class="bi bi-chat-dots me-1"></i>Messages</a>
        <a href="/favourites/" class="nav-link ${p.startsWith('/favourites/') ? 'active' : ''}"><i class="bi bi-star me-1"></i>Favourites</a>
        <a href="/profile/"    class="nav-link ${p.startsWith('/profile/')    ? 'active' : ''}"><i class="bi bi-person-circle me-1"></i>Profile</a>`;
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
      if (nickEl) {
        const nick = getNickname() || '—';
        const sex  = getSex();
        const color = sex === 'f' ? 'var(--bbm-pink-light)' : sex === 'm' ? 'var(--bbm-blue-light)' : 'var(--bbm-text)';
        nickEl.textContent = nick;
        nickEl.style.cssText = `-webkit-text-fill-color: ${color}; color: ${color}; background: none;`;
      }
    } else {
      guestMenu.classList.remove('d-none');
      userMenu.classList.add('d-none');
    }
  }

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

  // ── Auth hook callbacks ───────────────────────────────────
  Auth.onLogin = function () {
    applyAuthState(true);
    window.MapModule?.refreshMarkers();
  };

  Auth.onLogout = function () {
    applyAuthState(false);
    const prot = ['/messages', '/favourites', '/profile'];
    if (prot.some(p => location.pathname.startsWith(p))) window.location.href = '/';
  };

  Auth.onGuestReady   = function (data) {
    // data may contain expiresIn (ms) from the guest token response
    // Calculate session start from JWT exp claim for accuracy across reloads
    startGuestSession();
  };
  Auth.onGuestExpired = function () { window.MapModule?.onGuestExpired(); };

  // ── Guest session with persistent countdown ───────────────
  // We persist guestId + session start in sessionStorage so that
  // page reloads resume the countdown rather than restarting it.
  // After GUEST_TTL_SEC the token itself expires (server rejects it),
  // so the guest can't push/fetch locations regardless.
  const GUEST_TTL_SEC = 15 * 60;
  const CLEANUP_AFTER_SEC = 60 * 60; // 1 hour — then guest can start fresh

  function startGuestSession() {
    const now = Date.now();

    // Prefer JWT exp claim — it's the authoritative expiry from the server
    // Falls back to sessionStorage-tracked start time
    let remainingSec = 0;
    try {
      const token = window.Auth?.getToken?.();
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp) {
          remainingSec = payload.exp - Math.floor(now / 1000);
        }
      }
    } catch { /* ignore */ }

    if (!remainingSec || remainingSec <= 0) {
      // JWT expired or unreadable — check if within cleanup window
      const storedStart = parseInt(sessionStorage.getItem('bbm_guest_start') || '0', 10);
      if (storedStart && (now - storedStart) < CLEANUP_AFTER_SEC * 1000) {
        // Session expired but not yet past cleanup window — show expired
        window.MapModule?.onGuestExpired();
        setStatus('session expired — come back later', 'off');
        return;
      }
      // Past cleanup window or no session — allow fresh start on next visit
      sessionStorage.removeItem('bbm_guest_start');
      return;
    }

    // Store start time (used to detect expired sessions on reload)
    if (!sessionStorage.getItem('bbm_guest_start')) {
      sessionStorage.setItem('bbm_guest_start', String(now - (GUEST_TTL_SEC - remainingSec) * 1000));
    }

    startGuestCountdown(remainingSec);
  }

  // ── Countdown timer ───────────────────────────────────────
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
        setStatus('session expired', 'off');
        // Clear session after 1h so they can start fresh next visit
        setTimeout(() => sessionStorage.removeItem('bbm_guest_start'), (CLEANUP_AFTER_SEC - GUEST_TTL_SEC) * 1000);
      }
    }, 1000);
  };

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
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Logging in…';

    try {
      await Auth.login({ email, password });
      bootstrap.Modal.getInstance($('loginModal'))?.hide();
      // Auth.onLogin fires inside Auth.login after token is stored
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log In';
    }
  });

  [$('loginEmail'), $('loginPassword')].forEach(el => {
    el?.addEventListener('keydown', e => { if (e.key === 'Enter') $('loginSubmitBtn')?.click(); });
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
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating account…';

    try {
      await Auth.register({ email, nickname, password, age, sex });
      bootstrap.Modal.getInstance($('registerModal'))?.hide();
      // Auth.onLogin fires inside Auth.register after token is stored
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });

  // ── Offcanvas buttons ─────────────────────────────────────
  $('logoutBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance($('appMenu'))?.hide();
    Auth.logout();
  });

  $('deleteAccountBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance($('appMenu'))?.hide();
    new bootstrap.Modal($('deleteConfirmModal')).show();
  });

  $('confirmDeleteBtn')?.addEventListener('click', async () => {
    try {
      await Auth.deleteAccount();
      bootstrap.Modal.getInstance($('deleteConfirmModal'))?.hide();
    } catch (err) {
      alert('Error deleting account: ' + err.message);
    }
  });

  // ── Pin modal ─────────────────────────────────────────────
  window.openPinModal = function (user) {
    const { userId, nickname, age, sex, distanceM, isRegistered: targetIsReg } = user;

    const avatarEl    = $('pinAvatar');
    const iconEl      = $('pinAvatarIcon');

    if (avatarEl) avatarEl.className = 'pin-avatar ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
    if (iconEl)   iconEl.textContent = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';

    const nameEl = $('pinNickname');
    const ageEl  = $('pinAge');
    const sexEl  = $('pinSex');
    const distEl = $('pinDist');

    if (nameEl) nameEl.textContent = nickname || 'Anonymous';
    if (ageEl)  ageEl.textContent  = age ? `${age} yrs` : '—';
    if (sexEl)  sexEl.textContent  = sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—';
    if (distEl) distEl.textContent = distanceM != null
      ? distanceM < 1000 ? `${Math.round(distanceM)}m away` : `${(distanceM / 1000).toFixed(1)}km away`
      : '';

    const viewerIsReg = Auth.isRegistered();
    $('pinActions')?.classList.toggle('d-none', !viewerIsReg || !targetIsReg);
    $('pinGuestPrompt')?.classList.toggle('d-none', viewerIsReg);

    const profileLink = $('pinProfileLink');
    if (viewerIsReg && targetIsReg && profileLink && userId) {
      profileLink.href = `/profile/view/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(nickname || '')}`;
    }

    new bootstrap.Modal($('pinModal')).show();
  };

  // ── FAB ───────────────────────────────────────────────────
  $('fabCentre')?.addEventListener('click', () => window.MapModule?.centreOnSelf());

  // ── Init — await Auth.init() so token is restored first ──
  await Auth.init();
  applyAuthState(Auth.isRegistered());

  // If guest, start/resume the session countdown
  if (!Auth.isRegistered()) startGuestSession();

  window.__bbmReady = true;
  document.dispatchEvent(new Event('bbm:ready'));

})();