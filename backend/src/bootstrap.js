const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { initJwtSecret } = require('./middleware/auth');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30, delayMs = 2000) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      console.log(`En attente de la base de données... (${i + 1}/${retries}) — ${err.message}`);
      await sleep(delayMs);
    }
  }
  throw new Error(
    `Impossible de se connecter à la base de données : ${lastErr ? lastErr.message : 'raison inconnue'}`
  );
}

async function runMigrations() {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'companies'
     ) AS exists`
  );
  if (rows[0].exists) {
    console.log('Schéma déjà initialisé.');
  } else {
    console.log('Initialisation du schéma de base de données...');
    await db.query(readMigration('001_init.sql'));
    console.log('Schéma créé.');
  }
  // Idempotent, so safe on every start: brings existing databases up to date.
  await db.query(readMigration('002_security.sql'));
}

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');
}

// ADMIN_EMAIL / ADMIN_PASSWORD only matter on the very first start (no admin
// in the database yet). Without ADMIN_PASSWORD a random password is generated
// and printed once in the logs, so no known default password is ever seeded.
async function seedAdmin() {
  const { rows } = await db.query(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (rows.length > 0) {
    if (process.env.ADMIN_PASSWORD) {
      console.warn(
        'ADMIN_PASSWORD ignoré : un compte administrateur existe déjà. ' +
          'Vous pouvez retirer ADMIN_EMAIL / ADMIN_PASSWORD du fichier .env.'
      );
    }
    return;
  }

  const email = process.env.ADMIN_EMAIL || 'admin@presencia.local';
  const fullName = process.env.ADMIN_NAME || 'Administrateur';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = generated
    ? crypto.randomBytes(18).toString('base64url')
    : process.env.ADMIN_PASSWORD;

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, company_id, active)
     VALUES ($1, $2, $3, 'admin', NULL, true)`,
    [fullName, email, hash]
  );
  console.log('========================================================');
  console.log(' Compte administrateur créé :');
  console.log(` Email    : ${email}`);
  if (generated) {
    console.log(` Mot de passe (généré, affiché une seule fois) : ${password}`);
  } else {
    console.log(' Mot de passe : celui de ADMIN_PASSWORD');
  }
  console.log(' Merci de le changer après la première connexion.');
  console.log('========================================================');
}

async function bootstrap() {
  await waitForDb();
  await runMigrations();
  await initJwtSecret();
  await seedAdmin();
}

module.exports = bootstrap;
