import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'panel-backend/.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function createTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id SERIAL PRIMARY KEY,
        booking_id VARCHAR(255),
        automation_type VARCHAR(100),
        recipient VARCHAR(255),
        status VARCHAR(50),
        response_data JSONB,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Successfully created automation_logs table');
  } catch (err) {
    console.error('Error creating table:', err);
  } finally {
    await pool.end();
  }
}

createTable();
