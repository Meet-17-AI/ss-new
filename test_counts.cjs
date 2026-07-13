const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  const statsRes = await pool.query(`SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ('payment_pending', 'payment_failed')`);
  console.log('Dashboard Stats Bookings:', statsRes.rows[0].total);

  const aptsRes = await pool.query(`
      SELECT b.booking_id
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
  `);
  console.log('Appointments Array Length:', aptsRes.rows.length);
  pool.end();
}
run();
