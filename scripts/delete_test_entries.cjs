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

// Define order to respect Foreign Keys (child tables first)
const orderedTables = [
  'booking_to_lead_mapping',
  'client_therapy_goals',
  'client_session_notes',
  'client_case_history',
  'client_logs',
  'client_transfer_history',
  'payments',
  'bookings',
  'appointment_table',
  'refund_cancellation_table',
  'sos_risk_assessments',
  'sos_access_tokens',
  'therapist_resources',
  'webhook_api_logs',
  'audit_logs',
  'crm_audit_logs',
  'all_clients_table',
  'leads',
  'users'
];

async function deleteTestEntries() {
  const client = new Client(dbConfig);
  await client.connect();

  const nameColumns = ['name', 'first_name', 'last_name', 'full_name', 'client_name', 'therapist_name', 'lead_name', 'invitee_name', 'user_name'];
  
  const schemaRes = await client.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND data_type IN ('character varying', 'text')
  `);

  const tablesToSearch = {};
  for (let row of schemaRes.rows) {
    if (nameColumns.includes(row.column_name) || row.column_name.includes('name')) {
      if (!tablesToSearch[row.table_name]) tablesToSearch[row.table_name] = [];
      tablesToSearch[row.table_name].push(row.column_name);
    }
  }

  // Ensure all unordered tables are appended at the end
  for (const t of Object.keys(tablesToSearch)) {
    if (!orderedTables.includes(t)) {
      orderedTables.push(t);
    }
  }

  let totalDeleted = 0;
  console.log('--- DELETING TEST ENTRIES ---');

  for (const table of orderedTables) {
    if (!tablesToSearch[table]) continue;

    const columns = tablesToSearch[table];
    const conditions = columns.map(c => `"${c}" ILIKE '%test%'`).join(' OR ');
    
    try {
      const res = await client.query(`DELETE FROM "${table}" WHERE ${conditions}`);
      if (res.rowCount > 0) {
        console.log(`Deleted ${res.rowCount} row(s) from ${table}`);
        totalDeleted += res.rowCount;
      }
    } catch (e) {
      console.log(`Failed to delete from ${table}: ${e.message}`);
    }
  }

  console.log(`\nTotal test entries deleted: ${totalDeleted}`);
  await client.end();
}

deleteTestEntries().catch(console.error);
