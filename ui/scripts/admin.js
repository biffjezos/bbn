// ============================================================
// bOOmbOOm.NOW! — Admin Panel
// ============================================================

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getAdminRole() {
  try {
    var p = JSON.parse(atob(window.Auth.getToken().split('.')[1]));
    return p.role;
  } catch (e) { return null; }
}

// ── Tier cache (for user card dropdown) ──────────────────────

var _cachedTiers = [];

async function _loadTiers() {
  try {
    var data = await window.Api.adminListTiers();
    _cachedTiers = (data.tiers || []).slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
  } catch (e) {
    _cachedTiers = [];
  }
}

function _tierCls(tierName) {
  var t = _cachedTiers.find(function (t) { return t.name === tierName; });
  return t && t.cls ? t.cls : 'secondary';
}

function _buildTierSelect(uid, currentTier) {
  if (!_cachedTiers.length) {
    return '<input type="text" class="form-control form-control-sm" id="tier-' + escHtml(uid) + '"'
      + ' value="' + escHtml(currentTier) + '" placeholder="e.g. premium" />';
  }
  var opts = _cachedTiers.map(function (t) {
    return '<option value="' + escHtml(t.name) + '"' + (t.name === currentTier ? ' selected' : '') + '>'
      + escHtml(t.label || t.name) + '</option>';
  });
  if (!_cachedTiers.some(function (t) { return t.name === currentTier; })) {
    opts.unshift('<option value="' + escHtml(currentTier) + '" selected>' + escHtml(currentTier) + '</option>');
  }
  return '<select class="form-select form-select-sm" id="tier-' + escHtml(uid) + '">' + opts.join('') + '</select>';
}

// ── Bootstrap ────────────────────────────────────────────────

async function initAdmin() {
  var panel = document.getElementById('adminPanel');
  if (!panel) return;

  if (getAdminRole() !== 'admin') {
    panel.innerHTML = '<div class="alert alert-danger mt-4">Access denied.</div>';
    return;
  }

  panel.innerHTML = [
    '<ul class="nav nav-tabs mt-4 mb-4" id="adminTabs" role="tablist">',
    '  <li class="nav-item" role="presentation">',
    '    <button class="nav-link active" data-tab="users" type="button">',
    '      <i class="bi bi-people me-2"></i>Users</button>',
    '  </li>',
    '  <li class="nav-item" role="presentation">',
    '    <button class="nav-link" data-tab="tiers" type="button">',
    '      <i class="bi bi-layers me-2"></i>Tiers</button>',
    '  </li>',
    '  <li class="nav-item" role="presentation">',
    '    <button class="nav-link" data-tab="roles" type="button">',
    '      <i class="bi bi-person-badge me-2"></i>Roles</button>',
    '  </li>',
    '</ul>',
    '<div id="adminTabContent"></div>',
  ].join('');

  panel.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      panel.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      if (btn.dataset.tab === 'users') renderUsersTab();
      else if (btn.dataset.tab === 'tiers') renderTiersTab();
      else renderRolesTab();
    });
  });

  renderUsersTab();
}

// ── Users tab ────────────────────────────────────────────────

async function renderUsersTab() {
  await _loadTiers();
  var content = document.getElementById('adminTabContent');
  content.innerHTML = [
    '<div class="row g-3 mb-4">',
    '  <div class="col-12 col-md-7">',
    '    <div class="input-group">',
    '      <input type="text" class="form-control" id="adminUserSearch" placeholder="Search users…" />',
    '      <select class="form-select" id="adminSearchBy" style="max-width:150px">',
    '        <option value="nickname">Nickname</option>',
    '        <option value="email">Email</option>',
    '        <option value="id">User ID</option>',
    '      </select>',
    '      <button class="btn btn-bbm-primary" id="adminSearchBtn"><i class="bi bi-search me-1"></i>Search</button>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div id="adminUserResults"></div>',
  ].join('');

  document.getElementById('adminSearchBtn').addEventListener('click', runUserSearch);
  document.getElementById('adminUserSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') runUserSearch();
  });
}

async function runUserSearch() {
  var q   = document.getElementById('adminUserSearch').value.trim();
  var by  = document.getElementById('adminSearchBy').value;
  var out = document.getElementById('adminUserResults');
  out.innerHTML = '<p class="text-muted-bb small">Searching…</p>';
  try {
    var data = await window.Api.adminSearchUsers({ q: q || undefined, by: by });
    if (!data.users || !data.users.length) {
      out.innerHTML = '<p class="text-muted-bb small">No results.</p>';
      return;
    }
    out.innerHTML = data.users.map(renderUserCard).join('');
    out.querySelectorAll('[data-toggle-card]').forEach(function (el) {
      el.addEventListener('click', function () { toggleUserCard(el.dataset.toggleCard); });
    });
    out.querySelectorAll('[data-save-user]').forEach(function (btn) {
      btn.addEventListener('click', function () { saveUserChanges(btn.dataset.saveUser); });
    });
    out.querySelectorAll('[data-copy-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(btn.dataset.copyId).then(function () {
          var icon = btn.querySelector('i');
          if (icon) { icon.className = 'bi bi-clipboard-check'; setTimeout(function () { icon.className = 'bi bi-clipboard'; }, 2000); }
        }).catch(function () {});
      });
    });
    out.querySelectorAll('[data-convert-venue]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var uid = btn.dataset.convertVenue;
        var form = document.getElementById('venue-form-' + uid);
        if (form) form.classList.toggle('d-none');
      });
    });
    out.querySelectorAll('[data-cancel-venue]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var uid = btn.dataset.cancelVenue;
        var form = document.getElementById('venue-form-' + uid);
        if (form) form.classList.add('d-none');
      });
    });
    out.querySelectorAll('[data-save-venue]').forEach(function (btn) {
      btn.addEventListener('click', function () { saveVenueConversion(btn.dataset.saveVenue); });
    });
    out.querySelectorAll('[data-revert-venue]').forEach(function (btn) {
      btn.addEventListener('click', function () { revertVenue(btn.dataset.revertVenue); });
    });
  } catch (err) {
    out.innerHTML = '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
  }
}

function renderUserCard(u) {
  var dot = u.online
    ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#00e5a0;margin-right:6px;vertical-align:middle"></span>'
    : '';
  var adminBadge = u.role === 'admin'
    ? '<span class="badge bg-danger ms-1" style="font-size:0.65rem">admin</span>'
    : '';
  return [
    '<div class="bbm-section mb-3" id="ucard-' + escHtml(u.userId) + '">',
    '  <div class="d-flex align-items-center justify-content-between gap-3"',
    '       style="cursor:pointer" data-toggle-card="' + escHtml(u.userId) + '">',
    '    <div class="text-truncate">',
    '      ' + dot + '<strong>' + escHtml(u.nickname) + '</strong>',
    '      <span class="text-muted-bb ms-2" style="font-size:0.78rem">' + escHtml(u.email) + '</span>',
    '      <span class="badge bg-' + escHtml(_tierCls(u.tier)) + ' ms-2" style="font-size:0.65rem">' + escHtml(u.tier) + '</span>',
    '      ' + adminBadge,
    '    </div>',
    '    <i class="bi bi-chevron-down text-muted flex-shrink-0"></i>',
    '  </div>',
    '  <div class="d-none mt-3 pt-3" style="border-top:1px solid var(--bbm-border)"',
    '       id="uexpand-' + escHtml(u.userId) + '">',
    '    <div class="row g-3 mb-3">',
    '      <div class="col-12 col-sm-6 col-md-4">',
    '        <div class="small text-muted-bb mb-1">User ID</div>',
    '        <div class="d-flex align-items-center gap-1">',
    '          <code style="font-size:0.72rem;word-break:break-all">' + escHtml(u.userId) + '</code>',
    '          <button class="btn btn-bbm-ghost btn-sm p-0 px-1" data-copy-id="' + escHtml(u.userId) + '" title="Copy ID" style="line-height:1">',
    '            <i class="bi bi-clipboard" style="font-size:0.72rem"></i>',
    '          </button>',
    '        </div>',
    '      </div>',
    '      <div class="col-6 col-md-2">',
    '        <div class="small text-muted-bb mb-1">Age / Sex</div>',
    '        <div>' + escHtml(u.age != null ? String(u.age) : '—') + ' / ' + escHtml(u.sex || '—') + '</div>',
    '      </div>',
    '      <div class="col-6 col-md-2">',
    '        <div class="small text-muted-bb mb-1">Token version</div>',
    '        <div>' + escHtml(String(u.tokenVersion)) + '</div>',
    '      </div>',
    '      <div class="col-6 col-md-2">',
    '        <label class="form-label small mb-1" for="tier-' + escHtml(u.userId) + '">Tier</label>',
    '        ' + _buildTierSelect(u.userId, u.tier),
    '      </div>',
    '      <div class="col-6 col-md-2">',
    '        <label class="form-label small mb-1" for="role-' + escHtml(u.userId) + '">Role</label>',
    '        <select class="form-select form-select-sm" id="role-' + escHtml(u.userId) + '">',
    '          <option value="user"'  + (u.role === 'user'  ? ' selected' : '') + '>user</option>',
    '          <option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>admin</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div class="d-flex align-items-center gap-3">',
    '      <button class="btn btn-bbm-primary btn-sm" data-save-user="' + escHtml(u.userId) + '">',
    '        <i class="bi bi-check2 me-1"></i>Save Changes',
    '      </button>',
    '      <span id="save-status-' + escHtml(u.userId) + '" style="font-size:0.8rem"></span>',
    '    </div>',
    '    <div class="mt-3 pt-3" style="border-top:1px solid var(--bbm-border)">',
    '      <div class="d-flex align-items-center gap-2 mb-2">',
    '        <span class="small text-muted-bb">Account type:</span>',
    u.accountType === 'venue'
      ? '        <span class="badge bg-secondary"><i class="bi bi-house-fill me-1"></i>Venue</span>'
      : '        <span class="badge bg-secondary">Regular</span>',
    '      </div>',
    u.accountType === 'venue'
      ? '      <button class="btn btn-bbm-danger btn-sm" data-revert-venue="' + escHtml(u.userId) + '"><i class="bi bi-person me-1"></i>Revert to Regular</button>'
        + '      <span id="venue-status-' + escHtml(u.userId) + '" class="ms-2" style="font-size:0.8rem"></span>'
      : '      <button class="btn btn-bbm-ghost btn-sm" data-convert-venue="' + escHtml(u.userId) + '"><i class="bi bi-house me-1"></i>Convert to Venue</button>'
        + '      <span id="venue-status-' + escHtml(u.userId) + '" class="ms-2" style="font-size:0.8rem"></span>'
        + '      <div id="venue-form-' + escHtml(u.userId) + '" class="d-none mt-3">'
        + '        <div class="row g-2">'
        + '          <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm" id="vf-name-' + escHtml(u.userId) + '" placeholder="Venue name *" /></div>'
        + '          <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm" id="vf-address-' + escHtml(u.userId) + '" placeholder="Address (display only)" /></div>'
        + '          <div class="col-6 col-md-3"><input type="number" class="form-control form-control-sm" id="vf-lat-' + escHtml(u.userId) + '" placeholder="Latitude *" step="any" /></div>'
        + '          <div class="col-6 col-md-3"><input type="number" class="form-control form-control-sm" id="vf-lon-' + escHtml(u.userId) + '" placeholder="Longitude *" step="any" /></div>'
        + '        </div>'
        + '        <div class="d-flex gap-2 mt-2">'
        + '          <button class="btn btn-bbm-primary btn-sm" data-save-venue="' + escHtml(u.userId) + '"><i class="bi bi-house-check me-1"></i>Confirm Conversion</button>'
        + '          <button class="btn btn-bbm-ghost btn-sm" data-cancel-venue="' + escHtml(u.userId) + '">Cancel</button>'
        + '        </div>'
        + '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('');
}

async function saveVenueConversion(userId) {
  var statusEl = document.getElementById('venue-status-' + userId);
  var name     = (document.getElementById('vf-name-'    + userId) || {}).value || '';
  var address  = (document.getElementById('vf-address-' + userId) || {}).value || '';
  var lat      = parseFloat((document.getElementById('vf-lat-' + userId) || {}).value);
  var lon      = parseFloat((document.getElementById('vf-lon-' + userId) || {}).value);

  if (!name.trim())          { if (statusEl) { statusEl.className = 'ms-2 text-danger'; statusEl.style.fontSize='0.8rem'; statusEl.textContent = 'Venue name required.'; } return; }
  if (isNaN(lat) || isNaN(lon)) { if (statusEl) { statusEl.className = 'ms-2 text-danger'; statusEl.style.fontSize='0.8rem'; statusEl.textContent = 'Valid lat/lon required.'; } return; }

  if (statusEl) { statusEl.className = 'ms-2 text-muted-bb'; statusEl.style.fontSize='0.8rem'; statusEl.textContent = 'Saving…'; }
  try {
    await window.Api.adminSetAccountType(userId, { accountType: 'venue', venueName: name.trim(), address: address.trim(), fixedLat: lat, fixedLon: lon });
    if (statusEl) { statusEl.className = 'ms-2 text-success'; statusEl.textContent = 'Converted. User session invalidated.'; }
    // Refresh the card after a moment
    setTimeout(runUserSearch, 1200);
  } catch (err) {
    if (statusEl) { statusEl.className = 'ms-2 text-danger'; statusEl.textContent = err.message; }
  }
}

async function revertVenue(userId) {
  if (!confirm('Revert this account to a regular account? Venue fields will be removed.')) return;
  var statusEl = document.getElementById('venue-status-' + userId);
  if (statusEl) { statusEl.className = 'ms-2 text-muted-bb'; statusEl.style.fontSize='0.8rem'; statusEl.textContent = 'Saving…'; }
  try {
    await window.Api.adminSetAccountType(userId, { accountType: null });
    if (statusEl) { statusEl.className = 'ms-2 text-success'; statusEl.textContent = 'Reverted. User session invalidated.'; }
    setTimeout(runUserSearch, 1200);
  } catch (err) {
    if (statusEl) { statusEl.className = 'ms-2 text-danger'; statusEl.textContent = err.message; }
  }
}

function toggleUserCard(userId) {
  var el = document.getElementById('uexpand-' + userId);
  if (el) el.classList.toggle('d-none');
}

async function saveUserChanges(userId) {
  var tierEl   = document.getElementById('tier-' + userId);
  var roleEl   = document.getElementById('role-' + userId);
  var statusEl = document.getElementById('save-status-' + userId);
  if (!tierEl || !roleEl || !statusEl) return;

  var newTier = tierEl.value.trim();
  var newRole = roleEl.value;

  if (!newTier) { statusEl.className = 'text-danger'; statusEl.textContent = 'Tier cannot be empty.'; return; }

  statusEl.className = 'text-muted-bb';
  statusEl.textContent = 'Saving…';

  try {
    // Re-fetch current values to know what actually changed
    var res   = await window.Api.adminSearchUsers({ q: userId, by: 'id' });
    var user  = res.users && res.users[0];
    if (!user) throw new Error('User not found.');

    var ops = [];
    if (newTier !== user.tier) ops.push(window.Api.adminSetTier(userId, newTier));
    if (newRole !== user.role) ops.push(window.Api.adminSetRole(userId, newRole));

    if (!ops.length) {
      statusEl.className = 'text-muted-bb';
      statusEl.textContent = 'No changes.';
      return;
    }

    await Promise.all(ops);
    statusEl.className = 'text-success';
    statusEl.textContent = 'Saved. User token invalidated — they will re-login on next request.';
  } catch (err) {
    statusEl.className = 'text-danger';
    statusEl.textContent = err.message;
  }
}

// ── Tiers tab ────────────────────────────────────────────────

async function renderTiersTab() {
  var content = document.getElementById('adminTabContent');
  content.innerHTML = '<p class="text-muted-bb small">Loading tiers…</p>';
  try {
    var data = await window.Api.adminListTiers();
    _renderTiersList(data.tiers || []);
  } catch (err) {
    content.innerHTML = '<div class="alert alert-danger">' + escHtml(err.message) + '</div>';
  }
}

function _renderTiersList(tiers) {
  var content = document.getElementById('adminTabContent');
  var sorted  = tiers.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });

  content.innerHTML = [
    '<div class="d-flex justify-content-end mb-3">',
    '  <button class="btn btn-bbm-primary btn-sm" id="addTierBtn">',
    '    <i class="bi bi-plus-lg me-1"></i>New Tier',
    '  </button>',
    '</div>',
    '<div id="tiersList">',
    sorted.map(function (t) {
      return renderTierRow(t) + '<div id="tier-form-' + escHtml(t.name) + '" class="d-none mb-3"></div>';
    }).join(''),
    '</div>',
    '<div id="tierFormWrap" class="d-none mt-2"></div>',
  ].join('');

  content.querySelector('#addTierBtn').addEventListener('click', function () {
    showTierForm(null, tiers);
  });
  content.querySelectorAll('[data-edit-tier]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showTierForm(tiers.find(function (t) { return t.name === btn.dataset.editTier; }), tiers);
    });
  });
  content.querySelectorAll('[data-delete-tier]').forEach(function (btn) {
    btn.addEventListener('click', function () { deleteTier(btn.dataset.deleteTier); });
  });
}

function renderTierRow(t) {
  var nearby  = t.nearbyRadiusM  != null ? t.nearbyRadiusM  : (t.nearby_radius_m  != null ? t.nearby_radius_m  : '—');
  var message = t.messageRadiusM != null ? t.messageRadiusM : (t.message_radius_m != null ? t.message_radius_m : '—');
  return [
    '<div class="bbm-section mb-3 d-flex align-items-center justify-content-between gap-3 flex-wrap">',
    '  <div>',
    '    <span class="badge bg-' + escHtml(t.cls || 'secondary') + ' me-2">' + escHtml(t.label) + '</span>',
    '    <code style="font-size:0.8rem">' + escHtml(t.name) + '</code>',
    '    <span class="text-muted-bb ms-2" style="font-size:0.78rem">rank ' + escHtml(String(t.rank)) + '</span>',
    '    <span class="text-muted-bb ms-3" style="font-size:0.78rem">',
    '      nearby ' + escHtml(String(nearby)) + ' m',
    '      · msg ' + escHtml(String(message)) + ' m',
    '    </span>',
    '  </div>',
    '  <div class="d-flex gap-2 flex-shrink-0">',
    '    <button class="btn btn-bbm-ghost btn-sm" data-edit-tier="' + escHtml(t.name) + '">',
    '      <i class="bi bi-pencil me-1"></i>Edit',
    '    </button>',
    '    <button class="btn btn-bbm-danger btn-sm" data-delete-tier="' + escHtml(t.name) + '">',
    '      <i class="bi bi-trash3"></i>',
    '    </button>',
    '  </div>',
    '</div>',
  ].join('');
}

function showTierForm(existing, allTiers) {
  var isEdit = !!existing;

  // Close all open forms before opening a new one.
  document.querySelectorAll('[id^="tier-form-"], #tierFormWrap').forEach(function (el) {
    el.classList.add('d-none');
    el.innerHTML = '';
  });

  var wrap = isEdit
    ? document.getElementById('tier-form-' + existing.name)
    : document.getElementById('tierFormWrap');
  if (!wrap) return;

  var cls     = existing ? existing.cls || 'secondary' : 'secondary';
  var nearby  = existing ? (existing.nearbyRadiusM  != null ? existing.nearbyRadiusM  : (existing.nearby_radius_m  || 1000)) : 1000;
  var message = existing ? (existing.messageRadiusM != null ? existing.messageRadiusM : (existing.message_radius_m || '')) : '';

  // Build rank select for new tiers (0 … maxRank+1).
  var sortedForRank = (allTiers || []).slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
  var maxRank = sortedForRank.length > 0 ? (sortedForRank[sortedForRank.length - 1].rank || 0) : -1;
  var rankOpts = [];
  for (var r = 0; r <= maxRank + 1; r++) {
    var occupant = sortedForRank.find(function (t) { return (t.rank || 0) === r; });
    var rlbl = occupant ? (r + ' — before ' + occupant.label) : (r + ' — append');
    rankOpts.push('<option value="' + r + '"' + (r === maxRank + 1 ? ' selected' : '') + '>' + escHtml(rlbl) + '</option>');
  }
  var rankField = isEdit
    ? '<input type="number" class="form-control" id="tf-rank" value="' + escHtml(String(existing ? existing.rank : 1)) + '" min="0" />'
    : '<select class="form-select" id="tf-rank">' + rankOpts.join('') + '</select>';

  var nameRow = isEdit ? '' : [
    '<div class="col-12 col-sm-6 col-md-3">',
    '  <label class="form-label">Name <span class="text-muted-bb" style="font-size:0.75rem">(slug, e.g. "vip")</span></label>',
    '  <input type="text" class="form-control" id="tf-name" placeholder="vip" />',
    '</div>',
  ].join('');

  var heading = isEdit ? '' : '<h6 class="mb-3">New Tier</h6>';

  wrap.classList.remove('d-none');
  wrap.innerHTML = [
    '<div class="bbm-section">',
    heading,
    '  <div id="tierFormAlert" class="d-none mb-3"></div>',
    '  <div class="row g-3">',
    nameRow,
    '    <div class="col-12 col-sm-6 col-md-4">',
    '      <label class="form-label">Label</label>',
    '      <input type="text" class="form-control" id="tf-label" value="' + escHtml(existing ? existing.label : '') + '" placeholder="VIP" />',
    '    </div>',
    '    <div class="col-6 col-md-3">',
    '      <label class="form-label">Badge class</label>',
    '      <select class="form-select" id="tf-cls">',
    ['secondary','primary','success','warning','danger','info'].map(function (c) {
      return '<option value="' + c + '"' + (cls === c ? ' selected' : '') + '>' + c + '</option>';
    }).join(''),
    '      </select>',
    '    </div>',
    '    <div class="col-6 col-md-2">',
    '      <label class="form-label">Rank</label>',
    rankField,
    '    </div>',
    '  </div>',
    '  <div class="row g-3 mt-0">',
    '    <div class="col-6">',
    '      <label class="form-label">Nearby radius (m)</label>',
    '      <input type="number" class="form-control" id="tf-nearby" value="' + escHtml(String(nearby)) + '" min="1" />',
    '    </div>',
    '    <div class="col-6">',
    '      <label class="form-label">Message radius (m)</label>',
    '      <input type="number" class="form-control" id="tf-message" value="' + escHtml(String(message)) + '" min="1" placeholder="leave blank = none" />',
    '    </div>',
    '  </div>',
    '  <div class="d-flex gap-2 mt-3">',
    '    <button class="btn btn-bbm-primary btn-sm" id="saveTierBtn">',
    '      <i class="bi bi-check2 me-1"></i>' + (isEdit ? 'Update Tier' : 'Create Tier'),
    '    </button>',
    '    <button class="btn btn-bbm-ghost btn-sm" id="cancelTierBtn">Cancel</button>',
    '  </div>',
    '</div>',
  ].join('');

  wrap.querySelector('#cancelTierBtn').addEventListener('click', function () {
    wrap.classList.add('d-none');
    wrap.innerHTML = '';
  });
  wrap.querySelector('#saveTierBtn').addEventListener('click', function () {
    submitTierForm(existing ? existing.name : null);
  });
}

async function submitTierForm(existingName) {
  var alertEl    = document.getElementById('tierFormAlert');
  var label      = document.getElementById('tf-label').value.trim();
  var cls        = document.getElementById('tf-cls').value;
  var rank       = parseInt(document.getElementById('tf-rank').value, 10);
  var nearbyStr  = document.getElementById('tf-nearby').value.trim();
  var messageStr = document.getElementById('tf-message').value.trim();

  var nearbyM   = parseInt(nearbyStr, 10);
  var messageM  = messageStr ? parseInt(messageStr, 10) : null;

  function showAlert(msg) {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = msg;
    alertEl.classList.remove('d-none');
  }

  if (!label)                                     return showAlert('Label is required.');
  if (isNaN(nearbyM) || nearbyM < 1)              return showAlert('Valid nearby radius (m) required.');
  if (messageStr && (isNaN(messageM) || messageM < 1)) return showAlert('Valid message radius (m) required.');

  alertEl.classList.add('d-none');

  var payload = { label: label, cls: cls, rank: rank, nearbyRadiusM: nearbyM, messageRadiusM: messageM };

  if (!existingName) {
    var nameEl = document.getElementById('tf-name');
    var name   = nameEl ? nameEl.value.trim().toLowerCase() : '';
    if (!name || !/^[a-z][a-z0-9_]*$/.test(name))
      return showAlert('Name must start with a letter and contain only lowercase letters, numbers, underscores.');
    payload.name = name;
  }

  try {
    if (existingName) {
      await window.Api.adminUpdateTier(existingName, payload);
    } else {
      await window.Api.adminCreateTier(payload);
    }
    renderTiersTab(); // re-render the whole tab (fresh list)
  } catch (err) {
    showAlert(err.message);
  }
}

async function deleteTier(name) {
  if (!confirm('Delete tier "' + name + '"? Users currently assigned this tier will keep the value in the DB until their tier is changed. This cannot be undone.')) return;
  try {
    await window.Api.adminDeleteTier(name);
    renderTiersTab();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── Roles tab ─────────────────────────────────────────────────

function renderRolesTab() {
  var content = document.getElementById('adminTabContent');
  content.innerHTML = [
    '<p class="text-muted-bb small mb-4">',
    '  Roles define what actions a user can perform. Tier controls feature access.',
    '  Role and tier are orthogonal — a user can be <code>tier: premium, role: admin</code>.',
    '</p>',
    '<div class="bbm-section mb-3">',
    '  <div class="d-flex align-items-center justify-content-between mb-2">',
    '    <div><strong>user</strong> <span class="badge bg-secondary ms-2">default</span></div>',
    '  </div>',
    '  <ul class="text-muted-bb small mb-0" style="padding-left:1.2rem">',
    '    <li>Standard account. Access to all tier-gated features (map, messages, favourites).</li>',
    '    <li>Cannot access the admin panel or modify other users.</li>',
    '  </ul>',
    '</div>',
    '<div class="bbm-section mb-3">',
    '  <div class="d-flex align-items-center justify-content-between mb-2">',
    '    <div><strong>admin</strong> <span class="badge bg-danger ms-2">elevated</span></div>',
    '  </div>',
    '  <ul class="text-muted-bb small mb-2" style="padding-left:1.2rem">',
    '    <li>Full access to admin panel: user search, tier changes, role changes, tier CRUD.</li>',
    '    <li>Cannot be self-assigned — must be granted by another admin.</li>',
    '    <li>Changing a user\'s tier or role invalidates their active session (tokenVersion bump).</li>',
    '  </ul>',
    '  <div class="small" style="color:var(--bbm-yellow, #f0c040)">',
    '    <i class="bi bi-exclamation-triangle me-1"></i>',
    '    No server-side guard currently prevents an admin from modifying their own tier or role (AUDIT 1.4).',
    '  </div>',
    '</div>',
    '<div class="alert alert-info small mt-3 mb-0" role="alert">',
    '  <i class="bi bi-info-circle me-1"></i>',
    '  Custom roles and per-role permission sets require backend changes (T-09).',
    '  Until T-09 is implemented, roles are limited to <code>user</code> and <code>admin</code>.',
    '</div>',
  ].join('');
}

// Auto-run when loaded as extra_js
(window.__authReady || Promise.resolve()).then(function () {
  if (document.getElementById('adminPanel')) initAdmin();
});
