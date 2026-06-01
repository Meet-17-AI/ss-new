import pool from './src/lib/db.js';

pool.query("SELECT booking_id, invitee_name, booking_start_at, booking_end_at, booking_invitee_time FROM bookings ORDER BY created_at DESC LIMIT 5").then(res => {
  console.log(res.rows);
  process.exit();
}).catch(console.error);
