import * as dotenv from 'dotenv';
dotenv.config({ path: 'panel-backend/.env.local' });
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  database: 'safestories_db',
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function checkReportIssues() {
  try {
    console.log('Checking report_issues table...\n');
    
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'report_issues'
      );
    `);
    
    console.log('Table exists:', tableCheck.rows[0].exists);
    
    if (tableCheck.rows[0].exists) {
      // Get table structure
      console.log('\n--- Table Structure ---');
      const structure = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'report_issues'
        ORDER BY ordinal_position;
      `);
      console.table(structure.rows);
      
      // Get count of records
      const count = await pool.query('SELECT COUNT(*) FROM report_issues');
      console.log('\n--- Total Records ---');
      console.log('Count:', count.rows[0].count);
      
      // Get all records
      if (parseInt(count.rows[0].count) > 0) {
        console.log('\n--- All Records ---');
        const records = await pool.query(`
          SELECT * FROM report_issues 
          ORDER BY created_at DESC
        `);
        console.table(records.rows);
      } else {
        console.log('\nNo records found in report_issues table.');
      }
    } else {
      console.log('\n❌ Table does not exist in the database!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

checkReportIssues();
