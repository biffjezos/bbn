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
// bOOmbOOm.NOW! — app.js
// Wires Auth hooks → UI, navbar, offcanvas, modals, FAB
// auth.js owns all token + guest session logic.
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

  // ── Desktop nav links ─────────────────────────────────────
  function buildDesktopNav(isReg) {
    const el = $('navLinksDesktop');
    if (!el) return;
    const p = location.pathname;
    if (!isReg) {
      el.innerHTML = `
        <button class="btn btn-bbm-ghost btn-sm"
          data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>
        <button class="btn btn-bbm-primary btn-sm"
          data-bs-toggle="modal" data-bs-target="#registerModal">Sign Up</button>`;
    } else {
      el.innerHTML = `
        <a href="/messages/"   class="nav-link ${p.startsWith('/messages/')  ? 'active' : ''}">
          <i class="bi bi-chat-dots me-1"></i>Messages</a>
        <a href="/favourites/" class="nav-link ${p.startsWith('/favourites/') ? 'active' : ''}">
          <i class="bi bi-star me-1"></i>Favourites</a>
        <a href="/profile/"    class="nav-link ${p.startsWith('/profile/')    ? 'active' : ''}">
          <i class="bi bi-person-circle me-1"></i>Profile</a>`;
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
        const profile = Auth.getProfile();
        nickEl.textContent = profile.nickname || '—';
        const color = profile.sex === 'f' ? 'var(--bbm-pink-light)'
                    : profile.sex === 'm' ? 'var(--bbm-blue-light)'
                    : 'var(--bbm-text)';
        nickEl.style.cssText = `-webkit-text-fill-color:${color};color:${color};background:none`;
      }
    } else {
      guestMenu.classList.remove('d-none');
      userMenu.classList.add('d-none');
    }
  }

  // ── Apply auth state ──────────────────────────────────────
  function applyAuthState(isReg) {
    buildDesktopNav(isReg);
    syncOffcanvas(isReg);
    // Don't touch status here — map.js owns it on the map page
  }

  // ── Auth hooks — set BEFORE Auth.init() ──────────────────
  Auth.onLogin = function () {
    applyAuthState(true);
    // Immediately update self marker icon to sex-specific emoji
    window.MapModule?.refreshMarkers();
  };

  Auth.onLogout = function () {
    applyAuthState(false);
    // Revert self marker to guest (yellow fist)
    window.MapModule?.refreshMarkers();
    const prot = ['/messages', '/favourites', '/profile'];
    if (prot.some(p => location.pathname.startsWith(p))) window.location.href = '/';
  };

  Auth.onGuestReady   = function () { /* map.js owns the status bar */ };
  Auth.onGuestExpired = function () {
    setStatus('session expired', 'off');
    window.MapModule?.onGuestExpired();
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

  // ── Pin modal — populated by map.js ──────────────────────
  window.openPinModal = function (user) {
    const { userId, nickname, age, sex, distanceM, isRegistered: targetIsReg } = user;

    const avatarEl = $('pinAvatar');
    if (avatarEl) avatarEl.className = 'pin-avatar ' + (sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'guest');

    const iconEl = $('pinAvatarIcon');
    if (iconEl) iconEl.textContent = sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';

    if ($('pinNickname')) $('pinNickname').textContent = nickname || 'Anonymous';
    if ($('pinAge'))      $('pinAge').textContent      = age ? `${age} yrs` : '—';
    if ($('pinSex'))      $('pinSex').textContent      = sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—';
    if ($('pinDist'))     $('pinDist').textContent     = distanceM != null
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

  // ── Init ─────────────────────────────────────────────────
  // Auth.init() was already called in the layout (window.__authReady).
  // Just await it here to ensure it has resolved before we build the UI.
  await window.__authReady;

  // Sync UI to whatever state Auth.init() resolved to
  applyAuthState(Auth.isRegistered());

  // Signal page modules — auth state is stable
  window.__bbmReady = true;
  document.dispatchEvent(new Event('bbm:ready'));

})();