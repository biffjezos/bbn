// ============================================================
// bOOmbOOm.NOW! — server.js
// Public gateway. The only service exposed to the client.
// Forwards requests to internal services with Bearer token.
// Calls migration-service on boot before opening the gateway.
// WebSocket endpoints for real-time location and messaging.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:                  process.env.PORT                  || 3000,
  AUTH_SERVICE_URL:      process.env.AUTH_SERVICE_URL,
  USER_SERVICE_URL:      process.env.USER_SERVICE_URL,
  LOC_SERVICE_URL:       process.env.LOC_SERVICE_URL,
  MSG_SERVICE_URL:       process.env.MSG_SERVICE_URL,
  FAV_SERVICE_URL:       process.env.FAV_SERVICE_URL,
  TIERS_SERVICE_URL:     process.env.TIERS_SERVICE_URL,
  MIGRATION_SERVICE_URL: process.env.MIGRATION_SERVICE_URL,
  JWT_SECRET:            process.env.JWT_SECRET,
};
const _missingCfg = ['AUTH_SERVICE_URL','USER_SERVICE_URL','LOC_SERVICE_URL','MSG_SERVICE_URL',
  'FAV_SERVICE_URL','TIERS_SERVICE_URL','MIGRATION_SERVICE_URL','JWT_SECRET'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }
// ============================================================

import { createServer }             from 'http';
import { WebSocketServer }          from 'ws';
import { Agent, setGlobalDispatcher } from 'undici';
import express   from 'express';
import cors      from 'cors';
import jwt       from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

// Keep TCP connections alive to internal services — avoids a new handshake
// on every proxied request and every WS service fetch.
setGlobalDispatcher(new Agent({ connections: 50, keepAliveTimeout: 30_000 }));

const app = express();
app.set('trust proxy', 1);

const ALLOWED_ORIGINS = [
  'https://bbn-e86d0c.gitlab.io',
  'https://biffjezos.github.io',
];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

// Rate limiting
app.use('/api/auth/login',    rateLimit({ windowMs: 15 * 60 * 1000, max: 10,  standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5,   standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/guest',    rateLimit({ windowMs: 60 * 60 * 1000, max: 10,  standardHeaders: true, legacyHeaders: false }));
app.use('/api/',              rateLimit({ windowMs:       60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// GET /api/health — aggregated health across all internal services.
// Responses are cached for HEALTH_CACHE_TTL_MS so concurrent warm-up
// pings from many users trigger only one round of downstream fetches.
const HEALTH_CACHE_TTL_MS = 30_000;
let _healthCache = null; // { body, status, expiresAt }

app.get('/api/health', async (_req, res) => {
  const now = Date.now();
  if (_healthCache && _healthCache.expiresAt > now) {
    return res.status(_healthCache.status).json(_healthCache.body);
  }

  const services = {
    auth:       `${CFG.AUTH_SERVICE_URL}/health`,
    users:      `${CFG.USER_SERVICE_URL}/health`,
    location:   `${CFG.LOC_SERVICE_URL}/health`,
    messages:   `${CFG.MSG_SERVICE_URL}/health`,
    favourites: `${CFG.FAV_SERVICE_URL}/health`,
    tiers:      `${CFG.TIERS_SERVICE_URL}/health`,
  };

  const results = await Promise.allSettled(
    Object.entries(services).map(async ([name, url]) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return [name, r.ok ? 'ok' : 'degraded'];
    })
  );

  const status = Object.fromEntries(
    results.map((r, i) => {
      const name = Object.keys(services)[i];
      return [name, r.status === 'fulfilled' ? r.value[1] : 'down'];
    })
  );

  const allOk = Object.values(status).every(s => s === 'ok');
  const body  = { ok: allOk, services: status, ts: now };
  const httpStatus = allOk ? 200 : 503;

  // Cache successful results; don't cache failures so the next request retries.
  if (allOk) _healthCache = { body, status: httpStatus, expiresAt: now + HEALTH_CACHE_TTL_MS };

  res.status(httpStatus).json(body);
});

// ============================================================
// SERVICE TOKEN — short-lived JWT identifying the gateway
// Cached and refreshed 5 s before expiry to avoid signing on
// every proxied request.
// ============================================================
let _svcToken = null;
let _svcTokenExpiry = 0;

function serviceToken() {
  if (Date.now() < _svcTokenExpiry - 5_000) return _svcToken;
  _svcToken = jwt.sign({ sub: 'gateway', role: 'service' }, CFG.JWT_SECRET, { expiresIn: '60s' });
  _svcTokenExpiry = Date.now() + 60_000;
  return _svcToken;
}

// ============================================================
// TIER ENFORCEMENT — gateway calls tiers-service before proxy
// ============================================================
function checkTier(feature) {
  return async (req, res, next) => {
    const auth  = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token provided.' });

    let payload;
    try { payload = jwt.verify(token, CFG.JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Token invalid or expired.' }); }

    try {
      const check = await fetch(`${CFG.TIERS_SERVICE_URL}/tiers/check`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Service-Token': serviceToken() },
        body:    JSON.stringify({ tier: payload.tier || 'guest', feature }),
      });
      const data = await check.json();
      if (!check.ok) return res.status(check.status).json(data);
      next();
    } catch {
      res.status(502).json({ error: 'Service unavailable.' });
    }
  };
}

// ============================================================
// PROXY HELPER
// Passes the client's user token through as-is.
// Adds a service token in X-Service-Token so internal services
// can verify the request is coming from the gateway.
// ============================================================
async function proxy(req, res, targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method:  req.method,
      headers: {
        'Content-Type':    'application/json',
        'Authorization':   req.headers['authorization'] || '',
        'X-Service-Token': serviceToken(),
      },
      body: ['GET', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    console.error('[gateway]', e);
    res.status(502).json({ error: 'Service unavailable.' });
  }
}

// ============================================================
// ROUTES
// ============================================================

// --- Auth ---------------------------------------------------
app.post('/api/auth/guest',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/guest`));
app.post('/api/auth/register', (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/register`));
app.post('/api/auth/login',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/login`));

// --- Users --------------------------------------------------
app.get   ('/api/users/me',                  (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.put   ('/api/users/me',                  (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.delete('/api/users/me',                  (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.get   ('/api/users/me/keys',             (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me/keys`));
app.put   ('/api/users/me/keys',             (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me/keys`));
app.get   ('/api/users/search',              (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/search?${new URLSearchParams(req.query).toString()}`));
app.get   ('/api/users/:userId/profile',     (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/${req.params.userId}/profile`));

// --- Tiers --------------------------------------------------
app.get('/api/tiers/radius/nearby/:tier', (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/radius/nearby/${encodeURIComponent(req.params.tier)}`));

// --- Location (HTTP fallback — WS is preferred) -------------
app.put   ('/api/location',        (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location`));
app.delete('/api/location',        (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location`));
app.get   ('/api/location/nearby', (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location/nearby?lat=${req.query.lat}&lon=${req.query.lon}`));

// --- Messages (HTTP fallback — WS is preferred) -------------
app.get   ('/api/messages',         checkTier('message_online'), (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages`));
app.get   ('/api/messages/:userId', checkTier('message_online'), (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.userId}`));
app.post  ('/api/messages/:userId', checkTier('message_online'), (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.userId}`));
app.delete('/api/messages/:id',     checkTier('message_online'), (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.id}`));

// --- Tiers (public radius queries — no tier enforcement needed) ---
app.get('/api/tiers/radius/nearby/:tier',  (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/radius/nearby/${req.params.tier}`));
app.get('/api/tiers/radius/message/:tier', (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/radius/message/${req.params.tier}`));

// --- Favourites ---------------------------------------------
app.get   ('/api/favourites',         checkTier('manage_favourites'), (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites`));
app.post  ('/api/favourites/:userId', checkTier('manage_favourites'), (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites/${req.params.userId}`));
app.delete('/api/favourites/:userId', checkTier('manage_favourites'), (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites/${req.params.userId}`));

// --- 404 + error --------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error.' }));

// ============================================================
// WEBSOCKET — shared helpers
// ============================================================

function verifyToken(token) {
  try { return jwt.verify(token, CFG.JWT_SECRET); }
  catch { return null; }
}

function wsSend(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function svcHeaders(token) {
  return { 'X-Service-Token': serviceToken(), Authorization: `Bearer ${token}` };
}

// ============================================================
// WEBSOCKET — Location
// Any authenticated role (guest or registered user) may connect.
// Auth: client sends { type: 'auth', token } as the first message.
// Connection is closed with code 4001 if auth is not received
// within WS_AUTH_TIMEOUT_MS or the token is invalid.
// Client sends:  { type: 'position', lat, lon, accuracy }
// Server pushes: { type: 'nearby',   users: [...] }  every 5 s
// On disconnect: gateway deletes the client's location record.
// ============================================================

function geoDistM(lat1, lon1, lat2, lon2) {
  const R   = 6_371_000;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const LOC_MIN_SEND_M = 5;  // don't forward to location-service if moved less than this

const WS_MAX_BYTES        = 4096;   // max incoming message size per frame
const WS_SEND_LIMIT       = 10;     // max message sends per user per window
const WS_SEND_WINDOW      = 10_000; // window length in ms
const WS_AUTH_TIMEOUT_MS  = 3000;   // ms to wait for first-message auth

// Per-user send rate tracking — shared across all connections for the same userId
// so opening multiple tabs doesn't multiply the send budget.
const _wsSendCounts = new Map(); // userId -> { count, connections, timer }

function acquireSendBucket(userId) {
  if (!_wsSendCounts.has(userId)) {
    const bucket = { count: 0, connections: 0 };
    bucket.timer = setInterval(() => { bucket.count = 0; }, WS_SEND_WINDOW);
    _wsSendCounts.set(userId, bucket);
  }
  const bucket = _wsSendCounts.get(userId);
  bucket.connections++;
  return bucket;
}

function releaseSendBucket(userId) {
  const bucket = _wsSendCounts.get(userId);
  if (!bucket) return;
  if (--bucket.connections <= 0) {
    clearInterval(bucket.timer);
    _wsSendCounts.delete(userId);
  }
}

const wssLoc = new WebSocketServer({ noServer: true });

wssLoc.on('connection', ws => {
  // ── Auth phase ─────────────────────────────────────────────
  const authTimeout = setTimeout(() => ws.close(4001, 'Auth timeout'), WS_AUTH_TIMEOUT_MS);

  ws.once('message', raw => {
    clearTimeout(authTimeout);
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.close(4001, 'Bad auth'); return; }
    if (msg.type !== 'auth' || !msg.token) { ws.close(4001, 'Auth required'); return; }

    const payload = verifyToken(msg.token);
    if (!payload) { ws.close(4001, 'Invalid token'); return; }

    setupLocConnection(ws, payload.sub, msg.token);
  });
});

function setupLocConnection(ws, userId, token) {
  console.log('[WS:loc] +', userId);
  let lastPos        = null;  // most recent client position (used for nearby queries)
  let lastSentPos    = null;  // last position CONFIRMED stored in location-service
  let lastPosAcc     = 'gps';
  let lastNearbyHash = null;

  const nearbyTimer = setInterval(async () => {
    if (!lastPos) return;

    // Retry a failed (e.g. cold-start) location PUT before querying nearby.
    const needsPush = !lastSentPos ||
      geoDistM(lastSentPos.lat, lastSentPos.lon, lastPos.lat, lastPos.lon) >= LOC_MIN_SEND_M;
    if (needsPush) {
      try {
        const putRes = await fetch(`${CFG.LOC_SERVICE_URL}/location`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json', ...svcHeaders(token) },
          body:    JSON.stringify({ lat: lastPos.lat, lon: lastPos.lon, accuracy: lastPosAcc }),
        });
        if (putRes.ok) {
          lastSentPos = { lat: lastPos.lat, lon: lastPos.lon };
        } else {
          console.warn(`[WS:loc] PUT /location ${putRes.status} for ${userId} — will retry`);
        }
      } catch (e) {
        console.warn(`[WS:loc] PUT /location network error for ${userId}: ${e.message} — will retry`);
      }
    }

    try {
      const res  = await fetch(
        `${CFG.LOC_SERVICE_URL}/location/nearby?lat=${lastPos.lat}&lon=${lastPos.lon}`,
        { headers: svcHeaders(token) }
      );
      const data = await res.json();
      if (!Array.isArray(data.users)) {
        console.warn(`[WS:loc] nearby ${res.status} for ${userId}:`, data.error || data);
        return;
      }
      const hash = JSON.stringify(data.users);
      if (hash === lastNearbyHash) return;  // nothing changed — skip the WS frame
      lastNearbyHash = hash;
      console.log(`[WS:loc] nearby changed for ${userId}: ${data.users.length} users`);
      wsSend(ws, { type: 'nearby', users: data.users });
    } catch (e) {
      console.warn(`[WS:loc] nearby network error for ${userId}: ${e.message}`);
    }
  }, 5000);

  ws.on('message', async raw => {
    if (raw.length > WS_MAX_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'position' && msg.lat != null && msg.lon != null) {
      lastPos    = { lat: msg.lat, lon: msg.lon };
      lastPosAcc = msg.accuracy || 'gps';
      const moved = !lastSentPos || geoDistM(lastSentPos.lat, lastSentPos.lon, msg.lat, msg.lon) >= LOC_MIN_SEND_M;
      if (moved) {
        try {
          const putRes = await fetch(`${CFG.LOC_SERVICE_URL}/location`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', ...svcHeaders(token) },
            body:    JSON.stringify({ lat: msg.lat, lon: msg.lon, accuracy: lastPosAcc }),
          });
          if (putRes.ok) {
            lastSentPos = { lat: msg.lat, lon: msg.lon };  // only set on confirmed success
          } else {
            console.warn(`[WS:loc] PUT /location ${putRes.status} for ${userId} — nearbyTimer will retry`);
          }
        } catch { /* network error — nearbyTimer will retry */ }
      }
    }
  });

  ws.on('close', async () => {
    clearInterval(nearbyTimer);
    console.log('[WS:loc] -', userId);
    try {
      await fetch(`${CFG.LOC_SERVICE_URL}/location`, {
        method: 'DELETE', headers: svcHeaders(token),
      });
    } catch { /* silent */ }
  });
}

// ============================================================
// WEBSOCKET — Messages
// Registered users only.
// Auth: same first-message pattern as location WS.
// Client sends:  { type: 'view', userId }   — subscribe to thread
//                { type: 'send', toUserId, text } — send a message
// Server pushes: { type: 'conversations', messages: [...] } every 3 s
//                { type: 'thread', userId, messages: [...] } every 2 s
//                  (only while a thread is being viewed)
// ============================================================

const wssMsg = new WebSocketServer({ noServer: true });

wssMsg.on('connection', ws => {
  // ── Auth phase ─────────────────────────────────────────────
  const authTimeout = setTimeout(() => ws.close(4001, 'Auth timeout'), WS_AUTH_TIMEOUT_MS);

  ws.once('message', raw => {
    clearTimeout(authTimeout);
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.close(4001, 'Bad auth'); return; }
    if (msg.type !== 'auth' || !msg.token) { ws.close(4001, 'Auth required'); return; }

    const payload = verifyToken(msg.token);
    if (!payload)                  { ws.close(4001, 'Invalid token'); return; }
    if (payload.role !== 'user')   { ws.close(4003, 'Registered account required'); return; }

    setupMsgConnection(ws, payload.sub, msg.token);
  });
});

function setupMsgConnection(ws, userId, token) {
  console.log('[WS:msg] +', userId);
  let viewingUserId = null;
  let threadTimer   = null;
  let lastListHash   = null;
  let lastThreadHash = null;

  async function pushList() {
    try {
      const res  = await fetch(`${CFG.MSG_SERVICE_URL}/messages`, { headers: svcHeaders(token) });
      const data = await res.json();
      const hash = JSON.stringify(data.messages);
      if (hash === lastListHash) return;  // nothing changed — skip the WS frame
      lastListHash = hash;
      wsSend(ws, { type: 'conversations', messages: data.messages || [] });
    } catch { /* silent */ }
  }

  async function pushThread() {
    if (!viewingUserId) return;
    try {
      const res  = await fetch(
        `${CFG.MSG_SERVICE_URL}/messages/${encodeURIComponent(viewingUserId)}`,
        { headers: svcHeaders(token) }
      );
      const data = await res.json();
      const hash = JSON.stringify(data.messages);
      if (hash === lastThreadHash) return;  // nothing changed — skip the WS frame
      lastThreadHash = hash;
      wsSend(ws, { type: 'thread', userId: viewingUserId, messages: data.messages || [] });
    } catch { /* silent */ }
  }

  const listTimer  = setInterval(pushList, 3000);
  pushList();  // immediate first push on connect

  const sendBucket = acquireSendBucket(userId);

  ws.on('message', async raw => {
    if (raw.length > WS_MAX_BYTES) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'view') {
      viewingUserId  = msg.userId || null;
      lastThreadHash = null;  // reset so the first push of a new thread always fires
      if (threadTimer) { clearInterval(threadTimer); threadTimer = null; }
      if (viewingUserId) {
        await pushThread();  // immediate push for the opened thread
        threadTimer = setInterval(pushThread, 2000);
      }
    }

    if (msg.type === 'send' && msg.toUserId && msg.text) {
      if (++sendBucket.count > WS_SEND_LIMIT) {
        wsSend(ws, { type: 'send:error', error: 'Rate limit exceeded. Please wait a moment.' });
        return;
      }
      console.log(`[WS:send] ${userId} -> ${msg.toUserId}`);
      try {
        const sendRes = await fetch(`${CFG.MSG_SERVICE_URL}/messages/${encodeURIComponent(msg.toUserId)}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...svcHeaders(token) },
          body:    JSON.stringify({ text: msg.text }),
        });
        console.log(`[WS:send] msg-svc responded ${sendRes.status}`);
        if (!sendRes.ok) {
          const body = await sendRes.json().catch(() => ({}));
          console.warn(`[WS:send] msg-svc error:`, body);
          wsSend(ws, { type: 'send:error', error: body.error || 'Failed to send message.' });
        } else {
          // Push updated thread immediately so sender sees the message right away
          if (viewingUserId === msg.toUserId) await pushThread();
        }
      } catch (err) {
        console.error(`[WS:send] fetch failed:`, err.message);
        wsSend(ws, { type: 'send:error', error: 'Could not reach messaging service.' });
      }
    }
  });

  ws.on('close', () => {
    clearInterval(listTimer);
    if (threadTimer) clearInterval(threadTimer);
    releaseSendBucket(userId);
    console.log('[WS:msg] -', userId);
  });
}

// ============================================================
// HTTP UPGRADE ROUTING
// Token is NOT accepted in the URL query string (Sec #1).
// Auth happens as the first WebSocket message after connection.
// ============================================================

const httpServer = createServer(app);

httpServer.on('upgrade', (req, socket, head) => {
  if (!ALLOWED_ORIGINS.includes(req.headers['origin'])) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/ws/location') {
    wssLoc.handleUpgrade(req, socket, head, ws => wssLoc.emit('connection', ws));
  } else if (url.pathname === '/ws/messages') {
    wssMsg.handleUpgrade(req, socket, head, ws => wssMsg.emit('connection', ws));
  } else {
    socket.destroy();
  }
});

// ============================================================
// BOOT — run migrations first, then open the gateway
// ============================================================
try {
  console.log('[gateway] Calling migration service…');
  const result = await fetch(`${CFG.MIGRATION_SERVICE_URL}/migrate/run`, {
    method: 'POST',
    headers: { 'X-Service-Token': serviceToken() },
  });
  const data   = await result.json();
  if (data.ok) {
    console.log(`[gateway] Migrations done. Applied: ${data.applied}`);
  } else {
    console.warn('[gateway] Migration service reported failure:', data.error);
  }
} catch (e) {
  // Don't block the gateway if migrations are unreachable — log and continue
  console.warn('[gateway] Could not reach migration service:', e.message);
}

httpServer.listen(CFG.PORT, () => console.log(`[gateway] Running on :${CFG.PORT}`));
