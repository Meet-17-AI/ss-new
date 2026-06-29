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
    const q = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'therapist_resources'`);
    console.log(q.rows);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
