require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

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
