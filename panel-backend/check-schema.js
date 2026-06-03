require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://safe_stories_user:sDngXN15T8LIfd0LhPq8Z6zNn1Fj9EwQ@dpg-ctg3g8ij1k6c73aq7kcg-a.singapore-postgres.render.com/safe_stories',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'bookings' OR table_name = 'clients';
    `);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
