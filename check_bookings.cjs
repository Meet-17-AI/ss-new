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
    const res = await pool.query(
      `SELECT * FROM bookings WHERE therapist_id = '58769' AND booking_start_at >= '2026-07-17 00:00:00' AND booking_start_at <= '2026-07-17 23:59:59'`
    );
    console.log('Bookings:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
check();
