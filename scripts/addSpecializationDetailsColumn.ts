import * as dotenv from 'dotenv';
dotenv.config({ path: 'panel-backend/.env.local' });
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'safestories_db',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function addSpecializationDetailsColumn() {
  try {
    console.log('Adding specialization_details column to therapists table...\n');
    
    await pool.query(`
      ALTER TABLE therapists 
      ADD COLUMN IF NOT EXISTS specialization_details TEXT;
    `);
    
    console.log('✅ Column added successfully!');
    console.log('\nVerifying...');
    
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'therapists' AND column_name = 'specialization_details';
    `);
    
    if (result.rows.length > 0) {
      console.log(`✅ Confirmed: specialization_details column exists (${result.rows[0].data_type})`);
    } else {
      console.log('❌ Column not found after adding');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

addSpecializationDetailsColumn();
