const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  const { company_id } = req.query;
  const params = [];
  let where = '';
  if (company_id) {
    params.push(company_id);
    where = `WHERE u.company_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.company_id, u.active, u.created_at,
            c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     ${where}
     ORDER BY u.full_name`,
    params
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { full_name, email, password, role, company_id } = req.body || {};
  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (!['admin', 'cadre'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (role === 'cadre' && !company_id) {
    return res.status(400).json({ error: 'Une société doit être attribuée au cadre' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, company_id, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, full_name, email, role, company_id, active, created_at`,
      [full_name.trim(), email.trim().toLowerCase(), hash, role, role === 'admin' ? null : company_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email existe déjà' });
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const { full_name, email, role, company_id, active } = req.body || {};
  if (!full_name || !email || !role) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (!['admin', 'cadre'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (role === 'cadre' && !company_id) {
    return res.status(400).json({ error: 'Une société doit être attribuée au cadre' });
  }
  try {
    const { rows } = await db.query(
      `UPDATE users SET full_name = $1, email = $2, role = $3, company_id = $4, active = $5
       WHERE id = $6
       RETURNING id, full_name, email, role, company_id, active, created_at`,
      [
        full_name.trim(),
        email.trim().toLowerCase(),
        role,
        role === 'admin' ? null : company_id,
        active !== false,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email existe déjà' });
    throw err;
  }
});

router.put('/:id/password', async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rowCount } = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    hash,
    req.params.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ ok: true });
});

module.exports = router;
