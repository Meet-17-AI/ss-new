const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const tables = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
  for (let r of tables.rows) {
    try {
      const q = await pool.query(`SELECT * FROM "${r.tablename}" LIMIT 1000`);
      const str = JSON.stringify(q.rows);
      if (str.includes('fluidjobs')) {
        console.log('FOUND OLD URL IN TABLE: ' + r.tablename);
      }
    } catch(e) {}
  }
  pool.end();
}
run();
