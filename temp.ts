import { pool } from './server/db.ts';

async function removeIshika() {
  try {
    const res = await pool.query(`SELECT * FROM users WHERE LOWER(name) LIKE '%ishika mahajan%' OR LOWER(full_name) LIKE '%ishika mahajan%'`);
    console.log('Users found:', res.rows);
    
    for (const user of res.rows) {
      console.log('Deleting user:', user.name);
      
      // Delete from auth_tokens
      await pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [user.id]);
      
      // Delete from therapist_resources
      await pool.query('DELETE FROM therapist_resources WHERE therapist_id = $1', [user.therapist_id]);
      
      // Delete from therapist_therapies
      await pool.query('DELETE FROM therapist_therapies WHERE therapist_id = $1', [user.therapist_id]);
      
      // Delete from therapists
      await pool.query('DELETE FROM therapists WHERE therapist_id = $1', [user.therapist_id]);
      
      // Delete from bookings where this user is the therapist
      // Might want to just update them or delete. Let's update them to NULL therapist_id or delete.
      // Wait, deleting bookings might fail if there are dependencies. Let's just update therapist_id to NULL.
      await pool.query('UPDATE bookings SET therapist_id = NULL WHERE therapist_id = $1', [user.therapist_id]);
      
      // Finally, delete from users
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
      console.log('Successfully deleted', user.name);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

removeIshika();
