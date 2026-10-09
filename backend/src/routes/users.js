const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin, signToken, setAuthCookie } = require('../middleware/auth');
const { isId, isEmail, isName, passwordError, idParam } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth, requireAdmin);
router.param('id', idParam);

const USER_COLUMNS = 'id, full_name, email, role, company_id, active, created_at';

// Shared checks for create and update. Returns an error message or null.
function profileError({ full_name, email, role, company_id }) {
  if (!isName(full_name) || typeof email !== 'string' || !email || !role) return 'Champs requis manquants';
  if (!isEmail(email.trim())) return 'Adresse e-mail invalide';
  if (!['admin', 'cadre'].includes(role)) return 'Rôle invalide';
  if (role === 'cadre' && !isId(String(company_id ?? ''))) return 'Une société doit être attribuée au cadre';
  return null;
}

function dbError(err, res) {
  if (err.code === '23505') return res.status(409).json({ error: 'Cet email existe déjà' });
  if (err.code === '23503') return res.status(400).json({ error: 'Société introuvable' });
  throw err;
}

router.get('/', async (req, res) => {
  const { company_id } = req.query;
  if (company_id && !isId(company_id)) return res.status(400).json({ error: 'Société invalide' });
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.company_id, u.active, u.created_at,
            c.name AS company_name
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     ${company_id ? 'WHERE u.company_id = $1' : ''}
     ORDER BY u.full_name`,
    company_id ? [company_id] : []
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const err = profileError(body) || passwordError(body.password);
  if (err) return res.status(400).json({ error: err });
  const { full_name, email, password, role, company_id } = body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, company_id, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING ${USER_COLUMNS}`,
      [full_name.trim(), email.trim().toLowerCase(), hash, role, role === 'admin' ? null : company_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    dbError(e, res);
  }
});

router.put('/:id', async (req, res) => {
  const body = req.body || {};
  const err = profileError(body);
  if (err) return res.status(400).json({ error: err });
  const { full_name, email, role, company_id } = body;
  const active = body.active !== false;
  // An admin locking themselves out (or the last admin disappearing) can only
  // be undone directly in the database.
  if (String(req.user.id) === req.params.id && (!active || role !== 'admin')) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver ni rétrograder votre propre compte' });
  }
  try {
    const { rows } = await db.query(
      `UPDATE users SET full_name = $1, email = $2, role = $3, company_id = $4, active = $5
       WHERE id = $6
       RETURNING ${USER_COLUMNS}`,
      [full_name.trim(), email.trim().toLowerCase(), role, role === 'admin' ? null : company_id, active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json(rows[0]);
  } catch (e) {
    dbError(e, res);
  }
});

router.put('/:id/password', async (req, res) => {
  const { password } = req.body || {};
  const err = passwordError(password);
  if (err) return res.status(400).json({ error: err });
  const hash = await bcrypt.hash(password, 10);
  // Also ends that user's open sessions.
  const { rowCount } = await db.query(
    'UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2',
    [hash, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (String(req.user.id) === req.params.id) setAuthCookie(res, signToken(req.user));
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  if (String(req.user.id) === req.params.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  let rowCount;
  try {
    ({ rowCount } = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]));
  } catch (e) {
    // Referenced as the author of a company validation.
    if (e.code === '23503') return res.status(409).json({ error: 'Compte référencé par des validations : désactivez-le plutôt' });
    throw e;
  }
  if (!rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ ok: true });
});

module.exports = router;
