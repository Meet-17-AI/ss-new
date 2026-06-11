const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function getPaymentCols() {
  try {
    const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'payments'
    `);
    console.log("Payments Table:", res.rows.map(r => r.column_name).join(', '));

    const res2 = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'bookings'
    `);
    console.log("Bookings Table:", res2.rows.map(r => r.column_name).join(', '));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

getPaymentCols();
