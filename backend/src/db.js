const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'db',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'presencia',
  password: process.env.PGPASSWORD || 'presencia',
  database: process.env.PGDATABASE || 'presencia',
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
