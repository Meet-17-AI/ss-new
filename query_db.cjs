const { Pool } = require('pg');

const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123'
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
