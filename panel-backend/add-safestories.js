require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://safe_stories_user:sDngXN15T8LIfd0LhPq8Z6zNn1Fj9EwQ@dpg-ctg3g8ij1k6c73aq7kcg-a.singapore-postgres.render.com/safe_stories',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await pool.query("INSERT INTO therapists (name, contact_info) VALUES ('SafeStories', 'Free Consultation') ON CONFLICT DO NOTHING");
    console.log('SafeStories added to therapists.');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

run();
