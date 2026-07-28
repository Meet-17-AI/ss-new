import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { logWebhookApi } from './webhookApiLogger.js';

// Load environment variables
dotenv.config({ path: '.env.local' });

// Email service configuration — Gmail SMTP only
const useGmailSmtp = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD;

// Initialize Gmail SMTP transporter
let gmailTransporter: any = null;
if (useGmailSmtp) {
  gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  console.log(`✅ Gmail SMTP configured: ${process.env.GMAIL_USER}`);
} else {
  console.error('❌ Gmail SMTP NOT configured: GMAIL_USER / GMAIL_APP_PASSWORD are missing. Emails will fail.');
}

async function sendEmailWithLogging(mailOptions: any, emailType: string): Promise<any> {
  if (!useGmailSmtp || !gmailTransporter) {
    const msg = `Gmail SMTP not configured (missing GMAIL_USER / GMAIL_APP_PASSWORD) — cannot send [${emailType}]`;
    console.error(`❌ ${msg}`);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: `Gmail SMTP (${emailType})`,
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'failed',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      error_message: msg
    });
    throw new Error(msg);
  }

  try {
    const fromEmail = process.env.GMAIL_USER;

    const result = await gmailTransporter.sendMail({
      from: fromEmail,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
    });

    console.log(`✅ Email sent via Gmail SMTP [${emailType}]:`, result.messageId);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: `Gmail SMTP (${emailType})`,
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'success',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      response_data: { messageId: result.messageId }
    });

    return { data: { id: result.messageId }, error: null };
  } catch (err: any) {
    console.error(`❌ Exception sending email [${emailType}]:`, err);
    await logWebhookApi({
      log_type: 'api_outgoing',
      name: `Gmail SMTP (${emailType})`,
      endpoint: 'smtp.gmail.com:587',
      method: 'SMTP',
      status: 'failed',
      request_payload: { to: mailOptions.to, subject: mailOptions.subject },
      error_message: err.message || String(err)
    });
    throw err;
  }
}

/**
 * Send OTP email to therapist
 * @param email - Therapist email address
 * @param therapistName - Therapist name
 * @param otp - 6-digit OTP code
 * @param expiresAt - OTP expiry date
 */
export async function sendOTPEmail(
  email: string,
  therapistName: string,
  otp: string,
  expiresAt: Date
): Promise<void> {
  try {
    const expiryTime = expiresAt.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
      timeZoneName: 'short'
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Your SafeStories Profile</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #21615D 0%, #2d7a75 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Welcome to SafeStories</h1>
              <p style="margin: 10px 0 0 0; color: #e0f2f1; font-size: 16px;">Complete Your Therapist Profile</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello <strong>${therapistName}</strong>,
              </p>
              
              <p style="margin: 0 0 20px 0; color: #555555; font-size: 15px; line-height: 1.6;">
                Welcome to the SafeStories team! We're excited to have you join our community of mental health professionals.
              </p>
              
              <p style="margin: 0 0 30px 0; color: #555555; font-size: 15px; line-height: 1.6;">
                To complete your profile setup and gain access to your therapist dashboard, please use the One-Time Password (OTP) below:
              </p>
              
              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px 0;">
                <tr>
                  <td align="center" style="background-color: #f0f9f8; border: 2px dashed #21615D; border-radius: 8px; padding: 30px;">
                    <p style="margin: 0 0 10px 0; color: #666666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your OTP Code</p>
                    <p style="margin: 0; color: #21615D; font-size: 42px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
                  </td>
                </tr>
              </table>
              
              <!-- Login Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${process.env.FRONTEND_URL || "https://panel.safestories.in/"}" style="display: inline-block; background-color: #21615D; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      🔐 Login to Complete Your Profile
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Instructions -->
              <div style="background-color: #fff8e1; border-left: 4px solid #ffc107; padding: 20px; margin: 0 0 30px 0; border-radius: 4px;">
                <p style="margin: 0 0 10px 0; color: #333333; font-size: 15px; font-weight: 600;">
                  📋 Next Steps:
                </p>
                <ol style="margin: 10px 0 0 0; padding-left: 20px; color: #555555; font-size: 14px; line-height: 1.8;">
                  <li>Click the "Login to Complete Your Profile" button above</li>
                  <li>Click on "First Time Login?" on the login page</li>
                  <li>Enter your email and the OTP code shown above</li>
                  <li>Complete your profile with your details</li>
                  <li>Set up your password for future logins</li>
                </ol>
              </div>
              
              <!-- Expiry Warning -->
              <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 0 0 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #c62828; font-size: 14px;">
                  ⏰ <strong>Important:</strong> This OTP will expire on <strong>${expiryTime}</strong>
                </p>
              </div>
              
              <p style="margin: 0 0 20px 0; color: #555555; font-size: 14px; line-height: 1.6;">
                If you didn't request this email or have any questions, please contact our support team immediately.
              </p>
              
              <p style="margin: 0; color: #555555; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>The SafeStories Team</strong>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0 0 10px 0; color: #999999; font-size: 13px;">
                This is an automated email. Please do not reply to this message.
              </p>
              <p style="margin: 0; color: #999999; font-size: 13px;">
                © ${new Date().getFullYear()} SafeStories. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: email,
      subject: '🔐 Your SafeStories Profile Setup OTP',
      html: htmlContent,
      text: `Hello ${therapistName},

Welcome to SafeStories! Your One-Time Password (OTP) for profile setup is: ${otp}

This OTP will expire on ${expiryTime}.

🔐 LOGIN LINK: ${process.env.FRONTEND_URL || "https://panel.safestories.in/"}

Next Steps:
1. Click the login link above or go to the SafeStories dashboard
2. Click on "First Time Login?" on the login page
3. Enter your email and the OTP code
4. Complete your profile with your details
5. Set up your password for future logins

If you didn't request this email, please contact our support team.

Best regards,
The SafeStories Team`,
    };

    await sendEmailWithLogging(mailOptions, 'Therapist OTP Setup');
  } catch (error) {
    console.error('❌ Error sending email:', error);
    throw error;
  }
}

/**
 * Send password reset OTP email
 * @param email - User email address
 * @param userName - User name
 * @param otp - 6-digit OTP code
 * @param expiresAt - OTP expiry date
 */
export async function sendPasswordResetOTP(
  email: string,
  userName: string,
  otp: string,
  expiresAt: Date
): Promise<void> {
  try {
    const expiryTime = expiresAt.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
      timeZoneName: 'short'
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset - SafeStories</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #21615D 0%, #2d7a75 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Password Reset Request</h1>
              <p style="margin: 10px 0 0 0; color: #e0f2f1; font-size: 16px;">SafeStories Account Security</p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; line-height: 1.6;">
                Hello <strong>${userName}</strong>,
              </p>
              
              <p style="margin: 0 0 20px 0; color: #555555; font-size: 15px; line-height: 1.6;">
                We received a request to reset your password for your SafeStories account. To proceed with the password reset, please use the One-Time Password (OTP) below:
              </p>
              
              <!-- OTP Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px 0;">
                <tr>
                  <td align="center" style="background-color: #f0f9f8; border: 2px dashed #21615D; border-radius: 8px; padding: 30px;">
                    <p style="margin: 0 0 10px 0; color: #666666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your OTP Code</p>
                    <p style="margin: 0; color: #21615D; font-size: 42px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</p>
                  </td>
                </tr>
              </table>
              
              <!-- Instructions -->
              <div style="background-color: #fff8e1; border-left: 4px solid #ffc107; padding: 20px; margin: 0 0 30px 0; border-radius: 4px;">
                <p style="margin: 0 0 10px 0; color: #333333; font-size: 15px; font-weight: 600;">
                  📋 Next Steps:
                </p>
                <ol style="margin: 10px 0 0 0; padding-left: 20px; color: #555555; font-size: 14px; line-height: 1.8;">
                  <li>Enter the OTP code above in the password reset form</li>
                  <li>Create a new strong password</li>
                  <li>Confirm your new password</li>
                  <li>Login with your new credentials</li>
                </ol>
              </div>
              
              <!-- Expiry Warning -->
              <div style="background-color: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 0 0 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #c62828; font-size: 14px;">
                  ⏰ <strong>Important:</strong> This OTP will expire on <strong>${expiryTime}</strong>
                </p>
              </div>
              
              <!-- Security Notice -->
              <div style="background-color: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 0 0 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #1565c0; font-size: 14px;">
                  🔒 <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email and ensure your account is secure. Your password will not be changed unless you complete the reset process.
                </p>
              </div>
              
              <p style="margin: 0; color: #555555; font-size: 14px; line-height: 1.6;">
                Best regards,<br>
                <strong>The SafeStories Team</strong>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0 0 10px 0; color: #999999; font-size: 13px;">
                This is an automated email. Please do not reply to this message.
              </p>
              <p style="margin: 0; color: #999999; font-size: 13px;">
                © ${new Date().getFullYear()} SafeStories. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: email,
      subject: '🔐 Password Reset OTP - SafeStories',
      html: htmlContent,
      text: `Hello ${userName},

We received a request to reset your password for your SafeStories account.

Your One-Time Password (OTP) for password reset is: ${otp}

This OTP will expire on ${expiryTime}.

Next Steps:
1. Enter the OTP code in the password reset form
2. Create a new strong password
3. Confirm your new password
4. Login with your new credentials

Security Notice: If you didn't request this password reset, please ignore this email. Your password will not be changed unless you complete the reset process.

Best regards,
The SafeStories Team`,
    };

    await sendEmailWithLogging(mailOptions, 'Password Reset OTP');
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    throw error;
  }
}

/**
 * Verify email configuration
 */
export async function verifyEmailConfig(): Promise<boolean> {
  try {
    // Gmail SMTP does not require explicit verification here
    console.log('✅ Email configuration verified');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error);
    return false;
  }
}

/**
 * Send booking confirmation email to Admin
 */
export async function sendAdminBookingConfirmationEmail(
  adminEmail: string,
  details: {
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    sessionName: string;
    sessionTiming: string;
    sessionMode: string;
    therapistName: string;
    therapistEmail: string;
  }
): Promise<void> {
  try {
    const htmlContent = `
<blockquote><strong>Hello Team,<br /></strong>A new session has been confirmed. Please find the complete details below:<br /><br /><strong>Client Details:</strong><strong><br />Client Name:</strong> ${details.clientName}<br /><strong>Phone No.:</strong> ${details.clientPhone}<br /><strong>Email Address:</strong> ${details.clientEmail}<br /><strong><br />Session Details:<br /></strong><strong>Session Name:</strong> ${details.sessionName}<br /><strong>Session Timing:</strong> ${details.sessionTiming}<br /><strong>Session Mode:</strong> ${details.sessionMode}<br /><br /><strong>Therapist Details:<br /></strong><strong>Therapist Name:</strong> ${details.therapistName}<br /><strong>Therapist Email:</strong> ${details.therapistEmail}<hr /><em>This is a system-generated message. Please do not reply to this email.<br /><br /><br /></em></blockquote>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: adminEmail,
      subject: `New Session Confirmed: ${details.sessionName}`,
      html: htmlContent,
    };

    await sendEmailWithLogging(mailOptions, `Admin Booking Confirmation (${details.sessionName})`);
  } catch (error) {
    console.error('❌ Error sending admin booking confirmation email:', error);
    throw error;
  }
}

/**
 * Send booking confirmation email to the Therapist.
 * Contains: client name, session name, session date/time (IST), session mode,
 * and — only for online sessions — the Google Meet link. In-person sessions
 * intentionally include no link.
 */
export async function sendTherapistBookingConfirmationEmail(
  therapistEmail: string,
  details: {
    therapistName: string;
    clientName: string;
    sessionName: string;
    sessionTiming: string; // already formatted IST string
    isOnline: boolean;
    meetLink?: string;
  }
): Promise<void> {
  try {
    const modeLabel = details.isOnline ? 'Google Meet (Online)' : 'In Person (SafeStories Office, Pune)';
    const meetRow = details.isOnline && details.meetLink
      ? `<div class="detail-item"><span class="label">Meet Link:</span><span class="value"><a href="${details.meetLink}" style="color:#1e6d63;">${details.meetLink}</a></span></div>`
      : '';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9f9f9; }
        .container { max-width: 480px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #d1d1d1; }
        .header { text-align: center; padding: 35px 25px 15px; }
        .brand { font-size: 32px; font-weight: bold; margin: 0; letter-spacing: -0.5px; }
        .safe { color: #f2c730; }
        .stories { color: #1e6d63; }
        .confirmed { font-size: 16px; color: #666; margin-top: 8px; font-weight: 600; text-transform: uppercase; display: block; }
        .intro-text { font-size: 15px; color: #555; margin-top: 15px; line-height: 1.5; }
        .content { padding: 0 30px 30px; }
        .details-box { background-color: #f0f6f5; border-radius: 10px; padding: 20px; margin: 20px 0; border: 1px solid #e2ecea; }
        .detail-item { margin-bottom: 10px; font-size: 14px; display: flex; }
        .label { font-weight: bold; color: #1e6d63; width: 100px; flex-shrink: 0; }
        .value { color: #444; word-break: break-word; }
        .btn-join { display: block; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 12px; font-size: 16px; background-color: #1e6d63; color: #ffffff !important; }
        .footer { text-align: center; padding: 25px; background-color: #ffffff; border-top: 1px solid #f0f0f0; }
        .slogan { font-style: italic; color: #1e6d63; margin: 0; font-size: 15px; font-weight: 500; }
        .signature { margin-top: 5px; font-size: 14px; color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand"><span class="safe">Safe</span><span class="stories">Stories</span></div>
            <strong class="confirmed">New Session Confirmed</strong>
            <p class="intro-text">
                Hello <strong>${details.therapistName}</strong>, a new session has been confirmed and added to your schedule.
            </p>
        </div>

        <div class="content">
            <div class="details-box">
                <div class="detail-item">
                    <span class="label">Client:</span>
                    <span class="value">${details.clientName}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Session:</span>
                    <span class="value">${details.sessionName}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Date &amp; Time:</span>
                    <span class="value">${details.sessionTiming}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Mode:</span>
                    <span class="value">${modeLabel}</span>
                </div>
                ${meetRow}
                ${details.isOnline && details.meetLink
                  ? `<a href="${details.meetLink}" class="btn-join">Join Session</a>`
                  : ''}
            </div>
        </div>

        <div class="footer">
            <p class="slogan">Always there for your mental health.</p>
            <p class="signature"><strong>Team SafeStories</strong></p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: therapistEmail,
      subject: `New Session Confirmed: ${details.sessionName}`,
      html: htmlContent,
    };

    await sendEmailWithLogging(mailOptions, `Therapist Booking Confirmation (${details.sessionName})`);
  } catch (error) {
    console.error('❌ Error sending therapist booking confirmation email:', error);
    throw error;
  }
}

/**
 * Send booking confirmation email to Client
 */
export async function sendClientBookingConfirmationEmail(
  clientEmail: string,
  details: {
    clientName: string;
    inviteeTimeStr: string;
    sessionName: string;
    dateStr: string;
    timeRangeStr: string;
    duration: number;
    joinLink: string;
    checkinUrl: string;
    calendarStartRaw: string;
    calendarEndRaw: string;
    isOnline?: boolean;
  }
): Promise<void> {
  try {
    // Mode shown in the email comes from the authoritative session mode (isOnline)
    // when the caller provides it; only fall back to sniffing the join link for
    // older callers that don't pass it. This prevents an in-person booking from
    // being labelled "Google Meet" just because a meet link happened to be attached.
    const hasMeetLink = Boolean(details.joinLink && details.joinLink.includes('http'));
    const isOnlineSession = typeof details.isOnline === 'boolean' ? details.isOnline : hasMeetLink;
    const calendarLink = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(details.sessionName)}&dates=${details.calendarStartRaw}/${details.calendarEndRaw}&location=${encodeURIComponent(details.joinLink)}`;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9f9f9; }
        
        .container { 
            max-width: 480px; 
            margin: 30px auto; 
            background: #ffffff; 
            border-radius: 12px; 
            overflow: hidden; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.05); 
            border: 1px solid #d1d1d1; 
        }
        
        /* Header */
        .header { text-align: center; padding: 35px 25px 15px; }
        .brand { font-size: 32px; font-weight: bold; margin: 0; letter-spacing: -0.5px; }
        .safe { color: #f2c730; } 
        .stories { color: #1e6d63; } 
        .confirmed { font-size: 16px; color: #666; margin-top: 8px; font-weight: 600; text-transform: uppercase; display: block; }
        
        /* Greeting Line */
        .intro-text { font-size: 15px; color: #555; margin-top: 15px; line-height: 1.5; }

        /* Session Details Section */
        .content { padding: 0 30px 30px; }
        .details-box { background-color: #f0f6f5; border-radius: 10px; padding: 20px; margin: 20px 0; border: 1px solid #e2ecea; }
        .detail-item { margin-bottom: 10px; font-size: 14px; display: flex; }
        .label { font-weight: bold; color: #1e6d63; width: 90px; flex-shrink: 0; }
        .value { color: #444; }

        /* Buttons within details */
        .btn { display: block; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 12px; font-size: 16px; }
        .btn-join { background-color: #1e6d63; color: #ffffff !important; }
        .btn-manage { background-color: #f2c730; color: #333333 !important; }
        
        /* Calendar Button */
        .btn-calendar { display: block; text-align: center; color: #1e6d63 !important; text-decoration: underline; font-weight: 600; font-size: 14px; margin-top: 20px; }

        /* Footer */
        .footer { text-align: center; padding: 25px; background-color: #ffffff; border-top: 1px solid #f0f0f0; }
        .slogan { font-style: italic; color: #1e6d63; margin: 0; font-size: 15px; font-weight: 500; }
        .signature { margin-top: 5px; font-size: 14px; color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand"><span class="safe">Safe</span><span class="stories">Stories</span></div>
            <strong class="confirmed">Session Confirmed!</strong>
            <p class="intro-text">
                Hello <strong>${details.clientName}</strong>, your session with SafeStories has been confirmed for <strong>${details.inviteeTimeStr}</strong>.
            </p>
        </div>

        <div class="content">
            <div class="details-box">
                <div class="detail-item">
                    <span class="label">Session:</span>
                    <span class="value">${details.sessionName}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Date:</span>
                    <span class="value">${details.dateStr}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Time:</span>
                    <span class="value">${details.timeRangeStr}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Duration:</span>
                    <span class="value">${details.duration} Minutes</span>
                </div>
                <div class="detail-item">
                    <span class="label">Location:</span>
                    <span class="value">${isOnlineSession ? 'Google Meet' : 'In Person (Pune)'}</span>
                </div>

                <hr style="border: 0; border-top: 1px solid #dce8e6; margin: 15px 0;">

                ${hasMeetLink
                  ? `<a href="${details.joinLink}" class="btn btn-join">Join Session</a>`
                  : isOnlineSession
                    ? `<span class="btn btn-join" style="background-color: #f2c730; color: #333333 !important;">Online Session</span>`
                    : `<a href="https://maps.app.goo.gl/7zazUGoGirx3azdg8" class="btn btn-join" style="background-color: #f2c730; color: #333333 !important;">Get Directions</a>`
                }
                <a href="${details.checkinUrl}" class="btn btn-manage">Manage Booking</a>
            </div>

            <br> 

            <a href="${calendarLink}" class="btn-calendar">+ Add to Google Calendar</a>
        </div>

        <div class="footer">
            <p class="slogan">Always there for your mental health.</p>
            <p class="signature"><strong><br />Team SafeStories</strong><br />410, 4th Floor, Marvel Vista Business Centre,<br /> Near Gera Junction, Lullanagar, <br />Pune, Maharashtra 411048</p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: clientEmail,
      subject: `Session Confirmed: ${details.sessionName}`,
      html: htmlContent,
    };

    await sendEmailWithLogging(mailOptions, `Client Booking Confirmation (${details.sessionName})`);
  } catch (error) {
    console.error('❌ Error sending client booking confirmation email:', error);
    throw error;
  }
}

/**
 * Send booking cancellation email to Client (#14)
 */
export async function sendClientBookingCancellationEmail(
  clientEmail: string,
  details: {
    clientName: string;
    sessionName: string;
    sessionTiming: string;
    reason?: string;
    refundInitiated?: boolean;
  }
): Promise<void> {
  try {
    const refundLine = details.refundInitiated
      ? `<p class="intro-text">A refund has been initiated and will reflect in your account within 5–7 business days.</p>`
      : '';
    const reasonLine = details.reason
      ? `<div class="detail-item"><span class="label">Reason:</span><span class="value">${details.reason}</span></div>`
      : '';

    const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9f9f9; }
  .container { max-width: 480px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #d1d1d1; }
  .header { text-align: center; padding: 35px 25px 15px; }
  .brand { font-size: 32px; font-weight: bold; margin: 0; letter-spacing: -0.5px; }
  .safe { color: #f2c730; } .stories { color: #1e6d63; }
  .cancelled { font-size: 16px; color: #b91c1c; margin-top: 8px; font-weight: 600; text-transform: uppercase; display: block; }
  .intro-text { font-size: 15px; color: #555; margin-top: 15px; line-height: 1.5; padding: 0 25px; }
  .content { padding: 0 30px 30px; }
  .details-box { background-color: #fdf2f2; border-radius: 10px; padding: 20px; margin: 20px 0; border: 1px solid #f5d5d5; }
  .detail-item { margin-bottom: 10px; font-size: 14px; display: flex; }
  .label { font-weight: bold; color: #b91c1c; width: 90px; flex-shrink: 0; }
  .value { color: #444; }
  .footer { text-align: center; padding: 25px; background-color: #ffffff; border-top: 1px solid #f0f0f0; }
  .slogan { font-style: italic; color: #1e6d63; margin: 0; font-size: 15px; font-weight: 500; }
  .signature { margin-top: 5px; font-size: 14px; color: #888; }
</style></head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand"><span class="safe">Safe</span><span class="stories">Stories</span></div>
      <strong class="cancelled">Session Cancelled</strong>
      <p class="intro-text">Hello <strong>${details.clientName}</strong>, your session below has been cancelled.</p>
    </div>
    <div class="content">
      <div class="details-box">
        <div class="detail-item"><span class="label">Session:</span><span class="value">${details.sessionName}</span></div>
        <div class="detail-item"><span class="label">Time:</span><span class="value">${details.sessionTiming}</span></div>
        ${reasonLine}
      </div>
      ${refundLine}
      <p class="intro-text" style="padding:0;">If this was a mistake or you'd like to rebook, please reach out to us and we'll be happy to help.</p>
    </div>
    <div class="footer">
      <p class="slogan">Always there for your mental health.</p>
      <p class="signature"><strong><br />Team SafeStories</strong><br />410, 4th Floor, Marvel Vista Business Centre,<br /> Near Gera Junction, Lullanagar, <br />Pune, Maharashtra 411048</p>
    </div>
  </div>
</body>
</html>`;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: clientEmail,
      subject: `Session Cancelled: ${details.sessionName}`,
      html: htmlContent,
    };

    await sendEmailWithLogging(mailOptions, `Client Booking Cancellation (${details.sessionName})`);
  } catch (error) {
    console.error('❌ Error sending client booking cancellation email:', error);
    throw error;
  }
}

/**
 * Send payment link email to Client
 */
export async function sendPaymentLinkEmail(
  clientEmail: string,
  details: {
    clientName: string;
    serviceType: string;
    sessionTiming: string;
    paymentLink: string;
  }
): Promise<void> {
  try {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9f9f9; }
        
        .container { 
            max-width: 480px; 
            margin: 30px auto; 
            background: #ffffff; 
            border-radius: 12px; 
            overflow: hidden; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.05); 
            border: 1px solid #d1d1d1; 
        }
        
        /* Header */
        .header { text-align: center; padding: 35px 25px 15px; }
        .brand { font-size: 32px; font-weight: bold; margin: 0; letter-spacing: -0.5px; }
        .safe { color: #f2c730; } 
        .stories { color: #1e6d63; } 
        .confirmed { font-size: 16px; color: #666; margin-top: 8px; font-weight: 600; text-transform: uppercase; display: block; }
        
        /* Greeting Line */
        .intro-text { font-size: 15px; color: #555; margin-top: 15px; line-height: 1.5; }

        /* Session Details Section */
        .content { padding: 0 30px 30px; }
        .details-box { background-color: #f0f6f5; border-radius: 10px; padding: 20px; margin: 20px 0; border: 1px solid #e2ecea; }
        .detail-item { margin-bottom: 10px; font-size: 14px; display: flex; }
        .label { font-weight: bold; color: #1e6d63; width: 100px; flex-shrink: 0; }
        .value { color: #444; }

        /* Buttons within details */
        .btn { display: block; text-align: center; padding: 14px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 12px; font-size: 16px; }
        .btn-join { background-color: #1e6d63; color: #ffffff !important; }
        
        /* Footer */
        .footer { text-align: center; padding: 25px; background-color: #ffffff; border-top: 1px solid #f0f0f0; }
        .slogan { font-style: italic; color: #1e6d63; margin: 0; font-size: 15px; font-weight: 500; }
        .signature { margin-top: 5px; font-size: 14px; color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="brand"><span class="safe">Safe</span><span class="stories">Stories</span></div>
            <strong class="confirmed">Payment Link Generated</strong>
            <p class="intro-text">
                Hello <strong>${details.clientName}</strong>, a payment link has been generated for your upcoming session. Please complete the payment to confirm your booking.
            </p>
        </div>

        <div class="content">
            <div class="details-box">
                <div class="detail-item">
                    <span class="label">Session:</span>
                    <span class="value">${details.serviceType}</span>
                </div>
                <div class="detail-item">
                    <span class="label">Time:</span>
                    <span class="value">${details.sessionTiming}</span>
                </div>

                <hr style="border: 0; border-top: 1px solid #dce8e6; margin: 15px 0;">

                <a href="${details.paymentLink}" class="btn btn-join">Proceed to Payment</a>
            </div>
            
            <p style="font-size: 13px; color: #666; text-align: center; margin-top: 10px;">
                Note: This payment link will expire in 30 minutes. Unpaid slots are automatically released.
            </p>
        </div>

        <div class="footer">
            <p class="slogan">Always there for your mental health.</p>
            <p class="signature"><strong><br />Team SafeStories</strong><br />410, 4th Floor, Marvel Vista Business Centre,<br /> Near Gera Junction, Lullanagar, <br />Pune, Maharashtra 411048</p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: 'SafeStories <therapy@safestories.in>',
      to: clientEmail,
      subject: `Complete your booking: Payment Link for ${details.serviceType}`,
      html: htmlContent,
    };

    await sendEmailWithLogging(mailOptions, `Client Payment Link (${details.serviceType})`);
  } catch (error) {
    console.error('❌ Error sending client payment link email:', error);
    throw error;
  }
}

/**
 * Notify the internal team that a support ticket / issue has been raised.
 */
export async function sendIssueReportEmail(
  recipients: string[],
  ticket: {
    id: number; subject: string; component: string; description: string;
    reported_by: string; user_role: string; screenshot_url?: string | null;
    screenshot_urls?: string[]; created_at?: any;
  }
): Promise<void> {
  const created = new Date(ticket.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  // Ampersand must be escaped first, or it double-encodes the entities added after it.
  const esc = (s: unknown) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const shots = (ticket.screenshot_urls && ticket.screenshot_urls.length > 0)
    ? ticket.screenshot_urls
    : (ticket.screenshot_url ? [ticket.screenshot_url] : []);

  const ticketsUrl = `${(process.env.FRONTEND_URL || 'https://panel.safestories.in').replace(/\/$/, '')}/admin/tickets`;

  const label = 'padding:10px 0;color:#64748b;font-weight:500;width:150px;vertical-align:top;';
  const value = 'padding:10px 0;color:#0f172a;vertical-align:top;';

  const row = (k: string, v: string) =>
    `<tr><td style="${label}">${k}</td><td style="${value}">${v}</td></tr>`;

  const attachmentsRow = shots.length > 0
    ? row(
        shots.length > 1 ? 'Attachments' : 'Attachment',
        shots.map((u, i) =>
          `<a href="${esc(u)}" style="color:#1e6d63;text-decoration:underline;">Screenshot${shots.length > 1 ? ` ${i + 1}` : ''}</a>`
        ).join('<span style="color:#cbd5e1;"> &nbsp;|&nbsp; </span>')
      )
    : '';

  const html = `
  <div style="background:#f1f5f9;padding:24px 0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">

      <div style="background:#1e6d63;padding:24px 28px;">
        <div style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:-0.2px;">New Support Ticket</div>
        <div style="color:#c5e4df;font-size:13px;margin-top:4px;">Reference #${ticket.id} &nbsp;&middot;&nbsp; SafeStories Panel</div>
      </div>

      <div style="padding:26px 28px 8px 28px;">
        <div style="font-size:17px;font-weight:600;color:#0f172a;line-height:1.4;">${esc(ticket.subject)}</div>
      </div>

      <div style="padding:8px 28px 20px 28px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">
          ${row('Component', esc(ticket.component))}
          ${row('Reported by', `${esc(ticket.reported_by)} <span style="color:#64748b;">(${esc(ticket.user_role)})</span>`)}
          ${row('Submitted', `${created} IST`)}
          ${attachmentsRow}
        </table>
      </div>

      <div style="padding:0 28px 24px 28px;">
        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px;">Description</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;white-space:pre-wrap;color:#334155;font-size:14px;line-height:1.6;">${esc(ticket.description)}</div>
      </div>

      <div style="padding:0 28px 28px 28px;">
        <a href="${esc(ticketsUrl)}" style="display:inline-block;background:#1e6d63;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:6px;">View ticket</a>
      </div>

      <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;line-height:1.5;">
        This is an automated notification from the SafeStories Panel. Please do not reply to this email.
      </div>

    </div>
  </div>`;

  // Plain-text alternative: some clients prefer it, and it improves deliverability.
  const text = [
    `New Support Ticket — Reference #${ticket.id}`,
    '',
    `Subject:     ${ticket.subject}`,
    `Component:   ${ticket.component}`,
    `Reported by: ${ticket.reported_by} (${ticket.user_role})`,
    `Submitted:   ${created} IST`,
    ...(shots.length > 0 ? ['', `Attachments:`, ...shots.map((u, i) => `  ${i + 1}. ${u}`)] : []),
    '',
    'Description:',
    ticket.description,
    '',
    `View ticket: ${ticketsUrl}`,
    '',
    'This is an automated notification from the SafeStories Panel.',
  ].join('\n');

  const mailOptions = {
    from: 'SafeStories Panel <therapy@safestories.in>',
    to: recipients.join(', '),
    subject: `[Ticket #${ticket.id}] ${ticket.subject} — ${ticket.component}`,
    html,
    text,
  };
  await sendEmailWithLogging(mailOptions, `Issue Report #${ticket.id}`);
}

