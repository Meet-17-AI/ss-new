const { Pool } = require('pg');
const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123'
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
