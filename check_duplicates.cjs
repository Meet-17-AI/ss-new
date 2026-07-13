const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function run() {
  const countRes = await pool.query(`SELECT COUNT(*) FROM bookings WHERE booking_status NOT IN ('payment_pending', 'payment_failed')`);
  console.log('COUNT from bookings:', countRes.rows[0].count);

  const queryRes = await pool.query(`
      SELECT 
        b.booking_id
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
  `);
  console.log('Row count with JOINs:', queryRes.rows.length);
  
  const counts = {};
  let duplicates = 0;
  queryRes.rows.forEach(r => {
    if (counts[r.booking_id]) {
        counts[r.booking_id]++;
        duplicates++;
        console.log('Duplicate booking_id:', r.booking_id);
    } else {
        counts[r.booking_id] = 1;
    }
  });
  console.log('Duplicates:', duplicates);
  pool.end();
}
run();
