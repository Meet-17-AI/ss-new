import pool from '../lib/db';

async function listTherapists() {
  try {
    const res = await pool.query('SELECT therapist_id, name, specialization FROM therapists');
    console.log('Therapists in DB:');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
listTherapists();
