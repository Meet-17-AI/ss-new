const fs = require('fs');
const content = fs.readFileSync('server/index.ts', 'utf8');
console.log('Has services:', content.includes("app.get('/api/services'"));
console.log('Has public services:', content.includes("app.get('/api/public/services/:slug'"));
