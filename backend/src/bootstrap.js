const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDb(retries = 30, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`En attente de la base de données... (${i + 1}/${retries})`);
      await sleep(delayMs);
    }
  }
  throw new Error('Impossible de se connecter à la base de données');
}

async function runMigrations() {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables WHERE table_name = 'companies'
     ) AS exists`
  );
  if (rows[0].exists) {
    console.log('Schéma déjà initialisé.');
    return;
  }
  const sqlPath = path.join(__dirname, '..', 'migrations', '001_init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Initialisation du schéma de base de données...');
  await db.query(sql);
  console.log('Schéma créé.');
}

async function seedAdmin() {
  const { rows } = await db.query(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (rows.length > 0) return;

  const email = process.env.ADMIN_EMAIL || 'admin@presencia.local';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const fullName = process.env.ADMIN_NAME || 'Administrateur';

  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, company_id, active)
     VALUES ($1, $2, $3, 'admin', NULL, true)`,
    [fullName, email, hash]
  );
  console.log('========================================================');
  console.log(' Compte administrateur créé :');
  console.log(` Email    : ${email}`);
  console.log(` Mot de passe : ${password}`);
  console.log(' Merci de le changer après la première connexion.');
  console.log('========================================================');
}

async function bootstrap() {
  await waitForDb();
  await runMigrations();
  await seedAdmin();
}

module.exports = bootstrap;
