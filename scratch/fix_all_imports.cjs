const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.endsWith('.ts')) {
      const filePath = path.join(dir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      content = content.replace(/\.\.\/lib\//g, './lib/');
      fs.writeFileSync(filePath, content);
    }
  }
}

processDir(path.join(__dirname, '../crm-backend/src'));
processDir(path.join(__dirname, '../panel-backend/src'));

console.log("Fixed all imports in src/*.ts");
