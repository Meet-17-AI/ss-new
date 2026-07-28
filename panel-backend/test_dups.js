require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Client } = require('pg'); 
const client = new Client({ user: process.env.PGUSER, host: process.env.PGHOST, database: 'ss_clone', password: process.env.PGPASSWORD, port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT invitee_email, COUNT(*) FROM bookings GROUP BY invitee_email ORDER BY COUNT(*) DESC LIMIT 5`)
    .then(res => { console.log('Top Emails:', res.rows); return client.query(`SELECT invitee_phone, COUNT(*) FROM bookings GROUP BY invitee_phone ORDER BY COUNT(*) DESC LIMIT 5`); })
    .then(res => { console.log('Top Phones:', res.rows); client.end(); })
    .catch(e => { console.error('Error:', e.message); client.end(); })
);
