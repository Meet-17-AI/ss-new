const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  const res = await pool.query(`SELECT COUNT(*) FROM bookings WHERE LOWER(TRIM(booking_host_name)) = 'safestories'`);
  console.log('Bookings with host safestories:', res.rows[0].count);
  pool.end();
}
run();
