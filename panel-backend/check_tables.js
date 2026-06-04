require('dotenv').config({ path: '.env.render' });
const { Pool } = require('pg'); 
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); 
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'therapy_services'").then(res => { console.log(res.rows); process.exit(0); }).catch(console.error);
