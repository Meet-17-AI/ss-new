require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'ss_clone',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
