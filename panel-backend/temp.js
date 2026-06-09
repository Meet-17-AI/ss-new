const { Pool } = require('pg');

const pool = new Pool({
  host: '72.60.103.151',
  port: 5432,
  database: 'ss_clone',
  user: 'fluidadmin',
  password: 'admin123'
});

async function main() {
  try {
    const res = await pool.query("SELECT title, charges FROM therapy_services ORDER BY title");
    console.log("Here is the list of services and their prices:");
    res.rows.forEach(r => {
      console.log(`- ${r.title}: ${r.charges}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
main();
