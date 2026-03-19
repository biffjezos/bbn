// ============================================================
// LockModule
// Keys live in the crypto worker (SharedWorker where supported,
// regular Worker on Safari). The SharedWorker survives full-page
// navigations so no sessionStorage key export is needed.
// ============================================================
(function () {

  var INACTIVITY_LOCK_MS = 3 * 60 * 1000;
  var HIDE_LOCK_MS       = 30 * 1000;

  var _inactivityTimer = null;
  var _hiddenTimer     = null;
  var _modal           = null;
  var _locked          = false;

  // ── Modal ─────────────────────────────────────────────────

  function getModal() {
    if (!_modal) {
      var el = document.getElementById('lockModal');
      if (el) _modal = new bootstrap.Modal(el);
    }
    return _modal;
  }

  // ── Lock ──────────────────────────────────────────────────

  function lock() {
    if (!window.Auth.isRegistered()) return;
    if (_locked) return;
    _locked = true;
    clearInactivityTimer();
    window.BBMCrypto?.lock();
    if (DEBUG) console.log('[Lock] Keys locked.');
    var modal = getModal();
    if (modal) modal.show();
  }

  // ── Unlock ────────────────────────────────────────────────

  function unlock() {
    _locked = false;
    resetInactivityTimer();
    var modal = getModal();
    if (modal) modal.hide();
    window.dispatchEvent(new CustomEvent('bbm:unlocked'));
    if (DEBUG) console.log('[Lock] Keys unlocked.');
  }

  // ── Inactivity timer ──────────────────────────────────────

  function clearInactivityTimer() {
    if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
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
        if (document.hidden) { if (DEBUG) console.log('[Lock] Tab hidden too long — locking.'); lock(); }
      }, HIDE_LOCK_MS);
    } else {
      if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
      if (!_locked) resetInactivityTimer();
    }
  });

  // ── Unlock button ─────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    var unlockBtn = document.getElementById('lockUnlockBtn');
    var logoutBtn = document.getElementById('lockLogoutBtn');
    var pwInput   = document.getElementById('lockPassword');
    var errorEl   = document.getElementById('lockError');

    function showError(msg) {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.classList.remove('d-none');
    }
    function clearError() {
      if (errorEl) errorEl.classList.add('d-none');
    }

    async function tryUnlock() {
      var password = pwInput ? pwInput.value : '';
      if (!password) { showError('Please enter your password.'); return; }
      clearError();
      if (unlockBtn) { unlockBtn.disabled = true; unlockBtn.textContent = 'Unlocking…'; }
      try {
        if (DEBUG) console.log('[Lock] Fetching encrypted key blob from server…');
        var keys = await window.Api.getMyKeys();
        if (DEBUG) console.log('[Lock] Key blob received, encryptedPrivateKey:', !!keys.encryptedPrivateKey, 'publicKey:', !!keys.publicKey);
        if (keys.encryptedPrivateKey && keys.publicKey) {
          if (DEBUG) console.log('[Lock] Decrypting private key with PBKDF2…');
          var ok = await window.BBMCrypto.unlock(keys.encryptedPrivateKey, password, keys.publicKey);
          if (!ok) throw new Error('Wrong password.');
          if (DEBUG) console.log('[Lock] Keys unlocked successfully.');
        } else {
          // No keys on server yet (legacy account) — generate and save now
          if (DEBUG) console.log('[Lock] No keys on server — generating new key pair…');
          var setup = await window.BBMCrypto.setup(password);
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
    if (pwInput)   pwInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (pwInput) pwInput.value = '';
      clearError();
      _locked = false;
      window.Auth.logout();
      // modal will be hidden by Auth.onLogout → clearInactivityTimer path,
      // but force-hide here too in case logout races with Bootstrap state
      var modal = getModal();
      if (modal) modal.hide();
    });
  });

  // ── requireUnlocked() ─────────────────────────────────────

  window.requireUnlocked = function () {
    if (window.BBMCrypto?.isUnlocked()) { _locked = false; return true; }
    _locked = true;
    var modal = getModal();
    if (modal) modal.show();
    return false;
  };

  // ── Auth hooks ────────────────────────────────────────────

  var _origOnLogin = Auth.onLogin;
  Auth.onLogin = function (data) {
    if (_origOnLogin) _origOnLogin(data);
    _locked = false;
    resetInactivityTimer();
  };

  // On page load with a saved token: ask the crypto worker if the key is already
  // loaded (SharedWorker retains it across navigations). If yes, fire bbm:unlocked
  // silently. If no (new session, Safari regular Worker, or inactivity lock),
  // mark locked so messages.js shows the lock modal.
  Auth.onNeedsUnlock = async function () {
    await window.BBMCrypto?.ready?.();
    if (window.BBMCrypto?.isUnlocked()) {
      _locked = false;
      resetInactivityTimer();
      window.dispatchEvent(new CustomEvent('bbm:unlocked'));
    } else {
      _locked = true;
      var modal = getModal();
      if (modal) modal.show();
    }
  };

  var _origOnLogout = Auth.onLogout;
  Auth.onLogout = function () {
    if (_origOnLogout) _origOnLogout();
    clearInactivityTimer();
    if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null; }
    _locked = false;
  };

})();
