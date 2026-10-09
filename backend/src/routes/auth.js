const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { passwordError } = require('../utils/validate');

const router = express.Router();

// Brute-force guard: after MAX_FAILURES wrong passwords for one email within
// WINDOW_MS, further attempts on that email are refused until the window ends.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // email -> { count, since }

function lockedFor(email) {
  const f = failures.get(email);
  if (!f) return 0;
  const left = f.since + WINDOW_MS - Date.now();
  if (left <= 0) {
    failures.delete(email);
    return 0;
  }
  return f.count >= MAX_FAILURES ? left : 0;
}

function recordFailure(email) {
  const now = Date.now();
  if (failures.size > 10000) {
    for (const [k, f] of failures) if (f.since + WINDOW_MS <= now) failures.delete(k);
  }
  const f = failures.get(email);
  if (!f || f.since + WINDOW_MS <= now) failures.set(email, { count: 1, since: now });
  else f.count += 1;
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
  const wait = lockedFor(key);
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
    recordFailure(key);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  failures.delete(key);
  setAuthCookie(res, signToken(user));
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.company_id, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(publicUser(rows[0]));
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
