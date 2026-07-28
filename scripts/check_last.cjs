require('dotenv').config({ path: require('path').resolve(__dirname, '../panel-backend/.env.local') });
const { Client } = require('pg');

const dbConfig = {
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
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
