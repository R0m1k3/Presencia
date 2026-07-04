const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { buildCompanyWorkbook } = require('../utils/excel');
const { buildCompanyPdf } = require('../utils/pdf');

const router = express.Router();
router.use(requireAuth, requireAdmin);

async function loadCompanyData(companyId, year, month) {
  const { rows: companyRows } = await db.query('SELECT id, name FROM companies WHERE id = $1', [companyId]);
  const company = companyRows[0];
  if (!company) return null;

  const { rows: cadreRows } = await db.query(
    `SELECT id, full_name FROM users WHERE company_id = $1 AND role = 'cadre' AND active = true ORDER BY full_name`,
    [companyId]
  );

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const cadres = [];
  for (const c of cadreRows) {
    const { rows: entries } = await db.query(
      `SELECT entry_date, period, status FROM attendance_entries
       WHERE user_id = $1 AND entry_date >= $2::date AND entry_date < ($2::date + INTERVAL '1 month')`,
      [c.id, start]
    );
    const map = new Map();
    for (const e of entries) {
      map.set(`${e.entry_date.toISOString().slice(0, 10)}:${e.period}`, e.status);
    }
    cadres.push({ id: c.id, fullName: c.full_name, entries: map });
  }

  return { company, cadres };
}

router.get('/excel/:companyId', async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) return res.status(400).json({ error: 'year et month requis' });

  const data = await loadCompanyData(req.params.companyId, year, month);
  if (!data) return res.status(404).json({ error: 'Société introuvable' });

  const workbook = await buildCompanyWorkbook({
    companyName: data.company.name,
    year,
    month,
    cadres: data.cadres,
  });

  const filename = `presences_${data.company.name.replace(/\s+/g, '_')}_${year}-${String(month).padStart(2, '0')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

router.get('/pdf/:companyId', async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) return res.status(400).json({ error: 'year et month requis' });

  const data = await loadCompanyData(req.params.companyId, year, month);
  if (!data) return res.status(404).json({ error: 'Société introuvable' });

  const filename = `presences_${data.company.name.replace(/\s+/g, '_')}_${year}-${String(month).padStart(2, '0')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = buildCompanyPdf({
    companyName: data.company.name,
    year,
    month,
    cadres: data.cadres,
  });
  doc.pipe(res);
});

module.exports = router;
