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

// Per-month aggregates for the history view: half-day counts by status plus
// both validation flags, most recent month first.
router.get('/history', async (req, res) => {
  const requestedUserId = req.query.user_id;
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const { rows } = await db.query(
    `WITH months AS (
       SELECT EXTRACT(YEAR FROM entry_date)::int AS year,
              EXTRACT(MONTH FROM entry_date)::int AS month,
              COUNT(*) FILTER (WHERE status = 'present') AS present,
              COUNT(*) FILTER (WHERE status = 'absent') AS absent,
              COUNT(*) FILTER (WHERE status = 'conge') AS conge,
              COUNT(*) FILTER (WHERE status = 'rtt') AS rtt
       FROM attendance_entries
       WHERE user_id = $1
       GROUP BY 1, 2
     )
     SELECT m.*, COALESCE(ml.cadre_validated, false) AS cadre_validated,
            COALESCE(cmv.admin_validated, false) AS company_validated
     FROM months m
     LEFT JOIN month_locks ml ON ml.user_id = $1 AND ml.year = m.year AND ml.month = m.month
     LEFT JOIN users u ON u.id = $1
     LEFT JOIN company_month_validations cmv
       ON cmv.company_id = u.company_id AND cmv.year = m.year AND cmv.month = m.month
     ORDER BY m.year DESC, m.month DESC
     LIMIT 24`,
    [target.id]
  );

  res.json(rows.map((r) => ({
    year: r.year,
    month: r.month,
    present: parseInt(r.present, 10),
    absent: parseInt(r.absent, 10),
    conge: parseInt(r.conge, 10),
    rtt: parseInt(r.rtt, 10),
    cadreValidated: r.cadre_validated,
    companyValidated: r.company_validated,
  })));
});

// Clear every entry of a month (the « Tout effacer » action). Same lock rules
// as writes.
router.delete('/month', async (req, res) => {
  const { year, month, user_id: requestedUserId } = req.body || {};
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'Paramètres invalides' });
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const lock = await getMonthLock(target.id, y, m);
  const companyValidation = await getCompanyValidation(target.company_id, y, m);
  if (companyValidation.admin_validated) {
    return res.status(423).json({ error: 'Ce mois a été validé par l’administrateur et est verrouillé' });
  }
  if (req.user.role !== 'admin' && lock.cadre_validated) {
    return res.status(423).json({ error: 'Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.' });
  }

  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  await db.query(
    `DELETE FROM attendance_entries
     WHERE user_id = $1 AND entry_date >= $2::date AND entry_date < ($2::date + INTERVAL '1 month')`,
    [target.id, start]
  );
  res.json({ ok: true });
});

// Bulk upsert (e.g. « fill all empty weekdays with présent »). All entries
// must pass the same lock checks as single writes; months are checked once
// per distinct month present in the payload.
router.put('/bulk', async (req, res) => {
  const { entries, user_id: requestedUserId } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  for (const e of entries) {
    if (!e || !e.date || !PERIODS.includes(e.period) || !STATUSES.includes(e.status)) {
      return res.status(400).json({ error: 'Paramètres invalides' });
    }
  }
  if (requestedUserId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const target = await getTargetUser(req, requestedUserId);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const months = new Set(entries.map((e) => e.date.slice(0, 7)));
  for (const ym of months) {
    const [year, month] = ym.split('-').map(Number);
    const lock = await getMonthLock(target.id, year, month);
    const companyValidation = await getCompanyValidation(target.company_id, year, month);
    if (companyValidation.admin_validated) {
      return res.status(423).json({ error: 'Ce mois a été validé par l’administrateur et est verrouillé' });
    }
    if (req.user.role !== 'admin' && lock.cadre_validated) {
      return res.status(423).json({ error: 'Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.' });
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      await client.query(
        `INSERT INTO attendance_entries (user_id, entry_date, period, status, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id, entry_date, period)
         DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        [target.id, e.date, e.period, e.status]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true, count: entries.length });
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
