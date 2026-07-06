const STATUS_LABELS = {
  present: 'Présent',
  absent: 'Non-présent',
  conge: 'Congé',
  rtt: 'RTT',
};

const STATUS_CODES = {
  present: 'P',
  absent: 'NP',
  conge: 'CP',
  rtt: 'RTT',
};

const STATUS_COLORS = {
  present: 'FF2E7D32',
  absent: 'FFC62828',
  conge: 'FFEF6C00',
  rtt: 'FF1565C0',
};

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

module.exports = { STATUS_LABELS, STATUS_CODES, STATUS_COLORS, daysInMonth };
