const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const COOKIE_NAME = 'presencia_token';

// Values that have shipped in this repository or its docs. Anyone can read
// them, so a token signed with one of them can be forged by anyone.
const KNOWN_PLACEHOLDERS = new Set([
  'change-me-to-a-long-random-string',
  'dev-secret-change-me',
]);

let jwtSecret = null;

// Called once at startup. Uses JWT_SECRET when it is a real secret; otherwise
// generates one and keeps it in the database so sessions survive restarts.
async function initJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32 && !KNOWN_PLACEHOLDERS.has(fromEnv)) {
    jwtSecret = fromEnv;
    return;
  }
  if (fromEnv) {
    console.warn('JWT_SECRET ignoré (trop court ou valeur d’exemple) : un secret aléatoire est utilisé à la place.');
  }
  const candidate = crypto.randomBytes(48).toString('base64url');
  await db.query(
    "INSERT INTO app_settings (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING",
    [candidate]
  );
  const { rows } = await db.query("SELECT value FROM app_settings WHERE key = 'jwt_secret'");
  jwtSecret = rows[0].value;
}

function signToken(user) {
  return jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '12h' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// The token only proves who the caller is. Role, company and whether the
// account is still active are read from the database on every request, so
// deactivating or demoting an account takes effect immediately rather than
// when its 12-hour token expires.
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
  const { rows } = await db.query(
    `SELECT id, full_name, email, role, company_id, active, password_changed_at
     FROM users WHERE id = $1`,
    [payload.id]
  );
  const u = rows[0];
  const changedAt = u && u.password_changed_at ? Math.floor(u.password_changed_at.getTime() / 1000) : 0;
  if (!u || !u.active || payload.iat < changedAt) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
  req.user = {
    id: u.id,
    role: u.role,
    companyId: u.company_id,
    fullName: u.full_name,
    email: u.email,
  };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = {
  initJwtSecret,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireAdmin,
  COOKIE_NAME,
};
