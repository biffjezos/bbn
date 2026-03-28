// messages.js
// ============================================================
// bOOmbOOm.NOW! — Messages page ES6 module
// ============================================================

const _pubKeyCache = {};
const _profileCache = {};
const _CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _msgWs = null;
let _wsRetry = 1000;
let _wsRetryTmr = null;
let _threadInitialized = false;

// ── Utilities ─────────────────────────────────────────────
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function timeUntil(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export function sexClass(sex) {
  return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown';
}

export function sexEmoji(sex) {
  return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊';
}

export function getMyId() {
  try {
    return JSON.parse(atob(window.Auth.getToken().split('.')[1])).sub;
  } catch {
    return null;
  }
}

export function isRegistered() {
  try {
    if (typeof window.Auth?.isRegistered === 'function') return window.Auth.isRegistered();
    const payload = JSON.parse(atob(window.Auth.getToken().split('.')[1]));
    return ['user', 'admin', 'venue_manager'].includes(payload.role);
  } catch {
    return false;
  }
}

export function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── Crypto helpers ────────────────────────────────────────
export async function getPublicKey(userId) {
  const hit = _pubKeyCache[userId];
  if (hit && hit.exp > Date.now()) return hit.value;

  const profile = await window.Api.getProfile(userId);

  if (profile.accountType === 'venue' && profile.managerId) {
    return getPublicKey(profile.managerId);
  }
  if (!profile.publicKey) throw new Error('User has no public key — not yet logged in since E2EE update.');
  
  _pubKeyCache[userId] = { value: profile.publicKey, exp: Date.now() + _CACHE_TTL_MS };
  return profile.publicKey;
}

export async function encryptFor(text, recipientId) {
  if (!window.BBMCrypto?.isUnlocked()) throw new Error('Crypto not ready.');
  const recipientKey = await getPublicKey(recipientId);
  const cipher = await window.BBMCrypto.encryptMessage(text, recipientKey);
  return { cipher, recipientId };
}

export async function decryptFrom(payload, senderId, recipientId) {
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

export async function decodeMessage(m) {
  try {
    const payload = JSON.parse(m.text);
    if (payload.cipher) return await decryptFrom(payload, m.fromUserId, m.toUserId);
  } catch {}
  return m.text;
}

// ── WebSocket ────────────────────────────────────────────
export function msgWsUrl() {
  const api = window.BOOMBOOM_API_URL || '';
  const base = api.replace(/^https?:\/\//, 'wss://').replace(/\/api\/?$/, '');
  return `${base}/ws/messages`;
}

export function wsSend(obj) {
  if (_msgWs?.readyState === WebSocket.OPEN) {
    _msgWs.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

export function connectMsgWS() {
  if (!isRegistered()) return;
  if (_msgWs && (_msgWs.readyState === WebSocket.OPEN || _msgWs.readyState === WebSocket.CONNECTING)) return;

  _msgWs = new WebSocket(msgWsUrl());

  _msgWs.onopen = () => {
    _wsRetry = 1000;
    console.log('[Msg] WS connected');
    wsSend({ type: 'auth', token: window.Auth?.getToken?.() || '' });

    const params = new URLSearchParams(window.location.search);
    const uid = params.get('uid');
    if (uid) wsSend({ type: 'view', userId: uid });
  };

  _msgWs.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'conversations') handleConversationsUpdate(msg.messages || []);
      if (msg.type === 'thread') handleThreadUpdate(msg.messages || []);
      if (msg.type === 'send:error') {
        const el = sendError();
        if (el) {
          el.textContent = msg.error || 'Failed to send message.';
          el.classList.remove('d-none');
        }
      }
    } catch {}
  };

  _msgWs.onclose = () => {
    _msgWs = null;
    if (!isRegistered()) return;
    if (_wsRetryTmr) clearTimeout(_wsRetryTmr);
    _wsRetryTmr = setTimeout(connectMsgWS, _wsRetry);
    _wsRetry = Math.min(_wsRetry * 2, 30000);
    console.log('[Msg] WS closed, retrying in', _wsRetry + 'ms');
  };
}

// ── Conversation list ─────────────────────────────────────
export async function handleConversationsUpdate(messages) {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  if (messages.length === 0) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
      <p>No conversations yet.<br>Find someone on the map and say hi!</p></div>`;
    return;
  }

  const myId = getMyId();
  const threads = {};
  messages.forEach(m => {
    const partnerId = m.fromUserId === myId ? m.toUserId : m.fromUserId;
    if (!threads[partnerId] || new Date(m.sentAt) > new Date(threads[partnerId].latest.sentAt)) {
      threads[partnerId] = { userId: partnerId, latest: m };
    }
  });

  const partnerIds = Object.keys(threads);

  await Promise.allSettled(partnerIds.map(async uid => {
    const cached = _profileCache[uid];
    if (!cached || cached.exp <= Date.now()) {
      try { _profileCache[uid] = { value: await window.Api.getProfile(uid), exp: Date.now() + _CACHE_TTL_MS }; }
      catch { _profileCache[uid] = { value: {}, exp: Date.now() + _CACHE_TTL_MS }; }
    }
    const profile = _profileCache[uid].value;
    threads[uid].nickname = uid === myId ? 'Reminder to Yourself' : (profile.nickname || uid);
    threads[uid].sex = profile.sex || null;
    threads[uid].publicKey = profile.publicKey || null;
    threads[uid].isSelf = uid === myId;
  }));

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

// ── Expose a single init function ──────────────────────────
export function initMessagesPage({ thread = false, convList = false } = {}) {
  if (convList) renderConversationList();
  if (thread) {
    _threadInitialized = true;
    renderThread();
  }
  connectMsgWS();
}

// ── Exports for internal thread helpers ───────────────────
export { renderThread, renderConversationList, handleThreadUpdate, setupThreadUI };