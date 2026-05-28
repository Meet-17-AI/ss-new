const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('dist') && !file.includes('.git')) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('.');
const linkRegex = /href=["'](http[^"']+)["']/g;
const toRegex = /to=["']([^"']+)["']/g;

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    console.log(f + ' (href): ' + match[1]);
  }
  while ((match = toRegex.exec(content)) !== null) {
    console.log(f + ' (to): ' + match[1]);
  }
});
