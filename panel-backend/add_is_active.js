require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log('Adding is_active column to therapists table...');
    await pool.query('ALTER TABLE therapists ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;');
    console.log('Column added successfully.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

run();
