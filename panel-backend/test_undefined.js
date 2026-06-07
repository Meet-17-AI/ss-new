const { Client } = require('pg'); 
const client = new Client({ user: 'fluidadmin', host: '72.60.103.151', database: 'ss_clone', password: 'admin123', port: 5432 }); 
client.connect().then(() => 
  client.query(`SELECT invitee_name, invitee_email, invitee_phone FROM bookings WHERE invitee_email = 'undefined' OR invitee_phone = 'undefined' LIMIT 5`)
    .then(res => { console.log(res.rows); client.end(); })
    .catch(e => { console.error('Error:', e.message); client.end(); })
);
