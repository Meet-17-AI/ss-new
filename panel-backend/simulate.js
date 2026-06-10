const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function simulate() {
  try {
    const bRes = await pool.query("SELECT * FROM bookings WHERE booking_status = 'payment_pending' ORDER BY booking_updated_at DESC LIMIT 1");
    if (bRes.rows.length === 0) {
      console.log("No pending bookings found to simulate.");
      return;
    }
    const booking = bRes.rows[0];
    const bookingId = booking.booking_id;
    const razorpayOrderId = booking.razorpay_order_id;
    const razorpayPaymentId = "pay_fake123";

    const payload = {
      clientName: "Test Client",
      clientEmail: "test@example.com",
      clientWhatsApp: "9999999999",
      sessionMode: "online",
      clientTimezone: "Asia/Kolkata"
    };

    console.log("Simulating for booking:", bookingId);

    // 1. Resolve Therapist
    const therapistName = payload.therapistName || booking.booking_host_name || 'Unknown Therapist';
    let therapistId = payload.therapistId || booking.therapist_id || null;
    let therapist = null;
    if (therapistName !== 'SafeStories' && therapistName !== 'Unknown Therapist') {
      const qParam = therapistId ? therapistId : `%${therapistName.split(' ')[0]}%`;
      const qStr = therapistId
        ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
        : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
      const tRes = await pool.query(qStr, [qParam]);
      if (tRes.rows.length > 0) { therapist = tRes.rows[0]; therapistId = therapist.therapist_id; }
    }

    // 2. Build time strings
    const { randomUUID } = require('crypto');
    const startAt = new Date(booking.booking_start_at);
    const endAt   = new Date(booking.booking_end_at);
    const formatTime = (d) => d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
    });
    const dayName   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: 'Asia/Kolkata' });
    const monthName = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: 'Asia/Kolkata' });
    const dateNum   = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: 'Asia/Kolkata' });
    const yearNum   = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: 'Asia/Kolkata' });
    const startTimeStr = formatTime(startAt);
    const endTimeStr   = formatTime(endAt);
    const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${startTimeStr} - ${endTimeStr} IST`;

    const clientTz = payload.clientTimezone || payload.timezone || 'Asia/Kolkata';
    const fmtClient = (d) => d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz
    });
    const cDay   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: clientTz });
    const cMonth = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: clientTz });
    const cDate  = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: clientTz });
    const cYear  = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: clientTz });
    let tzShort = 'IST';
    if (clientTz !== 'Asia/Kolkata') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startAt);
        tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
      } catch { tzShort = clientTz; }
    }
    const inviteeTime = `${cDay}, ${cMonth} ${cDate}, ${cYear} at ${fmtClient(startAt)} - ${fmtClient(endAt)} ${tzShort}`;

    const maskedEmailRes = await pool.query(
      'SELECT masked_email FROM masked_emails WHERE id = $1', [booking.mask_id]
    );
    const maskedEmail = maskedEmailRes.rows[0]?.masked_email || booking.invitee_email;

    // Update query
    const joinLink = booking.booking_joining_link || null;
    const google_event_id = booking.google_event_id;
    console.log("Executing UPDATE bookings query...");
    await pool.query(
      `UPDATE bookings
       SET booking_status = 'confirmed', payment_status = 'Paid',
           payment_id = $1, invitee_payment_gateway = 'Razorpay', razorpay_order_id = $2,
           booking_joining_link = $3, google_event_id = $4,
           booking_invitee_time = $5, booking_host_time = $6,
           updated_at = NOW()
       WHERE booking_id = $7`,
      [razorpayPaymentId, razorpayOrderId, joinLink, google_event_id || booking.google_event_id,
       inviteeTime, hostTime, bookingId]
    );

    console.log("SUCCESSFULLY COMPLETED ALL QUERIES!");
    
  } catch(e) {
    console.error("SIMULATION ERROR:", e);
  } finally {
    pool.end();
  }
}

simulate();
