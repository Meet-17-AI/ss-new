const fs = require('fs');

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Regex to find the exact block and replace
  // We want to find the query block and the end of the block

  // 1. Find the query block
  const searchQuery = /const therapistResult = await pool\.query\(\s*'SELECT t\.therapist_id, tr\.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t\.therapist_id = tr\.therapist_id WHERE t\.name ILIKE \$1 ORDER BY tr\.schedule_id DESC NULLS LAST LIMIT 1',\s*\[`%\$\{therapistName\.split\(' '\)\[0\]\}%`\]\s*\);/;
  
  const replaceQuery = `if (therapistName === 'SafeStories') {
              // SafeStories allows all slots
            } else {
              const therapistResult = await pool.query(
                'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
                [therapistName.trim().toLowerCase()]
              );`;
              
  content = content.replace(searchQuery, replaceQuery);

  // 2. Find the catch block and add the else condition
  const searchCatch = /} catch \(err\) \{\s*console\.error\('\[Fetch Slots Filter\] Failed to apply availability rules:', err\);\s*}\s*}\s*}/;
  
  const replaceCatch = `} catch (err) {
                  console.error('[Fetch Slots Filter] Failed to apply availability rules:', err);
                }
              } else {
                console.log(\`[Fetch Slots Filter] Therapist \${therapistName} has no schedule connected. Clearing all slots.\`);
                jsonResponse[0]["Available Slots"] = [];
              }
            }
          }`;

  if (searchCatch.test(content)) {
    content = content.replace(searchCatch, replaceCatch);
    console.log(`Successfully patched ${filePath}`);
    fs.writeFileSync(filePath, content, 'utf8');
  } else {
    console.log(`Could not find catch block in ${filePath}`);
  }
}

patchFile('crm-backend/src/index.ts');
patchFile('server/index.ts');
