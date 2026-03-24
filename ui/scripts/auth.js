// ============================================================
// bOOmbOOm.NOW! — Auth State
// ============================================================

const STORAGE_TOKEN_KEY = 'bbm_token';
const STORAGE_GUEST_KEY = 'bbm_guest_id';
const STORAGE_NICK_KEY  = 'bbm_nickname';
const STORAGE_SEX_KEY   = 'bbm_sex';
const STORAGE_GUEST_EXP = 'bbm_guest_exp';
const GUEST_TTL_MS      = 15 * 60 * 1000;
const GUEST_CLEANUP_MS  = 60 * 60 * 1000; // 1 hour

const Auth = (() => {

  let _token             = null;
  let _guestId           = null;
  let _nickname          = null;
  let _sex               = null;
  let _isUser            = false;
  let _countdownInterval = null;

  function parseJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    } catch { return null; }
  }

  function isTokenExpired(token) {
    const p = parseJwt(token);
    if (!p?.exp) return true;
    return Date.now() / 1000 >= p.exp;
  }

  function saveToStorage() {
    if (_token)    sessionStorage.setItem(STORAGE_TOKEN_KEY, _token);
    if (_nickname) sessionStorage.setItem(STORAGE_NICK_KEY,  _nickname);
    if (_sex)      sessionStorage.setItem(STORAGE_SEX_KEY,   _sex);
  }

  function clearUserStorage() {
    sessionStorage.removeItem(STORAGE_TOKEN_KEY);
    sessionStorage.removeItem(STORAGE_NICK_KEY);
    sessionStorage.removeItem(STORAGE_SEX_KEY);
    localStorage.removeItem('bbm_meet');
    // Keep guest keys — guest session is independent of user account
  }

  function getOrCreateGuestId() {
    let id = localStorage.getItem(STORAGE_GUEST_KEY);
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        // Fallback for browsers without randomUUID: use getRandomValues (never Math.random).
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40; // version 4
        b[8] = (b[8] & 0x3f) | 0x80; // variant bits
        const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        id = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
      }
      localStorage.setItem(STORAGE_GUEST_KEY, id);
    }
    return id;
  }

  function startCountdown(expiryMs) {
    const el    = document.getElementById('guestCountdown');
    const timer = document.getElementById('countdownTimer');
    if (!el || !timer) return;
    el.classList.remove('d-none');
    if (_countdownInterval) clearInterval(_countdownInterval);
    _countdownInterval = setInterval(() => {
      const rem = expiryMs - Date.now();
      if (rem <= 0) {
        clearInterval(_countdownInterval);
        timer.textContent = '0:00';
        el.classList.add('d-none');
        Auth.onGuestExpired?.();
        return;
      }
      const m = Math.floor(rem / 60000);
      const s = Math.floor((rem % 60000) / 1000).toString().padStart(2,'0');
      timer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopCountdown() {
    if (_countdownInterval) clearInterval(_countdownInterval);
    document.getElementById('guestCountdown')?.classList.add('d-none');
  }

  return {

    async init() {
      const stored = sessionStorage.getItem(STORAGE_TOKEN_KEY);
      if (stored && !isTokenExpired(stored)) {
        _token    = stored;
        _nickname = sessionStorage.getItem(STORAGE_NICK_KEY);
        _sex      = sessionStorage.getItem(STORAGE_SEX_KEY);
        _isUser   = true;
        Auth.onLogin?.({ nickname: _nickname, sex: _sex });
        // Keys can't be unlocked without password — show lock screen if needed
        await Auth.onNeedsUnlock?.();
        return;
      }
      if (stored) clearUserStorage();
      await Auth.initGuest();
    },

    async initGuest(_retry = false) {
      _guestId = getOrCreateGuestId();
      const now = Date.now();
      const storedExp = parseInt(localStorage.getItem(STORAGE_GUEST_EXP) || '0', 10);

      // Session expired but within cleanup window — block, no new token
      if (storedExp && storedExp <= now && (now - storedExp) < GUEST_CLEANUP_MS) {
        _token  = null;
        _isUser = false;
        Auth.onGuestExpired?.();
        return;
      }

      // Past cleanup window or no session — reset
      if (storedExp && (now - storedExp) >= GUEST_CLEANUP_MS) {
        localStorage.removeItem(STORAGE_GUEST_EXP);
      }

      try {
        const data = await window.Api.guestAuth(_guestId);
        _token  = data.token;
        _isUser = false;

        if (storedExp && storedExp > now) {
          // Existing valid session — resume countdown at correct remaining time
          startCountdown(storedExp);
        } else {
          // Fresh session
          const expiryMs = now + GUEST_TTL_MS;
          localStorage.setItem(STORAGE_GUEST_EXP, String(expiryMs));
          startCountdown(expiryMs);
        }
        Auth.onGuestReady?.();
      } catch (err) {
        if (err.status === 429 && !_retry) {
          await new Promise(r => setTimeout(r, 2000));
          return Auth.initGuest(true);
        }
        console.warn('[Auth] Guest token failed', err);
        if (err.status === 429) Auth.onRateLimited?.();
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
      localStorage.removeItem(STORAGE_GUEST_EXP);

      Auth.onLogin?.({ nickname: _nickname, sex: _sex });
      return data;
    },

    async register(fields) {
      // Generate keypair before registering so we can save keys right after
      let publicKeyB64 = null, encBlob = null;
      if (window.BBMCrypto) {
        try {
          ({ publicKeyB64, encBlob } = await window.BBMCrypto.setup(fields.password));
        } catch (e) {
          console.warn('[Auth] Crypto setup failed during register:', e.message);
        }
      } else {
        console.warn('[Auth] BBMCrypto not available — keys will be generated on next login.');
      }

      const data = await window.Api.register({ ...fields, guestId: _guestId });
      _token    = data.token;
      _nickname = data.nickname;
      _sex      = data.sex;
      _isUser   = true;
      saveToStorage();
      stopCountdown();
      localStorage.removeItem(STORAGE_GUEST_EXP);

      // Save keys now that we have a token
      if (publicKeyB64 && encBlob) {
        try {
          await window.Api.saveKeys(publicKeyB64, encBlob);
        } catch (e) {
          console.warn('[Auth] Failed to save crypto keys:', e.message);
        }
      }

      Auth.onLogin?.({ nickname: _nickname, sex: _sex });
      return data;
    },

    updateProfile(fields) {
      if (fields.sex      !== undefined) { _sex      = fields.sex;      sessionStorage.setItem(STORAGE_SEX_KEY,  _sex);      }
      if (fields.nickname !== undefined) { _nickname = fields.nickname; sessionStorage.setItem(STORAGE_NICK_KEY, _nickname); }
    },

    refreshToken(token) {
      if (!token) return;
      _token = token;
      sessionStorage.setItem(STORAGE_TOKEN_KEY, token);
    },

    logout() {
      Auth.onLogout?.();
      window.BBMCrypto?.lock();
      clearUserStorage();
      _token = _nickname = _sex = null;
      _isUser = false;
      Auth.initGuest();
    },

    async deleteAccount() {
      await window.Api.deleteMe();
      Auth.onLogout?.();
      window.BBMCrypto?.lock();
      clearUserStorage();
      _token = _nickname = _sex = null;
      _isUser = false;
      Auth.initGuest();
    },

    getTier()      { return parseJwt(_token)?.tier || 'guest'; },
    getToken()     { return _token;    },
    getNickname()  { return _nickname; },
    getSex()       { return _sex;      },
    isRegistered() { return _isUser;   },
    getGuestId()   { return _guestId;  },
    // Convenience object — used by app.js and page modules
    getProfile()   { return { nickname: _nickname, sex: _sex }; },

    onLogin:        null,
    onLogout:       null,
    onGuestReady:   null,
    onGuestExpired: null,
    onNeedsUnlock:  null,
  };
})();

window.Auth = Auth;