const { Pool } = require('pg');

const databases = ['safestories_db', 'safestories_db_v2', 'safestories_v2', 'ss_db_2', 'ss_clone'];

async function searchMuskan() {
  for (const db of databases) {
    const pool = new Pool({
      host: '72.60.103.151',
      port: 5432,
      database: db,
      user: 'fluidadmin',
      password: 'admin123'
    });

    try {
      const res = await pool.query("SELECT * FROM therapists WHERE name ILIKE '%muskan%' OR name ILIKE '%2%'");
      if (res.rows.length > 0) {
        console.log(`\n--- Found in database: ${db} ---`);
        console.log(res.rows);
      }
    } catch (err) {
      if (err.code !== '42P01') { // Ignore relation "therapists" does not exist
        console.error(`Error in DB ${db}:`, err.message);
      }
    } finally {
      await pool.end();
    }
  }
}

searchMuskan();
