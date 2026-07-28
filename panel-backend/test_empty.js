require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Client } = require('pg'); 
const client = new Client({ user: process.env.PGUSER, host: process.env.PGHOST, database: 'ss_clone', password: process.env.PGPASSWORD, port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT invitee_email, invitee_name FROM bookings WHERE invitee_phone = '' OR invitee_phone IS NULL LIMIT 5`)
    .then(res => { console.log('Empty phone bookings:', res.rows); client.end(); })
    .catch(e => { console.error('Error:', e.message); client.end(); })
);
