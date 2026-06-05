import { Resend } from 'resend';
import dotenv from 'dotenv';
import { logAutomationSuccess, logAutomationFailure } from './logger';

dotenv.config({ path: '.env.local' });

const resendApiKey = process.env.RESEND_API_KEY || 'missing_api_key';
const resend = new Resend(resendApiKey);

// 1. SOS Alert Admin
export async function sendSOSAdminEmail(booking_id: string, adminEmail: string, details: any) {
  const mailOptions = {
    from: 'SafeStories <no-reply@safestories.in>',
    to: adminEmail,
    subject: `SOS Alert Raised | Immediate Attention Required - ${details.clientName}`,
    html: `<p>Hello!<br /><br /> An SOS has been raised following a therapy session. Please review the details below and initiate the required safety steps as per risk protocol. <br /><br />Client Details <br />● Client Name:&nbsp;${details.clientName}<br />● Client Phone Number:&nbsp;${details.clientPhone}<br /> ● Therapist Name:&nbsp;${details.therapistName}<br />● Last Session Date &amp; Time:&nbsp;${details.sessionTimings}<br />● Mode of Session:&nbsp;${details.mode}<br />● Number of sessions:&nbsp;${details.totalCompletedBookings}<br />● Emergency Contact Name:&nbsp;${details.emergencyContactName}<br />●&nbsp;Emergency Contact Number:&nbsp;${details.emergencyContactNumber}<br /><br />SOS Summary <br />● Risk Severity (1-5):&nbsp;${details.severityLevel}<br />● Current Risk Indicators:&nbsp;${details.currentRiskIndicator}<br />● Risk summary:&nbsp;${details.riskSummary}<br /><br />Link to client&rsquo;s documentation profile: ${details.documentationLink}.<br /><br /><br />Thank you for responding promptly and supporting client safety.</p>`
  };

  try {
    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Error sending SOS Admin email:', error);
      await logAutomationFailure(booking_id, 'email_sos_alert_admin', adminEmail, JSON.stringify(error));
    } else {
      console.log('✅ SOS Admin email sent successfully', data);
      await logAutomationSuccess(booking_id, 'email_sos_alert_admin', adminEmail, data);
    }
  } catch (error: any) {
    console.error('❌ Exception sending SOS Admin email:', error);
    await logAutomationFailure(booking_id, 'email_sos_alert_admin', adminEmail, error.message || String(error));
  }
}

// OTP Email for Admin
export async function sendAdminOTPEmail(adminEmail: string, action: string, otp: string) {
  const mailOptions = {
    from: 'SafeStories <no-reply@safestories.in>',
    to: adminEmail,
    subject: `Admin Action OTP - ${action}`,
    html: `<p>Hello Admin,<br /><br />An OTP has been requested for the following sensitive action: <strong>${action}</strong>.<br /><br />Your OTP is: <strong>${otp}</strong><br /><br />This OTP is valid for 5 minutes. If you did not request this, please ignore this email.</p>`
  };

  try {
    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Error sending Admin OTP email:', error);
      await logAutomationFailure('admin-otp', 'email_admin_otp', adminEmail, JSON.stringify(error));
    } else {
      console.log('✅ Admin OTP email sent successfully', data);
      await logAutomationSuccess('admin-otp', 'email_admin_otp', adminEmail, data);
    }
  } catch (error: any) {
    console.error('❌ Exception sending Admin OTP email:', error);
    await logAutomationFailure('admin-otp', 'email_admin_otp', adminEmail, error.message || String(error));
  }
}
