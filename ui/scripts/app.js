// ============================================================
// bOOmbOOm.NOW! — App Controller
// ============================================================

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

(async function () {

  // ============================================================
  // Helpers
  // ============================================================

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)   return 'just now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
    return Math.floor(diff/3600000) + 'h ago';
  }

  function timeUntil(iso) {
    var diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'expired';
    var h = Math.floor(diff / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? 'in ' + h + 'h ' + m + 'm' : 'in ' + m + 'm';
  }

  function getJwtSub() {
    try { return JSON.parse(atob(Auth.getToken().split('.')[1])).sub; } catch(e) { return null; }
  }

  function getModal(id) {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
  }

  function showError(elId, msg) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('d-none');
  }

  function hideError(elId) {
    var el = document.getElementById(elId);
    if (el) el.classList.add('d-none');
  }

  function showOverlay(html) {
    var overlay = document.getElementById('pageOverlay');
    if (window._threadTimer) { clearInterval(window._threadTimer); window._threadTimer = null; }
    overlay.innerHTML = html;
    overlay.classList.add('active');
    return overlay;
  }

  function hideOverlay() {
    if (window._threadTimer) { clearInterval(window._threadTimer); window._threadTimer = null; }
    var overlay = document.getElementById('pageOverlay');
    overlay.classList.remove('active');
    overlay.innerHTML = '';
  }

  // ============================================================
  // Auth event hooks
  // ============================================================

  Auth.onLogin = function(data) {
    document.getElementById('guestMenu').classList.add('d-none');
    document.getElementById('userMenu').classList.remove('d-none');
    document.getElementById('menuNickname').textContent = data.nickname;
    // Favourites available to all registered users
    var favLink = document.getElementById('navFavLink');
    if (favLink) favLink.classList.remove('d-none');
    MapModule.refreshSelfIcon();
    MapModule.startNearbyPoll();
  };

  Auth.onLogout = function() {
    document.getElementById('guestMenu').classList.remove('d-none');
    document.getElementById('userMenu').classList.add('d-none');
    document.getElementById('menuNickname').textContent = '—';
    var favLink = document.getElementById('navFavLink');
    if (favLink) favLink.classList.add('d-none');
    MapModule.refreshSelfIcon();
    hideOverlay();
  };

  Auth.onGuestReady   = function() { MapModule.startNearbyPoll(); };
  Auth.onGuestExpired = function() { MapModule.stopNearbyPoll(); };

  // ============================================================
  // Register
  // ============================================================

  document.getElementById('regSubmitBtn').addEventListener('click', async function() {
    hideError('registerError');
    var email    = document.getElementById('regEmail').value.trim();
    var nickname = document.getElementById('regNickname').value.trim();
    var password = document.getElementById('regPassword').value;
    var age      = parseInt(document.getElementById('regAge').value, 10);
    var sex      = document.getElementById('regSex').value;

    if (!email || !nickname || !password || !age || !sex)
      return showError('registerError', 'All fields are required.');
    if (nickname.length < 2)
      return showError('registerError', 'Nickname must be at least 2 characters.');

    try {
      await Auth.register({ email, nickname, password, age, sex });
      getModal('registerModal').hide();
    } catch (err) {
      showError('registerError', err.message);
    }
  });

  // ============================================================
  // Login
  // ============================================================

  document.getElementById('loginSubmitBtn').addEventListener('click', async function() {
    hideError('loginError');
    var email    = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;

    if (!email || !password)
      return showError('loginError', 'Email and password are required.');

    try {
      await Auth.login({ email, password });
      getModal('loginModal').hide();
    } catch (err) {
      showError('loginError', err.message);
    }
  });

  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') document.getElementById('loginSubmitBtn').click();
  });

  // ============================================================
  // Logout + Delete account
  // ============================================================

  document.getElementById('logoutBtn').addEventListener('click', function() {
    var oc = bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'));
    if (oc) oc.hide();
    Auth.logout();
  });

  document.getElementById('deleteAccountBtn').addEventListener('click', function() {
    var oc = bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'));
    if (oc) oc.hide();
    getModal('deleteConfirmModal').show();
  });

  document.getElementById('confirmDeleteBtn').addEventListener('click', async function() {
    try {
      await Auth.deleteAccount();
      getModal('deleteConfirmModal').hide();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // ============================================================
  // Menu nav links
  // ============================================================

  document.getElementById('navProfileLink').addEventListener('click', function(e) {
    e.preventDefault();
    var oc = bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'));
    if (oc) oc.hide();
    renderProfilePage();
  });

  document.getElementById('navConvLink').addEventListener('click', function(e) {
    e.preventDefault();
    var oc = bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'));
    if (oc) oc.hide();
    renderConversationList();
  });

  document.getElementById('navFavLink').addEventListener('click', function(e) {
    e.preventDefault();
    var oc = bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'));
    if (oc) oc.hide();
    renderFavourites();
  });

  // ============================================================
  // Map pin click — show user profile modal
  // ============================================================

  MapModule.onUserClick = async function(user) {
    var modal = getModal('profileModal');

    document.getElementById('profileModalTitle').textContent    = user.nickname || 'Anonymous';
    document.getElementById('profileModalNickname').textContent = user.nickname || '—';
    document.getElementById('profileModalAge').textContent      = '…';
    document.getElementById('profileModalDist').textContent     = user.distanceM + ' m';

    var sexIcons = { m: '👆', f: '👌' };
    document.getElementById('profileModalIcon').textContent =
      user.isRegistered ? (sexIcons[user.sex] || '👤') : '✊';

    var msgLink = document.getElementById('profileModalMsgLink');
    var favLink = document.getElementById('profileModalFavLink');
    msgLink.classList.add('d-none');
    favLink.classList.add('d-none');

    modal.show();

    if (user.isRegistered && user.userId) {
      try {
        var profile = await Api.getProfile(user.userId);
        document.getElementById('profileModalAge').textContent = profile.age || '—';

        if (Auth.isRegistered()) {
          // Message button — all registered users
          var newMsgLink = msgLink.cloneNode(true);
          msgLink.parentNode.replaceChild(newMsgLink, msgLink);
          newMsgLink.classList.remove('d-none');
          newMsgLink.addEventListener('click', function(e) {
            e.preventDefault();
            modal.hide();
            renderThread(user.userId, user.nickname || user.userId);
          });

          // Favourites button — all registered users
          var newFavLink = favLink.cloneNode(true);
          favLink.parentNode.replaceChild(newFavLink, favLink);
          newFavLink.classList.remove('d-none');
          newFavLink.addEventListener('click', async function(e) {
            e.preventDefault();
            try {
              await Api.addFavourite(user.userId);
              newFavLink.innerHTML = '<i class="bi bi-star-fill me-2"></i>Added to Favourites';
              newFavLink.classList.add('disabled');
            } catch (err) {
              if (err.status === 409) {
                newFavLink.innerHTML = '<i class="bi bi-star-fill me-2"></i>Already in Favourites';
                newFavLink.classList.add('disabled');
              } else {
                newFavLink.textContent = 'Error: ' + err.message;
              }
            }
          });
        }

      } catch(e) {
        document.getElementById('profileModalAge').textContent = '—';
      }
    } else {
      document.getElementById('profileModalAge').textContent = '—';
    }
  };

  // ============================================================
  // Profile page
  // ============================================================

  async function renderProfilePage() {
    if (!Auth.isRegistered()) {
      getModal('loginModal').show();
      return;
    }

    showOverlay(`
      <div class="container py-3" style="max-width:480px">
        <div class="d-flex align-items-center mb-4">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h4 class="mb-0 text-warning">My Profile</h4>
        </div>
        <div id="profileContent"><p class="text-secondary">Loading…</p></div>
      </div>`);

    document.getElementById('backBtn').addEventListener('click', hideOverlay);

    try {
      var me = await Api.getMe();

      document.getElementById('profileContent').innerHTML = `
        <div class="mb-3">
          <label class="form-label text-secondary small">Email</label>
          <input class="form-control bg-black text-light border-secondary"
            id="pEmail" type="email" value="${escHtml(me.email)}" autocomplete="email" />
        </div>
        <div class="mb-3">
          <label class="form-label text-secondary small">Nickname
            <span class="text-secondary fw-normal"> — display name, duplicates allowed</span>
          </label>
          <input class="form-control bg-black text-light border-secondary"
            id="pNickname" value="${escHtml(me.nickname)}" minlength="2" maxlength="32" />
        </div>
        <div class="mb-3">
          <label class="form-label text-secondary small">
            New Password
            <span class="text-secondary fw-normal"> — leave blank to keep current</span>
          </label>
          <input class="form-control bg-black text-light border-secondary"
            id="pPassword" type="password" autocomplete="new-password" placeholder="••••••••" />
        </div>
        <div class="row g-3 mb-4">
          <div class="col-6">
            <label class="form-label text-secondary small">Age</label>
            <input type="number" class="form-control bg-black text-light border-secondary"
              id="pAge" value="${me.age}" min="18" max="120" />
          </div>
          <div class="col-6">
            <label class="form-label text-secondary small">Sex</label>
            <select class="form-select bg-black text-light border-secondary" id="pSex">
              <option value="m" ${me.sex==='m'?'selected':''}>Male</option>
              <option value="f" ${me.sex==='f'?'selected':''}>Female</option>
            </select>
          </div>
        </div>
        <div id="profileMsg" class="d-none mb-3"></div>
        <button class="btn btn-warning w-100 mb-2" id="profileSaveBtn">Save Changes</button>`;

      document.getElementById('profileSaveBtn').addEventListener('click', async function() {
        var update = {
          nickname: document.getElementById('pNickname').value.trim(),
          age:      parseInt(document.getElementById('pAge').value, 10),
          sex:      document.getElementById('pSex').value,
          email:    document.getElementById('pEmail').value.trim(),
        };
        var pw = document.getElementById('pPassword').value;
        if (pw) update.password = pw;

        var msgEl = document.getElementById('profileMsg');
        try {
          await Api.updateMe(update);
          // Keep in-memory auth state in sync
          Auth.updateProfile({ nickname: update.nickname, sex: update.sex });
          msgEl.className = 'alert alert-success mb-3';
          msgEl.textContent = 'Saved!';
          msgEl.classList.remove('d-none');
          setTimeout(function(){ msgEl.classList.add('d-none'); }, 2500);
        } catch (err) {
          msgEl.className = 'alert alert-danger mb-3';
          msgEl.textContent = err.message;
          msgEl.classList.remove('d-none');
        }
      });

    } catch (err) {
      document.getElementById('profileContent').innerHTML =
        '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
    }
  }

  // ============================================================
  // Conversation list
  // ============================================================

  async function renderConversationList() {
    if (!Auth.isRegistered()) {
      getModal('loginModal').show();
      return;
    }

    showOverlay(`
      <div class="container py-3" style="max-width:580px">
        <div class="d-flex align-items-center mb-4">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h4 class="mb-0 text-warning">Conversations</h4>
        </div>
        <div id="convList"><p class="text-secondary">Loading…</p></div>
      </div>`);

    document.getElementById('backBtn').addEventListener('click', hideOverlay);

    try {
      var data = await Api.getConversations();
      var msgs = data.messages || [];

      if (msgs.length === 0) {
        document.getElementById('convList').innerHTML =
          '<p class="text-secondary">No active conversations yet.<br>Find someone on the map and tap their icon!</p>';
        return;
      }

      var myId = getJwtSub();

      // Group messages into threads by partner userId
      var threads = {};
      msgs.forEach(function(m) {
        var isOutgoing = m.fromUserId === myId;
        var partnerId  = isOutgoing ? m.toUserId : m.fromUserId;
        if (!threads[partnerId] || new Date(m.sentAt) > new Date(threads[partnerId].latest.sentAt)) {
          threads[partnerId] = { userId: partnerId, latest: m };
        }
      });

      // Resolve nicknames for all partner userIds from their public profiles
      var partnerIds = Object.keys(threads);
      var profileResults = await Promise.allSettled(
        partnerIds.map(function(uid) { return Api.getProfile(uid); })
      );
      partnerIds.forEach(function(uid, i) {
        var result = profileResults[i];
        threads[uid].nickname = (result.status === 'fulfilled' && result.value.nickname)
          ? result.value.nickname
          : uid;  // fall back to userId if profile fetch fails
      });

      var html = Object.values(threads).map(function(t) {
        return '<div class="conversation-card border-bottom border-secondary py-2 px-1" ' +
          'style="cursor:pointer" data-userid="' + escHtml(t.userId) +
          '" data-nickname="' + escHtml(t.nickname) + '">' +
          '<div class="d-flex justify-content-between align-items-center">' +
          '<strong>' + escHtml(t.nickname) + '</strong>' +
          '<small class="text-secondary">' + timeAgo(t.latest.sentAt) + '</small></div>' +
          '<div class="text-secondary text-truncate mt-1" style="font-size:0.85rem">' +
          escHtml(t.latest.text) + '</div></div>';
      }).join('');

      document.getElementById('convList').innerHTML = html;

      document.querySelectorAll('.conversation-card').forEach(function(card) {
        card.addEventListener('click', function() {
          renderThread(card.dataset.userid, card.dataset.nickname);
        });
      });

    } catch (err) {
      document.getElementById('convList').innerHTML =
        '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
    }
  }

  // ============================================================
  // Message thread  — userId for all API calls, displayName for header
  // ============================================================

  async function renderThread(userId, displayName) {
    if (!Auth.isRegistered()) {
      getModal('loginModal').show();
      return;
    }

    showOverlay(`
      <div class="container py-3 d-flex flex-column"
           style="max-width:580px;height:calc(100vh - 56px);overflow:hidden">
        <div class="d-flex align-items-center mb-3 flex-shrink-0">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h5 class="mb-0 text-warning">${escHtml(displayName)}</h5>
        </div>
        <div id="threadMsgs"
             class="flex-grow-1 d-flex flex-column gap-2 overflow-auto pb-2"
             style="min-height:0"></div>
        <div class="flex-shrink-0 pt-2 border-top border-secondary mt-2">
          <div class="d-flex gap-2 align-items-end">
            <div class="flex-grow-1">
              <textarea id="msgInput"
                class="form-control bg-black text-light border-secondary"
                rows="2" maxlength="144"
                placeholder="Say something… (144 chars, Ctrl+Enter to send)"></textarea>
              <div class="d-flex justify-content-between mt-1">
                <span id="sendError" class="text-danger small d-none"></span>
                <span id="charCount" class="ms-auto text-secondary"
                      style="font-size:0.72rem">144</span>
              </div>
            </div>
            <button class="btn btn-warning" id="sendBtn">
              <i class="bi bi-send"></i>
            </button>
          </div>
        </div>
      </div>`);

    document.getElementById('backBtn').addEventListener('click', renderConversationList);

    document.getElementById('msgInput').addEventListener('input', function() {
      var len     = this.value.length;
      var counter = document.getElementById('charCount');
      if (!counter) return;
      counter.textContent = 144 - len;
      counter.style.color = len > 144 ? '#f44336' : '#666';
    });

    document.getElementById('msgInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById('sendBtn').click();
      }
    });

    document.getElementById('sendBtn').addEventListener('click', async function() {
      var input = document.getElementById('msgInput');
      var text  = input ? input.value.trim() : '';
      if (!text) return;

      var errEl = document.getElementById('sendError');
      if (errEl) errEl.classList.add('d-none');

      try {
        await Api.sendMessage(userId, text);
        input.value = '';
        var counter = document.getElementById('charCount');
        if (counter) counter.textContent = '144';
        await loadMessages();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.classList.remove('d-none');
        }
      }
    });

    var myId = getJwtSub();

    async function loadMessages() {
      try {
        var data      = await Api.getConversation(userId);
        var msgs      = data.messages || [];
        var container = document.getElementById('threadMsgs');
        if (!container) return;

        container.innerHTML = msgs.length === 0
          ? '<p class="text-secondary text-center mt-4">No messages yet. Say hi!</p>'
          : msgs.map(function(m) {
              var outgoing = m.fromUserId === myId;
              return '<div class="d-flex ' + (outgoing ? 'justify-content-end' : 'justify-content-start') + '">' +
                '<div>' +
                '<div class="message-bubble ' + (outgoing ? 'outgoing' : 'incoming') + '">' +
                escHtml(m.text) + '</div>' +
                '<div class="message-expiry ' + (outgoing ? 'text-end' : '') + '">expires ' +
                timeUntil(m.expiresAt) + '</div>' +
                '</div></div>';
            }).join('');

        container.scrollTop = container.scrollHeight;
      } catch (err) {
        console.warn('[Thread] load error', err);
      }
    }

    await loadMessages();
    window._threadTimer = setInterval(loadMessages, 5000);
  }

  // ============================================================
  // Favourites page — available to all registered users
  // ============================================================

  async function renderFavourites() {
    if (!Auth.isRegistered()) {
      getModal('loginModal').show();
      return;
    }

    showOverlay(`
      <div class="container py-3" style="max-width:580px">
        <div class="d-flex align-items-center mb-4">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h4 class="mb-0 text-warning">Favourites</h4>
        </div>
        <div id="favList"><p class="text-secondary">Loading…</p></div>
      </div>`);

    document.getElementById('backBtn').addEventListener('click', hideOverlay);

    try {
      var data = await Api.getFavourites();
      var favs = data.favourites || [];

      if (favs.length === 0) {
        document.getElementById('favList').innerHTML =
          '<p class="text-secondary">No favourites yet.<br>Tap a user on the map and add them.</p>';
        return;
      }

      var html = favs.map(function(f) {
        var onlineBadge = f.online
          ? '<span class="badge bg-success ms-2">online</span>'
          : '<span class="badge bg-secondary ms-2">offline</span>';
        return '<div class="d-flex align-items-center justify-content-between py-2 border-bottom border-secondary">' +
          '<div>' +
          '<strong>' + escHtml(f.nickname) + '</strong>' + onlineBadge +
          '</div>' +
          '<div class="d-flex gap-2">' +
          '<button class="btn btn-sm btn-warning fav-msg-btn" ' +
            'data-userid="' + escHtml(f.userId) + '" ' +
            'data-nickname="' + escHtml(f.nickname) + '" ' +
            'title="Message">' +
            '<i class="bi bi-chat-dots"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger fav-remove-btn" ' +
            'data-userid="' + escHtml(f.userId) + '" ' +
            'title="Remove from favourites">' +
            '<i class="bi bi-star-fill"></i></button>' +
          '</div></div>';
      }).join('');

      document.getElementById('favList').innerHTML = html;

      document.querySelectorAll('.fav-msg-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          renderThread(btn.dataset.userid, btn.dataset.nickname);
        });
      });

      document.querySelectorAll('.fav-remove-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          try {
            await Api.removeFavourite(btn.dataset.userid);
            renderFavourites();
          } catch (err) {
            alert('Error: ' + err.message);
          }
        });
      });

    } catch (err) {
      document.getElementById('favList').innerHTML =
        '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
    }
  }

  // ============================================================
  // Startup
  // ============================================================

  await Auth.init();
  MapModule.init();

})();
