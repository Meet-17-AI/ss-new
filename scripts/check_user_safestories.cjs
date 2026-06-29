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
    const q = await pool.query(`SELECT * FROM users WHERE email = 'Safestories'`);
    console.log(q.rows);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
