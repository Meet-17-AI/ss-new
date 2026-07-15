const { Client } = require('pg');

const dbConfig = {
  host: '72.60.103.151',
  port: 5432,
  user: 'fluidadmin',
  password: 'admin123',
  database: 'safestories_db_v2',
  ssl: { rejectUnauthorized: false }
};

async function checkLast() {
  const client = new Client(dbConfig);
  await client.connect();

  try {
    const res = await client.query("DELETE FROM bookings WHERE booking_resource_name LIKE '%Test Calendar%'");
    console.log("Success: " + res.rowCount);
  } catch (e) {
    console.log("Error: " + e.message);
  }

  await client.end();
}

checkLast().catch(console.error);
