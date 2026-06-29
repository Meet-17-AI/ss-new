const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const q = await pool.query(`
      SELECT ts.*, (t.google_refresh_token IS NOT NULL) as google_calendar_connected, s.availability
      FROM therapy_services ts
      LEFT JOIN therapists t ON ts.therapist_id = t.therapist_id
      LEFT JOIN therapist_schedules s ON ts.schedule_id = s.schedule_id
      ORDER BY ts.therapist_name, ts.title
    `);
    const safestories = q.rows.filter(r => r.therapist_id === 'SafeStories');
    console.log('Total returned:', q.rows.length);
    console.log('SafeStories returned:', safestories);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
