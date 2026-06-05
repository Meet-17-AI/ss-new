import { sendAdminOTPEmail } from './src/automations/email.ts';

async function testEmail() {
  try {
    console.log('Sending test OTP email to Meetpandya@fluid.live...');
    await sendAdminOTPEmail('Meetpandya@fluid.live', 'Test Action from Terminal', '123456');
    console.log('Done!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testEmail();
