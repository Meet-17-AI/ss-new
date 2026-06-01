const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.oyjofbndvmdsnnnmyrvz:D868TjUu23Qy0yK0@aws-0-ap-south-1.pooler.supabase.com:6543/postgres' });
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'").then(res => {
  console.log(res.rows.map(r => r.column_name).join('\n'));
  process.exit();
}).catch(console.error);
