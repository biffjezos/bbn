// ============================================================
// bOOmbOOm.NOW! — Profile page module (ES6)
// Handles /profile/ (own profile) and /profile/view/ (public profile)
// ============================================================

import { Api } from './api.js';
import { Auth } from './auth.js';
import { promptBlock } from './blocks.js';

// ── Utilities ─────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getJwtField(field) {
  try { return JSON.parse(atob(Auth.getToken().split('.')[1]))[field] ?? null; }
  catch { return null; }
}

function getJwtRole() { return getJwtField('role') || 'user'; }

const ROLE_BADGE = {
  admin:         { cls: 'bg-danger', icon: 'bi-shield-lock-fill', label: 'Admin' },
  venue_manager: { cls: 'bg-info',   icon: 'bi-house-fill',       label: 'Venue Manager' },
};

function roleBadgesHtml(roles) {
  return roles
    .filter(r => r !== 'user' && ROLE_BADGE[r])
    .map(r => {
      const b = ROLE_BADGE[r];
      return `<span class="badge ${b.cls} d-inline-flex align-items-center gap-1" style="font-size:0.8rem"><i class="bi ${b.icon}"></i>&nbsp;${b.label}</span>`;
    })
    .join('');
}

function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)  { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }
function sexLabel(sex)  { return sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—'; }
function loadingHtml(text = 'Loading…') { return `<div class="bbn-loading"><p>${escHtml(text)}</p></div>`; }

// ── My Profile ────────────────────────────────────────────

function tierFeatureHtml(tierInfo) {
  const nearbyM = tierInfo?.nearbyRadiusM;
  const nearbyLabel = nearbyM == null ? '—'
    : nearbyM >= 1_000 ? (nearbyM / 1_000).toLocaleString() + ' km'
    : nearbyM + ' m';
  const isGuest = tierInfo?.name === 'guest';
  const items = [
    `<li>See the map and nearby users</li>`,
    `<li>Nearby radius: <strong>${nearbyLabel}</strong></li>`,
  ];
  if (isGuest) {
    items.push(`<li class="text-muted">Messaging — requires an account</li>`);
    items.push(`<li class="text-muted">Favourites — requires an account</li>`);
  } else {
    items.push(`<li>Manage favourites</li>`);
    items.push(`<li>Message mutual favourites within range</li>`);
    items.push(`<li style="font-size:0.8rem;opacity:0.7">Messaging only works when both users have each other as favourites and are within each other's range. The <em>smaller</em> of the two ranges applies.</li>`);
  }
  return `<ul class="mb-0 ps-3 text-start" style="font-size:0.85rem">${items.join('')}</ul>`;
}

async function renderMyProfile() {
  const wrap = document.getElementById('profileFormWrap');
  if (!wrap) return;

  if (!Auth.isRegistered()) {
    wrap.innerHTML = `<div class="bbn-empty"><i class="bi bi-person-circle"></i>
      <p>Log in to manage your profile.</p>
      <button class="btn btn-bbn-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  wrap.innerHTML = loadingHtml('Loading profile…');

  const tier = getJwtField('tier') || 'regular';
  let tierInfo = null;
  try { tierInfo = await Api.getTierInfo(tier); } catch { /* use fallback */ }
  const tierLabel = tierInfo?.label || tier.charAt(0).toUpperCase() + tier.slice(1);
  const tierCls   = tierInfo?.cls   || 'primary';

  let current = {};
  try {
    current = await Api.getMe();
  } catch (err) {
    console.warn('[Profile] getMe failed:', err.message);
    const p = Auth.getProfile?.();
    current = {
      nickname: p?.nickname || getJwtField('nickname'),
      sex:      p?.sex      || getJwtField('sex'),
      age:      getJwtField('age'),
    };
  }

  const isVenue = current.accountType === 'venue';

  const editableFields = isVenue ? `
      <div class="mb-3">
        <label class="form-label">Venue name</label>
        <input type="text" class="form-control" id="editNickname"
          value="${escHtml(current.venueName || current.nickname || '')}" minlength="2" maxlength="64" placeholder="Venue display name" />
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbn-text-faint)">Shown to nearby users on the map.</div>
      </div>
      <div class="mb-4">
        <label class="form-label">Address</label>
        <div class="form-control-plaintext text-muted-bb small" style="padding-left:0">${escHtml(current.address || '—')}</div>
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbn-text-faint)">Location is fixed. Contact support to update.</div>
      </div>` : `
      <div class="mb-3">
        <label class="form-label" for="editNickname">Nickname</label>
        <input type="text" class="form-control" id="editNickname"
          value="${escHtml(current.nickname || '')}" minlength="2" maxlength="32" placeholder="Display name" />
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbn-text-faint)">Shown to nearby users. Not unique.</div>
      </div>
      <div class="row g-3 mb-4">
        <div class="col-6">
          <label class="form-label" for="editAge">Age</label>
          <input type="number" class="form-control" id="editAge"
            value="${escHtml(String(current.age || ''))}" min="18" max="120" />
        </div>
        <div class="col-6">
          <label class="form-label" for="editSex">Sex</label>
          <select class="form-select" id="editSex">
            <option value="m" ${current.sex === 'm' ? 'selected' : ''}>Male</option>
            <option value="f" ${current.sex === 'f' ? 'selected' : ''}>Female</option>
          </select>
        </div>
      </div>`;

  wrap.innerHTML = `
    <div class="bbn-profile-form">
      <div id="profileAlert" class="d-none mb-4"></div>
      <div class="mb-4 d-flex align-items-center gap-2 flex-wrap">
        <span id="tierBadge"
          class="badge bg-${escHtml(tierCls)} d-inline-flex align-items-center gap-1"
          style="cursor:pointer;font-size:0.8rem;user-select:none"
          tabindex="0" role="button" aria-label="Show tier features">
          ${escHtml(tierLabel)}&nbsp;<i class="bi bi-info-circle"></i>
        </span>
        ${roleBadgesHtml([getJwtRole()])}
      </div>
      ${editableFields}
      <div class="d-flex gap-3 flex-wrap mb-4">
        <button class="btn btn-bbn-primary" id="saveProfileBtn">
          <i class="bi bi-check2 me-2"></i>Save Changes
        </button>
        <button class="btn btn-bbn-ghost" id="changePasswordBtn">
          <i class="bi bi-key me-2"></i>Change Password
        </button>
      </div>
    </div>`;

  const tierBadgeEl = document.getElementById('tierBadge');
  if (tierBadgeEl && window.bootstrap?.Popover) {
    new bootstrap.Popover(tierBadgeEl, {
      trigger: 'click', html: true, sanitize: false,
      title: escHtml(tierLabel) + ' plan',
      content: tierFeatureHtml(tierInfo),
      placement: 'bottom',
    });
    document.addEventListener('click', function hidePop(e) {
      if (!tierBadgeEl.contains(e.target)) bootstrap.Popover.getInstance(tierBadgeEl)?.hide();
    }, { capture: true, passive: true });
  }

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const alertEl  = document.getElementById('profileAlert');
    const nickname = document.getElementById('editNickname').value.trim();
    alertEl.classList.add('d-none');
    let payload;
    if (isVenue) {
      payload = { venueName: nickname };
    } else {
      const age = parseInt(document.getElementById('editAge').value, 10);
      const sex = document.getElementById('editSex').value;
      payload = { nickname, age, sex };
    }
    try {
      await Api.updateMe(payload);
      if (!isVenue) Auth.updateProfile?.({ nickname: payload.nickname, sex: payload.sex });
      alertEl.className = 'alert alert-success';
      alertEl.textContent = 'Profile saved.';
      alertEl.classList.remove('d-none');
      setTimeout(() => alertEl.classList.add('d-none'), 3000);
    } catch (err) {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = err.message;
      alertEl.classList.remove('d-none');
    }
  });

  if (getJwtRole() === 'venue_manager') {
    renderManagerVenueSection(wrap);
  }

  document.getElementById('changePasswordBtn').addEventListener('click', () => {
    const existing = document.getElementById('changePasswordSection');
    if (existing) { existing.remove(); return; }
    const section = document.createElement('div');
    section.id = 'changePasswordSection';
    section.className = 'bbn-profile-form mt-4 pt-4';
    section.style.borderTop = '1px solid var(--bbn-border)';
    section.innerHTML = `
      <h5 class="heading-serif mb-3" style="font-size:1.1rem">Change Password</h5>
      <div id="pwAlert" class="d-none mb-3"></div>
      <div class="mb-3"><label class="form-label" for="currentPw">Current Password</label>
        <input type="password" class="form-control" id="currentPw" autocomplete="current-password" /></div>
      <div class="mb-3"><label class="form-label" for="newPw">New Password</label>
        <input type="password" class="form-control" id="newPw" autocomplete="new-password" placeholder="At least 8 characters" /></div>
      <div class="mb-4"><label class="form-label" for="confirmPw">Confirm New Password</label>
        <input type="password" class="form-control" id="confirmPw" autocomplete="new-password" /></div>
      <button class="btn btn-bbn-primary" id="savePwBtn"><i class="bi bi-check2 me-2"></i>Update Password</button>`;
    wrap.appendChild(section);

    document.getElementById('savePwBtn').addEventListener('click', async () => {
      const alertEl = document.getElementById('pwAlert');
      const curr    = document.getElementById('currentPw').value;
      const nw      = document.getElementById('newPw').value;
      const conf    = document.getElementById('confirmPw').value;
      alertEl.classList.add('d-none');
      if (nw !== conf) {
        alertEl.className = 'alert alert-danger';
        alertEl.textContent = 'New passwords do not match.';
        alertEl.classList.remove('d-none');
        return;
      }
      try {
        // Re-encrypt private key blob locally before touching the server.
        // curr/nw never leave the browser.
        let newPublicKey = null, newEncBlob = null;
        if (window.BBNCrypto) {
          const keys = await Api.getMyKeys();
          if (keys.encryptedPrivateKey) {
            newEncBlob   = await window.BBNCrypto.reencrypt(curr, nw, keys.encryptedPrivateKey);
            newPublicKey = keys.publicKey;
          }
        }
        await Api.changePassword({ password: nw });
        if (newPublicKey && newEncBlob) await Api.saveKeys(newPublicKey, newEncBlob);
        alertEl.className = 'alert alert-success';
        alertEl.textContent = 'Password updated.';
        alertEl.classList.remove('d-none');
        ['currentPw', 'newPw', 'confirmPw'].forEach(id => { document.getElementById(id).value = ''; });
      } catch (err) {
        alertEl.className = 'alert alert-danger';
        alertEl.textContent = err.message;
        alertEl.classList.remove('d-none');
      }
    });
  });
}

// ── Manager — My Venues ───────────────────────────────────

async function renderManagerVenueSection(profileWrap) {
  const existing = document.getElementById('managerVenueSection');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'managerVenueSection';
  section.className = 'bbn-profile-form mt-5 pt-4';
  section.style.borderTop = '1px solid var(--bbn-border)';
  section.innerHTML = `<h5 class="heading-serif mb-3" style="font-size:1.1rem"><i class="bi bi-house-fill me-2"></i>My Venues</h5>
    <div id="venueLoading" class="text-muted-bb small">Loading…</div>`;

  const forms = profileWrap.querySelectorAll('.bbn-profile-form');
  forms[forms.length - 1].before(section);

  let venues = [];
  try {
    const data = await Api.getMyVenues();
    venues = data.venues || [];
  } catch (err) {
    section.querySelector('#venueLoading').textContent = 'Failed to load venues: ' + err.message;
    return;
  }
  section.querySelector('#venueLoading').remove();

  const createWrap = document.createElement('div');
  createWrap.className = 'mb-4';
  createWrap.innerHTML = `
    <button class="btn btn-bbn-secondary btn-sm" id="vcToggleBtn">
      <i class="bi bi-plus-lg me-1"></i>Add Venue
    </button>
    <div id="venueCreatePanel" class="d-none mt-3 bbn-section">
      <div id="venueCreateAlert" class="d-none mb-3"></div>
      <div class="row g-3 mb-3">
        <div class="col-12 col-sm-6">
          <label class="form-label">Venue Name <span class="text-danger">*</span></label>
          <input type="text" class="form-control" id="vcName" placeholder="e.g. The Blue Parrot" maxlength="64" />
        </div>
        <div class="col-12 col-sm-6">
          <label class="form-label">Address <span class="text-muted-bb" style="font-size:0.78rem">(display only)</span></label>
          <input type="text" class="form-control" id="vcAddress" placeholder="e.g. 42 Main St" maxlength="128" />
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label">Latitude <span class="text-danger">*</span></label>
          <input type="number" class="form-control" id="vcLat" placeholder="e.g. 51.505" step="any" />
        </div>
        <div class="col-6 col-sm-3">
          <label class="form-label">Longitude <span class="text-danger">*</span></label>
          <input type="number" class="form-control" id="vcLon" placeholder="e.g. -0.09" step="any" />
        </div>
        <div class="col-12">
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" id="vcCanMsg" checked />
            <label class="form-check-label" for="vcCanMsg">Can receive messages</label>
          </div>
        </div>
      </div>
      <p class="text-muted-bb small mb-3">Venue name, address, and location cannot be changed after creation.</p>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-bbn-primary btn-sm" id="vcSubmitBtn"><i class="bi bi-house-check me-1"></i>Create Venue</button>
        <button class="btn btn-secondary btn-sm" id="vcCancelBtn">Cancel</button>
      </div>
    </div>`;
  section.appendChild(createWrap);

  const toggleBtn   = createWrap.querySelector('#vcToggleBtn');
  const createPanel = createWrap.querySelector('#venueCreatePanel');

  toggleBtn.addEventListener('click', () => {
    const opening = createPanel.classList.toggle('d-none');
    toggleBtn.innerHTML = opening
      ? '<i class="bi bi-plus-lg me-1"></i>Add Venue'
      : '<i class="bi bi-x-lg me-1"></i>Cancel';
  });

  createWrap.querySelector('#vcCancelBtn').addEventListener('click', () => {
    createPanel.classList.add('d-none');
    toggleBtn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Add Venue';
  });

  createWrap.querySelector('#vcSubmitBtn').addEventListener('click', async () => {
    const alertEl = createWrap.querySelector('#venueCreateAlert');
    const name    = createWrap.querySelector('#vcName').value.trim();
    const address = createWrap.querySelector('#vcAddress').value.trim();
    const lat     = parseFloat(createWrap.querySelector('#vcLat').value);
    const lon     = parseFloat(createWrap.querySelector('#vcLon').value);
    const canMsg  = createWrap.querySelector('#vcCanMsg').checked;
    alertEl.classList.add('d-none');
    if (name.length < 2) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Venue name must be at least 2 characters.'; alertEl.classList.remove('d-none'); return; }
    if (isNaN(lat) || isNaN(lon)) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Valid latitude and longitude required.'; alertEl.classList.remove('d-none'); return; }
    try {
      await Api.createVenue({ venueName: name, address, fixedLat: lat, fixedLon: lon, canReceiveMessages: canMsg });
      renderManagerVenueSection(profileWrap);
    } catch (err) {
      alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
    }
  });

  if (venues.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-muted-bb small';
    empty.textContent = 'No venues yet. Create one to appear on the map as a fixed location.';
    section.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.id = 'venueList';
  section.appendChild(list);

  venues.forEach(function(venue) {
    const sid  = escHtml(venue.id);
    const card = document.createElement('div');
    card.className = 'bbn-section mb-3';
    card.id = 'venueCard-' + sid;
    card.innerHTML = `
      <div class="d-flex align-items-center gap-2 flex-wrap" style="cursor:pointer" id="venueCardHeader-${sid}">
        <strong>${escHtml(venue.venueName || '—')}</strong>
        <span class="badge bg-secondary" style="font-size:0.72rem">${escHtml(venue.tier || 'regular')}</span>
        <span class="text-muted-bb small"><i class="bi bi-geo-alt me-1"></i>${escHtml(venue.address || '—')}</span>
        <i class="bi bi-chevron-down ms-auto" id="venueCardChevron-${sid}"></i>
      </div>
      <div class="d-none mt-3" id="venueCardBody-${sid}">
        <div id="venueAlert-${sid}" class="d-none mb-2"></div>
        <div class="row g-3 mb-3">
          <div class="col-12">
            <label class="form-label">Description</label>
            <textarea class="form-control" id="veDesc-${sid}" rows="3" maxlength="500">${escHtml(venue.description || '')}</textarea>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Opening Hours</label>
            <input type="text" class="form-control" id="veHours-${sid}" maxlength="128" value="${escHtml(venue.openingHours || '')}" />
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Type</label>
            <input type="text" class="form-control" id="veType-${sid}" maxlength="64" value="${escHtml(venue.locationType || '')}" />
          </div>
          <div class="col-12">
            <div class="form-check form-switch">
              <input class="form-check-input" type="checkbox" id="veCanMsg-${sid}" ${venue.canReceiveMessages !== false ? 'checked' : ''} />
              <label class="form-check-label" for="veCanMsg-${sid}">Can receive messages</label>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-bbn-primary btn-sm" id="veSaveBtn-${sid}"><i class="bi bi-check2 me-1"></i>Save</button>
          <button class="btn btn-bbn-danger btn-sm" id="veDeleteBtn-${sid}"><i class="bi bi-trash3 me-1"></i>Delete Venue</button>
        </div>
      </div>`;
    list.appendChild(card);

    card.querySelector('#venueCardHeader-' + sid).addEventListener('click', function() {
      const body    = card.querySelector('#venueCardBody-'    + sid);
      const chevron = card.querySelector('#venueCardChevron-' + sid);
      const opening = body.classList.toggle('d-none');
      chevron.className = 'bi ms-auto ' + (opening ? 'bi-chevron-down' : 'bi-chevron-up');
    });

    card.querySelector('#veSaveBtn-' + sid).addEventListener('click', async function() {
      const alertEl = card.querySelector('#venueAlert-' + sid);
      alertEl.classList.add('d-none');
      try {
        await Api.updateVenue(venue.id, {
          description:        card.querySelector('#veDesc-'   + sid).value.trim(),
          openingHours:       card.querySelector('#veHours-'  + sid).value.trim(),
          locationType:       card.querySelector('#veType-'   + sid).value.trim(),
          canReceiveMessages: card.querySelector('#veCanMsg-' + sid).checked,
        });
        alertEl.className = 'alert alert-success'; alertEl.textContent = 'Venue saved.'; alertEl.classList.remove('d-none');
        setTimeout(() => alertEl.classList.add('d-none'), 3000);
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });

    card.querySelector('#veDeleteBtn-' + sid).addEventListener('click', async function() {
      if (!confirm('Delete "' + (venue.venueName || 'this venue') + '"? All messages and favourites will be permanently deleted.')) return;
      const alertEl = card.querySelector('#venueAlert-' + sid);
      try {
        await Api.deleteVenue(venue.id);
        renderManagerVenueSection(profileWrap);
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });
  });
}

// ── Public Profile ────────────────────────────────────────

async function renderPublicProfile() {
  const page = document.getElementById('pubProfilePage');
  if (!page) return;

  const params      = new URLSearchParams(window.location.search);
  const userId      = params.get('uid');
  const displayName = params.get('name') || userId;

  if (!userId) { window.location.href = '/'; return; }

  page.innerHTML = loadingHtml('Loading profile…');

  const viewerIsReg  = Auth.isRegistered();
  const isOwnProfile = viewerIsReg && userId === getJwtField('sub');

  try {
    const profile     = await Api.getProfile(userId);
    const isVenue     = profile.accountType === 'venue';
    const cls         = isVenue ? 'venue' : sexClass(profile.sex);
    const avatarInner = isVenue ? '<i class="bi bi-house-fill"></i>' : sexEmoji(profile.sex);
    const threadHref  = `/messages/thread/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(profile.nickname || displayName)}`;

    let isFav = false;
    if (viewerIsReg) {
      try {
        const { favourites = [] } = await Api.getFavourites();
        isFav = favourites.some(f => f.userId === userId);
      } catch { /* ok */ }
    }

    const isBlocked = !!profile.blockedByViewer;
    const canMsg    = !(isVenue && profile.canReceiveMessages === false);
    const msgBtnHtml = !canMsg ? '' : isBlocked
      ? `<span class="btn btn-bbn-pink disabled" aria-disabled="true" style="opacity:0.5"><i class="bi bi-chat-dots me-2"></i>Message</span>`
      : `<a href="${threadHref}" class="btn btn-bbn-pink"><i class="bi bi-chat-dots me-2"></i>Message</a>`;
    const blockToggleHtml = isBlocked
      ? `<button class="btn btn-link text-muted p-0" id="unblockUserBtn" style="font-size:0.875rem;text-decoration:none"><i class="bi bi-slash-circle me-1"></i>Unblock</button>`
      : `<button class="btn btn-link text-danger p-0" id="blockUserBtn" style="font-size:0.875rem;text-decoration:none"><i class="bi bi-slash-circle me-1"></i>Block User</button>`;

    const actionBlock = !viewerIsReg ? `
      <div class="mt-4">
        <p class="text-muted-bb mb-3">Create an account to message and favourite people nearby.</p>
        <div class="d-flex gap-3 flex-wrap">
          <button class="btn btn-bbn-primary" data-bs-toggle="modal" data-bs-target="#registerModal"><i class="bi bi-person-plus me-2"></i>Create Account</button>
          <button class="btn btn-bbn-ghost" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>
        </div>
      </div>`
    : isOwnProfile ? `
      <div class="d-flex gap-3 flex-wrap mt-4 align-items-center">
        <a href="${threadHref}" class="btn btn-bbn-pink"><i class="bi bi-chat-dots me-2"></i>Message yourself</a>
      </div>`
    : `
      <div class="d-flex gap-3 flex-wrap mt-4 align-items-center">
        ${msgBtnHtml}
        <button class="btn ${isFav ? 'btn-bbn-outline-pink' : 'btn-bbn-ghost'}" id="favToggleBtn"
          data-userid="${escHtml(userId)}" data-fav="${isFav}">
          <i class="bi bi-star${isFav ? '-fill text-pink' : ''} me-2"></i>${isFav ? 'Favourited' : 'Add to Favourites'}
        </button>
        ${isBlocked ? '<span class="badge bg-secondary" style="font-size:0.75rem">Blocked</span>' : ''}
      </div>
      <div class="mt-3">${blockToggleHtml}</div>`;

    page.innerHTML = `
      <div class="bbn-pub-profile-hero">
        <div class="container-fluid px-4 px-md-5">
          <div class="bbn-pub-avatar ${cls}">${avatarInner}</div>
          <h1 class="bbn-pub-name">${escHtml(profile.nickname || displayName)}</h1>
          ${isVenue
            ? `<p class="bbn-pub-meta"><i class="bi bi-house-fill me-1"></i>Venue</p>`
            : `<p class="bbn-pub-meta">${profile.age ? escHtml(String(profile.age)) + ' · ' : ''}${sexLabel(profile.sex)}</p>`
          }
          ${actionBlock}
        </div>
      </div>
      <div class="container-fluid px-4 px-md-5 py-4">
        ${isVenue ? `
          ${profile.locationType ? `<p class="text-muted-bb small mb-1"><i class="bi bi-tag me-1"></i>${escHtml(profile.locationType)}</p>` : ''}
          ${profile.address      ? `<p class="text-muted-bb small mb-1"><i class="bi bi-geo-alt me-1"></i>${escHtml(profile.address)}</p>` : ''}
          ${profile.openingHours ? `<p class="text-muted-bb small mb-1"><i class="bi bi-clock me-1"></i>${escHtml(profile.openingHours)}</p>` : ''}
          ${profile.description  ? `<p class="mt-3">${escHtml(profile.description)}</p>` : ''}
        ` : '<p class="text-faint small">More profile details coming soon.</p>'}
      </div>`;

    document.getElementById('blockUserBtn')?.addEventListener('click', () => {
      promptBlock(userId, profile.nickname || displayName);
    });

    document.getElementById('unblockUserBtn')?.addEventListener('click', async () => {
      try { await Api.unblockUser(userId); renderPublicProfile(); }
      catch (err) { alert('Error: ' + err.message); }
    });

    document.getElementById('favToggleBtn')?.addEventListener('click', async () => {
      const btn    = document.getElementById('favToggleBtn');
      const wasFav = btn.dataset.fav === 'true';
      try {
        if (wasFav) {
          await Api.removeFavourite(userId);
          btn.dataset.fav = 'false';
          btn.className = 'btn btn-bbn-ghost';
          btn.innerHTML = '<i class="bi bi-star me-2"></i>Add to Favourites';
        } else {
          await Api.addFavourite(userId);
          btn.dataset.fav = 'true';
          btn.className = 'btn btn-bbn-outline-pink';
          btn.innerHTML = '<i class="bi bi-star-fill text-pink me-2"></i>Favourited';
        }
      } catch (err) { alert('Error: ' + err.message); }
    });

  } catch (err) {
    page.innerHTML = `<div class="container-fluid px-4 px-md-5 py-5">
      <div class="alert alert-danger">${escHtml(err.message)}</div>
      <a href="/" class="btn btn-bbn-ghost mt-2"><i class="bi bi-arrow-left me-2"></i>Back to Map</a>
    </div>`;
  }
}

// ── Exports ───────────────────────────────────────────────

export function initMyProfile() {
  // Re-render on block events (block modal dispatches bbn:user-blocked)
  document.addEventListener('bbn:user-blocked', () => {
    if (document.getElementById('profileFormWrap')) renderMyProfile();
  });
  renderMyProfile();
}

export function initPublicProfile() {
  document.addEventListener('bbn:user-blocked', () => {
    if (document.getElementById('pubProfilePage')) renderPublicProfile();
  });
  renderPublicProfile();
}
