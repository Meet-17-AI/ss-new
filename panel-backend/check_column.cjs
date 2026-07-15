const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'client_type'")
  .then(res => {
    console.log("Client type exists:", res.rows.length > 0);
    process.exit(0);
  })
  .catch(console.error);
