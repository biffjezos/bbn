// ============================================================
// bOOmbOOm.NOW! — Settings page
// ============================================================

(function () {

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sexClass(sex) { return sex === 'f' ? 'female' : sex === 'm' ? 'male' : 'unknown'; }

  // Decode JWT payload without verification (signature checked server-side).
  function parseJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return null; }
  }

  // Handle BSON extended-JSON date format produced by the Rust backend.
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
    if (m === -1) return 'Unlimited';
    if (m >= 1000) return (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km';
    return m + ' m';
  }

  // ── Read-only info row helper ──────────────────────────────────────────────

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

    var tier        = claims.tier || 'regular';
    var role        = claims.role || 'user';
    var accountType = claims.account_type || 'user';

    // Friendly labels
    var accountTypeLabel = accountType === 'venue' ? 'Venue' : 'User';
    var roleLabel = role === 'admin' ? 'Administrator'
                  : role === 'venue_manager' ? 'Venue Manager'
                  : null;

    // Fetch /users/me and tier info in parallel
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
    rows.push(infoRow('Membership', tierLabel));
    rows.push(infoRow('Member since', memberSince));

    rows.push('<div class="mt-3 mb-2" style="max-width:400px"><hr style="border-color:var(--bbm-border,rgba(255,255,255,.08))"></div>');

    rows.push(infoRow('Messages auto-delete after', '4 hours'));
    rows.push(infoRow('Nearby radius', formatRadius(nearbyRadiusM)));
    if (messageRadiusM != null) {
      rows.push(infoRow('Messaging radius', formatRadius(messageRadiusM)));
    }

    wrap.innerHTML = rows.join('');
  }

  // ── Profile Form ───────────────────────────────────────────────────────────

  function initProfileForm() {
    var wrap = document.getElementById('profileSettingsWrap');
    if (!wrap) return;

    var token  = window.Auth && window.Auth.getToken && window.Auth.getToken();
    var claims = token ? parseJwt(token) : null;
    if (!claims) return;

    // Only show for registered users
    if (!window.Auth.isRegistered()) return;
    wrap.style.display = '';

    var accountType = claims.account_type || 'user';
    var isVenue     = accountType === 'venue';

    // Pre-fill from JWT
    var nickEl = document.getElementById('profileNickname');
    var ageEl  = document.getElementById('profileAge');
    var sexEl  = document.getElementById('profileSex');
    var ageWrap = document.getElementById('profileAgeWrap');
    var sexWrap = document.getElementById('profileSexWrap');

    if (nickEl) nickEl.value = claims.nickname || '';

    if (isVenue) {
      // Venues don't have age/sex
      if (ageWrap) ageWrap.style.display = 'none';
      if (sexWrap) sexWrap.style.display = 'none';
    } else {
      if (ageEl && claims.age) ageEl.value = claims.age;
      if (sexEl && claims.sex) sexEl.value = claims.sex;
    }

    var form      = document.getElementById('profileForm');
    var saveBtn   = document.getElementById('profileSaveBtn');
    var statusEl  = document.getElementById('profileStatus');

    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (saveBtn) saveBtn.disabled = true;
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }

      var fields = {};
      if (nickEl) fields.nickname = nickEl.value.trim();
      if (!isVenue) {
        if (ageEl)  fields.age = parseInt(ageEl.value, 10);
        if (sexEl)  fields.sex = sexEl.value;
      }

      try {
        await window.Api.updateMe(fields);
        if (window.Auth && window.Auth.updateProfile) {
          window.Auth.updateProfile({ nickname: fields.nickname, sex: fields.sex });
        }
        if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--bbm-accent-green, #4c4)'; }
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || 'Could not save.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // ── Password Form ──────────────────────────────────────────────────────────

  function initPasswordForm() {
    var wrap = document.getElementById('passwordWrap');
    if (!wrap) return;
    if (!window.Auth || !window.Auth.isRegistered()) return;
    wrap.style.display = '';

    var form       = document.getElementById('passwordForm');
    var saveBtn    = document.getElementById('passwordSaveBtn');
    var statusEl   = document.getElementById('passwordStatus');
    var currentEl  = document.getElementById('currentPassword');
    var newEl      = document.getElementById('newPassword');

    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (saveBtn) saveBtn.disabled = true;
      if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }

      var oldPass = currentEl ? currentEl.value : '';
      var newPass = newEl     ? newEl.value     : '';

      if (!oldPass || !newPass) {
        if (statusEl) { statusEl.textContent = 'Both fields are required.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      if (newPass.length < 8) {
        if (statusEl) { statusEl.textContent = 'New password must be at least 8 characters.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
        if (saveBtn) saveBtn.disabled = false;
        return;
      }

      try {
        var updatePayload = { password: newPass, currentPassword: oldPass };

        // Re-encrypt private key with new password so it stays accessible after login.
        if (window.BBMCrypto) {
          try {
            var keys = await window.Api.getMyKeys();
            if (keys && keys.encryptedPrivateKey) {
              var newEncBlob = await window.BBMCrypto.reencrypt(oldPass, newPass, keys.encryptedPrivateKey);
              updatePayload.publicKey            = keys.publicKey;
              updatePayload.encryptedPrivateKey  = newEncBlob;
            }
          } catch (cryptoErr) {
            // Re-encryption failed — proceed with password change only.
            // Keys will need to be regenerated on next login.
            console.warn('[Settings] Key re-encryption failed:', cryptoErr.message);
          }
        }

        await window.Api.updateMe(updatePayload);

        if (statusEl) { statusEl.textContent = 'Password changed. Logging out…'; statusEl.style.color = 'var(--bbm-accent-green, #4c4)'; }
        if (currentEl) currentEl.value = '';
        if (newEl)     newEl.value     = '';

        // tokenVersion was incremented server-side — log out so the user
        // re-authenticates with their new password.
        setTimeout(function () {
          if (window.Auth && window.Auth.logout) window.Auth.logout();
        }, 1500);

      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || 'Could not change password.'; statusEl.style.color = 'var(--bbm-danger, #e05)'; }
        if (saveBtn) saveBtn.disabled = false;
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

  function initDangerZone() {
    var dangerWrap = document.getElementById('dangerZoneWrap');
    var deleteBtn  = document.getElementById('deleteAccountBtn');
    if (!dangerWrap || !deleteBtn) return;

    // Only show for registered users
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

  async function init() {
    wrap = document.getElementById('blocksWrap');
    if (!wrap) return;

    wrap.innerHTML = '<p class="text-muted-bb small">Loading…</p>';

    initAccountInfo();
    initProfileForm();
    initPasswordForm();

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
