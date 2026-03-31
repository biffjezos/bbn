// messages.js
// ============================================================
// bOOmbOOm.NOW! — Messages page ES6 module
// ============================================================

import { Api } from './api.js';

const _pubKeyCache = {};
const _CACHE_TTL_MS = 5 * 60 * 1000;

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

// ── Crypto ───────────────────────────────────────────────
export async function getPublicKey(userId) {
  const hit = _pubKeyCache[userId];
  if (hit && hit.exp > Date.now()) return hit.value;

  const profile = await Api.getProfile(userId);

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
  };

  _msgWs.onmessage = async e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'conversations') {
      handleConversationsUpdate(msg.messages);
    }

    if (msg.type === 'thread') {
      handleThreadUpdate(msg.messages);
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

  wrap.innerHTML = await Promise.all(
    Object.entries(threads).map(async ([uid, m]) => {
      const profile = await Api.getProfile(uid);

      let text = m.text;

      try {
        const payload = JSON.parse(text);
        if (payload.cipher) {
          text = await decryptFrom(payload, m.fromUserId, m.toUserId);
        }
      } catch {}

      return `
        <div class="conv-item">
          <div>${escHtml(profile.nickname || uid)}</div>
          <div>${escHtml(text)}</div>
          <div>${timeAgo(m.sentAt)}</div>
        </div>
      `;
    })
  ).then(arr => arr.join(''));
}

// ── Thread ───────────────────────────────────────────────
export async function handleThreadUpdate(messages) {
  const wrap = document.getElementById('threadWrap');
  if (!wrap) return;

  wrap.innerHTML = await Promise.all(
    messages.map(async m => {
      let text = m.text;

      try {
        const payload = JSON.parse(text);
        if (payload.cipher) {
          text = await decryptFrom(payload, m.fromUserId, m.toUserId);
        }
      } catch {}

      return `<div class="msg">${escHtml(text)}</div>`;
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
  const el = document.getElementById('threadWrap');
  if (el) el.innerHTML = loadingHtml();
}

// ── Thread UI ────────────────────────────────────────────
export function setupThreadUI() {
  const input = document.getElementById('msgInput');
  const btn = document.getElementById('sendBtn');

  if (!input || !btn) return;

  btn.onclick = async () => {
    const text = input.value.trim();
    if (!text) return;

    const params = new URLSearchParams(location.search);
    const uid = params.get('uid');

    let payload = text;

    try {
      const enc = await window.BBNCrypto.encryptMessage(text, await getPublicKey(uid));
      payload = JSON.stringify({ cipher: enc });
    } catch {}

    wsSend({
      type: 'send',
      toUserId: uid,
      text: payload
    });

    input.value = '';
  };
}

// ── Init ────────────────────────────────────────────────
export function initMessagesPage({ thread = false, convList = false } = {}) {
  if (convList) {
    renderConversationList();
    // HTTP fallback: load conversations immediately; WS will update when ready
    Api.getConversations().then(data => {
      const msgs = Array.isArray(data) ? data : (data.messages || []);
      return handleConversationsUpdate(msgs);
    }).catch(() => {
      const el = document.getElementById('convListWrap');
      if (el && el.querySelector('.bbn-loading')) {
        el.innerHTML = '<p class="text-muted-bb small">Could not load conversations.</p>';
      }
    });
  }

  if (thread) {
    _threadInitialized = true;
    renderThread();
    setupThreadUI();
  }

  connectMsgWS();
}