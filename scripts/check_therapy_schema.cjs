const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const q = await pool.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'therapy_services'`);
    console.log(q.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
