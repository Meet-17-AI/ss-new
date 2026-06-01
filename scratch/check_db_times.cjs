const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://fluidadmin:admin123@72.60.103.151:5432/ss_clone' });

pool.query("SELECT booking_start_at, booking_end_at, booking_invitee_time FROM bookings WHERE booking_start_at IS NOT NULL LIMIT 2").then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit();
});
