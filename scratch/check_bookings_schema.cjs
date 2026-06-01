const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://fluidadmin:admin123@72.60.103.151:5432/ss_clone' });

pool.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'bookings'").then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit();
});
