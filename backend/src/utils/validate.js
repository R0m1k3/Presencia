// Input checks shared by the routes. Anything that reaches SQL unchecked and
// is malformed (an id like "abc", a month 13, a date "2026-02-31") makes
// Postgres throw, which surfaces as a 500 instead of a 400.

const MAX_INT = 2147483647;

function isId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v <= MAX_INT;
  // Canonical form only: '07' would reach SQL as 7 yet differ from '7' in
  // the string comparisons that guard an admin's own account.
  return typeof v === 'string' && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= MAX_INT;
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Returns { year, month } or null.
function parseYearMonth(year, month) {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!(y >= 2000 && y <= 2100) || !(m >= 1 && m <= 12)) return null;
  return { year: y, month: m };
}

function monthStart({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function isEmail(s) {
  return typeof s === 'string' && s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isName(s) {
  return typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 255;
}

const MIN_PASSWORD = 8;
function passwordError(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) {
    return `Mot de passe trop court (${MIN_PASSWORD} caractères minimum)`;
  }
  // bcrypt ignores everything past 72 bytes.
  if (Buffer.byteLength(p) > 72) return 'Mot de passe trop long (72 octets maximum)';
  return null;
}

// Express router.param handler: rejects non-numeric ids with a 400.
function idParam(req, res, next, value) {
  if (!isId(value)) return res.status(400).json({ error: 'Identifiant invalide' });
  next();
}

module.exports = {
  isId, isDate, parseYearMonth, monthStart, isEmail, isName, passwordError, idParam, MIN_PASSWORD,
};
