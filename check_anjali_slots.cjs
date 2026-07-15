const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });
const moment = require('moment-timezone');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function getAuthenticatedClient(therapist) {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2Client.setCredentials({ refresh_token: therapist.google_refresh_token });
  return oAuth2Client;
}

async function checkSlots() {
  try {
    const res = await pool.query(`SELECT therapist_id, name, google_refresh_token FROM therapists WHERE name ILIKE '%Anjali%'`);
    if (res.rows.length === 0) return console.log('Anjali not found');
    const t = res.rows[0];
    
    const dateStr = '2026-07-17';
    const url = `http://localhost:3002/api/fetch-slots`;
    console.log('Fetching:', url, 'for', t.therapist_id, dateStr);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTherapy: 'Individual Therapy',
        selectedTherapist: 'Anjali Pillai',
        selectedDate: dateStr,
        isFreeConsultation: false,
        timezone: 'Asia/Kolkata',
        isDirectBooking: false,
        isAdmin: false
      })
    });
    
    if (!response.ok) {
        console.log('Error HTTP status:', response.status);
        console.log(await response.text());
        return;
    }
    const data = await response.json();
    console.log('Response JSON:', JSON.stringify(data, null, 2));
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkSlots();
