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
    const bRes = await pool.query("SELECT booking_id, invitee_name, invitee_email, invitee_phone FROM bookings WHERE invitee_email = 'testclient.pendingnotes@example.com' OR invitee_phone LIKE '%9999999999%'");
    console.log('Dummy bookings found:', bRes.rows);
    
    if (bRes.rows.length > 0) {
        console.log("Deleting dummy bookings...");
        await pool.query("DELETE FROM bookings WHERE invitee_email = 'testclient.pendingnotes@example.com' OR invitee_phone LIKE '%9999999999%'");
        console.log("Dummy bookings deleted.");
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
