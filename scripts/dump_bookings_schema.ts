import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Safestories_345$#@72.60.103.151:5432/safestories_db' });

async function dump() {
  const res = await pool.query(`SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'bookings'`);
  console.table(res.rows);
  await pool.end();
}

dump();
