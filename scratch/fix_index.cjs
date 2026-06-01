const fs = require('fs');
let c = fs.readFileSync('src/index.ts', 'utf8');

const startIndex = c.indexOf("app.post('/api/fetch-slots', async (req, res) => {");
const endIndex = c.indexOf("// Create Direct Booking webhook proxy");

if (startIndex !== -1 && endIndex !== -1) {
  const replacement = `app.post('/api/fetch-slots', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.selectedDate || !payload.timezone) {
      return res.status(400).json({ error: 'Missing required fields: date and timezone' });
    }

    console.log('--- NATIVE FETCH SLOTS ---');

    const therapistName = payload.selectedTherapist || payload.therapistName;
    let scheduleId = null;
    let therapistId = null;

    if (therapistName) {
      const therapistResult = await pool.query(
        'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE t.name ILIKE $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
        [\`%\${therapistName.split(' ')[0]}%\`]
      );
      if (therapistResult.rows.length > 0) {
        therapistId = therapistResult.rows[0].therapist_id;
        scheduleId = therapistResult.rows[0].schedule_id;
      }
    }

    let availabilityRules = [];
    if (scheduleId) {
      const schedRes = await pool.query('SELECT availability FROM therapist_schedules WHERE schedule_id = $1', [scheduleId]);
      if (schedRes.rows.length > 0) {
        availabilityRules = schedRes.rows[0].availability;
      }
    }
    
    if (typeof availabilityRules === 'string') {
      try { availabilityRules = JSON.parse(availabilityRules); } catch(e){}
    }

    let availableSlots = [];

    if (Array.isArray(availabilityRules) && availabilityRules.length > 0) {
      const selectedDateObj = new Date(payload.selectedDate);
      const dayOfWeek = selectedDateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: payload.timezone }).toLowerCase();
      
      const dayRule = availabilityRules.find((r) => r.day.toLowerCase() === dayOfWeek);
      
      if (dayRule && dayRule.is_available && Array.isArray(dayRule.times)) {
        for (const timeBlock of dayRule.times) {
          let current = new Date(\`\${payload.selectedDate}T\${timeBlock.start}:00\`);
          const end = new Date(\`\${payload.selectedDate}T\${timeBlock.end}:00\`);
          
          while (current < end) {
            const timeStr = current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            availableSlots.push(timeStr);
            current.setMinutes(current.getMinutes() + 60);
          }
        }
      }
    } else {
       let current = new Date(\`\${payload.selectedDate}T10:00:00\`);
       const end = new Date(\`\${payload.selectedDate}T18:00:00\`);
       while (current < end) {
         availableSlots.push(current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
         current.setMinutes(current.getMinutes() + 60);
       }
    }

    if (therapistId) {
      try {
        const bookingsRes = await pool.query(
          \`SELECT booking_invitee_time FROM bookings 
           WHERE therapist_id = $1 AND DATE(booking_start_at AT TIME ZONE 'Asia/Kolkata') = $2 AND booking_status != 'Canceled'\`,
          [therapistId, payload.selectedDate]
        );
        
        const bookedTimes = bookingsRes.rows.map(r => r.booking_invitee_time);
        availableSlots = availableSlots.filter(slot => {
          return !bookedTimes.some(bTime => bTime && bTime.includes(slot));
        });
      } catch (err) {
        console.error('Error fetching bookings to filter slots:', err);
      }
    }

    res.json([{ "Available Slots": availableSlots, success: true }]);
  } catch (error) {
    console.error('Error in native fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

`;
  
  c = c.substring(0, startIndex) + replacement + c.substring(endIndex);
}

fs.writeFileSync('src/index.ts', c);
console.log('Fixed index.ts successfully');
