// ============================================================
// bOOmbOOm.NOW! — Settings page
// ============================================================

(function () {

  // Preference keys — must match prefs.js
  var PREF_MAP_ZOOM  = 'bbm_pref_map_zoom';
  var PREF_FAV_PINS  = 'bbm_pref_show_fav_pins';

  // ── Utilities ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }

  // Decode JWT payload without verification (signature checked server-side).
  function parseJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
  }

  // Handle BSON extended-JSON date format from Rust backend.
  function parseBsonDate(val) {
    if (!val) return null;
    if (typeof val === 'string') return new Date(val);
    if (val.$date) {
      var d = val.$date;
      if (typeof d === 'string') return new Date(d);
      if (d.$numberLong) return new Date(parseInt(d.$numberLong, 10));
      if (typeof d === 'number') return new Date(d);
    }
    return null;
  }

  function formatDate(date) {
    if (!date || isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatRadius(m) {
    if (m == null) return '—';
    if (m === -1)  return 'Unlimited';
    if (m >= 1000) return (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km';
    return m + ' m';
  }

  // Read-only info row: disabled input with label
  function infoRow(label, value) {
    return [
      '<div class="mb-3" style="max-width:400px">',
      '  <label class="form-label text-muted-bb" style="font-size:0.82rem;margin-bottom:0.2rem">' + escHtml(label) + '</label>',
      '  <input class="form-control" value="' + escHtml(String(value)) + '" disabled style="opacity:0.75;cursor:default">',
      '</div>',
    ].join('');
  }

  // ── Account Info ───────────────────────────────────────────────────────────

  async function initAccountInfo() {
    var wrap = document.getElementById('accountInfoWrap');
    if (!wrap) return;

    var token  = window.Auth && window.Auth.getToken && window.Auth.getToken();
    var claims = token ? parseJwt(token) : null;
    if (!claims) {
      wrap.innerHTML = '<p class="text-muted-bb small">Log in to see account info.</p>';
      return;
    }

    var tier        = claims.tier        || 'regular';
    var role        = claims.role        || 'user';
    var accountType = claims.account_type || 'user';

    var accountTypeLabel = accountType === 'venue' ? 'Venue' : 'User';
    var roleLabel = role === 'admin'         ? 'Administrator'
                  : role === 'venue_manager' ? 'Venue Manager'
                  : null;

    var meData   = null;
    var tierData = null;
    try {
      var results = await Promise.allSettled([
        window.Api.getMe(),
        window.Api.getTierInfo(tier),
      ]);
      if (results[0].status === 'fulfilled') meData   = results[0].value;
      if (results[1].status === 'fulfilled') tierData = results[1].value;
    } catch (_) {}

    var tierLabel      = (tierData && tierData.label) || tier;
    var nearbyRadiusM  = tierData ? tierData.nearbyRadiusM  : null;
    var messageRadiusM = tierData ? tierData.messageRadiusM : null;
    var memberSince    = meData ? formatDate(parseBsonDate(meData.createdAt)) : '—';

    var rows = [];
    rows.push(infoRow('Account type', accountTypeLabel));
    if (roleLabel) rows.push(infoRow('Role', roleLabel));
    rows.push(infoRow('Membership',   tierLabel));
    rows.push(infoRow('Member since', memberSince));
    rows.push(infoRow('Nearby radius', formatRadius(nearbyRadiusM)));
    if (messageRadiusM != null) {
      rows.push(infoRow('Messaging radius', formatRadius(messageRadiusM)));
    }

    wrap.innerHTML = rows.join('');
  }

  // ── App Limits (read-only, static) ────────────────────────────────────────

  function initAppLimits() {
    var wrap   = document.getElementById('appLimitsWrap');
    var fields = document.getElementById('appLimitsFields');
    if (!wrap || !fields) return;
    if (!window.Auth || !window.Auth.isRegistered()) return;

    var rows = [
      infoRow('Messages auto-delete after',   '4 hours'),
      infoRow('Favourites expire after',       '30 days'),
      infoRow('Message length limit',          '144 characters'),
      infoRow('Guest session duration',        '15 minutes'),
    ];

    fields.innerHTML = rows.join('');
    wrap.style.display = '';
  }

  // ── User Preferences ───────────────────────────────────────────────────────

  // Write-through to localStorage via BbmPrefs (or directly if prefs.js not yet run)
  function cachePrefs(zoom, showPins) {
    if (window.BbmPrefs) window.BbmPrefs.cache(zoom, showPins);
    else { localStorage.setItem(PREF_MAP_ZOOM, zoom); localStorage.setItem(PREF_FAV_PINS, showPins ? 'true' : 'false'); }
  }

  function getPrefZoom()    { var v = localStorage.getItem(PREF_MAP_ZOOM);  return v !== null ? parseInt(v, 10) : 17; }
  function getPrefFavPins() { var v = localStorage.getItem(PREF_FAV_PINS); return v !== 'false'; }

  async function initPreferences() {
    var wrap     = document.getElementById('preferencesWrap');
    var zoomEl   = document.getElementById('prefMapZoom');
    var pinsEl   = document.getElementById('prefFavPins');
    var saveBtn  = document.getElementById('prefSaveBtn');
    var statusEl = document.getElementById('prefStatus');
    if (!wrap || !zoomEl || !pinsEl || !saveBtn) return;
    if (!window.Auth || !window.Auth.isRegistered()) return;

    // Load from server; fall back to cached/default while loading
    zoomEl.value  = getPrefZoom();
    pinsEl.checked = getPrefFavPins();
    wrap.style.display = '';

    try {
      var prefs = await window.Api.getPreferences();
      zoomEl.value   = prefs.mapZoom;
      pinsEl.checked = prefs.showFavPins;
      cachePrefs(prefs.mapZoom, prefs.showFavPins);
    } catch (_) { /* keep cached/default values */ }

    saveBtn.addEventListener('click', async function () {
      var zoom = parseInt(zoomEl.value, 10);
      if (isNaN(zoom) || zoom < 1 || zoom > 19) {
        if (statusEl) { statusEl.textContent = 'Zoom must be 1–19.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
        return;
      }
      saveBtn.disabled = true;
      if (statusEl) { statusEl.textContent = ''; }
      try {
        await window.Api.updatePreferences({ mapZoom: zoom, showFavPins: pinsEl.checked });
        cachePrefs(zoom, pinsEl.checked);
        if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--bbm-accent-green, #4c4)'; }
        setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 2500);
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || 'Could not save.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ── Blocked Users ──────────────────────────────────────────────────────────

  var wrap = null;

  async function unblock(userId, nickname, btn) {
    btn.disabled = true;
    try {
      await window.Api.unblockUser(userId);
      var card = document.getElementById('block-' + userId);
      if (card) card.remove();
      if (!wrap.querySelector('.bbm-user-card')) renderEmpty();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = err.message || 'Error';
    }
  }

  function renderEmpty() {
    wrap.innerHTML = '<p class="text-muted-bb small">No blocked users.</p>';
  }

  function renderBlocks(blocks) {
    if (!blocks.length) { renderEmpty(); return; }

    wrap.innerHTML = blocks.map(function (b) {
      var cls      = escHtml(sexClass(b.sex));
      var nickname = escHtml(b.nickname || b.userId);
      var reason   = escHtml(b.reason || '');
      var uid      = escHtml(b.userId);
      return [
        '<div class="bbm-user-card mb-2 d-flex align-items-center justify-content-between" id="block-' + uid + '">',
        '  <div>',
        '    <span class="bbm-nick ' + cls + '">' + nickname + '</span>',
        reason ? '    <span class="text-muted-bb small ms-2">' + reason + '</span>' : '',
        '  </div>',
        '  <button class="btn btn-sm btn-bbm-ghost unblock-btn" data-uid="' + uid + '" data-nick="' + nickname + '">Unblock</button>',
        '</div>',
      ].join('');
    }).join('');

    wrap.querySelectorAll('.unblock-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        unblock(btn.dataset.uid, btn.dataset.nick, btn);
      });
    });
  }

  // ── Danger Zone ────────────────────────────────────────────────────────────

  function initDangerZone() {
    var dangerWrap = document.getElementById('dangerZoneWrap');
    var deleteBtn  = document.getElementById('deleteAccountBtn');
    if (!dangerWrap || !deleteBtn) return;

    if (window.Auth && window.Auth.getToken && window.Auth.getToken()) {
      dangerWrap.style.display = '';
    }

    deleteBtn.addEventListener('click', function () {
      var input = document.getElementById('deleteNicknameInput');
      if (input) input.value = '';
      var confirmBtn = document.getElementById('confirmDeleteBtn');
      if (confirmBtn) confirmBtn.disabled = true;
      new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    wrap = document.getElementById('blocksWrap');
    if (!wrap) return;

    wrap.innerHTML = '<p class="text-muted-bb small">Loading…</p>';

    initAccountInfo();
    initAppLimits();
    initPreferences();

    try {
      var data = await window.Api.getBlocks();
      renderBlocks(data.blocks || []);
    } catch (err) {
      wrap.innerHTML = '<p class="text-muted-bb small">Could not load blocked users.</p>';
    }

    initDangerZone();
  }

  document.addEventListener('DOMContentLoaded', init);


})();
