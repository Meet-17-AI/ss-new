import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { logAutomationSuccess, logAutomationFailure } from './logger';
import { logWebhookApi } from '../lib/webhookApiLogger.js';

dotenv.config({ path: '.env.local' });

// Gmail SMTP only
const useGmailSmtp = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD;

let gmailTransporter: any = null;
if (useGmailSmtp) {
  gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendViaGmail(mailOptions: { to: string; subject: string; html: string }) {
  if (!useGmailSmtp || !gmailTransporter) {
    throw new Error('Gmail SMTP not configured (missing GMAIL_USER / GMAIL_APP_PASSWORD)');
  }
  const result = await gmailTransporter.sendMail({
    from: process.env.GMAIL_USER,
    to: mailOptions.to,
    subject: mailOptions.subject,
    html: mailOptions.html,
  });
  return { id: result.messageId };
}

// 1. SOS Alert Admin
export async function sendSOSAdminEmail(booking_id: string, adminEmail: string, details: any) {
  const mailOptions = {
    to: adminEmail,
    subject: `SOS Alert Raised | Immediate Attention Required - ${details.clientName}`,
    html: `<p>Hello!<br /><br /> An SOS has been raised following a therapy session. Please review the details below and initiate the required safety steps as per risk protocol. <br /><br />Client Details <br />● Client Name:&nbsp;${details.clientName}<br />● Client Phone Number:&nbsp;${details.clientPhone}<br /> ● Therapist Name:&nbsp;${details.therapistName}<br />● Last Session Date &amp; Time:&nbsp;${details.sessionTimings}<br />● Mode of Session:&nbsp;${details.mode}<br />● Number of sessions:&nbsp;${details.totalCompletedBookings}<br />● Emergency Contact Name:&nbsp;${details.emergencyContactName}<br />●&nbsp;Emergency Contact Number:&nbsp;${details.emergencyContactNumber}<br /><br />SOS Summary <br />● Risk Severity (1-5):&nbsp;${details.severityLevel}<br />● Current Risk Indicators:&nbsp;${details.currentRiskIndicator}<br />● Risk summary:&nbsp;${details.riskSummary}<br /><br />Link to client&rsquo;s documentation profile: ${details.documentationLink}.<br /><br /><br />Thank you for responding promptly and supporting client safety.</p>`
  };

  try {
    const data = await sendViaGmail(mailOptions);
    console.log('✅ SOS Admin email sent successfully', data);
    await logAutomationSuccess(booking_id, 'email_sos_alert_admin', adminEmail, data);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: 'Gmail SMTP (SOS Alert Admin)',
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'success',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      response_data: data
    });
  } catch (error: any) {
    console.error('❌ Exception sending SOS Admin email:', error);
    const errMsg = error.message || String(error);
    await logAutomationFailure(booking_id, 'email_sos_alert_admin', adminEmail, errMsg);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: 'Gmail SMTP (SOS Alert Admin)',
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'failed',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      error_message: errMsg
    });
  }
}

// OTP Email for Admin
export async function sendAdminOTPEmail(adminEmail: string, action: string, otp: string) {
  const mailOptions = {
    to: adminEmail,
    subject: `Admin Action OTP - ${action}`,
    html: `<p>Hello Admin,<br /><br />An OTP has been requested for the following sensitive action: <strong>${action}</strong>.<br /><br />Your OTP is: <strong>${otp}</strong><br /><br />This OTP is valid for 5 minutes. If you did not request this, please ignore this email.</p>`
  };

  try {
    const data = await sendViaGmail(mailOptions);
    console.log('✅ Admin OTP email sent successfully', data);
    await logAutomationSuccess('admin-otp', 'email_admin_otp', adminEmail, data);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: `Gmail SMTP (Admin OTP - ${action})`,
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'success',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      response_data: data
    });
  } catch (error: any) {
    console.error('❌ Exception sending Admin OTP email:', error);
    const errMsg = error.message || String(error);
    await logAutomationFailure('admin-otp', 'email_admin_otp', adminEmail, errMsg);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: `Gmail SMTP (Admin OTP - ${action})`,
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'failed',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      error_message: errMsg
    });
  }
}
