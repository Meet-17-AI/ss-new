const axios = require('axios');
const { Resend } = require('resend');
const AISENSY_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZGE1MjM4Njg5NTEwMGQ1MmYwMTBiNCIsIm5hbWUiOiJTYWZldHkgYW5kIFlvdSBXZWxsYmVpbmcgQ2VudHJlIExMUCIsImFwcE5hbWUiOiJBaVNlbnN5IiwiY2xpZW50SWQiOiI2OGRhNTIzODY4OTUxMDBkNTJmMDEwYWYiLCJhY3RpdmVQbGFuIjoiRlJFRV9GT1JFVkVSIiwiaWF0IjoxNzU5MTM4MzYwfQ.PvyEtnljNQ9nTOaxciZvsGSm7kXi6F0NpHtMk3DYaAU";
const RESEND_API_KEY = "re_ExR6kbk6_DCfAfXCBYHDgcwUeVK5u7PyP";

const nodemailer = require('nodemailer');

async function sendWhatsApp(campaignName, destination, userName, templateParams) {
  try {
    const payload = {
      apiKey: AISENSY_API_KEY,
      campaignName,
      destination,
      userName,
      templateParams,
    };
    const res = await axios.post('https://backend.aisensy.com/campaign/t1/api/v2', payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    throw new Error(err.response ? JSON.stringify(err.response.data) : err.message);
  }
}

const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'therapy@safestories.in',
    pass: 'psmb apmu rgoo pxfu'
  }
});

async function sendEmail(to, subject, htmlContent) {
  const info = await gmailTransporter.sendMail({
    from: 'therapy@safestories.in',
    to,
    subject,
    html: htmlContent
  });
  return info;
}

// Emulate getEmailHtml from email.ts (simplified for testing)
function getEmailHtml(details, isOnline) {
  const calendarLink = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(details.sessionName)}&dates=${details.calendarStartRaw}/${details.calendarEndRaw}&location=${encodeURIComponent(details.joinLink)}`;
  const locationText = isOnline ? 'Google Meet' : 'SafeStories Office - Lullanagar, Pune';
  
  return `
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
                    <span class="value">${locationText}</span>
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
}


async function runTest() {
  const phone = '917775897124';
  const email = 'meetpandya@fluid.live';
  
  const clientName = 'test';
  const sessionName = 'individual theray session';
  const therapistName = 'muskan';
  const inviteeTimeStr = 'random test time';
  const checkinUrl = 'random test url';
  
  const dateStr = 'Test Date';
  const timeRangeStr = 'Test Time';
  const calendarStartRaw = '20260716T043000Z';
  const calendarEndRaw = '20260716T052000Z';

  console.log('--- TEST 1: ONLINE MODE ---');
  try {
    console.log('Sending WhatsApp (Online)...');
    await sendWhatsApp(
      'session_confirmed_message_api_campaign',
      phone,
      clientName,
      [clientName, sessionName, inviteeTimeStr, checkinUrl]
    );
    console.log('✅ WhatsApp (Online) sent!');
    
    console.log('Sending Email (Online)...');
    await sendEmail(
      email,
      `Session Confirmed: ${sessionName}`,
      getEmailHtml({
        clientName,
        inviteeTimeStr,
        sessionName,
        dateStr,
        timeRangeStr,
        duration: 50,
        joinLink: 'https://meet.google.com/test-link',
        checkinUrl,
        calendarStartRaw,
        calendarEndRaw
      }, true)
    );
    console.log('✅ Email (Online) sent!');
  } catch (err) {
    console.error('❌ Error in Test 1:', err);
  }

  console.log('\n--- TEST 2: IN-PERSON MODE ---');
  try {
    console.log('Sending WhatsApp (In-Person)...');
    await sendWhatsApp(
      'session_confirmed_message_api_campaign',
      phone,
      clientName,
      [clientName, sessionName, inviteeTimeStr, checkinUrl]
    );
    console.log('✅ WhatsApp (In-Person) sent!');
    
    console.log('Sending Email (In-Person)...');
    await sendEmail(
      email,
      `Session Confirmed: ${sessionName}`,
      getEmailHtml({
        clientName,
        inviteeTimeStr,
        sessionName,
        dateStr,
        timeRangeStr,
        duration: 50,
        joinLink: 'https://share.google/test-location',
        checkinUrl,
        calendarStartRaw,
        calendarEndRaw
      }, false)
    );
    console.log('✅ Email (In-Person) sent!');
  } catch (err) {
    console.error('❌ Error in Test 2:', err);
  }
}

runTest().then(() => console.log('Done!'));
