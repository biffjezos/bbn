// messages.js
// ============================================================
// bOOmbOOm.NOW! — Messages page ES6 module
// ============================================================

import { Api } from './api.js';
import { promptBlock } from './blocks.js';

const _pubKeyCache = {};
const _profileCache = {};
const _CACHE_TTL_MS = 5 * 60 * 1000;

let _msgWs = null;
let _wsRetry = 1000;
let _wsRetryTmr = null;
let _currentUid = null;   // partner userId of the open thread (thread page only)

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
  return window.Auth?.isRegistered?.() ?? false;
}

export function loadingHtml(text = 'Loading…') {
  return `<div class="bbn-loading"><p>${escHtml(text)}</p></div>`;
}

function threadUid() {
  return new URLSearchParams(location.search).get('uid');
}

// ── Send-error banner (thread page) ───────────────────────
function showSendError(text) {
  const el = document.getElementById('sendError');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('d-none');
}

function clearSendError() {
  const el = document.getElementById('sendError');
  if (el) el.classList.add('d-none');
}

// ── Profiles ─────────────────────────────────────────────
async function getCachedProfile(userId) {
  const hit = _profileCache[userId];
  if (hit && hit.exp > Date.now()) return hit.value;

  const profile = await Api.getProfile(userId);
  _profileCache[userId] = { value: profile, exp: Date.now() + _CACHE_TTL_MS };
  return profile;
}

// ── Crypto ───────────────────────────────────────────────
export async function getPublicKey(userId) {
  const hit = _pubKeyCache[userId];
  if (hit && hit.exp > Date.now()) return hit.value;

  const profile = await getCachedProfile(userId);

  if (profile.accountType === 'venue' && profile.managerId) {
    return getPublicKey(profile.managerId);
  }

  if (!profile.publicKey) throw new Error('Missing public key');

  _pubKeyCache[userId] = {
    value: profile.publicKey,
    exp: Date.now() + _CACHE_TTL_MS
  };

  return profile.publicKey;
}

export async function decryptFrom(payload, senderId, recipientId) {
  if (!window.BBNCrypto?.isUnlocked()) return '[encrypted]';

  const myId = getMyId();
  const otherId = myId === senderId ? recipientId : senderId;

  try {
    const key = await getPublicKey(otherId);
    return await window.BBNCrypto.decryptMessage(payload.cipher, key);
  } catch {
    return '[decryption failed]';
  }
}

// ── WebSocket ────────────────────────────────────────────
function msgWsUrl() {
  return location.origin.replace(/^http/, 'ws') + '/ws/messages';
}

function wsSend(obj) {
  if (_msgWs?.readyState === WebSocket.OPEN) {
    _msgWs.send(JSON.stringify(obj));
  }
}

function connectMsgWS() {
  if (!isRegistered()) return;

  _msgWs = new WebSocket(msgWsUrl());

  _msgWs.onopen = () => {
    _wsRetry = 1000;
    wsSend({ type: 'auth', token: window.Auth.getToken() });
    // Subscribe to the currently open thread so the server starts pushing it.
    if (_currentUid) wsSend({ type: 'view', userId: _currentUid });
  };

  _msgWs.onmessage = async e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch (msg.type) {
      case 'conversations':
        handleConversationsUpdate(msg.messages);
        break;
      case 'thread':
        // Ignore stale pushes for a thread we're no longer viewing.
        if (_currentUid && msg.userId && msg.userId !== _currentUid) break;
        handleThreadUpdate(msg.messages);
        break;
      case 'send:error':
        showSendError(msg.error || 'Message could not be sent.');
        break;
    }
  };

  _msgWs.onclose = () => {
    _msgWs = null;
    _wsRetryTmr = setTimeout(connectMsgWS, _wsRetry);
    _wsRetry = Math.min(_wsRetry * 2, 30000);
  };
}

// ── Conversations ────────────────────────────────────────
export async function handleConversationsUpdate(messages) {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  const myId = getMyId();

  const threads = {};

  messages.forEach(m => {
    const partner = m.fromUserId === myId ? m.toUserId : m.fromUserId;

    if (!threads[partner] || new Date(m.sentAt) > new Date(threads[partner].sentAt)) {
      threads[partner] = m;
    }
  });

  if (Object.keys(threads).length === 0) {
    wrap.innerHTML = '<div class="bbn-empty"><p>No conversations yet.</p></div>';
    return;
  }

  wrap.innerHTML = await Promise.all(
    Object.entries(threads).map(async ([uid, m]) => {
      const profile = await getCachedProfile(uid);

      let text = m.text;

      try {
        const payload = JSON.parse(text);
        if (payload.cipher) {
          text = await decryptFrom(payload, m.fromUserId, m.toUserId);
        }
      } catch {}

      const nickname = profile.nickname || uid;
      const href = `/messages/thread/?uid=${encodeURIComponent(uid)}&name=${encodeURIComponent(nickname)}`;

      return `
        <a class="conv-item" href="${href}">
          <div>${escHtml(nickname)}</div>
          <div>${escHtml(text)}</div>
          <div>${timeAgo(m.sentAt)}</div>
        </a>
      `;
    })
  ).then(arr => arr.join(''));
}

// ── Thread ───────────────────────────────────────────────
export async function handleThreadUpdate(messages) {
  const wrap = document.getElementById('threadMsgs');
  if (!wrap) return;

  const myId = getMyId();

  wrap.innerHTML = await Promise.all(
    messages.map(async m => {
      let text = m.text;

      try {
        const payload = JSON.parse(text);
        if (payload.cipher) {
          text = await decryptFrom(payload, m.fromUserId, m.toUserId);
        }
      } catch {}

      const mine = m.fromUserId === myId;
      return `<div class="msg ${mine ? 'msg-mine' : 'msg-theirs'}">${escHtml(text)}</div>`;
    })
  ).then(arr => arr.join(''));

  wrap.scrollTop = wrap.scrollHeight;
}

// ── Renderers ────────────────────────────────────────────
export function renderConversationList() {
  const el = document.getElementById('convListWrap');
  if (el) el.innerHTML = loadingHtml();
}

export function renderThread() {
  const el = document.getElementById('threadMsgs');
  if (el) el.innerHTML = loadingHtml('Loading messages…');
}

// ── Thread UI ────────────────────────────────────────────
export function setupThreadUI() {
  const input = document.getElementById('msgInput');
  const btn = document.getElementById('sendBtn');

  if (!input || !btn) return;

  const uid = threadUid();

  // Partner display name from the query param.
  const name = new URLSearchParams(location.search).get('name');
  const nameEl = document.getElementById('threadDisplayName');
  if (nameEl && name) nameEl.textContent = name;

  // Character counter.
  const charCount = document.getElementById('charCount');
  const maxChars = parseInt(input.getAttribute('maxlength') || '144', 10);
  const updateCount = () => {
    if (charCount) charCount.textContent = String(maxChars - input.value.length);
  };
  input.addEventListener('input', updateCount);
  updateCount();

  const doSend = async () => {
    const text = input.value.trim();
    if (!text || !uid) return;

    // Privacy-by-design: never transmit plaintext. If the crypto worker is
    // locked or encryption fails, block the send and prompt the user to unlock.
    if (!window.BBNCrypto?.isUnlocked?.()) {
      showSendError('Unlock your messages to send — enter your password.');
      window.Auth?.onNeedsUnlock?.();
      return;
    }

    let payload;
    try {
      const enc = await window.BBNCrypto.encryptMessage(text, await getPublicKey(uid));
      payload = JSON.stringify({ cipher: enc });
    } catch {
      showSendError('Could not encrypt message. Unlock your messages and try again.');
      return;
    }

    clearSendError();
    wsSend({ type: 'send', toUserId: uid, text: payload });
    input.value = '';
    updateCount();
  };

  btn.onclick = doSend;

  // Ctrl/Cmd+Enter to send.
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSend();
    }
  });

  // Block user from the thread menu.
  const blockBtn = document.getElementById('threadBlockBtn');
  if (blockBtn && uid) {
    blockBtn.addEventListener('click', () => promptBlock(uid, name));
  }
}

// ── Init ────────────────────────────────────────────────
export function initMessagesPage({ thread = false, convList = false } = {}) {
  if (convList) renderConversationList();

  if (thread) {
    _currentUid = threadUid();
    renderThread();
    setupThreadUI();
  }

  connectMsgWS();
}
