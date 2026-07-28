require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

async function checkData() {
  try {
    const res = await pool.query("SELECT * FROM therapist_schedules LIMIT 1");
    if (res.rows.length > 0) {
      console.log('Sample therapist_schedules row:');
      console.log(JSON.stringify(res.rows[0], null, 2));
    } else {
      console.log('No rows in therapist_schedules');
    }
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkData();
