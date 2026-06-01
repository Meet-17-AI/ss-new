const fs = require('fs');
let data = fs.readFileSync('panel-backend/src/index.ts', 'utf8');

const targetStr = `          // If it's a Free Consultation and we have a phone, create a new lead automatically
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });`;

const replaceStr = `          // If it's a Free Consultation and we have a phone, create a new lead automatically
          if (isFreeConsultation && inviteePhone) {
            // Find default lead manager (admin user) to assign
            const defaultManager = await pool.query(
              \`SELECT id FROM users WHERE role IN ('admin', 'sales') ORDER BY id LIMIT 1\`
            );
            const salesAgentId = defaultManager.rows[0]?.id || null;

            await pool.query(
              \`INSERT INTO leads (name, phone, email, source, sales_agent_id, status, pipeline_stage, stage_pretherapy_call_at, remark_lead_manager)
               VALUES ($1, $2, $3, $4, $5, 'New', 'pretherapy-call', CURRENT_TIMESTAMP, $6)\`,
              [
                booking.invitee_name,
                booking.invitee_phone,
                booking.invitee_email || null,
                'Free Consultation',
                salesAgentId,
                \`Auto-created from Free Consultation booking ID: \${booking_id}\`
              ]
            );
            console.log(\`✅ [Auto-Create] Lead for free consultation: "\${booking.invitee_name}" (\${booking.invitee_phone})\`);
          }
        }
      }
    } catch (moveErr) {
      console.error('❌ [Auto-Move] Error processing lead movement:', moveErr);
    }
    
    // Notifications disabled by user request.
    res.json({ success: true });
  } catch (error) {
    console.error('Error notifying new booking:', error);
    res.status(500).json({ error: 'Failed to notify new booking' });
  }
});

// Send booking link webhook
app.post('/api/send-booking-link', async (req, res) => {
  try {
    const { clientName, email, phone, therapistName, therapy } = req.body;

    // Validate required fields
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });`;

if (data.includes(targetStr)) {
  data = data.replace(targetStr, replaceStr);
  fs.writeFileSync('panel-backend/src/index.ts', data);
  console.log('Fixed successfully.');
} else {
  console.log('Target string not found.');
}
