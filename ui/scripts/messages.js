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

// ── Conversation list ─────────────────────────────────────
async function renderConversationList() {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
      <p>Log in to see your conversations.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  if (window.requireUnlocked && !window.requireUnlocked()) {
    var lockEl = document.getElementById('lockModal');
    if (lockEl) {
      lockEl.addEventListener('hidden.bs.modal', function onUnlock() {
        lockEl.removeEventListener('hidden.bs.modal', onUnlock);
        if (window.BBMCrypto?.isUnlocked()) renderConversationList();
      });
    }
    return;
  }

  wrap.innerHTML = loadingHtml('Loading conversations…');

  try {
    const { messages = [] } = await window.Api.getConversations();

    if (messages.length === 0) {
      wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
        <p>No conversations yet.<br>Find someone on the map and say hi!</p></div>`;
      return;
    }

    // getMyId() called here — guaranteed to have a valid user token at this point
    const myId = getMyId();
    const threads = {};
    messages.forEach(m => {
      const partnerId = m.fromUserId === myId ? m.toUserId : m.fromUserId;
      if (!threads[partnerId] || new Date(m.sentAt) > new Date(threads[partnerId].latest.sentAt)) {
        threads[partnerId] = { userId: partnerId, latest: m };
      }
    });

    const partnerIds = Object.keys(threads);
    const profiles   = await Promise.allSettled(partnerIds.map(uid => window.Api.getProfile(uid)));
    partnerIds.forEach((uid, i) => {
      const r = profiles[i];
      threads[uid].nickname  = r.status === 'fulfilled' ? (r.value.nickname || uid) : uid;
      threads[uid].sex       = r.status === 'fulfilled' ? (r.value.sex || null) : null;
      threads[uid].publicKey = r.status === 'fulfilled' ? (r.value.publicKey || null) : null;
    });

    await Promise.all(Object.values(threads).map(async t => {
      try {
        const payload = JSON.parse(t.latest.text);
        if (payload.cipher) {
          t.preview = await decryptFrom(payload, t.latest.fromUserId, t.latest.toUserId);
        } else {
          t.preview = t.latest.text;
        }
      } catch {
        t.preview = t.latest.text;
      }
    }));

    wrap.innerHTML = Object.values(threads)
      .sort((a, b) => new Date(b.latest.sentAt) - new Date(a.latest.sentAt))
      .map(t => {
        const href = `/messages/thread/?uid=${encodeURIComponent(t.userId)}&name=${encodeURIComponent(t.nickname)}`;
        return `<a href="${href}" class="conv-item">
          <div class="conv-avatar ${sexClass(t.sex)}">${sexEmoji(t.sex)}</div>
          <div class="conv-body">
            <div class="conv-name">${escHtml(t.nickname)}</div>
            <div class="conv-preview">${escHtml(t.preview || t.latest.text)}</div>
          </div>
          <div class="conv-meta">${timeAgo(t.latest.sentAt)}<i class="bi bi-chevron-right d-block text-faint mt-1"></i></div>
        </a>`;
      }).join('');

  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
  }
}

// ── Message thread ────────────────────────────────────────
async function renderThread() {
  const params      = new URLSearchParams(window.location.search);
  const userId      = params.get('uid');
  const displayName = params.get('name') || userId;

  const nameEl = document.getElementById('threadDisplayName');
  if (nameEl) nameEl.textContent = displayName;

  if (!isRegistered() || !userId) {
    window.location.href = isRegistered() ? '/messages/' : '/';
    return;
  }

  if (window.requireUnlocked && !window.requireUnlocked()) {
    var lockEl = document.getElementById('lockModal');
    if (lockEl) {
      lockEl.addEventListener('hidden.bs.modal', function onUnlock() {
        lockEl.removeEventListener('hidden.bs.modal', onUnlock);
        if (window.BBMCrypto?.isUnlocked()) renderThread();
      });
    }
    return;
  }

  const msgsEl    = document.getElementById('threadMsgs');
  const inputEl   = document.getElementById('msgInput');
  const sendBtn   = document.getElementById('sendBtn');
  const charCount = document.getElementById('charCount');
  const sendError = document.getElementById('sendError');
  let   pollTimer = null;

  async function load() {
    // getMyId() called fresh on every load/poll — always reflects current token (US2 fix)
    const myId = getMyId();
    try {
      const { messages = [] } = await window.Api.getConversation(userId);
      if (!msgsEl) return;

      if (messages.length === 0) {
        msgsEl.innerHTML = `<div class="bbm-empty" style="padding:2rem 0">
          <i class="bi bi-chat-heart"></i><p>No messages yet. Say hi!</p></div>`;
        return;
      }

      const decrypted = await Promise.all(messages.map(async m => ({
        ...m,
        text: await decodeMessage(m, userId),
      })));

      msgsEl.innerHTML = decrypted.map(m => {
        const out = m.fromUserId === myId;
        return `<div class="d-flex ${out ? 'justify-content-end' : 'justify-content-start'}">
          <div>
            <div class="message-bubble ${out ? 'outgoing' : 'incoming'}">${escHtml(m.text)}</div>
            <div class="message-expiry ${out ? 'text-end' : ''}">expires ${timeUntil(m.expiresAt)}</div>
          </div>
        </div>`;
      }).join('');

      msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch { /* silent on poll */ }
  }

  inputEl?.addEventListener('input', function () {
    const rem = 144 - this.value.length;
    if (charCount) { charCount.textContent = rem; charCount.style.color = rem < 0 ? '#ff8a80' : ''; }
  });
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendBtn?.click(); }
  });

  sendBtn?.addEventListener('click', async () => {
    const text = inputEl?.value.trim();
    if (!text) return;
    sendError?.classList.add('d-none');

    if (!window.requireUnlocked?.()) return;

    try {
      const encrypted = await encryptFor(text, userId);
      const body = JSON.stringify(encrypted);
      await window.Api.sendMessage(userId, body);
      if (inputEl) inputEl.value = '';
      if (charCount) charCount.textContent = '144';
      await load();
    } catch (err) {
      if (sendError) { sendError.textContent = err.message; sendError.classList.remove('d-none'); }
    }
  });

  await load();
  pollTimer = setInterval(load, 5000);
  window.addEventListener('beforeunload', () => clearInterval(pollTimer), { once: true });
}

// Auto-run when loaded as extra_js
(window.__authReady || Promise.resolve()).then(function() {
  if (document.getElementById('convListWrap'))  renderConversationList();
  if (document.getElementById('threadMsgs'))    renderThread();
});
