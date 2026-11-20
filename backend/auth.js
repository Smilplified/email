/**
 * auth.js – Admin login / token verification middleware
 *
 * Uses a simple username + password stored in .env.
 * Returns a signed JWT that the frontend stores in sessionStorage.
 * All /api/campaigns routes require a valid JWT.
 */

const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Fail fast if required secrets are missing – never start with weak fallbacks.
if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is required in .env');
if (!process.env.JWT_SECRET)     throw new Error('JWT_SECRET is required in .env');

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '8h';

// Hash the stored password once at startup (synchronous is fine here, runs only once).
const ADMIN_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);

// Stricter rate limiter for login attempts (5 / 15 min per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const usernameMatch = username === ADMIN_USER;
  const passwordMatch = await bcrypt.compare(password, ADMIN_HASH);

  if (!usernameMatch || !passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ token });
});

// ── Middleware: requireAdmin ─────────────────────────────────────
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { router, requireAdmin };
