require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Client } = require('pg'); 
const client = new Client({ user: process.env.PGUSER, host: process.env.PGHOST, database: 'ss_clone', password: process.env.PGPASSWORD, port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT *, invitee_name, booking_resource_name, payment_amount, payment_status FROM dashboard_api_booking WHERE payment_amount IS NOT NULL AND payment_amount > 0 AND payment_status = 'Completed' ORDER BY created_at DESC LIMIT 1`)
    .then(res => { console.log(res.rows); client.end(); })
    .catch(e => { console.error('Error 1:', e.message); client.end(); })
);
