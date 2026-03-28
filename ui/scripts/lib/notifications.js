// ./lib/notifications.js

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 min — notifications are low-urgency
let _pollTimer = null;
let _paused = false;

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sexPronoun(sex) {
  return sex === 'f' ? 'her' : sex === 'm' ? 'his' : 'their';
}

function showBanners(notifications) {
  const container = document.getElementById('notifBanner');
  const dot = document.getElementById('notifDot');
  if (!container) return;

  if (!notifications || notifications.length === 0) {
    container.innerHTML = '';
    if (dot) dot.classList.add('d-none');
    return;
  }

  if (dot) dot.classList.remove('d-none');

  container.innerHTML = notifications.map((n) => {
    const body = n.alreadyFav
      ? `<strong>${esc(n.fromNickname)}</strong> added you to ${sexPronoun(n.fromSex)} favourites.`
      : `<strong>${esc(n.fromNickname)}</strong> added you to ${sexPronoun(n.fromSex)} favourites. 
         <a href="#" class="alert-link fav-back-link">Add them back</a> to start chatting!`;
    return `<div class="alert alert-info alert-dismissible d-flex align-items-center gap-2 mb-0 rounded-0" role="alert" data-notif-id="${esc(n.id)}" data-from-user-id="${esc(n.fromUserId)}" style="border-left:none;border-right:none;border-top:none">
        <i class="bi bi-star-fill flex-shrink-0"></i>
        <span>${body}</span>
        <button type="button" class="btn-close ms-auto flex-shrink-0" aria-label="Dismiss"></button>
      </div>`;
  }).join('');

  function dismiss(alertEl) {
    if (!alertEl) return;
    const id = alertEl.dataset.notifId;
    alertEl.remove();
    if (window.Api) window.Api.dismissNotification(id).catch(() => {});
    if (container.querySelectorAll('[data-notif-id]').length === 0) {
      if (dot) dot.classList.add('d-none');
    }
  }

  container.querySelectorAll('.btn-close').forEach((btn) => {
    btn.addEventListener('click', () => dismiss(btn.closest('[data-notif-id]')));
  });

  container.querySelectorAll('.fav-back-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const alertEl = link.closest('[data-notif-id]');
      const fromUserId = alertEl && alertEl.dataset.fromUserId;
      dismiss(alertEl);
      const dest = `${window.BOOMBOOM_BASE || ''}/favourites/`;
      if (fromUserId && window.Api) {
        window.Api.addFavourite(fromUserId).catch(() => {}).finally(() => {
          window.location.href = dest;
        });
      } else {
        window.location.href = dest;
      }
    });
  });
}

function pollNotifications() {
  if (_paused) return;
  if (!window.Auth || !window.Auth.isRegistered()) return;
  window.Api && window.Api.getNotifications()
    .then((data) => {
      showBanners(data.notifications || []);
    })
    .catch((e) => {
      if (DEBUG) console.warn('[Notif] poll failed:', e.message);
    });
}

function startNotifPoll() {
  stopNotifPoll();
  pollNotifications();
  _pollTimer = setInterval(pollNotifications, POLL_INTERVAL_MS);
}

function stopNotifPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  showBanners([]);
}

function initNotifications() {
  if (window.Auth && typeof window.Auth.onLogin === 'function') {
    const _origOnLogin = window.Auth.onLogin;
    window.Auth.onLogin = (data) => {
      if (_origOnLogin) _origOnLogin(data);
      startNotifPoll();
    };

    const _origOnLogout = window.Auth.onLogout;
    window.Auth.onLogout = () => {
      if (_origOnLogout) _origOnLogout();
      stopNotifPoll();
    };

    // On page load with an already-valid token
    window.__authReady && window.__authReady.then(() => {
      if (window.Auth && window.Auth.isRegistered()) startNotifPoll();
    });
  } else {
    console.error('Auth is not initialized or missing onLogin handler');
  }

  document.addEventListener('visibilitychange', () => {
    _paused = document.hidden;
    // Poll immediately when user returns to the tab
    if (!document.hidden && _pollTimer) pollNotifications();
  });
}

export { initNotifications };