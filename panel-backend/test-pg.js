const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function testUndefined() {
  try {
    const val = undefined;
    const res = await pool.query("SELECT 1 WHERE 1 = $1", [val]);
    console.log(res.rows);
  } catch(e) {
    console.error("ERROR CAUGHT:", e.message);
  } finally {
    pool.end();
  }
}

testUndefined();
