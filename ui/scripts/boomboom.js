// Import required modules
import { Api } from './lib/api.js';
import { Auth } from './lib/auth.js';
import { promptBlock } from './lib/blocks.js';
import { initDebugConsole } from './lib/debugConsole.js';
import { renderFavourites, initSearchBar } from './lib/favourites.js';
import { GeoState, initGeo, pushLocation, connectLocWS, closeLocWS } from './lib/geo.js';
import { lock, unlock, initUnlockButton, requireUnlocked } from './lib/lock.js';
import { MapModule } from './lib/map.js';
import * as Messages from './lib/messages.js';
import { initNotifications } from './lib/notifications.js';
import { OpaqueClient } from './lib/opaque-client.js';
import { bbnPrefs } from './lib/prefs.js';
import { initPWAInstall } from './lib/pwa-install.js';
import { initSettings } from './lib/settings.js';
import { warmUpBackend } from './lib/warmup.js';

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/bbn/service-worker.js', { scope: '/bbn/' })
    .catch(err => console.error('SW registration failed:', err));
}

// PWA Install handling
let deferredPrompt;

const _isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent) && !window.MSStream;
const _isFirefox = /firefox/i.test(navigator.userAgent);
const _isMobile = /android|ipad|iphone|ipod/i.test(navigator.userAgent);
const _isStandalone = window.matchMedia('(display-mode: standalone)').matches
                 || window.navigator.standalone === true;

function _activateInstallBtn() {
  const btn = document.getElementById('installBtn');
  const fallback = document.getElementById('installFallback');
  if (btn) btn.disabled = false;
  if (fallback) fallback.style.display = 'none';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  _activateInstallBtn();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const sec = document.getElementById('installSection');
  if (sec) sec.style.display = 'none';
});

window.addEventListener('DOMContentLoaded', () => {
  if (_isStandalone) return;

  if (_isIOS) {
    const hint = document.getElementById('iosInstallHint');
    if (hint) hint.style.display = '';
  } else if (_isFirefox && _isMobile) {
    const ffHint = document.getElementById('firefoxInstallHint');
    if (ffHint) ffHint.style.display = '';
  } else if (_isMobile) {
    const sec = document.getElementById('installSection');
    if (sec) sec.style.display = '';
    if (deferredPrompt) _activateInstallBtn();
  }

  const btn = document.getElementById('installBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      const sec = document.getElementById('installSection');
      if (sec) sec.style.display = 'none';
    });
  }
});

// Debug Console Initialization
initDebugConsole();

// Initialize Geo and Location
initGeo();
GeoState.pushLocation = pushLocation;
GeoState.connectLocWS = connectLocWS;
GeoState.closeLocWS = closeLocWS;

// Initialize Map Module
const mapModule = new MapModule();

// Initialize Favourites and Search Bar
renderFavourites();
initSearchBar();

// Initialize Notifications System
initNotifications();

// Initialize PWA Install
initPWAInstall();

// Initialize Lock/Unlock System
initUnlockButton();

// Initialize Settings
initSettings();

// Warm-up Backend
warmUpBackend();

// Wire up UI elements after DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {

  const $ = (id) => document.getElementById(id);

  // Show rate limit banner
  function showRateLimitBanner() {
    const container = $('notifBanner');
    if (!container) return;
    if (container.querySelector('.bbm-rate-limit-banner')) return;

    const div = document.createElement('div');
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

  // Build desktop nav links
  function buildDesktopNav(isReg) {
    const el = $('navLinksDesktop');
    if (!el) return;
    const p = location.pathname;
    const BASE = window.BOOMBOOM_BASE;

    if (!isReg) {
      el.innerHTML =
        '<button class="btn btn-bbm-ghost btn-sm" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>' +
        '<button class="btn btn-bbm-primary btn-sm" data-bs-toggle="modal" data-bs-target="#registerModal">Sign Up</button>';
    } else {
      el.innerHTML =
        `<a href="${BASE}/messages/" class="nav-link ${p.startsWith(BASE + '/messages/') ? 'active' : ''}">
          <i class="bi bi-chat-dots me-1"></i>Messages</a>
        <a href="${BASE}/favourites/" class="nav-link ${p.startsWith(BASE + '/favourites/') ? 'active' : ''}">
          <i class="bi bi-star me-1"></i>Favourites</a>
        <a href="${BASE}/profile/" class="nav-link ${p.startsWith(BASE + '/profile/') ? 'active' : ''}">
          <i class="bi bi-person-circle me-1"></i>Profile</a>`;
    }
  }

  // Sync offcanvas navigation state
  function syncOffcanvas(isReg) {
    const guestMenu = $('guestMenu');
    const userMenu = $('userMenu');
    const adminLink = $('adminNavLink');
    if (!guestMenu || !userMenu) return;

    if (adminLink) adminLink.classList.toggle('d-none', !(isReg && getRole() === 'admin'));
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
        nickEl.style.cssText = `-webkit-text-fill-color:${color}; color:${color}; background:none`;
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

  // Auth hooks
  Auth.onLogin = function () {
    applyAuthState(true);
    if (DEBUG) console.log('[App] onLogin fired, sex:', Auth.getSex());
    if (window.MapModule) {
      window.MapModule.refreshMarkers();
      window.MapModule.refreshRadius();
      setTimeout(() => window.MapModule && window.MapModule.refreshMarkers(), 1000);
    }
  };

  Auth.onLogout = function () {
    applyAuthState(false);
    window.MapModule && window.MapModule.refreshMarkers();
    const prot = [BASE + '/messages', BASE + '/favourites', BASE + '/profile', BASE + '/admin', BASE + '/settings'];
    if (prot.some(p => location.pathname.startsWith(p))) {
      window.location.href = BASE + '/';
    }
  };

  Auth.onRateLimited = function () { showRateLimitBanner(); };

  window.__authReady = Auth.init();

  // Wire UI interactions after DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    // Login Modal
    const loginBtn = $('loginSubmitBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', async function () {
        const email = $('loginEmail') ? $('loginEmail').value.trim() : '';
        const password = $('loginPassword') ? $('loginPassword').value : '';
        const errEl = $('loginError');
        if (errEl) errEl.classList.add('d-none');

        if (!email || !password) {
          if (errEl) { errEl.textContent = 'Please enter your email and password.'; err