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

async function deleteTestTherapist() {
  const email = 'shobhit@fluid.live';
  const username = email.split('@')[0]; // 'shobhit'
  
  try {
    console.log(`Deleting test therapist: ${email}`);
    
    // Check and delete from users table first
    const userResult = await pool.query(
      `SELECT * FROM users WHERE LOWER(username) = LOWER($1)`,
      [username]
    );
    
    if (userResult.rows.length > 0) {
      console.log(`Found user: ${userResult.rows[0].username}, therapist_id: ${userResult.rows[0].therapist_id}`);
      
      const therapistId = userResult.rows[0].therapist_id;
      
      // Delete from users table
      await pool.query(
        `DELETE FROM users WHERE LOWER(username) = LOWER($1)`,
        [username]
      );
      console.log('✅ Deleted from users table');
      
      // Delete from therapists table if therapist_id exists
      if (therapistId) {
        await pool.query(
          `DELETE FROM therapists WHERE therapist_id = $1`,
          [therapistId]
        );
        console.log('✅ Deleted from therapists table');
      }
    } else {
      console.log('⚠️ User not found in users table');
    }
    
    // Reset the new_therapist_requests status back to pending
    const requestResult = await pool.query(
      `UPDATE new_therapist_requests 
       SET status = 'pending' 
       WHERE LOWER(email) = LOWER($1) 
       RETURNING request_id`,
      [email]
    );
    
    if (requestResult.rows.length > 0) {
      console.log(`✅ Reset request ${requestResult.rows[0].request_id} status to 'pending'`);
    } else {
      console.log('⚠️ No request found to reset');
    }
    
    console.log('\n✨ Cleanup complete! You can now test the profile completion again.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

deleteTestTherapist();
