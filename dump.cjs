const fs = require('fs');
const lines = fs.readFileSync('panel-backend/src/index.ts', 'utf8').split('\n');
const idx = lines.findIndex(l => l.includes("app.get('/api/services',"));
if(idx !== -1) {
  console.log(lines.slice(idx, idx+20).join('\n'));
} else {
  console.log('Not found');
}
