const { Pool } = require('pg');
require('dotenv').config({ path: '../panel-backend/.env.local' });

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

async function run() {
  try {
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash('Safestories123', 10);
    
    // Check if user exists
    const userCheck = await pool.query(`SELECT * FROM users WHERE username = 'Safestories'`);
    let userId;
    
    if (userCheck.rows.length > 0) {
      console.log('User already exists, updating password and role...');
      userId = userCheck.rows[0].id;
      await pool.query(
        `UPDATE users SET password = $1, role = 'therapist', therapist_id = 'SafeStories' WHERE id = $2`,
        [hashedPassword, userId]
      );
    } else {
      console.log('Creating new user...');
      const userRes = await pool.query(
        `INSERT INTO users (username, password, name, full_name, email, role, is_active, therapist_id)
         VALUES ('Safestories', $1, 'Safestories', 'Safestories', 'safestories@safestories.in', 'therapist', true, 'SafeStories')
         RETURNING id`,
        [hashedPassword]
      );
      userId = userRes.rows[0].id;
    }
    
    console.log('User created/updated with ID:', userId);
    
    // Check if therapist exists
    const therapistCheck = await pool.query(`SELECT * FROM therapists WHERE name = 'SafeStories' OR name = 'Safestories'`);
    if (therapistCheck.rows.length === 0) {
      console.log('Creating therapist record...');
      await pool.query(
        `INSERT INTO therapists (therapist_id, name, specialization, experience, contact_info, is_active)
         VALUES ('SafeStories', 'SafeStories', 'Platform Therapist', 'Platform', 'safestories@safestories.in', true)`
      );
    } else {
      console.log('Therapist record already exists. Linking not required because users table holds therapist_id.');
    }
    
    console.log('Successfully created/updated Safestories therapist!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

run();
