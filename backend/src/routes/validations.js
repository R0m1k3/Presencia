const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function parseYearMonth(req) {
  const year = parseInt(req.body?.year ?? req.query?.year, 10);
  const month = parseInt(req.body?.month ?? req.query?.month, 10);
  if (!year || !month || month < 1 || month > 12) return null;
  return { year, month };
}

// Cadre validates their own month.
router.post('/cadre', async (req, res) => {
  const ym = parseYearMonth(req);
  if (!ym) return res.status(400).json({ error: 'year/month invalides' });

  // Admin can validate on behalf of a cadre (e.g. corrections), otherwise self only.
  const targetUserId = req.user.role === 'admin' && req.body.user_id ? req.body.user_id : req.user.id;

  const { rows: userRows } = await db.query('SELECT id, company_id FROM users WHERE id = $1', [targetUserId]);
  const target = userRows[0];
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const { rows: cv } = await db.query(
    'SELECT admin_validated FROM company_month_validations WHERE company_id = $1 AND year = $2 AND month = $3',
    [target.company_id, ym.year, ym.month]
  );
  if (cv[0]?.admin_validated) {
    return res.status(423).json({ error: 'La société a déjà été validée par l’administrateur pour ce mois' });
  }

  await db.query(
    `INSERT INTO month_locks (user_id, year, month, cadre_validated, cadre_validated_at)
     VALUES ($1, $2, $3, true, now())
     ON CONFLICT (user_id, year, month)
     DO UPDATE SET cadre_validated = true, cadre_validated_at = now()`,
    [target.id, ym.year, ym.month]
  );
  res.json({ ok: true });
});

// Admin reopens a cadre's month (allows corrections again).
router.post('/cadre/reopen', requireAdmin, async (req, res) => {
  const ym = parseYearMonth(req);
  const { user_id } = req.body || {};
  if (!ym || !user_id) return res.status(400).json({ error: 'Paramètres invalides' });

  await db.query(
    `INSERT INTO month_locks (user_id, year, month, cadre_validated, cadre_validated_at)
     VALUES ($1, $2, $3, false, NULL)
     ON CONFLICT (user_id, year, month)
     DO UPDATE SET cadre_validated = false, cadre_validated_at = NULL`,
    [user_id, ym.year, ym.month]
  );
  res.json({ ok: true });
});

// Admin: status of every cadre in a company for a given month.
router.get('/company/:companyId', requireAdmin, async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  const companyId = req.params.companyId;
  if (!year || !month) return res.status(400).json({ error: 'year et month requis' });

  const { rows: cadres } = await db.query(
    `SELECT u.id, u.full_name, u.email,
            ml.cadre_validated, ml.cadre_validated_at
     FROM users u
     LEFT JOIN month_locks ml ON ml.user_id = u.id AND ml.year = $2 AND ml.month = $3
     WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true
     ORDER BY u.full_name`,
    [companyId, year, month]
  );

  const { rows: cv } = await db.query(
    `SELECT admin_validated, admin_validated_at, admin_validated_by
     FROM company_month_validations WHERE company_id = $1 AND year = $2 AND month = $3`,
    [companyId, year, month]
  );

  res.json({
    cadres: cadres.map((c) => ({
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      cadreValidated: !!c.cadre_validated,
      cadreValidatedAt: c.cadre_validated_at,
    })),
    allCadresValidated: cadres.length > 0 && cadres.every((c) => c.cadre_validated),
    companyValidated: !!cv[0]?.admin_validated,
    companyValidatedAt: cv[0]?.admin_validated_at || null,
  });
});

// Admin validates the whole company for the month (requires every cadre validated).
router.post('/company/:companyId', requireAdmin, async (req, res) => {
  const ym = parseYearMonth(req);
  const companyId = req.params.companyId;
  if (!ym) return res.status(400).json({ error: 'year/month invalides' });

  const { rows: cadres } = await db.query(
    `SELECT u.id, u.full_name, ml.cadre_validated
     FROM users u
     LEFT JOIN month_locks ml ON ml.user_id = u.id AND ml.year = $2 AND ml.month = $3
     WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true`,
    [companyId, ym.year, ym.month]
  );

  const pending = cadres.filter((c) => !c.cadre_validated);
  if (pending.length > 0) {
    return res.status(409).json({
      error: 'Tous les cadres doivent valider leur mois avant validation de la société',
      pending: pending.map((c) => c.full_name),
    });
  }

  await db.query(
    `INSERT INTO company_month_validations (company_id, year, month, admin_validated, admin_validated_at, admin_validated_by)
     VALUES ($1, $2, $3, true, now(), $4)
     ON CONFLICT (company_id, year, month)
     DO UPDATE SET admin_validated = true, admin_validated_at = now(), admin_validated_by = $4`,
    [companyId, ym.year, ym.month, req.user.id]
  );
  res.json({ ok: true });
});

// Admin reopens a company's month validation.
router.post('/company/:companyId/reopen', requireAdmin, async (req, res) => {
  const ym = parseYearMonth(req);
  const companyId = req.params.companyId;
  if (!ym) return res.status(400).json({ error: 'year/month invalides' });

  await db.query(
    `INSERT INTO company_month_validations (company_id, year, month, admin_validated, admin_validated_at, admin_validated_by)
     VALUES ($1, $2, $3, false, NULL, NULL)
     ON CONFLICT (company_id, year, month)
     DO UPDATE SET admin_validated = false, admin_validated_at = NULL, admin_validated_by = NULL`,
    [companyId, ym.year, ym.month]
  );
  res.json({ ok: true });
});

module.exports = router;
