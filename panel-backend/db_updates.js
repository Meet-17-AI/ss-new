const pool = require('./src/lib/db').default;

async function run() {
  console.log("Starting DB migration...");
  
  // 1. Create payment_settings table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id SERIAL PRIMARY KEY,
      active_gateway VARCHAR(50) DEFAULT 'razorpay',
      razorpay_key_id VARCHAR(100),
      razorpay_key_secret VARCHAR(100),
      cashfree_app_id VARCHAR(100),
      cashfree_secret_key VARCHAR(100),
      cashfree_environment VARCHAR(50) DEFAULT 'sandbox'
    );
  `);
  console.log("Created payment_settings table.");

  // Insert default row if empty
  const res = await pool.query('SELECT COUNT(*) FROM payment_settings');
  if (parseInt(res.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO payment_settings (active_gateway) VALUES ('razorpay')
    `);
    console.log("Inserted default payment_settings row.");
  }

  // 2. Add therapy_type to therapy_services if it doesn't exist
  try {
    await pool.query(`
      ALTER TABLE therapy_services
      ADD COLUMN therapy_type VARCHAR(100)
    `);
    console.log("Added therapy_type to therapy_services.");
  } catch (err) {
    if (err.code === '42701') {
      console.log("therapy_type column already exists in therapy_services.");
    } else {
      throw err;
    }
  }

}

run()
  .then(() => {
    console.log("Migration complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  });
