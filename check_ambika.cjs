const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });

async function run() {
  try {
    const tRes = await pool.query("SELECT therapist_id, name, google_refresh_token FROM therapists WHERE name ILIKE '%ambika%'");
    if (tRes.rows.length > 0) {
      console.log('Therapist:', tRes.rows[0].name, 'Has Token:', !!tRes.rows[0].google_refresh_token);
      
      const scheduleRes = await pool.query(
        "SELECT tr.schedule_id, ts.availability FROM therapist_resources tr JOIN therapist_schedules ts ON tr.schedule_id = ts.schedule_id WHERE tr.therapist_id = $1", 
        [tRes.rows[0].therapist_id]
      );
      console.log('Schedules:', JSON.stringify(scheduleRes.rows, null, 2));
    } else {
      console.log('No therapist named Ambika found');
    }
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
