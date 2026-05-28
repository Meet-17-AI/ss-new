const fs = require('fs');
const path = 'server/index.ts';
let content = fs.readFileSync(path, 'utf8');

const targetStr = `      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText);
      } catch (e) {
        jsonResponse = responseText;
      }`;

const replacementStr = `      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText);

        // FILTER LOGIC: Remove slots on days the therapist is unavailable according to DaySchedule
        if (Array.isArray(jsonResponse) && jsonResponse[0] && jsonResponse[0]["Available Slots"]) {
          const therapistName = payload.therapistName;
          
          if (therapistName) {
            const therapistResult = await pool.query(
              'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE t.name ILIKE $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
              [\`%\${therapistName.split(' ')[0]}%\`]
            );
            
            if (therapistResult.rows.length > 0 && therapistResult.rows[0].schedule_id) {
              const scheduleId = therapistResult.rows[0].schedule_id;
              
              try {
                const scheduleRes = await fetch(\`https://n8n.srv1169280.hstgr.cloud/webhook/424780e4-8e10-4308-84fd-5925450cc123?scheduleId=\${scheduleId}\`);
                if (scheduleRes.ok) {
                  const scheduleData = await scheduleRes.json();
                  if (Array.isArray(scheduleData) && scheduleData[0] && Array.isArray(scheduleData[0].availability)) {
                    const availabilityRules = scheduleData[0].availability;
                    
                    const daysMap = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                    
                    const originalSlots = jsonResponse[0]["Available Slots"];
                    const filteredSlots = originalSlots.filter((slotISO) => {
                      const d = new Date(slotISO);
                      const dayString = daysMap[d.getDay()];
                      
                      const rule = availabilityRules.find((r) => r.day === dayString);
                      if (rule && rule.is_available === false) {
                        return false; // Remove this slot
                      }
                      return true;
                    });
                    
                    console.log(\`[Fetch Slots Filter] Original slots: \${originalSlots.length}, Filtered slots: \${filteredSlots.length}\`);
                    jsonResponse[0]["Available Slots"] = filteredSlots;
                  }
                }
              } catch (err) {
                console.error('[Fetch Slots Filter] Failed to apply availability rules:', err);
              }
            }
          }
        }
      } catch (e) {
        jsonResponse = responseText;
      }`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacementStr);
  fs.writeFileSync(path, content);
  console.log("Successfully injected filter logic into server/index.ts");
} else {
  console.log("Could not find target string in server/index.ts");
}
