require('dotenv').config({ path: require('path').resolve(__dirname, '../panel-backend/.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'ss_clone',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function checkData() {
  try {
    const res = await pool.query('SELECT name, is_active FROM therapists WHERE is_active = false');
    console.log(res.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkData();
