const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function check() {
  try {
    const res = await pool.query(`SELECT therapist_id, google_refresh_token, google_access_token, google_token_expiry FROM therapists WHERE therapist_id = '59509'`);
    if (res.rows.length === 0) return console.log('Ambika not found');
    const therapist = res.rows[0];
    
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: therapist.google_refresh_token,
      access_token: therapist.google_access_token,
      expiry_date: therapist.google_token_expiry ? new Date(therapist.google_token_expiry).getTime() : undefined
    });
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const timeMin = '2026-07-15T00:00:00+05:30';
    const timeMax = '2026-07-22T23:59:59+05:30';
    
    console.log('--- Free/Busy ---');
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        items: [{ id: 'primary' }]
      }
    });
    console.log(JSON.stringify(fb.data.calendars?.primary?.busy, null, 2));
    
    console.log('--- Events ---');
    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    events.data.items?.forEach(e => {
        console.log(`- [${e.transparency || 'Opaque (Busy)'}] ${e.summary}: ${e.start?.dateTime} to ${e.end?.dateTime}`);
    });
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
check();
