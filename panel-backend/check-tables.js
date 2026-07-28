require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.PGHOST, port: 5432, database: 'ss_clone', user: process.env.PGUSER, password: process.env.PGPASSWORD });

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
