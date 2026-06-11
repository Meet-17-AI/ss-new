const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

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
