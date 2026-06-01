import pool from './src/lib/db.js';

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'").then(res => {
  console.log(res.rows.map(r => r.column_name));
  process.exit();
}).catch(console.error);
