require('dotenv').config({ path: '.env.render' });
const { Pool } = require('pg'); 
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); 
pool.query(`
  ALTER TABLE therapy_services 
  ADD COLUMN IF NOT EXISTS form_questions JSONB,
  ADD COLUMN IF NOT EXISTS requires_tnc BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_payment_enabled BOOLEAN DEFAULT true
`).then(res => { 
  console.log("Columns added successfully."); 
  process.exit(0); 
}).catch(e => { 
  console.error(e); 
  process.exit(1); 
});
