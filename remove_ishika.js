import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local' });

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_DATABASE,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  ssl: false
});

async function removeIshika() {
  try {
    const res = await pool.query(`SELECT * FROM users WHERE LOWER(name) LIKE '%ishika mahajan%' OR LOWER(full_name) LIKE '%ishika mahajan%'`);
    console.log('Users found:', res.rows);
    
    for (const user of res.rows) {
      console.log('Deleting user:', user.name);
      
      await pool.query('DELETE FROM auth_tokens WHERE user_id = $1', [user.id]);
      await pool.query('DELETE FROM therapist_resources WHERE therapist_id = $1', [user.therapist_id]);
      await pool.query('DELETE FROM therapist_therapies WHERE therapist_id = $1', [user.therapist_id]);
      await pool.query('DELETE FROM therapists WHERE therapist_id = $1', [user.therapist_id]);
      
      await pool.query('UPDATE bookings SET therapist_id = NULL WHERE therapist_id = $1', [user.therapist_id]);
      
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
