import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const pool = new Pool({
  host: process.env.PGHOST || process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'safestories_db',
  user: process.env.PGUSER || 'fluidadmin',
  password: process.env.PGPASSWORD || process.env.PGPASSWORD,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: false,
});

async function addSessionTypeColumn() {
  console.log('='.repeat(80));
  console.log('ADDING SESSION_TYPE COLUMN TO CLIENT_DOC_FORM');
  console.log('='.repeat(80));

  try {
    // Step 1: Add session_type column (increased size to hold full booking names)
    console.log('\n1. Adding session_type column...');
    await pool.query(`
      ALTER TABLE client_doc_form 
      ADD COLUMN IF NOT EXISTS session_type VARCHAR(255)
    `);
    console.log('✅ Column added successfully');

    // Step 2: Add paperform_submission_id column if not exists
    console.log('\n2. Adding paperform_submission_id column...');
    await pool.query(`
      ALTER TABLE client_doc_form 
      ADD COLUMN IF NOT EXISTS paperform_submission_id VARCHAR(255)
    `);
    console.log('✅ Column added successfully');

    // Step 3: Copy exact booking_resource_name to session_type
    console.log('\n3. Copying booking_resource_name to session_type...');
    const updateResult = await pool.query(`
      UPDATE client_doc_form cdf
      SET session_type = b.booking_resource_name
      FROM bookings b
      WHERE cdf.booking_id = b.booking_id
        AND cdf.session_type IS NULL
    `);
    console.log(`✅ Updated ${updateResult.rowCount} records`);

    // Step 4: Create index for performance
    console.log('\n4. Creating index on session_type...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_client_doc_form_session_type 
      ON client_doc_form(session_type)
    `);
    console.log('✅ Index created successfully');

    // Step 5: Verify the update
    console.log('\n5. Verifying session_type distribution...');
    const verification = await pool.query(`
      SELECT 
        session_type,
        COUNT(*) as count
      FROM client_doc_form
      GROUP BY session_type
      ORDER BY count DESC
    `);
    
    console.log('\nSession type distribution:');
    verification.rows.forEach((row: any) => {
      console.log(`  ${(row.session_type || 'NULL').padEnd(25)} ${row.count} records`);
    });

    // Step 6: Show sample records
    console.log('\n6. Sample records with session_type:');
    const samples = await pool.query(`
      SELECT 
        cdf.link_id,
        cdf.booking_id,
        cdf.session_type,
        cdf.status,
        b.booking_resource_name
      FROM client_doc_form cdf
      LEFT JOIN bookings b ON cdf.booking_id = b.booking_id
      ORDER BY cdf.link_id DESC
      LIMIT 5
    `);
    
    samples.rows.forEach((row: any) => {
      console.log(`\n  Link ID: ${row.link_id}`);
      console.log(`    Booking: ${row.booking_id}`);
      console.log(`    Session Type: ${row.session_type || 'NULL'}`);
      console.log(`    Status: ${row.status || 'NULL'}`);
      console.log(`    Resource Name: ${row.booking_resource_name || 'NULL'}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));

  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the migration
addSessionTypeColumn().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
