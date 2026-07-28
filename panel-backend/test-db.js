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
    const res = await pool.query("SELECT column_name, is_generated, generation_expression FROM information_schema.columns WHERE table_name = 'masked_emails'");
    console.log("masked_emails columns:", res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
