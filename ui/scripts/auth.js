// ============================================================
// bOOmbOOm.NOW! — Auth State
// Manages tokens, guest UUID, session countdown.
// ============================================================

const STORAGE_TOKEN_KEY   = 'bbm_token';
const STORAGE_GUEST_KEY   = 'bbm_guest_id';
const STORAGE_NICK_KEY    = 'bbm_nickname';
const STORAGE_SEX_KEY     = 'bbm_sex';
const STORAGE_TIER_KEY    = 'bbm_tier';
const GUEST_TTL_MS        = 15 * 60 * 1000;

const Auth = (() => {

  let _token       = null;
  let _guestId     = null;
  let _nickname    = null;
  let _sex         = null;
  let _tier        = null;   // 'guest' | 'regular' | 'premium'
  let _isUser      = false;
  let _guestExpiry = null;
  let _countdownInterval = null;

  // ---- Internal helpers ------------------------------------

  function parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
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
    if (_tier)     localStorage.setItem(STORAGE_TIER_KEY,  _tier);
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_NICK_KEY);
    localStorage.removeItem(STORAGE_SEX_KEY);
    localStorage.removeItem(STORAGE_TIER_KEY);
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID)
      return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getOrCreateGuestId() {
    let id = localStorage.getItem(STORAGE_GUEST_KEY);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(STORAGE_GUEST_KEY, id);
    }
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
    const el = document.getElementById('guestCountdown');
    el?.classList.add('d-none');
  }

  // ---- Public API ------------------------------------------

  return {

    async init() {
      const stored = localStorage.getItem(STORAGE_TOKEN_KEY);
      if (stored && !isTokenExpired(stored)) {
        _token    = stored;
        _nickname = localStorage.getItem(STORAGE_NICK_KEY);
        _sex      = localStorage.getItem(STORAGE_SEX_KEY);
        _tier     = localStorage.getItem(STORAGE_TIER_KEY) || 'regular';
        _isUser   = true;
        Auth.onLogin?.({ nickname: _nickname, sex: _sex, tier: _tier });
        return;
      } else if (stored) {
        clearStorage();
      }
      await Auth.initGuest();
    },

    async initGuest() {
      _guestId = getOrCreateGuestId();
      try {
        const data = await window.Api.guestAuth(_guestId);
        _token       = data.token;
        _tier        = 'guest';
        _isUser      = false;
        _guestExpiry = Date.now() + GUEST_TTL_MS;
        startCountdown(_guestExpiry);
        Auth.onGuestReady?.();
      } catch (err) {
        console.warn('[Auth] Guest token failed', err);
        Auth.onGuestExpired?.();
      }
    },

    async login({ login, password }) {
      const data = await window.Api.login({ login, password, guestId: _guestId });
      _token    = data.token;
      _nickname = data.nickname;
      _sex      = data.sex;
      _tier     = data.tier || 'regular';
      _isUser   = true;
      saveToStorage();
      stopCountdown();
      Auth.onLogin?.({ nickname: _nickname, sex: _sex, tier: _tier });
      return data;
    },

    async register(fields) {
      const data = await window.Api.register({ ...fields, guestId: _guestId });
      _token    = data.token;
      _nickname = data.nickname;
      _sex      = data.sex;
      _tier     = data.tier || 'regular';
      _isUser   = true;
      saveToStorage();
      stopCountdown();
      Auth.onLogin?.({ nickname: _nickname, sex: _sex, tier: _tier });
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
      _tier     = null;
      _isUser   = false;
      Auth.initGuest();
      Auth.onLogout?.();
    },

    async deleteAccount() {
      await window.Api.deleteMe();
      clearStorage();
      _token    = null;
      _nickname = null;
      _sex      = null;
      _tier     = null;
      _isUser   = false;
      Auth.initGuest();
      Auth.onLogout?.();
    },

    getToken()     { return _token; },
    getNickname()  { return _nickname; },
    getSex()       { return _sex; },
    getTier()      { return _tier || 'guest'; },
    isRegistered() { return _isUser; },
    getGuestId()   { return _guestId; },

    onLogin:        null,
    onLogout:       null,
    onGuestReady:   null,
    onGuestExpired: null,
  };
})();

window.Auth = Auth;
