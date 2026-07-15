const { Client } = require('pg');

const dbConfig = {
  host: '72.60.103.151',
  port: 5432,
  user: 'fluidadmin',
  password: 'admin123',
  database: 'safestories_db_v2',
  ssl: { rejectUnauthorized: false }
};

async function cleanupRemaining() {
  const client = new Client(dbConfig);
  await client.connect();

  try {
    // 1. Delete client_doc_form linked to test bookings
    console.log('Cleaning client_doc_form...');
    const res1 = await client.query(`
      DELETE FROM client_doc_form 
      WHERE booking_id IN (
        SELECT booking_id FROM bookings 
        WHERE invitee_name ILIKE '%test%' 
           OR booking_host_name ILIKE '%test%'
           OR booking_resource_name ILIKE '%test%'
      )
    `);
    console.log(`Deleted ${res1.rowCount} from client_doc_form`);

    // 2. Retry bookings
    console.log('Cleaning bookings...');
    const res2 = await client.query(`
      DELETE FROM bookings 
      WHERE invitee_name ILIKE '%test%' 
         OR booking_host_name ILIKE '%test%'
         OR booking_resource_name ILIKE '%test%'
    `);
    console.log(`Deleted ${res2.rowCount} from bookings`);

    // 3. Retry appointment_table
    console.log('Cleaning appointment_table...');
    const res3 = await client.query(`
      DELETE FROM appointment_table 
      WHERE session_name ILIKE '%test%' 
         OR client_name ILIKE '%test%'
         OR therapist_name ILIKE '%test%'
    `);
    console.log(`Deleted ${res3.rowCount} from appointment_table`);

    // 4. Retry all_clients_table
    console.log('Cleaning all_clients_table...');
    const res4 = await client.query(`
      DELETE FROM all_clients_table 
      WHERE client_name ILIKE '%test%'
    `);
    console.log(`Deleted ${res4.rowCount} from all_clients_table`);

    // 5. Retry sos_access_tokens
    console.log('Cleaning sos_access_tokens...');
    const res5 = await client.query(`
      DELETE FROM sos_access_tokens 
      WHERE client_name ILIKE '%test%'
    `);
    console.log(`Deleted ${res5.rowCount} from sos_access_tokens`);

  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  await client.end();
}

cleanupRemaining().catch(console.error);
