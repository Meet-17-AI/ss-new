require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

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
