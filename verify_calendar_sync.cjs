/**
 * Calendar sync audit — READ-ONLY.
 *
 * Answers, with evidence rather than inference:
 *   1. Which therapists have a working Google connection right now
 *   2. Do the events the panel THINKS it created actually exist on Google
 *   3. Where the panel and Google disagree about a session's time
 *      (a reschedule that never reached the calendar looks exactly like this)
 *   4. Which upcoming bookings have no calendar event at all
 *   5. Whether free/busy returns usable data for slot generation
 *
 * Nothing in here writes to the database or to any calendar.
 */
const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const required = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const missing = required.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('❌ Missing database env vars:', missing.join(', '));
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '168173993649-2v0jpmi1c4mdkjg70agbret556r7uarm.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
  || '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';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  || 'https://panel.safestories.in/api/auth/google/callback';

const fmt = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

(async () => {
  const { rows: therapists } = await pool.query(
    `SELECT therapist_id, name, contact_info, google_refresh_token
     FROM therapists WHERE COALESCE(is_active,true) ORDER BY name`);

  const summary = [];

  for (const t of therapists) {
    console.log('\n' + '='.repeat(70));
    console.log(`${t.name}  (${t.therapist_id})  ${t.contact_info || ''}`);

    // booking_start_at is `timestamp WITHOUT time zone` holding UTC wall-clock.
    // node-postgres parses a naked timestamp in the process's local zone, which
    // on an IST machine shifts every value by 5:30 and makes every booking look
    // rescheduled. Force an explicit UTC ISO string so the comparison is real.
    const { rows: bookings } = await pool.query(
      `SELECT booking_id, invitee_name,
              to_char(booking_start_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_utc,
              booking_duration, google_event_id, booking_status
       FROM bookings
       WHERE therapist_id = $1 AND booking_start_at > NOW()
         AND LOWER(COALESCE(booking_status,'')) NOT IN ('cancelled','canceled','payment_failed','no_show')
       ORDER BY booking_start_at`, [t.therapist_id]);

    const withEvent = bookings.filter(b => b.google_event_id);
    const withoutEvent = bookings.filter(b => !b.google_event_id);

    if (!t.google_refresh_token) {
      console.log('  CONNECTION : ❌ NOT CONNECTED (no refresh token)');
      console.log(`  BOOKINGS   : ${bookings.length} upcoming, ${withoutEvent.length} with NO calendar event`);
      withoutEvent.forEach(b => console.log(`               • ${b.invitee_name} — ${fmt(b.start_utc)}`));
      summary.push({ name: t.name, conn: 'NOT CONNECTED', upcoming: bookings.length, missing: withoutEvent.length, mismatched: '-', orphaned: '-' });
      continue;
    }

    let calendar;
    try {
      const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth.setCredentials({ refresh_token: t.google_refresh_token });
      await oauth.refreshAccessToken();
      calendar = google.calendar({ version: 'v3', auth: oauth });
      console.log('  CONNECTION : ✅ token refreshes automatically');
    } catch (e) {
      const reason = String(e?.response?.data?.error || e?.message || '');
      console.log(`  CONNECTION : ❌ REFRESH FAILED — ${reason}`);
      summary.push({ name: t.name, conn: 'REFRESH FAILED', upcoming: bookings.length, missing: withoutEvent.length, mismatched: '?', orphaned: '?' });
      continue;
    }

    // Free/busy — what slot generation depends on.
    try {
      const fb = await calendar.freebusy.query({
        requestBody: {
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + 14 * 864e5).toISOString(),
          items: [{ id: 'primary' }],
        },
      });
      const busy = fb.data.calendars?.primary?.busy || [];
      console.log(`  FREE/BUSY  : ✅ ${busy.length} busy block(s) over next 14 days`);
    } catch (e) {
      console.log(`  FREE/BUSY  : ❌ ${e?.message}`);
    }

    // Does each stored event actually exist, and at the time the panel believes?
    let mismatched = 0, orphaned = 0, ok = 0;
    for (const b of withEvent) {
      try {
        const ev = await calendar.events.get({ calendarId: 'primary', eventId: b.google_event_id });
        if (ev.data.status === 'cancelled') {
          console.log(`  ⚠️  DELETED ON GOOGLE: ${b.invitee_name} — panel says ${fmt(b.start_utc)}`);
          orphaned++;
          continue;
        }
        const gStart = new Date(ev.data.start?.dateTime || ev.data.start?.date).getTime();
        const pStart = new Date(b.start_utc).getTime();
        if (Math.abs(gStart - pStart) > 60000) {
          console.log(`  ⚠️  TIME MISMATCH: ${b.invitee_name}`);
          console.log(`         panel : ${fmt(pStart)}`);
          console.log(`         google: ${fmt(gStart)}   ← reschedule did not reach the calendar`);
          mismatched++;
        } else ok++;
      } catch (e) {
        if (e?.code === 404 || e?.response?.status === 404) {
          console.log(`  ⚠️  MISSING ON GOOGLE: ${b.invitee_name} — event ${b.google_event_id} not found`);
          orphaned++;
        } else {
          console.log(`  ❌ check failed for ${b.invitee_name}: ${e?.message}`);
        }
      }
    }

    console.log(`  BOOKINGS   : ${bookings.length} upcoming`);
    console.log(`               ✅ ${ok} in sync`);
    if (mismatched) console.log(`               ⚠️  ${mismatched} time mismatch`);
    if (orphaned) console.log(`               ⚠️  ${orphaned} missing/deleted on Google`);
    if (withoutEvent.length) {
      console.log(`               ❌ ${withoutEvent.length} with NO calendar event`);
      withoutEvent.forEach(b => console.log(`                  • ${b.invitee_name} — ${fmt(b.start_utc)}`));
    }

    summary.push({ name: t.name, conn: 'OK', upcoming: bookings.length, missing: withoutEvent.length, mismatched, orphaned });
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('therapist                 connection      upcoming  no-event  mismatch  orphan');
  summary.forEach(s => console.log(
    `${s.name.padEnd(25)} ${String(s.conn).padEnd(15)} ${String(s.upcoming).padStart(8)} ${String(s.missing).padStart(9)} ${String(s.mismatched).padStart(9)} ${String(s.orphaned).padStart(7)}`
  ));
  await pool.end();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
