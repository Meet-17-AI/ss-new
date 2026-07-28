require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });
const { Client } = require('pg'); 
const client = new Client({ user: process.env.PGUSER, host: process.env.PGHOST, database: 'ss_clone', password: process.env.PGPASSWORD, port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT *, invitee_payment_amount AS payment_amount FROM bookings WHERE (booking_status = 'payment_pending' OR payment_status = 'Pending') AND invitee_payment_amount IS NOT NULL AND invitee_payment_amount > 0 ORDER BY created_at DESC LIMIT 1`)
    .then(res => { console.log(res.rows); client.end(); })
    .catch(e => { console.error('Error 2:', e.message); client.end(); })
);
