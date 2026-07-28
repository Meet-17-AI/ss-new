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

async function findTherapist() {
  try {
    const name = 'Ishika Mahajan';
    console.log(`Searching for therapist: ${name}`);

    const userResult = await pool.query(
      `SELECT id, name, full_name, role, therapist_id FROM users WHERE name ILIKE $1 OR full_name ILIKE $1`,
      [`%Ishika%`]
    );
    console.log('\n--- USERS MATCHES ---');
    console.table(userResult.rows);

    const therapistResult = await pool.query(
      `SELECT * FROM therapists WHERE name ILIKE $1`,
      [`%Ishika%`]
    );
    console.log('\n--- THERAPISTS MATCHES ---');
    console.table(therapistResult.rows);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

findTherapist();
