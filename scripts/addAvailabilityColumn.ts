import pool from '../lib/db';

async function addAvailabilityColumn() {
  const client = await pool.connect();
  try {
    console.log('Adding availability column to therapists table...');
    
    // Add availability column as JSONB if it does not exist
    await client.query(`
      ALTER TABLE therapists 
      ADD COLUMN IF NOT EXISTS availability JSONB;
    `);
    
    console.log('Successfully added availability column to therapists table.');
  } catch (error) {
    console.error('Error adding availability column:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

addAvailabilityColumn();
