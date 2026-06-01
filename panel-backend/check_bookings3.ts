import pool from './src/lib/db.js';

pool.query("SELECT booking_id, invitee_name, booking_start_at, booking_end_at, booking_invitee_time, invitee_created_at FROM bookings ORDER BY invitee_created_at DESC NULLS LAST LIMIT 5").then(res => {
  console.log(res.rows);
  process.exit();
}).catch(console.error);
