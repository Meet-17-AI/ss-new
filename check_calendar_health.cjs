/**
 * Calendar health check — READ-ONLY diagnostic.
 *
 * Reports, per therapist, whether the Google grant still works and what the
 * calendar actually returns. Deliberately does NOT use getAuthenticatedClient()
 * from the server: that function now clears dead tokens as a side effect, and a
 * diagnostic must never mutate the state it is measuring. Nothing here writes to
 * the database.
 *
 * Usage:
 *   node check_calendar_health.cjs              # every therapist with a token
 *   node check_calendar_health.cjs 59509        # one therapist
 */
const { Pool } = require('pg');
const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

// PG* names, matching panel-backend/src/lib/db.ts. (The older check_*.cjs
// scripts in this repo use DB_* names that nothing sets — they silently connect
// to nowhere.)
const required = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const missing = required.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('❌ Missing database env vars:', missing.join(', '));
  console.error('   Run this from a directory with a filled-in .env.local (see .env.example).');
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

const onlyTherapist = process.argv[2] || null;

// Must mirror panel-backend/src/index.ts exactly, fallbacks included. GOOGLE_*
// is absent from .env.example, so the server usually runs on these literals —
// reading only process.env here would hand the OAuth client `undefined`, and
// every therapist would come back "invalid_client" regardless of token health.
// That would be a false alarm, not a diagnosis.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '168173993649-2v0jpmi1c4mdkjg70agbret556r7uarm.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
  || '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';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
  || 'https://panel.safestories.in/api/auth/google/callback';

console.log(`Using client_id ...${CLIENT_ID.slice(-28)}`);
console.log(`Source: ${process.env.GOOGLE_CLIENT_ID ? 'environment' : 'hardcoded fallback in index.ts'}`);

function oauthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function checkOne(t) {
  console.log('\n' + '='.repeat(64));
  console.log(`${t.name}  (id: ${t.therapist_id})`);
  console.log(`  account : ${t.contact_info || '(none)'}`);
  console.log(`  expiry  : ${t.google_token_expiry || '(none)'}`);

  const client = oauthClient();
  client.setCredentials({
    refresh_token: t.google_refresh_token,
    access_token: t.google_access_token,
    expiry_date: t.google_token_expiry ? new Date(t.google_token_expiry).getTime() : undefined,
  });

  // 1. Can the refresh token still mint an access token?
  try {
    await client.refreshAccessToken();
    console.log('  TOKEN   : ✅ refresh OK');
  } catch (e) {
    const reason = String(e?.response?.data?.error || e?.message || '');
    if (reason.includes('invalid_grant')) {
      console.log('  TOKEN   : ❌ DEAD (invalid_grant) — therapist must reconnect');
    } else {
      console.log(`  TOKEN   : ⚠️  refresh failed, but NOT invalid_grant → ${reason}`);
      console.log('            (transient or credential problem — token itself may be fine)');
    }
    return;
  }

  const calendar = google.calendar({ version: 'v3', auth: client });
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // 2. What the booking flow actually relies on: freebusy on 'primary'.
  try {
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }],
      },
    });
    const busy = fb.data.calendars?.primary?.busy || [];
    console.log(`  FREEBUSY: ${busy.length} busy block(s) in the next 7 days`);
    busy.slice(0, 5).forEach(b => console.log(`            ${b.start} → ${b.end}`));
  } catch (e) {
    console.log(`  FREEBUSY: ❌ ${e?.message}`);
  }

  // 3. Cross-check against real events. A calendar with events but ZERO busy
  //    blocks means the events are marked "Free" (transparency) or live on a
  //    secondary calendar — freebusy on 'primary' cannot see either, and the
  //    booking flow would treat the therapist as fully available.
  try {
    const ev = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });
    const items = ev.data.items || [];
    console.log(`  EVENTS  : ${items.length} event(s) on 'primary'`);
    items.slice(0, 5).forEach(e =>
      console.log(`            [${e.transparency || 'opaque/busy'}] ${e.summary} — ${e.start?.dateTime || e.start?.date}`)
    );
    if (items.length > 0) {
      const opaque = items.filter(e => e.transparency !== 'transparent').length;
      if (opaque === 0) console.log('            ⚠️  every event is "Free" — freebusy will report nothing busy');
    }
  } catch (e) {
    console.log(`  EVENTS  : ❌ ${e?.message}`);
  }

  // 4. Which calendars exist — catches "sessions are on a secondary calendar".
  try {
    const list = await calendar.calendarList.list();
    const cals = list.data.items || [];
    if (cals.length > 1) {
      console.log(`  CALENDARS: ${cals.length} total (code only ever queries 'primary')`);
      cals.forEach(c => console.log(`            ${c.primary ? '*' : ' '} ${c.summary}`));
    }
  } catch (e) {
    console.log(`  CALENDARS: ❌ ${e?.message}`);
  }
}

(async () => {
  try {
    const sql = onlyTherapist
      ? `SELECT therapist_id, name, contact_info, google_refresh_token, google_access_token, google_token_expiry
         FROM therapists WHERE therapist_id = $1`
      : `SELECT therapist_id, name, contact_info, google_refresh_token, google_access_token, google_token_expiry
         FROM therapists WHERE google_refresh_token IS NOT NULL ORDER BY name`;

    const res = await pool.query(sql, onlyTherapist ? [onlyTherapist] : []);
    if (res.rows.length === 0) {
      console.log('No therapists with a stored Google refresh token.');
      return;
    }
    console.log(`Checking ${res.rows.length} therapist(s). READ-ONLY — nothing is modified.`);
    for (const t of res.rows) {
      if (!t.google_refresh_token) {
        console.log(`\n${t.name} (${t.therapist_id}): no refresh token stored — not connected.`);
        continue;
      }
      await checkOne(t);
    }
    console.log('\n' + '='.repeat(64));
  } catch (e) {
    console.error('Fatal:', e);
  } finally {
    await pool.end();
  }
})();
