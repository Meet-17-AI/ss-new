import pool from './lib/db';

export async function startDashboardApiBookingSync() {
  console.log('🚀 Dashboard API Booking Sync Service Started');

  async function syncBookings() {
    try {
      const pendingBookings = await pool.query(
        `SELECT id, booking_id, created_at 
         FROM dashboard_api_booking 
         WHERE booking_status = 'waiting for payment'`
      );

      await Promise.all(pendingBookings.rows.map(async (booking) => {
        const { id, booking_id, created_at } = booking;
        const now = new Date();
        const createdTime = new Date(created_at);
        const timeDiffMinutes = (now.getTime() - createdTime.getTime()) / (1000 * 60);

        const bookingExists = await pool.query(
          'SELECT booking_id, booking_status FROM bookings WHERE booking_id = $1',
          [booking_id]
        );

        if (bookingExists.rows.length > 0) {
          const bookingStatus = bookingExists.rows[0].booking_status;
          await pool.query(
            `UPDATE dashboard_api_booking 
             SET booking_status = $1, payment_status = 'Completed' 
             WHERE id = $2`,
            [bookingStatus, id]
          );
          console.log(`✅ Booking ${booking_id} → Completed (${bookingStatus})`);
        } else if (timeDiffMinutes > 30) {
          await pool.query(
            `UPDATE dashboard_api_booking 
             SET booking_status = 'Failed', payment_status = 'Failed' 
             WHERE id = $1`,
            [id]
          );
          console.log(`❌ Booking ${booking_id} → Failed (timeout)`);
        }
      }));
    } catch (error) {
      console.error('❌ Sync error:', error);
    }
  }

  // Run immediately
  await syncBookings();

  // Run every 2 minutes
  setInterval(syncBookings, 2 * 60 * 1000);
}
