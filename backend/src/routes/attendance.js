const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isId, isDate, parseYearMonth, monthStart } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['present', 'absent', 'conge', 'rtt'];
const PERIODS = ['AM', 'PM'];

// Resolves whose planning a request acts on. A cadre can only ever act on
// themselves; an admin may pass user_id to act on anyone. Sends the error
// response and returns null when the request is not allowed.
async function resolveTarget(req, res, requestedUserId) {
  if (requestedUserId === undefined || requestedUserId === null || requestedUserId === '') {
    return { id: req.user.id, company_id: req.user.companyId };
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Accès refusé' });
    return null;
  }
  if (!isId(String(requestedUserId))) {
    res.status(400).json({ error: 'Utilisateur invalide' });
    return null;
  }
  const { rows } = await db.query('SELECT id, company_id FROM users WHERE id = $1', [requestedUserId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return null;
  }
  return rows[0];
}

async function monthState(target, { year, month }) {
  const { rows } = await db.query(
    `SELECT
       (SELECT row_to_json(ml) FROM (
          SELECT cadre_validated, cadre_validated_at FROM month_locks
          WHERE user_id = $1 AND year = $3 AND month = $4) ml) AS lock,
       (SELECT row_to_json(cv) FROM (
          SELECT admin_validated, admin_validated_at FROM company_month_validations
          WHERE company_id = $2 AND year = $3 AND month = $4) cv) AS company`,
    [target.id, target.company_id, year, month]
  );
  const lock = rows[0].lock || {};
  const company = rows[0].company || {};
  return {
    cadreValidated: !!lock.cadre_validated,
    cadreValidatedAt: lock.cadre_validated_at || null,
    companyValidated: !!company.admin_validated,
    companyValidatedAt: company.admin_validated_at || null,
  };
}

// Same lock rules for every write: nobody edits a month the admin validated
// for the company; a cadre cannot edit a month they validated themselves.
// Sends a 423 and returns false when the month is locked.
async function ensureWritable(req, res, target, ym) {
  const st = await monthState(target, ym);
  if (st.companyValidated) {
    res.status(423).json({ error: 'Ce mois a été validé par l’administrateur et est verrouillé' });
    return false;
  }
  if (req.user.role !== 'admin' && st.cadreValidated) {
    res.status(423).json({ error: 'Vous avez déjà validé ce mois. Contactez un administrateur pour le modifier.' });
    return false;
  }
  return true;
}

const ymOf = (date) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

router.get('/', async (req, res) => {
  const ym = parseYearMonth(req.query.year, req.query.month);
  if (!ym) return res.status(400).json({ error: 'year et month requis' });
  const target = await resolveTarget(req, res, req.query.user_id);
  if (!target) return;

  const [{ rows }, st] = await Promise.all([
    db.query(
      `SELECT entry_date, period, status
       FROM attendance_entries
       WHERE user_id = $1
         AND entry_date >= $2::date
         AND entry_date < ($2::date + INTERVAL '1 month')
       ORDER BY entry_date, period`,
      [target.id, monthStart(ym)]
    ),
    monthState(target, ym),
  ]);

  res.json({
    userId: target.id,
    entries: rows.map((r) => ({ date: r.entry_date, period: r.period, status: r.status })),
    ...st,
    editable: req.user.role === 'admin'
      ? !st.companyValidated
      : !st.cadreValidated && !st.companyValidated,
  });
});

router.put('/', async (req, res) => {
  const { date, period, status, user_id: requestedUserId } = req.body || {};
  if (!isDate(date) || !PERIODS.includes(period) || !STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const target = await resolveTarget(req, res, requestedUserId);
  if (!target) return;
  if (!(await ensureWritable(req, res, target, ymOf(date)))) return;

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
  const target = await resolveTarget(req, res, req.query.user_id);
  if (!target) return;

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

// Clear every entry of a month (the « Tout effacer » action).
router.delete('/month', async (req, res) => {
  const { year, month, user_id: requestedUserId } = req.body || {};
  const ym = parseYearMonth(year, month);
  if (!ym) return res.status(400).json({ error: 'Paramètres invalides' });
  const target = await resolveTarget(req, res, requestedUserId);
  if (!target) return;
  if (!(await ensureWritable(req, res, target, ym))) return;

  await db.query(
    `DELETE FROM attendance_entries
     WHERE user_id = $1 AND entry_date >= $2::date AND entry_date < ($2::date + INTERVAL '1 month')`,
    [target.id, monthStart(ym)]
  );
  res.json({ ok: true });
});

// Bulk upsert (e.g. « fill all empty weekdays with présent »). Every month
// present in the payload must pass the same lock checks as single writes.
router.put('/bulk', async (req, res) => {
  const { entries, user_id: requestedUserId } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 200) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  if (entries.some((e) => !e || !isDate(e.date) || !PERIODS.includes(e.period) || !STATUSES.includes(e.status))) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const target = await resolveTarget(req, res, requestedUserId);
  if (!target) return;

  for (const ym of new Set(entries.map((e) => e.date.slice(0, 7)))) {
    if (!(await ensureWritable(req, res, target, ymOf(ym)))) return;
  }

  // One statement for the whole batch. A half-day listed twice would make
  // ON CONFLICT hit the same row twice and fail, so the last one wins.
  const byKey = new Map(entries.map((e) => [`${e.date}|${e.period}`, e]));
  const list = [...byKey.values()];
  await db.query(
    `INSERT INTO attendance_entries (user_id, entry_date, period, status, updated_at)
     SELECT $1, d, p::half_day_period, s::attendance_status, now()
     FROM unnest($2::date[], $3::text[], $4::text[]) AS t(d, p, s)
     ON CONFLICT (user_id, entry_date, period)
     DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [target.id, list.map((e) => e.date), list.map((e) => e.period), list.map((e) => e.status)]
  );

  res.json({ ok: true, count: list.length });
});

router.delete('/', async (req, res) => {
  const { date, period, user_id: requestedUserId } = req.body || {};
  if (!isDate(date) || !PERIODS.includes(period)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const target = await resolveTarget(req, res, requestedUserId);
  if (!target) return;
  if (!(await ensureWritable(req, res, target, ymOf(date)))) return;

  await db.query(
    'DELETE FROM attendance_entries WHERE user_id = $1 AND entry_date = $2 AND period = $3',
    [target.id, date, period]
  );
  res.json({ ok: true });
});

module.exports = router;
