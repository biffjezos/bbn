// ============================================================
// bOOmbOOm.NOW! — app.js
// Auth state → UI · Navbar · Offcanvas · Pin modal · Map FAB
// ============================================================

(async function () {

  // ── Helpers ──────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function $(id) { return document.getElementById(id); }

  // ── Status badge ─────────────────────────────────────────
  function setStatus(text, state /* 'live'|'locating'|'off' */) {
    const dot  = $('statusDot');
    const span = $('statusText');
    if (dot)  { dot.className  = 'bbm-status-dot' + (state ? ' ' + state : ''); }
    if (span) { span.textContent = text; }
  }

  // ── Desktop nav links (rebuilt on auth change) ───────────
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
      el.innerHTML = `
        <a href="/messages/"   class="nav-link ${location.pathname.startsWith('/messages/')  ? 'active' : ''}">
          <i class="bi bi-chat-dots me-1"></i>Messages
        </a>
        <a href="/favourites/" class="nav-link ${location.pathname.startsWith('/favourites/') ? 'active' : ''}">
          <i class="bi bi-star me-1"></i>Favourites
        </a>
        <a href="/profile/"    class="nav-link ${location.pathname.startsWith('/profile/')    ? 'active' : ''}">
          <i class="bi bi-person-circle me-1"></i>Profile
        </a>`;
    }
  }

  // ── Offcanvas menu state ──────────────────────────────────
  function syncOffcanvas(isReg) {
    const guestMenu = $('guestMenu');
    const userMenu  = $('userMenu');
    if (!guestMenu || !userMenu) return;

    if (isReg) {
      guestMenu.classList.add('d-none');
      userMenu.classList.remove('d-none');
      const nickEl = $('menuNickname');
      if (nickEl) nickEl.textContent = Auth.getProfile().nickname || '—';
    } else {
      guestMenu.classList.remove('d-none');
      userMenu.classList.add('d-none');
    }
  }

  // ── Auth callbacks ────────────────────────────────────────
  function onLogin() {
    buildDesktopNav(true);
    syncOffcanvas(true);
    $('guestCountdown')?.classList.add('d-none');
    window.MapModule?.refreshMarkers();
  }

  function onLogout() {
    buildDesktopNav(false);
    syncOffcanvas(false);
    // Redirect away from protected pages
    const prot = ['/messages', '/favourites', '/profile'];
    if (prot.some(p => location.pathname.startsWith(p))) {
      window.location.href = '/';
    }
  }

  // ── Offcanvas action buttons ──────────────────────────────
  $('logoutBtn')?.addEventListener('click', async () => {
    const bs = bootstrap.Offcanvas.getInstance($('appMenu'));
    bs?.hide();
    await Auth.logout();
    onLogout();
  });

  $('deleteAccountBtn')?.addEventListener('click', () => {
    const bs = bootstrap.Offcanvas.getInstance($('appMenu'));
    bs?.hide();
    const modal = new bootstrap.Modal($('deleteConfirmModal'));
    modal.show();
  });

  $('confirmDeleteBtn')?.addEventListener('click', async () => {
    try {
      await Api.deleteAccount();
      Auth.logout();
      bootstrap.Modal.getInstance($('deleteConfirmModal'))?.hide();
      window.location.href = '/';
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // ── Login modal ───────────────────────────────────────────
  $('loginSubmitBtn')?.addEventListener('click', async () => {
    const email    = $('loginEmail')?.value.trim();
    const password = $('loginPassword')?.value;
    const errEl    = $('loginError');
    errEl?.classList.add('d-none');

    try {
      await Auth.login(email, password);
      bootstrap.Modal.getInstance($('loginModal'))?.hide();
      onLogin();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
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

    try {
      await Auth.register({ email, nickname, password, age, sex });
      bootstrap.Modal.getInstance($('registerModal'))?.hide();
      onLogin();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
    }
  });

  // ── Pin modal ─────────────────────────────────────────────
  // Populated by map.js via openPinModal(user)
  window.openPinModal = function (user) {
    const { userId, nickname, age, sex, distanceM, isRegistered: isReg } = user;

    const avatarEl   = $('pinAvatar');
    const iconEl     = $('pinAvatarIcon');
    const nameEl     = $('pinNickname');
    const ageEl      = $('pinAge');
    const sexEl      = $('pinSex');
    const distEl     = $('pinDist');
    const actionsEl  = $('pinActions');
    const guestEl    = $('pinGuestPrompt');
    const profileLink = $('pinProfileLink');

    if (avatarEl) {
      avatarEl.className = 'pin-avatar ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');
    }
    if (iconEl)     iconEl.textContent  = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👤';
    if (nameEl)     nameEl.textContent  = nickname || 'Anonymous';
    if (ageEl)      ageEl.textContent   = age ? `${age} yrs` : '—';
    if (sexEl)      sexEl.textContent   = sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—';
    if (distEl)     distEl.textContent  = distanceM != null
      ? distanceM < 1000 ? `${Math.round(distanceM)}m away` : `${(distanceM / 1000).toFixed(1)}km away`
      : '';

    // Show actions or guest prompt
    const viewerIsReg = Auth.isRegistered();

    if (actionsEl) actionsEl.classList.toggle('d-none', !viewerIsReg || !isReg);
    if (guestEl)   guestEl.classList.toggle('d-none', viewerIsReg);

    if (viewerIsReg && isReg && profileLink && userId) {
      profileLink.href = `/profile/view/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(nickname || '')}`;
    }

    new bootstrap.Modal($('pinModal')).show();
  };

  // ── FAB — centre map on my location ──────────────────────
  $('fabCentre')?.addEventListener('click', () => {
    window.MapModule?.centreOnSelf();
  });

  // ── Guest countdown ───────────────────────────────────────
  function startGuestCountdown(seconds) {
    const wrap  = $('guestCountdown');
    const timer = $('countdownTimer');
    if (!wrap || !timer) return;
    if (Auth.isRegistered()) return;

    wrap.classList.remove('d-none');
    let remaining = seconds;

    const iv = setInterval(() => {
      remaining--;
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      timer.textContent = `${m}:${s}`;

      if (remaining <= 0) {
        clearInterval(iv);
        timer.textContent = '00:00';
        window.MapModule?.onGuestExpired();
      }
    }, 1000);
  }

  // ── Init ──────────────────────────────────────────────────
  const isReg = Auth.isRegistered();
  buildDesktopNav(isReg);
  syncOffcanvas(isReg);

  if (isReg) {
    setStatus('live', 'locating');
  } else {
    setStatus('guest', 'off');
  }

  // Expose startGuestCountdown so map.js can call it
  window.startGuestCountdown = startGuestCountdown;

  // Signal page-specific modules
  document.dispatchEvent(new Event('bbm:ready'));

})();
