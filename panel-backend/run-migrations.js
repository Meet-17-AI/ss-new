const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123'
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
