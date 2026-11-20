const path = require('path');
// Load .env from backend/ regardless of where the process was started.
// On Vercel this call does nothing (file absent, dotenv is silent).
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const trackingRouter      = require('./tracking');
const campaignRouter      = require('./campaign');
const { router: authRouter } = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy ──────────────────────────────────────────────────
// Vercel sits behind one edge proxy layer.
// This tells Express to trust exactly one hop so req.ip and
// rate-limiter IP detection are accurate.
app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────────
// On Vercel the frontend is served by the same domain as the API,
// so CORS is only relevant for local cross-port dev.
// FRONTEND_URL is optional; omit it on Vercel (same origin = no CORS needed).
if (process.env.FRONTEND_URL) {
  app.use(cors({
    origin: process.env.FRONTEND_URL,
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization']
  }));
} else {
  // Allow all origins when FRONTEND_URL is not set.
  // Fine on Vercel (same domain). Set FRONTEND_URL in .env for stricter local dev.
  app.use(cors());
}

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Global rate limiter (100 req / 15 min per IP) ─────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(globalLimiter);

// ── Stricter limiter for tracking endpoints ───────────────────────
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many tracking requests.' }
});

// ── API + tracking routes ─────────────────────────────────────────
app.use('/track', trackingLimiter, trackingRouter);
app.use('/api/campaigns', campaignRouter);
app.use('/api/auth', authRouter);

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', ts: new Date().toISOString() })
);

// ── Static frontend files ─────────────────────────────────────────
// Serve HTML/CSS/JS from the frontend/ directory.
// On Vercel, vercel.json includeFiles bundles frontend/** with the function.
app.use(express.static(path.join(__dirname, '../frontend')));

// ── 404 fallback → login page ────────────────────────────────────
// Catches any request not matched by routes or express.static.
// Must be a 3-argument (non-error) handler.
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Global error handler ──────────────────────────────────────────
// Must have exactly 4 arguments and be registered last.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Local dev: only listen when run directly with `node server.js`
// On Vercel this module is imported (not run directly) so listen()
// is never called there.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Open http://localhost:3000 in your browser.');
  });
}

module.exports = app;
