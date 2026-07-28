require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

async function getCols() {
  try {
    const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'dashboard_api_booking'
    `);
    console.log("Cols:", res.rows.map(r => r.column_name).join(', '));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
getCols();
