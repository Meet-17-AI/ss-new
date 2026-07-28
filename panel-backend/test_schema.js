require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Client } = require('pg'); 
const client = new Client({ user: process.env.PGUSER, host: process.env.PGHOST, database: 'ss_clone', password: process.env.PGPASSWORD, port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'`)
    .then(res => { console.log(res.rows.map(r => r.column_name)); client.end(); })
    .catch(e => { console.error('Error:', e.message); client.end(); })
);
