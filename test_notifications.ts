import { sendBookingConfirmedClient } from './panel-backend/src/automations/whatsapp';
import { sendClientBookingConfirmationEmail } from './panel-backend/src/lib/email';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, 'panel-backend', '.env.local') });

async function runTest() {
  const phone = '917775897124';
  const email = 'meetpandya@fluid.live';
  
  const clientName = 'Test User';
  const sessionName = 'Individual Therapy Session';
  const therapistName = 'Muskan';
  const inviteeTimeStr = 'Thursday, Jul 16, 2026 at 10:00 AM - 10:50 AM IST';
  const checkinUrl = 'https://panel.safestories.in/booking-confirmation/test-123';
  const dateStr = 'Thursday, Jul 16, 2026';
  const timeRangeStr = '10:00 AM - 10:50 AM';
  const calendarStartRaw = '20260716T043000Z';
  const calendarEndRaw = '20260716T052000Z';

  console.log('--- TEST 1: ONLINE MODE ---');
  try {
    console.log('Sending WhatsApp (Online)...');
    await sendBookingConfirmedClient(
      'test-online-1',
      phone,
      clientName,
      sessionName,
      inviteeTimeStr,
      checkinUrl
    );
    console.log('✅ WhatsApp (Online) sent!');
    
    console.log('Sending Email (Online)...');
    await sendClientBookingConfirmationEmail(
      email,
      {
        clientName,
        inviteeTimeStr,
        sessionName,
        dateStr,
        timeRangeStr,
        duration: 50,
        joinLink: 'https://meet.google.com/abc-defg-hij', // Google Meet link
        checkinUrl,
        calendarStartRaw,
        calendarEndRaw
      }
    );
    console.log('✅ Email (Online) sent!');
  } catch (err) {
    console.error('❌ Error in Test 1:', err);
  }

  console.log('\n--- TEST 2: IN-PERSON MODE ---');
  try {
    console.log('Sending WhatsApp (In-Person)...');
    await sendBookingConfirmedClient(
      'test-inperson-1',
      phone,
      clientName,
      sessionName,
      inviteeTimeStr,
      checkinUrl
    );
    console.log('✅ WhatsApp (In-Person) sent!');
    
    console.log('Sending Email (In-Person)...');
    await sendClientBookingConfirmationEmail(
      email,
      {
        clientName,
        inviteeTimeStr,
        sessionName,
        dateStr,
        timeRangeStr,
        duration: 50,
        joinLink: 'in-person', // This tells the email it's not a GMeet link
        checkinUrl,
        calendarStartRaw,
        calendarEndRaw
      }
    );
    console.log('✅ Email (In-Person) sent!');
  } catch (err) {
    console.error('❌ Error in Test 2:', err);
  }
}

runTest().then(() => {
  console.log('Done!');
  process.exit(0);
});
