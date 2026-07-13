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
      AND LOWER(TRIM(booking_host_name)) != 'safestories'
  `);
  console.log('Dashboard Upcoming Count (DB):', dashRes.rows[0].count);

  const aptsRes = await pool.query(`
      SELECT b.booking_status, b.booking_id, (b.booking_start_at < NOW()) as is_past,
      CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
  `);
  
  let aptUpcoming = 0;
  aptsRes.rows.forEach(row => {
      let status = row.booking_status;
      if (row.booking_status !== 'cancelled' && row.booking_status !== 'canceled' && row.booking_status !== 'no_show' && row.booking_status !== 'no show') {
        if (row.has_session_notes) {
          status = 'completed';
        } else if (row.is_past) {
          status = 'pending_notes';
        }
      }
      if (status !== 'cancelled' && status !== 'canceled' && status !== 'no_show' && status !== 'no show' && status !== 'completed' && status !== 'pending_notes') {
          aptUpcoming++;
      }
  });

  console.log('Appointments Page Upcoming Count:', aptUpcoming);

  pool.end();
}
run();
