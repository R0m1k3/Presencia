const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.role, u.active,
            u.company_id, c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE lower(u.email) = lower($1)`,
    [email]
  );
  const user = rows[0];
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    companyId: user.company_id,
    companyName: user.company_name,
  });
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
  if (!rows[0]) return res.status(401).json({ error: 'Non authentifié' });
  const u = rows[0];
  res.json({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    companyId: u.company_id,
    companyName: u.company_name,
  });
});

module.exports = router;
