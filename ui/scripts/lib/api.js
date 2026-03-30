// ============================================================
// bOOmbOOm.NOW! — API Client (module version)
// ============================================================

const DEBUG = true;
const API_BASE = '/api';

async function apiFetch(path, options = {}, _retries = 1) {
    const token = window.Auth?.getToken?.();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    };

    const url = `${API_BASE}${path}`;
    if (DEBUG) console.log('[API] →', options.method || 'GET', url, options.body ? JSON.parse(options.body) : '');

    let res;
    try {
        res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(10000) });
    } catch (networkErr) {
        if (DEBUG) console.error('[API] Network error:', networkErr.message, 'URL:', url);
        if (_retries > 0) {
            await new Promise(r => setTimeout(r, 1500));
            return apiFetch(path, options, _retries - 1);
        }
        throw networkErr;
    }

    const data = await res.json().catch(() => ({}));
    if (DEBUG) console.log('[API] ←', res.status, url, data);

    if (res.status >= 500 && _retries > 0) {
        if (DEBUG) console.warn('[API] 5xx, retrying in 1.5 s…', res.status, url);
        await new Promise(r => setTimeout(r, 1500));
        return apiFetch(path, options, _retries - 1);
    }

    if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        if (res.status === 403 && data.required) {
            document.dispatchEvent(new CustomEvent('bbm:tier-gate', { detail: data }));
        }
        if (res.status === 401 && (data.code === 'TOKEN_REVOKED' || data.code === 'TOKEN_INVALID')) {
            window.Auth?.logout?.();
        }
        throw err;
    }

    return data;
}

export const Api = {
    guestAuth: (guestId) => apiFetch('/auth/guest', { method: 'POST', body: JSON.stringify({ guestId }) }),

    register: async ({ email, nickname, password, age, sex }) => {
        const opaque = window.OpaqueClient;
        const emailHash = await opaque.hashEmail(email);
        const regRequest = await opaque.registerStart(password);
        const startRes = await apiFetch('/auth/register/start', {
            method: 'POST',
            body: JSON.stringify({ emailHash, registrationRequest: regRequest }),
        });
        const regUpload = await opaque.registerFinish(password, startRes.registrationResponse);
        return apiFetch('/auth/register/finish', {
            method: 'POST',
            body: JSON.stringify({ emailHash, registrationUpload: regUpload, nickname, age: Number(age), sex }),
        });
    },

    login: async ({ email, password, guestId }) => {
        const opaque = window.OpaqueClient;
        const emailHash = await opaque.hashEmail(email);
        const loginReq = await opaque.loginStart(password);
        const startRes = await apiFetch('/auth/login/start', {
            method: 'POST',
            body: JSON.stringify({ emailHash, credentialRequest: loginReq, guestId }),
        });
        const finishData = await opaque.loginFinish(password, startRes.credentialResponse);
        return apiFetch('/auth/login/finish', {
            method: 'POST',
            body: JSON.stringify({
                emailHash,
                stateToken: startRes.stateToken,
                credentialFinalization: finishData.finalization,
                guestId,
            }),
        });
    },

    changePassword: async ({ password, emailHash }) => {
        const opaque = window.OpaqueClient;
        const regRequest = await opaque.registerStart(password);
        const startRes = await apiFetch('/users/me/password/start', {
            method: 'POST',
            body: JSON.stringify({ registrationRequest: regRequest }),
        });
        const regUpload = await opaque.registerFinish(password, startRes.registrationResponse);
        return apiFetch('/users/me/password/finish', {
            method: 'POST',
            body: JSON.stringify({ registrationUpload: regUpload, ...(emailHash ? { emailHash } : {}) }),
        });
    },

    getMe: () => apiFetch('/users/me'),
    updateMe: (fields) => apiFetch('/users/me', { method: 'PUT', body: JSON.stringify(fields) }),
    deleteMe: () => apiFetch('/users/me', { method: 'DELETE' }),
    getProfile: (userId) => apiFetch(`/users/${encodeURIComponent(userId)}/profile`),
    saveKeys: (publicKey, encryptedPrivateKey) => apiFetch('/users/me/keys', { method: 'PUT', body: JSON.stringify({ publicKey, encryptedPrivateKey }) }),
    getMyKeys: () => apiFetch('/users/me/keys'),
    getPreferences: () => apiFetch('/users/me/preferences'),
    updatePreferences: (prefs) => apiFetch('/users/me/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),
    putLocation: (lat, lon, accuracy) => apiFetch('/location', { method: 'PUT', body: JSON.stringify({ lat, lon, accuracy: accuracy || 'gps' }) }),
    deleteLocation: () => apiFetch('/location', { method: 'DELETE' }),
    getNearby: (lat, lon) => apiFetch(`/location/nearby?lat=${lat}&lon=${lon}`),
    getNearbyRadius: (tier) => apiFetch(`/tiers/radius/nearby/${encodeURIComponent(tier)}`),
    getTierInfo: (tier) => apiFetch(`/tiers/${encodeURIComponent(tier)}/info`),
    searchUsers: ({ nickname, ageMin, ageMax, sex, online, accountType } = {}) => {
        const qs = new URLSearchParams();
        if (nickname) qs.set('nickname', nickname);
        if (ageMin != null) qs.set('ageMin', ageMin);
        if (ageMax != null) qs.set('ageMax', ageMax);
        if (sex != null) qs.set('sex', sex);
        if (online != null) qs.set('online', online ? 'yes' : 'no');
        if (accountType) qs.set('accountType', accountType);
        return apiFetch(`/users/search?${qs.toString()}`);
    },

    getConversations: () => apiFetch('/messages'),
    getConversation: (userId) => apiFetch(`/messages/${encodeURIComponent(userId)}`),
    sendMessage: (userId, text) => apiFetch(`/messages/${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify({ text }) }),
    deleteMessage: (id) => apiFetch(`/messages/${id}`, { method: 'DELETE' }),

    getFavourites: () => apiFetch('/favourites'),
    addFavourite: (userId) => apiFetch(`/favourites/${encodeURIComponent(userId)}`, { method: 'POST' }),
    removeFavourite: (userId) => apiFetch(`/favourites/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    isMutualFavourite: (userId) => apiFetch(`/favourites/is-mutual/${encodeURIComponent(userId)}`),

    blockUser: (userId, reason) => apiFetch(`/blocks/${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify({ reason }) }),
    unblockUser: (userId) => apiFetch(`/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    getBlocks: () => apiFetch('/blocks'),

    getNotifications: () => apiFetch('/notifications'),
    dismissNotification: (id) => apiFetch(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    getMyVenues: () => apiFetch('/manager/venues'),
    createVenue: (fields) => apiFetch('/manager/venues', { method: 'POST', body: JSON.stringify(fields) }),
    updateVenue: (id, fields) => apiFetch(`/manager/venues/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(fields) }),
    deleteVenue: (id) => apiFetch(`/manager/venues/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// Optional: global tier-gate modal handler
export function initApiGlobals() {
    document.addEventListener('bbm:tier-gate', () => {
        const el = document.getElementById('tierGateModal');
        if (el && window.bootstrap) bootstrap.Modal.getOrCreateInstance(el).show();
    });
}