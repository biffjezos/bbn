// ./lib/settings.js

import { Api } from './api.js';
import { Auth } from './auth.js';

// Preference keys (localStorage) — must match prefs.js
const PREF_MAP_ZOOM = 'bbn_pref_map_zoom';
const PREF_FAV_PINS = 'bbn_pref_show_fav_pins';

// ── Utilities ─────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

function formatRadius(m) {
  if (m == null) return '—';
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
}

function infoRow(label, value) {
  return `<p class="small mb-1"><span class="text-muted-bb">${escHtml(label)}:</span> ${escHtml(String(value ?? '—'))}</p>`;
}

// ── Account Info ──────────────────────────────────────────
export async function initAccountInfo() {
  const wrap = document.getElementById('accountInfoWrap');
  if (!wrap) return;

  // Immediate fallback from JWT — no loading state
  const jwt = parseJwt(Auth.getToken());
  if (jwt) {
    const rows = [];
    if (jwt.tier)                        rows.push(infoRow('Tier', jwt.tier));
    if (jwt.role && jwt.role !== 'user') rows.push(infoRow('Role', jwt.role));
    if (rows.length) wrap.innerHTML = rows.join('');
  }

  // Enrich with server data (adds email)
  try {
    const me = await Api.getMe();
    const rows = [];
    if (me.email)                        rows.push(infoRow('Email', me.email));
    if (me.tier)                         rows.push(infoRow('Tier', me.tier));
    if (me.role && me.role !== 'user')   rows.push(infoRow('Role', me.role));
    if (rows.length) wrap.innerHTML = rows.join('');
  } catch { /* JWT fallback already shown */ }
}

// ── App Limits (read-only tier info) ─────────────────────
export async function initAppLimits() {
  const wrap   = document.getElementById('appLimitsWrap');
  const fields = document.getElementById('appLimitsFields');
  if (!wrap || !fields) return;

  const tier = parseJwt(Auth.getToken())?.tier || 'guest';
  try {
    const info = await Api.getTierInfo(tier);
    const rows = [];
    if (info.nearby_radius   != null) rows.push(infoRow('Nearby radius',  formatRadius(info.nearby_radius)));
    if (info.message_radius  != null) rows.push(infoRow('Message radius', formatRadius(info.message_radius)));
    if (rows.length) {
      fields.innerHTML = rows.join('');
      wrap.style.display = '';
    }
  } catch { /* silently skip */ }
}

// ── Preferences (localStorage) ───────────────────────────
export async function initPreferences() {
  const wrap     = document.getElementById('preferencesWrap');
  const zoomEl   = document.getElementById('prefMapZoom');
  const favPinsEl = document.getElementById('prefFavPins');
  const saveBtn  = document.getElementById('prefSaveBtn');
  const statusEl = document.getElementById('prefStatus');
  if (!wrap || !zoomEl || !favPinsEl || !saveBtn) return;

  wrap.style.display = '';
  zoomEl.value    = localStorage.getItem(PREF_MAP_ZOOM) || '17';
  favPinsEl.checked = localStorage.getItem(PREF_FAV_PINS) !== 'false';

  saveBtn.onclick = () => {
    const zoom = parseInt(zoomEl.value, 10);
    if (isNaN(zoom) || zoom < 1 || zoom > 19) {
      if (statusEl) statusEl.textContent = 'Zoom must be 1–19.';
      return;
    }
    localStorage.setItem(PREF_MAP_ZOOM, String(zoom));
    localStorage.setItem(PREF_FAV_PINS, String(favPinsEl.checked));
    if (statusEl) {
      statusEl.textContent = 'Saved.';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  };
}

// ── Blocked Users ─────────────────────────────────────────
export async function initBlockedUsers() {
  const wrap = document.getElementById('blocksWrap');
  if (!wrap) return;

  wrap.innerHTML = '<p class="text-muted-bb small">Loading…</p>';

  try {
    const { blocks = [] } = await Api.getBlocks();

    if (blocks.length === 0) {
      wrap.innerHTML = '<p class="text-muted-bb small">No blocked users.</p>';
      return;
    }

    function renderBlocks(list) {
      wrap.innerHTML = list.map(b => `
        <div class="d-flex align-items-center justify-content-between mb-2" data-blocked-id="${escHtml(b.userId)}">
          <span class="small">${escHtml(b.nickname || b.userId)}</span>
          <button class="btn btn-sm btn-bbn-ghost unblock-btn" data-uid="${escHtml(b.userId)}">Unblock</button>
        </div>`).join('');

      wrap.querySelectorAll('.unblock-btn').forEach(btn => {
        btn.onclick = async () => {
          const uid = btn.dataset.uid;
          btn.disabled = true;
          try {
            await Api.unblockUser(uid);
            btn.closest('[data-blocked-id]').remove();
            if (!wrap.querySelector('[data-blocked-id]')) {
              wrap.innerHTML = '<p class="text-muted-bb small">No blocked users.</p>';
            }
          } catch { btn.disabled = false; }
        };
      });
    }

    renderBlocks(blocks);
  } catch {
    wrap.innerHTML = '<p class="text-muted-bb small">Could not load blocked users.</p>';
  }
}

// ── Danger Zone ───────────────────────────────────────────
export function initDangerZone() {
  const wrap    = document.getElementById('dangerZoneWrap');
  const openBtn = document.getElementById('deleteAccountBtn');
  const modal   = document.getElementById('deleteConfirmModal');
  const input   = document.getElementById('deleteNicknameInput');
  const confBtn = document.getElementById('confirmDeleteBtn');
  if (!wrap || !openBtn || !modal || !input || !confBtn) return;

  wrap.style.display = '';

  // Enable confirm button only when nickname matches
  input.addEventListener('input', () => {
    confBtn.disabled = input.value.trim() !== Auth.getNickname();
  });

  // Reset on modal close
  modal.addEventListener('hidden.bs.modal', () => {
    input.value = '';
    confBtn.disabled = true;
  });

  openBtn.onclick = () => {
    input.value = '';
    confBtn.disabled = true;
    bootstrap.Modal.getOrCreateInstance(modal).show();
  };

  confBtn.onclick = async () => {
    confBtn.disabled = true;
    try {
      await Auth.deleteAccount();
    } catch (err) {
      console.error('[Settings] deleteAccount failed:', err.message);
      confBtn.disabled = false;
    }
  };
}

// ── Top-level initializer ─────────────────────────────────
export async function initSettings() {
  if (!Auth.isRegistered()) return;

  // No API dependency — show immediately
  initPreferences();
  initDangerZone();

  // API-dependent sections run in parallel (don't block each other or preferences)
  await Promise.allSettled([initAccountInfo(), initAppLimits(), initBlockedUsers()]);
}
