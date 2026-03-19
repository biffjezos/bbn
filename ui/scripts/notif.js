// ============================================================
// NotifModule — favourite notifications
// Polls GET /api/notifications on login and every 30 s.
// Shows dismissable banners below the navbar and a dot badge
// on the hamburger menu icon.
// ============================================================
(function () {

  var POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 min — notifications are low-urgency
  var _pollTimer = null;
  var _paused = false;

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function sexPronoun(sex) {
    return sex === 'f' ? 'her' : sex === 'm' ? 'his' : 'their';
  }

  function showBanners(notifications) {
    var container = document.getElementById('notifBanner');
    var dot        = document.getElementById('notifDot');
    if (!container) return;

    if (!notifications || notifications.length === 0) {
      container.innerHTML = '';
      if (dot) dot.classList.add('d-none');
      return;
    }

    if (dot) dot.classList.remove('d-none');

    container.innerHTML = notifications.map(function (n) {
      var body = n.alreadyFav
        ? '<strong>' + esc(n.fromNickname) + '</strong> added you to ' + sexPronoun(n.fromSex) + ' favourites.'
        : '<strong>' + esc(n.fromNickname) + '</strong> added you to ' + sexPronoun(n.fromSex) + ' favourites. ' +
          '<a href="#" class="alert-link fav-back-link">Add them back</a> to start chatting!';
      return '<div class="alert alert-info alert-dismissible d-flex align-items-center gap-2 mb-0 rounded-0" role="alert" data-notif-id="' + esc(n.id) + '" data-from-user-id="' + esc(n.fromUserId) + '" style="border-left:none;border-right:none;border-top:none">' +
        '<i class="bi bi-star-fill flex-shrink-0"></i>' +
        '<span>' + body + '</span>' +
        '<button type="button" class="btn-close ms-auto flex-shrink-0" aria-label="Dismiss"></button>' +
        '</div>';
    }).join('');

    function dismiss(alertEl) {
      if (!alertEl) return;
      var id = alertEl.dataset.notifId;
      alertEl.remove();
      if (window.Api) window.Api.dismissNotification(id).catch(function () {});
      if (container.querySelectorAll('[data-notif-id]').length === 0) {
        if (dot) dot.classList.add('d-none');
      }
    }

    container.querySelectorAll('.btn-close').forEach(function (btn) {
      btn.addEventListener('click', function () { dismiss(btn.closest('[data-notif-id]')); });
    });

    container.querySelectorAll('.fav-back-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var alertEl    = link.closest('[data-notif-id]');
        var fromUserId = alertEl && alertEl.dataset.fromUserId;
        dismiss(alertEl);
        var dest = (window.BOOMBOOM_BASE || '') + '/favourites/';
        if (fromUserId && window.Api) {
          window.Api.addFavourite(fromUserId).catch(function () {}).finally(function () {
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
    window.Api && window.Api.getNotifications().then(function (data) {
      showBanners(data.notifications || []);
    }).catch(function (e) {
      if (DEBUG) console.warn('[Notif] poll failed:', e.message);
    });
  }

  function startNotifPoll() {
    stopNotifPoll();
    pollNotifications();
    _pollTimer = setInterval(pollNotifications, POLL_INTERVAL_MS);
  }

  document.addEventListener('visibilitychange', function () {
    _paused = document.hidden;
    // Poll immediately when user returns to the tab
    if (!document.hidden && _pollTimer) pollNotifications();
  });

  function stopNotifPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    showBanners([]);
  }

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    startNotifPoll();
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    if (_origOnLogout) _origOnLogout();
    stopNotifPoll();
  };

  // On page load with an already-valid token
  window.__authReady && window.__authReady.then(function () {
    if (window.Auth && window.Auth.isRegistered()) startNotifPoll();
  });

})();
