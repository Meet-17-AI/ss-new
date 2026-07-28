require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'ss_clone',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const sql = fs.readFileSync('migrations/updates.sql', 'utf8');
    await pool.query(sql);
    console.log('Migration successful');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await pool.end();
  }
}
run();
