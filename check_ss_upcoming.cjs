const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  const dashRes = await pool.query(`
    SELECT COUNT(*) 
    FROM bookings 
    WHERE booking_status IN ('confirmed', 'scheduled')
      AND LOWER(TRIM(booking_host_name)) = 'safestories'
      AND booking_end_at > NOW()
  `);
  console.log('Upcoming safestories bookings:', dashRes.rows[0].count);

  pool.end();
}
run();
