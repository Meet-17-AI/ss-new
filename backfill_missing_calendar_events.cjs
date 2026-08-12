/**
 * Backfill Google Calendar events for bookings that never got one.
 *
 * Context: on 2026-08-07 15:46 IST an admin disconnected therapists 59510
 * (Muskan Negi) and 59508 (Indrayani Hinge). Bookings created afterwards were
 * saved to the panel with google_event_id = NULL — they exist for the client and
 * on nobody's calendar. This recreates those events and records the id.
 *
 * PREREQUISITE: the therapist must have reconnected Google Calendar first.
 * Without a refresh token there is no way to write to their calendar, so this
 * script cannot run before the reconnect — that ordering is not optional.
 *
 * DRY RUN BY DEFAULT. It writes to real calendars and the production database,
 * so nothing happens until you pass --apply.
 *
 *   node backfill_missing_calendar_events.cjs             # show what would happen
 *   node backfill_missing_calendar_events.cjs --apply     # actually create
 *   node backfill_missing_calendar_events.cjs --apply 59510
 *
 * Events are created with sendUpdates:'none' (clients are not emailed again) and
 * NAME ONLY — no attendee. The normal booking path attaches a masked address;
 * reproducing that here risks putting a wrong address on a real calendar, and the
 * therapist only needs to see that the session exists.
 */
const { Pool } = require('pg');
const { google } = require('googleapis');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const onlyTherapist = process.argv.slice(2).find(a => !a.startsWith('--')) || null;

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

// Same fallbacks as panel-backend/src/index.ts, so this authenticates exactly
// the way the server does.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '168173993649-2v0jpmi1c4mdkjg70agbret556r7uarm.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
  || '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';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  || 'https://panel.safestories.in/api/auth/google/callback';

function canonicalTherapyLabel(raw) {
  const s = String(raw || '').trim();
  if (/adolescent/i.test(s)) return 'Adolescent Therapy Session';
  if (/couples?/i.test(s)) return 'Couples Therapy Session';
  if (/individual/i.test(s)) return 'Individual Therapy Session';
  return s || 'Session';
}

(async () => {
  console.log(APPLY
    ? '⚠️  APPLY MODE — events will be created and the database updated.\n'
    : 'DRY RUN — nothing will be created. Re-run with --apply to commit.\n');

  const params = [];
  let where = `b.google_event_id IS NULL
     AND b.booking_start_at IS NOT NULL
     AND b.booking_start_at > NOW()
     AND LOWER(COALESCE(b.booking_status,'')) NOT IN ('cancelled','canceled','payment_failed','no_show')`;
  if (onlyTherapist) { params.push(onlyTherapist); where += ` AND b.therapist_id = $1`; }

  const { rows } = await pool.query(`
    SELECT b.booking_id, b.invitee_name, b.therapist_id, b.booking_resource_name,
           b.booking_mode, b.booking_start_at, b.booking_end_at, b.booking_duration,
           b.booking_status, t.name AS therapist_name, t.google_refresh_token,
           t.google_access_token, t.google_token_expiry
    FROM bookings b
    JOIN therapists t ON t.therapist_id = b.therapist_id
    WHERE ${where}
    ORDER BY b.booking_start_at`, params);

  if (rows.length === 0) {
    console.log('Nothing to backfill: no upcoming bookings are missing a calendar event.');
    await pool.end();
    return;
  }

  console.log(`${rows.length} upcoming booking(s) missing a calendar event:\n`);

  const clients = new Map();
  let created = 0, skipped = 0;

  for (const b of rows) {
    const label = canonicalTherapyLabel(b.booking_resource_name);
    const title = `${label} - ${b.invitee_name}`;
    console.log(`• ${b.therapist_name}: "${title}"  ${new Date(b.booking_start_at).toISOString()}`);

    if (!b.google_refresh_token) {
      console.log(`    ⏭  SKIP — ${b.therapist_name} has no Google token. They must reconnect first.\n`);
      skipped++;
      continue;
    }
    if (!APPLY) { console.log('    (dry run)\n'); continue; }

    try {
      if (!clients.has(b.therapist_id)) {
        const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
        oauth.setCredentials({ refresh_token: b.google_refresh_token });
        await oauth.refreshAccessToken();
        clients.set(b.therapist_id, google.calendar({ version: 'v3', auth: oauth }));
      }
      const calendar = clients.get(b.therapist_id);

      const startISO = new Date(b.booking_start_at).toISOString();
      const endISO = b.booking_end_at
        ? new Date(b.booking_end_at).toISOString()
        : new Date(new Date(b.booking_start_at).getTime() + (b.booking_duration || 50) * 60000).toISOString();
      const isOnline = String(b.booking_mode || '').toLowerCase().includes('online');

      const body = {
        summary: title,
        description: `Session via SafeStories.\nClient: ${b.invitee_name}\nMode: ${b.booking_mode || 'online'}\n\n(Recreated by backfill — original event was lost when the calendar was disconnected on 2026-08-07.)`,
        start: { dateTime: startISO, timeZone: 'Asia/Kolkata' },
        end: { dateTime: endISO, timeZone: 'Asia/Kolkata' },
      };
      if (isOnline) {
        body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
      } else {
        body.location = 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040';
      }

      const ev = await calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: isOnline ? 1 : 0,
        sendUpdates: 'none',
        requestBody: body,
      });

      const eventId = ev.data.id;
      const meetLink = isOnline ? (ev.data.hangoutLink || '') : '';

      await pool.query(
        `UPDATE bookings SET google_event_id = $1${meetLink ? ', booking_joining_link = $3' : ''}
         WHERE booking_id = $2`,
        meetLink ? [eventId, b.booking_id, meetLink] : [eventId, b.booking_id]
      );

      console.log(`    ✅ created ${eventId}${meetLink ? ` (meet: ${meetLink})` : ''}\n`);
      created++;
    } catch (e) {
      console.log(`    ❌ FAILED: ${e?.message}\n`);
      skipped++;
    }
  }

  console.log('─'.repeat(60));
  console.log(APPLY ? `Created ${created}, skipped ${skipped}.` : `Dry run: ${rows.length} would be attempted.`);
  await pool.end();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
