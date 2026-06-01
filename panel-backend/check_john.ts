import pool from './src/lib/db.js';

pool.query("SELECT booking_id, invitee_name, booking_start_at, booking_end_at, booking_invitee_time FROM bookings WHERE invitee_name ILIKE '%John%' OR invitee_name ILIKE '%Test%' ORDER BY booking_start_at DESC LIMIT 10").then(res => {
  console.log(res.rows);
  process.exit();
}).catch(console.error);
