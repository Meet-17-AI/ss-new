const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'src', 'index.ts');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. Add URL Shortener logic after app.use(express.json());
const expressJson = "app.use(express.json());";
const urlShortenerCode = `
// Helper function for URL shortener
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createShortUrl(longUrl) {
  const code = generateShortCode();
  await pool.query('INSERT INTO short_urls (short_code, long_url) VALUES ($1, $2)', [code, longUrl]);
  return code;
}

// Redirect shortened URLs
app.get('/r/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query('SELECT long_url FROM short_urls WHERE short_code = $1', [code]);
    if (result.rows.length > 0) {
      res.redirect(302, result.rows[0].long_url);
    } else {
      res.status(404).send('Link not found');
    }
  } catch (err) {
    console.error('Error redirecting short URL:', err);
    res.status(500).send('Server Error');
  }
});
`;

if (!content.includes('generateShortCode()')) {
  content = content.replace(expressJson, expressJson + '\n' + urlShortenerCode);
}

// 2. Google Calendar Delete
const cancelBookingOriginal = `    // 2. Natively cancel booking in the database
    await pool.query(
      \`UPDATE bookings SET booking_status = 'cancelled', booking_cancel_reason = $1, invitee_cancelled_at = NOW() 
       WHERE booking_id = $2\`,
      [reason || null, booking_id]
    );

    // 3. Trigger automations`;

const cancelBookingNew = `    // 2. Natively cancel booking in the database
    await pool.query(
      \`UPDATE bookings SET booking_status = 'cancelled', booking_cancel_reason = $1, invitee_cancelled_at = NOW() 
       WHERE booking_id = $2\`,
      [reason || null, booking_id]
    );

    // 3. Delete from Google Calendar if event exists
    const googleEventId = bookingDetails.google_event_id;
    const cancelHostId = bookingDetails.booking_host_calendar_id || bookingDetails.therapist_id;
    
    if (googleEventId && cancelHostId) {
      try {
        const tokenRes = await pool.query('SELECT google_calendar_tokens FROM users WHERE id = $1', [cancelHostId]);
        if (tokenRes.rows.length > 0 && tokenRes.rows[0].google_calendar_tokens) {
          const tokens = typeof tokenRes.rows[0].google_calendar_tokens === 'string' 
            ? JSON.parse(tokenRes.rows[0].google_calendar_tokens) 
            : tokenRes.rows[0].google_calendar_tokens;
            
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
          );
          oauth2Client.setCredentials(tokens);
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          
          await calendar.events.delete({
            calendarId: 'primary',
            eventId: googleEventId
          });
          console.log(\`[Cancel Booking] Successfully deleted Google Calendar event \${googleEventId}\`);
        }
      } catch (calErr) {
        console.error('[Cancel Booking] Failed to delete Google Calendar event:', calErr);
      }
    }

    // 4. Trigger automations`;

if (content.includes(cancelBookingOriginal)) {
  content = content.replace(cancelBookingOriginal, cancelBookingNew);
} else {
  console.log("Could not find cancel booking original string");
}

// 3. Capture Event ID in createBooking
const createBookingOriginal = `        const calendarEvent = await calendar.events.insert({
          calendarId: 'primary',
          conferenceDataVersion: isOnline ? 1 : 0,
          requestBody: eventBody
        });

        if (isOnline) {
          meetLink = calendarEvent.data.hangoutLink || '';
        }
        hasCalendar = true;
        console.log(\`[Create Booking] Successfully created Google Calendar event. \${isOnline ? 'Meet Link: ' + meetLink : 'In-person with location'}\`);
      } catch (calendarError) {
        console.error('❌ Failed creating booking via Google Calendar:', calendarError);
      }
    }

    const publicBookingCheckinUrl = \`\${origin}/booking-confirmation/\${booking_id}\`;`;

const createBookingNew = `        const calendarEvent = await calendar.events.insert({
          calendarId: 'primary',
          conferenceDataVersion: isOnline ? 1 : 0,
          requestBody: eventBody
        });

        const google_event_id = calendarEvent.data.id || null;
        payload.google_event_id = google_event_id;

        if (isOnline) {
          meetLink = calendarEvent.data.hangoutLink || '';
        }
        hasCalendar = true;
        console.log(\`[Create Booking] Successfully created Google Calendar event. \${isOnline ? 'Meet Link: ' + meetLink : 'In-person with location'}\`);
      } catch (calendarError) {
        console.error('❌ Failed creating booking via Google Calendar:', calendarError);
      }
    }

    const originalCheckinUrl = \`\${origin}/booking-confirmation/\${booking_id}\`;
    const shortCode = await createShortUrl(originalCheckinUrl);
    const publicBookingCheckinUrl = \`\${origin}/r/\${shortCode}\`;`;

if (content.includes(createBookingOriginal)) {
  content = content.replace(createBookingOriginal, createBookingNew);
} else {
  console.log("Could not find create booking original string");
}

// 4. Save google_event_id to DB
const insertBookingOriginal = `      \`INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, booking_host_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, booking_joining_link, mask_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)\`,
      [
        booking_id,
        invitee_id,
        'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        payload.therapyName || 'Session',
        startAt.toISOString(),
        endAt.toISOString(),
        inviteeTime,
        hostTime,
        payload.paymentDetails?.amount || 0,
        'INR',
        'confirmed',
        publicBookingCheckinUrl,
        therapistName,
        therapistId,
        isOnline ? 'Online Video Call' : 'In Person (Pune)',
        hasCalendar && isOnline ? meetLink : null,
        payload.clientMaskId || null
      ]`;

const insertBookingNew = `      \`INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, booking_host_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, booking_joining_link, mask_id, google_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)\`,
      [
        booking_id,
        invitee_id,
        'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        payload.therapyName || 'Session',
        startAt.toISOString(),
        endAt.toISOString(),
        inviteeTime,
        hostTime,
        payload.paymentDetails?.amount || 0,
        'INR',
        'confirmed',
        publicBookingCheckinUrl,
        therapistName,
        therapistId,
        isOnline ? 'Online Video Call' : 'In Person (Pune)',
        hasCalendar && isOnline ? meetLink : null,
        payload.clientMaskId || null,
        payload.google_event_id || null
      ]`;

if (content.includes(insertBookingOriginal)) {
  content = content.replace(insertBookingOriginal, insertBookingNew);
} else {
  console.log("Could not find insert booking original string");
}

// Let's also do it for the manual booking (addBooking endpoint) which might have another INSERT INTO bookings
// Wait, the API for addBooking might be different. Let's just run it.

fs.writeFileSync(indexPath, content, 'utf8');
console.log('index.ts patched successfully');
