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
    return ['user', 'admin'].includes(payload.role);
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

function toggleMeet(uid, nickname, sex) {
  if (getMeetUid() === uid) {
    localStorage.removeItem('bbm_meet');
  } else {
    localStorage.setItem('bbm_meet', JSON.stringify({ uid, nickname, sex: sex || null }));
  }
  renderFavourites();
}

// ── Search query parser ───────────────────────────────────────
// Supported tokens: age:33  age:<30  age:<=30  age:>20  age:>=20  age:18-25
//                   sex:m/f  online:yes/no  (remaining words = nickname text)
// Spaces around : and operators are allowed: "age: < 49 sex: f"

function parseSearchQuery(raw) {
  const result = { text: '', ageMin: null, ageMax: null, sex: null, online: null };
  const textParts = [];

  // Normalise spaces within filter tokens so "age: < 49" → "age:<49"
  const normalised = raw
    .replace(/\b(age|sex|online)\s*:\s*/gi, (_, k) => k.toLowerCase() + ':')
    .replace(/\bage:([<>]=?)\s*(\d)/g, 'age:$1$2')
    .replace(/\bage:(\d+)\s*-\s*(\d+)/g, 'age:$1-$2');

  for (const part of normalised.trim().split(/\s+/).filter(Boolean)) {
    const lo = part.toLowerCase();

    const rangeM = lo.match(/^age:(\d+)-(\d+)$/);
    if (rangeM) { result.ageMin = parseInt(rangeM[1]); result.ageMax = parseInt(rangeM[2]); continue; }

    // <= and >= (inclusive) — check before < and >
    const lteM = lo.match(/^age:<=(\d+)$/);
    if (lteM) { result.ageMax = parseInt(lteM[1]); continue; }

    const gteM = lo.match(/^age:>=(\d+)$/);
    if (gteM) { result.ageMin = parseInt(gteM[1]); continue; }

    // < and > (exclusive) — adjust by ±1 since ages are integers
    const ltM = lo.match(/^age:<(\d+)$/);
    if (ltM) { result.ageMax = parseInt(ltM[1]) - 1; continue; }

    const gtM = lo.match(/^age:>(\d+)$/);
    if (gtM) { result.ageMin = parseInt(gtM[1]) + 1; continue; }

    const exactM = lo.match(/^age:(\d+)$/);
    if (exactM) { result.ageMin = result.ageMax = parseInt(exactM[1]); continue; }

    if (lo === 'sex:m' || lo === 'sex:f') { result.sex = lo.slice(4); continue; }

    if (lo === 'online:yes') { result.online = true;  continue; }
    if (lo === 'online:no')  { result.online = false; continue; }

    textParts.push(part);
  }

  result.text = textParts.join(' ');
  return result;
}

// ── Client-side filter (for already-loaded favourites) ────────
// Favourites have: userId, nickname, sex, online (no age available)

function matchesFav(f, q) {
  if (q.text    && !f.nickname.toLowerCase().includes(q.text.toLowerCase())) return false;
  if (q.sex     && f.sex !== q.sex)    return false;
  if (q.online  !== null && f.online !== q.online) return false;
  // age not available on favourites — skip
  return true;
}

// ── Render helpers ────────────────────────────────────────────

function fmtRangeDate(iso) {
  const d   = new Date(iso);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = `${d.getDate()} ${months[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${day} ${d.getFullYear()}`;
}

function favItemHtml(f, isFav, unreadIds = new Set(), blockedIds = new Set()) {
  const _base       = window.BOOMBOOM_BASE || '';
  const profileHref = `${_base}/profile/view/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
  const threadHref  = `${_base}/messages/thread/?uid=${encodeURIComponent(f.userId)}&name=${encodeURIComponent(f.nickname)}`;
  const meetUid     = getMeetUid();
  const isMeet      = meetUid === f.userId;
  const isBlocked   = blockedIds.has(f.userId);
  const badge       = f.online
    ? '<span class="badge badge-online">online</span>'
    : '<span class="badge badge-offline">offline</span>';
  const ageBadge    = f.age ? `<span class="text-muted-bb ms-1 small">${escHtml(String(f.age))}</span>` : '';
  const meetCls     = isMeet ? 'fav-meet-btn active' : 'fav-meet-btn';
  const meetTitle   = isMeet ? 'Cancel meeting' : 'Set as meeting target';
  const meetIcon    = isMeet ? 'bi-compass-fill' : 'bi-compass';
  const hasUnread   = unreadIds.has(f.userId);
  const msgCls      = `fav-msg-btn${hasUnread ? ' fav-msg--unread' : ''}`;
  const canMsg      = !isBlocked && f.withinRange === true;
  const msgBtnHtml  = canMsg
    ? `<a href="${threadHref}" class="btn fav-action-btn ${msgCls}" title="Message"><i class="bi bi-chat-dots"></i></a>`
    : `<span class="btn fav-action-btn fav-msg--disabled" title="${isBlocked ? 'User blocked' : 'Not in range'}"><i class="bi bi-chat-dots"></i></span>`;

  let rangeLine = '';
  if (isBlocked) {
    rangeLine = ' <span class="badge bg-secondary">blocked</span>';
  } else if (f.withinRange === true) {
    rangeLine = ' <span class="badge badge-in-range">in range</span>';
  } else if (f.withinRangeAt) {
    rangeLine = ` <span class="fav-range-hint">Last in range: ${fmtRangeDate(f.withinRangeAt)}</span>`;
  }

  const rightBtns = isFav
    ? `<button class="btn fav-action-btn ${meetCls}"
         data-userid="${escHtml(f.userId)}" data-nickname="${escHtml(f.nickname)}" data-sex="${escHtml(f.sex || '')}"
         title="${meetTitle}"><i class="bi ${meetIcon}"></i></button>
       ${msgBtnHtml}
       <button class="btn fav-action-btn fav-remove-btn" data-userid="${escHtml(f.userId)}" title="Remove">
         <i class="bi bi-star-fill"></i></button>`
    : `<button class="btn fav-action-btn fav-add-btn" data-userid="${escHtml(f.userId)}" data-nickname="${escHtml(f.nickname)}" title="Add to favourites">
         <i class="bi bi-star"></i></button>
       ${msgBtnHtml}`;

  return `<div class="fav-item ${sexClass(f.sex)}" data-userid="${escHtml(f.userId)}">
    <a href="${profileHref}" class="fav-avatar ${sexClass(f.sex)}" style="text-decoration:none">${sexEmoji(f.sex)}</a>
    <div class="flex-grow-1 min-w-0">
      <div class="d-flex align-items-baseline gap-1 flex-wrap">
        <a href="${profileHref}" class="fav-name text-decoration-none text-white">${escHtml(f.nickname)}</a>${ageBadge}
      </div>
      <div class="mt-1">${badge}${rangeLine}</div>
    </div>
    <div class="fav-actions">${rightBtns}</div>
  </div>`;
}

function sectionHtml(title, items, isFav, unreadIds = new Set(), blockedIds = new Set()) {
  if (!items.length) return '';
  return `<div class="bbm-search-section mb-2">
    <div class="bbm-search-section-label text-muted-bb small mb-1">${escHtml(title)}</div>
    ${items.map(f => favItemHtml(f, isFav, unreadIds, blockedIds)).join('')}
  </div>`;
}

// ── State ─────────────────────────────────────────────────────

let cachedFavourites = null; // loaded once; invalidated on add/remove
let cachedBlockedIds = null; // Set<userId>, same lifecycle as cachedFavourites
let searchDebounce   = null;

// ── Main render ───────────────────────────────────────────────

async function renderFavourites(forceReload = false) {
  const wrap = document.getElementById('favListWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-star"></i>
      <p>Log in to see your favourites.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  // Fetch favourites and blocked IDs if needed
  if (!cachedFavourites || forceReload) {
    wrap.innerHTML = loadingHtml('Loading favourites…');
    try {
      const { favourites = [] } = await window.Api.getFavourites();
      cachedFavourites = favourites;
    } catch (err) {
      if (err.status === 403) {
        wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-lock"></i><p class="text-muted-bb mt-2">This feature is currently limited.</p></div>`;
      } else {
        wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
      }
      return;
    }
    try {
      const { blocks = [] } = await window.Api.getBlocks();
      cachedBlockedIds = new Set(blocks.map(b => b.userId));
    } catch {
      cachedBlockedIds = new Set();
    }
  }

  const blockedIds = cachedBlockedIds || new Set();
  const rawQuery = document.getElementById('favSearch')?.value || '';
  const q        = parseSearchQuery(rawQuery);
  const hasQuery = rawQuery.trim().length > 0;

  if (!hasQuery) {
    await renderFavList(wrap, cachedFavourites, blockedIds);
  } else {
    await renderSearchResults(wrap, q, rawQuery, blockedIds);
  }

  bindListEvents(wrap);
}

async function renderFavList(wrap, favourites, blockedIds = new Set()) {
  if (!favourites.length) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-star"></i>
      <p>No favourites yet.<br>Tap a user on the map to add them.</p></div>`;
    return;
  }
  const unreadIds = await fetchUnreadIds();
  wrap.innerHTML = favourites.map(f => favItemHtml(f, true, unreadIds, blockedIds)).join('');
}

async function renderSearchResults(wrap, q, rawQuery, blockedIds = new Set()) {
  const favIds = new Set((cachedFavourites || []).map(f => f.userId));

  // Client-side filter on favourites
  const matchedFavs = (cachedFavourites || []).filter(f => matchesFav(f, q));

  // Global search
  wrap.innerHTML = loadingHtml('Searching…');
  let globalUsers = [];
  try {
    const params = {};
    if (q.text)            params.nickname = q.text;
    if (q.ageMin != null)  params.ageMin   = q.ageMin;
    if (q.ageMax != null)  params.ageMax   = q.ageMax;
    if (q.sex    != null)  params.sex      = q.sex;
    if (q.online != null)  params.online   = q.online;

    const { users = [] } = await window.Api.searchUsers(params);
    globalUsers = users.filter(u => !favIds.has(u.userId));
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger mt-3">${escHtml(err.message)}</div>`;
    return;
  }

  if (!matchedFavs.length && !globalUsers.length) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-search"></i><p>No users found for <em>${escHtml(rawQuery)}</em></p></div>`;
    return;
  }

  const unreadIds = await fetchUnreadIds();
  wrap.innerHTML =
    sectionHtml('In your favourites', matchedFavs, true,  unreadIds, blockedIds) +
    sectionHtml('Other users',        globalUsers, false, unreadIds, blockedIds);
}

function bindListEvents(wrap) {
  wrap.querySelectorAll('.fav-meet-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleMeet(btn.dataset.userid, btn.dataset.nickname, btn.dataset.sex));
  });

  wrap.querySelectorAll('.fav-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (getMeetUid() === btn.dataset.userid) localStorage.removeItem('bbm_meet');
      try {
        await window.Api.removeFavourite(btn.dataset.userid);
        cachedFavourites = null; cachedBlockedIds = null;
        await renderFavourites(true);
      } catch (err) { alert('Error: ' + err.message); }
    });
  });

  wrap.querySelectorAll('.fav-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await window.Api.addFavourite(btn.dataset.userid);
        cachedFavourites = null; cachedBlockedIds = null;
        // Re-run search so the new fav appears in the favourites section
        await renderFavourites();
      } catch (err) { alert('Error: ' + err.message); }
    });
  });
}

// ── Unread message detection ──────────────────────────────

async function fetchUnreadIds() {
  try {
    const { conversations = [] } = await window.Api.getConversations();
    return new Set(
      conversations.filter(c => c.hasUnread || c.unread).map(c => c.userId)
    );
  } catch { return new Set(); }
}

// ── Search bar wiring ─────────────────────────────────────────

function initSearchBar() {
  const wrap  = document.getElementById('favSearchWrap');
  const input = document.getElementById('favSearch');
  const clear = document.getElementById('favSearchClear');
  if (!wrap || !input || !clear) return;

  const sex = window.Auth?.getSex?.();
  if (sex === 'm') wrap.classList.add('bbm-search--male');
  else if (sex === 'f') wrap.classList.add('bbm-search--female');

  wrap.style.display = '';

  input.addEventListener('input', () => {
    clear.style.display = input.value ? '' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderFavourites(), 350);
  });

  clear.addEventListener('click', () => {
    input.value        = '';
    clear.style.display = 'none';
    renderFavourites();
  });
}

// ── Boot ──────────────────────────────────────────────────────

(window.__authReady || Promise.resolve()).then(function () {
  if (isRegistered()) initSearchBar();
  renderFavourites();
});
