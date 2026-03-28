// boomboom.js
// ============================================================
// bOOmbOOm.NOW! — app.js (ES6 modular, cleaned & fixed)
// ============================================================

// ------------------ Imports ------------------
import { Api } from './lib/api.js';
import { Auth } from './lib/auth.js';
import { promptBlock } from './lib/blocks.js';
import { BBNCrypto } from './lib/crypto.js';
import { initDebugConsole } from './lib/debug.js';
import { renderFavourites, initSearchBar } from './lib/favourites.js';
import { GeoState, initGeo, pushLocation, connectLocWS, closeLocWS } from './lib/geo.js';
import { initUnlockButton } from './lib/lock.js';
import { MapModule } from './lib/map.js';
import * as Messages from './lib/messages.js';
import { initNotifications } from './lib/notifications.js';
import { PWAInstall } from './lib/pwa-install.js';
import { initSettings } from './lib/settings.js';
import { warmUpBackend } from './lib/warmup.js';

// ------------------ Constants ------------------
const BASE = window.BOOMBOOM_BASE || '';
const $ = (id) => document.getElementById(id);

// ------------------ Helpers ------------------
function getRole() {
  try {
    const t = Auth.getToken();
    return t ? JSON.parse(atob(t.split('.')[1])).role : null;
  } catch {
    return null;
  }
}

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
    `<a href="${BASE}/donate/" class="alert-link">Support us &#x2665;</a></span>` +
    '<button type="button" class="btn-close ms-auto flex-shrink-0"></button>';

  div.querySelector('.btn-close').onclick = () => div.remove();
  container.appendChild(div);
}

// ------------------ UI State ------------------
function buildDesktopNav(isReg) {
  const el = $('navLinksDesktop');
  if (!el) return;

  const p = location.pathname;

  if (!isReg) {
    el.innerHTML =
      '<button class="btn btn-bbm-ghost btn-sm" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>' +
      '<button class="btn btn-bbm-primary btn-sm" data-bs-toggle="modal" data-bs-target="#registerModal">Sign Up</button>';
  } else {
    el.innerHTML = `
      <a href="${BASE}/messages/" class="nav-link ${p.startsWith(BASE + '/messages/') ? 'active' : ''}">
        <i class="bi bi-chat-dots me-1"></i>Messages</a>
      <a href="${BASE}/favourites/" class="nav-link ${p.startsWith(BASE + '/favourites/') ? 'active' : ''}">
        <i class="bi bi-star me-1"></i>Favourites</a>
      <a href="${BASE}/profile/" class="nav-link ${p.startsWith(BASE + '/profile/') ? 'active' : ''}">
        <i class="bi bi-person-circle me-1"></i>Profile</a>
    `;
  }
}

function syncOffcanvas(isReg) {
  const guestMenu = $('guestMenu');
  const userMenu = $('userMenu');
  const adminLink = $('adminNavLink');

  if (!guestMenu || !userMenu) return;

  if (adminLink) {
    adminLink.classList.toggle('d-none', !(isReg && getRole() === 'admin'));
  }

  if (isReg) {
    guestMenu.classList.add('d-none');
    userMenu.classList.remove('d-none');

    const nickEl = $('menuNickname');
    if (nickEl) {
      const profile = Auth.getProfile();
      nickEl.textContent = profile.nickname || '—';

      const color =
        profile.sex === 'f' ? 'var(--bbm-pink-light)' :
        profile.sex === 'm' ? 'var(--bbm-blue-light)' :
        'var(--bbm-text)';

      nickEl.style.cssText = `-webkit-text-fill-color:${color}; color:${color}`;
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

// ------------------ Auth Hooks ------------------
function wireAuth(mapModule) {
  Auth.onLogin = () => {
    applyAuthState(true);

    if (window.DEBUG) {
      console.log('[App] onLogin fired, sex:', Auth.getSex());
    }

    mapModule.refreshMarkers();
    mapModule.refreshRadius();
    setTimeout(() => mapModule.refreshMarkers(), 1000);
  };

  Auth.onLogout = () => {
    applyAuthState(false);
    mapModule.refreshMarkers();

    const prot = [
      BASE + '/messages',
      BASE + '/favourites',
      BASE + '/profile',
      BASE + '/admin',
      BASE + '/settings'
    ];

    if (prot.some(p => location.pathname.startsWith(p))) {
      window.location.href = BASE + '/';
    }
  };

  Auth.onRateLimited = showRateLimitBanner;

  // optional (handled elsewhere but kept safe)
  Auth.onGuestReady = () => {};
  Auth.onGuestExpired = () => {};
}

// ------------------ UI Wiring ------------------
function wireUI(mapModule) {

  // FAB
  const fab = $('fabCentre');
  if (fab) {
    fab.addEventListener('click', () => mapModule.centreOnSelf());
  }

  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      bootstrap.Offcanvas.getInstance($('appMenu'))?.hide();
      Auth.logout();
    };
  }
  
  // Handle message links
  const msgLink = $('pinMessageLink');
  if (msgLink) {
    const userId = 'USER_ID';  // Replace with actual user ID
    const nickname = 'NICKNAME';  // Replace with actual nickname
    msgLink.href = BASE + '/messages/thread/?uid=' + encodeURIComponent(userId) + '&name=' + encodeURIComponent(nickname || '');
    msgLink.classList.add('d-none');
    
    // Check if the user can receive messages
    window.Api.getProfile(userId).then(function(profile) {
      if (profile.canReceiveMessages === false) return;

      // Check for mutual favourites
      window.Api.isMutualFavourite(userId).then(function(data) {
        if (data.mutual) {
          msgLink.classList.remove('d-none');
        }
      }).catch(function() {});
    }).catch(function() {});
  }

}

// ------------------ Init App ------------------
async function initApp() {

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/bbn/' })
      .catch(err => console.error('SW registration failed:', err));
  }

  // Core systems
  initDebugConsole();

  initGeo();
  GeoState.pushLocation = pushLocation;
  GeoState.connectLocWS = connectLocWS;
  GeoState.closeLocWS = closeLocWS;

  const mapModule = new MapModule();

  // 👇 compatibility bridge (temporary but safe)
  window.MapModule = mapModule;

  renderFavourites();
  initSearchBar();
  initNotifications();
  PWAInstall.init(); 
  initUnlockButton();
  initSettings();
  warmUpBackend();

  // Auth wiring
  wireAuth(mapModule);

  // Init Auth
  window.__authReady = Auth.init();

  await window.__authReady;

  // Apply UI state AFTER auth is ready
  applyAuthState(Auth.isRegistered());

  // Wire UI last (DOM must exist)
  wireUI(mapModule);
}

// ------------------ Boot ------------------
document.addEventListener('DOMContentLoaded', initApp);