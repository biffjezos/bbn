// ============================================================
// bOOmbOOm.NOW! — Auth State
// Manages tokens, guest UUID, session countdown.
// ============================================================

const STORAGE_TOKEN_KEY = 'bbm_token';
const STORAGE_GUEST_KEY = 'bbm_guest_id';
const STORAGE_NICK_KEY  = 'bbm_nickname';
const STORAGE_SEX_KEY   = 'bbm_sex';
// Key to persist the guest session expiry across page reloads
const STORAGE_GUEST_EXP = 'bbm_guest_exp';
const GUEST_TTL_MS      = 15 * 60 * 1000; // must match server CONFIG
const GUEST_CLEANUP_MS  = 60 * 60 * 1000; // 1 hour — then fresh session allowed

const Auth = (() => {

  let _token             = null;
  let _guestId           = null;
  let _nickname          = null;
  let _sex               = null;
  let _isUser            = false;
  let _countdownInterval = null;

  // ---- Internal helpers ------------------------------------

  function parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch { return null; }
  }

  function isTokenExpired(token) {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return true;
    return Date.now() / 1000 >= payload.exp;
  }

  function saveToStorage() {
    if (_token)    localStorage.setItem(STORAGE_TOKEN_KEY, _token);
    if (_nickname) localStorage.setItem(STORAGE_NICK_KEY,  _nickname);
    if (_sex)      localStorage.setItem(STORAGE_SEX_KEY,   _sex);
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_NICK_KEY);
    localStorage.removeItem(STORAGE_SEX_KEY);
    // Do NOT remove guest keys here — guest session persists across logout
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getOrCreateGuestId() {
    let id = localStorage.getItem(STORAGE_GUEST_KEY);
    if (!id) { id = generateUUID(); localStorage.setItem(STORAGE_GUEST_KEY, id); }
    return id;
  }

  // ---- Countdown display -----------------------------------

  function startCountdown(expiryMs) {
    const el    = document.getElementById('guestCountdown');
    const timer = document.getElementById('countdownTimer');
    if (!el || !timer) return;
    el.classList.remove('d-none');
    if (_countdownInterval) clearInterval(_countdownInterval);

    _countdownInterval = setInterval(() => {
      const remaining = expiryMs - Date.now();
      if (remaining <= 0) {
        clearInterval(_countdownInterval);
        timer.textContent = '0:00';
        el.classList.add('d-none');
        Auth.onGuestExpired?.();
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
      timer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopCountdown() {
    if (_countdownInterval) clearInterval(_countdownInterval);
    document.getElementById('guestCountdown')?.classList.add('d-none');
  }

  // ---- Public API ------------------------------------------

  return {

    async init() {
      // 1. Try to restore a valid user token
      const stored = localStorage.getItem(STORAGE_TOKEN_KEY);
      if (stored && !isTokenExpired(stored)) {
        _token    = stored;
        _nickname = localStorage.getItem(STORAGE_NICK_KEY);
        _sex      = localStorage.getItem(STORAGE_SEX_KEY);
        _isUser   = true;
        Auth.onLogin?.({ nickname: _nickname, sex: _sex });
        return;
      } else if (stored) {
        clearStorage();
      }

      // 2. No valid user token — handle guest session
      await Auth.initGuest();
    },

    async initGuest() {
      _guestId = getOrCreateGuestId();
      const now = Date.now();

      // Check if we already have a persisted guest expiry
      const storedExp = parseInt(localStorage.getItem(STORAGE_GUEST_EXP) || '0', 10);

      if (storedExp > now) {
        // Existing session still valid — reuse it, resume countdown
        try {
          const data = await window.Api.guestAuth(_guestId);
          _token  = data.token;
          _isUser = false;
          // Resume from the STORED expiry, not a fresh 15 minutes
          startCountdown(storedExp);
          Auth.onGuestReady?.();
        } catch (err) {
          console.warn('[Auth] Guest token refresh failed', err);
          Auth.onGuestExpired?.();
        }
        return;
      }

      if (storedExp && storedExp <= now && (now - storedExp) < GUEST_CLEANUP_MS) {
        // Session expired but within cleanup window — block access
        _token  = null;
        _isUser = false;
        Auth.onGuestExpired?.();
        return;
      }

      // No session or past cleanup window — start a fresh guest session
      try {
        const data = await window.Api.guestAuth(_guestId);
        _token  = data.token;
        _isUser = false;
        const expiryMs = now + GUEST_TTL_MS;
        localStorage.setItem(STORAGE_GUEST_EXP, String(expiryMs));
        startCountdown(expiryMs);
        Auth.onGuestReady?.();
      } catch (err) {
        console.warn('[Auth] Guest token failed', err);
        Auth.onGuestExpired?.();
      }
    },

    async login({ email, password }) {
      const data = await window.Api.login({ email, password, guestId: _guestId });
      _token    = data.token;
      _nickname = data.nickname;
      _sex      = data.sex;
      _isUser   = true;
      saveToStorage();
      stopCountdown();
      // Clear guest expiry — guest session consumed on login
      localStorage.removeItem(STORAGE_GUEST_EXP);
      Auth.onLogin?.({ nickname: _nickname, sex: _sex });
      return data;
    },

    async register(fields) {
      const data = await window.Api.register({ ...fields, guestId: _guestId });
      _token    = data.token;
      _nickname = data.nickname;
      _sex      = data.sex;
      _isUser   = true;
      saveToStorage();
      stopCountdown();
      localStorage.removeItem(STORAGE_GUEST_EXP);
      Auth.onLogin?.({ nickname: _nickname, sex: _sex });
      return data;
    },

    updateProfile(fields) {
      if (fields.sex      !== undefined) { _sex      = fields.sex;      localStorage.setItem(STORAGE_SEX_KEY,  _sex);      }
      if (fields.nickname !== undefined) { _nickname = fields.nickname; localStorage.setItem(STORAGE_NICK_KEY, _nickname); }
    },

    logout() {
      clearStorage();
      _token    = null;
      _nickname = null;
      _sex      = null;
      _isUser   = false;
      Auth.onLogout?.();
      Auth.initGuest();
    },

    async deleteAccount() {
      await window.Api.deleteMe();
      clearStorage();
      _token    = null;
      _nickname = null;
      _sex      = null;
      _isUser   = false;
      Auth.onLogout?.();
      Auth.initGuest();
    },

    getTier() {
      if (!_token) return 'guest';
      return parseJwt(_token)?.tier || 'guest';
    },

    // getProfile() — convenience object for app.js compatibility
    getProfile() {
      return { nickname: _nickname, sex: _sex };
    },

    getToken()     { return _token;    },
    getNickname()  { return _nickname; },
    getSex()       { return _sex;      },
    isRegistered() { return _isUser;   },
    getGuestId()   { return _guestId;  },

    onLogin:        null,
    onLogout:       null,
    onGuestReady:   null,
    onGuestExpired: null,
  };
})();

window.Auth = Auth;