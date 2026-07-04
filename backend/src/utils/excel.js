const ExcelJS = require('exceljs');
const { STATUS_CODES, STATUS_COLORS, daysInMonth } = require('./status');

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * cadres: [{ id, fullName, entries: Map('YYYY-MM-DD:AM'|'PM' -> status) }]
 */
async function buildCompanyWorkbook({ companyName, year, month, cadres }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Presencia';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Synthèse', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
  });

  const nbDays = daysInMonth(year, month);
  const titleRow = sheet.addRow([`Présences — ${companyName} — ${MONTH_NAMES[month - 1]} ${year}`]);
  sheet.mergeCells(1, 1, 1, 1 + nbDays * 2);
  titleRow.font = { bold: true, size: 14 };
  titleRow.height = 22;

  const dayHeaderRow = sheet.getRow(2);
  dayHeaderRow.getCell(1).value = 'Cadre';
  for (let d = 1; d <= nbDays; d++) {
    const col = 2 + (d - 1) * 2;
    dayHeaderRow.getCell(col).value = d;
    sheet.mergeCells(2, col, 2, col + 1);
    dayHeaderRow.getCell(col).alignment = { horizontal: 'center' };
    dayHeaderRow.getCell(col).font = { bold: true };
  }

  const periodHeaderRow = sheet.getRow(3);
  periodHeaderRow.getCell(1).value = '';
  for (let d = 1; d <= nbDays; d++) {
    const col = 2 + (d - 1) * 2;
    periodHeaderRow.getCell(col).value = 'AM';
    periodHeaderRow.getCell(col + 1).value = 'PM';
    periodHeaderRow.getCell(col).font = { italic: true, size: 9 };
    periodHeaderRow.getCell(col + 1).font = { italic: true, size: 9 };
    periodHeaderRow.getCell(col).alignment = { horizontal: 'center' };
    periodHeaderRow.getCell(col + 1).alignment = { horizontal: 'center' };
  }

  sheet.getColumn(1).width = 26;
  for (let d = 1; d <= nbDays; d++) {
    sheet.getColumn(2 + (d - 1) * 2).width = 5;
    sheet.getColumn(3 + (d - 1) * 2).width = 5;
  }

  for (const cadre of cadres) {
    const row = sheet.addRow([cadre.fullName]);
    for (let d = 1; d <= nbDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const col = 2 + (d - 1) * 2;
      ['AM', 'PM'].forEach((period, idx) => {
        const status = cadre.entries.get(`${dateStr}:${period}`);
        const cell = row.getCell(col + idx);
        cell.alignment = { horizontal: 'center' };
        if (status) {
          cell.value = STATUS_CODES[status];
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: STATUS_COLORS[status] },
          };
          cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9 };
        }
      });
    }
  }

  const legendRowIdx = sheet.rowCount + 2;
  sheet.getCell(legendRowIdx, 1).value = 'Légende : P = Présent · A = Absent · CP = Congé · RTT = RTT';
  sheet.getCell(legendRowIdx, 1).font = { italic: true, size: 9 };

  return workbook;
}

module.exports = { buildCompanyWorkbook, MONTH_NAMES };
