const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'panel-backend', 'src', 'index.ts');
let content = fs.readFileSync(file, 'utf8');

// Insert imports at the top
if (!content.includes('sendSOSAdminWhatsapp')) {
    content = content.replace(
        "import { sendOTPEmail, sendPasswordResetOTP, sendClientBookingConfirmationEmail, sendAdminBookingConfirmationEmail } from './lib/email';",
        "import { sendOTPEmail, sendPasswordResetOTP, sendClientBookingConfirmationEmail, sendAdminBookingConfirmationEmail, sendSOSAdminEmail } from './lib/email';\nimport { sendSOSAdminWhatsapp } from './automations/index';"
    );
}

const endpointCode = `
// Send SOS Alert directly (replaces N8N webhook)
app.post('/api/send-sos-alert', async (req, res) => {
  try {
    const data = req.body;
    
    // Fetch emergency contact and total bookings
    let emergencyContactName = 'N/A';
    let emergencyContactNumber = 'N/A';
    let totalCompletedBookings = '0';
    
    try {
      // Get the most recent session's emergency contact info for this client
      const contactQuery = \`
        SELECT emergency_contact_name, emergency_contact_number
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND emergency_contact_name IS NOT NULL
          AND emergency_contact_name != ''
        ORDER BY created_at DESC
        LIMIT 1
      \`;
      const contactRes = await pool.query(contactQuery, [data.client_email, data.client_phone]);
      if (contactRes.rows.length > 0) {
        emergencyContactName = contactRes.rows[0].emergency_contact_name;
        emergencyContactNumber = contactRes.rows[0].emergency_contact_number;
      }
      
      // Get total completed bookings
      const countQuery = \`
        SELECT count(*) as total
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND booking_status = 'completed'
      \`;
      const countRes = await pool.query(countQuery, [data.client_email, data.client_phone]);
      totalCompletedBookings = countRes.rows[0].total.toString();
    } catch(dbErr) {
      console.error('Error fetching extra SOS details:', dbErr);
    }
    
    // Format Risk Indicators
    let currentRiskIndicator = 'None';
    if (data.risk_assessment && data.risk_assessment.risk_indicators) {
        const indicators = data.risk_assessment.risk_indicators;
        const activeIndicators = [];
        if (indicators.emotionalDysregulation === 'Y') activeIndicators.push('Emotional Dysregulation');
        if (indicators.physicalHarmIdeas === 'Y') activeIndicators.push('Physical Harm Ideas');
        if (indicators.drugAlcoholAbuse === 'Y') activeIndicators.push('Drug/Alcohol Abuse');
        if (indicators.suicidalAttempt === 'Y') activeIndicators.push('Suicidal Attempt');
        if (indicators.selfHarm === 'Y') activeIndicators.push('Self Harm');
        if (indicators.delusionsHallucinations === 'Y') activeIndicators.push('Delusions/Hallucinations');
        if (indicators.impulsiveness === 'Y') activeIndicators.push('Impulsiveness');
        if (indicators.severeStress === 'Y') activeIndicators.push('Severe Stress');
        if (indicators.socialIsolation === 'Y') activeIndicators.push('Social Isolation');
        if (indicators.concernByOthers === 'Y') activeIndicators.push('Concern by Others');
        if (indicators.other === 'Y') activeIndicators.push('Other');
        if (activeIndicators.length > 0) {
            currentRiskIndicator = activeIndicators.join(', ');
        }
    }
    
    const details = {
        clientName: data.client_name || 'N/A',
        clientPhone: data.client_phone || 'N/A',
        therapistName: data.therapist_name || 'N/A',
        sessionTimings: data.session_timings || 'N/A',
        mode: data.mode || 'N/A',
        totalCompletedBookings: totalCompletedBookings,
        emergencyContactName: emergencyContactName,
        emergencyContactNumber: emergencyContactNumber,
        severityLevel: String(data.risk_assessment?.severity_level || 'N/A'),
        currentRiskIndicator: currentRiskIndicator,
        riskSummary: data.risk_assessment?.risk_summary || 'N/A',
        documentationLink: data.documentation_link || 'N/A'
    };
    
    // Send Whatsapp
    const adminPhone = "+917522911068";
    await sendSOSAdminWhatsapp(
        data.booking_id || '',
        adminPhone,
        details.clientName,
        details.clientPhone,
        details.therapistName,
        details.sessionTimings,
        details.mode,
        details.totalCompletedBookings,
        details.emergencyContactName,
        details.emergencyContactNumber,
        details.severityLevel,
        details.currentRiskIndicator,
        details.riskSummary,
        details.documentationLink
    );
    
    // Send Email
    const adminEmail = "admin@safestories.in";
    await sendSOSAdminEmail(adminEmail, details);
    
    res.status(200).json({ success: true, message: 'SOS Alert triggered successfully' });
  } catch (error) {
    console.error('Error in send-sos-alert:', error);
    res.status(500).json({ error: 'Failed to send SOS Alert', details: error.message });
  }
});
`;

if (!content.includes('/api/send-sos-alert')) {
    content = content.replace(
        "// Get SOS Documentation by Token",
        endpointCode + "\n\n// Get SOS Documentation by Token"
    );
    fs.writeFileSync(file, content);
    console.log("Endpoint added successfully.");
} else {
    console.log("Endpoint already exists.");
}
