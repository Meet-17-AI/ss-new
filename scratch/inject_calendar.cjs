const fs = require('fs');
const file = 'panel-backend/src/index.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('async function getAuthenticatedClient')) {
  const getAuthClientCode = `
async function getAuthenticatedClient(therapist: any) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: therapist.google_refresh_token,
    access_token: therapist.google_access_token,
    expiry_date: therapist.google_token_expiry ? new Date(therapist.google_token_expiry).getTime() : undefined
  });

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    if (credentials.access_token) {
      const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3500 * 1000);
      await pool.query(
        \`UPDATE therapists SET google_access_token = $1, google_token_expiry = $2 WHERE therapist_id = $3\`,
        [credentials.access_token, expiryDate, therapist.therapist_id]
      );
    }
  } catch (e) {
    console.error('Failed to refresh token, using existing', e);
  }
  return oauth2Client;
}
`;
  // Inject before app.post('/api/auth/google/disconnect'
  code = code.replace("app.post('/api/auth/google/disconnect'", getAuthClientCode + "\napp.post('/api/auth/google/disconnect'");
}

const calendarImport = "import { randomUUID } from 'crypto';\n";
if (!code.includes('randomUUID')) {
  code = calendarImport + code;
}

const calendarInject = `
    let hasCalendar = false;
    let meetLink = '';
    
    if (therapist && therapist.google_refresh_token) {
      console.log(\`[Create Booking] Therapist \${therapist.name} has Google Calendar connected. Creating Event.\`);
      try {
        const oauth2Client = await getAuthenticatedClient(therapist);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const isOnline = payload.sessionMode === 'online';

        const eventBody: any = {
          summary: \`\${payload.therapyName} - \${payload.clientName}\`,
          description: \`Therapy session booked via SafeStories.\\nClient: \${payload.clientName}\\nClient Email: \${payload.clientEmail}\\nSession Mode: \${payload.sessionMode || 'online'}\\nNotes: \${payload.notes || 'None'}\`,
          start: {
            dateTime: startAt.toISOString(),
            timeZone: 'Asia/Kolkata'
          },
          end: {
            dateTime: endAt.toISOString(),
            timeZone: 'Asia/Kolkata'
          },
          attendees: [
            { email: payload.clientEmail }
          ]
        };

        if (isOnline) {
          eventBody.conferenceData = {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: {
                type: 'hangoutsMeet'
              }
            }
          };
        } else {
          // In-person: add office location with Google Maps link
          eventBody.location = 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv';
        }

        const calendarEvent = await calendar.events.insert({
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
`;

const targetInsert = `const publicBookingCheckinUrl = \`\${origin}/booking-confirmation/\${booking_id}\`;`;
if (!code.includes(calendarInject.trim().split('\\n')[0])) {
  code = code.replace(targetInsert, calendarInject + "\n    " + targetInsert);
}

// Update the database insert to include meeting link
const targetSQL = `INSERT INTO bookings (
        booking_id, invitee_name, invitee_email, invitee_phone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;
const newSQL = `INSERT INTO bookings (
        booking_id, invitee_name, invitee_email, invitee_phone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, booking_joining_link
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
code = code.replace(targetSQL, newSQL);

const targetValues = `therapistId
      ]
    );`;
const newValues = `therapistId,
        payload.sessionMode === 'online' ? 'Online' : 'Offline',
        meetLink
      ]
    );`;
code = code.replace(targetValues, newValues);

fs.writeFileSync(file, code);
console.log('Injected calendar logic');
