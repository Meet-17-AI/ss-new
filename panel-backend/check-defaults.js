const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function getDefaults() {
  try {
    const res = await pool.query(`
      SELECT column_name, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'payments'
    `);
    console.log("Cols:", res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
getDefaults();
