const fs = require('fs');
let data = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

const targetStr = `    // Validate required fields
      email,
      phone,
      therapistName: therapistName || 'Safestories',`;

const replaceStr = `    // Validate required fields
    if (!clientName) {
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });
    }

    const webhookData = {
      clientName,
      email,
      phone,
      therapistName: therapistName || 'Safestories',`;

if (data.includes(targetStr)) {
  data = data.replace(targetStr, replaceStr);
  fs.writeFileSync('panel-backend/src/index.ts', data);
  console.log('Fixed successfully.');
} else {
  console.log('Target string not found.');
}
