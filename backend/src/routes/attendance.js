const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['present', 'absent', 'conge', 'rtt'];
const PERIODS = ['AM', 'PM'];

async function getTargetUser(req, requestedUserId) {
  // Cadre can only ever act on themselves. Admin may act on any user.
  if (req.user.role === 'admin' && requestedUserId) {
    const { rows } = await db.query(
      'SELECT id, role, company_id FROM users WHERE id = $1',
      [requestedUserId]
    );
    return rows[0] || null;
  }
  return { id: req.user.id, role: req.user.role, company_id: req.user.companyId };
}

async function getMonthLock(userId, year, month) {
  const { rows } = await db.query(
    'SELECT cadre_validated, cadre_validated_at FROM month_locks WHERE user_id = $1 AND year = $2 AND month = $3',
    [userId, year, month]
  );
  return rows[0] || { cadre_validated: false, cadre_validated_at: null };
}

async function getCompanyValidation(companyId, year, month) {
  if (!companyId) return { admin_validated: false, admin_validated_at: null };
  const { rows } = await db.query(
    'SELECT admin_validated, admin_validated_at FROM company_month_validations WHERE company_id = $1 AND year = $2 AND month = $3',
    [companyId, year, month]
  );
  return rows[0] || { admin_validated: false, admin_validated_at: null };
}

router.get('/', async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) return res.status(400).json({ error: 'year et month requis' });

  const requestedUserId = req.query.user_id;
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const { rows } = await db.query(
    `SELECT entry_date, period, status
     FROM attendance_entries
     WHERE user_id = $1
       AND entry_date >= $2::date
       AND entry_date < ($2::date + INTERVAL '1 month')
     ORDER BY entry_date, period`,
    [target.id, start]
  );

  const lock = await getMonthLock(target.id, year, month);
  const companyValidation = await getCompanyValidation(target.company_id, year, month);

  res.json({
    userId: target.id,
    entries: rows.map((r) => ({
      date: r.entry_date.toISOString().slice(0, 10),
      period: r.period,
      status: r.status,
    })),
    cadreValidated: lock.cadre_validated,
    cadreValidatedAt: lock.cadre_validated_at,
    companyValidated: companyValidation.admin_validated,
    companyValidatedAt: companyValidation.admin_validated_at,
    editable:
      req.user.role === 'admin'
        ? !companyValidation.admin_validated
        : !lock.cadre_validated && !companyValidation.admin_validated,
  });
});

router.put('/', async (req, res) => {
  const { date, period, status, user_id: requestedUserId } = req.body || {};
  if (!date || !PERIODS.includes(period) || !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const d = new Date(date + 'T00:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;

  const lock = await getMonthLock(target.id, year, month);
  const companyValidation = await getCompanyValidation(target.company_id, year, month);

  if (companyValidation.admin_validated) {
    return res.status(423).json({ error: 'Ce mois a été validé par l’administrateur et est verrouillé' });
  }
  if (req.user.role !== 'admin' && lock.cadre_validated) {
    return res.status(423).json({ error: 'Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.' });
  }

  await db.query(
    `INSERT INTO attendance_entries (user_id, entry_date, period, status, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, entry_date, period)
     DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [target.id, date, period, status]
  );

  res.json({ ok: true });
});

router.delete('/', async (req, res) => {
  const { date, period, user_id: requestedUserId } = req.body || {};
  if (!date || !PERIODS.includes(period)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const d = new Date(date + 'T00:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const lock = await getMonthLock(target.id, year, month);
  const companyValidation = await getCompanyValidation(target.company_id, year, month);

  if (companyValidation.admin_validated) {
    return res.status(423).json({ error: 'Ce mois a été validé par l’administrateur et est verrouillé' });
  }
  if (req.user.role !== 'admin' && lock.cadre_validated) {
    return res.status(423).json({ error: 'Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.' });
  }

  await db.query(
    'DELETE FROM attendance_entries WHERE user_id = $1 AND entry_date = $2 AND period = $3',
    [target.id, date, period]
  );
  res.json({ ok: true });
});

module.exports = router;
