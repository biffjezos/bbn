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

// Check registered by JWT role — Auth.isRegistered() may not exist
function isRegistered() {
  try {
    if (typeof window.Auth?.isRegistered === 'function') return window.Auth.isRegistered();
    const payload = JSON.parse(atob(window.Auth.getToken().split('.')[1]));
    return payload.role === 'user';
  } catch { return false; }
}

function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)  { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }

function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── Conversation list ─────────────────────────────────────
export async function renderConversationList() {
  const wrap = document.getElementById('convListWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-chat-dots"></i>
      <p>Log in to see your conversations.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
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
      threads[uid].nickname = r.status === 'fulfilled' ? (r.value.nickname || uid) : uid;
      threads[uid].sex      = r.status === 'fulfilled' ? (r.value.sex || null) : null;
    });

    wrap.innerHTML = Object.values(threads)
      .sort((a, b) => new Date(b.latest.sentAt) - new Date(a.latest.sentAt))
      .map(t => {
        const href = `/messages/thread/?uid=${encodeURIComponent(t.userId)}&name=${encodeURIComponent(t.nickname)}`;
        return `<a href="${href}" class="conv-item">
          <div class="conv-avatar ${sexClass(t.sex)}">${sexEmoji(t.sex)}</div>
          <div class="conv-body">
            <div class="conv-name">${escHtml(t.nickname)}</div>
            <div class="conv-preview">${escHtml(t.latest.text)}</div>
          </div>
          <div class="conv-meta">${timeAgo(t.latest.sentAt)}<i class="bi bi-chevron-right d-block text-faint mt-1"></i></div>
        </a>`;
      }).join('');

  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
  }
}

// ── Message thread ────────────────────────────────────────
export async function renderThread() {
  const params      = new URLSearchParams(window.location.search);
  const userId      = params.get('uid');
  const displayName = params.get('name') || userId;

  const nameEl = document.getElementById('threadDisplayName');
  if (nameEl) nameEl.textContent = displayName;

  if (!isRegistered() || !userId) {
    window.location.href = isRegistered() ? '/messages/' : '/';
    return;
  }

  const msgsEl    = document.getElementById('threadMsgs');
  const inputEl   = document.getElementById('msgInput');
  const sendBtn   = document.getElementById('sendBtn');
  const charCount = document.getElementById('charCount');
  const sendError = document.getElementById('sendError');
  const myId      = getMyId();
  let   pollTimer = null;

  async function load() {
    try {
      const { messages = [] } = await window.Api.getConversation(userId);
      if (!msgsEl) return;

      if (messages.length === 0) {
        msgsEl.innerHTML = `<div class="bbm-empty" style="padding:2rem 0">
          <i class="bi bi-chat-heart"></i><p>No messages yet. Say hi!</p></div>`;
        return;
      }

      msgsEl.innerHTML = messages.map(m => {
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
    try {
      await window.Api.sendMessage(userId, text);
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