import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables:", res.rows.map(r => r.table_name));
    
    // Check global settings or admin tables
    const adminRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'admin_settings' OR table_name = 'admins' OR table_name = 'settings'
    `);
    console.log("\nAdmin/Settings columns:", adminRes.rows.map(r => r.table_name + '.' + r.column_name));

    const thRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'therapists'
    `);
    console.log("\nTherapists columns:", thRes.rows.map(r => r.column_name));
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
