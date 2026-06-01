const fs = require('fs');
let data = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

const regex = / {4}\/\/ Validate required fields\r?\n {6}email,\r?\n {6}phone,\r?\n {6}therapistName: therapistName \|\| 'Safestories',/;

const replaceStr = `    // Validate required fields
    if (!clientName) {
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });
    }

    const webhookData = {
      clientName,
      email,
      phone,
      therapistName: therapistName || 'Safestories',`;

if (regex.test(data)) {
  data = data.replace(regex, replaceStr);
  fs.writeFileSync('panel-backend/src/index.ts', data);
  console.log('Fixed successfully.');
} else {
  console.log('Regex target not found.');
}
