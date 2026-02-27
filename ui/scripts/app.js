// ============================================================
// bOOmbOOm.NOW! — App Controller
// Wires Auth, Map, Api and all modal interactions.
// ============================================================

// --- Debug console modal (activate with ?dbg in URL) --------
(function () {
  if (!window.location.search.includes('dbg')) return;

  const logs = [];
  const _methods = ['log', 'warn', 'error', 'info'];
  _methods.forEach(m => {
    const orig = console[m].bind(console);
    console[m] = (...args) => {
      orig(...args);
      const line = `[${m.toUpperCase()}] ${args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch { return String(a); }
      }).join(' ')}`;
      logs.push(line);
      const el = document.getElementById('dbgOutput');
      if (el) el.textContent = logs.join('\n');
    };
  });

  window.addEventListener('error', e => {
    console.error('Uncaught:', e.message, 'at', e.filename, e.lineno);
  });

  window.addEventListener('unhandledrejection', e => {
    console.error('UnhandledPromise:', e.reason);
  });

  // Inject modal into DOM once body is ready
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div class="modal fade" id="dbgModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-scrollable modal-lg">
          <div class="modal-content bg-black text-light border-secondary">
            <div class="modal-header border-secondary">
              <h6 class="modal-title text-warning">🐛 Debug Console</h6>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-2">
              <pre id="dbgOutput" style="font-size:0.7rem;white-space:pre-wrap;word-break:break-all;max-height:60vh;overflow-y:auto;margin:0"></pre>
            </div>
            <div class="modal-footer border-secondary py-1">
              <button class="btn btn-sm btn-outline-secondary" onclick="document.getElementById('dbgOutput').textContent=''">Clear</button>
              <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>
      <button id="dbgToggle" style="position:fixed;bottom:16px;right:16px;z-index:9999"
        class="btn btn-sm btn-warning opacity-75">🐛</button>`;
    document.body.appendChild(modal);

    document.getElementById('dbgToggle').addEventListener('click', () => {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('dbgModal')).show();
    });

    // Auto-open on load
    setTimeout(() => {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('dbgModal')).show();
    }, 800);
  });
})();
// ------------------------------------------------------------


(async function () {

  // ============================================================
  // Auth event hooks
  // ============================================================

  Auth.onLogin = ({ nickname, sex }) => {
    document.getElementById('guestMenu').classList.add('d-none');
    document.getElementById('userMenu').classList.remove('d-none');
    document.getElementById('menuNickname').textContent = nickname;
    MapModule.refreshSelfIcon();
    MapModule.startNearbyPoll();
  };

  Auth.onLogout = () => {
    document.getElementById('guestMenu').classList.remove('d-none');
    document.getElementById('userMenu').classList.add('d-none');
    document.getElementById('menuNickname').textContent = '—';
    MapModule.refreshSelfIcon();
  };

  Auth.onGuestReady = () => {
    // Guest can see limited pins
    MapModule.startNearbyPoll();
  };

  Auth.onGuestExpired = () => {
    MapModule.stopNearbyPoll();
    setStatus('expired', 'guest expired');
  };

  // ============================================================
  // Bootstrap modal helpers
  // ============================================================

  function getModal(id) {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
  }

  function showError(elId, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('d-none');
  }

  function hideError(elId) {
    document.getElementById(elId)?.classList.add('d-none');
  }

  // ============================================================
  // Register
  // ============================================================

  document.getElementById('regSubmitBtn')?.addEventListener('click', async () => {
    hideError('registerError');
    const email    = document.getElementById('regEmail').value.trim();
    const nickname = document.getElementById('regNickname').value.trim();
    const password = document.getElementById('regPassword').value;
    const age      = parseInt(document.getElementById('regAge').value, 10);
    const sex      = document.getElementById('regSex').value;

    if (!email || !nickname || !password || !age || !sex) {
      return showError('registerError', 'All fields are required.');
    }

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

  document.getElementById('loginSubmitBtn')?.addEventListener('click', async () => {
    hideError('loginError');
    const login    = document.getElementById('loginLogin').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!login || !password) {
      return showError('loginError', 'Both fields required.');
    }

    try {
      await Auth.login({ login, password });
      getModal('loginModal').hide();
    } catch (err) {
      showError('loginError', err.message);
    }
  });

  // Allow Enter key in login
  document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginSubmitBtn').click();
  });

  // ============================================================
  // Logout
  // ============================================================

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'))?.hide();
    Auth.logout();
  });

  // ============================================================
  // Delete account
  // ============================================================

  document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
    bootstrap.Offcanvas.getInstance(document.getElementById('appMenu'))?.hide();
    getModal('deleteConfirmModal').show();
  });

  document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
    try {
      await Auth.deleteAccount();
      getModal('deleteConfirmModal').hide();
    } catch (err) {
      alert('Error deleting account: ' + err.message);
    }
  });

  // ============================================================
  // Profile modal (triggered when clicking a user pin on map)
  // ============================================================

  MapModule.onUserClick = async (user) => {
    // user = { userId, lat, lon, isRegistered, sex, nickname, distanceM }
    const modal = getModal('profileModal');

    // Reset
    document.getElementById('profileModalTitle').textContent    = user.nickname || 'Anonymous';
    document.getElementById('profileModalNickname').textContent = user.nickname || '—';
    document.getElementById('profileModalAge').textContent      = '…';
    document.getElementById('profileModalDist').textContent     = `${user.distanceM} m`;
    document.getElementById('profileModalMsgLink').classList.add('d-none');

    // Pick icon
    const iconMap = { m: '👆🔵', f: '👆🩷', o: '👆' };
    document.getElementById('profileModalIcon').textContent =
      user.isRegistered ? (iconMap[user.sex] || '👆') : '✊';

    modal.show();

    // If registered, fetch full profile
    if (user.isRegistered && user.nickname) {
      try {
        const profile = await Api.getProfile(user.nickname);
        document.getElementById('profileModalAge').textContent = profile.age || '—';

        // Show message link only to logged-in users
        if (Auth.isRegistered()) {
          const link = document.getElementById('profileModalMsgLink');
          link.href = `/conversations?with=${encodeURIComponent(user.nickname)}`;
          link.classList.remove('d-none');
        }
      } catch {
        document.getElementById('profileModalAge').textContent = '—';
      }
    } else {
      document.getElementById('profileModalAge').textContent = '—';
    }
  };

  // ============================================================
  // Page overlay routing (profile, conversations)
  // These are rendered inline rather than as separate navigations
  // to avoid losing the map state.
  // ============================================================

  function handleInternalNav() {
    const path = window.location.pathname;
    const overlay = document.getElementById('pageOverlay');

    if (path === '/' || path === '/index.html') {
      overlay?.classList.remove('active');
      return;
    }

    if (path.startsWith('/profile')) {
      renderProfilePage(overlay);
    } else if (path.startsWith('/conversations')) {
      const params = new URLSearchParams(window.location.search);
      const withUser = params.get('with');
      renderConversationsPage(overlay, withUser);
    }
  }

  // ============================================================
  // Profile page
  // ============================================================

  async function renderProfilePage(overlay) {
    if (!Auth.isRegistered()) {
      window.history.pushState({}, '', '/');
      getModal('loginModal').show();
      return;
    }

    overlay.classList.add('active');
    overlay.innerHTML = `
      <div class="container" style="max-width:480px">
        <div class="d-flex align-items-center mb-4">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h4 class="mb-0 text-warning">My Profile</h4>
        </div>
        <div id="profileContent"><div class="text-secondary">Loading…</div></div>
      </div>`;

    document.getElementById('backBtn').addEventListener('click', () => {
      window.history.pushState({}, '', '/');
      overlay.classList.remove('active');
    });

    try {
      const me = await Api.getMe();
      document.getElementById('profileContent').innerHTML = `
        <div class="mb-3">
          <label class="form-label text-secondary">Nickname</label>
          <input class="form-control bg-black text-light border-secondary" id="pNickname" value="${escHtml(me.nickname)}" maxlength="32" />
        </div>
        <div class="mb-3">
          <label class="form-label text-secondary">Age</label>
          <input type="number" class="form-control bg-black text-light border-secondary" id="pAge" value="${me.age}" min="18" max="120" />
        </div>
        <div class="mb-3">
          <label class="form-label text-secondary">Sex</label>
          <select class="form-select bg-black text-light border-secondary" id="pSex">
            <option value="m" ${me.sex==='m'?'selected':''}>Male</option>
            <option value="f" ${me.sex==='f'?'selected':''}>Female</option>
            <option value="o" ${me.sex==='o'?'selected':''}>Other</option>
          </select>
        </div>
        <div id="profileSaveMsg" class="d-none alert alert-success">Saved!</div>
        <button class="btn btn-warning w-100" id="profileSaveBtn">Save Changes</button>
      `;

      document.getElementById('profileSaveBtn').addEventListener('click', async () => {
        try {
          await Api.updateMe({
            nickname: document.getElementById('pNickname').value.trim(),
            age: parseInt(document.getElementById('pAge').value, 10),
            sex: document.getElementById('pSex').value,
          });
          document.getElementById('profileSaveMsg').classList.remove('d-none');
          setTimeout(() => document.getElementById('profileSaveMsg')?.classList.add('d-none'), 2000);
        } catch (err) {
          alert('Save failed: ' + err.message);
        }
      });
    } catch (err) {
      document.getElementById('profileContent').innerHTML =
        `<div class="alert alert-danger">${escHtml(err.message)}</div>`;
    }
  }

  // ============================================================
  // Conversations page
  // ============================================================

  async function renderConversationsPage(overlay, withNickname) {
    if (!Auth.isRegistered()) {
      window.history.pushState({}, '', '/');
      getModal('loginModal').show();
      return;
    }

    overlay.classList.add('active');

    if (withNickname) {
      renderThread(overlay, withNickname);
    } else {
      renderConversationList(overlay);
    }
  }

  async function renderConversationList(overlay) {
    overlay.innerHTML = `
      <div class="container" style="max-width:580px">
        <div class="d-flex align-items-center mb-4">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h4 class="mb-0 text-warning">Conversations</h4>
        </div>
        <div id="convList"><div class="text-secondary">Loading…</div></div>
      </div>`;

    document.getElementById('backBtn').addEventListener('click', () => {
      window.history.pushState({}, '', '/');
      overlay.classList.remove('active');
    });

    try {
      const data = await Api.getConversations();
      const msgs = data.messages || [];

      if (msgs.length === 0) {
        document.getElementById('convList').innerHTML =
          '<p class="text-secondary">No active conversations. Find someone on the map!</p>';
        return;
      }

      // Group by conversation partner
      const myId = parseJwtSub(Auth.getToken());
      const threads = {};
      for (const m of msgs) {
        const partner = m.fromUserId === myId ? m.toUserId : m.fromUserId;
        if (!threads[partner]) threads[partner] = { nickname: m.fromUserId === myId ? m.toNickname : m.fromNickname, latest: m };
        if (new Date(m.sentAt) > new Date(threads[partner].latest.sentAt)) threads[partner].latest = m;
      }

      const html = Object.values(threads).map(t => `
        <div class="conversation-card" data-nickname="${escHtml(t.nickname || t.latest.toNickname || '?')}">
          <div class="d-flex justify-content-between">
            <strong>${escHtml(t.nickname || '?')}</strong>
            <small class="text-secondary">${timeAgo(t.latest.sentAt)}</small>
          </div>
          <div class="text-secondary text-truncate mt-1" style="font-size:0.85rem">
            ${escHtml(t.latest.text)}
          </div>
        </div>`).join('');

      document.getElementById('convList').innerHTML = html;

      document.querySelectorAll('.conversation-card').forEach(card => {
        card.addEventListener('click', () => {
          const nick = card.dataset.nickname;
          window.history.pushState({}, '', `/conversations?with=${encodeURIComponent(nick)}`);
          renderThread(overlay, nick);
        });
      });
    } catch (err) {
      document.getElementById('convList').innerHTML =
        `<div class="alert alert-danger">${escHtml(err.message)}</div>`;
    }
  }

  async function renderThread(overlay, nickname) {
    overlay.innerHTML = `
      <div class="container d-flex flex-column h-100" style="max-width:580px;padding-bottom:0">
        <div class="d-flex align-items-center mb-3 flex-shrink-0">
          <button class="btn btn-link text-light p-0 me-3" id="backBtn">
            <i class="bi bi-arrow-left fs-5"></i>
          </button>
          <h5 class="mb-0 text-warning">${escHtml(nickname)}</h5>
        </div>
        <div id="threadMsgs" class="flex-grow-1 d-flex flex-column gap-2 overflow-auto pb-3"></div>
        <div id="composeArea" class="flex-shrink-0">
          <div class="d-flex gap-2 align-items-end">
            <div class="flex-grow-1">
              <textarea
                id="msgInput"
                class="form-control"
                rows="2"
                maxlength="144"
                placeholder="Say something nearby… (144 chars)"
              ></textarea>
              <div class="d-flex justify-content-between mt-1">
                <span id="sendError" class="text-danger small d-none"></span>
                <span id="charCount" class="ms-auto">144</span>
              </div>
            </div>
            <button class="btn btn-warning" id="sendBtn">
              <i class="bi bi-send"></i>
            </button>
          </div>
        </div>
      </div>`;

    document.getElementById('backBtn').addEventListener('click', () => {
      window.history.pushState({}, '', '/conversations');
      renderConversationList(overlay);
    });

    const myNickname = Auth.getNickname();

    async function loadMessages() {
      try {
        const data = await Api.getConversation(nickname);
        const msgs = data.messages || [];
        const container = document.getElementById('threadMsgs');
        if (!container) return;

        container.innerHTML = msgs.length === 0
          ? '<p class="text-secondary text-center mt-4">No messages yet. Say hi!</p>'
          : msgs.map(m => {
              const outgoing = m.fromUserId !== nickname; // rough check
              const side = outgoing ? 'outgoing' : 'incoming';
              return `
                <div class="d-flex ${outgoing ? 'justify-content-end' : 'justify-content-start'}">
                  <div>
                    <div class="message-bubble ${side}">${escHtml(m.text)}</div>
                    <div class="message-expiry ${outgoing ? 'text-end' : ''}">
                      expires ${timeUntil(m.expiresAt)}
                    </div>
                  </div>
                </div>`;
            }).join('');

        container.scrollTop = container.scrollHeight;
      } catch (err) {
        console.warn('[Thread] load error', err);
      }
    }

    loadMessages();
    const refreshTimer = setInterval(loadMessages, 5000);

    // char counter
    document.getElementById('msgInput')?.addEventListener('input', () => {
      const len = document.getElementById('msgInput').value.length;
      const counter = document.getElementById('charCount');
      if (counter) {
        counter.textContent = 144 - len;
        counter.classList.toggle('over', len > 144);
      }
    });

    // send
    document.getElementById('sendBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('msgInput');
      const text = input?.value.trim();
      if (!text) return;

      document.getElementById('sendError')?.classList.add('d-none');
      try {
        await Api.sendMessage(nickname, text);
        input.value = '';
        document.getElementById('charCount').textContent = '144';
        await loadMessages();
      } catch (err) {
        const errEl = document.getElementById('sendError');
        if (errEl) {
          errEl.textContent = err.message;
          errEl.classList.remove('d-none');
        }
      }
    });

    // Clean up timer when navigating away
    overlay.dataset.threadTimer = refreshTimer;
  }

  // ============================================================
  // Utilities
  // ============================================================

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)   return 'just now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
    return `${Math.floor(diff/3600000)}h ago`;
  }

  function timeUntil(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'soon';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }

  function parseJwtSub(token) {
    try {
      return JSON.parse(atob(token.split('.')[1])).sub;
    } catch { return null; }
  }

  // ============================================================
  // Bootstrap init + startup
  // ============================================================

  await Auth.init();
  MapModule.init();
  handleInternalNav();

  // Handle browser back/forward
  window.addEventListener('popstate', handleInternalNav);

})();
