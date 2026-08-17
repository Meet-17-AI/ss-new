/**
 * WhatsApp verification for the public booking page.
 *
 * Kept apart from src/otp.ts, which verifies an ADMIN performing a privileged
 * action and reaches a fixed mailbox. This one faces the open internet: anyone
 * can post any number to it, so the limits below are not tidiness, they are the
 * feature. Without them the endpoint is a free way to send WhatsApp messages to
 * strangers on SafeStories' account and at SafeStories' cost.
 *
 * In-memory on purpose, matching the throttle next door: one process, a five
 * minute lifetime, and a restart mid-flow costs the client one "Resend". Nothing
 * here is worth persisting - and an OTP written to a table outlives the thirty
 * seconds it was useful for.
 */
import { sendAiSensyMessage } from '../automations/whatsapp';

/** AiSensy campaign. Body is a single variable: {{1}} = the code. */
const CAMPAIGN = process.env.AISENSY_OTP_CAMPAIGN || 'public_verification';

const OTP_TTL_MS = 5 * 60 * 1000;
/** Long enough that a slow WhatsApp delivery is not mistaken for a failure. */
const RESEND_COOLDOWN_MS = 45 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
/** Per number. A real client needs one, maybe two if the first is slow. */
const MAX_SENDS_PER_NUMBER = 5;
/** Per code. Six digits is a million guesses; five attempts makes that hopeless. */
const MAX_ATTEMPTS = 5;

type Pending = { otp: string; expiresAt: number; attempts: number; sentAt: number };

const pending = new Map<string, Pending>();
const sendHistory = new Map<string, number[]>();

/** Digits only, so "+91 77758 97124" and "917775897124" are one number. */
export const otpKey = (phone: string): string => String(phone || '').replace(/\D/g, '');

const sweep = (now: number) => {
  if (pending.size > 5000) {
    for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  }
  if (sendHistory.size > 5000) {
    for (const [k, v] of sendHistory) {
      if (v.every(t => now - t >= SEND_WINDOW_MS)) sendHistory.delete(k);
    }
  }
};

export type SendResult =
  | { ok: true; expiresInSec: number; resendInSec: number }
  | { ok: false; error: string; retryAfterSec?: number };

export async function sendPublicOtp(phone: string, name?: string): Promise<SendResult> {
  const key = otpKey(phone);
  // 10 national digits, or up to 15 with a country code (E.164's own ceiling).
  if (key.length < 10 || key.length > 15) {
    return { ok: false, error: 'Enter a valid WhatsApp number.' };
  }

  const now = Date.now();
  sweep(now);

  const existing = pending.get(key);
  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      error: 'A code was just sent. Please wait a moment before asking for another.',
      retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000),
    };
  }

  const recent = (sendHistory.get(key) || []).filter(t => now - t < SEND_WINDOW_MS);
  if (recent.length >= MAX_SENDS_PER_NUMBER) {
    return { ok: false, error: 'Too many codes requested for this number. Please try again later.' };
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));

  // Sent BEFORE it is stored, so a WhatsApp failure cannot leave a code the
  // client was never told about sitting in the way of the next attempt.
  await sendAiSensyMessage(`public_verification_${key}`, CAMPAIGN, phone, name?.trim() || 'there', [otp]);

  recent.push(now);
  sendHistory.set(key, recent);
  pending.set(key, { otp, expiresAt: now + OTP_TTL_MS, attempts: 0, sentAt: now });

  // Never log the code itself.
  console.log(`[Public OTP] Code sent to ...${key.slice(-4)}`);
  return {
    ok: true,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    resendInSec: Math.floor(RESEND_COOLDOWN_MS / 1000),
  };
}

export type VerifyResult = { ok: true } | { ok: false; error: string };

export function verifyPublicOtp(phone: string, providedOtp: string): VerifyResult {
  const key = otpKey(phone);
  const code = String(providedOtp || '').replace(/\D/g, '');
  const record = pending.get(key);

  // No record and a wrong code answer the same way. Anything more specific tells
  // a caller whether a number currently has a code outstanding.
  if (!record) return { ok: false, error: 'That code is not valid. Please request a new one.' };

  if (Date.now() > record.expiresAt) {
    pending.delete(key);
    return { ok: false, error: 'That code has expired. Please request a new one.' };
  }

  if (record.otp !== code) {
    record.attempts += 1;
    if (record.attempts >= MAX_ATTEMPTS) {
      // Burn it. Continuing to accept guesses against a known code is the one
      // thing that would make six digits worth attacking.
      pending.delete(key);
      return { ok: false, error: 'Too many incorrect attempts. Please request a new code.' };
    }
    return { ok: false, error: 'That code is not correct.' };
  }

  pending.delete(key); // single use
  return { ok: true };
}
