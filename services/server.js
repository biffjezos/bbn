// ============================================================
// bOOmbOOm.NOW! — server.js
// Entry point. Mounts all service routers.
// Clients talk only to this file.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
export const CFG = {
  PORT:            process.env.PORT            || 3000,
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:4000').split(','),
  JWT_SECRET:      process.env.JWT_SECRET      || 'change-me-in-production',
  JWT_EXPIRY_USER:  '7d',
  JWT_EXPIRY_GUEST: '15m',
  GUEST_TTL_MS:     15 * 60 * 1000,
};
// ============================================================

import express from 'express';
import cors    from 'cors';

import { router as authRouter     } from './auth.js';
import { router as usersRouter    } from './users.js';
import { router as locationRouter } from './location.js';
import { router as messagesRouter } from './messages.js';

const app = express();

// --- CORS ---------------------------------------------------
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || CFG.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed.`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

// --- Health (Railway uses this) -----------------------------
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Mount service routers ----------------------------------
app.use('/api/auth',     authRouter);
app.use('/api/users',    usersRouter);
app.use('/api/location', locationRouter);
app.use('/api/messages', messagesRouter);

// --- 404 + error --------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// --- Start --------------------------------------------------
app.listen(CFG.PORT, () =>
  console.log(`[bOOmbOOm.NOW!] Running on :${CFG.PORT}`)
);
