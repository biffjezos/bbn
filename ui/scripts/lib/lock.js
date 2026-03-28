// ./lib/lock.js

const INACTIVITY_LOCK_MS = 3 * 60 * 1000;
const HIDE_LOCK_MS = 30 * 1000;

let _inactivityTimer = null;
let _hiddenTimer = null;
let _modal = null;
let _locked = false;

// ── Modal ─────────────────────────────────────────────────
function getModal() {
  if (!_modal) {
    const el = document.getElementById('lockModal');
    if (el) _modal = new bootstrap.Modal(el);
  }
  return _modal;
}

// ── Lock ──────────────────────────────────────────────────
export function lock() {
  if (!window.Auth.isRegistered()) return;
  if (_locked) return;
  _locked = true;
  clearInactivityTimer();
  window.BBNCrypto?.lock();
  if (DEBUG) console.log('[Lock] Keys locked.');
  const modal = getModal();
  if (modal) modal.show();
}

// ── Unlock ────────────────────────────────────────────────
export function unlock() {
  _locked = false;
  resetInactivityTimer();
  const modal = getModal();
  if (modal) modal.hide();
  window.dispatchEvent(new CustomEvent('bbn:unlocked'));
  if (DEBUG) console.log('[Lock] Keys unlocked.');
}

// ── Inactivity timer ──────────────────────────────────────
function clearInactivityTimer() {
  if (_inactivityTimer) {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = null;
  }
}

function resetInactivityTimer() {
  if (!window.Auth.isRegistered()) return;
  clearInactivityTimer();
  _inactivityTimer = setTimeout(lock, INACTIVITY_LOCK_MS);
}

['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(function (evt) {
  document.addEventListener(evt, function () {
    if (!_locked) resetInactivityTimer();
  }, { passive: true });
});

// ── Visibility ────────────────────────────────────────────
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    _hiddenTimer = setTimeout(function () {
      if (document.hidden) {
        if (DEBUG) console.log('[Lock] Tab hidden too long — locking.');
        lock();
      }
    }, HIDE_LOCK_MS);
  } else {
    if (_hiddenTimer) {
      clearTimeout(_hiddenTimer);
      _hiddenTimer = null;
    }
    if (!_locked) resetInactivityTimer();
  }
});

// ── Unlock button ─────────────────────────────────────────
export function initUnlockButton() {
  document.addEventListener('DOMContentLoaded', function () {
    const unlockBtn = document.getElementById('lockUnlockBtn');
    const logoutBtn = document.getElementById('lockLogoutBtn');
    const pwInput = document.getElementById('lockPassword');
    const errorEl = document.getElementById('lockError');

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.classList.remove('d-none');
    }

    function clearError() {
      if (errorEl) errorEl.classList.add('d-none');
    }

    async function tryUnlock() {
      const password = pwInput ? pwInput.value : '';
      if (!password) { showError('Please enter your password.'); return; }
      clearError();
      if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = 'Unlocking…'; }
      try {
        if (DEBUG) console.log('[Lock] Fetching encrypted key blob from server…');
        const keys = await window.Api.getMyKeys();
        if (DEBUG) console.log('[Lock] Key blob received, encryptedPrivateKey:', !!keys.encryptedPrivateKey, 'publicKey:', !!keys.publicKey);
        if (keys.encryptedPrivateKey && keys.publicKey) {
          if (DEBUG) console.log('[Lock] Decrypting private key with PBKDF2…');
          const ok = await window.BBNCrypto.unlock(keys.encryptedPrivateKey, password, keys.publicKey);
          if (!ok) throw new Error('Wrong password.');
          if (DEBUG) console.log('[Lock] Keys unlocked successfully.');
        } else {
          // No keys on server yet (legacy account) — generate and save now
          if (DEBUG) console.log('[Lock] No keys on server — generating new key pair…');
          const setup = await window.BBNCrypto.setup(password);
          if (DEBUG) console.log('[Lock] Key pair generated, saving to server…');
          await window.Api.saveKeys(setup.publicKeyB64, setup.encBlob);
          if (DEBUG) console.log('[Lock] New keys saved to server.');
        }
        if (pwInput) pwInput.value = '';
        unlock();
      } catch (e) {
        if (DEBUG) console.warn('[Lock] Unlock failed:', e.message);
        showError(e.message || 'Unlock failed.');
      } finally {
        if (unlockBtn) { unlockBtn.disabled = false; unlockBtn.innerHTML = '<i class="bi bi-unlock me-2"></i>Unlock'; }
      }
    }

    if (unlockBtn) unlockBtn.addEventListener('click', tryUnlock);
    if (pwInput) pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (pwInput) pwInput.value = '';
      clearError();
      _locked = false;
      window.Auth.logout();
      // modal will be hidden by Auth.onLogout → clearInactivityTimer path,
      // but force-hide here too in case logout races with Bootstrap state
      const modal = getModal();
      if (modal) modal.hide();
    });
  });
}

// ── requireUnlocked() ─────────────────────────────────────
export function requireUnlocked() {
  if (window.BBNCrypto?.isUnlocked()) { _locked = false; return true; }
  _locked = true;
  const modal = getModal();
  if (modal) modal.show();
  return false;
}

// ── Auth hooks ────────────────────────────────────────────
let _origOnLogin = Auth.onLogin;
Auth.onLogin = function (data) {
  if (_origOnLogin) _origOnLogin(data);
  _locked = false;
  resetInactivityTimer();
};

// On page load with a saved token: ask the crypto worker if the key is already
// loaded (SharedWorker retains it across navigations). If yes, fire bbn:unlocked
// silently. If no (new session, Safari regular Worker, or inactivity lock),
// mark locked so messages.js shows the lock modal.
Auth.onNeedsUnlock = async function () {
  await window.BBNCrypto?.ready?.();
  if (window.BBNCrypto?.isUnlocked()) {
    _locked = false;
    resetInactivityTimer();
    window.dispatchEvent(new CustomEvent('bbn:unlocked'));
  } else {
    _locked = true;
    const modal = getModal();
    if (modal) modal.show();
  }
};

let _origOnLogout = Auth.onLogout;
Auth.onLogout = function () {
  if (_origOnLogout) _origOnLogout();
  clearInactivityTimer();
  if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
  _locked = false;
};
