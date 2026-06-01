import pool from './src/lib/db.js';

pool.query(`
  UPDATE bookings
  SET booking_invitee_time = 'Friday, May 29, 2026 at 1:30 PM - 2:20 PM (GMT+05:30)'
  WHERE booking_invitee_time = 'undefined undefined' AND invitee_name ILIKE '%john%'
`).then(res => {
  console.log('Fixed undefined booking:', res.rowCount);
  process.exit();
}).catch(console.error);
