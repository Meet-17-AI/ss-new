const { Pool } = require('pg');
const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123'
});

async function test() {
  const allCount = await pool.query('SELECT COUNT(*) FROM bookings');
  console.log('Total bookings in DB (Dashboard Bookings KPI):', allCount.rows[0].count);
  
  const completedStats = await pool.query(`SELECT COUNT(*) FROM bookings b WHERE b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes' AND b.booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show')`);
  console.log('Dashboard completed count:', completedStats.rows[0].count);
  
  const allAppointments = await pool.query(`SELECT 
        b.booking_id,
        b.booking_invitee_time,
        b.booking_resource_name,
        b.invitee_payment_amount,
        b.booking_subject,
        b.invitee_name,
        b.invitee_phone,
        b.invitee_email,
        b.booking_host_name,
        b.booking_mode,
        b.booking_start_at,
        b.booking_joining_link,
        b.booking_checkin_url,
        b.therapist_id,
        b.booking_status,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes,
        (b.booking_start_at < NOW()) as is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      ORDER BY b.booking_start_at DESC`);
      
  console.log('Rows returned by /api/appointments query:', allAppointments.rows.length);
  
  // Try counting unique booking IDs from the appointments query
  const uniqueIds = new Set();
  allAppointments.rows.forEach(r => uniqueIds.add(r.booking_id));
  console.log('Unique bookings returned by /api/appointments:', uniqueIds.size);
  
  process.exit(0);
}
test();
