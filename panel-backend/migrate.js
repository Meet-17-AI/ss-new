const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function migrate() {
  try {
    const res = await pool.query('SELECT max(notification_id) FROM notifications;');
    const maxId = res.rows[0].max;
    console.log("Max ID:", maxId);
    if (maxId) {
      await pool.query(`SELECT setval('notifications_notification_id_seq', ${maxId + 1});`);
      console.log("Sequence synced.");
    }
  } catch (error) {
    console.error("Migration error:", error);
  } finally {
    pool.end();
  }
}

migrate();
