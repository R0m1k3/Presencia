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

app.use(express.json());
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

app.use((err, req, res, next) => {
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
