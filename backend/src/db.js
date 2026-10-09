const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings. By default pg builds a JS Date
// at local midnight, and toISOString() then shifts it to the previous day as
// soon as the server runs in a timezone ahead of UTC (e.g. TZ=Europe/Paris).
types.setTypeParser(types.builtins.DATE, (v) => v);

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
