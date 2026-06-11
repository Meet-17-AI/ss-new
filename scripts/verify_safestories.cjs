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
    const u = await pool.query(`SELECT * FROM users WHERE username = 'Safestories'`);
    console.log('User:', u.rows[0]);
    const t = await pool.query(`SELECT * FROM therapists WHERE therapist_id = 'SafeStories'`);
    console.log('Therapist:', t.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
