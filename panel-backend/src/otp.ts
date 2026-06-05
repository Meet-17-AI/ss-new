import { sendAiSensyMessage } from './automations/whatsapp';
import { sendAdminOTPEmail } from './automations/email';
import crypto from 'crypto';

// In-memory store for OTPs
// { [otpId]: { otp: string, expiresAt: number } }
const otpStore: Record<string, { otp: string, expiresAt: number }> = {};

const ADMIN_PHONE = '7775897124';
const ADMIN_EMAIL = 'Meetpandya@fluid.live';

function generateRandomOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function generateAdminOTP(action: string): Promise<string> {
  const otp = generateRandomOTP();
  const otpId = crypto.randomUUID();
  
  // Store OTP (valid for 5 mins)
  otpStore[otpId] = {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000
  };

  // Clean up expired ones
  Object.keys(otpStore).forEach(key => {
    if (otpStore[key].expiresAt < Date.now()) {
      delete otpStore[key];
    }
  });

  // 1. Send via Email
  try {
    await sendAdminOTPEmail(ADMIN_EMAIL, action, otp);
  } catch (err) {
    console.error('Failed to send Admin OTP Email:', err);
  }

  // 2. Send via AiSensy
  try {
    await sendAiSensyMessage(
      otpId,
      'admin_dashboard_action_otp_verification',
      ADMIN_PHONE,
      'Admin',
      [action, otp]
    );
  } catch (err) {
    console.error('Failed to send Admin OTP AiSensy Message:', err);
  }

  return otpId;
}

export function verifyAdminOTP(otpId: string, providedOtp: string): boolean {
  const record = otpStore[otpId];
  if (!record) return false;

  if (Date.now() > record.expiresAt) {
    delete otpStore[otpId];
    return false;
  }

  if (record.otp === providedOtp) {
    // Delete after successful verification to prevent reuse
    delete otpStore[otpId];
    return true;
  }

  return false;
}
