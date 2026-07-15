const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function check() {
  try {
    const res = await pool.query(`SELECT therapist_id, name, google_refresh_token FROM therapists WHERE name ILIKE '%Anjali%'`);
    if (res.rows.length === 0) {
      console.log('Anjali not found');
      return;
    }
    const t = res.rows[0];
    console.log('Found:', t.name, t.therapist_id);
    
    // Now get her schedule
    const sRes = await pool.query(`SELECT * FROM therapist_schedules WHERE therapist_id = $1`, [t.therapist_id]);
    console.log('Schedules:', JSON.stringify(sRes.rows, null, 2));
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
check();
