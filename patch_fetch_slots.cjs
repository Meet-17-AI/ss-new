const fs = require('fs');

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace the query logic and add the empty slots fallback
  const searchBlock = `          if (therapistName) {
            const therapistResult = await pool.query(
              'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE t.name ILIKE $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
              [\`%\${therapistName.split(' ')[0]}%\`]
            );
            
            if (therapistResult.rows.length > 0 && therapistResult.rows[0].schedule_id) {`;
            
  const replaceBlock = `          if (therapistName) {
            if (therapistName === 'SafeStories') {
              // SafeStories allows all slots
            } else {
              const therapistResult = await pool.query(
                'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
                [therapistName.trim().toLowerCase()]
              );
              
              if (therapistResult.rows.length > 0 && therapistResult.rows[0].schedule_id) {`;

  content = content.replace(searchBlock, replaceBlock);
  
  // Now add the else block at the end of the if (therapistResult.rows.length > 0 ...)
  // We need to find the catch block right after it
  const searchCatch = `                } catch (err) {
                  console.error('[Fetch Slots Filter] Failed to apply availability rules:', err);
                }
              }
            }
          }`;
          
  const replaceCatch = `                } catch (err) {
                  console.error('[Fetch Slots Filter] Failed to apply availability rules:', err);
                }
              } else {
                console.log(\`[Fetch Slots Filter] Therapist \${therapistName} has no schedule connected. Clearing all slots.\`);
                jsonResponse[0]["Available Slots"] = [];
              }
            }
          }`;
  
  if (content.includes(searchCatch)) {
    content = content.replace(searchCatch, replaceCatch);
    console.log(`Successfully patched ${filePath}`);
  } else {
    console.log(`Could not find catch block in ${filePath}`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

patchFile('crm-backend/src/index.ts');
patchFile('server/index.ts');
