const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.created_at,
            COUNT(u.id) FILTER (WHERE u.role = 'cadre' AND u.active) AS active_cadre_count
     FROM companies c
     LEFT JOIN users u ON u.company_id = c.id
     GROUP BY c.id
     ORDER BY c.name`
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const { rows } = await db.query(
      'INSERT INTO companies (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette société existe déjà' });
    throw err;
  }
});

router.put('/:id', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
  try {
    const { rows } = await db.query(
      'UPDATE companies SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name.trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Société introuvable' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette société existe déjà' });
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Société introuvable' });
  res.json({ ok: true });
});

module.exports = router;
