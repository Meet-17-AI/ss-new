import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS therapist_schedules (
        id SERIAL PRIMARY KEY,
        schedule_id INT UNIQUE NOT NULL, 
        therapist_id INT,
        name VARCHAR(255),
        time_zone VARCHAR(100) DEFAULT 'Asia/Calcutta',
        availability JSONB DEFAULT '[]',
        date_overrides JSONB DEFAULT '[]',
        exclusions JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('Successfully created therapist_schedules table.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating table:', err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
