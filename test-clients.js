const fetch = require('node-fetch');

async function test() {
  try {
    const res = await fetch('http://localhost:5000/api/clients');
    const data = await res.json();
    console.log(data.data.slice(0, 5).map(c => ({ name: c.invitee_name, type: c.client_type })));
  } catch(e) {
    console.error(e);
  }
}
test();
