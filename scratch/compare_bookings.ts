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
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'bookings'
    `);
    
    const columns = await pool.query(`
      SELECT column_name, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'bookings' AND column_name = 'invitee_id'
    `);
    
    console.log("=== invitee_id schema ===");
    console.log(columns.rows);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
