import pool from './src/lib/db.js';

pool.query("SELECT slug, duration FROM therapy_services").then(res => {
  console.log(res.rows);
  process.exit();
}).catch(console.error);
