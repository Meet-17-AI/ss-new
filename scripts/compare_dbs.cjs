require('dotenv').config({ path: require('path').resolve(__dirname, '../panel-backend/.env.local') });
const { Client } = require('pg');
const fs = require('fs');

const db1Config = {
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: 'safestories_v2',
  ssl: { rejectUnauthorized: false }
};

const db2Config = {
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: 'safestories_db_v2',
  ssl: { rejectUnauthorized: false }
};

async function getStats(config) {
  const client = new Client(config);
  await client.connect();
  
  const schemaRes = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
  `);
  
  const schema = {};
  for (let row of schemaRes.rows) {
    if (!schema[row.table_name]) schema[row.table_name] = {};
    schema[row.table_name][row.column_name] = row.data_type;
  }
  
  const counts = {};
  for (let table of Object.keys(schema)) {
    try {
      const cRes = await client.query(`SELECT COUNT(*) as count FROM "${table}"`);
      counts[table] = parseInt(cRes.rows[0].count);
    } catch(e) {
      counts[table] = 'Error';
    }
  }
  
  await client.end();
  return { schema, counts };
}

async function run() {
  console.log('Fetching stats for Database 1 (safestories_v2)...');
  const db1 = await getStats(db1Config);
  
  console.log('Fetching stats for Database 2 (safestories_db_v2)...');
  const db2 = await getStats(db2Config);
  
  let report = '# Database Comparison Report\n\n';
  report += 'Comparing **Database 1** (`safestories_v2`) to **Database 2** (`safestories_db_v2`).\n\n';
  
  // Compare Tables
  const db1Tables = Object.keys(db1.schema);
  const db2Tables = Object.keys(db2.schema);
  
  const missingTablesIn1 = db2Tables.filter(t => !db1Tables.includes(t));
  const missingTablesIn2 = db1Tables.filter(t => !db2Tables.includes(t));
  
  report += '## 1. Missing Tables\n\n';
  if (missingTablesIn1.length > 0) {
    report += '### Tables missing in Database 1 (`safestories_v2`):\n';
    missingTablesIn1.forEach(t => report += `- ${t}\n`);
  } else {
    report += 'Database 1 is not missing any tables compared to Database 2.\n';
  }
  report += '\n';
  if (missingTablesIn2.length > 0) {
    report += '### Tables missing in Database 2 (`safestories_db_v2`):\n';
    missingTablesIn2.forEach(t => report += `- ${t}\n`);
  }
  report += '\n';
  
  // Compare Columns
  report += '## 2. Missing Columns in Existing Tables\n\n';
  let hasMissingCols = false;
  
  for (let table of db2Tables) {
    if (db1Tables.includes(table)) {
      const cols1 = Object.keys(db1.schema[table]);
      const cols2 = Object.keys(db2.schema[table]);
      
      const missingIn1 = cols2.filter(c => !cols1.includes(c));
      const missingIn2 = cols1.filter(c => !cols2.includes(c));
      
      if (missingIn1.length > 0 || missingIn2.length > 0) {
        hasMissingCols = true;
        report += `### Table: ${table}\n`;
        if (missingIn1.length > 0) {
          report += `- **Missing in DB 1:** ${missingIn1.join(', ')}\n`;
        }
        if (missingIn2.length > 0) {
          report += `- **Missing in DB 2:** ${missingIn2.join(', ')}\n`;
        }
        report += '\n';
      }
    }
  }
  if (!hasMissingCols) {
    report += 'No missing columns found between matching tables.\n\n';
  }
  
  // Compare Row Counts
  report += '## 3. Data Row Count Comparison\n\n';
  report += '| Table Name | DB 1 (`safestories_v2`) | DB 2 (`safestories_db_v2`) | Difference |\n';
  report += '|---|---|---|---|\n';
  
  const allTables = Array.from(new Set([...db1Tables, ...db2Tables])).sort();
  for (let table of allTables) {
    const c1 = db1.counts[table] !== undefined ? db1.counts[table] : 'N/A';
    const c2 = db2.counts[table] !== undefined ? db2.counts[table] : 'N/A';
    let diff = 'N/A';
    if (typeof c1 === 'number' && typeof c2 === 'number') {
      diff = c2 - c1;
      if (diff > 0) diff = '+' + diff;
    }
    report += `| ${table} | ${c1} | ${c2} | ${diff} |\n`;
  }
  
  fs.writeFileSync('db_comparison_output.md', report);
  console.log('Report generated at db_comparison_output.md');
}

run().catch(console.error);
