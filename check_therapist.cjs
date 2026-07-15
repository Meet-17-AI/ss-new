const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function check() {
  try {
    const res = await pool.query(`SELECT therapist_id FROM therapists WHERE TRIM(LOWER(name)) = $1 LIMIT 1`, ['anjali pillai']);
    console.log('Result:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
check();
