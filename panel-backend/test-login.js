const https = require('https');

const data = JSON.stringify({ username: 'admin', password: 'Admin123' });

const options = {
  hostname: 'safestories-panel.onrender.com',
  port: 443,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, res => {
  console.log(`Status: ${res.statusCode}`);
  let body = '';
  res.on('data', d => { body += d; });
  res.on('end', () => { console.log('Response:', body); });
});

req.on('error', error => { console.error('Error:', error); });
req.write(data);
req.end();
