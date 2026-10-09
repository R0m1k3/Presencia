const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/validate');

const router = express.Router();

// Brute-force guard, two counters over WINDOW_MS:
// - per (email, IP): guessing one account's password. Keyed by IP too, so
//   that someone failing on purpose cannot lock the real owner out from
//   another address;
// - per IP, all emails together: trying a few passwords on many accounts.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 50;
const MAX_KEYS = 50000; // bounds memory whatever the attempt volume
const failures = new Map(); // key -> { count, since }

function failuresOf(key, now) {
  const f = failures.get(key);
  if (f && f.since + WINDOW_MS > now) return f;
  if (f) failures.delete(key);
  return null;
}

// Milliseconds until a new attempt is allowed, 0 if allowed now.
function lockedFor(email, ip) {
  const now = Date.now();
  let wait = 0;
  for (const [key, max] of [[`a:${ip}:${email}`, MAX_PER_ACCOUNT], [`i:${ip}`, MAX_PER_IP]]) {
    const f = failuresOf(key, now);
    if (f && f.count >= max) wait = Math.max(wait, f.since + WINDOW_MS - now);
  }
  return wait;
}

function recordFailure(email, ip) {
  const now = Date.now();
  for (const key of [`a:${ip}:${email}`, `i:${ip}`]) {
    const f = failuresOf(key, now);
    if (f) {
      f.count += 1;
      continue;
    }
    // Map keeps insertion order: the first key is the oldest window.
    if (failures.size >= MAX_KEYS) failures.delete(failures.keys().next().value);
    failures.set(key, { count: 1, since: now });
  }
}

// Compared against when the email is unknown, so that a wrong email and a
// wrong password take the same time and do not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('presencia-dummy-password', 10);

function publicUser(u) {
  return {
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    companyId: u.company_id,
    companyName: u.company_name,
  };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  const key = email.trim().toLowerCase();
  const wait = lockedFor(key, req.ip);
  if (wait) {
    const minutes = Math.ceil(wait / 60000);
    return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${minutes} min.` });
  }

  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, u.active,
            u.company_id, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE lower(u.email) = $1`,
    [key]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    recordFailure(key, req.ip);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  failures.delete(`a:${req.ip}:${key}`);
  setAuthCookie(res, signToken(user));
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// requireAuth has just read the account from the database.
router.get('/me', requireAuth, (req, res) => {
  const { id, fullName, email, role, companyId, companyName } = req.user;
  res.json({ id, fullName, email, role, companyId, companyName });
});

// Any signed-in user changes their own password; the current one is required.
router.put('/password', requireAuth, async (req, res) => {
  const { current, password } = req.body || {};
  const err = passwordError(password);
  if (err) return res.status(400).json({ error: err });
  if (typeof current !== 'string' || !current) {
    return res.status(400).json({ error: 'Mot de passe actuel requis' });
  }
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Session invalide ou expirée' });
  if (!(await bcrypt.compare(current, rows[0].password_hash))) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    'UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2',
    [hash, req.user.id]
  );
  // Other sessions are now invalid; keep this one alive with a fresh token.
  setAuthCookie(res, signToken(req.user));
  res.json({ ok: true });
});

module.exports = router;
