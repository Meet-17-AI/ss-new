const { Pool } = require('pg');
const pool = new Pool({ host: '72.60.103.151', port: 5432, database: 'ss_clone', user: 'fluidadmin', password: 'admin123' });

async function alterPaymentsTable() {
  try {
    await pool.query(`
      ALTER TABLE payments 
      ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50),
      ADD COLUMN IF NOT EXISTS utr VARCHAR(255),
      ADD COLUMN IF NOT EXISTS failure_reason TEXT,
      ADD COLUMN IF NOT EXISTS customer_details JSONB;
    `);
    console.log("Successfully altered payments table!");
  } catch(e) {
    console.error("Error altering table:", e);
  } finally {
    pool.end();
  }
}

alterPaymentsTable();
