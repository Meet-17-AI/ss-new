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
    await pool.query(`ALTER TABLE therapist_schedules ALTER COLUMN therapist_id TYPE text`);
    console.log('Altered successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

run();
