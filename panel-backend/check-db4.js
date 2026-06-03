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
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'masked_emails';
    `);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
