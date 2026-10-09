const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { buildCompanyWorkbook } = require('../utils/excel');
const { buildCompanyPdf } = require('../utils/pdf');
const { parseYearMonth, monthStart, idParam } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth, requireAdmin);
router.param('companyId', idParam);

async function loadCompanyData(companyId, year, month) {
  const { rows: companyRows } = await db.query('SELECT id, name FROM companies WHERE id = $1', [companyId]);
  const company = companyRows[0];
  if (!company) return null;

  const { rows: cadreRows } = await db.query(
    `SELECT id, full_name FROM users WHERE company_id = $1 AND role = 'cadre' AND active = true ORDER BY full_name`,
    [companyId]
  );

  // All entries of the month in one query, rather than one query per cadre.
  const { rows: entryRows } = await db.query(
    `SELECT ae.user_id, ae.entry_date, ae.period, ae.status
     FROM attendance_entries ae
     JOIN users u ON u.id = ae.user_id
     WHERE u.company_id = $1 AND u.role = 'cadre' AND u.active = true
       AND ae.entry_date >= $2::date AND ae.entry_date < ($2::date + INTERVAL '1 month')`,
    [companyId, monthStart({ year, month })]
  );
  const cadres = cadreRows.map((c) => ({ id: c.id, fullName: c.full_name, entries: new Map() }));
  const byId = new Map(cadres.map((c) => [c.id, c]));
  for (const e of entryRows) {
    byId.get(e.user_id).entries.set(`${e.entry_date}:${e.period}`, e.status);
  }

  return { company, cadres };
}

// Content-Disposition value. Header values must be Latin-1, so a company
// name like « Société — Nord » would make Node throw: send an ASCII fallback
// plus the exact UTF-8 name (RFC 6266 / 5987).
function attachment(companyName, year, month, ext) {
  const base = `presences_${companyName}_${year}-${String(month).padStart(2, '0')}.${ext}`.replace(/\s+/g, '_');
  const ascii = base.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\/;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base.replace(/[\\/]/g, '_')).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

router.get('/excel/:companyId', async (req, res) => {
  const ym = parseYearMonth(req.query.year, req.query.month);
  if (!ym) return res.status(400).json({ error: 'year et month requis' });
  const { year, month } = ym;

  const data = await loadCompanyData(req.params.companyId, year, month);
  if (!data) return res.status(404).json({ error: 'Société introuvable' });

  const workbook = await buildCompanyWorkbook({
    companyName: data.company.name,
    year,
    month,
    cadres: data.cadres,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachment(data.company.name, year, month, 'xlsx'));
  await workbook.xlsx.write(res);
  res.end();
});

router.get('/pdf/:companyId', async (req, res) => {
  const ym = parseYearMonth(req.query.year, req.query.month);
  if (!ym) return res.status(400).json({ error: 'year et month requis' });
  const { year, month } = ym;

  const data = await loadCompanyData(req.params.companyId, year, month);
  if (!data) return res.status(404).json({ error: 'Société introuvable' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachment(data.company.name, year, month, 'pdf'));

  const doc = buildCompanyPdf({
    companyName: data.company.name,
    year,
    month,
    cadres: data.cadres,
  });
  doc.pipe(res);
});

module.exports = router;
