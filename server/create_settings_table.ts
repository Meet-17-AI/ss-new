import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        setting_key VARCHAR(255) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Insert default values if not present
    await pool.query(`
      INSERT INTO admin_settings (setting_key, setting_value) 
      VALUES 
        ('active_gateway', 'razorpay'),
        ('razorpay_key_id', $1)
      ON CONFLICT (setting_key) DO NOTHING;
    `, [process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder']);

    console.log("Table admin_settings created and populated.");
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
