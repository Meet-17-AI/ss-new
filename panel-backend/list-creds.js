require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

async function listUsers() {
  try {
    const res = await pool.query("SELECT username, password, role FROM users ORDER BY role, username");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

listUsers();
