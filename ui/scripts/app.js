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
    MapModule.refreshSelfIcon();
    MapModule.startNearbyPoll();
  };

  Auth.onLogout = function() {
    document.getElementById('guestMenu').classList.remove('d-none');
    document.getElementById('userMenu').classList.add('d-none');
    document.getElementById('menuNickname').textContent = '—';
    MapModule.refreshSelfIcon();
    hideOverlay();
  };

  Auth.onGuestReady  = function() { MapModule.startNearbyPoll(); };
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
    var login    = document.getElementById('loginLogin').value.trim();
    var password = document.getElementById('loginPassword').value;

    if (!login || !password)
      return showError('loginError', 'Both fields required.');

    try {
      await Auth.login({ login, password });
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


  // ============================================================
  // Map pin click — show user profile modal
  // ============================================================

  MapModule.onUserClick = async function(user) {
    var modal = getModal('profileModal');

    document.getElementById('profileModalTitle').textContent    = user.nickname || 'Anonymous';
    document.getElementById('profileModalNickname').textContent = user.nickname || '—';
    document.getElementById('profileModalAge').textContent      = '…';
    document.getElementById('profileModalDist').textContent     = user.distanceM + ' m';

    var iconMap = { m: '👆', f: '👆', o: '👆' };
    document.getElementById('profileModalIcon').textContent =
      user.isRegistered ? (iconMap[user.sex] || '👆') : '✊';

    // Hide message link until we confirm both are registered
    var msgLink = document.getElementById('profileModalMsgLink');
    msgLink.classList.add('d-none');

    modal.show();

    if (user.isRegistered && user.nickname) {
      try {
        var profile = await Api.getProfile(user.nickname);
        document.getElementById('profileModalAge').textContent = profile.age || '—';

        if (Auth.isRegistered()) {
          // Clone to remove old event listeners
          var newLink = msgLink.cloneNode(true);
          msgLink.parentNode.replaceChild(newLink, msgLink);
          newLink.classList.remove('d-none');
          newLink.addEventListener('click', function(e) {
            e.preventDefault();
            modal.hide();
            renderThread(user.nickname);
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
  // Profile page — edit all fields including email + password
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
          <label class="form-label text-secondary small">Nickname</label>
          <input class="form-control bg-black text-light border-secondary"
            id="pNickname" value="${escHtml(me.nickname)}" maxlength="32" />
        </div>
        <div class="mb-3">
          <label class="form-label text-secondary small">
            New Password
            <span class="text-secondary" style="font-weight:normal"> — leave blank to keep current</span>
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
              <option value="o" ${me.sex==='o'?'selected':''}>Other</option>
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
      var threads = {};

      msgs.forEach(function(m) {
        var isOutgoing   = m.fromUserId === myId;
        var partnerNick  = isOutgoing ? m.toNickname   : m.fromNickname;
        var partnerId    = isOutgoing ? m.toUserId     : m.fromUserId;
        var key          = partnerNick || partnerId;

        if (!threads[key] || new Date(m.sentAt) > new Date(threads[key].latest.sentAt)) {
          threads[key] = { nickname: partnerNick || key, latest: m };
        }
      });

      var html = Object.values(threads).map(function(t) {
        return '<div class="conversation-card" data-nickname="' + escHtml(t.nickname) + '">' +
          '<div class="d-flex justify-content-between align-items-center">' +
          '<strong>' + escHtml(t.nickname) + '</strong>' +
          '<small class="text-secondary">' + timeAgo(t.latest.sentAt) + '</small></div>' +
          '<div class="text-secondary text-truncate mt-1" style="font-size:0.85rem">' +
          escHtml(t.latest.text) + '</div></div>';
      }).join('');

      document.getElementById('convList').innerHTML = html;

      document.querySelectorAll('.conversation-card').forEach(function(card) {
        card.addEventListener('click', function() {
          renderThread(card.dataset.nickname);
        });
      });

    } catch (err) {
      document.getElementById('convList').innerHTML =
        '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
    }
  }

  // ============================================================
  // Message thread
  // ============================================================

  async function renderThread(nickname) {
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
          <h5 class="mb-0 text-warning">${escHtml(nickname)}</h5>
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
      var len = this.value.length;
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
        await Api.sendMessage(nickname, text);
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
        var data      = await Api.getConversation(nickname);
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
  // Startup
  // ============================================================

  await Auth.init();
  MapModule.init();

})();
