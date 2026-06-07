const fs = require('fs');
const file = 'c:/Meet/New folder (2)/SafestoriesPanel/panel-backend/src/index.ts';
let content = fs.readFileSync(file, 'utf8');

const helperCode = `
// Helper function to process successful payments
async function processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload) {
  // 3. Resolve therapist (for Google Calendar)
  const therapistName = payload.therapistName || booking.booking_host_name || 'Unknown Therapist';
  let therapistId = payload.therapistId || booking.therapist_id || null;
  let therapist = null;
  if (therapistName !== 'SafeStories' && therapistName !== 'Unknown Therapist') {
    const qParam = therapistId ? therapistId : \`%\${therapistName.split(' ')[0]}%\`;
    const qStr = therapistId
      ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
      : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
    const tRes = await pool.query(qStr, [qParam]);
    if (tRes.rows.length > 0) { therapist = tRes.rows[0]; therapistId = therapist.therapist_id; }
  }

  // 4. Build time strings from stored booking dates
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
  const hostTime = \`\${dayName}, \${monthName} \${dateNum}, \${yearNum} at \${startTimeStr} - \${endTimeStr} IST\`;

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
  const inviteeTime = \`\${cDay}, \${cMonth} \${cDate}, \${cYear} at \${fmtClient(startAt)} - \${fmtClient(endAt)} \${tzShort}\`;

  const maskedEmailRes = await pool.query(
    'SELECT masked_email FROM masked_emails WHERE id = $1', [booking.mask_id]
  );
  const maskedEmail = maskedEmailRes.rows[0]?.masked_email || booking.invitee_email;

  // 5. Create Google Calendar event (best-effort)
  let hasCalendar = false;
  let meetLink = '';
  let google_event_id = null;
  if (therapist && therapist.google_refresh_token) {
    try {
      const oauth2Client = await getAuthenticatedClient(therapist);
      const { google } = require('googleapis');
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const isOnline = (payload.sessionMode || '') === 'online' ||
                       booking.booking_mode?.toLowerCase().includes('online');
      const eventBody = {
        summary: \`\${payload.therapyName || booking.booking_resource_name} - \${payload.clientName || booking.invitee_name}\`,
        description: \`Session via SafeStories.\\nClient: \${payload.clientName || booking.invitee_name}\\nEmail: \${maskedEmail}\\nMode: \${payload.sessionMode || 'online'}\\nNotes: \${payload.notes || 'None'}\`,
        start: { dateTime: startAt.toISOString(), timeZone: 'Asia/Kolkata' },
        end:   { dateTime: endAt.toISOString(),   timeZone: 'Asia/Kolkata' },
        attendees: [{ email: maskedEmail }]
      };
      if (isOnline) {
        eventBody.conferenceData = {
          createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
        };
      } else {
        eventBody.location = 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv';
      }
      const calEvent = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: isOnline ? 1 : 0,
        requestBody: eventBody
      });
      google_event_id = calEvent.data.id || null;
      if (isOnline) meetLink = calEvent.data.hangoutLink || '';
      hasCalendar = true;
    } catch (calErr) {
      console.error('[verify-payment] Google Calendar event creation failed:', calErr);
    }
  }

  // 6. Update booking: confirmed + payment info
  const joinLink = (hasCalendar && (payload.sessionMode === 'online' || booking.booking_mode?.toLowerCase().includes('online')))
    ? meetLink : (booking.booking_joining_link || null);
  await pool.query(
    \`UPDATE bookings
     SET booking_status = 'confirmed', payment_status = 'Paid',
         payment_id = $1, invitee_payment_gateway = 'Razorpay', razorpay_order_id = $2,
         booking_joining_link = $3, google_event_id = $4,
         booking_invitee_time = $5, booking_host_time = $6,
         updated_at = NOW()
     WHERE booking_id = $7\`,
    [razorpayPaymentId, razorpayOrderId, joinLink, google_event_id || booking.google_event_id,
     inviteeTime, hostTime, bookingId]
  );

  const clientName  = payload.clientName  || booking.invitee_name;
  const clientEmail = payload.clientEmail || booking.invitee_email;
  const clientPhone = payload.clientWhatsApp || booking.invitee_phone;
  const therapyName = payload.therapyName  || booking.booking_resource_name;
  const sessionMode = payload.sessionMode  || 'online';
  const checkinUrl  = booking.public_booking_checkin_url;

  // 7. Send confirmation emails (best-effort)
  try {
    await sendClientBookingConfirmationEmail(clientEmail, {
      clientName,
      inviteeTimeStr: inviteeTime,
      sessionName: therapyName,
      dateStr: \`\${dayName}, \${monthName} \${dateNum}, \${yearNum}\`,
      timeRangeStr: \`\${startTimeStr} - \${endTimeStr}\`,
      duration: 50,
      joinLink: hasCalendar ? meetLink : sessionMode,
      checkinUrl,
      calendarStartRaw: startAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      calendarEndRaw:   endAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    });
    await pool.query(
      \`INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)\`,
      [bookingId, 'client_confirmation_email', clientEmail, 'success', JSON.stringify({ sent: true })]
    );
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@safestories.in';
    await sendAdminBookingConfirmationEmail(adminEmail, {
      clientName, clientPhone, clientEmail,
      sessionName: therapyName, sessionTiming: hostTime, sessionMode: sessionMode,
      therapistName, therapistEmail: therapist?.contact_info || 'Not available'
    });
  } catch (emailErr) {
    console.error('[verify-payment] Email send failed:', emailErr);
  }

  // 8. Send WhatsApp confirmation (best-effort)
  try {
    const { sendBookingConfirmedClient } = await import('./automations/whatsapp.js');
    await sendBookingConfirmedClient(bookingId, clientPhone, clientName, therapyName, inviteeTime, checkinUrl);
    await pool.query(
      \`INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)\`,
      [bookingId, 'client_confirmation_whatsapp', clientPhone, 'success', JSON.stringify({ sent: true })]
    );
  } catch (waErr) {
    console.error('[verify-payment] WhatsApp send failed:', waErr);
  }

  // 9. Internal new-booking webhook for CRM pipeline movement
  try {
    const port = process.env.PORT || 3002;
    await fetch(\`http://localhost:\${port}/api/webhooks/new-booking\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId })
    });
  } catch (e) {
    console.error('[verify-payment] Internal webhook failed:', e);
  }

  console.log(\`[verify-payment] ✅ Booking \${bookingId} confirmed. Payment: \${razorpayPaymentId}\`);
}

app.post('/api/razorpay/verify-payment', async (req, res) => {
  const { bookingId, razorpayPaymentId, razorpayOrderId, razorpaySignature, ...payload } = req.body;
  try {
    // 1. Check booking exists and is still pending
    const bookingCheck = await pool.query(
      \`SELECT * FROM bookings WHERE booking_id = $1 AND booking_status = 'payment_pending'\`,
      [bookingId]
    );
    if (bookingCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Booking not found or already processed' });
    }
    const booking = bookingCheck.rows[0];

    // 2. Verify Razorpay HMAC-SHA256 signature
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }
    const crypto = require('crypto');
    const generated = crypto
      .createHmac('sha256', keyRows[0].razorpay_key_secret)
      .update(\`\${razorpayOrderId}|\${razorpayPaymentId}\`)
      .digest('hex');
    if (generated !== razorpaySignature) {
      console.error(\`[verify-payment] Signature mismatch for booking \${bookingId}\`);
      return res.status(400).json({ error: 'Payment verification failed – invalid signature' });
    }

    await processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload);

    res.json({ success: true, booking_id: bookingId });
  } catch (error) {
    console.error('❌ Error in verify-payment:', error);
    res.status(500).json({ error: error.message || 'Payment verification failed' });
  }
});

// API for cron job to verify pending payments
app.post('/api/cron/verify-pending-payments', async (req, res) => {
  try {
    console.log('[CRON] Starting 15-minute Razorpay pending payment verification...');
    
    // Get razorpay keys
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }

    const razorpay = new Razorpay({
      key_id: keyRows[0].razorpay_key_id,
      key_secret: keyRows[0].razorpay_key_secret,
    });

    // Find bookings that have been pending for > 15 mins and < 60 mins
    const pendingBookings = await pool.query(\`
      SELECT * FROM bookings 
      WHERE booking_status = 'payment_pending' 
      AND razorpay_order_id IS NOT NULL
      AND created_at <= NOW() - INTERVAL '15 minutes'
      AND created_at >= NOW() - INTERVAL '60 minutes'
    \`);

    let confirmedCount = 0;
    let failedCount = 0;

    for (const booking of pendingBookings.rows) {
      try {
        const orderId = booking.razorpay_order_id;
        // Fetch payments for this order
        const payments = await razorpay.orders.fetchPayments(orderId);
        
        // Check if there is any successful payment (captured or authorized)
        const successfulPayment = payments.items.find(p => p.status === 'captured' || p.status === 'authorized');
        
        if (successfulPayment) {
          console.log(\`[CRON] Found successful payment \${successfulPayment.id} for order \${orderId}\`);
          await processConfirmedBooking(
            booking.booking_id, 
            successfulPayment.id, 
            orderId, 
            booking, 
            {} // Empty payload, falls back to booking row data
          );
          confirmedCount++;
        } else {
          // No successful payment found after 15 mins -> Fail the booking and release slot
          console.log(\`[CRON] Order \${orderId} has no successful payments. Marking as Failed.\`);
          await pool.query(
            \`UPDATE bookings
             SET booking_status = 'Failed', payment_status = 'Failed', updated_at = NOW()
             WHERE booking_id = $1 AND booking_status = 'payment_pending'\`,
            [booking.booking_id]
          );
          failedCount++;
        }
      } catch (err) {
        console.error(\`[CRON] Error verifying order \${booking.razorpay_order_id}:\`, err.message);
      }
    }

    res.json({ success: true, confirmedCount, failedCount });
  } catch (error) {
    console.error('[CRON] Error in verify-pending-payments:', error);
    res.status(500).json({ error: error.message });
  }
});
`;

// Replace from 'app.post('/api/razorpay/verify-payment', ...' up to its end.
const startMarker = "app.post('/api/razorpay/verify-payment', async (req, res) => {";
const endMarker = "app.get('/api/payment-settings/public', async (req, res) => {";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + helperCode + "\n" + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log("Successfully patched index.ts");
} else {
  console.log("Could not find markers.");
}
