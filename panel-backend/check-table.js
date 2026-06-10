const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function checkBookings() {
  try {
    const res = await pool.query("SELECT booking_id, razorpay_order_id, booking_status FROM bookings WHERE booking_status = 'payment_pending' ORDER BY booking_created_at DESC LIMIT 1");
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkBookings();
