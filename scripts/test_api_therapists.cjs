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
    const q = await pool.query(`SELECT u.id, u.name, u.full_name, u.therapist_id, t.specialization FROM users u LEFT JOIN therapists t ON u.therapist_id = t.therapist_id WHERE u.role = 'therapist' AND COALESCE(t.is_active, true) = true`);
    console.log(q.rows);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
