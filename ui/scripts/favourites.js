// ============================================================
// bOOmbOOm.NOW! — Favourites page module
// ============================================================

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── Meeting mode ──────────────────────────────────────────────

function getMeetUid() {
  try { return JSON.parse(localStorage.getItem('bbm_meet') || 'null')?.uid || null; } catch { return null; }
}

function toggleMeet(uid, nickname) {
  if (getMeetUid() === uid) {
    localStorage.removeItem('bbm_meet');
  } else {
    localStorage.setItem('bbm_meet', JSON.stringify({ uid, nickname }));
  }
  renderFavourites();
}

// ── Render ────────────────────────────────────────────────────

async function renderFavourites() {
  const wrap = document.getElementById('favListWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-star"></i>
      <p>Log in to see your favourites.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  wrap.innerHTML = loadingHtml('Loading favourites…');

  try {
    console.log('[Favourites] Fetching /favourites');
    const { favourites = [] } = await window.Api.getFavourites();
    console.log('[Favourites] Got', favourites.length, 'favourites');

    if (favourites.length === 0) {
      wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-star"></i>
        <p>No favourites yet.<br>Tap a user on the map to add them.</p></div>`;
      return;
    }

    const meetUid = getMeetUid();

    wrap.innerHTML = favourites.map(f => {
      const _base       = window.BOOMBOOM_BASE || '';
      const profileHref = `${_base}/profile/view/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
      const threadHref  = `${_base}/messages/thread/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
      const isMeet      = meetUid === f.userId;
      const badge       = f.online
        ? '<span class="badge badge-online ms-2">online</span>'
        : '<span class="badge badge-offline ms-2">offline</span>';
      const meetCls     = isMeet ? 'fav-meet-btn active' : 'fav-meet-btn';
      const meetTitle   = isMeet ? 'Cancel meeting' : 'Set as meeting target';
      const meetIcon    = isMeet ? 'bi-compass-fill' : 'bi-compass';

      return `<div class="fav-item" data-userid="${escHtml(f.userId)}">
        <a href="${profileHref}" class="fav-avatar ${sexClass(f.sex)}" style="text-decoration:none">${sexEmoji(f.sex)}</a>
        <div class="flex-grow-1 min-w-0">
          <a href="${profileHref}" class="fav-name text-decoration-none text-white">${escHtml(f.nickname)}</a>${badge}
        </div>
        <div class="fav-actions">
          <button class="btn btn-bbm-ghost btn-sm ${meetCls}"
            data-userid="${escHtml(f.userId)}"
            data-nickname="${escHtml(f.nickname)}"
            title="${meetTitle}">
            <i class="bi ${meetIcon}"></i>
          </button>
          <a href="${threadHref}" class="btn btn-bbm-outline-pink btn-sm" title="Message"><i class="bi bi-chat-dots"></i></a>
          <button class="btn btn-bbm-ghost btn-sm fav-remove-btn" data-userid="${escHtml(f.userId)}" title="Remove">
            <i class="bi bi-star-fill text-pink"></i>
          </button>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('.fav-meet-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleMeet(btn.dataset.userid, btn.dataset.nickname));
    });

    wrap.querySelectorAll('.fav-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        // Clear meeting mode if this fav was the target
        if (getMeetUid() === btn.dataset.userid) localStorage.removeItem('bbm_meet');
        try {
          await window.Api.removeFavourite(btn.dataset.userid);
          await renderFavourites();
        } catch (err) { alert('Error: ' + err.message); }
      });
    });

  } catch (err) {
    if (err.status === 403) {
      wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-lock"></i><p class="text-muted-bb mt-2">This feature is currently limited.</p></div>`;
    } else {
      wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
    }
  }
}

// Auto-run when loaded as extra_js
(window.__authReady || Promise.resolve()).then(function() { renderFavourites(); });
