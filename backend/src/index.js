require('dotenv').config();
const express = require('express');
require('express-async-errors');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const bootstrap = require('./bootstrap');
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');
const userRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const validationRoutes = require('./routes/validations');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 4790;

app.disable('x-powered-by');
// Requests arrive through nginx (and often a reverse proxy in front of it),
// both on private Docker networks: take the client address from
// X-Forwarded-For, trusting only private-network hops so it cannot be spoofed
// from the Internet. Used by the login rate limit.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
// The API is also reachable on its own port, without the nginx headers.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/validations', validationRoutes);
app.use('/api/export', exportRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// Postgres errors caused by the request content rather than by the server.
const CLIENT_PG_ERRORS = {
  '22P02': 'Valeur invalide', // invalid_text_representation
  '22007': 'Date invalide', // invalid_datetime_format
  '22008': 'Date invalide', // datetime_field_overflow
  '22001': 'Valeur trop longue', // string_data_right_truncation
  '23503': 'Élément référencé introuvable', // foreign_key_violation
};

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête JSON invalide' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
  if (CLIENT_PG_ERRORS[err.code]) return res.status(400).json({ error: CLIENT_PG_ERRORS[err.code] });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

bootstrap()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Presencia API démarrée sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Échec du démarrage :', err);
    process.exit(1);
  });
