const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

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
