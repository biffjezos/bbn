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
    return payload.role === 'user';
  } catch { return false; }
}

function getJwtField(field) {
  try { return JSON.parse(atob(window.Auth.getToken().split('.')[1]))[field] ?? null; }
  catch { return null; }
}

function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }
function sexEmoji(sex)  { return sex === 'f' ? '👌' : sex === 'm' ? '👆' : '👊'; }
function sexLabel(sex)  { return sex === 'f' ? 'Female' : sex === 'm' ? 'Male' : '—'; }

function loadingHtml(text = 'Loading…') {
  return `<div class="bbm-loading"><p>${escHtml(text)}</p></div>`;
}

// ── My Profile ────────────────────────────────────────────
async function renderMyProfile() {
  const wrap = document.getElementById('profileFormWrap');
  if (!wrap) return;

  if (!isRegistered()) {
    wrap.innerHTML = `<div class="bbm-empty"><i class="bi bi-person-circle"></i>
      <p>Log in to manage your profile.</p>
      <button class="btn btn-bbm-primary mt-3" data-bs-toggle="modal" data-bs-target="#loginModal">Log In</button></div>`;
    return;
  }

  wrap.innerHTML = loadingHtml('Loading profile…');

  // Load current values — try Auth.getProfile(), fall back to /users/me API, fall back to JWT
  let current = {};
  try {
    const p = window.Auth?.getProfile?.();
    if (p && (p.nickname || p.sex)) {
      current = p;
    } else {
      const me = await window.Api.getMe();
      current = me;
    }
  } catch {
    current = {
      nickname: getJwtField('nickname'),
      sex:      getJwtField('sex'),
      age:      getJwtField('age'),
    };
  }

  wrap.innerHTML = `
    <div class="bbm-profile-form">
      <div id="profileAlert" class="d-none mb-4"></div>

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
      </div>

      <div class="d-flex gap-3 flex-wrap mb-4">
        <button class="btn btn-bbm-primary" id="saveProfileBtn">
          <i class="bi bi-check2 me-2"></i>Save Changes
        </button>
        <button class="btn btn-bbm-ghost" id="changePasswordBtn">
          <i class="bi bi-key me-2"></i>Change Password
        </button>
      </div>
    </div>`;

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const alertEl  = document.getElementById('profileAlert');
    const nickname = document.getElementById('editNickname').value.trim();
    const age      = parseInt(document.getElementById('editAge').value, 10);
    const sex      = document.getElementById('editSex').value;
    alertEl.classList.add('d-none');
    try {
      await window.Api.updateMe({ nickname, age, sex });
      window.Auth.updateProfile?.({ nickname, sex });
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
    wrap.appendChild(section);

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
        // updateMe with current + new password — field names may vary by your backend
        await window.Api.updateMe({ currentPassword: curr, password: nw });
        alertEl.className = 'alert alert-success'; alertEl.textContent = 'Password updated.'; alertEl.classList.remove('d-none');
        ['currentPw','newPw','confirmPw'].forEach(id => document.getElementById(id).value = '');
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

  const viewerIsReg = isRegistered();

  try {
    const profile = await window.Api.getProfile(userId);
    const cls     = sexClass(profile.sex);
    const emoji   = sexEmoji(profile.sex);
    const threadHref = `/messages/thread/?uid=${encodeURIComponent(userId)}&name=${encodeURIComponent(profile.nickname || displayName)}`;

    let isFav = false;
    if (viewerIsReg) {
      try {
        const { favourites = [] } = await window.Api.getFavourites();
        isFav = favourites.some(f => f.userId === userId);
      } catch { /* ok */ }
    }

    const actionBlock = viewerIsReg ? `
      <div class="d-flex gap-3 flex-wrap mt-4">
        <a href="${threadHref}" class="btn btn-bbm-pink"><i class="bi bi-chat-dots me-2"></i>Message</a>
        <button class="btn ${isFav ? 'btn-bbm-outline-pink' : 'btn-bbm-ghost'}" id="favToggleBtn"
          data-userid="${escHtml(userId)}" data-fav="${isFav}">
          <i class="bi bi-star${isFav ? '-fill text-pink' : ''} me-2"></i>${isFav ? 'Favourited' : 'Add to Favourites'}
        </button>
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
          <div class="bbm-pub-avatar ${cls}">${emoji}</div>
          <h1 class="bbm-pub-name">${escHtml(profile.nickname || displayName)}</h1>
          <p class="bbm-pub-meta">${profile.age ? escHtml(String(profile.age)) + ' · ' : ''}${sexLabel(profile.sex)}</p>
          ${actionBlock}
        </div>
      </div>
      <div class="container-fluid px-4 px-md-5 py-4">
        <p class="text-faint small">More profile details coming soon.</p>
      </div>`;

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

// Auto-run when loaded as extra_js
(window.__authReady || Promise.resolve()).then(function() {
  if (document.getElementById('profileFormWrap')) renderMyProfile();
  if (document.getElementById('pubProfilePage'))  renderPublicProfile();
});