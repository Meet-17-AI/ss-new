import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function run() {
  try {
    const triggers = await pool.query(`
      SELECT trigger_name, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'bookings'
    `);
    
    console.log("=== bookings triggers ===");
    console.log(triggers.rows);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
