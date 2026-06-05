const { Client } = require('pg'); 
const client = new Client({ user: 'fluidadmin', host: '72.60.103.151', database: 'ss_clone', password: 'admin123', port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'`)
    .then(res => { console.log(res.rows.map(r => r.column_name)); client.end(); })
    .catch(e => { console.error('Error:', e.message); client.end(); })
);
