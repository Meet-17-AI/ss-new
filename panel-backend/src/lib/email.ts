import { Resend } from 'resend';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const resendApiKey = process.env.RESEND_API_KEY || 'missing_api_key';
const resend = new Resend(resendApiKey);

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
                    <a href="${process.env.FRONTEND_URL || "https://safestories-dashboard.vercel.app/"}" style="display: inline-block; background-color: #21615D; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
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
      from: 'Resend <onboarding@resend.dev>',
      to: email,
      subject: '🔐 Your SafeStories Profile Setup OTP',
      html: htmlContent,
      text: `Hello ${therapistName},

Welcome to SafeStories! Your One-Time Password (OTP) for profile setup is: ${otp}

This OTP will expire on ${expiryTime}.

🔐 LOGIN LINK: ${process.env.FRONTEND_URL || "https://safestories-dashboard.vercel.app/"}

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

    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Resend API Error:', error);
      throw error;
    }
    console.log('✅ Email sent successfully:', data?.id);
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
      from: 'Resend <onboarding@resend.dev>',
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

    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Resend API Error:', error);
      throw error;
    }
    console.log('✅ Password reset email sent successfully:', data?.id);
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
    // Resend doesn't require explicit verification
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
      from: 'Resend <onboarding@resend.dev>',
      to: adminEmail,
      subject: `New Session Confirmed: ${details.sessionName}`,
      html: htmlContent,
    };

    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Resend API Error:', error);
      throw error;
    }
    console.log('✅ Admin booking confirmation email sent successfully:', data?.id);
  } catch (error) {
    console.error('❌ Error sending admin booking confirmation email:', error);
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
  }
): Promise<void> {
  try {
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
                    <span class="value">Google Meet</span>
                </div>

                <hr style="border: 0; border-top: 1px solid #dce8e6; margin: 15px 0;">

                <a href="${details.joinLink}" class="btn btn-join">Join Session</a>
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
      from: 'Resend <onboarding@resend.dev>',
      to: clientEmail,
      subject: `Session Confirmed: ${details.sessionName}`,
      html: htmlContent,
    };

    const { data, error } = await resend.emails.send(mailOptions);
    if (error) {
      console.error('❌ Resend API Error:', error);
      throw error;
    }
    console.log('✅ Client booking confirmation email sent successfully:', data?.id);
  } catch (error) {
    console.error('❌ Error sending client booking confirmation email:', error);
    throw error;
  }
}
e x p o r t   a s y n c   f u n c t i o n   s e n d S O S A d m i n E m a i l ( a d m i n E m a i l :   s t r i n g ,   d e t a i l s :   a n y )   {   c o n s t   m a i l O p t i o n s   =   {   f r o m :   ' S a f e S t o r i e s   < n o - r e p l y @ s a f e s t o r i e s . i n > ' ,   t o :   a d m i n E m a i l ,   s u b j e c t :   \ S O S   A l e r t   R a i s e d   |   I m m e d i a t e   A t t e n t i o n   R e q u i r e d   -   \ \ ,   h t m l :   \ < p > H e l l o ! < b r   / > < b r   / >   A n   S O S   h a s   b e e n   r a i s e d   f o l l o w i n g   a   t h e r a p y   s e s s i o n .   P l e a s e   r e v i e w   t h e   d e t a i l s   b e l o w   a n d   i n i t i a t e   t h e   r e q u i r e d   s a f e t y   s t e p s   a s   p e r   r i s k   p r o t o c o l .   < b r   / > < b r   / > C l i e n t   D e t a i l s   < b r   / > �%  C l i e n t   N a m e : & n b s p ; \ < b r   / > �%  C l i e n t   P h o n e   N u m b e r : & n b s p ; \ < b r   / >   �%  T h e r a p i s t   N a m e : & n b s p ; \ < b r   / > �%  L a s t   S e s s i o n   D a t e   & a m p ;   T i m e : & n b s p ; \ < b r   / > �%  M o d e   o f   S e s s i o n : & n b s p ; \ < b r   / > �%  N u m b e r   o f   s e s s i o n s : & n b s p ; \ < b r   / > �%  E m e r g e n c y   C o n t a c t   N a m e : & n b s p ; \ < b r   / > �%& n b s p ; E m e r g e n c y   C o n t a c t   N u m b e r : & n b s p ; \ < b r   / > < b r   / > S O S   S u m m a r y   < b r   / > �%  R i s k   S e v e r i t y   ( 1 - 5 ) : & n b s p ; \ < b r   / > �%  C u r r e n t   R i s k   I n d i c a t o r s : & n b s p ; \ < b r   / > �%  R i s k   s u m m a r y : & n b s p ; \ < b r   / > < b r   / > L i n k   t o   c l i e n t & r s q u o ; s   d o c u m e n t a t i o n   p r o f i l e :   \ . < b r   / > < b r   / > < b r   / > T h a n k   y o u   f o r   r e s p o n d i n g   p r o m p t l y   a n d   s u p p o r t i n g   c l i e n t   s a f e t y . < / p > \   } ;   t r y   {   a w a i t   r e s e n d . e m a i l s . s e n d ( m a i l O p t i o n s ) ;   c o n s o l e . l o g ( ' '  S O S   A d m i n   e m a i l   s e n t   s u c c e s s f u l l y ' ) ;   }   c a t c h   ( e r r o r )   {   c o n s o l e . e r r o r ( ' L'  E r r o r   s e n d i n g   S O S   A d m i n   e m a i l : ' ,   e r r o r ) ;   }   }  
 