// ============================================================
// bOOmbOOm.NOW! — Messages page module
// ============================================================

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)   return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  return Math.floor(diff / 3600000) + 'h ago';
}

function timeUntil(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

function getMyId() {
  try { return JSON.parse(atob(window.Auth.getToken().split('.')[1])).sub; } catch { return null; }
}

function isRegistered() {
  try {
    if (typeof window.Auth?.isRegistered === 'function') return window.Auth.isRegistered();
    const payload = JSON.parse(atob(window.Auth.getToken().split('.')[1]));
    return payload.role === 'user';
  } catch { return false; }
}

function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)  { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }

// ── Crypto helpers ────────────────────────────────────────
const _pubKeyCache = {};

async function getPublicKey(userId) {
  if (_pubKeyCache[userId]) return _pubKeyCache[userId];
  const profile = await window.Api.getProfile(userId);
  if (!profile.publicKey) throw new Error('User has no public key — not yet logged in since E2EE update.');
  _pubKeyCache[userId] = profile.publicKey;
  return profile.publicKey;
}

async function encryptFor(text, recipientId) {
  if (!window.BBMCrypto?.isUnlocked()) throw new Error('Crypto not ready.');
  const recipientKey = await getPublicKey(recipientId);
  const cipher = await window.BBMCrypto.encryptMessage(text, recipientKey);
  return { cipher, recipientId };
}

async function decryptFrom(payload, senderId, recipientId) {
  if (!window.BBMCrypto?.isUnlocked()) return '[encrypted]';
  const myId = getMyId();
  const otherUserId = myId === senderId ? recipientId : senderId;
  try {
    const otherKey = await getPublicKey(otherUserId);
    return await window.BBMCrypto.decryptMessage(payload.cipher, otherKey);
  } catch {
    return '[decryption failed]';
  }
}

async function decodeMessage(m, partnerId) {
  try {
    const payload = JSON.parse(m.text);
    if (payload.cipher) {
      return await decryptFrom(payload, m.fromUserId, m.toUserId);
    }
  } catch { /* not JSON — legacy plaintext */ }
  return m.text;
}

function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── Messages WebSocket ────────────────────────────────────
// One connection per page load. Server pushes 'conversations'
// every 3 s and 'thread' every 2 s (when a thread is viewed).

let _msgWs      = null;
let _wsRetry    = 1000;
let _wsRetryTmr = null;

function msgWsUrl() {
  const api   = window.BOOMBOOM_API_URL || '';
  const base  = api.replace(/^https?:\/\//, 'wss://').replace(/\/api\/?$/, '');
  const token = window.Auth?.getToken?.() || '';
  return `${base}/ws/messages?token=${encodeURIComponent(token)}`;
}

function wsSend(obj) {
  if (_msgWs?.readyState === WebSocket.OPEN) {
    _msgWs.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function connectMsgWS() {
  if (!isRegistered()) return;
  if (_msgWs && (_msgWs.readyState === WebSocket.OPEN || _msgWs.readyState === WebSocket.CONNECTING)) return;

  _msgWs = new WebSocket(msgWsUrl());

  _msgWs.onopen = function () {
    _wsRetry = 1000;
    console.log('[Msg] WS connected');
    // If we're on the thread page, subscribe immediately
    const params = new URLSearchParams(window.location.search);
    const uid    = params.get('uid');
    if (uid) wsSend({ type: 'view', userId: uid });
  };

  _msgWs.onmessage = function (e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'conversations') handleConversationsUpdate(msg.messages || []);
      if (msg.type === 'thread')         handleThreadUpdate(msg.messages || []);
    } catch { /* silent */ }
  };

  _msgWs.onclose = function () {
    _msgWs = null;
    if (!isRegistered()) return;
    if (_wsRetryTmr) clearTimeout(_wsRetryTmr);
    _wsRetryTmr = setTimeout(connectMsgWS, _wsRetry);
    _wsRetry    = Math.min(_wsRetry * 2, 30000);
    console.log('[Msg] WS closed, retrying in', _wsRetry + 'ms');
  };
}

// ── Conversation list ─────────────────────────────────────
const _profileCache = {};

async function handleConversationsUpdate(messages) {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  if (messages.length === 0) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
      <p>No conversations yet.<br>Find someone on the map and say hi!</p></div>`;
    return;
  }

  const myId    = getMyId();
  const threads = {};
  messages.forEach(m => {
    const partnerId = m.fromUserId === myId ? m.toUserId : m.fromUserId;
    if (!threads[partnerId] || new Date(m.sentAt) > new Date(threads[partnerId].latest.sentAt)) {
      threads[partnerId] = { userId: partnerId, latest: m };
    }
  });

  const partnerIds = Object.keys(threads);

  // Fetch profiles (cached)
  await Promise.allSettled(partnerIds.map(async uid => {
    if (!_profileCache[uid]) {
      try { _profileCache[uid] = await window.Api.getProfile(uid); } catch { _profileCache[uid] = {}; }
    }
    threads[uid].nickname  = _profileCache[uid].nickname  || uid;
    threads[uid].sex       = _profileCache[uid].sex       || null;
    threads[uid].publicKey = _profileCache[uid].publicKey || null;
  }));

  // Decrypt previews
  await Promise.all(Object.values(threads).map(async t => {
    try {
      const payload = JSON.parse(t.latest.text);
      t.preview = payload.cipher
        ? await decryptFrom(payload, t.latest.fromUserId, t.latest.toUserId)
        : t.latest.text;
    } catch {
      t.preview = t.latest.text;
    }
  }));

  wrap.innerHTML = Object.values(threads)
    .sort((a, b) => new Date(b.latest.sentAt) - new Date(a.latest.sentAt))
    .map(t => {
      const href = `${window.BOOMBOOM_BASE || ''}/messages/thread/?uid=${encodeURIComponent(t.userId)}&name=${encodeURIComponent(t.nickname)}`;
      return `<a href="${href}" class="conv-item">
        <div class="conv-avatar ${sexClass(t.sex)}">${sexEmoji(t.sex)}</div>
        <div class="conv-body">
          <div class="conv-name">${escHtml(t.nickname)}</div>
          <div class="conv-preview">${escHtml(t.preview || t.latest.text)}</div>
        </div>
        <div class="conv-meta">${timeAgo(t.latest.sentAt)}<i class="bi bi-chevron-right d-block text-faint mt-1"></i></div>
      </a>`;
    }).join('');
}

// ── Message thread ────────────────────────────────────────

const msgsEl    = () => document.getElementById('threadMsgs');
const inputEl   = () => document.getElementById('msgInput');
const charCount = () => document.getElementById('charCount');
const sendError = () => document.getElementById('sendError');

async function handleThreadUpdate(messages) {
  const el  = msgsEl();
  const myId = getMyId();
  if (!el) return;

  if (messages.length === 0) {
    el.innerHTML = `<div class="bbm-empty" style="padding:2rem 0">
      <i class="bi bi-chat-heart"></i><p>No messages yet. Say hi!</p></div>`;
    return;
  }

  const decrypted = await Promise.all(messages.map(async m => ({
    ...m,
    text: await decodeMessage(m),
  })));

  el.innerHTML = decrypted.map(m => {
    const out = m.fromUserId === myId;
    return `<div class="d-flex ${out ? 'justify-content-end' : 'justify-content-start'}">
      <div>
        <div class="message-bubble ${out ? 'outgoing' : 'incoming'} px-3 py-2">${escHtml(m.text)}</div>
        <div class="message-expiry ${out ? 'text-end' : ''} mt-1 px-1 small">expires ${timeUntil(m.expiresAt)}</div>
      </div>
    </div>`;
  }).join('');

  el.scrollTop = el.scrollHeight;
}

function setupThreadUI(userId) {
  const input  = inputEl();
  const sendBtn = document.getElementById('sendBtn');
  const cc      = charCount();
  const errEl   = sendError();

  if (input) {
    input.addEventListener('input', function () {
      const rem = 144 - this.value.length;
      if (cc) { cc.textContent = rem; cc.style.color = rem < 0 ? '#ff8a80' : ''; }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendBtn?.click(); }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const text = input?.value.trim();
      if (!text) return;
      errEl?.classList.add('d-none');

      if (!window.requireUnlocked?.()) return;

      try {
        const encrypted = await encryptFor(text, userId);
        const body      = JSON.stringify(encrypted);

        // Try WS first; fall back to HTTP
        if (!wsSend({ type: 'send', toUserId: userId, text: body })) {
          await window.Api.sendMessage(userId, body);
        }

        if (input)  input.value = '';
        if (cc)     cc.textContent = '144';
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.classList.remove('d-none'); }
      }
    });
  }
}

async function renderThread() {
  const params      = new URLSearchParams(window.location.search);
  const userId      = params.get('uid');
  const displayName = params.get('name') || userId;

  const nameEl = document.getElementById('threadDisplayName');
  if (nameEl) nameEl.textContent = displayName;

  if (!isRegistered() || !userId) {
    const _base = window.BOOMBOOM_BASE || '';
    window.location.href = isRegistered() ? _base + '/messages/' : _base + '/';
    return;
  }

  const el = msgsEl();
  if (el) el.innerHTML = loadingHtml('Loading messages…');

  setupThreadUI(userId);

  // Tell the server which thread to subscribe to
  wsSend({ type: 'view', userId });
  window.addEventListener('beforeunload', () => wsSend({ type: 'view', userId: null }), { once: true });
}

async function renderConversationList() {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
      <p>Log in to see your conversations.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  wrap.innerHTML = loadingHtml('Loading conversations…');
  // Actual data arrives via WS push → handleConversationsUpdate()
}

// ── Auto-run when loaded as extra_js ─────────────────────
var _threadInitialized = false;

(window.__authReady || Promise.resolve()).then(async function() {
  const hasConvList = !!document.getElementById('convListWrap');
  const hasThread   = !!document.getElementById('threadMsgs');
  if (!hasConvList && !hasThread) return;

  // Sync crypto shadow state (SharedWorker may already hold key from prev page)
  await window.BBMCrypto?.ready?.();

  // Check / prompt for key unlock before attempting any decryption
  if (window.requireUnlocked && !window.requireUnlocked()) {
    // Lock modal is now showing — rendering deferred to bbm:unlocked
    return;
  }

  connectMsgWS();

  if (hasConvList) renderConversationList();
  if (hasThread)   { _threadInitialized = true; renderThread(); }
});

// After unlock (first time or re-unlock after inactivity lock)
window.addEventListener('bbm:unlocked', function () {
  connectMsgWS();
  if (document.getElementById('convListWrap')) {
    renderConversationList();
  }
  if (document.getElementById('threadMsgs')) {
    if (_threadInitialized) {
      // Thread already set up — re-subscribe to push updates
      const uid = new URLSearchParams(window.location.search).get('uid');
      if (uid) wsSend({ type: 'view', userId: uid });
    } else {
      _threadInitialized = true;
      renderThread();
    }
  }
});
