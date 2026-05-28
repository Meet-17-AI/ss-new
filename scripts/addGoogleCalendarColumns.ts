import pool from '../lib/db';

async function addGoogleCalendarColumns() {
  const client = await pool.connect();
  try {
    console.log('Adding Google Calendar columns to therapists table...');
    
    // Add columns if they do not exist
    await client.query(`
      ALTER TABLE therapists 
      ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
      ADD COLUMN IF NOT EXISTS google_access_token TEXT,
      ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP WITH TIME ZONE;
    `);
    
    console.log('Successfully added Google Calendar columns to therapists table.');
  } catch (error) {
    console.error('Error adding columns:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

addGoogleCalendarColumns();
