const { Client } = require('pg'); 
const client = new Client({ user: 'fluidadmin', host: '72.60.103.151', database: 'ss_clone', password: 'admin123', port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT *, invitee_payment_amount AS payment_amount FROM bookings WHERE (booking_status = 'payment_pending' OR payment_status = 'Pending') AND invitee_payment_amount IS NOT NULL AND invitee_payment_amount > 0 ORDER BY created_at DESC LIMIT 1`)
    .then(res => { console.log(res.rows); client.end(); })
    .catch(e => { console.error('Error 2:', e.message); client.end(); })
);
