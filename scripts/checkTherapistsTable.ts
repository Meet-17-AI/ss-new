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

async function checkTherapistsTable() {
  try {
    console.log('Checking therapists table structure...\n');
    
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'therapists'
      ORDER BY ordinal_position;
    `);
    
    console.log('Columns in therapists table:');
    console.log('─'.repeat(60));
    result.rows.forEach(row => {
      console.log(`${row.column_name.padEnd(30)} ${row.data_type.padEnd(20)} ${row.is_nullable}`);
    });
    console.log('─'.repeat(60));
    
    // Check if specialization_details column exists
    const hasSpecDetails = result.rows.some(row => row.column_name === 'specialization_details');
    
    if (!hasSpecDetails) {
      console.log('\n⚠️  WARNING: specialization_details column is MISSING!');
      console.log('This column is needed for the profile completion to work.');
      console.log('\nTo add it, run:');
      console.log('ALTER TABLE therapists ADD COLUMN specialization_details TEXT;');
    } else {
      console.log('\n✅ specialization_details column exists');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkTherapistsTable();
