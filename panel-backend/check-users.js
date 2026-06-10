const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function checkUsers() {
  try {
    const res = await pool.query("SELECT username, password FROM users LIMIT 3");
    for (const row of res.rows) {
      console.log(`User: ${row.username}, Password starts with: ${row.password ? row.password.substring(0, 10) + '...' : 'null'}`);
    }
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

checkUsers();
