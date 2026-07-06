const PDFDocument = require('pdfkit');
const { STATUS_LABELS, daysInMonth } = require('./status');
const { MONTH_NAMES } = require('./excel');

const STATUS_HEX = {
  present: '#2E7D32',
  absent: '#C62828',
  conge: '#EF6C00',
  rtt: '#1565C0',
};

/**
 * cadres: [{ id, fullName, entries: Map('YYYY-MM-DD:AM'|'PM' -> status) }]
 * Returns a PDFDocument stream (caller pipes it to res).
 */
function buildCompanyPdf({ companyName, year, month, cadres }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const nbDays = daysInMonth(year, month);

  doc.fontSize(18).fillColor('#111').text('Presencia — Récapitulatif de présences', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor('#444').text(`${companyName} — ${MONTH_NAMES[month - 1]} ${year}`);
  doc.moveDown(1);

  cadres.forEach((cadre, idx) => {
    if (idx > 0) doc.addPage();
    else doc.moveDown(0.5);

    doc.fontSize(14).fillColor('#111').text(cadre.fullName, { underline: true });
    doc.moveDown(0.5);

    const counts = { present: 0, absent: 0, conge: 0, rtt: 0 };

    const startX = doc.x;
    let y = doc.y;
    const rowHeight = 16;
    const colDay = 30;
    const colAM = 90;
    const colPM = 90;

    doc.fontSize(9).fillColor('#fff');
    doc.rect(startX, y, colDay + colAM + colPM, rowHeight).fill('#333');
    doc.fillColor('#fff').text('Jour', startX + 4, y + 4, { width: colDay - 8 });
    doc.text('Matin (AM)', startX + colDay + 4, y + 4, { width: colAM - 8 });
    doc.text('Après-midi (PM)', startX + colDay + colAM + 4, y + 4, { width: colPM - 8 });
    y += rowHeight;

    for (let d = 1; d <= nbDays; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const am = cadre.entries.get(`${dateStr}:AM`);
      const pm = cadre.entries.get(`${dateStr}:PM`);
      if (am) counts[am]++;
      if (pm) counts[pm]++;

      if (y > 760) {
        doc.addPage();
        y = 40;
      }

      doc.rect(startX, y, colDay + colAM + colPM, rowHeight).strokeColor('#ddd').stroke();
      doc.fillColor('#111').fontSize(9).text(String(d), startX + 4, y + 4, { width: colDay - 8 });

      doc.fillColor(am ? STATUS_HEX[am] : '#999').text(
        am ? STATUS_LABELS[am] : '—',
        startX + colDay + 4,
        y + 4,
        { width: colAM - 8 }
      );
      doc.fillColor(pm ? STATUS_HEX[pm] : '#999').text(
        pm ? STATUS_LABELS[pm] : '—',
        startX + colDay + colAM + 4,
        y + 4,
        { width: colPM - 8 }
      );
      y += rowHeight;
    }

    y += 10;
    if (y > 740) {
      doc.addPage();
      y = 40;
    }
    doc.fontSize(10).fillColor('#111').text(
      `Total demi-journées — Présent: ${counts.present}  ·  Non-présent: ${counts.absent}  ·  Congé: ${counts.conge}  ·  RTT: ${counts.rtt}`,
      startX,
      y
    );
  });

  doc.end();
  return doc;
}

module.exports = { buildCompanyPdf };
