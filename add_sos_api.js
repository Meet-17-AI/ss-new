const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'server', 'index.ts');
let content = fs.readFileSync(indexPath, 'utf8');

// 1. Update import
content = content.replace(
  "import { sendOTPEmail, sendPasswordResetOTP } from '../lib/email';",
  "import { sendOTPEmail, sendPasswordResetOTP, sendSOSEmailAlert } from '../lib/email';"
);

// 2. Append the new route before the last app.listen block, or just at the end of the file if not found
// Let's just append it before `const PORT = process.env.PORT || 3004;` or before the last export if any.
// Searching for `app.listen` or `export default app`
const insertionPoint = "const PORT = process.env.PORT || 3004;";

const newApiCode = \`
// Direct SOS Alert via WhatsApp and Email
app.post('/api/send-sos-alert', async (req, res) => {
  try {
    const data = req.body;
    
    // Fetch emergency contact from bookings
    let emergencyContactName = 'Not provided';
    let emergencyContactNumber = 'Not provided';
    if (data.booking_id) {
      const bRes = await pool.query('SELECT emergency_contact_name, emergency_contact_number FROM bookings WHERE booking_id = $1', [data.booking_id]);
      if (bRes.rows.length > 0) {
        emergencyContactName = bRes.rows[0].emergency_contact_name || 'Not provided';
        emergencyContactNumber = bRes.rows[0].emergency_contact_number || 'Not provided';
      }
    }

    // Fetch total completed bookings
    let totalBookings = 0;
    if (data.client_phone) {
      const cRes = await pool.query('SELECT no_of_sessions FROM all_clients_table WHERE phone_number = $1', [data.client_phone]);
      if (cRes.rows.length > 0 && cRes.rows[0].no_of_sessions) {
        totalBookings = cRes.rows[0].no_of_sessions;
      } else {
        // Fallback to counting progress notes
        const pRes = await pool.query('SELECT COUNT(*) FROM client_progress_notes WHERE client_id = $1', [data.client_phone]);
        totalBookings = parseInt(pRes.rows[0].count) || 0;
      }
    }

    // Format Risk Indicators
    const indicators = [];
    const ri = data.risk_assessment?.risk_indicators || {};
    if (ri.emotionalDysregulation === 'Y') indicators.push('Emotional Dysregulation');
    if (ri.physicalHarmIdeas === 'Y') indicators.push('Physical Harm Ideas');
    if (ri.drugAlcoholAbuse === 'Y') indicators.push('Drug/Alcohol Abuse');
    if (ri.suicidalAttempt === 'Y') indicators.push('Suicidal Attempt/Ideation');
    if (ri.selfHarm === 'Y') indicators.push('Self Harm');
    if (ri.delusionsHallucinations === 'Y') indicators.push('Delusions/Hallucinations');
    if (ri.impulsiveness === 'Y') indicators.push('Impulsiveness');
    if (ri.severeStress === 'Y') indicators.push('Severe Stress');
    if (ri.socialIsolation === 'Y') indicators.push('Social Isolation');
    if (ri.concernByOthers === 'Y') indicators.push('Concern expressed by others');
    if (ri.other === 'Y') indicators.push('Other');
    
    const currentRiskIndicators = indicators.length > 0 ? indicators.join(', ') : 'None marked';
    const severityLevel = String(data.risk_assessment?.severity_level || 'Unknown');
    const riskSummary = data.risk_assessment?.risk_summary || 'Not provided';

    const templateParams = {
      clientName: data.client_name || 'Unknown',
      clientPhone: data.client_phone || 'Unknown',
      therapistName: data.therapist_name || 'Unknown',
      sessionTimings: data.session_timings || 'Unknown',
      mode: data.mode || 'Unknown',
      totalBookings: totalBookings,
      emergencyContactName: emergencyContactName,
      emergencyContactNumber: emergencyContactNumber,
      severityLevel: severityLevel,
      currentRiskIndicators: currentRiskIndicators,
      riskSummary: riskSummary,
      documentationLink: data.documentation_link || ''
    };

    // 1. Send Email
    await sendSOSEmailAlert(templateParams).catch(err => console.error('SOS Email failed:', err));

    // 2. Send WhatsApp via Aisensy
    const aisensyApiKey = process.env.AISENSY_API_KEY;
    if (aisensyApiKey) {
      try {
        const aisensyPayload = {
          apiKey: aisensyApiKey,
          campaignName: "sos_message_api_campaign",
          destination: "+917522911068",
          userName: "SafeStories",
          source: "DaySchedule",
          templateParams: [
            templateParams.clientName,
            templateParams.clientPhone,
            templateParams.therapistName,
            templateParams.sessionTimings,
            templateParams.mode,
            String(templateParams.totalBookings),
            templateParams.emergencyContactName,
            templateParams.emergencyContactNumber,
            templateParams.severityLevel,
            templateParams.currentRiskIndicators,
            templateParams.riskSummary,
            templateParams.documentationLink
          ]
        };

        const aisensyResponse = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(aisensyPayload)
        });

        if (!aisensyResponse.ok) {
          console.error('Aisensy API failed:', await aisensyResponse.text());
        } else {
          console.log('✅ SOS WhatsApp alert sent successfully via Aisensy');
        }
      } catch (err) {
        console.error('❌ Aisensy fetch error:', err);
      }
    } else {
      console.warn('⚠️ AISENSY_API_KEY not found in environment, skipping WhatsApp alert');
    }

    res.status(200).json({ success: true, message: 'SOS alerts processed' });
  } catch (error) {
    console.error('❌ Error processing SOS alert:', error);
    res.status(500).json({ error: 'Internal server error processing SOS alert' });
  }
});

\`;

if (content.includes(insertionPoint)) {
  content = content.replace(insertionPoint, newApiCode + insertionPoint);
} else {
  content += "\\n" + newApiCode;
}

fs.writeFileSync(indexPath, content);
console.log('server/index.ts updated with /api/send-sos-alert');
