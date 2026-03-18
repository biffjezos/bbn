// ============================================================
// bOOmbOOm.NOW! — Profile page module
// ============================================================

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isRegistered() {
  try {
    if (typeof window.Auth?.isRegistered === 'function') return window.Auth.isRegistered();
    const payload = JSON.parse(atob(window.Auth.getToken().split('.')[1]));
    return ['user', 'admin', 'venue_manager'].includes(payload.role);
  } catch { return false; }
}

function getJwtField(field) {
  try { return JSON.parse(atob(window.Auth.getToken().split('.')[1]))[field] ?? null; }
  catch { return null; }
}

function getJwtRole() { return getJwtField('role') || 'user'; }

const ROLE_BADGE = {
  admin:         { cls: 'bg-danger',  icon: 'bi-shield-lock-fill', label: 'Admin' },
  venue_manager: { cls: 'bg-info',    icon: 'bi-house-fill',       label: 'Venue Manager' },
};

function roleBadgesHtml(roles) {
  return roles
    .filter(function(r) { return r !== 'user' && ROLE_BADGE[r]; })
    .map(function(r) {
      var b = ROLE_BADGE[r];
      return `<span class="badge ${b.cls} d-inline-flex align-items-center gap-1" style="font-size:0.8rem"><i class="bi ${b.icon}"></i>&nbsp;${b.label}</span>`;
    })
    .join('');
}

function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)  { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }
function sexLabel(sex)  { return sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—'; }

function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── My Profile ────────────────────────────────────────────

function tierFeatureHtml(tierInfo) {
  const nearbyM  = tierInfo?.nearbyRadiusM;
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
    items.push(`<li style="font-size:0.8rem;opacity:0.7">Messaging only works when both users have each other as favourites and are within each other's range. The <em>smaller</em> of the two ranges applies — if the other user has a tighter range, their limit is what counts.</li>`);
  }
  return `<ul class="mb-0 ps-3 text-start" style="font-size:0.85rem">${items.join('')}</ul>`;
}

async function renderMyProfile() {
  const wrap = document.getElementById('profileFormWrap');
  if (!wrap) return;

  console.log('[Profile] renderMyProfile called, isRegistered:', isRegistered(), 'token:', !!window.Auth?.getToken?.());

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-person-circle"></i>
      <p>Log in to manage your profile.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  wrap.innerHTML = loadingHtml('Loading profile…');

  const tier = getJwtField('tier') || 'regular';

  // Fetch tier info from tiers-service (label, cls, radii)
  let tierInfo = null;
  try { tierInfo = await window.Api.getTierInfo(tier); } catch { /* use fallback */ }
  const tierLabel = tierInfo?.label || tier.charAt(0).toUpperCase() + tier.slice(1);
  const tierCls   = tierInfo?.cls   || 'primary';

  // Always fetch from API — authoritative source
  let current = {};
  try {
    console.log('[Profile] Fetching /users/me');
    current = await window.Api.getMe();
    console.log('[Profile] Got profile:', JSON.stringify(current));
  } catch (err) {
    console.warn('[Profile] getMe failed:', err.message, '— falling back to JWT/localStorage');
    const p = window.Auth?.getProfile?.();
    current = {
      nickname: p?.nickname || getJwtField('nickname'),
      sex:      p?.sex      || getJwtField('sex'),
      age:      getJwtField('age'),
    };
  }

  const isVenue = current.accountType === 'venue';

  const dangerBorderColor = isVenue ? 'var(--bbm-danger-border)'
    : current.sex === 'f' ? 'var(--bbm-meet-pill-border)'
    : current.sex === 'm' ? 'var(--bbm-meet-pill-border-male)'
    : 'var(--bbm-danger-border)';
  const dangerLabelColor = isVenue ? 'var(--bbm-danger-text)'
    : current.sex === 'f' ? 'var(--bbm-pink-light)'
    : current.sex === 'm' ? 'var(--bbm-blue-light)'
    : 'var(--bbm-danger-text)';

  const editableFields = isVenue ? `
      <div class="mb-3">
        <label class="form-label">Venue name</label>
        <input type="text" class="form-control" id="editNickname"
          value="${escHtml(current.venueName || current.nickname || '')}" minlength="2" maxlength="64" placeholder="Venue display name" />
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbm-text-faint)">Shown to nearby users on the map.</div>
      </div>
      <div class="mb-4">
        <label class="form-label">Address</label>
        <div class="form-control-plaintext text-muted-bb small" style="padding-left:0">${escHtml(current.address || '—')}</div>
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbm-text-faint)">Location is fixed. Contact support to update.</div>
      </div>` : `
      <div class="mb-3">
        <label class="form-label" for="editNickname">Nickname</label>
        <input type="text" class="form-control" id="editNickname"
          value="${escHtml(current.nickname || '')}" minlength="2" maxlength="32" placeholder="Display name" />
        <div class="mt-1" style="font-size:0.78rem;color:var(--bbm-text-faint)">Shown to nearby users. Not unique.</div>
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
    <div class="bbm-profile-form">
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
        <button class="btn btn-bbm-primary" id="saveProfileBtn">
          <i class="bi bi-check2 me-2"></i>Save Changes
        </button>
        <button class="btn btn-bbm-ghost" id="changePasswordBtn">
          <i class="bi bi-key me-2"></i>Change Password
        </button>
      </div>
    </div>

    <div class="bbm-profile-form mt-5"
      style="border:1px solid ${dangerBorderColor};border-radius:var(--bbm-radius,12px);padding:1.25rem">
      <h6 style="font-size:0.75rem;letter-spacing:0.08em;text-transform:uppercase;
                 color:${dangerLabelColor};margin-bottom:0.75rem">Danger Zone</h6>
      <p class="text-muted-bb small mb-3">Permanently deletes your account, messages and favourites.</p>
      <button class="btn btn-bbm-danger" id="deleteAccountBtn">
        <i class="bi bi-trash3 me-2"></i>Delete Account
      </button>
    </div>`;

  const tierBadgeEl = document.getElementById('tierBadge');
  if (tierBadgeEl && window.bootstrap?.Popover) {
    new bootstrap.Popover(tierBadgeEl, {
      trigger:   'click',
      html:      true,
      sanitize:  false,
      title:     escHtml(tierLabel) + ' plan',
      content:   tierFeatureHtml(tierInfo),
      placement: 'bottom',
    });
    // Close when clicking outside
    document.addEventListener('click', function hidePop(e) {
      if (!tierBadgeEl.contains(e.target)) {
        bootstrap.Popover.getInstance(tierBadgeEl)?.hide();
      }
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
      await window.Api.updateMe(payload);
      if (!isVenue) window.Auth.updateProfile?.({ nickname: payload.nickname, sex: payload.sex });
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

  document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    const input = document.getElementById('deleteNicknameInput');
    if (input) input.value = '';
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    new bootstrap.Modal(document.getElementById('deleteConfirmModal')).show();
  });

  // Render "My Venue" section for venue managers
  if (getJwtRole() === 'venue_manager') {
    renderManagerVenueSection(wrap);
  }

  document.getElementById('changePasswordBtn').addEventListener('click', () => {
    const existing = document.getElementById('changePasswordSection');
    if (existing) { existing.remove(); return; }
    const section = document.createElement('div');
    section.id = 'changePasswordSection';
    section.className = 'bbm-profile-form mt-4 pt-4';
    section.style.borderTop = '1px solid var(--bbm-border)';
    section.innerHTML = `
      <h5 class="heading-serif mb-3" style="font-size:1.1rem">Change Password</h5>
      <div id="pwAlert" class="d-none mb-3"></div>
      <div class="mb-3"><label class="form-label" for="currentPw">Current Password</label>
        <input type="password" class="form-control" id="currentPw" autocomplete="current-password" /></div>
      <div class="mb-3"><label class="form-label" for="newPw">New Password</label>
        <input type="password" class="form-control" id="newPw" autocomplete="new-password" placeholder="At least 8 characters" /></div>
      <div class="mb-4"><label class="form-label" for="confirmPw">Confirm New Password</label>
        <input type="password" class="form-control" id="confirmPw" autocomplete="new-password" /></div>
      <button class="btn btn-bbm-primary" id="savePwBtn"><i class="bi bi-check2 me-2"></i>Update Password</button>`;
    document.getElementById('deleteAccountBtn').closest('.bbm-profile-form').before(section);

    document.getElementById('savePwBtn').addEventListener('click', async () => {
      const alertEl = document.getElementById('pwAlert');
      const curr    = document.getElementById('currentPw').value;
      const nw      = document.getElementById('newPw').value;
      const conf    = document.getElementById('confirmPw').value;
      alertEl.classList.add('d-none');
      if (nw !== conf) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = 'New passwords do not match.'; alertEl.classList.remove('d-none'); return;
      }
      try {
        // Re-encrypt the private key blob and update the password atomically.
        // Both are sent in a single PUT /users/me so the key blob and password
        // hash are never out of sync even if the request fails partway through.
        const keys = await window.Api.getMyKeys();
        const updatePayload = { currentPassword: curr, password: nw };
        if (keys.encryptedPrivateKey) {
          const newEncBlob = await window.BBMCrypto.reencrypt(curr, nw, keys.encryptedPrivateKey);
          updatePayload.publicKey           = keys.publicKey;
          updatePayload.encryptedPrivateKey = newEncBlob;
        }
        await window.Api.updateMe(updatePayload);
        alertEl.className = 'alert alert-success'; alertEl.textContent = 'Password updated.'; alertEl.classList.remove('d-none');
        ['currentPw','newPw','confirmPw'].forEach(id => document.getElementById(id).value = '');
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });
  });
}

// ── Manager — My Venue ────────────────────────────────────

async function renderManagerVenueSection(profileWrap) {
  const section = document.createElement('div');
  section.id = 'managerVenueSection';
  section.className = 'bbm-profile-form mt-5 pt-4';
  section.style.borderTop = '1px solid var(--bbm-border)';
  section.innerHTML = `<h5 class="heading-serif mb-3" style="font-size:1.1rem"><i class="bi bi-house-fill me-2"></i>My Venue</h5>
    <div id="venueLoading" class="text-muted-bb small">Loading…</div>`;

  // Insert before the danger zone section (last .bbm-profile-form)
  const forms = profileWrap.querySelectorAll('.bbm-profile-form');
  const dangerZone = forms[forms.length - 1];
  dangerZone.before(section);

  let venues = [];
  try {
    const data = await window.Api.getMyVenues();
    venues = data.venues || [];
  } catch (err) {
    section.querySelector('#venueLoading').textContent = 'Failed to load venues: ' + err.message;
    return;
  }

  section.querySelector('#venueLoading').remove();

  if (venues.length === 0) {
    section.innerHTML += `
      <p class="text-muted-bb small mb-3">No venue yet. Create one to appear on the map as a fixed location.</p>
      <div id="venueCreateAlert" class="d-none mb-3"></div>
      <div id="venueCreateForm">
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
        </div>
        <p class="text-muted-bb small mb-3">Venue name, address, and location cannot be changed after creation.</p>
        <button class="btn btn-bbm-primary" id="vcSubmitBtn"><i class="bi bi-house-check me-2"></i>Create Venue</button>
      </div>`;

    document.getElementById('vcSubmitBtn').addEventListener('click', async () => {
      const alertEl = document.getElementById('venueCreateAlert');
      const name    = document.getElementById('vcName').value.trim();
      const address = document.getElementById('vcAddress').value.trim();
      const lat     = parseFloat(document.getElementById('vcLat').value);
      const lon     = parseFloat(document.getElementById('vcLon').value);
      alertEl.classList.add('d-none');
      if (name.length < 2) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Venue name must be at least 2 characters.'; alertEl.classList.remove('d-none'); return; }
      if (isNaN(lat) || isNaN(lon)) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Valid latitude and longitude required.'; alertEl.classList.remove('d-none'); return; }
      try {
        await window.Api.createVenue({ venueName: name, address, fixedLat: lat, fixedLon: lon });
        renderManagerVenueSection(profileWrap);
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });
  } else {
    const venue = venues[0];
    section.innerHTML += `
      <div id="venueAlert" class="d-none mb-3"></div>
      <div class="bbm-section mb-3">
        <div class="d-flex align-items-center gap-2 mb-3 flex-wrap">
          <strong>${escHtml(venue.venueName || '—')}</strong>
          <span class="badge bg-secondary" style="font-size:0.72rem">${escHtml(venue.tier || 'regular')}</span>
        </div>
        <div class="text-muted-bb small mb-3"><i class="bi bi-geo-alt me-1"></i>${escHtml(venue.address || '—')}</div>
        <div class="row g-3 mb-3">
          <div class="col-12">
            <label class="form-label">Description</label>
            <textarea class="form-control" id="veDesc" rows="3" maxlength="500" placeholder="Tell people about your venue…">${escHtml(venue.description || '')}</textarea>
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Opening Hours</label>
            <input type="text" class="form-control" id="veHours" maxlength="128" placeholder="e.g. Mon–Fri 18:00–02:00" value="${escHtml(venue.openingHours || '')}" />
          </div>
          <div class="col-12 col-sm-6">
            <label class="form-label">Type</label>
            <input type="text" class="form-control" id="veType" maxlength="64" placeholder="e.g. Bar, Club, Restaurant" value="${escHtml(venue.locationType || '')}" />
          </div>
        </div>
        <div class="d-flex gap-3 flex-wrap align-items-center">
          <button class="btn btn-bbm-primary" id="veSaveBtn"><i class="bi bi-check2 me-2"></i>Save Venue</button>
          <button class="btn btn-bbm-danger" id="veDeleteBtn"><i class="bi bi-trash3 me-2"></i>Delete Venue</button>
        </div>
      </div>`;

    document.getElementById('veSaveBtn').addEventListener('click', async () => {
      const alertEl = document.getElementById('venueAlert');
      alertEl.classList.add('d-none');
      try {
        await window.Api.updateVenue(venue.id, {
          description:   document.getElementById('veDesc').value.trim(),
          openingHours:  document.getElementById('veHours').value.trim(),
          locationType:  document.getElementById('veType').value.trim(),
        });
        alertEl.className = 'alert alert-success'; alertEl.textContent = 'Venue saved.'; alertEl.classList.remove('d-none');
        setTimeout(() => alertEl.classList.add('d-none'), 3000);
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });

    document.getElementById('veDeleteBtn').addEventListener('click', async () => {
      if (!confirm(`Delete "${venue.venueName || 'this venue'}"? All messages and favourites will be permanently deleted.`)) return;
      const alertEl = document.getElementById('venueAlert');
      try {
        await window.Api.deleteVenue(venue.id);
        renderManagerVenueSection(profileWrap);
      } catch (err) {
        alertEl.className = 'alert alert-danger'; alertEl.textContent = err.message; alertEl.classList.remove('d-none');
      }
    });
  }
}

// ── Public Profile ────────────────────────────────────────
async function renderPublicProfile() {
  const page = document.getElementById('pubProfilePage');
  if (!page) return;

  const params      = new URLSearchParams(window.location.search);
  const userId      = params.get('uid');
  const displayName = params.get('name') || userId;

  if (!userId) { window.location.href = (window.BOOMBOOM_BASE || '') + '/'; return; }

  page.innerHTML = loadingHtml('Loading profile…');

  const viewerIsReg = isRegistered();

  try {
    const profile   = await window.Api.getProfile(userId);
    const isVenue   = profile.accountType === 'venue';
    const cls       = isVenue ? 'venue' : sexClass(profile.sex);
    const avatarInner = isVenue ? '<i class="bi bi-house-fill"></i>' : sexEmoji(profile.sex);
    const threadHref = `${window.BOOMBOOM_BASE || ''}/messages/thread/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(profile.nickname || displayName)}`;

    let isFav = false;
    if (viewerIsReg) {
      try {
        const { favourites = [] } = await window.Api.getFavourites();
        isFav = favourites.some(f => f.userId === userId);
      } catch { /* ok */ }
    }

    const isBlocked = !!profile.blockedByViewer;
    const msgBtnHtml = isBlocked
      ? `<span class="btn btn-bbm-pink disabled" aria-disabled="true" style="opacity:0.5"><i class="bi bi-chat-dots me-2"></i>Message</span>`
      : `<a href="${threadHref}" class="btn btn-bbm-pink"><i class="bi bi-chat-dots me-2"></i>Message</a>`;
    const blockToggleHtml = isBlocked
      ? `<button class="btn btn-link text-muted p-0" id="unblockUserBtn" style="font-size:0.875rem;text-decoration:none">
           <i class="bi bi-slash-circle me-1"></i>Unblock
         </button>`
      : `<button class="btn btn-link text-danger p-0" id="blockUserBtn" style="font-size:0.875rem;text-decoration:none">
           <i class="bi bi-slash-circle me-1"></i>Block User
         </button>`;

    const actionBlock = viewerIsReg ? `
      <div class="d-flex gap-3 flex-wrap mt-4 align-items-center">
        ${msgBtnHtml}
        <button class="btn ${isFav ? 'btn-bbm-outline-pink' : 'btn-bbm-ghost'}" id="favToggleBtn"
          data-userid="${escHtml(userId)}" data-fav="${isFav}">
          <i class="bi bi-star${isFav ? '-fill text-pink' : ''} me-2"></i>${isFav ? 'Favourited' : 'Add to Favourites'}
        </button>
        ${isBlocked ? '<span class="badge bg-secondary" style="font-size:0.75rem">Blocked</span>' : ''}
      </div>
      <div class="mt-3">
        ${blockToggleHtml}
      </div>` : `
      <div class="mt-4">
        <p class="text-muted-bb mb-3">Create an account to message and favourite people nearby.</p>
        <div class="d-flex gap-3 flex-wrap">
          <button class="btn btn-bbm-primary" data-bs-toggle="modal" data-bs-target="#registerModal">
            <i class="bi bi-person-plus me-2"></i>Create Account</button>
          <button class="btn btn-bbm-ghost" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button>
        </div>
      </div>`;

    page.innerHTML = `
      <div class="bbm-pub-profile-hero">
        <div class="container-fluid px-4 px-md-5">
          <div class="bbm-pub-avatar ${cls}">${avatarInner}</div>
          <h1 class="bbm-pub-name">${escHtml(profile.nickname || displayName)}</h1>
          ${isVenue
            ? `<p class="bbm-pub-meta"><i class="bi bi-house-fill me-1"></i>Venue</p>`
            : `<p class="bbm-pub-meta">${profile.age ? escHtml(String(profile.age)) + ' · ' : ''}${sexLabel(profile.sex)}</p>`
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

    const blockBtn = document.getElementById('blockUserBtn');
    blockBtn?.addEventListener('click', () => {
      window.BlockModule?.prompt(userId, profile.nickname || displayName);
    });

    const unblockBtn = document.getElementById('unblockUserBtn');
    unblockBtn?.addEventListener('click', async () => {
      try {
        await window.Api.unblockUser(userId);
        renderPublicProfile();
      } catch (err) { alert('Error: ' + err.message); }
    });

    const favBtn = document.getElementById('favToggleBtn');
    favBtn?.addEventListener('click', async () => {
      const wasFav = favBtn.dataset.fav === 'true';
      try {
        if (wasFav) {
          await window.Api.removeFavourite(userId);
          favBtn.dataset.fav = 'false';
          favBtn.className = 'btn btn-bbm-ghost';
          favBtn.innerHTML = '<i class="bi bi-star me-2"></i>Add to Favourites';
        } else {
          await window.Api.addFavourite(userId);
          favBtn.dataset.fav = 'true';
          favBtn.className = 'btn btn-bbm-outline-pink';
          favBtn.innerHTML = '<i class="bi bi-star-fill text-pink me-2"></i>Favourited';
        }
      } catch (err) { alert('Error: ' + err.message); }
    });

  } catch (err) {
    page.innerHTML = `<div class="container-fluid px-4 px-md-5 py-5">
      <div class="alert alert-danger">${escHtml(err.message)}</div>
      <a href="/" class="btn btn-bbm-ghost mt-2"><i class="bi bi-arrow-left me-2"></i>Back to Map</a>
    </div>`;
  }
}

// After blocking from the public profile page, re-render to show Unblock button
document.addEventListener('bbm:user-blocked', function () {
  if (document.getElementById('pubProfilePage')) {
    renderPublicProfile();
  }
});

// Auto-run when loaded as extra_js
(window.__authReady || Promise.resolve()).then(function() {
  if (document.getElementById('profileFormWrap')) renderMyProfile();
  if (document.getElementById('pubProfilePage'))  renderPublicProfile();
});