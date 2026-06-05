const fs = require('fs');

function patchPanelBackend(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  const searchQuery = /const therapistResult = await pool\.query\(\s*'SELECT t\.therapist_id, tr\.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t\.therapist_id = tr\.therapist_id WHERE t\.name ILIKE \$1 ORDER BY tr\.schedule_id DESC NULLS LAST LIMIT 1',\s*\[`%\$\{therapistName\.split\(' '\)\[0\]\}%`\]\s*\);/;
  
  const replaceQuery = `const therapistResult = await pool.query(
        'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
        [therapistName.trim().toLowerCase()]
      );`;
              
  if (searchQuery.test(content)) {
    content = content.replace(searchQuery, replaceQuery);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Successfully patched ${filePath}`);
  } else {
    console.log(`Could not find query block in ${filePath}`);
  }
}

patchPanelBackend('panel-backend/src/index.ts');
