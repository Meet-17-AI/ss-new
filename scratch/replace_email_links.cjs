const fs = require('fs');

function replaceInFile(path) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/https:\/\/safestories-dashboard\.vercel\.app\//g, '${process.env.FRONTEND_URL || "https://safestories-dashboard.vercel.app/"}');
  // Need to fix template literals if they weren't already
  content = content.replace(/href="(\$\{process\.env\.FRONTEND_URL[^}]+\})"/g, 'href={`$1`}');
  fs.writeFileSync(path, content);
  console.log(`Replaced links in ${path}`);
}

replaceInFile('api/_lib/email.ts');
replaceInFile('lib/email.ts');
