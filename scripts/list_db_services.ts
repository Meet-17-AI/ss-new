import pool from '../lib/db';

async function listServices() {
  try {
    const res = await pool.query('SELECT id, title, therapist_name, slug FROM therapy_services');
    console.log('Seeded services in DB:');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
listServices();
