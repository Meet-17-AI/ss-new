require('dotenv').config({ path: require('path').resolve(__dirname, '../panel-backend/.env.local') });
const { Client } = require('pg');

const dbConfig = {
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: 'safestories_db_v2', // Assuming the live database
  ssl: { rejectUnauthorized: false }
};

async function findTestEntries() {
  const client = new Client(dbConfig);
  await client.connect();

  const nameColumns = ['name', 'first_name', 'last_name', 'full_name', 'client_name', 'therapist_name'];
  
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

  let totalFound = 0;
  console.log('--- TEST ENTRIES FOUND ---');
  for (const [table, columns] of Object.entries(tablesToSearch)) {
    const conditions = columns.map(c => `"${c}" ILIKE '%test%'`).join(' OR ');
    try {
      const res = await client.query(`SELECT * FROM "${table}" WHERE ${conditions}`);
      if (res.rows.length > 0) {
        console.log(`\nTable: ${table} (${res.rows.length} rows)`);
        res.rows.forEach(row => {
          const display = columns.map(c => `${c}: ${row[c]}`).filter(d => !d.endsWith('null') && !d.endsWith('undefined')).join(', ');
          console.log(`  - ID: ${row.id || 'N/A'} | ${display}`);
        });
        totalFound += res.rows.length;
      }
    } catch (e) {
      // ignore tables that can't be queried or don't have standard id
    }
  }

  console.log(`\nTotal test entries found: ${totalFound}`);
  await client.end();
}

findTestEntries().catch(console.error);
