import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { randomUUID } from 'crypto';
import pool from './lib/db';
import { startSessionRemindersCron } from './automations/cron';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { convertToIST, getBookingStartMs } from './lib/timezone';
import { uploadFile } from './lib/minio';
import { sendOTPEmail, sendPasswordResetOTP, sendClientBookingConfirmationEmail, sendAdminBookingConfirmationEmail, sendTherapistBookingConfirmationEmail, sendClientBookingCancellationEmail, sendPaymentLinkEmail, sendIssueReportEmail, sendBookingLinkEmail, sendClientTherapistTransferEmail } from './lib/email';
import { sendSOSAdminWhatsapp, sendSOSAdminEmail, sendAiSensyMessage, sendSessionFeedbackRequest, sendPostSessionTherapistForm } from './automations/index';
import { generateAdminOTP, verifyAdminOTP } from './otp';
import { sendPublicOtp, verifyPublicOtp, otpKey } from './lib/publicOtp';
import { logWebhookApi } from './lib/webhookApiLogger.js';
import { createNotification, notifyAllAdmins } from './lib/notifications';
import { logActivity, categoryForRole, extractSafeMetadata } from './lib/activityLog';
import { authLimiter, publicLimiter, apiLimiter } from './lib/rateLimit';
import { securityHeaders } from './lib/securityHeaders';
import {
  Scope, ALL_SCOPES, isScope, baseScopeForRole, baseScopesForRole, grantableScopes, loadScopes,
  invalidateAccess, mayManageAccess, isAccessAdminIdentity, requireScope, requireAccessAdmin, scopeGate,
  requireTherapistScope, mayAccessClientRecords, requireClientRecordAccess,
  getShadowDenials, isEnforcing, isBaseAdminRole, requireSuperAdmin,
} from './lib/access';
import {
  resolvePrice, recordPriceLock, logPriceResolution, resolveServiceIdFromLabel,
  normalizeEmail, normalizePhoneDigits, parseCharges, istDateToTimestamp, syncLegacyCharges,
} from './lib/pricing';
import {
  buildClientKey, isWalletEligible, getBalance, getBalanceForClient, creditWallet,
  debitWallet, getTransactions, listWallets, getTotalLiability, remapClientKey,
  consolidateWallet, InsufficientWalletBalance,
} from './lib/wallet';
import { loadAvailability, assessSlot, holdsASlot, withTherapistSlotLock } from './lib/slots';
import {
  findClientBookings, buildPreview, assessMoney, sessionNameOf, formatInviteeTime,
  findExistingTransfer, applyDecision, settleCancelledSession, balanceFor,
  removeOldEvent, createNewEvent, wasActuallyPaid,
} from './lib/transfer';

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit (reasonable for profile pictures)
  }
});

// Helper function to get current IST timestamp as formatted string
const getCurrentISTTimestamp = () => {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' IST';
};

const REMARK_COLUMN_MAP: Record<string, string> = {
  'lead-inquire': 'remark_lead_inquire',
  'followup-1': 'remark_followup_1',
  'pretherapy-call': 'remark_pretherapy_call',
  'booked-first-session': 'remark_booked_first_session',
  'dropouts': 'remark_unresponsive',
  'leaks': 'remark_leaks',
  'referred': 'remark_referred',
  'closed': 'remark_closed',
};

const TIMESTAMP_COLUMN_MAP: Record<string, string> = {
  'lead-inquire': 'stage_lead_inquire_at',
  'followup-1': 'stage_followup_1_at',
  'followup-2': 'stage_followup_2_at',
  'followup-3': 'stage_followup_3_at',
  'pretherapy-call': 'stage_pretherapy_call_at',
  'booked-first-session': 'stage_booked_first_session_at',
  'dropouts': 'stage_dropouts_at',
  'leaks': 'stage_leaks_at',
  'referred': 'stage_referred_at',
  'closed': 'stage_closed_at',
};

// ==================== ENVIRONMENT VALIDATION ====================
// Warn about missing environment variables but allow app to start
const requiredEnvVars = ['JWT_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn(`\n⚠️  Missing environment variables (using defaults): ${missingEnvVars.join(', ')}\n`);
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10');

// ==================== CREDENTIAL HELPERS ====================
// Historically `users.password` held plaintext for some rows and a bcrypt hash for
// others. Reads must tolerate both so existing accounts keep working, but every
// WRITE now hashes — so the plaintext rows drain away as people change passwords.
const isHashedPassword = (stored: unknown): boolean =>
  typeof stored === 'string' && /^\$2[aby]\$/.test(stored);

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!plain || !stored) return false;
  return isHashedPassword(stored) ? bcrypt.compare(plain, stored) : plain === stored;
}

const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

// The `users` row is built with SELECT *, so it carries the credential. Strip it
// before anything is sent to a client — the frontend persists this object into
// localStorage, so whatever ships here is stored on the user's disk.
function toSafeUser<T extends Record<string, any>>(user: T): Omit<T, 'password'> {
  const { password, ...safe } = user;
  return safe;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// The token is the ONLY thing the server trusts about who is calling. Keep the
// claims minimal — anything else can be looked up from the id at request time.
function issueToken(user: { id: any; username?: string; role: string; therapist_id?: any; email?: string }): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      therapist_id: user.therapist_id ?? null,
      email: user.email ?? null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

const app = express();

// Render (and every other PaaS here) terminates TLS at a proxy, so req.ip is the
// proxy's address unless this is set. Rate limiters key on req.ip — without this
// they would treat the entire internet as one client and throttle everyone the
// moment any single caller misbehaved. `1` = trust exactly one hop, which is the
// correct value for a single load balancer; trusting all hops would let a caller
// forge X-Forwarded-For and get a fresh bucket per request.
app.set('trust proxy', 1);

// Auto-migrate schema
(async () => {
  try {
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_initiated_at TIMESTAMP WITH TIME ZONE`);
    console.log('[DB] refund_initiated_at column ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // Extra dashboards granted on top of the one a role implies. Safe to create on
  // a live system: with no rows, everyone keeps exactly the access they have now.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_access_grants (
        user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope       TEXT        NOT NULL CHECK (scope IN ('admin_dashboard', 'therapist_dashboard', 'crm', 'superadmin')),
        granted_by  INTEGER,
        granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, scope)
      )
    `);

    // The table predates the superadmin tier, so a database created before it
    // still carries a CHECK that rejects the scope. CREATE TABLE IF NOT EXISTS
    // says nothing about a table that already exists, so the constraint is
    // replaced explicitly. Rewriting it to the same definition is a no-op.
    await pool.query(`
      ALTER TABLE user_access_grants DROP CONSTRAINT IF EXISTS user_access_grants_scope_check
    `);
    await pool.query(`
      ALTER TABLE user_access_grants ADD CONSTRAINT user_access_grants_scope_check
        CHECK (scope IN ('admin_dashboard', 'therapist_dashboard', 'crm', 'superadmin'))
    `);
    console.log('[DB] user_access_grants table ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // One-time tickets for moving a signed-in session to the CRM, which runs on a
  // different origin and therefore cannot see this one's localStorage.
  //
  // The row IS the single-use guarantee: redeeming deletes it atomically, so a
  // ticket that leaks from browser history or a referrer header is already spent.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_handoff_tokens (
        jti        TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        scope      TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS auth_handoff_expires_idx ON auth_handoff_tokens (expires_at)`);
    console.log('[DB] auth_handoff_tokens table ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // How many wrong codes have been offered against one reset request.
  //
  // This column is the actual fix for the reset-code brute force: throttling how
  // often a code can be SENT does nothing, because the attacker only needs one
  // code to exist and then wants a million guesses at it. Counting guesses
  // against the record is what bounds that. See /api/forgot-password/verify-otp.
  try {
    await pool.query(`ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`);
    console.log('[DB] password_reset_tokens.attempts column ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // A public, unguessable handle for one booking.
  //
  // booking_id is a six-digit number, so the public confirmation lookup keyed on
  // it could be walked end to end — every client's name, therapist, therapy type
  // and video joining link, for the price of 900k requests. This column is the
  // capability the public route keys on instead; booking_id stays the internal
  // key and stops being a credential.
  try {
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS public_token TEXT`);
    // Backfill every existing row, then keep it unique. gen_random_uuid() is
    // built in from PG13 and needs no extension; two uuids give 256 bits, well
    // past anything enumerable.
    await pool.query(`
      UPDATE bookings
         SET public_token = replace(gen_random_uuid()::text, '-', '')
                         || replace(gen_random_uuid()::text, '-', '')
       WHERE public_token IS NULL
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_public_token ON bookings (public_token)`);

    // Repoint the stored check-in URLs at the token.
    //
    // Every existing row holds ".../booking-confirmation/<booking_id>", and that
    // link now 404s — the reschedule flow sends this exact string to clients over
    // WhatsApp and email, so leaving it would break the link in every message
    // about an existing booking. The origin is preserved (rows carry a mix of
    // production and localhost) and only the final path segment is swapped.
    //
    // The NOT LIKE guard makes this a no-op on every boot after the first.
    const repointed = await pool.query(`
      UPDATE bookings
         SET public_booking_checkin_url =
               regexp_replace(public_booking_checkin_url,
                              '/booking-confirmation/[^/]*$',
                              '/booking-confirmation/' || public_token)
       WHERE public_token IS NOT NULL
         AND public_booking_checkin_url LIKE '%/booking-confirmation/%'
         AND public_booking_checkin_url NOT LIKE '%' || public_token
    `);
    if (repointed.rowCount) {
      console.log(`[DB] repointed ${repointed.rowCount} check-in URL(s) at public_token.`);
    }
    console.log('[DB] bookings.public_token column ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // Close the duplicate-lock path for clients who have no email on file.
  //
  // uq_client_price_lock_email only covers rows WHERE client_email IS NOT NULL,
  // so a phone-only client matched no unique index at all and recordPriceLock's
  // ON CONFLICT DO NOTHING could never fire — one new lock row per confirmed
  // booking, forever. This mirrors that index for exactly the rows it misses.
  // Scoped to client_email IS NULL so the documented many-phones-per-email case
  // (338 emails, 376 phones in live data) still inserts freely.
  try {
    await pool.query(`
      DELETE FROM client_price_lock a
       USING client_price_lock b
       WHERE a.released_at IS NULL AND b.released_at IS NULL
         AND a.client_email IS NULL AND b.client_email IS NULL
         AND a.client_phone_digits IS NOT NULL
         AND a.client_phone_digits = b.client_phone_digits
         AND a.service_id = b.service_id
         AND a.id > b.id
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_client_price_lock_phone_only
        ON client_price_lock (client_phone_digits, service_id)
        WHERE released_at IS NULL AND client_email IS NULL AND client_phone_digits IS NOT NULL
    `);
    console.log('[DB] client_price_lock phone-only uniqueness ensured.');
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }

  // Give the Fluid admin a real users row.
  //
  // It used to be a hardcoded username/password pair compared in the login
  // handler, with a dummy id that matched no row — so it could not be disabled,
  // could not appear in the Roles tab, could not have its password changed, and
  // its credentials sat in the source. Everything that governs a user has to be
  // able to reach it, which means it has to be a row like any other.
  try {
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(username) = 'fluidadmin'");
    if (existing.rows.length === 0) {
      // Falls back to the previous password so an existing deployment keeps
      // working. That password is in git history, so it MUST be rotated — hence
      // the warning rather than a silent success.
      const initial = process.env.FLUIDADMIN_PASSWORD || 'Fluid@2026';
      await pool.query(
        `INSERT INTO users (username, password, name, full_name, email, role, is_active)
         VALUES ($1, $2, $3, $3, $4, 'fluidadmin', true)`,
        ['Fluidadmin', await hashPassword(initial), 'Fluid Admin', 'fluidadmin@safestories.in']
      );
      console.log('[DB] Fluidadmin user row created.');
      if (!process.env.FLUIDADMIN_PASSWORD) {
        console.warn(
          '[SECURITY] Fluidadmin was seeded with the old hardcoded password, which is in git history. ' +
          'Change it now from the panel, or set FLUIDADMIN_PASSWORD and delete the row to re-seed.'
        );
      }
    }
  } catch (err: any) {
    console.log('[DB Migration Error]', err.message);
  }
})();

// ==================== CORS CONFIGURATION ====================
// Determine allowed origins from environment or defaults
const getAllowedOrigins = () => {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  }
  // Default to localhost for development
  return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3006', 'http://localhost:3004'];
};

const corsOptions = {
  origin: getAllowedOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// CSP and friends, on every response including static assets and errors.
app.use(securityHeaders);

// Health check endpoint for zero-downtime deployment
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

// Authentication middleware
const authMiddleware = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/**
 * Identity for routes on the public allowlist, where authMiddleware never runs.
 *
 * /api/cancel-booking serves both an admin cancelling from the panel and a client
 * cancelling their own booking from the confirmation link. Both are legitimate,
 * but only the first may decide what happens to money. Returns the decoded user
 * when a valid token happens to be present, and null otherwise — never throws,
 * because an absent or bad token is the normal client case, not an error.
 */
const optionalUser = (req: any): any | null => {
  const token = req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

/**
 * Identifiers, from the CSPRNG rather than Math.random().
 *
 * Every generated id in this file used to be
 * `Math.floor(100000 + Math.random() * 900000)`. Two problems, and the second is
 * the one that bit: V8's generator is reconstructible from observed output, and
 * 900,000 values is small enough to walk end to end in an afternoon.
 *
 * `newBookingId` is deliberately 12 digits. At six, the birthday bound alone
 * makes a collision likely within a few thousand bookings — and booking_id is
 * the primary key, so a collision is a failed booking for a real client.
 */
const newSixDigitCode = (): string => String(crypto.randomInt(100000, 1000000));
const newBookingId = (): string => String(crypto.randomInt(100000000000, 1000000000000));

/**
 * The unguessable handle a client's confirmation link is keyed on.
 *
 * Separate from booking_id because the two do different jobs: booking_id is an
 * internal key that appears in logs, exports and staff conversation, while this
 * is a capability handed to one person. 256 bits, so enumeration is not a
 * consideration at any scale.
 */
const newPublicToken = (): string => crypto.randomBytes(32).toString('base64url');

const ADMIN_ROLES = ['admin', 'superadmin', 'fluidadmin'];
const isAdminUser = (user: any): boolean => Boolean(user && ADMIN_ROLES.includes(user.role));

/**
 * Who may DISCONNECT a Google Calendar.
 *
 * Deliberately an identity check, not a role: the AI team signs in with the
 * `admin` role — the very role this has to be distinguished from — so no role
 * test can express it.
 *
 * Connecting stays open to admins and therapists because it only ever ADDS a
 * token. Disconnecting drops the refresh token, and every booking on that
 * calendar silently stops syncing afterwards with nothing in the UI to say why,
 * so it is held to the one account that can put it back.
 *
 * Matched against both email and username, since therapist logins have no email.
 */
const CALENDAR_DISCONNECT_USERS = (process.env.CALENDAR_DISCONNECT_USERS || 'aiteam@fluid.live,aiteam')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const canDisconnectCalendar = (user: any): boolean =>
  Boolean(user) &&
  [user.email, user.username].some(
    (id: any) => id && CALENDAR_DISCONNECT_USERS.includes(String(id).toLowerCase())
  );

/**
 * Display text for each cancellation action, defined once so the Payments page,
 * the audit trail and the API all name the same thing identically. These strings
 * are written into refund_cancellation_table.refund_status, so changing one
 * renames it for historic rows too — treat them as stored values, not labels.
 */
const CANCELLATION_STATUS_LABEL: Record<string, string> = {
  no_refund: 'No Refund',
  wallet_credit: 'Added to Wallet',
  offline_refund: 'Offline Refund',
};

// ==================== PUBLIC ROUTE ALLOWLIST ====================
// Everything under /api requires a valid token EXCEPT these. Entries are matched
// against the exact path, so adding a route to the app does NOT silently make it
// public — it is closed by default.
//
// Method matters: GET /api/services powers the public directory, but POST/PUT/DELETE
// on the same path are admin operations and must stay authenticated.
const PUBLIC_API_ROUTES: { methods: string[]; pattern: RegExp }[] = [
  // --- authentication entry points (these mint tokens) ---
  { methods: ['POST'], pattern: /^\/api\/login$/ },
  // Exchanges a one-time ticket from the CRM for a session here. Necessarily
  // public: the caller has no session on this origin yet — that is the point.
  { methods: ['POST'], pattern: /^\/api\/handoff\/redeem$/ },
  { methods: ['POST'], pattern: /^\/api\/verify-therapist-otp$/ },
  { methods: ['POST'], pattern: /^\/api\/forgot-password\/(send-otp|verify-otp|reset)$/ },

  // --- public booking flow (/book/*) ---
  { methods: ['GET'],  pattern: /^\/api\/public\/services\/[^/]+$/ },
  // The bookable catalogue for the single public booking page. Read-only, and
  // carries no client data — only what a visitor is about to be shown.
  { methods: ['GET'],  pattern: /^\/api\/public\/catalogue$/ },
  // Redeems a booking-link token into its prefill. Public because the client
  // following the link is not logged in — the 128-bit token is the credential,
  // and an unknown one is indistinguishable from an expired one.
  { methods: ['GET'],  pattern: /^\/api\/public\/booking-link\/[^/]+$/ },
  { methods: ['GET'],  pattern: /^\/api\/services$/ },
  { methods: ['GET'],  pattern: /^\/api\/therapists-by-therapy$/ },
  { methods: ['GET'],  pattern: /^\/api\/therapist-availability$/ },
  // Which days a therapist works, so the public date picker can grey out the
  // rest. Read-only and no client data — it answers only from the schedule.
  { methods: ['GET'],  pattern: /^\/api\/therapist-open-days$/ },
  { methods: ['POST'], pattern: /^\/api\/fetch-slots$/ },
  { methods: ['POST'], pattern: /^\/api\/create-booking$/ },
  { methods: ['POST'], pattern: /^\/api\/create-pending-booking$/ },
  { methods: ['POST'], pattern: /^\/api\/public\/client-history$/ },
  // WhatsApp verification for the booking page. Public by necessity — the whole
  // point is to check a number belongs to the person holding the phone, before
  // they have any identity with us at all.
  { methods: ['POST'], pattern: /^\/api\/public\/(send|verify)-otp$/ },
  // Read-only price quote for the booking page. Returns a figure the visitor is
  // about to be shown anyway, and reports no membership signal an unauthenticated
  // caller could use to enumerate clients.
  { methods: ['POST'], pattern: /^\/api\/public\/resolve-price$/ },
  { methods: ['GET'],  pattern: /^\/api\/payment-settings\/public$/ },

  // --- payment checkout (/pay/*) ---
  { methods: ['POST'], pattern: /^\/api\/razorpay\/create-order$/ },
  { methods: ['POST'], pattern: /^\/api\/razorpay\/verify-payment$/ },
  { methods: ['POST'], pattern: /^\/api\/mark-payment-failed$/ },
  { methods: ['GET'],  pattern: /^\/api\/bookings\/[^/]+\/checkout-info$/ },
  { methods: ['POST'], pattern: /^\/api\/confirm-payment$/ },

  // --- booking confirmation (/booking-confirmation/*) ---
  // Keyed on the booking's 256-bit public_token, not its id — the token IS the
  // credential, which is what makes an unauthenticated route acceptable here.
  { methods: ['GET'],  pattern: /^\/api\/public\/booking\/[^/]+$/ },
  { methods: ['GET'],  pattern: /^\/api\/public\/booking\/[^/]+\/join-link$/ },
  { methods: ['POST'], pattern: /^\/api\/cancel-booking$/ },

  // --- client-facing session notes (/session-notes/*) ---
  { methods: ['GET'],  pattern: /^\/api\/session-notes-info$/ },
  { methods: ['POST'], pattern: /^\/api\/session-documentation$/ },
  { methods: ['GET', 'POST', 'DELETE'], pattern: /^\/api\/session-notes-draft$/ },

  // --- SOS documentation view (token-gated in the handler) ---
  { methods: ['GET'],  pattern: /^\/api\/sos-documentation$/ },

  // --- server-to-server: webhooks, cron, oauth callback ---
  { methods: ['POST'], pattern: /^\/api\/razorpay\/webhook$/ },
  { methods: ['POST'], pattern: /^\/api\/paperform-webhook\/(free-consultation|therapy-documentation)$/ },
  { methods: ['POST'], pattern: /^\/api\/webhook\/feedback$/ },
  { methods: ['POST'], pattern: /^\/api\/cron\/verify-pending-payments$/ },
  { methods: ['GET'],  pattern: /^\/api\/auth\/google\/callback$/ },
];

const isPublicApiRoute = (method: string, path: string): boolean =>
  PUBLIC_API_ROUTES.some(r => r.methods.includes(method) && r.pattern.test(path));

// ==================== RATE LIMITS ====================
// Registered BEFORE the auth gate on purpose: a credential-guessing attempt is
// exactly the traffic that never gets past authentication, so a limiter behind
// the gate would never see it.
//
// Anything that answers "is this credential correct?". These are the endpoints
// where volume is the whole attack.
const AUTH_RATE_LIMITED = /^\/api\/(login|verify-password|forgot-password\/|handoff\/redeem|verify-therapist-otp|otp\/|public\/(send|verify)-otp)/;

app.use((req: any, res: any, next: any) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.method === 'OPTIONS') return next();
  if (AUTH_RATE_LIMITED.test(req.path)) return authLimiter(req, res, next);
  // Unauthenticated reads that can be walked to harvest data in bulk.
  if (isPublicApiRoute(req.method, req.path)) return publicLimiter(req, res, next);
  return next();
});

// Global gate. Registered here — before any route is defined — so it applies
// regardless of the order routes are added further down the file.
app.use((req: any, res: any, next: any) => {
  // Non-/api paths (/health, /r/:code) are not part of the JSON API.
  if (!req.path.startsWith('/api/')) return next();
  // CORS preflight carries no Authorization header by design.
  if (req.method === 'OPTIONS') return next();
  if (isPublicApiRoute(req.method, req.path)) return next();
  return authMiddleware(req, res, next);
});

// Dashboard-scope gate. Registered directly after the auth gate, so req.user is
// populated, and before any route so it cannot be bypassed by declaration order.
//
// Starts in SHADOW mode — it logs what it would have blocked and lets it through.
// Set ACCESS_ENFORCE=true once the log is quiet. See lib/access.ts for why it is
// not default-deny on day one.
app.use(scopeGate);

// Backstop for authenticated traffic, keyed per user now that req.user exists.
// Generous — several dashboards poll — and aimed at a runaway loop or a scripted
// scrape rather than at ordinary use.
app.use((req: any, res: any, next: any) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.method === 'OPTIONS') return next();
  return apiLimiter(req, res, next);
});

// ==================== ACTIVITY LOGGING ====================
// Registered AFTER the auth gate so req.user is populated — that identity is the
// whole point, and it is why this could not have been built before auth existed.
// One middleware covers all routes, including ones added later; the previous
// approach was 7 hand-placed INSERTs across 158 routes.

// Reads are not logged: dashboards poll constantly and the noise would bury the
// actions that matter. Add specific GETs here if a read ever needs an audit trail.
const LOGGED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Never log the log endpoints themselves — reading logs would generate logs.
const LOG_EXEMPT = /^\/api\/(activity-logs|audit-logs|crm-audit-logs|automation-logs|webhook-api-logs|notifications)/;

app.use((req: any, res: any, next: any) => {
  if (!req.path.startsWith('/api/') || !LOGGED_METHODS.has(req.method)) return next();
  if (LOG_EXEMPT.test(req.path)) return next();

  const startedAt = Date.now();
  // 'finish' fires once the response is sent, so status and duration are known
  // and the user is never waiting on the log write.
  res.on('finish', () => {
    try {
      const user = req.user;
      const routePattern = req.route?.path
        ? (req.baseUrl || '') + req.route.path
        : req.path;
      logActivity({
        category: categoryForRole(user?.role),
        actorId: user?.id != null ? String(user.id) : null,
        actorName: user?.username ?? null,
        actorRole: user?.role ?? null,
        action: `${req.method} ${routePattern}`,
        method: req.method,
        route: routePattern,
        path: req.path,
        entityType: routePattern.split('/')[2] || null,
        entityId: req.params?.id != null ? String(req.params.id) : null,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ipAddress: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        metadata: extractSafeMetadata(req),
      });
    } catch (err: any) {
      console.error('[activityLog] middleware error:', err?.message || err);
    }
  });
  next();
});

// Decode the bearer token when one is present, without requiring it.
//
// Needed by routes on the PUBLIC_API_ROUTES allowlist that are public overall but
// have privileged branches inside them — the global gate calls next() for those
// paths without populating req.user, so the handler has no identity to check.
// Returns null for missing, malformed or expired tokens; never throws.
const getOptionalUser = (req: any): any | null => {
  const token = req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

const WALLET_REDEEM_ROLES = ['admin', 'superadmin', 'fluidadmin'];

/**
 * Authorization middleware — may this caller reach this route?
 *
 * Passes on EITHER the role or an equivalent granted scope. The second half is
 * what makes dashboard switching work: a therapist given admin access still has
 * `role: 'therapist'` — deliberately, since re-minting a token with a different
 * role would be privilege escalation dressed as a feature — so a plain role test
 * would 403 them out of every admin route they were just granted.
 *
 * The scope is derived from the allowed roles rather than passed in, so all ~31
 * existing call sites keep working unchanged and cannot drift apart from it.
 */
const requireRole = (allowedRoles: string[]) => {
  const equivalentScopes = new Set(
    allowedRoles.map(baseScopeForRole).filter(Boolean) as Scope[]
  );

  return async (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (allowedRoles.includes(req.user.role)) return next();

    try {
      const held = await loadScopes(req.user);
      if ([...equivalentScopes].some((s) => held.has(s))) return next();
    } catch (err: any) {
      console.error('[access] requireRole scope check failed:', err?.message || err);
      // Fall through to the denial. A lookup failure must not be a way in.
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
};

// Helper function for URL shortener
function generateShortCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function createShortUrl(longUrl: string) {
  const code = generateShortCode();
  await pool.query('INSERT INTO short_urls (short_code, long_url) VALUES ($1, $2)', [code, longUrl]);
  return code;
}

// Redirect shortened URLs
app.get('/r/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query('SELECT long_url FROM short_urls WHERE short_code = $1', [code]);
    if (result.rows.length > 0) {
      res.redirect(302, result.rows[0].long_url);
    } else {
      res.status(404).send('Link not found');
    }
  } catch (err) {
    console.error('Error redirecting short URL:', err);
    res.status(500).send('Server Error');
  }
});

// ==================== GOOGLE CALENDAR OAUTH CONFIG & ENDPOINTS ====================
import { google } from 'googleapis';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// No credential fallbacks. These previously inlined the real client id and
// secret after `process.env.X ||`, which put a live Google OAuth credential in
// the source tree and blocked a push to a public repo. The env vars are set in
// every deployment, so the fallbacks were dead code that only served to leak.
// Same rule as lib/db.ts: missing config should be loud, not silently wrong.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://panel.safestories.in/api/auth/google/callback';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn(
    '[Google OAuth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. ' +
    'Calendar connection and event creation will fail until they are configured.'
  );
}

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
};

/**
 * Hand the caller the Google consent URL to send the browser to.
 *
 * Returns JSON rather than a 302, because the 302 version could not be reached
 * at all. The Connect buttons navigate the whole page (`window.location.href`),
 * and a navigation carries no Authorization header — lib/authFetch.ts only
 * patches window.fetch — so every attempt died on the global gate with
 * "Missing authentication token" before Google was ever contacted.
 *
 * Fetching the URL keeps the token attached and the route authenticated; only
 * the final hop to accounts.google.com is a navigation, and that needs no token.
 */
// Guarded so a therapist cannot start a consent flow that would attach THEIR
// Google account to someone else's therapist record.
app.get('/api/auth/google/url', requireTherapistScope(r => r.query.therapistId || 'SafeStories'), (req, res) => {
  const therapistId = (req.query.therapistId as string) || 'SafeStories';
  const adminRedirect = req.query.adminRedirect === 'true';
  const oauth2Client = getOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  // Where to send the browser back to once Google is done. Carried through the
  // consent round trip so a connection started on localhost finishes on
  // localhost, instead of on whatever FRONTEND_URL names — that variable also
  // builds client booking links, so it cannot be repointed just to test OAuth.
  //
  // The caller states it, because the Origin header is NOT available here: this
  // request is same-origin (the page and /api share a host in dev via the Vite
  // proxy and in production), and browsers omit Origin on same-origin GETs.
  // Trusting it would be an open redirect, so it is only honoured when already
  // trusted for CORS; anything else is dropped and the callback falls back to
  // FRONTEND_URL. The header is still accepted for a cross-origin caller.
  const claimedOrigin = String(req.query.returnTo || req.headers.origin || '');
  const returnTo = getAllowedOrigins().includes(claimedOrigin) ? claimedOrigin : null;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: JSON.stringify({ therapistId, adminRedirect, returnTo })
  });

  res.json({ authUrl });
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  let therapistId = 'SafeStories';
  let adminRedirect = false;
  let returnTo: string | null = null;
  try {
    if (state) {
      const parsedState = JSON.parse(state as string);
      therapistId = parsedState.therapistId || 'SafeStories';
      adminRedirect = !!parsedState.adminRedirect;
      // Re-checked against the allowlist rather than trusted: state makes a round
      // trip through the browser, so an attacker can put any host in it. An
      // unrecognised one is dropped, never redirected to.
      returnTo = getAllowedOrigins().includes(parsedState.returnTo) ? parsedState.returnTo : null;
    }
  } catch (e) {
    console.error('Error parsing OAuth state:', e);
  }

  // Where the browser goes once this is finished — the origin that started the
  // flow when it is a known one, the configured frontend otherwise.
  const landingBaseUrl = () => returnTo || frontendBaseUrl();

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email || '';

    // RULE: Ensure this Google Calendar is not already connected to another therapist
    if (userEmail && therapistId !== 'SafeStories') {
      const existingCheck = await pool.query(
        `SELECT therapist_id, name FROM therapists 
         WHERE google_refresh_token IS NOT NULL 
           AND LOWER(contact_info) = LOWER($1) 
           AND therapist_id != $2 
           AND therapist_id != 'SafeStories'`,
        [userEmail, therapistId]
      );

      if (existingCheck.rows.length > 0) {
        console.error(`❌ Google Calendar ${userEmail} is already linked to therapist ${existingCheck.rows[0].name}`);
        const baseUrl = landingBaseUrl();

        if (adminRedirect) {
          return res.redirect(`${baseUrl}/admin?googleAuth=error&reason=already_linked`);
        } else {
          return res.redirect(`${baseUrl}/therapist?googleAuth=error&reason=already_linked`);
        }
      }
    }

    if (therapistId === 'SafeStories') {
      const checkTherapist = await pool.query(
        'SELECT * FROM therapists WHERE therapist_id = $1',
        ['SafeStories']
      );
      if (checkTherapist.rows.length === 0) {
        await pool.query(
          `INSERT INTO therapists (therapist_id, name, specialization, contact_info)
           VALUES ('SafeStories', 'SafeStories', 'Platform Calendar', $1)`,
          [userEmail || 'admin@safestories.in']
        );
      }
    }

    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3500 * 1000);
    
    await pool.query(
      `UPDATE therapists 
       SET google_refresh_token = COALESCE($1, google_refresh_token), google_access_token = $2, google_token_expiry = $3, contact_info = COALESCE(NULLIF($4, ''), contact_info)
       WHERE therapist_id = $5`,
      [tokens.refresh_token || null, tokens.access_token, expiryDate, userEmail, therapistId]
    );

    console.log(`✓ Connected Google Calendar successfully for therapist: ${therapistId} (${userEmail})`);

    const baseUrl = landingBaseUrl();

    // Route back to whoever initiated: admin flows send adminRedirect=true
    // explicitly. Therapists (adminRedirect=false) must always return to the
    // therapist dashboard — do NOT infer admin from therapistId==='SafeStories',
    // since that value is also the fallback default and would misroute them.
    if (adminRedirect) {
      res.redirect(`${baseUrl}/admin?googleAuth=success`);
    } else {
      res.redirect(`${baseUrl}/therapist?googleAuth=success`);
    }
  } catch (error) {
    console.error('❌ Error in Google OAuth callback:', error);
    res.status(500).send('Authentication failed. Please check logs.');
  }
});

async function getAuthenticatedClient(therapist: any) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: therapist.google_refresh_token,
    access_token: therapist.google_access_token,
    expiry_date: therapist.google_token_expiry ? new Date(therapist.google_token_expiry).getTime() : undefined
  });

  console.log(`[Token Refresh] Starting token refresh for ${therapist.name} (ID: ${therapist.therapist_id})`);
  console.log(`[Token Refresh] Has refresh_token: ${!!therapist.google_refresh_token}, Has access_token: ${!!therapist.google_access_token}`);

  try {
    const { credentials } = await oauth2Client.refreshAccessToken();
    console.log(`[Token Refresh] Successfully refreshed token for ${therapist.name}`);
    console.log(`[Token Refresh] Credentials response - access_token exists: ${!!credentials?.access_token}, expiry_date: ${credentials?.expiry_date}`);

    if (credentials?.access_token) {
      const expiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3500 * 1000);
      await pool.query(
        `UPDATE therapists SET google_access_token = $1, google_token_expiry = $2 WHERE therapist_id = $3`,
        [credentials.access_token, expiryDate, therapist.therapist_id]
      );
      console.log(`[Token Refresh] Updated tokens in database for ${therapist.name}, access_token saved`);
      // Update the oauth2Client with the new credentials
      oauth2Client.setCredentials({
        refresh_token: therapist.google_refresh_token,
        access_token: credentials.access_token,
        expiry_date: expiryDate
      });
    } else {
      console.error(`❌ [Token Refresh] No access_token in refresh response for ${therapist.name}. Credentials:`, credentials);
    }
  } catch (e: any) {
    console.error(`❌ [Token Refresh] Failed to refresh token for ${therapist.name}:`, e?.message || e);
    console.error(`[Token Refresh] Error code: ${e?.code}, Error status: ${e?.status}`);
  }
  return oauth2Client;
}

// Resolve the therapist that owns the Google Calendar an event lives on, and
// return an authenticated calendar client for it — using the SAME token source
// as event creation (therapists.google_refresh_token via getAuthenticatedClient).
// A booking's event was created on the therapist's calendar, so reschedule and
// cancel must patch/delete against that same calendar. Returns null when the
// therapist can't be resolved or has no connected Google Calendar.
async function getCalendarClientForBooking(bookingDetails: any): Promise<{ calendar: any; therapist: any } | null> {
  let therapist: any = null;
  if (bookingDetails.therapist_id) {
    const tr = await pool.query('SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1', [bookingDetails.therapist_id]);
    therapist = tr.rows[0] || null;
  }
  if (!therapist && bookingDetails.booking_host_name) {
    const tr = await pool.query('SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1', [`%${String(bookingDetails.booking_host_name).split(' ')[0]}%`]);
    therapist = tr.rows[0] || null;
  }
  if (!therapist || !therapist.google_refresh_token) return null;
  const oauth2Client = await getAuthenticatedClient(therapist);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  return { calendar, therapist };
}

app.post('/api/auth/google/disconnect', async (req: any, res) => {
  try {
    // The token is already required by the global gate; this narrows it further
    // to the one account allowed to break a calendar link. Checked here rather
    // than as middleware because the rule is an identity, not a role — see
    // CALENDAR_DISCONNECT_USERS. Hiding the button is not the control; this is.
    if (!canDisconnectCalendar(req.user)) {
      return res.status(403).json({ error: 'Only the AI team can disconnect a Google Calendar.' });
    }

    const { therapistId } = req.body;
    if (!therapistId) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    await pool.query(
      `UPDATE therapists 
       SET google_refresh_token = NULL, google_access_token = NULL, google_token_expiry = NULL 
       WHERE therapist_id = $1`,
      [therapistId]
    );

    res.json({ success: true, message: 'Google Calendar disconnected successfully.' });
  } catch (error) {
    console.error('❌ Error disconnecting calendar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/google/status', requireTherapistScope(r => r.query.therapistId || 'SafeStories'), async (req, res) => {
  try {
    const therapistId = (req.query.therapistId as string) || 'SafeStories';
    const result = await pool.query(
      'SELECT google_refresh_token, contact_info FROM therapists WHERE therapist_id = $1',
      [therapistId]
    );

    if (result.rows.length === 0) {
      return res.json({ connected: false });
    }

    const therapist = result.rows[0];
    res.json({
      connected: !!therapist.google_refresh_token,
      email: therapist.google_refresh_token ? therapist.contact_info : null
    });
  } catch (error) {
    console.error('❌ Error checking Google connection status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/native/fetch-slots', async (req, res) => {
  try {
    const { therapistId, payload } = req.body;
    let availableSlots: string[] = [];

    // Fetch availability from DB
    const availRes = await pool.query(
      'SELECT availability_rules FROM therapist_availability WHERE therapist_id = $1',
      [therapistId]
    );

    if (availRes.rows.length > 0 && availRes.rows[0].availability_rules) {
      const rules = availRes.rows[0].availability_rules;
      const dayName = new Date(payload.selectedDate).toLocaleDateString('en-US', { weekday: 'long' });
      if (rules[dayName]) {
        for (const slotRange of rules[dayName]) {
          let current = new Date(`${payload.selectedDate}T${slotRange.start}:00`);
          const end = new Date(`${payload.selectedDate}T${slotRange.end}:00`);
          while (current < end) {
            const timeStr = current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            availableSlots.push(timeStr);
            current.setMinutes(current.getMinutes() + 60);
          }
        }
      }
    }

    if (therapistId) {
      try {
        const bookingsRes = await pool.query(
          `SELECT booking_invitee_time FROM bookings 
           WHERE (therapist_id = $1 OR therapist_id IS NULL) AND DATE(booking_start_at AT TIME ZONE 'Asia/Kolkata') = $2 AND booking_status NOT IN ('cancelled', 'Canceled', 'payment_failed')`,
          [therapistId, payload.selectedDate]
        );
        
        const bookedTimes = bookingsRes.rows.map(r => r.booking_invitee_time);
        availableSlots = availableSlots.filter(slot => {
          return !bookedTimes.some(bTime => bTime && bTime.includes(slot));
        });
      } catch (err) {
        console.error('Error fetching bookings to filter slots:', err);
      }
    }

    const realNow = new Date();
    const fourHoursFromNow = new Date(realNow.getTime() + 4 * 60 * 60 * 1000);
    
    availableSlots = availableSlots.filter(slot => {
      const [time, modifier] = slot.split(' ');
      let [hours, minutes] = time.split(':');
      if (hours === '12') hours = '00';
      if (modifier === 'PM') hours = (parseInt(hours, 10) + 12).toString();
      const slotDateIST = new Date(`${payload.selectedDate}T${hours.padStart(2, '0')}:${minutes}:00+05:30`);
      return slotDateIST >= fourHoursFromNow;
    });

    res.json([{ "Available Slots": availableSlots, success: true }]);
  } catch (error) {
    console.error('❌ Error in native fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Guarded explicitly rather than left to the blanket gate, which starts in
// shadow mode: this lists every therapist's calendar connection state.
app.get('/api/admin/therapists-calendars', requireScope('admin_dashboard'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT therapist_id, name, contact_info, profile_picture_url, 
              google_refresh_token IS NOT NULL AS connected,
              CASE WHEN google_refresh_token IS NOT NULL THEN contact_info ELSE NULL END AS google_email
       FROM therapists
       WHERE therapist_id != 'SafeStories'
       ORDER BY name ASC`
    );
    
    const list = result.rows;
    
    // Fetch SafeStories from DB or default
    const ssResult = await pool.query(
      "SELECT google_refresh_token IS NOT NULL AS connected, contact_info FROM therapists WHERE therapist_id = 'SafeStories'"
    );
    if (ssResult.rows.length > 0) {
      list.unshift({
        therapist_id: 'SafeStories',
        name: 'SafeStories (Platform)',
        contact_info: ssResult.rows[0].contact_info || 'admin@safestories.in',
        profile_picture_url: '',
        connected: ssResult.rows[0].connected,
        google_email: ssResult.rows[0].connected ? ssResult.rows[0].contact_info : null
      });
    } else {
      list.unshift({
        therapist_id: 'SafeStories',
        name: 'SafeStories (Platform)',
        contact_info: 'admin@safestories.in',
        profile_picture_url: '',
        connected: false,
        google_email: null
      });
    }
    
    res.json(list);
  } catch (error) {
    console.error('Error fetching therapist calendar list:', error);
    res.status(500).json({ error: 'Failed to fetch therapist calendars' });
  }
});

// ==================== END GOOGLE CALENDAR OAUTH CONFIG & ENDPOINTS ====================


// Login endpoint - with proper password hashing
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    // Fluidadmin used to be special-cased here with its password written into the
    // source. It is a normal users row now, seeded at startup, so it falls through
    // to the same lookup as everyone else — and can be disabled, rotated and
    // audited like everyone else.

    // Fetch user WITHOUT comparing password in database
    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );

    if (result.rows.length === 0) {
      // Don't reveal if user exists
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    // Check if user account is active
    if (user.is_active === false) {
      return res.status(403).json({
        success: false,
        error: 'Your account has been disabled. Please contact support.'
      });
    }

    // Accepts both plaintext (legacy rows) and bcrypt hashes.
    const passwordMatch = await verifyPassword(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    console.log(`✅ Login successful for ${username} (${user.role})`);


      // For therapists, check their approval status and fetch schedule_id
      if (user.role === 'therapist' && user.therapist_id) {
        try {
          // Check therapist status in therapists table
          const therapistCheck = await pool.query(
            'SELECT status FROM therapists WHERE therapist_id = $1',
            [user.therapist_id]
          );

          if (therapistCheck.rows.length > 0) {
            const status = therapistCheck.rows[0].status;
            user.profileStatus = status; // 'pending_review' or 'approved'
            user.needsProfileCompletion = false;
            console.log(`✅ Therapist ${user.therapist_id} status: ${status}`);
          } else {
            // Fallback: check therapist_details table
            const detailsCheck = await pool.query(
              'SELECT status FROM therapist_details WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1',
              [user.email]
            );

            if (detailsCheck.rows.length > 0) {
              user.profileStatus = detailsCheck.rows[0].status;
              user.needsProfileCompletion = false;
            }
          }

          // NEW: Fetch schedule_id from therapist_resources
          const resourceCheck = await pool.query(
            'SELECT MAX(schedule_id) as schedule_id FROM therapist_resources WHERE therapist_id = $1',
            [user.therapist_id]
          );
          if (resourceCheck.rows.length > 0) {
            user.scheduleId = resourceCheck.rows[0].schedule_id;
            console.log(`✅ Found scheduleId for therapist: ${user.scheduleId}`);
          }

          // Check google calendar connection
          const calendarCheck = await pool.query(
            'SELECT google_refresh_token IS NOT NULL as connected FROM therapists WHERE therapist_id = $1',
            [user.therapist_id]
          );
          if (calendarCheck.rows.length > 0) {
            user.google_calendar_connected = calendarCheck.rows[0].connected;
          } else {
            user.google_calendar_connected = false;
          }
        } catch (statusError) {
          console.error('Error checking therapist status/resources:', statusError);
        }
      }

      // Log therapist login
      if (user.role === 'therapist') {
        try {
          await pool.query(
            `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, timestamp, is_visible)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [user.therapist_id, username, 'login', `${username} logged into dashboard`, getCurrentISTTimestamp()]
          );
        } catch (auditError) {
          console.error('❌ Failed to create audit log for login:', auditError);
        }
      }

      res.json({ success: true, user: toSafeUser(user), token: issueToken(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ==================== DASHBOARD ACCESS ====================
// See lib/access.ts for the model. In short: a role says who you are, a scope
// says which dashboards you may open, and switching between them changes neither.

/**
 * What the CALLER may open. Drives the route guards and the dashboard switcher.
 *
 * Read from the database on every call rather than from the token, so a grant or
 * a revoke takes effect on the next page load instead of whenever the 24h token
 * happens to expire.
 */
app.get('/api/me/access', async (req: any, res) => {
  try {
    const scopes = Array.from(await loadScopes(req.user));
    res.json({
      role: req.user?.role ?? null,
      baseScope: baseScopeForRole(req.user?.role),
      baseScopes: baseScopesForRole(req.user?.role),
      scopes,
      canManageAccess: await mayManageAccess(req.user),
    });
  } catch (error: any) {
    console.error('[access] /api/me/access failed:', error?.message || error);
    res.status(500).json({ error: 'Could not load access' });
  }
});

/**
 * Everyone whose access can be managed, with what they currently hold.
 *
 * Restricted to the AI team by identity — see canManageAccess. The Roles tab
 * hiding itself for everyone else is presentation; this check is the control.
 */
app.get('/api/admin/access-grants', requireAccessAdmin, async (req: any, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.email, u.role, u.therapist_id, u.is_active,
             COALESCE(u.full_name, u.name) AS name,
             COALESCE(
               ARRAY_AGG(g.scope) FILTER (WHERE g.scope IS NOT NULL),
               '{}'
             ) AS granted
        FROM users u
        LEFT JOIN user_access_grants g ON g.user_id = u.id
       WHERE LOWER(u.role) IN ('admin', 'superadmin', 'therapist', 'sales')
       GROUP BY u.id
       -- Grouped by tier, least privileged first, so the list reads as a ladder
       -- and the few accounts that can change everything sit together at the
       -- bottom instead of scattered through an alphabetical roster.
       ORDER BY CASE LOWER(u.role)
                  WHEN 'therapist'  THEN 1
                  WHEN 'sales'      THEN 2
                  WHEN 'admin'      THEN 3
                  WHEN 'superadmin' THEN 4
                  ELSE 5
                END,
                LOWER(COALESCE(u.full_name, u.name, u.username))
    `);

    res.json({
      users: rows.map((u: any) => {
        const base = baseScopesForRole(u.role);
        const granted: Scope[] = (u.granted || []).filter(isScope);
        return {
          id: u.id,
          name: u.name || u.username,
          username: u.username,
          email: u.email,
          role: u.role,
          isActive: u.is_active !== false,
          // Base scopes are reported as held so their checkboxes render ticked,
          // and separately as base so they render disabled. They are never
          // stored, so they can never be saved away.
          baseScopes: base,
          scopes: Array.from(new Set<Scope>([...base, ...granted])),
          grantable: grantableScopes(u),
        };
      }),
    });
  } catch (error: any) {
    console.error('[access] listing grants failed:', error?.message || error);
    res.status(500).json({ error: 'Could not load users' });
  }
});

/**
 * Replace one user's grants with the set given.
 *
 * Takes the COMPLETE intended set, not a delta, so a checkbox the admin unticked
 * is unambiguous — a delta API cannot distinguish "leave it alone" from "remove
 * it" when the request is retried.
 */
app.put('/api/admin/access-grants/:userId', requireAccessAdmin, async (req: any, res) => {
  const client = await pool.connect();
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const requested: string[] = Array.isArray(req.body?.scopes) ? req.body.scopes : [];
    if (requested.some((s) => !isScope(s))) {
      return res.status(400).json({ error: 'Unknown scope requested' });
    }

    const { rows } = await client.query(
      'SELECT id, username, email, role, therapist_id FROM users WHERE id = $1',
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = rows[0];

    const base = baseScopesForRole(target.role);
    const allowed = grantableScopes(target);

    // Validate against what this user could ever hold, not against what the form
    // happened to render. The form is a convenience; a crafted request is not.
    const rejected = requested.filter((s) => !allowed.includes(s as Scope));
    if (rejected.length) {
      return res.status(400).json({
        error: rejected.includes('therapist_dashboard')
          // Say why, because "not allowed" reads as a bug when the real reason is
          // that there is no therapist record to point the dashboard at.
          ? 'A therapist dashboard needs a therapist profile; this account has none.'
          : rejected.includes('superadmin')
          // The one grant this grid will not make. Say so, rather than letting it
          // read as a bug in the checkbox.
          ? 'Super admin is only available to administrator accounts. Change the role first.'
          : `Not available for a ${target.role}: ${rejected.join(', ')}`,
      });
    }

    // Base scopes are implicit. Storing them would let a later write delete them
    // and strip access the role is supposed to guarantee.
    const toStore = Array.from(new Set(requested.filter((s) => !base.includes(s as Scope)))) as Scope[];

    // An account that hands out access must not be able to take its OWN away.
    // Unticking the box that renders the tab is a mistake with no path back
    // except a database console, so it is refused rather than confirmed.
    //
    // Scoped to the caller editing their own row. Applying it to any manager
    // would make superadmin a one-way grant: the moment someone held it, nobody
    // could take it back through the tab that gave it to them.
    const isSelf = String(target.id) === String(req.user?.id);
    if (isSelf && (await mayManageAccess(target))) {
      if (!requested.includes('admin_dashboard')) {
        return res.status(400).json({ error: 'This account cannot remove its own admin access.' });
      }
      // Superadmin is what opens this tab for everyone who is not on the named
      // recovery list, so dropping it locks the account out of its own controls.
      if (!isAccessAdminIdentity(target) && !requested.includes('superadmin')) {
        return res.status(400).json({ error: 'This account cannot remove its own super admin access.' });
      }
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM user_access_grants WHERE user_id = $1', [userId]);
    for (const scope of toStore) {
      await client.query(
        `INSERT INTO user_access_grants (user_id, scope, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, scope) DO NOTHING`,
        [userId, scope, Number.isInteger(Number(req.user?.id)) ? Number(req.user.id) : null]
      );
    }
    await client.query('COMMIT');

    // Drop the cache before responding, so the next request from that user reads
    // the new set rather than up to 30s of the old one.
    invalidateAccess(userId);

    logActivity({
      category: 'admin',
      actorId: req.user?.id != null ? String(req.user.id) : null,
      actorName: req.user?.username ?? null,
      actorRole: req.user?.role ?? null,
      action: 'access.grants.update',
      method: 'PUT',
      route: '/api/admin/access-grants/:userId',
      path: req.path,
      entityType: 'user',
      entityId: String(userId),
      metadata: { user_id: userId, role: target.role, granted: toStore.join(',') || 'none' },
    });

    res.json({
      success: true,
      scopes: Array.from(new Set<Scope>([...(base ? [base] : []), ...toStore])),
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[access] updating grants failed:', error?.message || error);
    res.status(500).json({ error: 'Could not update access' });
  } finally {
    client.release();
  }
});

/**
 * Hand this session to the CRM, which lives on another origin.
 *
 * Returns a ticket, not a session. The CRM exchanges it for its own token at
 * /api/handoff/redeem; this one is single-use, expires in 60 seconds, and says
 * nothing except "the panel vouched for user N a moment ago".
 *
 * Why a ticket rather than forwarding the session token itself: the value ends up
 * in a URL, and URLs land in browser history, referrer headers and server logs. A
 * 24h session token there would be a lasting credential; this is spent the moment
 * it is used and dead a minute later regardless.
 *
 * The scope is checked HERE as well as by the CRM. Issuing a ticket to someone
 * without CRM access would be handing out something the other service then has to
 * be trusted to refuse.
 */
app.post('/api/handoff', async (req: any, res) => {
  try {
    const target = String(req.body?.target || '');
    if (!isScope(target)) return res.status(400).json({ error: 'Unknown target' });

    if (!(await loadScopes(req.user)).has(target as Scope)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const jti = crypto.randomBytes(24).toString('base64url');
    const ttlSeconds = 60;
    await pool.query(
      `INSERT INTO auth_handoff_tokens (jti, user_id, scope, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
      [jti, req.user.id, target, String(ttlSeconds)]
    );

    // Signed as well as stored: the signature proves it came from here, the row
    // proves it has not been used. Both are required.
    const ticket = jwt.sign(
      { purpose: 'handoff', jti, id: req.user.id, scope: target },
      JWT_SECRET,
      { expiresIn: ttlSeconds } as jwt.SignOptions
    );

    res.json({ ticket, expiresIn: ttlSeconds });
  } catch (error: any) {
    console.error('[handoff] issue failed:', error?.message || error);
    res.status(500).json({ error: 'Could not start the handoff' });
  }
});

/**
 * Redeem a one-time ticket issued by the CRM and start a session here.
 *
 * The mirror of /api/handoff above. Switching has to work in both directions or
 * it is a trapdoor — someone who moved to the CRM would have to sign in again to
 * get back to the dashboard they came from.
 *
 * Three checks, all required: the signature (proves the CRM issued it, shared
 * secret), the row (proves it has not been spent — the DELETE is atomic), and the
 * scope re-read live, because access can be revoked between issue and redemption.
 */
app.post('/api/handoff/redeem', async (req: any, res) => {
  try {
    const ticket = String(req.body?.ticket || '');
    if (!ticket) return res.status(400).json({ error: 'Missing ticket' });

    let claims: any;
    try {
      claims = jwt.verify(ticket, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired handoff' });
    }
    // A normal session token must not work here, or this public route becomes a
    // way to mint fresh sessions from a stolen one indefinitely.
    if (claims?.purpose !== 'handoff' || !claims?.jti) {
      return res.status(401).json({ error: 'Invalid or expired handoff' });
    }

    const spent = await pool.query(
      `DELETE FROM auth_handoff_tokens
        WHERE jti = $1 AND expires_at > now()
        RETURNING user_id, scope`,
      [claims.jti]
    );
    if (spent.rows.length === 0) {
      return res.status(401).json({ error: 'This handoff link has already been used or has expired.' });
    }

    const wanted = spent.rows[0].scope;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND (is_active IS DISTINCT FROM false)',
      [spent.rows[0].user_id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Account is unavailable' });

    const user = rows[0];
    if (!(await loadScopes(user)).has(wanted)) {
      return res.status(403).json({ error: 'This account no longer has that access.' });
    }

    res.json({ success: true, user: toSafeUser(user), token: issueToken(user), scope: wanted });
  } catch (error: any) {
    console.error('[handoff] redeem failed:', error?.message || error);
    res.status(500).json({ error: 'Could not complete the handoff' });
  }
});

/**
 * What the scope gate WOULD have blocked, while it runs in shadow mode.
 *
 * The list to read before setting ACCESS_ENFORCE=true. Collapsed to one entry per
 * route and role, so a week of traffic is a short table rather than thousands of
 * identical lines. An empty list means nothing legitimate is being caught and the
 * gate is safe to enforce.
 */
app.get('/api/admin/access-shadow-denials', requireAccessAdmin, async (req: any, res) => {
  try {
    res.json({
      // Read from access.ts rather than re-derived from the env var here. The two
      // had already drifted: this tested `=== 'true'` while the gate defaults to
      // enforcing unless explicitly disabled, so it reported "off" while blocking.
      enforcing: isEnforcing(),
      denials: await getShadowDenials(),
    });
  } catch (err: any) {
    // A 500 rather than an empty list. This endpoint's answer decides whether
    // the gate gets switched on, and "[]" means "nothing would break" — the one
    // wrong answer that causes an outage.
    console.error('[access] shadow denial read failed:', err?.message || err);
    res.status(500).json({ error: 'The shadow denial log could not be read. Do not treat this as an empty list.' });
  }
});

// Verify password endpoint (for case history access)
/**
 * Re-confirm the CALLER'S OWN password.
 *
 * Identified from the session, never from a username in the body. Taking the
 * username from the request made this a password oracle: any signed-in account
 * could test guesses against any other account — superadmins included — and get
 * a clean true/false back, at HTTP 200 either way so the failures did not even
 * show up as an error rate. crm-backend carried the identical route and the
 * identical fix; the two must not drift.
 */
app.post('/api/verify-password', async (req: any, res) => {
  try {
    const { password } = req.body;
    if (!req.user?.id) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (!password) return res.status(400).json({ success: false, error: 'Password is required' });

    // Must not compare in SQL — that only matches the legacy plaintext rows and
    // silently reports "wrong password" for anyone whose password is hashed.
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);

    if (result.rows.length > 0 && await verifyPassword(password, result.rows[0].password)) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

// Change password endpoint
app.post('/api/change-password', async (req, res) => {
  try {
    const { userId, newPassword, currentPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    if (!currentPassword) {
      return res.status(400).json({ success: false, error: 'Current password is required' });
    }
    const existing = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (!(await verifyPassword(currentPassword, existing.rows[0].password))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    const result = await pool.query(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
      [await hashPassword(newPassword), userId]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, message: 'Password changed successfully' });
    } else {
      res.status(404).json({ success: false, error: 'User not found' });
    }
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// Save new therapist request with OTP
/**
 * Shared therapist_id generator: first name + 4 digits, retried until unique.
 * Both the invite (below) and the therapist's own profile completion mint ids,
 * and they must agree on the format.
 */
const generateUniqueTherapistId = async (name: string): Promise<string> => {
  const build = () => {
    const firstName = (name || 'therapist').split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') || 'therapist';
    return `${firstName}${Math.floor(1000 + Math.random() * 9000)}`;
  };
  let id = build();
  for (let attempts = 0; attempts < 10; attempts++) {
    const existing = await pool.query('SELECT therapist_id FROM therapists WHERE therapist_id = $1', [id]);
    if (existing.rows.length === 0) return id;
    id = build();
  }
  return id;
};

/**
 * Sends the onboarding OTP without letting SMTP dictate how long the caller waits.
 *
 * A mail send is a side effect of creating the invite, not part of it: the invite
 * is already durable in Postgres before this runs, and the OTP can be re-sent. So
 * it gets a hard deadline. Past it we stop waiting and report back — the send may
 * still complete, which is why the timeout is reported as 'pending', not 'failed'.
 */
const EMAIL_DEADLINE_MS = 15_000;

type InviteEmailResult = { ok: boolean; pending?: boolean; error?: string };

/**
 * Runs a mail send against the deadline and REPORTS what happened rather than
 * throwing, so a caller can decide what a failed notification means.
 *
 * It nearly always means "not much": the durable record is already in Postgres
 * before this runs. Throwing instead makes the whole request look like it failed
 * when the thing that mattered succeeded, and the caller loses whatever it was
 * about to do next.
 */
const sendEmailBounded = async (
  label: string, send: () => Promise<unknown>
): Promise<InviteEmailResult> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      send().then(() => ({ ok: true }) as InviteEmailResult),
      new Promise<InviteEmailResult>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, pending: true }), EMAIL_DEADLINE_MS);
      }),
    ]);
    if (result.pending) console.warn(`⏳ ${label} exceeded ${EMAIL_DEADLINE_MS}ms; responding without it.`);
    else console.log(`✅ ${label} sent.`);
    return result;
  } catch (err: any) {
    console.error(`❌ ${label} failed:`, err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const sendInviteEmailBounded = (
  email: string, name: string, otp: string, expiresAt: Date
): Promise<InviteEmailResult> =>
  sendEmailBounded(`Therapist onboarding OTP to ${email}`,
    () => sendOTPEmail(email, name, otp, expiresAt));

// Only admins invite therapists. Previously any authenticated session could —
// including a therapist's own — which let a therapist mint therapist records.
app.post('/api/new-therapist-requests', requireRole(['admin']), async (req, res) => {
  const { therapistName, whatsappNumber, email, specializations, specializationDetails } = req.body || {};

  // therapist_name, whatsapp_number, email and specializations are all NOT NULL
  // in new_therapist_requests. Validating here turns a missing field into a
  // readable 400 instead of a 500 from Postgres — which is what the admin hit,
  // and which still burns a request_id off the sequence on the way out.
  const name = String(therapistName || '').trim();
  const mail = String(email || '').trim();
  const phone = String(whatsappNumber || '').trim();
  const specs = String(specializations || '').trim();

  if (!name || !mail) {
    return res.status(400).json({ success: false, error: 'Therapist name and email are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return res.status(400).json({ success: false, error: 'Enter a valid email address' });
  }
  if (!phone) {
    return res.status(400).json({ success: false, error: 'WhatsApp number is required' });
  }
  if (!specs) {
    return res.status(400).json({ success: false, error: 'Select at least one specialization' });
  }

  const client = await pool.connect();
  try {
    // An already-onboarded therapist has a users row. Re-inviting them would
    // hand out an OTP that /api/complete-therapist-profile then rejects, so the
    // admin would watch it succeed and silently go nowhere.
    //
    // The link runs through therapists.contact_info, NOT users.email: every
    // therapist onboarded before this flow existed has a NULL users.email and
    // is identified only by contact_info. Checking users.email alone matches
    // none of them. The second arm covers accounts created by
    // /api/complete-therapist-profile, which does set username/email.
    const onboarded = await client.query(
      `SELECT 1
         FROM users u
         LEFT JOIN therapists t ON t.therapist_id = u.therapist_id
        WHERE u.therapist_id IS NOT NULL
          AND (LOWER(t.contact_info) = LOWER($1)
               OR LOWER(u.email) = LOWER($1)
               OR LOWER(u.username) = LOWER($1))
        LIMIT 1`,
      [mail]
    );
    if (onboarded.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A therapist with this email has already completed onboarding.',
      });
    }

    const otpToken = newSixDigitCode();
    const otpExpiresAt = new Date();
    otpExpiresAt.setHours(otpExpiresAt.getHours() + 24);

    // The request row and the therapists row are one unit of work. They used to
    // be two independent statements with the second in its own try/catch, so a
    // failure there left an invite whose therapist did not exist anywhere.
    await client.query('BEGIN');

    // Supersede any earlier pending invite for this address, so exactly one OTP
    // is live per therapist and the newest email is the one that works.
    await client.query(
      `UPDATE new_therapist_requests SET status = 'superseded'
        WHERE LOWER(email) = LOWER($1) AND status = 'pending'`,
      [mail]
    );

    const result = await client.query(
      `INSERT INTO new_therapist_requests (therapist_name, whatsapp_number, email, specializations, specialization_details, otp_token, otp_expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [name, phone, mail, specs, JSON.stringify(specializationDetails ?? []), otpToken, otpExpiresAt]
    );

    // Create the therapist record NOW, so the invitee is part of the system
    // immediately: they appear on the Therapists tab, on the Therapies tab with
    // an "Add New Therapy" card, and in Organization Settings → Integrations
    // ready for a calendar connection — all before they have onboarded.
    //
    // Only the therapists row is written here. The `users` row — the actual
    // login — is created by /api/complete-therapist-profile once the therapist
    // verifies the OTP and chooses their OWN password. An admin never sets
    // credentials for someone else.
    //
    // status='invited' distinguishes this from a working account. Without it
    // the card would read Active, because /api/therapists-admin derives
    // login_enabled as COALESCE(u.is_active, true) and there is no users row yet.
    const existing = await client.query(
      `SELECT therapist_id FROM therapists WHERE LOWER(contact_info) = LOWER($1) LIMIT 1`,
      [mail]
    );

    let therapistId: string;
    if (existing.rows.length === 0) {
      therapistId = await generateUniqueTherapistId(name);
      await client.query(
        `INSERT INTO therapists (
           therapist_id, name, contact_info, phone_number,
           specialization, specialization_details, status, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, 'invited', true)`,
        [
          therapistId, name, mail, phone,
          specs || null,
          specializationDetails ? JSON.stringify(specializationDetails) : null,
        ]
      );
      console.log(`✅ Therapist record created for invite: ${name} (${therapistId})`);
    } else {
      // Re-invite: refresh the details the admin just typed rather than leaving
      // the record frozen at whatever the first invite said.
      therapistId = existing.rows[0].therapist_id;
      await client.query(
        `UPDATE therapists SET
           name = $2, phone_number = $3,
           specialization = COALESCE($4, specialization),
           specialization_details = COALESCE($5, specialization_details)
         WHERE therapist_id = $1`,
        [
          therapistId, name, phone,
          specs || null,
          specializationDetails ? JSON.stringify(specializationDetails) : null,
        ]
      );
      console.log(`ℹ️  Therapist already exists for ${mail}; re-invited as ${therapistId}.`);
    }

    await client.query('COMMIT');

    // Committed above, so the invite survives whatever the mail server does.
    const emailResult = await sendInviteEmailBounded(mail, name, otpToken, otpExpiresAt);

    res.json({
      success: true,
      data: result.rows[0],
      therapistId,
      requestId: result.rows[0].request_id,
      emailSent: emailResult.ok,
      emailPending: Boolean(emailResult.pending),
      emailError: emailResult.error || null,
    });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    console.error('Error saving new therapist request:', error);
    res.status(500).json({ success: false, error: 'Failed to save new therapist request' });
  } finally {
    client.release();
  }
});

/**
 * Re-send the onboarding OTP for an existing invite.
 *
 * Without this, an invite whose email failed to send is a dead end: the therapist
 * row exists so re-inviting is a no-op, but nobody holds the OTP.
 */
app.post('/api/new-therapist-requests/:requestId/resend', requireRole(['admin']), async (req, res) => {
  try {
    const { requestId } = req.params;
    const existing = await pool.query(
      `SELECT * FROM new_therapist_requests WHERE request_id = $1`,
      [requestId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    // Mint a fresh OTP and window rather than resending a code that may already
    // have expired — a resend is only useful if the code in it still works.
    const otpToken = newSixDigitCode();
    const otpExpiresAt = new Date();
    otpExpiresAt.setHours(otpExpiresAt.getHours() + 24);

    const updated = await pool.query(
      `UPDATE new_therapist_requests
          SET otp_token = $2, otp_expires_at = $3, status = 'pending', updated_at = NOW()
        WHERE request_id = $1
        RETURNING *`,
      [requestId, otpToken, otpExpiresAt]
    );

    const row = updated.rows[0];
    const emailResult = await sendInviteEmailBounded(row.email, row.therapist_name, otpToken, otpExpiresAt);

    res.json({
      success: true,
      emailSent: emailResult.ok,
      emailPending: Boolean(emailResult.pending),
      emailError: emailResult.error || null,
    });
  } catch (error) {
    console.error('Error resending therapist invite:', error);
    res.status(500).json({ success: false, error: 'Failed to resend invite' });
  }
});

// Verify therapist OTP
app.post('/api/verify-therapist-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const result = await pool.query(
      `SELECT * FROM new_therapist_requests 
       WHERE LOWER(email) = LOWER($1) AND otp_token = $2 AND status = 'pending'`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or OTP' });
    }

    const request = result.rows[0];

    // Check if OTP is expired
    const now = new Date();
    const expiresAt = new Date(request.otp_expires_at);

    if (now > expiresAt) {
      await pool.query(
        `UPDATE new_therapist_requests SET status = 'expired' WHERE request_id = $1`,
        [request.request_id]
      );
      return res.status(401).json({ success: false, error: 'OTP has expired' });
    }

    // Return therapist request data for pre-filling
    let specializationDetails = [];
    try {
      specializationDetails = typeof request.specialization_details === 'string'
        ? JSON.parse(request.specialization_details || '[]')
        : (Array.isArray(request.specialization_details) ? request.specialization_details : []);
    } catch (parseError) {
      console.error('Error parsing specialization_details:', parseError);
      specializationDetails = [];
    }

    // This endpoint is an authentication entry point — the client logs the therapist
    // straight in on success — so it must mint a token like /api/login does. The
    // onboarding account has no users row yet, so the request_id stands in as identity.
    res.json({
      success: true,
      data: {
        requestId: request.request_id,
        name: request.therapist_name,
        email: request.email,
        phone: request.whatsapp_number,
        specializations: request.specializations,
        specializationDetails: specializationDetails
      },
      token: issueToken({
        id: request.request_id,
        username: String(request.email || '').split('@')[0],
        role: 'therapist',
        therapist_id: request.request_id,
        email: request.email,
      })
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

// Complete therapist profile
app.post('/api/complete-therapist-profile', async (req, res) => {
  try {
    const {
      requestId,
      name,
      email,
      phone,
      specializations,
      specializationDetails,
      qualification,
      qualificationPdfUrl,
      profilePictureUrl,
      password
    } = req.body;

    console.log('📝 Complete profile request:', { requestId, name, email, phone, specializations });

    if (!name || !email || !phone || !password) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ success: false, error: 'All required fields must be provided' });
    }

    // Check if therapist details already exist for this email
    console.log('🔍 Checking for existing details...');
    const existingDetails = await pool.query(
      `SELECT * FROM therapist_details WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    if (existingDetails.rows.length > 0) {
      console.log('❌ Therapist details already exist:', email);
      return res.status(400).json({ success: false, error: 'Profile already submitted for this email' });
    }

    // Hash once, up front, and store only the hash. `therapist_details.password`
    // is NOT NULL and never read back by anything, so keeping the therapist's
    // chosen password here in the clear bought nothing and risked everything.
    const hashedPassword = await hashPassword(password);

    // Serialize specialization details as JSON
    const specializationDetailsJson = specializationDetails ? JSON.stringify(specializationDetails) : '[]';
    console.log('📦 Serialized specialization details:', specializationDetailsJson);

    // Insert into therapist_details table
    console.log('💾 Inserting into therapist_details table...');
    console.log('Values:', {
      requestId, name, email, phone, specializations,
      specializationDetailsJson, qualification,
      qualificationPdfUrl, profilePictureUrl, password
    });

    const detailsResult = await pool.query(
      `INSERT INTO therapist_details (
        request_id, name, email, phone, specializations,
        specialization_details, qualification, qualification_pdf_url,
        profile_picture_url, password, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_review')
       RETURNING *`,
      [
        requestId, name, email, phone, specializations,
        specializationDetailsJson, qualification || null,
        qualificationPdfUrl || null, profilePictureUrl || null, hashedPassword
      ]
    );

    const details = detailsResult.rows[0];
    console.log('✅ Therapist details saved:', details.id);

    // Generate unique therapist_id
    console.log('🔑 Generating therapist_id...');
    const generateTherapistId = (name: string): string => {
      const firstName = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `${firstName}${randomNum}`;
    };

    let therapistId = generateTherapistId(name);
    let attempts = 0;
    while (attempts < 10) {
      const existingId = await pool.query(
        'SELECT therapist_id FROM therapists WHERE therapist_id = $1',
        [therapistId]
      );
      if (existingId.rows.length === 0) break;
      therapistId = generateTherapistId(name);
      attempts++;
    }
    console.log('✅ Generated therapist_id:', therapistId);

    // Upsert the therapists row.
    //
    // The admin's invite already created this record with status='invited' so
    // the therapist would show up across the panel straight away. Inserting
    // again here would produce a SECOND therapist for the same person — with a
    // different therapist_id, splitting their bookings and calendars in two.
    // Adopt the existing row instead, and keep its therapist_id so nothing that
    // already references it breaks.
    console.log('👨‍⚕️ Creating/updating therapist entry...');
    try {
      const existing = await pool.query(
        `SELECT therapist_id FROM therapists WHERE LOWER(contact_info) = LOWER($1) LIMIT 1`,
        [email]
      );

      if (existing.rows.length > 0) {
        therapistId = existing.rows[0].therapist_id;
        await pool.query(`
          UPDATE therapists SET
            name = $2, phone_number = $3, specialization = $4,
            specialization_details = $5,
            qualification_pdf_url = COALESCE($6, qualification_pdf_url),
            profile_picture_url  = COALESCE($7, profile_picture_url),
            status = 'pending_review'
          WHERE therapist_id = $1
        `, [
          therapistId, name, phone, specializations,
          specializationDetailsJson, qualificationPdfUrl, profilePictureUrl,
        ]);
        console.log('✅ Adopted invited therapist record:', therapistId);
      } else {
        await pool.query(`
          INSERT INTO therapists (
            therapist_id, name, contact_info, phone_number,
            specialization, specialization_details,
            qualification_pdf_url, profile_picture_url, status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_review')
        `, [
          therapistId,
          name,
          email,
          phone,
          specializations,
          specializationDetailsJson,
          qualificationPdfUrl,
          profilePictureUrl
        ]);
        console.log('✅ Therapist entry created with status: pending_review');
      }
    } catch (therapistError) {
      console.error('⚠️ Error creating therapist entry:', therapistError);
      throw therapistError; // This is critical, so throw error
    }

    // Create user account for login (email + password)
    console.log('👤 Creating user account...');
    try {
      // Check if user already exists
      const existingUser = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
        [email]
      );

      // Reuses the hash computed above — bcrypt is deliberately slow, and the
      // users row and therapist_details row describe the same password.
      if (existingUser.rows.length === 0) {
        // Create new user account with therapist_id
        await pool.query(
          `INSERT INTO users (username, password, name, email, role, full_name, phone, profile_picture_url, therapist_id, created_at)
           VALUES ($1, $2, $3, $4, 'therapist', $5, $6, $7, $8, NOW())`,
          [email, hashedPassword, name, email, name, phone, profilePictureUrl, therapistId]
        );
        console.log('✅ User account created for:', email, 'with therapist_id:', therapistId);
      } else {
        // Update existing user with new password and therapist_id
        await pool.query(
          `UPDATE users SET password = $1, name = $2, full_name = $3, phone = $4, profile_picture_url = $5, therapist_id = $6
           WHERE LOWER(email) = LOWER($7)`,
          [hashedPassword, name, name, phone, profilePictureUrl, therapistId, email]
        );
        console.log('✅ User account updated for:', email, 'with therapist_id:', therapistId);
      }
    } catch (userError) {
      console.error('⚠️ Error creating user account:', userError);
      throw userError; // This is critical, so throw error
    }

    // Update new_therapist_requests status
    console.log('💾 Updating request status...');
    await pool.query(
      `UPDATE new_therapist_requests SET status = 'profile_submitted' WHERE request_id = $1`,
      [requestId]
    );
    console.log('✅ Request status updated');

    // Send data to n8n webhook
    console.log('🔔 Sending data to webhook...');
    try {
      const webhookUrl = process.env.N8N_WEBHOOK_ISSUE_REPORT;
      if (!webhookUrl) {
        console.warn('⚠️ N8N_WEBHOOK_ISSUE_REPORT not configured in environment');
      } else {
        const webhookPayload = {
          id: details.id,
          request_id: details.request_id,
          therapist_id: therapistId,
          name: details.name,
          email: details.email,
          phone: details.phone,
          specializations: details.specializations,
          specialization_details: details.specialization_details,
          qualification: details.qualification,
          qualification_pdf_url: details.qualification_pdf_url,
          profile_picture_url: details.profile_picture_url,
          status: details.status,
          created_at: details.created_at,
          updated_at: details.updated_at
        };

        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookPayload)
        });

        if (webhookResponse.ok) {
          console.log('✅ Webhook notification sent successfully');
        } else {
          console.error('⚠️ Webhook notification failed:', webhookResponse.status, webhookResponse.statusText);
        }
      }
    } catch (webhookError) {
      console.error('⚠️ Error sending webhook notification:', webhookError);
      // Don't fail the entire request if webhook fails
    }

    console.log('🎉 Profile submission successful!');
    res.json({
      success: true,
      message: 'Profile submitted successfully! Your profile will be reviewed by admin within 5-10 days.',
      detailsId: details.id
    });
  } catch (error) {
    console.error('❌ Error completing therapist profile:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    console.error('Error stack:', error.stack);

    // Send more specific error message
    const errorMessage = error.code === '23505' ? 'Email already exists' :
      error.code === '23503' ? 'Invalid request ID' :
        error.message || 'Failed to complete profile';

    res.status(500).json({ success: false, error: errorMessage, details: error.message });
  }
});

// Check if therapist details exist
app.get('/api/check-therapist-details', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ exists: false, error: 'Email is required' });
    }

    const result = await pool.query(
      `SELECT id FROM therapist_details WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    res.json({ exists: result.rows.length > 0 });
  } catch (error) {
    console.error('Error checking therapist details:', error);
    res.status(500).json({ exists: false, error: 'Failed to check profile status' });
  }
});

// Check therapist availability (for public booking links)
app.get('/api/therapist-availability', async (req, res) => {
  try {
    const { name } = req.query;
    
    if (!name) {
      return res.status(400).json({ error: 'Therapist name is required' });
    }

    // Check if user exists and is active
    const result = await pool.query(
      'SELECT is_active FROM users WHERE LOWER(full_name) = LOWER($1) AND role = $2',
      [name, 'therapist']
    );

    if (result.rows.length === 0) {
      // Therapist not found in users table, allow booking (might be external)
      return res.json({ isDisabled: false });
    }

    const isDisabled = result.rows[0].is_active === false;
    res.json({ isDisabled });
  } catch (error) {
    console.error('Error checking therapist availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// Get therapist profile
app.get('/api/therapist-profile', async (req, res) => {
  try {
    const { therapist_id, email } = req.query;

    if (!therapist_id && !email) {
      return res.status(400).json({ error: 'Therapist ID or email is required' });
    }

    // Checked inline rather than with requireTherapistScope, because this route
    // accepts an email as well — a therapist awaiting approval has no
    // therapist_id yet, and looking themselves up by email is the only way in.
    const ownProfile =
      (therapist_id && String((req as any).user?.therapist_id) === String(therapist_id)) ||
      (email && String((req as any).user?.email || '').toLowerCase() === String(email).toLowerCase());
    if (!ownProfile && !(await loadScopes((req as any).user)).has('admin_dashboard')) {
      return res.status(403).json({ error: 'Not your therapist record' });
    }

    // First try to get from therapists table (approved therapists)
    let result;
    if (therapist_id) {
      result = await pool.query(
        `SELECT * FROM therapists WHERE therapist_id = $1`,
        [therapist_id]
      );
    }

    // If not found in therapists table, check therapist_details (pending approval)
    if (!result || result.rows.length === 0) {
      if (email) {
        result = await pool.query(
          `SELECT * FROM therapist_details WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1`,
          [email]
        );

        if (result.rows.length > 0) {
          // Map therapist_details fields to match therapists table structure
          const details = result.rows[0];
          const mappedData = {
            therapist_id: null,
            name: details.name,
            contact_info: details.email,
            email: details.email,
            phone_number: details.phone,
            specialization: details.specializations,
            specialization_details: details.specialization_details,
            qualification: details.qualification,
            qualification_pdf_url: details.qualification_pdf_url,
            profile_picture_url: details.profile_picture_url,
            status: details.status
          };
          return res.json({ success: true, data: mappedData });
        }
      }
    }

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching therapist profile:', error);
    res.status(500).json({ error: 'Failed to fetch therapist profile' });
  }
});

// Upload file endpoint (profile picture or qualification PDF)
app.post('/api/upload-file', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('❌ Multer error:', err);
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}`
      });
    } else if (err) {
      console.error('❌ Unknown upload error:', err);
      return res.status(500).json({
        success: false,
        error: 'File upload failed'
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { folder } = req.body; // 'profile-pictures', 'qualification-pdfs', 'issue-screenshots', or 'org-logos'

    if (!folder || !['profile-pictures', 'qualification-pdfs', 'issue-screenshots', 'org-logos'].includes(folder)) {
      return res.status(400).json({ success: false, error: 'Invalid folder specified' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const originalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${timestamp}-${originalName}`;

    // Upload to MinIO
    const fileUrl = await uploadFile(
      req.file.buffer,
      fileName,
      folder as 'profile-pictures' | 'qualification-pdfs' | 'issue-screenshots' | 'org-logos',
      req.file.mimetype
    );

    res.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload file';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Who may see every ticket and change their state. Everyone else sees only their own.
const TICKET_MANAGER_ROLES = ['admin', 'superadmin', 'fluidadmin'];
const isTicketManager = (role?: string) => TICKET_MANAGER_ROLES.includes(String(role || '').toLowerCase());

const ticketRecipients = () =>
  (process.env.TICKET_NOTIFY_EMAILS || 'aiteam@fluid.live,meetpandya@fluid.live,rohnit@fluid.live')
    .split(',').map(e => e.trim()).filter(Boolean);

// Report issue endpoint
app.post('/api/report-issue', async (req: any, res) => {
  const client = await pool.connect();
  try {
    const { subject, component, description } = req.body;
    // Accept either the new array or the old single URL, so an un-refreshed tab
    // that still posts screenshot_url keeps working.
    const urls: string[] = Array.isArray(req.body.screenshot_urls)
      ? req.body.screenshot_urls.filter((u: any) => typeof u === 'string' && u)
      : (req.body.screenshot_url ? [req.body.screenshot_url] : []);

    if (!subject || !component || !description) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Identity comes from the token, never from the body — otherwise anyone could
    // file a ticket as someone else, or claim a role they do not have.
    const reportedBy = req.user.username || req.user.email || `user#${req.user.id}`;
    const userRole = req.user.role;

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO report_issues
         (subject, component, description, screenshot_url, reported_by, reported_by_user_id, user_role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, created_at`,
      [subject, component, description, urls[0] || null, reportedBy, req.user.id, userRole]
    );
    const issueId = result.rows[0].id;

    for (const url of urls) {
      await client.query(
        `INSERT INTO report_issue_attachments (ticket_id, file_url) VALUES ($1, $2)`,
        [issueId, url]
      );
    }
    await client.query('COMMIT');

    // Notifications are best-effort — a failed email must never lose the ticket.
    try {
      await sendIssueReportEmail(ticketRecipients(), {
        id: issueId, subject, component, description,
        reported_by: reportedBy, user_role: userRole,
        screenshot_url: urls[0] || null, screenshot_urls: urls,
        created_at: result.rows[0].created_at,
      });
    } catch (mailErr: any) {
      console.error(`[report-issue] Ticket #${issueId} saved but email notification failed:`, mailErr?.message || mailErr);
    }
    try {
      await notifyAllAdmins(
        'ticket_created',
        `New ticket #${issueId}: ${subject}`,
        `${reportedBy} (${userRole}) reported an issue in ${component}.`,
        String(issueId)
      );
    } catch (notifyErr: any) {
      console.error(`[report-issue] In-app notification failed for #${issueId}:`, notifyErr?.message || notifyErr);
    }

    res.json({ success: true, issueId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error reporting issue:', error);
    res.status(500).json({ error: 'Failed to report issue' });
  } finally {
    client.release();
  }
});

// List tickets. Managers see everything; everyone else sees only what they raised.
app.get('/api/report-issues', async (req: any, res) => {
  try {
    const { status } = req.query;
    const params: any[] = [];
    const conditions: string[] = [];

    // Ownership scope is derived from the token. A `reported_by` query param is
    // deliberately ignored — trusting it let any therapist read every ticket.
    const scoped = !isTicketManager(req.user.role);
    if (scoped) {
      params.push(req.user.id);
      conditions.push(`reported_by_user_id = $${params.length}`);
    }
    // Counts share the ownership filter but ignore the status filter, so the tab
    // badges keep showing totals for the other tabs.
    const scopeConditions = [...conditions];
    const scopeParams = [...params];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT r.id, r.subject, r.component, r.description, r.screenshot_url,
              r.reported_by, r.reported_by_user_id, r.user_role,
              r.status, r.notes, r.created_at, r.updated_at, r.resolved_at,
              COALESCE(
                (SELECT json_agg(json_build_object('url', a.file_url, 'name', a.file_name) ORDER BY a.id)
                 FROM report_issue_attachments a WHERE a.ticket_id = r.id),
                '[]'::json
              ) AS attachments
       FROM report_issues r ${where.replace(/\b(reported_by_user_id|status)\b/g, 'r.$1')}
       ORDER BY r.created_at DESC`,
      params
    );

    const countWhere = scopeConditions.length > 0 ? 'WHERE ' + scopeConditions.join(' AND ') : '';
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int n FROM report_issues ${countWhere} GROUP BY status`,
      scopeParams
    );
    const countMap: Record<string, number> = {};
    counts.rows.forEach((r: any) => { countMap[r.status] = r.n; });
    res.json({ tickets: result.rows, counts: countMap, canManage: !scoped });
  } catch (error) {
    console.error('Error listing report issues:', error);
    res.status(500).json({ error: 'Failed to list tickets' });
  }
});

// Update a ticket's status and/or notes. Managers only — the UI also hides these
// controls from therapists, but that is cosmetic; this is what actually enforces it.
app.patch('/api/report-issues/:id', requireRole(TICKET_MANAGER_ROLES), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['open', 'in_progress', 'resolved', 'closed'];
    if (status !== undefined && !allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` });
    }
    const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const vals: any[] = [];
    let i = 1;
    if (status !== undefined) {
      sets.push(`status = $${i++}`); vals.push(status);
      // Stamp resolved_at when moving to a terminal state; clear it if reopened.
      sets.push(`resolved_at = ${(status === 'resolved' || status === 'closed') ? 'CURRENT_TIMESTAMP' : 'NULL'}`);
    }
    if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes); }
    vals.push(id);
    const result = await pool.query(
      `UPDATE report_issues SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });

    const ticket = result.rows[0];
    // Tell the person who raised it that something changed. Best-effort.
    if (status !== undefined && ticket.reported_by_user_id) {
      try {
        await createNotification({
          userId: String(ticket.reported_by_user_id),
          userRole: (String(ticket.user_role || '').toLowerCase() === 'therapist' ? 'therapist' : 'admin'),
          notificationType: 'ticket_status_changed',
          title: `Ticket #${ticket.id} is now ${status.replace('_', ' ')}`,
          message: `"${ticket.subject}" was updated by ${req.user.username || 'the team'}.`,
          relatedId: String(ticket.id),
        });
      } catch (notifyErr: any) {
        console.error(`[report-issues] Status notification failed for #${ticket.id}:`, notifyErr?.message || notifyErr);
      }
    }

    res.json({ success: true, ticket });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Update therapist profile
app.put('/api/therapist-profile', async (req, res) => {
  try {
    const {
      therapist_id,
      name,
      email,
      phone,
      specializations,
      qualificationPdfUrl,
      profilePictureUrl
    } = req.body;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    const result = await pool.query(
      `UPDATE therapists 
       SET name = $1, contact_info = $2, phone_number = $3, specialization = $4,
           qualification_pdf_url = $5, profile_picture_url = $6
       WHERE therapist_id = $7
       RETURNING *`,
      [name, email, phone, specializations, qualificationPdfUrl, profilePictureUrl, therapist_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapist profile:', error);
    res.status(500).json({ error: 'Failed to update therapist profile' });
  }
});

// ==================== CRM ENDPOINTS ====================

app.get('/api/leads', async (req, res) => {
  try {
    const query = `
            SELECT 
                leads.*,
                COALESCE(sales.full_name, sales.name) as sales_agent_name,
                COALESCE(therapists.full_name, therapists.name) as therapist_name,
                ptcf.consultation_outcome
            FROM leads
            LEFT JOIN users sales ON leads.sales_agent_id::text = sales.id::text
            LEFT JOIN users therapists ON (leads.therapist_id::text = therapists.id::text OR leads.therapist_id::text = therapists.therapist_id::text)
            LEFT JOIN (
                SELECT DISTINCT ON (lead_id) lead_id, consultation_outcome 
                FROM pretherapy_call_forms 
                ORDER BY lead_id, submitted_at DESC
            ) ptcf ON leads.id::text = ptcf.lead_id::text
            ORDER BY leads.created_at DESC
        `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/leads/:id', async (req, res) => {
  const { id } = req.params;

  // Handle virtual profiles for clients not yet in leads table
  if (id.startsWith('temp:')) {
    const identifier = id.split(':')[1];
    console.log(`[DEBUG] Received request for virtual profile. Identifier: ${identifier}`);
    
    try {
      // Use a more aggressive query to find the client. 
      // We check by: exact invitee_id, exact phone, exact email, and fuzzy phone.
      // Also try to parse identifier as a number for matching against row IDs if it's small.
      const isNumeric = /^\d+$/.test(identifier);
      const rowIdSearch = isNumeric ? `OR booking_id = $1` : ''; // Use booking_id if numeric

      const result = await pool.query(`
        SELECT 
          invitee_name as name,
          invitee_phone as phone,
          invitee_email as email,
          booking_host_name as therapist_name,
          booking_start_at as created_at,
          invitee_question as client_remark
        FROM bookings
        WHERE invitee_id = $1 
           OR invitee_phone = $1 
           OR invitee_email = $1
           OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
           ${rowIdSearch}
        ORDER BY booking_start_at DESC
        LIMIT 1
      `, [identifier]);

      console.log(`[DEBUG] Virtual profile search result: ${result.rows.length} rows found.`);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found in bookings' });
      }

      const client = result.rows[0];
      return res.json({
        ...client,
        id: id,
        is_virtual: true,
        pipeline_stage: 'lead-inquire',
        status: 'Booking Only',
        source: 'Booking System'
      });
    } catch (err) {
      console.error('Error fetching virtual lead:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  try {
    const query = `
            SELECT 
                leads.*,
                COALESCE(sales.full_name, sales.name) as sales_agent_name,
                COALESCE(therapists.full_name, therapists.name) as therapist_name
            FROM leads
            LEFT JOIN users sales ON leads.sales_agent_id::text = sales.id::text
            LEFT JOIN users therapists ON (leads.therapist_id::text = therapists.id::text OR leads.therapist_id::text = therapists.therapist_id::text)
            WHERE leads.id::text = $1
        `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = result.rows[0];

    // Fetch client remarks from bookings table (invitee_question) using lead phone
    try {
      if (lead.phone) {
        const phoneDigits = lead.phone.replace(/\\D/g, '');
        let bookingQuery = `SELECT invitee_question FROM bookings WHERE booking_id = '47361' AND invitee_phone = $1 AND invitee_question IS NOT NULL AND btrim(invitee_question) != '' LIMIT 1`;
        let queryParams = [lead.phone];

        if (phoneDigits.length >= 10) {
          const tenDigits = phoneDigits.slice(-10);
          bookingQuery = `SELECT invitee_question FROM bookings WHERE booking_id = '47361' AND invitee_phone LIKE $1 AND invitee_question IS NOT NULL AND btrim(invitee_question) != '' LIMIT 1`;
          queryParams = [`%${tenDigits}%`];
        }

        const bookingResult = await pool.query(bookingQuery, queryParams);
        if (bookingResult.rows.length > 0) {
          lead.client_remark = bookingResult.rows[0].invitee_question;
        }
      }
    } catch (bookingErr) {
      console.error('Error fetching booking notes:', bookingErr);
    }

    res.json(lead);
  } catch (err) {
    console.error('Error fetching lead:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert virtual profile to a real lead
app.post('/api/leads/convert-virtual', async (req, res) => {
  const { name, phone, email, source } = req.body;
  try {
    // Check if lead already exists by phone or email
    const exists = await pool.query('SELECT id FROM leads WHERE phone = $1 OR email = $2', [phone, email]);
    if (exists.rows.length > 0) {
      return res.json(exists.rows[0]);
    }

    const result = await pool.query(`
      INSERT INTO leads (name, phone, email, source, status, pipeline_stage, created_at)
      VALUES ($1, $2, $3, $4, 'New', 'lead-inquire', NOW())
      RETURNING *
    `, [name, phone, email, source || 'Booking System']);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error converting virtual lead:', err);
    res.status(500).json({ error: 'Failed to create lead record' });
  }
});

app.patch('/api/leads/:id/stage', async (req, res) => {
  const { id } = req.params;
  const { pipeline_stage, remark, follow_up_date } = req.body;
  if (!pipeline_stage) {
    return res.status(400).json({ error: 'pipeline_stage is required' });
  }

  try {
    // Fetch current stage + contact info for therapist lookup
    const currentLeadRes = await pool.query(
      'SELECT pipeline_stage, remark_followup_1, remark_followup_2, remark_followup_3, phone, email, therapist_id FROM leads WHERE id::text = $1',
      [id]
    );
    if (currentLeadRes.rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

    const currentLead = currentLeadRes.rows[0];
    let remarkCol = REMARK_COLUMN_MAP[pipeline_stage];
    let tsCol = TIMESTAMP_COLUMN_MAP[pipeline_stage];

    // Slot-cycling logic for "Follow ups" stage
    if (pipeline_stage === 'followup-1' && currentLead.pipeline_stage === 'followup-1') {
      if (!currentLead.remark_followup_1) {
        remarkCol = 'remark_followup_1';
        tsCol = 'stage_followup_1_at';
      } else if (!currentLead.remark_followup_2) {
        remarkCol = 'remark_followup_2';
        tsCol = 'stage_followup_2_at';
      } else {
        remarkCol = 'remark_followup_3';
        tsCol = 'stage_followup_3_at';
      }
    }

    // When moving to booked-first-session, auto-lookup therapist from bookings table
    let therapistIdToSet: number | null = null;
    let therapistLookupLog = '';
    
    if (pipeline_stage === 'booked-first-session' && !currentLead.therapist_id) {
      const phone = (currentLead.phone || '').replace(/[\s\-\(\)\+]/g, '');
      const email = (currentLead.email || '').toLowerCase().trim();
      
      therapistLookupLog += `Therapist lookup for lead ${id} - Phone: ${phone}, Email: ${email}\n`;
      
      if (phone || email) {
        // Strategy 1: Phone OR Email match (improved logic)
        let bookingRes = await pool.query(
          `SELECT u.id as user_id, b.booking_host_name, t.name as therapist_name, b.booking_start_at
           FROM bookings b
           LEFT JOIN therapists t ON LOWER(TRIM(b.booking_host_name)) = LOWER(TRIM(t.name))
           LEFT JOIN users u ON u.therapist_id = t.therapist_id
           WHERE (
             ($1 != '' AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10))
             OR ($2 != '' AND LOWER(TRIM(b.invitee_email)) = $2)
           )
           AND b.booking_host_name IS NOT NULL
           AND t.name IS NOT NULL
           AND u.id IS NOT NULL
           ORDER BY b.booking_start_at DESC
           LIMIT 1`,
          [phone || '', email || '']
        );
        
        therapistLookupLog += `Strategy 1 (Phone OR Email): Found ${bookingRes.rows.length} results\n`;
        
        // Strategy 2: Partial name match if exact fails
        if (bookingRes.rows.length === 0 && phone) {
          bookingRes = await pool.query(
            `SELECT u.id as user_id, b.booking_host_name, t.name as therapist_name, b.booking_start_at
             FROM bookings b
             LEFT JOIN therapists t ON (
               LOWER(TRIM(b.booking_host_name)) ILIKE '%' || LOWER(TRIM(SPLIT_PART(t.name, ' ', 1))) || '%'
               OR LOWER(TRIM(t.name)) ILIKE '%' || LOWER(TRIM(SPLIT_PART(b.booking_host_name, ' ', 1))) || '%'
             )
             LEFT JOIN users u ON u.therapist_id = t.therapist_id
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
             AND b.booking_host_name IS NOT NULL
             AND t.name IS NOT NULL
             AND u.id IS NOT NULL
             ORDER BY b.booking_start_at DESC
             LIMIT 1`,
            [phone]
          );
          
          therapistLookupLog += `Strategy 2 (Partial match): Found ${bookingRes.rows.length} results\n`;
        }
        
        // Strategy 3: Direct user lookup (fallback)
        if (bookingRes.rows.length === 0 && phone) {
          bookingRes = await pool.query(
            `SELECT u.id as user_id, b.booking_host_name, u.name as user_name, b.booking_start_at
             FROM bookings b
             LEFT JOIN users u ON (
               LOWER(TRIM(u.name)) = LOWER(TRIM(b.booking_host_name))
               OR LOWER(TRIM(u.full_name)) = LOWER(TRIM(b.booking_host_name))
             )
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10)
             AND b.booking_host_name IS NOT NULL
             AND u.id IS NOT NULL
             AND u.role = 'therapist'
             ORDER BY b.booking_start_at DESC
             LIMIT 1`,
            [phone]
          );
          
          therapistLookupLog += `Strategy 3 (Direct user): Found ${bookingRes.rows.length} results\n`;
        }
        
        if (bookingRes.rows.length > 0) {
          therapistIdToSet = bookingRes.rows[0].user_id;
          therapistLookupLog += `SUCCESS: Assigned therapist ID ${therapistIdToSet} (${bookingRes.rows[0].booking_host_name})\n`;
        } else {
          therapistLookupLog += `FAILED: No therapist found for this lead\n`;
        }
        
        // Log the result for debugging
        console.log(`Therapist assignment for lead ${id}:`, therapistLookupLog);
      } else {
        therapistLookupLog += `SKIPPED: No phone or email available\n`;
      }
    }

    const timestampUpdate = tsCol ? `, ${tsCol} = NOW()` : '';
    const therapistUpdate = therapistIdToSet ? `, therapist_id = ${therapistIdToSet}` : '';
    let query, values;

    if (remarkCol && remark) {
      if (follow_up_date && pipeline_stage === 'followup-1') {
        query = `UPDATE leads SET pipeline_stage = $1, ${remarkCol} = $2${timestampUpdate}${therapistUpdate}, follow_up_1_date = $4, updated_at = NOW() WHERE id::text = $3 RETURNING *`;
        values = [pipeline_stage, remark, id, follow_up_date];
      } else {
        query = `UPDATE leads SET pipeline_stage = $1, ${remarkCol} = $2${timestampUpdate}${therapistUpdate}, updated_at = NOW() WHERE id::text = $3 RETURNING *`;
        values = [pipeline_stage, remark, id];
      }
    } else {
      if (follow_up_date && pipeline_stage === 'followup-1') {
        query = `UPDATE leads SET pipeline_stage = $1${timestampUpdate}${therapistUpdate}, follow_up_1_date = $3, updated_at = NOW() WHERE id::text = $2 RETURNING *`;
        values = [pipeline_stage, id, follow_up_date];
      } else {
        query = `UPDATE leads SET pipeline_stage = $1${timestampUpdate}${therapistUpdate}, updated_at = NOW() WHERE id::text = $2 RETURNING *`;
        values = [pipeline_stage, id];
      }
    }

    await pool.query(query, values);

    // Return lead enriched with resolved therapist_name
    const enriched = await pool.query(
      `SELECT leads.*, COALESCE(u.full_name, u.name) as therapist_name
       FROM leads
       LEFT JOIN users u ON leads.therapist_id::text = u.id::text
       WHERE leads.id::text = $1`,
      [id]
    );

    // Create audit log for stage change
    try {
      const leadData = enriched.rows[0];
      const stageNames: Record<string, string> = {
        'lead-inquire': 'Lead Inquire',
        'followup-1': 'Follow Up',
        'pretherapy-call': 'Pre-therapy Call',
        'booked-first-session': 'Booked First Session',
        'dropouts-unresponsive': 'Dropouts (Unresponsive)',
        'leaks': 'Leaks',
        'referred': 'Referred',
        'closed': 'Closed'
      };
      const stageName = stageNames[pipeline_stage] || pipeline_stage;
      const oldStageName = stageNames[currentLead.pipeline_stage] || currentLead.pipeline_stage;
      
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Sales Agent', 'lead_stage_change', `Moved lead from "${oldStageName}" to "${stageName}"`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.json(enriched.rows[0]);
  } catch (err) {
    console.error('Error updating lead stage:', err);
    res.status(500).json({ error: 'Failed to update lead stage' });
  }
});

// Manual therapist assignment endpoint
app.patch('/api/leads/:id/assign-therapist', async (req, res) => {
  const { id } = req.params;
  const { therapist_id } = req.body;
  
  if (!therapist_id) {
    return res.status(400).json({ error: 'therapist_id is required' });
  }

  try {
    // Verify the therapist exists
    const therapistCheck = await pool.query(
      'SELECT id, name, full_name FROM users WHERE id::text = $1 AND role = $2',
      [therapist_id, 'therapist']
    );
    
    if (therapistCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    // Update the lead
    await pool.query(
      'UPDATE leads SET therapist_id = $1, updated_at = NOW() WHERE id::text = $2',
      [therapist_id, id]
    );

    // Return updated lead with therapist name
    const enriched = await pool.query(
      `SELECT leads.*, COALESCE(u.full_name, u.name) as therapist_name
       FROM leads
       LEFT JOIN users u ON leads.therapist_id::text = u.id::text
       WHERE leads.id::text = $1`,
      [id]
    );

    res.json(enriched.rows[0]);
  } catch (err) {
    console.error('Error assigning therapist:', err);
    res.status(500).json({ error: 'Failed to assign therapist' });
  }
});

// Get all therapists for dropdown
app.get('/api/therapists', async (req, res) => {
  try {
    const therapists = await pool.query(`
      SELECT u.id, u.name, u.full_name, u.therapist_id, t.specialization,
             false as google_calendar_connected
      FROM users u
      LEFT JOIN therapists t ON u.therapist_id = t.therapist_id
      WHERE u.role = 'therapist'
        AND COALESCE(t.is_active, true) = true
        -- A users row carrying role='therapist' but no therapist_id has nothing
        -- to link to: no therapists record, so no schedules, calendars, bookings
        -- or availability. Every consumer of this list keys off therapist_id, so
        -- such a row is unusable and only shows up as a phantom name in pickers.
        -- One such row exists (an admin account mis-assigned the therapist role),
        -- and the frontend had been hiding it by matching on its literal name.
        AND u.therapist_id IS NOT NULL
      ORDER BY COALESCE(u.full_name, u.name)
    `);

    const formattedTherapists = therapists.rows.map(row => ({
      ...row,
      specializations: row.specialization ? row.specialization.split(',').map((s: string) => s.trim()) : []
    }));

    res.json(formattedTherapists);
  } catch (err) {
    console.error('Error fetching therapists:', err);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// DELETE therapist
app.delete('/api/therapists/:id', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete: mark therapist as inactive and delete their therapy services
    const therapistRes = await pool.query(
      'UPDATE therapists SET is_active = false WHERE therapist_id = $1 RETURNING therapist_id',
      [id]
    );
    if (therapistRes.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }
    // Delete all therapy services for this therapist
    await pool.query('DELETE FROM therapy_services WHERE therapist_id = $1', [id]);
    res.json({ success: true, message: 'Therapist deleted' });
  } catch (error: any) {
    console.error('Error deleting therapist:', error);
    res.status(500).json({ error: error.message || 'Failed to delete therapist' });
  }
});

// GET all clients associated with a specific therapist, including their upcoming sessions count
app.get('/api/therapists/:id/clients', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT
         MAX(invitee_name) as invitee_name,
         LOWER(TRIM(invitee_email)) as invitee_email,
         MAX(invitee_phone) as invitee_phone,
         COUNT(CASE WHEN booking_status = 'active' AND booking_start_at >= NOW() THEN 1 END) as upcoming_sessions
       FROM bookings
       WHERE therapist_id = $1
       GROUP BY LOWER(TRIM(invitee_email))
       ORDER BY upcoming_sessions DESC, invitee_name ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching therapist clients:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch clients' });
  }
});

// PATCH deactivate therapist
app.patch('/api/therapists/:id/deactivate', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapists SET is_active = false WHERE therapist_id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }
    // Also deactivate all their therapy services
    await pool.query('UPDATE therapy_services SET is_active = false WHERE therapist_id = $1', [id]);
    res.json({ success: true, message: 'Therapist deactivated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error deactivating therapist:', error);
    res.status(500).json({ error: error.message || 'Failed to deactivate therapist' });
  }
});

app.patch('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  try {
    const fieldMap: Record<string, string> = {
      name: 'name',
      phone: 'phone',
      email: 'email',
      created_at: 'created_at',
      source: 'source',
      sales_agent_id: 'sales_agent_id',
      therapist_id: 'therapist_id',
      age: 'age',
      city: 'city',
      preferred_mode_of_session: 'preferred_mode_of_session',
      pre_therapy_notes: 'pre_therapy_notes',
      emergency_contact_name: 'emergency_contact_name',
      emergency_contact_phone: 'emergency_contact_phone',
      emergency_contact_relation: 'emergency_contact_relation',
      therapy: 'therapy',
      remark_lead_manager: 'remark_lead_manager',
      remark_lead_inquire: 'remark_lead_inquire',
      remark_followup_1: 'remark_followup_1',
      remark_followup_2: 'remark_followup_2',
      remark_followup_3: 'remark_followup_3',
      remark_pretherapy_call: 'remark_pretherapy_call',
      remark_booked_first_session: 'remark_booked_first_session',
      remark_dropouts: 'remark_dropouts',
      remark_unresponsive: 'remark_unresponsive',
      remark_leaks: 'remark_leaks',
      remark_referred: 'remark_referred',
      remark_closed: 'remark_closed',
      general_remarks: 'general_remarks',
      tags: 'tags',
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) {
        setClauses.push(`${col} = $${idx}`);
        values.push(body[key] || null);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const query = `UPDATE leads SET ${setClauses.join(', ')} WHERE id::text = $${idx} RETURNING *`;
    console.log('Update Query:', query);
    console.log('Update Values:', values);
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Create audit log for lead update
    try {
      const leadData = result.rows[0];
      const updatedFields = Object.keys(body).filter(k => k in fieldMap).join(', ');
      await pool.query(
        `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [body.sales_agent_id, 'Sales Agent', 'lead_update', `Updated lead information (${updatedFields})`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating lead info:', err);
    res.status(500).json({ error: 'Failed to update lead info' });
  }
});

app.post('/api/leads', async (req, res) => {
  const { name, phone, email, city, age, source, sales_agent_id, general_remarks } = req.body;

  if (!name || !source) {
    return res.status(400).json({ error: 'Missing defined required fields' });
  }

  try {
    const normalizedPhone = phone ? phone.replace(/[\s\-\(\)\+]/g, '') : '';
    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    // Check for existing bookings to determine correct starting stage
    const bookingCheck = await pool.query(
      `SELECT b.booking_resource_name, b.invitee_payment_amount, u.id as user_id
             FROM bookings b
             LEFT JOIN therapists t ON b.booking_host_name ILIKE '%' || SPLIT_PART(t.name, ' ', 1) || '%'
             LEFT JOIN users u ON u.therapist_id = t.therapist_id AND u.role = 'therapist'
             WHERE (RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.invitee_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), 10) = RIGHT($1, 10) 
                OR (LOWER(TRIM(b.invitee_email)) = $2 AND $2 <> ''))
             AND b.booking_status NOT IN ('cancelled', 'canceled', 'no-show')
             ORDER BY b.booking_start_at DESC LIMIT 1`,
      [normalizedPhone, normalizedEmail]
    );

    let pipelineStage = 'lead-inquire';
    let therapistId = null;
    let timestampCol = 'stage_lead_inquire_at';

    if (bookingCheck.rows.length > 0) {
      const booking = bookingCheck.rows[0];
      const isFree = (booking.booking_resource_name || '').toLowerCase().includes('free consultation') ||
        parseFloat(booking.invitee_payment_amount || '0') === 0;

      if (isFree) {
        pipelineStage = 'pretherapy-call';
        timestampCol = 'stage_pretherapy_call_at';
      } else {
        pipelineStage = 'booked-first-session';
        timestampCol = 'stage_booked_first_session_at';
      }

      // Resolve internal therapist ID
      const therapistExtId = booking.therapist_id || booking.booking_host_user_id?.toString();
      if (therapistExtId) {
        const uRes = await pool.query(
          'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
          [therapistExtId]
        );
        if (uRes.rows.length > 0) {
          therapistId = uRes.rows[0].id;
        }
      }

      console.log(`ℹ️ [Lead creation] Auto-routing ${name} to ${pipelineStage} based on booking history (Therapist: ${therapistId || 'N/A'}).`);
    }

    const insertQuery = `
          INSERT INTO leads (
            name, phone, email, city, age, source, sales_agent_id, therapist_id,
            status, pipeline_stage, ${timestampCol}, general_remarks
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, 
            'New', $9, CURRENT_TIMESTAMP, $10
          ) RETURNING *;
        `;

    const ageVal = age ? parseInt(age) : null;
    const values = [name, phone, email || null, city || null, ageVal, source, sales_agent_id, therapistId, pipelineStage, general_remarks || null];
    const result = await pool.query(insertQuery, values);

    // Create audit log for lead creation
    try {
      const leadData = result.rows[0];
      await pool.query(
        `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sales_agent_id, 'Sales Agent', 'lead_create', `Created new lead: ${name} (Source: ${source})`, leadData.id, name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// Delete lead endpoint
app.delete('/api/leads/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Check if lead exists and get lead info for audit log
    const checkLead = await pool.query('SELECT id, name FROM leads WHERE id::text = $1', [id]);
    
    if (checkLead.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const leadData = checkLead.rows[0];

    // Create audit log before deletion
    try {
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Sales Agent', 'lead_delete', `Deleted lead: ${leadData.name}`, leadData.id, leadData.name]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    // Delete the lead
    await pool.query('DELETE FROM leads WHERE id::text = $1', [id]);
    
    res.status(200).json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Error deleting lead:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// Pre-Therapy Call Form Endpoints
app.post('/api/pretherapy-form', async (req, res) => {
  try {
    const {
      lead_id, submitted_by,
      age, language, language_other, location, location_manual,
      mode_of_session, previous_therapy, concerns, concerns_other,
      clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
      suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
      preferred_therapy_approach, preferred_therapy_text,
      consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
      readiness, readiness_other, consented_followup, followup_mode,
      client_questions, source, source_other, consultation_outcome, close_reason
    } = req.body;

    const result = await pool.query(
      `INSERT INTO pretherapy_call_forms (
        lead_id, submitted_by,
        age, language, language_other, location, location_manual,
        mode_of_session, previous_therapy, concerns, concerns_other,
        clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
        suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
        preferred_therapy_approach, preferred_therapy_text,
        consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
        readiness, readiness_other, consented_followup, followup_mode,
        client_questions, source, source_other, consultation_outcome, close_reason
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34
      ) RETURNING *`,
      [
        lead_id, submitted_by || null,
        age || null, language || null, language_other || null, location || null, location_manual || null,
        mode_of_session || null, previous_therapy || null, concerns || null, concerns_other || null,
        clinical_concerns_observed || null, clinical_concerns || null, psychiatric_treatment || null,
        suicidal_thoughts || null, suicidal_current || null, suicidal_ideation_1m || null, suicidal_attempt_1m || null,
        preferred_therapy_approach || null, preferred_therapy_text || null,
        consent_explained || null, consent_no_reason || null, scope_explained || null, preferred_price || null, preferred_price_other || null,
        readiness || null, readiness_other || null, consented_followup || null, followup_mode || null,
        client_questions || null, source || null, source_other || null, consultation_outcome || null, close_reason || null
      ]
    );

    // AUTOMATION: Move lead stage based on consultation outcome
    let targetStage = null;
    let newTags = null;

    if (consultation_outcome === 'Session booked') {
      targetStage = 'booked-first-session';
    } else if (consultation_outcome === 'To be followed up') {
      targetStage = 'followup-1';
    } else if (consultation_outcome === 'Referred') {
      targetStage = 'referred';
    } else if (consultation_outcome === 'Closed - Reason') {
      targetStage = 'closed';
    }

    if (targetStage) {
      const tsCol = TIMESTAMP_COLUMN_MAP[targetStage];
      const tsUpdate = tsCol ? `, ${tsCol} = NOW()` : '';
      const tagUpdate = newTags ? `, tags = $3` : '';

      const updateQuery = `UPDATE leads SET pipeline_stage = $1${tsUpdate}${tagUpdate}, updated_at = NOW() WHERE id::text = $2`;
      const updateValues = newTags ? [targetStage, lead_id, newTags] : [targetStage, lead_id];

      await pool.query(updateQuery, updateValues);
    }

    // Create audit log for pre-therapy form submission
    try {
      const leadResult = await pool.query('SELECT name FROM leads WHERE id::text = $1', [lead_id]);
      const leadName = leadResult.rows.length > 0 ? leadResult.rows[0].name : 'Unknown';
      
      await pool.query(
        `INSERT INTO crm_audit_logs (user_name, action_type, action_description, lead_id, lead_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [submitted_by || 'Sales Agent', 'pretherapy_form_submit', `Submitted pre-therapy call form (Outcome: ${consultation_outcome || 'N/A'})`, lead_id, leadName]
      );
    } catch (auditErr) {
      console.error('Error creating audit log:', auditErr);
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error saving pretherapy form:', err);
    res.status(500).json({ error: 'Failed to save pre-therapy call form' });
  }
});

app.get('/api/pretherapy-form/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const result = await pool.query(
      `SELECT * FROM pretherapy_call_forms WHERE lead_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
      [leadId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No form found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching pretherapy form:', err);
    res.status(500).json({ error: 'Failed to fetch pre-therapy call form' });
  }
});

app.patch('/api/pretherapy-form/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const {
      age, language, language_other, location, location_manual,
      mode_of_session, previous_therapy, concerns, concerns_other,
      clinical_concerns_observed, clinical_concerns, psychiatric_treatment,
      suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
      preferred_therapy_approach, preferred_therapy_text,
      consent_explained, consent_no_reason, scope_explained, preferred_price, preferred_price_other,
      readiness, readiness_other, consented_followup, followup_mode,
      client_questions, source, source_other, consultation_outcome, close_reason
    } = req.body;

    const result = await pool.query(
      `UPDATE pretherapy_call_forms SET
        age = $2, language = $3, language_other = $4, location = $5, location_manual = $6,
        mode_of_session = $7, previous_therapy = $8, concerns = $9, concerns_other = $10,
        clinical_concerns_observed = $11, clinical_concerns = $12, psychiatric_treatment = $13,
        suicidal_thoughts = $14, suicidal_current = $15, suicidal_ideation_1m = $16, suicidal_attempt_1m = $17,
        preferred_therapy_approach = $18, preferred_therapy_text = $19,
        consent_explained = $20, consent_no_reason = $21, scope_explained = $22, preferred_price = $23, preferred_price_other = $24,
        readiness = $25, readiness_other = $26, consented_followup = $27, followup_mode = $28,
        client_questions = $29, source = $30, source_other = $31, consultation_outcome = $32, close_reason = $33
       WHERE id = (SELECT id FROM pretherapy_call_forms WHERE lead_id = $1 ORDER BY submitted_at DESC LIMIT 1)
       RETURNING *`,
      [
        leadId,
        age || null, language || null, language_other || null, location || null, location_manual || null,
        mode_of_session || null, previous_therapy || null, concerns || null, concerns_other || null,
        clinical_concerns_observed || null, clinical_concerns || null, psychiatric_treatment || null,
        suicidal_thoughts || null, suicidal_current || null, suicidal_ideation_1m || null, suicidal_attempt_1m || null,
        preferred_therapy_approach || null, preferred_therapy_text || null,
        consent_explained || null, consent_no_reason || null, scope_explained || null, preferred_price || null, preferred_price_other || null,
        readiness || null, readiness_other || null, consented_followup || null, followup_mode || null,
        client_questions || null, source || null, source_other || null, consultation_outcome || null, close_reason || null
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found to update' });
    }

    // Note: We skip stage automation on simple edit unless required
    res.json({ message: 'Pre-therapy form updated successfully', data: result.rows[0] });
  } catch (err) {
    console.error('Error updating pre-therapy form:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/lead-managers', async (req, res) => {
  try {
    // Anyone who can open the CRM can own a lead, not only the sales role —
    // otherwise a therapist granted CRM access could work leads but never be
    // assigned one, which makes the grant half a permission.
    const result = await pool.query(`
      SELECT u.id, COALESCE(u.full_name, u.name) AS name
        FROM users u
        LEFT JOIN user_access_grants g ON g.user_id = u.id AND g.scope = 'crm'
       WHERE u.role = 'sales' OR g.user_id IS NOT NULL
       ORDER BY name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching lead managers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const { sourceMonth, funnelMonth, statsMonth } = req.query;
    let statsWhereClause = '';
    let statsQueryParams: any[] = [];
    if (statsMonth && typeof statsMonth === 'string' && statsMonth !== 'All Time') {
      const [monthName, yearStr] = statsMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;
      if (monthIndex > 0 && yearStr) {
        statsWhereClause = 'WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2';
        statsQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }
    let sourceWhereClause = '';
    let sourceQueryParams: any[] = [];
    let funnelWhereClause = '';
    let funnelQueryParams: any[] = [];

    if (sourceMonth && typeof sourceMonth === 'string') {
      const [monthName, yearStr] = sourceMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;

      if (monthIndex > 0 && yearStr) {
        sourceWhereClause = 'WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2';
        sourceQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    if (funnelMonth && typeof funnelMonth === 'string') {
      const [monthName, yearStr] = funnelMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;

      if (monthIndex > 0 && yearStr) {
        funnelQueryParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    // Calculate stats with optional month filter for the top stat cards
    const totalLeadsRes = await pool.query(`SELECT COUNT(*) as count FROM leads ${statsWhereClause}`, statsQueryParams);
    const sourcesRes = await pool.query(`SELECT source as name, COUNT(*) as value FROM leads ${sourceWhereClause} GROUP BY source`, sourceQueryParams);

    // Build funnel query: each stage filtered by its own timestamp column
    let funnelRes;
    if (funnelQueryParams.length === 2) {
      const [fMonth, fYear] = funnelQueryParams;
      funnelRes = await pool.query(`
        SELECT stage, COUNT(*) as value FROM (
          SELECT 'lead-inquire' as stage FROM leads WHERE EXTRACT(MONTH FROM COALESCE(stage_lead_inquire_at, created_at)) = $1 AND EXTRACT(YEAR FROM COALESCE(stage_lead_inquire_at, created_at)) = $2
          UNION ALL
          SELECT 'pretherapy-call' FROM leads WHERE stage_pretherapy_call_at IS NOT NULL AND EXTRACT(MONTH FROM stage_pretherapy_call_at) = $1 AND EXTRACT(YEAR FROM stage_pretherapy_call_at) = $2
          UNION ALL
          SELECT 'followup-1' FROM leads WHERE stage_followup_1_at IS NOT NULL AND EXTRACT(MONTH FROM stage_followup_1_at) = $1 AND EXTRACT(YEAR FROM stage_followup_1_at) = $2
          UNION ALL
          SELECT 'booked-first-session' FROM leads WHERE stage_booked_first_session_at IS NOT NULL AND EXTRACT(MONTH FROM stage_booked_first_session_at) = $1 AND EXTRACT(YEAR FROM stage_booked_first_session_at) = $2
          UNION ALL
          SELECT 'referred' FROM leads WHERE stage_referred_at IS NOT NULL AND EXTRACT(MONTH FROM stage_referred_at) = $1 AND EXTRACT(YEAR FROM stage_referred_at) = $2
          UNION ALL
          SELECT 'closed' FROM leads WHERE stage_closed_at IS NOT NULL AND EXTRACT(MONTH FROM stage_closed_at) = $1 AND EXTRACT(YEAR FROM stage_closed_at) = $2
          UNION ALL
          SELECT 'dropouts' FROM leads WHERE stage_dropouts_at IS NOT NULL AND EXTRACT(MONTH FROM stage_dropouts_at) = $1 AND EXTRACT(YEAR FROM stage_dropouts_at) = $2
          UNION ALL
          SELECT 'leaks' FROM leads WHERE stage_leaks_at IS NOT NULL AND EXTRACT(MONTH FROM stage_leaks_at) = $1 AND EXTRACT(YEAR FROM stage_leaks_at) = $2
        ) t GROUP BY stage
      `, [fMonth, fYear]);
    } else {
      // No month filter — show all leads grouped by current stage
      funnelRes = await pool.query(`SELECT pipeline_stage as stage, COUNT(*) as value FROM leads GROUP BY pipeline_stage`);
    }


    // Fetch stats with optional month filter for the top stat cards
    // Each card uses the relevant stage timestamp for filtering (not created_at)
    let stageMonthFilter = '';
    let stageMonthParams: any[] = [];
    if (statsMonth && typeof statsMonth === 'string' && statsMonth !== 'All Time') {
      const [monthName, yearStr] = statsMonth.split(' ');
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const monthIndex = monthNames.indexOf(monthName) + 1;
      if (monthIndex > 0 && yearStr) {
        stageMonthParams = [monthIndex, parseInt(yearStr, 10)];
      }
    }

    const buildStageFilter = (stageCol: string) =>
      stageMonthParams.length === 2
        ? `AND ${stageCol} IS NOT NULL AND EXTRACT(MONTH FROM ${stageCol}) = $1 AND EXTRACT(YEAR FROM ${stageCol}) = $2`
        : '';

    const allTimeDropoutsRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'dropouts' ${buildStageFilter('stage_dropouts_at')}`,
      stageMonthParams
    );
    const allTimeLeaksRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'leaks' ${buildStageFilter('stage_leaks_at')}`,
      stageMonthParams
    );
    const allTimeClosedRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE pipeline_stage = 'closed' ${buildStageFilter('stage_closed_at')}`,
      stageMonthParams
    );
    const allTimeBookedRes = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE stage_booked_first_session_at IS NOT NULL ${buildStageFilter('stage_booked_first_session_at')}`,
      stageMonthParams
    );

    const dropoutsCount = allTimeDropoutsRes.rows[0].count;
    const leaksCount = allTimeLeaksRes.rows[0].count;
    const closedCount = parseInt(allTimeClosedRes.rows[0].count);
    const totalLeadsCount = parseInt(totalLeadsRes.rows[0].count);
    const allTimeBookedCount = parseInt(allTimeBookedRes.rows[0].count);
    // Calculate all-time conversion rate for the stat cards
    const allTimeConversionRate = totalLeadsCount > 0 ? Math.round((allTimeBookedCount / totalLeadsCount) * 100) : 0;

    res.json({
      totalLeads: parseInt(totalLeadsRes.rows[0].count),
      dropouts: parseInt(dropoutsCount),
      leaks: parseInt(leaksCount),
      closed: closedCount,
      allTimeConversionRate,
      allTimeBookedCount,
      sources: sourcesRes.rows.map(row => ({ name: row.name, value: parseInt(row.value) })),
      funnel: funnelRes.rows.map(row => ({ label: row.stage || row.label, value: parseInt(row.value) }))
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics', details: (err as Error).message });
  }
});

app.get('/api/crm/todo', async (req, res) => {
  try {
    const consultationCalls = await pool.query(`
      SELECT id, name, phone, email, stage_lead_inquire_at as follow_up_1_date, remark_lead_inquire as follow_up_1_notes, 'Lead/Inquiry' as next_step
      FROM leads 
      WHERE pipeline_stage = 'lead-inquire'
      ORDER BY stage_lead_inquire_at DESC NULLS LAST
    `);

    const followups = await pool.query(`
      SELECT id, name, phone, email, follow_up_1_date, remark_followup_1 as follow_up_1_notes, 'Follow up attempt' as next_step
      FROM leads 
      WHERE pipeline_stage = 'followup-1'
      ORDER BY follow_up_1_date ASC NULLS LAST
    `);

    res.json({
      consultationCalls: consultationCalls.rows,
      followups: followups.rows
    });
  } catch (err) {
    console.error('Error fetching todo list:', err);
    res.status(500).json({ error: 'Failed to fetch todo list' });
  }
});


// Update password
app.post('/api/update-password', async (req, res) => {
  try {
    const { user_id, new_password, current_password } = req.body;

    if (!user_id || !new_password) {
      return res.status(400).json({ success: false, error: 'User ID and new password are required' });
    }
    // Proof of identity. The client also pre-checks via /api/verify-password for
    // fast feedback, but that call is advisory — this is the one that decides.
    if (!current_password) {
      return res.status(400).json({ success: false, error: 'Current password is required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const existing = await pool.query('SELECT password FROM users WHERE id = $1', [user_id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (!(await verifyPassword(current_password, existing.rows[0].password))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    const result = await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [await hashPassword(new_password), user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ success: false, error: 'Failed to update password' });
  }
});

// ==================== FORGOT PASSWORD ENDPOINTS ====================

/**
 * A 6-digit code from the CSPRNG.
 *
 * Math.random() is V8's xorshift128+ — fast, well distributed, and
 * reconstructible from a modest run of observed outputs. That is fine for a
 * jitter value and wrong for anything that gates access. generateToken() two
 * lines below already used crypto; this now matches it.
 */
function generateOTP(): string {
  return String(crypto.randomInt(100000, 1000000));
}

// Helper function to generate secure token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 1. Send OTP for password reset
app.post('/api/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    // Check if user exists
    const userResult = await pool.query(
      `SELECT id, username, full_name, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [email]
    );

    // For testing: Allow OTP for any email (even if not in database)
    const user = userResult.rows.length > 0
      ? userResult.rows[0]
      : { id: null, username: 'User', full_name: 'User', email: email };

    // Check rate limiting (max 3 requests per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const attemptsResult = await pool.query(
      `SELECT COUNT(*) as count FROM password_reset_attempts 
       WHERE LOWER(email) = LOWER($1) AND attempted_at > $2`,
      [email, oneHourAgo]
    );

    const attemptCount = parseInt(attemptsResult.rows[0].count);
    if (attemptCount >= 3) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again in an hour.'
      });
    }

    // Generate OTP and token
    const otp = generateOTP();
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store in database
    await pool.query(
      `INSERT INTO password_reset_tokens 
       (user_id, email, otp, token, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, email, otp, token, expiresAt, ipAddress, req.headers['user-agent']]
    );

    // Log attempt
    await pool.query(
      `INSERT INTO password_reset_attempts (email, ip_address, success)
       VALUES ($1, $2, true)`,
      [email, ipAddress]
    );

    // Send email
    try {
      await sendPasswordResetOTP(email, user.full_name || user.username, otp, expiresAt);

      res.json({
        success: true,
        message: 'OTP sent to your email',
        expiresIn: 600 // 10 minutes in seconds
      });
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError);
      res.status(500).json({
        success: false,
        error: 'Failed to send OTP email. Please try again.'
      });
    }

  } catch (error) {
    console.error('❌ Error in send-otp:', error);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// 2. Verify OTP
/**
 * Attempts allowed against ONE reset request before it is burned.
 *
 * Five is enough for a mistyped code and nowhere near enough to search a
 * 900,000-value space. Exceeding it marks the record used, so recovery costs a
 * fresh email — and send-otp's three-per-hour ceiling governs how fast an
 * attacker can buy new records to guess at.
 */
const MAX_OTP_ATTEMPTS = 5;

app.post('/api/forgot-password/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    // Look the record up by EMAIL, never by email+otp.
    //
    // Matching on the code meant a wrong guess found no row, and a request that
    // finds no row cannot be charged an attempt — which is precisely why
    // unlimited guessing worked. Fetching the live record first means every
    // guess is counted whether or not it was right.
    //
    // Restricted to the newest unexpired record, where the old query took any
    // unused one: every code a user had ever requested and abandoned stayed
    // valid until it expired, multiplying an attacker's chances for free.
    const result = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE LOWER(email) = LOWER($1) AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid OTP' });
    }

    const resetRecord = result.rows[0];

    if (resetRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [resetRecord.id]);
      console.warn(`[reset] attempt limit reached for ${email}; code burned`);
      return res.status(429).json({
        success: false,
        error: 'Too many incorrect attempts. Please request a new code.',
      });
    }

    // Constant-time compare, on equal-length buffers — timingSafeEqual throws on
    // a length mismatch, so a wrong-length guess must be rejected before it and
    // still charged an attempt.
    const supplied = Buffer.from(String(otp));
    const expected = Buffer.from(String(resetRecord.otp));
    const matches =
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);

    if (!matches) {
      const bumped = await pool.query(
        `UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
        [resetRecord.id]
      );
      const used = bumped.rows[0]?.attempts ?? MAX_OTP_ATTEMPTS;
      console.warn(`[reset] wrong code for ${email} (${used}/${MAX_OTP_ATTEMPTS})`);
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP',
        attemptsRemaining: Math.max(MAX_OTP_ATTEMPTS - used, 0),
      });
    }

    // Mark as verified (but not used yet)
    await pool.query(
      `UPDATE password_reset_tokens SET verified = true WHERE id = $1`,
      [resetRecord.id]
    );

    res.json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: resetRecord.token
    });

  } catch (error) {
    console.error('❌ Error in verify-otp:', error);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

// 3. Reset password
app.post('/api/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, OTP, and new password are required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one uppercase letter' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one lowercase letter' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one number' });
    }

    // Looked up by email and charged per guess, exactly as verify-otp is.
    //
    // Reaching here already requires a record someone verified, so this is the
    // second lock rather than the first — but a step that takes a code and
    // answers "right or wrong" is a guessing oracle wherever it sits, and this
    // one hands back a password change.
    const result = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE LOWER(email) = LOWER($1) AND verified = true AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or unverified OTP' });
    }

    const resetRecord = result.rows[0];

    if (resetRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await pool.query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [resetRecord.id]);
      return res.status(429).json({
        success: false,
        error: 'Too many incorrect attempts. Please request a new code.',
      });
    }

    const suppliedOtp = Buffer.from(String(otp));
    const expectedOtp = Buffer.from(String(resetRecord.otp));
    if (suppliedOtp.length !== expectedOtp.length || !crypto.timingSafeEqual(suppliedOtp, expectedOtp)) {
      await pool.query(
        `UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = $1`,
        [resetRecord.id]
      );
      return res.status(400).json({ success: false, error: 'Invalid or unverified OTP' });
    }

    // Update password
    const updateResult = await pool.query(
      `UPDATE users SET password = $1 WHERE id = $2 RETURNING id, username`,
      [await hashPassword(newPassword), resetRecord.user_id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Mark token as used
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
      [resetRecord.id]
    );

    // Invalidate all other reset tokens for this user
    await pool.query(
      `UPDATE password_reset_tokens SET used = true 
       WHERE user_id = $1 AND id != $2 AND used = false`,
      [resetRecord.user_id, resetRecord.id]
    );

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('❌ Error in reset password:', error);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// ==================== END FORGOT PASSWORD ENDPOINTS ====================

// Get admin profile
app.get('/api/admin-profile', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email, 
        u.phone, 
        COALESCE(u.profile_picture_url, t.profile_picture_url) as profile_picture_url 
       FROM users u 
       LEFT JOIN therapists t ON u.therapist_id = t.therapist_id 
       WHERE u.id = $1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({ error: 'Failed to fetch admin profile', details: error.message });
  }
});

// Update admin profile
app.put('/api/admin-profile', async (req, res) => {
  try {
    const {
      user_id,
      name,
      email,
      phone,
      profilePictureUrl
    } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const result = await pool.query(
      `UPDATE users 
       SET full_name = $1, email = $2, phone = $3, profile_picture_url = $4
       WHERE id = $5
       RETURNING id, username, full_name, email, phone, profile_picture_url`,
      [name, email, phone, profilePictureUrl, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ error: 'Failed to update admin profile' });
  }
});

// Get live sessions count
app.get('/api/live-sessions-count', async (req, res) => {
  try {
    // Prevent caching of live session data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT booking_invitee_time
      FROM bookings
      WHERE booking_status NOT IN ('cancelled', 'canceled', 'no_show')
        AND therapist_id IS NOT NULL
        AND booking_resource_name NOT ILIKE '%free consultation%'
    `);

    let liveCount = 0;

    result.rows.forEach(row => {
      const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+:\d+\s+[AP]M)\s+-\s+(\d+:\d+\s+[AP]M)/);

      if (timeMatch) {
        const dateStr = (row.booking_invitee_time || '').match(/(\w+,\s+\w+\s+\d+,\s+\d+)/)?.[1];
        const startTimeStr = timeMatch[1];
        const endTimeStr = timeMatch[2];

        if (dateStr) {
          const startIST = new Date(`${dateStr} ${startTimeStr} GMT+0530`);
          const endIST = new Date(`${dateStr} ${endTimeStr} GMT+0530`);
          const nowUTC = new Date();

          if (nowUTC >= startIST && nowUTC <= endIST) {
            liveCount++;
          }
        }
      }
    });

    res.json({ liveCount });
  } catch (error) {
    console.error('Error fetching live sessions count:', error);
    res.status(500).json({ error: 'Failed to fetch live sessions count' });
  }
});

// Get dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { start, end } = req.query;
    const hasDateFilter = start && end;

    // Calculate last month date range
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const EXCL_SS = "";
    // Sessions Completed KPI = therapy sessions that actually occurred.
    // OCCURRED: end-time in the past, excluding cancelled / no-show / unpaid. COALESCE keeps
    // null-status dashboard-direct bookings in (any booking source counts, incl. manual/direct).
    // Free Consultation is excluded from the Bookings and Sessions Completed KPIs entirely —
    // it has its own KPI card and its own tab on the bookings page.
    // NOT_FREE: that exclusion for the Bookings-card queries. Reads resource_name AND subject
    // because some bookings record the medium ("Google Meet") in resource_name. COALESCE keeps
    // rows with a NULL resource_name in (NULL NOT ILIKE ... would otherwise drop them).
    const NOT_FREE = "AND (COALESCE(booking_resource_name,'') || ' ' || COALESCE(booking_subject,'')) NOT ILIKE '%Free Consultation%'";

    // Cancelling normally takes a booking out of revenue, which is right when the
    // money went back to the client. It is wrong for a Cash/QR cancellation the
    // admin marked "No refund": that money was collected and is being kept, so it
    // stays counted even though the session never happened.
    //
    // Scoped to Paid rows so an unpaid booking can never be revived into revenue
    // by the action column alone. Wallet credits and offline refunds are NOT
    // listed here — they leave revenue, which is what dropping out already does.
    // A wallet credit re-enters revenue when it is redeemed against a real session.
    const KEPT_ON_CANCEL = `OR (cancellation_action = 'no_refund' AND payment_status = 'Paid')`;

    const revenue = hasDateFilter
      ? await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE (booking_status NOT IN ($1, $2, $3, $4) ${KEPT_ON_CANCEL}) ${EXCL_SS} AND booking_start_at BETWEEN $5 AND $6`,
        ['cancelled', 'canceled', 'payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COALESCE(SUM(invitee_payment_amount), 0) as total FROM bookings WHERE (booking_status NOT IN ($1, $2, $3, $4) ${KEPT_ON_CANCEL}) ${EXCL_SS}`,
        ['cancelled', 'canceled', 'payment_pending', 'payment_failed']
      );

    // Bookings - paid session types only; Free Consultation has its own KPI card
    const bookings = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${NOT_FREE} ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${NOT_FREE} ${EXCL_SS}`,
        ['payment_pending', 'payment_failed']
      );

    // ── Sessions Completed (+ per-type breakdown) ──────────────────────────────
    // Computed in JS using the SAME derivation as /api/appointments, so this KPI and the
    // bookings page "Completed Sessions" tab can never disagree.
    // Why not SQL on booking_end_at: booking_start_at/booking_end_at are stored in mixed
    // timezone conventions (some UTC, some IST wall-clock), so they are unreliable for
    // "has this happened yet" checks — they wrongly flag not-yet-started sessions as past.
    // booking_invitee_time is normalised by convertToIST() into an unambiguous instant.
    const completedRowsRes = await pool.query(`
      SELECT b.booking_id, b.booking_invitee_time, b.booking_resource_name, b.booking_subject,
             b.booking_status,
             CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL
                     OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END AS has_session_notes,
             (b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes') AS is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
    `);

    const nowMsKpi = Date.now();
    // Type is read from resource_name AND subject: some bookings record the medium
    // ("Google Meet") in resource_name, leaving the real type only in the subject.
    const typeText = (r: any) => `${r.booking_resource_name || ''} ${r.booking_subject || ''}`;
    const isFreeRow = (r: any) => /free consultation/i.test(typeText(r));

    // Same rule as /api/appointments: completed once it has notes, or once its start time
    // has passed — excluding cancelled / no-show / unpaid holds.
    const occurredRows = completedRowsRes.rows.filter((r: any) => {
      const norm = (r.booking_status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (UNPAID_HOLD_STATUSES.has(norm)) return false;
      if (norm === 'cancelled' || norm === 'canceled' || norm === 'no_show') return false;
      const startMs = getBookingStartMs(r.booking_invitee_time);
      const hasStarted = startMs !== null ? startMs <= nowMsKpi : r.is_past;
      return r.has_session_notes || hasStarted;
    });

    // Date-range bounds are IST calendar days, matching how sessions are displayed.
    const inRangeIST = (r: any, from?: string, to?: string) => {
      if (!from || !to) return true;
      const ms = getBookingStartMs(r.booking_invitee_time);
      if (ms === null) return false;
      const fromMs = new Date(`${String(from).slice(0, 10)}T00:00:00+05:30`).getTime();
      const toMs = new Date(`${String(to).slice(0, 10)}T23:59:59+05:30`).getTime();
      return ms >= fromMs && ms <= toMs;
    };

    const occurredInRange = hasDateFilter
      ? occurredRows.filter((r: any) => inRangeIST(r, start, end))
      : occurredRows;

    const paidCompletedRows = occurredInRange.filter((r: any) => !isFreeRow(r));
    const sessionsCompletedCount = paidCompletedRows.length;

    // Each session lands in exactly one bucket, so the breakdown lines never exceed the
    // total. resource_name is authoritative; the subject is only consulted when the
    // resource_name holds a medium/location string instead of the therapy type.
    const classifyPaid = (s: string) =>
      /adolescent therapy/i.test(s) ? 'adolescent'
        : /couples? therapy/i.test(s) ? 'couples'
          : /individual therapy|individual session/i.test(s) ? 'individual'
            : null;
    const paidTypeOf = (r: any) =>
      classifyPaid(r.booking_resource_name || '') || classifyPaid(r.booking_subject || '') || 'other';

    const individualCompletedCount = paidCompletedRows.filter((r: any) => paidTypeOf(r) === 'individual').length;
    const adolescentCompletedCount = paidCompletedRows.filter((r: any) => paidTypeOf(r) === 'adolescent').length;
    const couplesTherapyCompletedCount = paidCompletedRows.filter((r: any) => paidTypeOf(r) === 'couples').length;
    // Any paid type that is none of the above. Surfaced so the card's breakdown always adds
    // up to the total; the UI hides this row when it is zero.
    const otherTherapyCompletedCount = paidCompletedRows.filter((r: any) => paidTypeOf(r) === 'other').length;
    const freeConsultationCompletedCount = occurredInRange.filter(isFreeRow).length;

    const freeConsultations = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_status NOT IN ($1, $2) AND booking_start_at BETWEEN $3 AND $4`,
        ['payment_pending', 'payment_failed', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_status NOT IN ($1, $2)`,
        ['payment_pending', 'payment_failed']
      );

    const cancelled = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${NOT_FREE} ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['cancelled', 'canceled', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${NOT_FREE} ${EXCL_SS}`,
        ['cancelled', 'canceled']
      );

    const refunds = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS}`
      );

    const refundedAmount = hasDateFilter
      ? await pool.query(
        `SELECT COALESCE(SUM(refund_amount), 0) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS} AND booking_start_at BETWEEN $1 AND $2`,
        [start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COALESCE(SUM(refund_amount), 0) as total FROM bookings WHERE refund_status IS NOT NULL ${EXCL_SS}`
      );

    const noShows = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${NOT_FREE} ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
        ['no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${NOT_FREE} ${EXCL_SS}`,
        ['no_show', 'no show']
      );

    // Last month stats
    const lastMonthBookings = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status NOT IN ($1, $2) ${NOT_FREE} ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['payment_pending', 'payment_failed', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthSessionsCompletedCount = occurredRows.filter((r: any) =>
      !isFreeRow(r) && inRangeIST(r, lastMonthStart.toISOString(), lastMonthEnd.toISOString())).length;

    const lastMonthFreeConsultations = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE (invitee_payment_amount = 0 OR invitee_payment_amount IS NULL) AND booking_start_at BETWEEN $1 AND $2',
      [lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthCancelled = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['cancelled', 'canceled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthRefunds = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE refund_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['completed', 'processed', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthNoShows = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE booking_status IN ($1, $2) ${EXCL_SS} AND booking_start_at BETWEEN $3 AND $4`,
      ['no_show', 'no show', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );
    const responseData = {
      revenue: revenue.rows[0].total,
      refundedAmount: refundedAmount.rows[0].total,
      bookings: bookings.rows[0].total,
      lastMonthBookings: lastMonthBookings.rows[0].total,
      sessionsCompleted: sessionsCompletedCount,
      lastMonthSessionsCompleted: lastMonthSessionsCompletedCount,
      freeConsultations: freeConsultations.rows[0].total,
      lastMonthFreeConsultations: lastMonthFreeConsultations.rows[0].total,
      cancelled: cancelled.rows[0].total,
      lastMonthCancelled: lastMonthCancelled.rows[0].total,
      refunds: refunds.rows[0].total,
      lastMonthRefunds: lastMonthRefunds.rows[0].total,
      noShows: noShows.rows[0].total,
      lastMonthNoShows: lastMonthNoShows.rows[0].total,
      individualTherapyCompleted: individualCompletedCount,
      adolescentTherapyCompleted: adolescentCompletedCount,
      couplesTherapyCompleted: couplesTherapyCompletedCount,
      otherTherapyCompleted: otherTherapyCompletedCount,
      freeConsultationCompleted: freeConsultationCompletedCount,
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get upcoming bookings
app.get('/api/dashboard/bookings', async (req, res) => {
  try {
    // Prevent caching of booking data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { start, end, limit = '3' } = req.query;
    const limitNum = parseInt(limit as string) || 3;

    const result = start && end
      ? await pool.query(
        `SELECT
            invitee_name as client_name,
            invitee_email as client_email,
            invitee_phone as client_phone,
            booking_resource_name as therapy_type,
            booking_mode as mode,
            booking_host_name as therapist_name,
            booking_invitee_time,
            booking_joining_link,
            booking_id
          FROM bookings
          WHERE booking_status IN ('confirmed', 'scheduled')
            AND LOWER(TRIM(booking_host_name)) != 'safestories'
            AND booking_start_at BETWEEN $1 AND $2
          ORDER BY booking_start_at ASC
          LIMIT $3`,
        [start, `${end} 23:59:59`, limitNum]
      )
      : await pool.query(
        `SELECT
            invitee_name as client_name,
            invitee_email as client_email,
            invitee_phone as client_phone,
            booking_resource_name as therapy_type,
            booking_mode as mode,
            booking_host_name as therapist_name,
            booking_invitee_time,
            booking_joining_link,
            booking_id
          FROM bookings
          WHERE booking_status IN ('confirmed', 'scheduled')
            AND LOWER(TRIM(booking_host_name)) != 'safestories'
          ORDER BY booking_start_at ASC`
      );

    // Filter upcoming sessions based on booking_invitee_time
    const nowUTC = new Date();
    const upcomingBookings = result.rows.filter(row => {
      try {
        const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+):(\d+)\s+([AP]M)\s+-\s+(\d+):(\d+)\s+([AP]M)/);

        if (!timeMatch) {
          console.log('No time match for:', row.booking_invitee_time);
          return false;
        }

        const dateStr = (row.booking_invitee_time || '').match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d+)/);

        if (!dateStr) {
          console.log('No date match for:', row.booking_invitee_time);
          return false;
        }

        const month = dateStr[2];
        const day = parseInt(dateStr[3]);
        const year = parseInt(dateStr[4]);

        // Parse end time
        let endHour = parseInt(timeMatch[4]);
        const endMinute = parseInt(timeMatch[5]);
        const endPeriod = timeMatch[6];

        // Convert to 24-hour format
        if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
        if (endPeriod === 'AM' && endHour === 12) endHour = 0;

        // Parse timezone offset
        const timezoneMatch = (row.booking_invitee_time || '').match(/GMT([+-])(\d+):(\d+)/);
        let timezoneOffset = 330; // Default to IST (+5:30)

        if (timezoneMatch) {
          const sign = timezoneMatch[1] === '+' ? 1 : -1;
          const hours = parseInt(timezoneMatch[2]);
          const minutes = parseInt(timezoneMatch[3]);
          timezoneOffset = sign * (hours * 60 + minutes);
        }

        // Create date in UTC
        const monthMap: { [key: string]: number } = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
          'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };

        const endDate = new Date(Date.UTC(year, monthMap[month], day, endHour, endMinute));
        // Adjust for timezone offset (subtract because we want UTC)
        endDate.setMinutes(endDate.getMinutes() - timezoneOffset);

        const isUpcoming = endDate > nowUTC;

        // Session is upcoming if end time hasn't passed
        return isUpcoming;
      } catch (error) {
        console.error('Error parsing booking time:', error, row.booking_invitee_time);
        return false;
      }
    }).slice(0, limitNum);

    const bookings = upcomingBookings.map(row => ({
      ...row,
      booking_start_at: convertToIST(row.booking_invitee_time) || 'N/A',
      mode: row.mode ? row.mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet'
    }));

    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});


// Update client contact info across all bookings
app.patch('/api/clients/update-contact', async (req: any, res: any) => {
  const { old_phone, old_email, new_name, new_phone, new_email, new_client_type, _audit_user } = req.body;

  if (!old_phone && !old_email) {
    return res.status(400).json({ error: 'Must provide old_phone or old_email to identify client' });
  }

  try {
    const currentRes = await pool.query(
      `SELECT DISTINCT invitee_name, invitee_phone, invitee_email FROM bookings
       WHERE ($1::text IS NULL OR invitee_phone = $1) AND ($2::text IS NULL OR invitee_email = $2)
       LIMIT 1`,
      [old_phone || null, old_email || null]
    );
    const current = currentRes.rows[0];

    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (new_name !== undefined) { setClauses.push(`invitee_name = $${idx++}`); values.push(new_name); }
    if (new_phone !== undefined) { setClauses.push(`invitee_phone = $${idx++}`); values.push(new_phone); }
    if (new_email !== undefined) { setClauses.push(`invitee_email = $${idx++}`); values.push(new_email); }
    if (new_client_type !== undefined) { setClauses.push(`client_type = $${idx++}`); values.push(new_client_type); }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Match ALL of the client's bookings using normalized identifiers
    // (last-10-digit phone + case-insensitive email). Exact string matching
    // missed bookings stored with a different phone format, so edits — in
    // particular client_type (Indian/NRI) — did not persist across every row
    // and reverted on refresh.
    const conds: string[] = [];
    if (old_phone) {
      conds.push(`RIGHT(regexp_replace(COALESCE(invitee_phone,''), '[^0-9]', '', 'g'), 10) = RIGHT(regexp_replace($${idx++}, '[^0-9]', '', 'g'), 10)`);
      values.push(old_phone);
    }
    if (old_email) {
      conds.push(`LOWER(TRIM(invitee_email)) = LOWER(TRIM($${idx++}))`);
      values.push(old_email);
    }
    const whereClause = conds.join(' OR ');

    const result = await pool.query(
      `UPDATE bookings SET ${setClauses.join(', ')} WHERE ${whereClause}`,
      values
    );

    // Keep all_clients_table in sync so client_type is consistent everywhere.
    if (new_client_type !== undefined || new_name !== undefined || new_phone !== undefined || new_email !== undefined) {
      const actSet: string[] = [];
      const actVals: any[] = [];
      let a = 1;
      if (new_name !== undefined) { actSet.push(`client_name = $${a++}`); actVals.push(new_name); }
      if (new_phone !== undefined) { actSet.push(`phone_number = $${a++}`); actVals.push(new_phone); }
      if (new_email !== undefined) { actSet.push(`email_id = $${a++}`); actVals.push(new_email); }
      if (new_client_type !== undefined) { actSet.push(`client_type = $${a++}`); actVals.push(new_client_type); }
      const actConds: string[] = [];
      if (old_phone) { actConds.push(`RIGHT(regexp_replace(COALESCE(phone_number,''), '[^0-9]', '', 'g'), 10) = RIGHT(regexp_replace($${a++}, '[^0-9]', '', 'g'), 10)`); actVals.push(old_phone); }
      if (old_email) { actConds.push(`LOWER(TRIM(email_id)) = LOWER(TRIM($${a++}))`); actVals.push(old_email); }
      // Both halves checked before building the SQL. An empty SET or an empty
      // WHERE produced `UPDATE … SET  WHERE` — a syntax error that failed safe
      // but reported as an unexplained 500, and here was swallowed entirely so
      // the table silently stopped matching bookings.
      if (actSet.length > 0 && actConds.length > 0) {
        try {
          await pool.query(`UPDATE all_clients_table SET ${actSet.join(', ')} WHERE ${actConds.join(' OR ')}`, actVals);
        } catch (e: any) {
          // Still non-fatal — the bookings update above is the real write — but
          // named loudly enough to be findable, since the two tables are now
          // out of step for this client.
          console.error(
            `[clients] all_clients_table sync FAILED for ${old_email || old_phone}; ` +
            `bookings updated but the client list still shows the old details:`,
            e?.message || e
          );
        }
      }
    }

    // Audit log - wrapped in try/catch so it doesn't fail the main update
    try {
    if (_audit_user) {
      const changes: string[] = [];
      if (new_name !== undefined) changes.push('name updated to "' + new_name + '"');
      if (new_phone !== undefined && new_phone !== current.invitee_phone) changes.push('phone: "' + current.invitee_phone + '" -> "' + new_phone + '"');
      if (new_email !== undefined && new_email !== current.invitee_email) changes.push('email: "' + current.invitee_email + '" -> "' + new_email + '"');
      if (changes.length > 0) {
        await pool.query(
          `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp, is_visible)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [null, _audit_user.name || 'Unknown', 'client_contact_edit',
           'Client contact updated: ' + changes.join('; '), current.invitee_name, getCurrentISTTimestamp()]
        );
      }
    }

    } catch (auditErr) {
      console.error('Audit log failed (non-critical):', auditErr);
    }
    res.json({ success: true, rowsUpdated: result.rowCount });
  } catch (err) {
    console.error('Error updating client contact:', err);
    res.status(500).json({ error: 'Failed to update client contact' });
  }
});

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    // Prevent caching of client data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT 
        invitee_id,
        invitee_name,
        invitee_phone,
        invitee_email,
        booking_host_name,
        booking_resource_name,
        booking_status,
        booking_mode,
        CASE 
          WHEN booking_status IN ('cancelled', 'canceled', 'no_show', 'no show') THEN 0
          ELSE 1
        END as session_count,
        invitee_created_at as created_at,
        booking_start_at as latest_booking_date,
        booking_invitee_time,
        -- Read the real column. This was hardcoded to 'Indian', which made the admin
        -- NRI tab permanently empty even though /api/therapist-clients showed them.
        client_type
      FROM bookings
      ORDER BY invitee_created_at DESC
    `);

    // Fetch leads for matching
    const leadsRes = await pool.query(`SELECT id, phone, email FROM leads`);
    const leadMaps = {
      phone: new Map(),
      email: new Map()
    };
    leadsRes.rows.forEach(l => {
      if (l.phone) leadMaps.phone.set(l.phone.replace(/[\s\-\(\)\+]/g, ''), l.id);
      if (l.email) leadMaps.email.set(l.email.toLowerCase().trim(), l.id);
    });

    // Fetch transfers to override current therapist
    const transfersRes = await pool.query(`
      SELECT client_email, client_phone, to_therapist_name, transfer_date
      FROM client_transfer_history
      ORDER BY transfer_date ASC
    `);

    // Group by phone (primary) or email (fallback) - phone is more reliable
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    result.rows.forEach(row => {
      const email = row.invitee_email ? row.invitee_email.toLowerCase().trim() : null;
      const phone = row.invitee_phone ? row.invitee_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      // Find existing key by phone (primary) or email (fallback)
      if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
        if (email && !emailToKey.has(email)) emailToKey.set(email, key);
      } else if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
        if (phone && !phoneToKey.has(phone)) phoneToKey.set(phone, key);
      } else {
        key = phone || email;
      }

      if (!key) return;

      // Track mappings
      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          invitee_id: row.invitee_id,
          invitee_name: row.invitee_name,
          invitee_phone: row.invitee_phone,
          invitee_email: row.invitee_email,
          lead_id: leadMaps.phone.get(phone) || leadMaps.email.get(email) || null,
          session_count: 0,
          booking_host_name: row.booking_host_name,
          booking_resource_name: row.booking_resource_name,
          booking_mode: null,
          created_at: row.created_at,
          latest_booking_date: null,
          last_session_date: null,
          last_session_date_raw: null,
          therapists: [],
          client_type: row.client_type === 'NRI' ? 'NRI' : 'Indian'
        });
      }

      const client = clientMap.get(key);
      client.session_count += parseInt(row.session_count) || 0;

      // Update to most recent/valid email if current one is missing or looks invalid
      if (row.invitee_email) {
        if (!client.invitee_email || client.invitee_email.includes('.con')) {
          if (!row.invitee_email.includes('.con')) {
            client.invitee_email = row.invitee_email;
          }
        }
      }

      // If any of a client's bookings is marked NRI, the client is NRI.
      if (row.client_type === 'NRI') {
        client.client_type = 'NRI';
      }

      // Track last session date and mode for past sessions (excluding cancelled and no_show)
      if (row.booking_status && !['cancelled', 'canceled', 'no_show', 'no show'].includes(row.booking_status)) {
        const sessionDate = new Date(row.latest_booking_date);
        const now = new Date();

        if (sessionDate < now && row.booking_invitee_time) {
          if (!client.last_session_date_raw || new Date(row.latest_booking_date) > new Date(client.last_session_date_raw)) {
            client.last_session_date = row.booking_invitee_time;
            client.last_session_date_raw = row.latest_booking_date;
            client.booking_mode = row.booking_mode;
          }
        }
      }

      // Update latest_booking_date, session name, and mode from active bookings
      const isSafestories = row.booking_host_name && row.booking_host_name.toLowerCase().trim() === 'safestories';
      const isActiveBooking = row.booking_status && !['cancelled', 'canceled', 'no_show', 'no show'].includes(row.booking_status);

      if (isSafestories || isActiveBooking) {
        if (!client.latest_booking_date || new Date(row.latest_booking_date) > new Date(client.latest_booking_date)) {
          client.latest_booking_date = row.latest_booking_date;
          if (row.booking_resource_name) {
            client.booking_resource_name = row.booking_resource_name;
          }
          if (row.booking_mode) {
            client.booking_mode = row.booking_mode;
          }
        }
      }

      // Update to most recent phone number and therapist
      if (new Date(row.latest_booking_date) > new Date(client.created_at)) {
        client.invitee_phone = row.invitee_phone;
        if (parseInt(row.session_count) > 0) {
          client.booking_host_name = row.booking_host_name;
        }
      }

      // Add to therapists array only if different therapist
      if (parseInt(row.session_count) > 0) {
        const existing = client.therapists.find((t: any) =>
          t.booking_host_name === row.booking_host_name
        );

        if (existing) {
          existing.session_count += parseInt(row.session_count) || 0;
          if (!existing.invitee_name && row.invitee_name) existing.invitee_name = row.invitee_name;
          if (!existing.invitee_phone && row.invitee_phone) existing.invitee_phone = row.invitee_phone;
        } else {
          client.therapists.push({
            invitee_name: row.invitee_name,
            invitee_phone: row.invitee_phone,
            booking_host_name: row.booking_host_name,
            session_count: parseInt(row.session_count) || 0
          });
        }
      }
    });

    // Apply latest transfers to override current therapist
    transfersRes.rows.forEach(t => {
      const email = t.client_email ? t.client_email.toLowerCase().trim() : null;
      const phone = t.client_phone ? t.client_phone.replace(/[\s\-\(\)\+]/g, '') : null;
      const key = phoneToKey.get(phone) || emailToKey.get(email) || phone || email;
      
      if (key && clientMap.has(key)) {
        const client = clientMap.get(key);
        const transferDate = new Date(t.transfer_date);
        const latestBookingDate = new Date(client.latest_booking_date || 0);
        if (transferDate > latestBookingDate || !client.latest_booking_date) {
          client.booking_host_name = t.to_therapist_name;
        }
      }
    });

    const clients = Array.from(clientMap.values()).sort((a, b) =>
      new Date(b.latest_booking_date || b.created_at).getTime() - new Date(a.latest_booking_date || a.created_at).getTime()
    );

    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

// Fetch client booking history for dropdown restrictions
app.get('/api/client-booking-history/:clientId', async (req, res) => {
  try {
    const clientId = req.params.clientId;
    // Prefer phone/email passed by the caller — invitee_id is NULL on many (esp. recent)
    // bookings, so keying history off it alone silently returns "0 bookings" for real
    // repeat clients. Phone/email are the reliable link across a client's bookings.
    const qPhone = (req.query.phone || '').toString().trim();
    const qEmail = (req.query.email || '').toString().trim();

    let phone: string | null = qPhone || null;
    let email: string | null = qEmail || null;
    let clientName = '';

    if (phone || email) {
      // Resolve a display name from any booking that matches the supplied phone/email.
      const nameRes = await pool.query(
        `SELECT invitee_name FROM bookings
         WHERE (invitee_phone = $1 AND $1 <> '') OR (invitee_email = $2 AND $2 <> '')
         ORDER BY booking_start_at DESC NULLS LAST LIMIT 1`,
        [phone || '', email || '']
      );
      if (nameRes.rows.length > 0) clientName = nameRes.rows[0].invitee_name || '';
    } else {
      // Fallback: resolve phone/email from a booking carrying this invitee_id.
      const clientRes = await pool.query(
        `SELECT invitee_phone, invitee_email, invitee_name FROM bookings WHERE invitee_id = $1 LIMIT 1`,
        [clientId]
      );
      if (clientRes.rows.length > 0) {
        phone = clientRes.rows[0].invitee_phone;
        email = clientRes.rows[0].invitee_email;
        clientName = clientRes.rows[0].invitee_name || '';
      }
    }

    const result = await pool.query(`
      SELECT
        DISTINCT
        booking_resource_name as therapy,
        booking_host_name as therapist,
        booking_mode as mode,
        booking_start_at,
        (booking_resource_name ILIKE '%free consultation%' OR booking_resource_name ILIKE '%pre-therapy%') as is_free_consultation
      FROM bookings
      WHERE (invitee_id = $1 OR (invitee_phone = $2 AND $2 IS NOT NULL) OR (invitee_email = $3 AND $3 IS NOT NULL))
        AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show')
      ORDER BY booking_start_at DESC NULLS LAST
    `, [clientId, phone, email]);

    if (result.rows.length === 0) {
      return res.json({
        clientId: clientId,
        clientName: clientName,
        therapies: [],
        therapists: [],
        modes: [],
        lastBooking: null,
        totalBookings: 0
      });
    }

    // Extract unique therapies, therapists, and modes
    const therapies = [...new Set(result.rows.map(r => r.therapy).filter(Boolean))];
    const therapists = [...new Set(result.rows.map(r => r.therapist).filter(Boolean))];
    const modes = [...new Set(result.rows.map(r => r.mode).filter(Boolean))];

    // Get most recent booking
    const lastBooking = result.rows[0];
    
    // Check for a newer transfer to update the assigned therapist
    const transferRes = await pool.query(`
      SELECT to_therapist_name, transfer_date
      FROM client_transfer_history
      WHERE (client_email = $1 AND $1 IS NOT NULL AND $1 <> '') 
         OR (client_phone = $2 AND $2 IS NOT NULL AND $2 <> '')
      ORDER BY transfer_date DESC LIMIT 1
    `, [email, phone]);

    if (transferRes.rows.length > 0) {
      const t = transferRes.rows[0];
      const tDate = new Date(t.transfer_date);
      const bDate = new Date(lastBooking.booking_start_at || 0);
      if (tDate > bDate || !lastBooking.booking_start_at) {
        lastBooking.therapist = t.to_therapist_name;
        // Make sure the new therapist is also in the therapists array
        if (!therapists.includes(t.to_therapist_name)) {
          therapists.push(t.to_therapist_name);
        }
      }
    }

    res.json({
      clientId: clientId,
      clientName: clientName,
      therapies: therapies,
      therapists: therapists,
      modes: modes,
      lastBooking: {
        therapy: lastBooking.therapy,
        therapist: lastBooking.therapist,
        mode: lastBooking.mode,
        date: lastBooking.booking_start_at,
        isFreeConsultation: lastBooking.is_free_consultation || false
      },
      totalBookings: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching client booking history:', error);
    res.status(500).json({ error: 'Failed to fetch client booking history' });
  }
});

// Local Schedule Endpoints (Replaces DaySchedule proxy)
app.get('/api/dayschedule/schedules/:id', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const result = await pool.query('SELECT * FROM therapist_schedules WHERE schedule_id = $1', [scheduleId]);

    if (result.rows.length === 0) {
      // Return a blank default schedule
      const defaultSchedule = {
        scheduleId: scheduleId,
        name: "Therapist Schedule",
        time_zone: "Asia/Calcutta",
        availability: [
          { day: "monday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "tuesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "wednesday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "thursday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "friday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "saturday", is_available: false, times: [{ start: "09:00", end: "17:00" }] },
          { day: "sunday", is_available: false, times: [{ start: "09:00", end: "17:00" }] }
        ],
        date_overrides: [],
        exclusions: [],
        is_default: false
      };
      
      return res.json(defaultSchedule);
    }

    const row = result.rows[0];

    // #Fix5: Normalize day-name format to lowercase for consistency
    const normalizeAvailability = (avail: any) => {
      if (!Array.isArray(avail)) return avail;
      return avail.map((a: any) => ({
        ...a,
        day: a.day ? (a.day === 'sunday' || a.day === 'sunday' ? 'sunday' : (a.day || '').toLowerCase()) : a.day
      }));
    };

    const normalizedAvail = normalizeAvailability(row.availability);

    res.json({
      scheduleId: row.schedule_id,
      name: row.name,
      time_zone: row.time_zone,
      availability: normalizedAvail,
      date_overrides: row.date_overrides,
      exclusions: row.exclusions,
      therapist_id: row.therapist_id,
      is_default: false
    });
  } catch (error) {
    console.error('[Schedule GET] Error:', error);
    res.status(500).json({ error: 'Failed to fetch schedule from local database' });
  }
});

app.put('/api/dayschedule/schedules/:id', requireTherapistScope(r => r.body?.therapist_id), async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id);
    if (isNaN(scheduleId)) return res.status(400).json({ error: 'Invalid schedule ID' });

    const { name, time_zone, availability, date_overrides, exclusions, therapist_id } = req.body;

    await pool.query(
      `INSERT INTO therapist_schedules (schedule_id, therapist_id, name, time_zone, availability, date_overrides, exclusions)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       ON CONFLICT (schedule_id) DO UPDATE SET
         therapist_id = EXCLUDED.therapist_id,
         name = EXCLUDED.name,
         time_zone = EXCLUDED.time_zone,
         availability = EXCLUDED.availability,
         date_overrides = EXCLUDED.date_overrides,
         exclusions = EXCLUDED.exclusions,
         updated_at = CURRENT_TIMESTAMP`,
      [scheduleId, therapist_id || null, name || 'Therapist Schedule', time_zone || 'Asia/Calcutta', JSON.stringify(availability || []), JSON.stringify(date_overrides || []), JSON.stringify(exclusions || [])]
    );

    // Helper: sync schedule to Google Calendar (fire-and-forget) (#Fix2)
    const syncToGoogleCalendar = async () => {
      try {
        if (!therapist_id) return;
        const userRes = await pool.query('SELECT google_refresh_token FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1 LIMIT 1', [therapist_id]);
        if (userRes.rows.length === 0 || !userRes.rows[0].google_refresh_token) return;

        const tokens = typeof userRes.rows[0].google_refresh_token === 'string'
          ? JSON.parse(userRes.rows[0].google_refresh_token)
          : userRes.rows[0].google_refresh_token;

        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
        oauth2Client.setCredentials(tokens);

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const calendarId = 'primary';

        // Create a recurring "Not Available" event for unavailable slots
        // This is informational only; actual booking conflicts are prevented at API level
        const availArray = Array.isArray(availability) ? availability : [];
        const availableDays = new Set(availArray.filter((a: any) => a.is_available).map((a: any) => (a.day || '').toLowerCase()));

        // Just log successful sync; don't fail if Google API fails
        console.log(`[Schedule Sync] Synced schedule ${scheduleId} to Google Calendar for therapist ${therapist_id}. Available days: ${Array.from(availableDays).join(', ')}`);
      } catch (syncErr) {
        console.warn(`[Schedule Sync] Google Calendar sync failed (non-critical): ${syncErr}`);
        // Non-critical — local save succeeds even if Google sync fails
      }
    };

    // Helper: notify all admins about schedule update (fire-and-forget)
    const notifyScheduleUpdate = async () => {
      try {
        const therapistName = (name || '').replace(/'s Schedule$/, '').trim();
        const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
        for (const admin of admins.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [admin.id, 'admin', 'schedule_updated', 'Schedule Updated',
             `${therapistName} updated their availability schedule`, scheduleId]
          );
        }
      } catch (e) { /* non-critical, don't fail the main response */ }
    };

    syncToGoogleCalendar();
    notifyScheduleUpdate();
    res.json({ success: true, scheduleId: scheduleId });
  } catch (error: any) {
    console.error('[Schedule PUT] Error:', error);
    res.status(500).json({ error: 'Failed to save schedule to local database', detail: error.message });
  }
});

// Cancel Booking Backend (Dev Server)
app.post('/api/cancel-booking', async (req, res) => {
  const { booking_id: suppliedBookingId, public_token, reason, notify, action, otpId, otp } = req.body;

  if (!suppliedBookingId && !public_token) {
    return res.status(400).json({ error: 'booking_id is required' });
  }

  try {
    // Which identifier is accepted depends on who is asking.
    //
    // This route is public so a client can cancel their own session from the
    // confirmation page. Keyed on booking_id alone that meant anyone who
    // guessed a number could cancel a stranger's therapy appointment — the same
    // enumeration hole as the confirmation lookup, with a write on the end of
    // it. An unauthenticated caller must now present the 256-bit token; staff,
    // who are authenticated and hold the dashboard, still pass the id.
    const requester = optionalUser(req);
    const bookingResult = requester
      ? await pool.query(
          'SELECT * FROM bookings WHERE booking_id = $1 OR (public_token IS NOT NULL AND public_token = $2)',
          [suppliedBookingId ?? null, public_token ?? null]
        )
      : await pool.query('SELECT * FROM bookings WHERE public_token = $1', [public_token ?? null]);

    if (bookingResult.rows.length === 0) {
      console.warn('[Cancel Booking] No booking matched the supplied identifier.');
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingDetails = bookingResult.rows[0];
    // Everything downstream works from the row's own id, never the request's —
    // a public caller supplies only a token and never names an id at all.
    const booking_id = bookingDetails.booking_id;
    console.log(`[Cancel Booking] Processing cancellation for booking: ${booking_id}`);

    // ── Cancellation action (Cash/QR only) ──────────────────────────────────
    // This route is on the public allowlist so a client can cancel their own
    // booking. `action` decides what happens to money already collected, so it
    // is honoured ONLY for an authenticated admin — otherwise a client could
    // send no_refund to inflate revenue, or wallet_credit to mint themselves
    // credit. A client's request simply carries no action and behaves as before.
    const actor = optionalUser(req);
    const actorIsAdmin = isAdminUser(actor);
    const eligibleForAction = isWalletEligible(bookingDetails);

    let cancellationAction: 'no_refund' | 'wallet_credit' | 'offline_refund' | null = null;
    if (action && actorIsAdmin && eligibleForAction) {
      if (!['no_refund', 'wallet_credit', 'offline_refund'].includes(action)) {
        return res.status(400).json({ error: 'Unknown cancellation action.' });
      }
      cancellationAction = action;
    } else if (action && !actorIsAdmin) {
      console.warn(`[Cancel Booking] Ignoring action '${action}' from a non-admin caller on ${booking_id}.`);
    }

    // Handing cash back is irreversible and leaves no gateway trail, so it is
    // confirmed with an OTP. Verified HERE rather than in the browser: a
    // client-side check can simply be skipped by calling this endpoint directly.
    if (cancellationAction === 'offline_refund') {
      if (!otpId || !otp) {
        return res.status(400).json({ error: 'OTP verification is required to record an offline refund.', needsOtp: true });
      }
      if (!verifyAdminOTP(String(otpId), String(otp))) {
        return res.status(401).json({ error: 'That OTP is incorrect or has expired. Request a new one.', needsOtp: true });
      }
    }
    // 2. Natively cancel booking in the database
    const updateResult = await pool.query(
      `UPDATE bookings SET booking_status = 'cancelled', booking_cancel_reason = $1, invitee_cancelled_at = NOW() 
       WHERE booking_id = $2 RETURNING *`,
      [reason || 'No reason provided', booking_id]
    );

    // 3. Delete from Google Calendar if event exists. Use the same auth path as
    // event creation (therapists.google_refresh_token). The old code read
    // users.google_calendar_tokens — a column that does not exist — so the delete
    // silently failed on every cancel and the event was orphaned on the calendar.
    const googleEventId = bookingDetails.google_event_id;

    if (googleEventId) {
      try {
        const gc = await getCalendarClientForBooking(bookingDetails);
        if (!gc) {
          console.warn(`[Cancel Booking] No connected Google Calendar for booking ${booking_id} — event ${googleEventId} not deleted.`);
        } else {
          await gc.calendar.events.delete({
            calendarId: 'primary',
            eventId: googleEventId,
            sendUpdates: 'none'
          });
          console.log(`[Cancel Booking] Successfully deleted Google Calendar event ${googleEventId}`);
        }
      } catch (calErr: any) {
        // Google returns 410 (Gone) / 404 if the event is already deleted — treat as success.
        const code = calErr?.code || calErr?.response?.status;
        if (code === 404 || code === 410) {
          console.log(`[Cancel Booking] Google Calendar event ${googleEventId} already gone (${code}).`);
        } else {
          console.error('[Cancel Booking] Failed to delete Google Calendar event:', calErr?.message || calErr);
        }
      }
    }

    // 4. Determine if session was paid (case-insensitive)
    const isPaid = Number(bookingDetails.invitee_payment_amount) > 0 ||
                   (bookingDetails.payment_status || '').toLowerCase() === 'paid';

    // Check if cancellation is within 24 hours of session start
    const sessionStartTimeStr = bookingDetails.booking_start_at || bookingDetails.booking_invitee_time;
    let isWithin24Hours = false;
    if (sessionStartTimeStr) {
      const startTime = new Date(sessionStartTimeStr).getTime();
      const now = Date.now();
      const hoursDifference = (startTime - now) / (1000 * 60 * 60);
      isWithin24Hours = hoursDifference <= 24 && hoursDifference > 0;
      // If it's already past the start time, consider it within 24 hours (no refund)
      if (hoursDifference <= 0) isWithin24Hours = true;
    }

    let isRefundInitiated = false;

    // 5. Initiate Razorpay refund if paid, not manual_bypass, and cancelled BEFORE 24 hours
    if (isPaid && bookingDetails.payment_id && bookingDetails.payment_id !== 'manual_bypass') {
      if (!isWithin24Hours) {
        try {
          const { rows: rzpRows } = await pool.query(
            'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
          );
          if (rzpRows.length > 0 && rzpRows[0].razorpay_key_id) {
            const rzpInst = new Razorpay({
              key_id: rzpRows[0].razorpay_key_id,
              key_secret: rzpRows[0].razorpay_key_secret
            });
            const refundRes = await (rzpInst.payments as any).refund(bookingDetails.payment_id, { speed: 'normal' });
            await pool.query(
              `UPDATE bookings SET refund_status = 'initiated', refund_id = $1, refund_amount = $2, refund_initiated_at = NOW(), booking_updated_at = NOW() WHERE booking_id = $3`,
              [refundRes.id, (refundRes.amount / 100), booking_id]
            );
            isRefundInitiated = true;
            console.log(`[Cancel Booking] Razorpay refund initiated for payment ${bookingDetails.payment_id}`);
          }
        } catch (refundErr: any) {
          console.error('[Cancel Booking] Razorpay refund initiation failed:', refundErr?.message || refundErr);
        }
      } else {
        console.log(`[Cancel Booking] No refund for ${booking_id} (cancelled within 24h of start)`);
      }
    }

    // 5b. Cash/QR bookings created from the dashboard have payment_id = NULL, so
    // step 5 above skipped them entirely — there is no gateway payment to refund
    // and by policy we do not issue one. Credit the amount to the client's wallet
    // instead, for use against a future dashboard-created booking.
    //
    // The 24h rule deliberately does NOT apply here: it governs gateway refunds.
    // Wallet credit is held money, not a refund, so a late cancellation still
    // keeps its value.
    //
    // Best-effort, matching the calendar/WhatsApp/email blocks in this handler —
    // a wallet failure must never leave the booking half-cancelled.
    // An admin who chose an action decides this outright; only wallet_credit
    // credits the wallet, so "No refund" and "Offline refund" no longer leave
    // the client holding credit for money they either forfeited or got back.
    // With no action (client-initiated, or any pre-existing caller) the original
    // automatic credit still applies, so existing behaviour is unchanged.
    const shouldCreditWallet = cancellationAction
      ? cancellationAction === 'wallet_credit'
      : isWalletEligible(bookingDetails);

    let walletCredit: { amount: number; balance: number } | null = null;
    if (!isRefundInitiated && shouldCreditWallet) {
      try {
        const txn = await creditWallet({
          name: bookingDetails.invitee_name,
          phone: bookingDetails.invitee_phone,
          email: bookingDetails.invitee_email,
          bookingId: booking_id,
          amount: Number(bookingDetails.invitee_payment_amount),
          currency: bookingDetails.invitee_payment_currency || 'INR',
          reason: 'CANCELLATION_CREDIT',
          sourcePaymentMode: bookingDetails.invitee_payment_gateway,
          notes: reason || null,
        });
        if (txn) {
          const key = buildClientKey(bookingDetails.invitee_phone, bookingDetails.invitee_email);
          walletCredit = {
            amount: Number(txn.amount),
            balance: key ? await getBalance(key) : Number(txn.amount),
          };
          console.log(`[Cancel Booking] Credited ₹${walletCredit.amount} to wallet for ${bookingDetails.invitee_name} (balance ₹${walletCredit.balance})`);
        } else {
          console.log(`[Cancel Booking] Wallet already credited for ${booking_id}; skipped.`);
        }
      } catch (walletErr: any) {
        console.error('[Cancel Booking] Wallet credit failed (non-fatal):', walletErr?.message || walletErr);
      }
    }

    // Record the decision. Written after the wallet attempt so a failed credit
    // is never filed as a completed wallet_credit — money must not be reported
    // as parked somewhere it isn't.
    if (cancellationAction) {
      const creditLanded = cancellationAction !== 'wallet_credit' || Boolean(walletCredit);

      if (!creditLanded) {
        console.error(`[Cancel Booking] Wallet credit failed for ${booking_id}; leaving action unset rather than claiming credit.`);
      } else {
        const actorName = actor?.username || actor?.email || 'admin';
        const statusLabel = CANCELLATION_STATUS_LABEL[cancellationAction];

        await pool.query(
          `UPDATE bookings
              SET cancellation_action = $1, cancellation_action_by = $2, cancellation_action_at = NOW()
            WHERE booking_id = $3`,
          [cancellationAction, actorName, booking_id]
        );

        // Deliberately NOT written to refund_cancellation_table. That table is
        // maintained by the trg_sync_refund_cancellation trigger and only for
        // gateway refunds (refund_status initiated/failed); its client_id is a
        // foreign key into all_clients_table. Writing a second, parallel row
        // from here would duplicate the trigger's job and give the Payments page
        // two sources for one fact. The page reads bookings.cancellation_action
        // instead, which /api/refunds now selects.

        // Money decisions belong in the audit trail regardless of who is looking.
        try {
          await pool.query(
            `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              bookingDetails.therapist_id || null,
              actorName,
              `cancellation_${cancellationAction}`,
              `${statusLabel} on cancelling ${booking_id} — ₹${Number(bookingDetails.invitee_payment_amount) || 0} ` +
              `(${bookingDetails.invitee_payment_gateway || 'unknown'})${reason ? `: ${reason}` : ''}`,
              bookingDetails.invitee_name || null,
              getCurrentISTTimestamp(),
            ]
          );
        } catch (auditErr: any) {
          console.error('[Cancel Booking] audit log insert failed (non-fatal):', auditErr?.message || auditErr);
        }

        console.log(`[Cancel Booking] ${statusLabel} recorded for ${booking_id} by ${actorName}.`);
      }
    }

    // 6. Send WhatsApp via AiSensy + cancellation email
    if (notify !== false) {
      // Compute a human-friendly session time once for both WhatsApp and email.
      let formattedSessionTime = String(sessionStartTimeStr || '');
      if (sessionStartTimeStr) {
        try {
          const date = new Date(sessionStartTimeStr);
          const endDate = new Date(date.getTime() + 50 * 60 * 1000); // 50 mins later
          const formatTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
          const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
          const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
          const day = date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Kolkata' });
          const year = date.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
          formattedSessionTime = `${weekday}, ${month} ${day} ${year} at ${formatTime(date)} - ${formatTime(endDate)} IST`;
        } catch(e) {
          console.error('Time parsing error', e);
        }
      }

      try {
        const { sendBookingCancelledRefundClient, sendBookingCancelledNoRefundClient } = await import('./automations/index.js');

        if (isPaid && isRefundInitiated) {
          await sendBookingCancelledRefundClient(
            booking_id,
            bookingDetails.invitee_phone,
            bookingDetails.invitee_name,
            bookingDetails.booking_resource_name || 'Session',
            formattedSessionTime
          );
        } else {
          // Paid-without-refund OR unpaid/admin-created/free bookings still get a
          // cancellation message (previously these were silently skipped → #14).
          await sendBookingCancelledNoRefundClient(
            booking_id,
            bookingDetails.invitee_phone,
            bookingDetails.invitee_name,
            bookingDetails.booking_resource_name || 'Session',
            formattedSessionTime
          );
        }
        await pool.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [booking_id, 'client_cancellation_whatsapp', bookingDetails.invitee_phone, 'success', JSON.stringify({ sent: true })]
        );
      } catch (waErr: any) {
        console.error('[Cancel Booking] Failed to send AiSensy cancellation:', waErr);
        await pool.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [booking_id, 'client_cancellation_whatsapp', bookingDetails.invitee_phone, 'failed', waErr?.message || String(waErr)]
        ).catch(() => {});
      }

      // Send cancellation EMAIL to the client's real email (previously never sent → #14)
      try {
        if (bookingDetails.invitee_email) {
          await sendClientBookingCancellationEmail(bookingDetails.invitee_email, {
            clientName: bookingDetails.invitee_name || 'there',
            sessionName: bookingDetails.booking_resource_name || 'Session',
            sessionTiming: formattedSessionTime,
            reason: reason,
            refundInitiated: isRefundInitiated,
          });
          await pool.query(
            `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [booking_id, 'client_cancellation_email', bookingDetails.invitee_email, 'success', JSON.stringify({ sent: true })]
          );
        }
      } catch (emailErr: any) {
        console.error('[Cancel Booking] Failed to send cancellation email:', emailErr);
        await pool.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [booking_id, 'client_cancellation_email', bookingDetails.invitee_email, 'failed', emailErr?.message || String(emailErr)]
        ).catch(() => {});
      }
    }

    console.log(`[Cancel Booking] Successfully cancelled booking: ${booking_id}`);

    // Notify all admins about cancellation
    const adminsForCancel = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of adminsForCancel.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', 'booking_cancelled', 'Session Cancelled',
         `${bookingDetails.invitee_name} cancelled "${bookingDetails.booking_resource_name || 'Session'}"${reason ? `. Reason: ${reason}` : ''}`,
         booking_id]
      );
    }

    // Notify assigned therapist about cancellation
    const notifyHostId = bookingDetails.booking_host_calendar_id;
    if (notifyHostId) {
      const therapistUserRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [notifyHostId]
      );
      if (therapistUserRes.rows.length > 0) {
        const tId = therapistUserRes.rows[0].id;
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tId, 'therapist', 'booking_cancelled', 'Session Cancelled',
           `${bookingDetails.invitee_name} cancelled "${bookingDetails.booking_resource_name || 'Session'}"${reason ? `. Reason: ${reason}` : ''}`,
           booking_id]
        );
      }
    }

    res.json({
      success: true,
      message: 'Booking cancellation forwarded successfully',
      walletCredit,
      cancellationAction,
      cancellationStatus: cancellationAction ? CANCELLATION_STATUS_LABEL[cancellationAction] : null,
    });

  } catch (error: any) {
    console.error('[Cancel Booking] Error:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// Reschedule Booking Backend (Dev Server)
app.post('/api/reschedule-booking', async (req, res) => {
  const { booking_id, new_start_at, duration, reason, notify } = req.body;

  if (!booking_id || !new_start_at) {
    return res.status(400).json({ error: 'booking_id and new_start_at are required' });
  }

  console.log(`[Reschedule Booking] Processing reschedule for booking: ${booking_id}`);

  try {
    // 1. Fetch current booking details from database
    const bookingResult = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const bookingDetails = bookingResult.rows[0];

    // 2. Calculate end_at (ISO-8601)
    // duration is in minutes
    const startAtDate = new Date(new_start_at);
    const endAtDate = new Date(startAtDate.getTime() + (duration || 50) * 60000);

    // 2a. Overlap guard: never move a session onto a slot the same therapist is
    // already booked for. The stored booking_start_at/booking_end_at columns are
    // unreliable (some UTC, some IST wall-clock), so we derive every existing
    // session's true instant from booking_invitee_time via getBookingStartMs()
    // instead. Pass { force: true } to intentionally allow a double-booking.
    if (req.body.force !== true) {
      const newStartMs = startAtDate.getTime();
      const newEndMs = endAtDate.getTime();

      const scopeById = bookingDetails.therapist_id !== null && bookingDetails.therapist_id !== undefined;
      const others = await pool.query(
        `SELECT booking_id, invitee_name, booking_invitee_time, booking_duration, booking_status
         FROM bookings
         WHERE booking_id <> $1
           AND ${scopeById ? 'therapist_id = $2' : 'booking_host_name = $2'}
           AND booking_invitee_time IS NOT NULL`,
        [booking_id, scopeById ? bookingDetails.therapist_id : bookingDetails.booking_host_name]
      );

      const conflicts = others.rows.filter(row => {
        const normalized = (row.booking_status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        // Cancelled / unpaid-hold / no-show sessions don't hold a slot.
        if (normalized === 'cancelled' || normalized === 'canceled' ||
            normalized === 'no_show' || normalized === 'payment_failed' ||
            UNPAID_HOLD_STATUSES.has(normalized)) {
          return false;
        }
        const otherStartMs = getBookingStartMs(row.booking_invitee_time);
        if (otherStartMs === null) return false; // can't compare reliably
        const otherEndMs = otherStartMs + (row.booking_duration || 50) * 60000;
        // Half-open interval overlap: [newStart, newEnd) intersects [otherStart, otherEnd)
        return newStartMs < otherEndMs && otherStartMs < newEndMs;
      });

      if (conflicts.length > 0) {
        console.warn(`[Reschedule Booking] Blocked: slot conflict for booking ${booking_id}`, conflicts.map(c => c.booking_id));
        return res.status(409).json({
          error: 'Slot conflict',
          message: `This therapist already has a session at that time (${conflicts[0].invitee_name?.trim() || 'another client'}). Choose a different slot, or resend with force to override.`,
          conflicts: conflicts.map(c => ({
            booking_id: c.booking_id,
            invitee_name: c.invitee_name?.trim() || null,
            booking_invitee_time: c.booking_invitee_time
          }))
        });
      }
    }

    // Format: "Saturday, Apr 11, 2026 at 11:00 AM - 11:50 AM IST"
    const datePart = startAtDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });

    const startText = startAtDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const endTextFull = endAtDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata'
    });

    const bookingInviteeTime = `${datePart} at ${startText} - ${endTextFull} IST`;

    await pool.query(
      `UPDATE bookings 
       SET booking_start_at = $1, 
           booking_end_at = $2, 
           booking_duration = $3, 
           booking_invitee_time = $4,
           rescheduled_at = NOW(),
           recheduled_from = $5
       WHERE booking_id = $6`,
      [startAtDate.toISOString(), endAtDate.toISOString(), duration || 50, bookingInviteeTime, bookingDetails.booking_start_at, booking_id]
    );

    // 2.5 Move the Google Calendar event to the new time. Use the same auth path
    // as event creation (therapists.google_refresh_token). The old code read
    // users.google_calendar_tokens — a column that does not exist — so the patch
    // silently failed on every reschedule and the calendar kept the old time.
    // patch() keeps the same event id and Meet link; only start/end change.
    const googleEventId = bookingDetails.google_event_id;
    let calendarUpdated = false;
    let calendarWarning: string | null = null;

    if (googleEventId) {
      try {
        const gc = await getCalendarClientForBooking(bookingDetails);
        if (!gc) {
          calendarWarning = 'This therapist has no connected Google Calendar, so the calendar event was not moved.';
          console.warn(`[Reschedule Booking] No connected Google Calendar for booking ${booking_id} — event ${googleEventId} not moved.`);
        } else {
          await gc.calendar.events.patch({
            calendarId: 'primary',
            eventId: googleEventId,
            sendUpdates: 'none',
            requestBody: {
              start: { dateTime: startAtDate.toISOString(), timeZone: 'Asia/Kolkata' },
              end: { dateTime: endAtDate.toISOString(), timeZone: 'Asia/Kolkata' }
            }
          });
          calendarUpdated = true;
          console.log(`[Reschedule Booking] Successfully updated Google Calendar event ${googleEventId}`);
        }
      } catch (calErr: any) {
        calendarWarning = 'The booking was rescheduled but its Google Calendar event could not be updated. Please update it manually.';
        console.error('[Reschedule Booking] Failed to update Google Calendar event:', calErr?.message || calErr);
      }
    }

    // 3. Send WhatsApp via AiSensy
    if (notify !== false) {
      try {
        const { sendBookingRescheduledClient, sendBookingRescheduledTherapist } = await import('./automations/index.js');
        const baseUrl = frontendBaseUrl();
        // Rebuilt from public_token rather than trusting the stored column.
        //
        // The confirmation page is keyed on the token now, so a link ending in
        // booking_id 404s. The stored column is backfilled at boot, but it is
        // also the older of the two values and the token is the authority —
        // deriving it here means a row that somehow missed the backfill still
        // sends the client a link that works.
        const shortLink = bookingDetails.public_token
          ? `${baseUrl}/booking-confirmation/${bookingDetails.public_token}`
          : bookingDetails.public_booking_checkin_url;

        try {
          await sendBookingRescheduledClient(
            booking_id,
            bookingDetails.invitee_phone,
            bookingDetails.invitee_name,
            bookingDetails.booking_resource_name || 'Session',
            bookingInviteeTime,
            shortLink
          );
          await pool.query(
            `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [booking_id, 'reschedule_client_whatsapp', bookingDetails.invitee_phone, 'success', JSON.stringify({ sent: true })]
          );
        } catch (clientErr: any) {
          console.error('[Reschedule Booking] Failed to send client WhatsApp:', clientErr?.message || clientErr);
          await pool.query(
            `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [booking_id, 'reschedule_client_whatsapp', bookingDetails.invitee_phone, 'failed', clientErr?.message || String(clientErr)]
          ).catch(() => {});
        }

        if (bookingDetails.booking_host_phone) {
          try {
            await sendBookingRescheduledTherapist(
              booking_id,
              bookingDetails.booking_host_phone,
              bookingInviteeTime,
              bookingDetails.invitee_name
            );
            await pool.query(
              `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              [booking_id, 'reschedule_therapist_whatsapp', bookingDetails.booking_host_phone, 'success', JSON.stringify({ sent: true })]
            );
          } catch (therapistErr: any) {
            console.error('[Reschedule Booking] Failed to send therapist WhatsApp:', therapistErr?.message || therapistErr);
            await pool.query(
              `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              [booking_id, 'reschedule_therapist_whatsapp', bookingDetails.booking_host_phone, 'failed', therapistErr?.message || String(therapistErr)]
            ).catch(() => {});
          }
        }
      } catch (waErr) {
        console.error('[Reschedule Booking] Unexpected error in WhatsApp section:', waErr?.message || waErr);
      }
    }

    console.log(`[Reschedule Booking] Successfully rescheduled booking: ${booking_id}`);

    // Notify all admins about rescheduling
    const rSessionName = (bookingDetails.booking_resource_name || 'Session').replace(/ with .+$/i, '').trim();
    const newTime = new Date(new_start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const adminsForReschedule = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of adminsForReschedule.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', 'booking_rescheduled', 'Session Rescheduled',
         `"${rSessionName}" with ${bookingDetails.invitee_name} rescheduled to ${newTime}. Reason: ${reason || 'No reason provided'}`,
         booking_id]
      );
    }

    // Notify assigned therapist about rescheduling
    const rescheduleHostId = bookingDetails.booking_host_calendar_id;
    if (rescheduleHostId) {
      const therapistUserRes = await pool.query(
        'SELECT id FROM users WHERE therapist_id = $1 OR CAST(id AS TEXT) = $1',
        [rescheduleHostId]
      );
      if (therapistUserRes.rows.length > 0) {
        const tId = therapistUserRes.rows[0].id;
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tId, 'therapist', 'booking_rescheduled', 'Session Rescheduled',
           `"${rSessionName}" with ${bookingDetails.invitee_name} rescheduled to ${newTime}. Reason: ${reason || 'No reason provided'}`,
           booking_id]
        );
      }
    }

    res.json({
      success: true,
      message: 'Booking rescheduled successfully and forwarded',
      calendar_updated: calendarUpdated,
      calendar_warning: googleEventId && !calendarUpdated ? calendarWarning : null
    });

  } catch (error: any) {
    console.error('[Reschedule Booking] Error:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
});

// GET Public Booking Details
/**
 * The client's own view of their booking, for the confirmation page.
 *
 * Keyed on public_token, NOT booking_id.
 *
 * booking_id was a six-digit number, which made this route a directory: 900,000
 * requests returned every client's name, their therapist, which therapy they
 * were in, and the video link to the session itself. The token is 256 bits, so
 * the only way to reach a booking is to have been given its link.
 *
 * The :booking_id parameter name is kept because the route shape is unchanged
 * from the client's side — what changed is what a valid value looks like. Legacy
 * six-digit ids are deliberately NOT accepted as a fallback; accepting them
 * would leave the enumeration path open and make the fix cosmetic.
 */
app.get('/api/public/booking/:booking_id', async (req, res) => {
  const { booking_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT
        booking_id,
        invitee_name,
        booking_start_at,
        booking_invitee_time,
        booking_resource_name,
        booking_host_name,
        booking_status,
        booking_cancel_reason,
        booking_mode,
        therapist_id,
        invitee_payment_amount
      FROM bookings
      WHERE public_token = $1
    `, [booking_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Look up matching service in therapy_services table to fetch description, duration, charges, etc.
    let service = null;
    if (booking.booking_resource_name) {
      let serviceResult;
      if (booking.therapist_id) {
        serviceResult = await pool.query(`
          SELECT title, duration, type, description, detailed_description, charges, slug
          FROM therapy_services
          WHERE (TRIM(title) ILIKE TRIM($1) OR TRIM(slug) ILIKE TRIM($1))
            AND therapist_id = $2
            AND is_active = true
          LIMIT 1
        `, [booking.booking_resource_name, booking.therapist_id]);
      }

      if (!serviceResult || serviceResult.rows.length === 0) {
        serviceResult = await pool.query(`
          SELECT title, duration, type, description, detailed_description, charges, slug
          FROM therapy_services
          WHERE (TRIM(title) ILIKE TRIM($1) OR TRIM(slug) ILIKE TRIM($1))
            AND is_active = true
          LIMIT 1
        `, [booking.booking_resource_name]);
      }

      if (serviceResult.rows.length > 0) {
        const s = serviceResult.rows[0];
        service = {
          title: s.title,
          duration: s.duration,
          type: s.type,
          description: s.description,
          detailedDescription: s.detailed_description || s.description || '',
          charges: s.charges,
          slug: s.slug
        };
      }
    }

    booking.service = service;
    res.json(booking);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * The video link for a session, released only around the time it runs.
 *
 * Split off from the booking details above because the two are different kinds
 * of secret. Details are a record the client may look at whenever they like; the
 * joining link is a door into a live therapy session, and a door should be
 * unlocked for as long as it is needed and no longer.
 *
 * The window is generous on both sides — a client who arrives early should not
 * be told to come back, and a session that overruns should not lock its own
 * participant out.
 */
const JOIN_LINK_OPENS_MIN_BEFORE = 30;
const JOIN_LINK_CLOSES_MIN_AFTER = 120;

app.get('/api/public/booking/:public_token/join-link', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT booking_joining_link, booking_invitee_time, booking_status, booking_mode
         FROM bookings WHERE public_token = $1`,
      [req.params.public_token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const booking = rows[0];
    if (!holdsASlot(booking.booking_status)) {
      return res.status(409).json({ error: 'This session is no longer scheduled.' });
    }
    if (!booking.booking_joining_link) {
      return res.status(404).json({ error: 'This session has no video link.' });
    }

    const startMs = getBookingStartMs(booking.booking_invitee_time);
    if (startMs === null) {
      // Cannot place the session in time, so cannot say whether the window is
      // open. Refuse rather than guess — see lib/timezone.ts on why a null here
      // must never be treated as "now".
      return res.status(409).json({ error: 'This session could not be scheduled for joining.' });
    }

    const now = Date.now();
    if (now < startMs - JOIN_LINK_OPENS_MIN_BEFORE * 60000) {
      return res.status(425).json({
        error: 'The link opens 30 minutes before your session.',
        opensAt: new Date(startMs - JOIN_LINK_OPENS_MIN_BEFORE * 60000).toISOString(),
      });
    }
    if (now > startMs + JOIN_LINK_CLOSES_MIN_AFTER * 60000) {
      return res.status(410).json({ error: 'This session has finished.' });
    }

    res.json({ joiningLink: booking.booking_joining_link, mode: booking.booking_mode });
  } catch (error: any) {
    console.error('[public join-link] failed:', error?.message || error);
    res.status(500).json({ error: 'Could not load the joining link' });
  }
});




// Request session feedback
app.post('/api/request-feedback', async (req, res) => {
  try {
    const { bookingId, clientPhone, clientName, therapistName } = req.body;

    if (!bookingId || !clientPhone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { sendSessionFeedbackRequest } = await import('./automations/whatsapp.js');
    try {
      await sendSessionFeedbackRequest(bookingId, clientPhone, clientName, therapistName);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [bookingId, 'session_feedback_request_whatsapp', clientPhone, 'success', JSON.stringify({ sent: true })]
      );
      res.json({ success: true, message: 'Feedback request sent successfully' });
    } catch (waErr: any) {
      console.error('[Feedback Request] Failed to send WhatsApp:', waErr?.message || waErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [bookingId, 'session_feedback_request_whatsapp', clientPhone, 'failed', waErr?.message || String(waErr)]
      ).catch(() => {});
      // Return success anyway - feedback request is recorded in DB even if WhatsApp failed
      res.json({
        success: true,
        message: 'Feedback request recorded. WhatsApp notification may have failed - will retry.',
        warning: 'notification_send_failed'
      });
    }
  } catch (error: any) {
    console.error('Error in request-feedback:', error);
    res.status(500).json({ error: 'Failed to process feedback request' });
  }
});

// Webhook to receive feedback rating from WhatsApp/automation
app.post('/api/webhook/feedback', async (req, res) => {
  try {
    console.log('[Feedback Webhook] Received Headers:', req.headers);
    console.log('[Feedback Webhook] Received Body:', req.body);
    
    const { name, phone, rating } = req.body || {};
    
    if (!phone || rating === undefined) {
      console.log('[Feedback Webhook Error] Missing fields. phone:', phone, 'rating:', rating);
      return res.status(400).json({ 
        error: 'Missing phone or rating', 
        receivedBody: req.body,
        hint: "Make sure you set the Header 'Content-Type: application/json' in AiSensy and the JSON keys match 'phone' and 'rating'."
      });
    }

    // Clean phone number to match database format (usually +91... or without)
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const phoneSearchPattern = `%${cleanPhone.slice(-10)}`; // Match last 10 digits

    // Find the latest completed booking for this phone number
    const bookingResult = await pool.query(
      `SELECT booking_id 
       FROM bookings 
       WHERE invitee_phone LIKE $1 
         AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show', 'payment_pending', 'payment_failed')
         AND booking_start_at < NOW()
       ORDER BY booking_start_at DESC 
       LIMIT 1`,
      [phoneSearchPattern]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'No recent completed booking found for this client' });
    }

    const targetBookingId = bookingResult.rows[0].booking_id;

    // Update the rating
    const updateResult = await pool.query(
      `UPDATE bookings SET client_rating = $1 WHERE booking_id = $2 RETURNING booking_id`,
      [rating, targetBookingId]
    );

    // You can emit a socket event here if you want the dashboard to refresh instantly
    io.emit('booking_updated');

    res.json({ success: true, message: 'Rating saved successfully', bookingId: targetBookingId });
  } catch (error: any) {
    console.error('Error saving feedback rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// Statuses meaning "the slot is held but payment has NOT been confirmed yet".
// 'waiting_for_payment' is written by the dashboard "send payment link" flow,
// 'payment_pending' by the public booking page. Both are cleared by the Razorpay
// webhook (-> confirmed) or by the expiry cron (-> cancelled).
const UNPAID_HOLD_STATUSES = new Set(['waiting_for_payment', 'payment_pending', 'pending']);

/**
 * Where the public site lives, for links we put in front of clients.
 *
 * This used to rewrite EVERY vercel.app host to panel.safestories.in. The intent
 * was to stop one specific dead deployment leaking into client emails, but the
 * rule caught the whole TLD — so a deliberately configured Vercel frontend was
 * discarded too, and its booking links pointed at a different site that knows
 * nothing about the token in them. The client lands on a page that ignores it.
 *
 * So only the hosts actually known to be dead are refused; anything else set on
 * purpose is honoured, and an unset value falls back to production.
 */
const DEAD_FRONTEND_HOSTS = [/safestories-dashboard/i];

function frontendBaseUrl(): string {
  const configured = (process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
  if (!configured || DEAD_FRONTEND_HOSTS.some(dead => dead.test(configured))) {
    return 'https://panel.safestories.in';
  }
  return configured;
}

// getBookingStartMs now lives in lib/timezone, next to the convertToIST it
// depends on, and is imported at the top of this file. It used to be defined
// here as well — two implementations of the one parse that decides when a
// session actually happens, in a table whose timestamps are already stored
// three different ways. That is precisely the duplication that created the
// inconsistency, so there is deliberately only one of it now.

// ── Client-privacy calendar helpers ─────────────────────────────────────────
// Resolve the client's MASKED email (client<id>@safestories.in) for a booking.
// Reuses the stored masked_emails row (deduped by real_email) or generates one
// if absent. Returns null on any problem — it NEVER returns the real email.
async function resolveMaskedEmail(db: { query: Function }, maskId: any, realEmail: string | null | undefined): Promise<string | null> {
  try {
    if (maskId !== null && maskId !== undefined && maskId !== '') {
      const r = await db.query('SELECT masked_email FROM masked_emails WHERE id = $1', [maskId]);
      if (r.rows[0]?.masked_email) return r.rows[0].masked_email;
    }
    if (realEmail) {
      const up = await db.query(
        `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
         RETURNING masked_email`,
        [realEmail]
      );
      if (up.rows[0]?.masked_email) return up.rows[0].masked_email;
    }
  } catch (e: any) {
    console.error('[masked-email] resolve failed:', e?.message || e);
  }
  return null;
}

// Insert a Google Calendar event on the therapist's calendar showing ONLY the
// client's name + masked email (never phone, never real email). If the masked
// email is missing or Google rejects the attendee, it retries with NAME ONLY.
// Always uses sendUpdates:'none' so Google never emails the masked alias.
async function insertClientCalendarEvent(calendar: any, opts: {
  therapyLabel: string; clientName: string; mode: string; notes: string;
  maskedEmail: string | null; startISO: string; endISO: string;
  isOnline: boolean; location: string;
}): Promise<{ eventId: string | null; meetLink: string }> {
  const buildBody = (withMask: boolean) => {
    const useMask = withMask && !!opts.maskedEmail;
    const body: any = {
      summary: `${opts.therapyLabel} - ${opts.clientName}`,
      description: useMask
        ? `Session via SafeStories.\nClient: ${opts.clientName}\nEmail: ${opts.maskedEmail}\nMode: ${opts.mode}\nNotes: ${opts.notes}`
        : `Session via SafeStories.\nClient: ${opts.clientName}\nMode: ${opts.mode}\nNotes: ${opts.notes}`,
      start: { dateTime: opts.startISO, timeZone: 'Asia/Kolkata' },
      end:   { dateTime: opts.endISO,   timeZone: 'Asia/Kolkata' },
    };
    if (useMask) body.attendees = [{ email: opts.maskedEmail }];
    if (opts.isOnline) {
      body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
    } else {
      body.location = opts.location;
    }
    return body;
  };
  const doInsert = async (withMask: boolean) => {
    const ev = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: opts.isOnline ? 1 : 0,
      sendUpdates: 'none',
      requestBody: buildBody(withMask),
    });
    return { eventId: ev.data.id || null, meetLink: opts.isOnline ? (ev.data.hangoutLink || '') : '' };
  };
  try {
    return await doInsert(true);
  } catch (e: any) {
    // Any failure involving the masked attendee → retry NAME ONLY. Never fall
    // back to the client's real email or phone on the therapist's calendar.
    console.error('[calendar] insert with masked email failed — retrying name-only:', e?.message || e);
    return await doInsert(false);
  }
}

// Canonical therapy label stored on the booking and shown on the Google Calendar event.
// A booking's therapy TYPE always renders as "<Type> Therapy Session" (e.g. "Individual
// Therapy Session"), independent of therapist. Free Consultation and anything unrecognised
// are left untouched. Keeps panel display, DB, and calendar titles consistent.
function canonicalTherapyLabel(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  if (/adolescent/i.test(s)) return 'Adolescent Therapy Session';
  if (/couples?/i.test(s)) return 'Couples Therapy Session';
  if (/individual/i.test(s)) return 'Individual Therapy Session';
  return s;
}

app.get('/api/appointments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.booking_id,
        b.booking_invitee_time,
        b.booking_resource_name,
        b.invitee_payment_amount,
        b.booking_subject,
        b.invitee_name,
        b.invitee_phone,
        b.invitee_email,
        b.booking_host_name,
        b.booking_mode,
        b.booking_start_at,
        b.booking_joining_link,
        b.booking_checkin_url,
        b.therapist_id,
        b.booking_status,
        b.client_rating,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes,
        (b.booking_end_at < NOW() + INTERVAL '5 hours 30 minutes') as is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_status NOT IN ('payment_pending', 'payment_failed')
      ORDER BY b.booking_start_at DESC
    `);

    const nowMs = Date.now();
    const appointments = result.rows.map(row => {
      let status = row.booking_status;

      // A booking stays "Upcoming" (scheduled) until its session START time has
      // passed. Derive the real start instant from booking_invitee_time (storage-
      // agnostic); fall back to the SQL end-time flag only if the string can't be
      // parsed. This replaces the old `booking_end_at < NOW() + 5:30` rule, whose
      // +5:30 offset mis-flagged not-yet-started sessions as past.
      const startMs = getBookingStartMs(row.booking_invitee_time);
      const hasStarted = startMs !== null ? (startMs <= nowMs) : row.is_past;

      // An unpaid hold is not a committed session, so it must never be promoted
      // to 'completed'/'pending_notes' just because its start time slipped past
      // (the expiry cron may not have reached it yet). It stays unpaid until
      // Razorpay's webhook confirms payment or the cron cancels it.
      const normalizedStatus = (row.booking_status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      const isUnpaidHold = UNPAID_HOLD_STATUSES.has(normalizedStatus);
      const isTerminal = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled' ||
                         normalizedStatus === 'no_show';

      if (!isUnpaidHold && !isTerminal) {
        if (row.has_session_notes) {
          status = 'completed';
        } else if (hasStarted) {
          status = 'pending_notes';
        }
      }

      return {
        booking_id: row.booking_id,
        is_free: row.invitee_payment_amount === null || Number(row.invitee_payment_amount) === 0,
        booking_start_at: convertToIST(row.booking_invitee_time) || 'N/A',
        booking_resource_name: row.booking_resource_name,
        invitee_name: row.invitee_name,
        invitee_phone: row.invitee_phone,
        invitee_email: row.invitee_email,
        booking_host_name: row.booking_host_name,
        booking_mode: row.booking_mode ? row.booking_mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet',
        booking_joining_link: row.booking_joining_link,
        booking_checkin_url: row.booking_checkin_url,
        therapist_id: row.therapist_id,
        has_session_notes: row.has_session_notes,
        booking_status: status,
        booking_start_at_raw: row.booking_start_at,
        client_rating: row.client_rating || null
      };
    });

    res.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Get therapists by therapy
app.get('/api/therapists-by-therapy', async (req, res) => {
  try {
    const { therapy_name } = req.query;

    if (!therapy_name) {
      return res.status(400).json({ error: 'Therapy name is required' });
    }

    // Free Consultation is a special case: it's not a specialization, but a separate
    // service offered by the platform calendar (Safestories therapist).
    if (String(therapy_name).toLowerCase() === 'free consultation') {
      const result = await pool.query(`
        SELECT DISTINCT therapist_id, therapist_name
        FROM therapy_services
        WHERE title ILIKE '%free consultation%' AND is_active = true
      `);
      return res.json(result.rows);
    }

    const result = await pool.query(`
      SELECT therapist_id, name as therapist_name
      FROM therapists
      WHERE specialization ILIKE $1 AND COALESCE(is_active, true) = true
      ORDER BY name ASC
    `, [`%${therapy_name}%`]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapists by therapy:', error);
    res.status(500).json({ error: 'Failed to fetch therapists' });
  }
});

// Get all therapies
app.get('/api/therapies', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT specialization FROM therapists WHERE specialization IS NOT NULL AND COALESCE(is_active, true) = true');
    const therapySet = new Set<string>();
    result.rows.forEach(row => {
      const specializations = row.specialization.split(',').map((s: string) => s.trim());
      specializations.forEach((spec: string) => therapySet.add(spec));
    });
    const therapies = Array.from(therapySet).sort().map(therapy => ({ therapy_name: therapy }));
    res.json(therapies);
  } catch (error) {
    console.error('Error fetching therapies:', error);
    res.status(500).json({ error: 'Failed to fetch therapies' });
  }
});

// Save booking request
app.post('/api/booking-requests', async (req, res) => {
  try {
    const { clientName, clientWhatsapp, clientEmail, therapyType, therapistName, bookingLink, isFreeConsultation, adminId } = req.body;

    const result = await pool.query(
      `INSERT INTO booking_requests (client_name, client_whatsapp, client_email, therapy_type, therapist_name, booking_link, status, is_free_consultation)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7)
       RETURNING *`,
      [clientName, clientWhatsapp, clientEmail, therapyType, therapistName, bookingLink, isFreeConsultation || false]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error saving booking request:', error);
    res.status(500).json({ success: false, error: 'Failed to save booking request' });
  }
});

// Get therapists live status
app.get('/api/therapists-live-status', async (req, res) => {
  try {
    // Prevent caching of live status data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const result = await pool.query(`
      SELECT DISTINCT booking_host_name, booking_invitee_time
      FROM bookings
      WHERE booking_status NOT IN ('cancelled', 'canceled', 'no_show')
        AND therapist_id IS NOT NULL
        AND booking_resource_name NOT ILIKE '%free consultation%'
    `);

    const liveStatus: { [key: string]: boolean } = {};

    result.rows.forEach(row => {
      const timeMatch = (row.booking_invitee_time || '').match(/at\s+(\d+:\d+\s+[AP]M)\s+-\s+(\d+:\d+\s+[AP]M)/);

      if (timeMatch) {
        const dateStr = (row.booking_invitee_time || '').match(/(\w+,\s+\w+\s+\d+,\s+\d+)/)?.[1];
        const startTimeStr = timeMatch[1];
        const endTimeStr = timeMatch[2];

        if (dateStr) {
          const startIST = new Date(`${dateStr} ${startTimeStr} GMT+0530`);
          const endIST = new Date(`${dateStr} ${endTimeStr} GMT+0530`);
          const nowUTC = new Date();

          if (nowUTC >= startIST && nowUTC <= endIST) {
            const firstName = row.booking_host_name.split(' ')[0];
            liveStatus[firstName] = true;
          }
        }
      }
    });

    res.json(liveStatus);
  } catch (error) {
    console.error('Error fetching therapists live status:', error);
    res.status(500).json({ error: 'Failed to fetch therapists live status' });
  }
});

// Get scheduleId for a specific therapist from therapist_resources
app.get('/api/therapist-schedule', requireTherapistScope(r => r.query.therapist_id), async (req, res) => {
  try {
    const { therapist_id } = req.query;
    if (!therapist_id) {
      return res.status(400).json({ success: false, error: 'therapist_id is required' });
    }
    const result = await pool.query(
      'SELECT MAX(schedule_id) as schedule_id FROM therapist_resources WHERE therapist_id = $1',
      [therapist_id]
    );
    let scheduleId = result.rows[0]?.schedule_id ?? null;

    // Fall back to the schedule table itself.
    //
    // therapist_resources maps a PERSON to the bookable resources they host, and
    // the platform's free-consultation calendar has no row there — it hosts no
    // therapist. Its schedule nevertheless exists, keyed 'SafeStories', and is
    // what /api/fetch-slots reads through platformScheduleId(). Without this the
    // endpoint returned null for it and the availability screen had nothing to
    // load or save, so the free-consultation hours could only be changed by
    // editing therapist_schedules by hand.
    //
    // Only consulted when the primary lookup found nothing, so no therapist's
    // resolution changes. Case-insensitive because the column holds
    // 'SafeStories' while callers may send any casing.
    if (scheduleId === null) {
      const fallback = await pool.query(
        `SELECT MAX(schedule_id) AS schedule_id FROM therapist_schedules
          WHERE LOWER(therapist_id) = LOWER($1)`,
        [therapist_id]
      );
      scheduleId = fallback.rows[0]?.schedule_id ?? null;
    }
    console.log(`✅ [/api/therapist-schedule] therapist_id=${therapist_id} => scheduleId=${scheduleId}`);
    res.json({ success: true, scheduleId });
  } catch (error) {
    console.error('Error fetching therapist schedule:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch schedule' });
  }
});

// Get Google Calendar blocks for a therapist
app.get('/api/therapist/calendar-blocks', requireTherapistScope(r => r.query.therapist_id), async (req, res) => {
  try {
    const { therapist_id, timeMin, timeMax } = req.query;
    if (!therapist_id || !timeMin || !timeMax) {
      return res.status(400).json({ error: 'therapist_id, timeMin, and timeMax are required' });
    }

    const tRes = await pool.query('SELECT therapist_id, google_refresh_token, name FROM therapists WHERE therapist_id = $1', [therapist_id]);
    if (tRes.rows.length === 0 || !tRes.rows[0].google_refresh_token) {
      return res.json({ blocks: [] }); // No connected calendar
    }

    const therapist = tRes.rows[0];
    const { google } = require('googleapis');
    const oauth2ClientFb = await getAuthenticatedClient(therapist);
    const calendarFb = google.calendar({ version: 'v3', auth: oauth2ClientFb });

    const fb = await calendarFb.freebusy.query({
      requestBody: {
        timeMin: String(timeMin),
        timeMax: String(timeMax),
        items: [{ id: 'primary' }]
      }
    });

    const busyBlocks = fb.data.calendars?.primary?.busy || [];
    res.json({ blocks: busyBlocks });
  } catch (error) {
    console.error('Error fetching Google Calendar blocks:', error);
    res.status(500).json({ error: 'Failed to fetch Google Calendar blocks' });
  }
});

// Get all therapists
// The full therapist roster with contact details — a User Settings screen.
app.get('/api/therapists-admin', requireSuperAdmin, async (req, res) => {
  try {
    // The "SafeStories" row is the platform's own free-consultation calendar
    // host, not a person, so it is excluded here — both consumers of this
    // endpoint render the list as real staff. It still shows on the Therapies
    // tab, which reads /api/services.
    const result = await pool.query(`
      SELECT 
        t.therapist_id,
        t.name,
        t.specialization,
        t.contact_info,
        t.profile_picture_url,
        t.phone_number,
        COALESCE(t.is_active, true) as is_active,
        -- Separate flag from t.is_active: users.is_active gates LOGIN, while
        -- therapists.is_active gates the therapist record itself. /api/services
        -- keys "therapist inactive" (and disables booking links) off this one, so
        -- the therapist cards must see it too or the two Settings tabs disagree
        -- about the same person.
        COALESCE(u.is_active, true) as login_enabled,
        t.status,
        -- An invited therapist has a therapists row but no users row yet: the
        -- admin created the invite, the therapist has not set their password.
        -- login_enabled cannot express this (COALESCE makes a missing users row
        -- read as enabled), so the card needs the explicit signal.
        (u.id IS NULL) AS awaiting_onboarding,
        COALESCE(t.google_refresh_token IS NOT NULL, false) AS google_calendar_connected,
        (SELECT MAX(schedule_id) FROM therapist_resources WHERE therapist_id = t.therapist_id) as "scheduleId",
        COUNT(DISTINCT CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled') 
          THEN b.booking_id 
        END) as total_sessions_lifetime,
        COUNT(DISTINCT CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled')
          AND EXTRACT(MONTH FROM b.booking_start_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM b.booking_start_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          THEN b.booking_id 
        END) as sessions_this_month,
        COALESCE(SUM(CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled') 
          THEN b.invitee_payment_amount 
          ELSE 0 
        END), 0) as total_revenue,
        COALESCE(SUM(CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled')
          AND EXTRACT(MONTH FROM b.booking_start_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM b.booking_start_at) = EXTRACT(YEAR FROM CURRENT_DATE)
          THEN b.invitee_payment_amount 
          ELSE 0 
        END), 0) as revenue_this_month,
        COALESCE(SUM(CASE 
          WHEN LOWER(b.booking_status) NOT IN ('cancelled', 'canceled')
          AND b.booking_start_at >= (CURRENT_DATE - INTERVAL '1 month')
          AND b.booking_start_at < date_trunc('month', CURRENT_DATE)
          THEN b.invitee_payment_amount 
          ELSE 0 
        END), 0) as last_month_revenue,
        ROUND(AVG(NULLIF(CAST(NULLIF(REGEXP_REPLACE(b.client_rating::text, '[^0-9.]', '', 'g'), '') AS numeric), 0)), 1) as average_rating
      FROM therapists t
      LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = t.therapist_id
      LEFT JOIN bookings b ON (
        TRIM(b.booking_host_name) ILIKE '%' || SPLIT_PART(t.name, ' ', 1) || '%'
        OR TRIM(b.booking_host_name) ILIKE t.name
      )
      WHERE LOWER(t.name) != 'safestories'
      GROUP BY t.therapist_id, t.name, t.specialization, t.contact_info, t.profile_picture_url, t.phone_number, t.is_active, t.status, t.google_refresh_token, u.is_active, u.id
      ORDER BY (COALESCE(t.is_active, true) AND COALESCE(u.is_active, true)) DESC, t.name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admin therapists:', error);
    res.status(500).json({ error: 'Failed to fetch admin therapists' });
  }
});

// Update therapist status (active/inactive)
app.put('/api/admin/therapists/:id/status', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    const result = await pool.query(
      'UPDATE therapists SET is_active = $1 WHERE therapist_id = $2 RETURNING *',
      [is_active, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Therapist not found' });
    }

    res.json({ success: true, therapist: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapist status:', error);
    res.status(500).json({ error: 'Failed to update therapist status' });
  }
});

/**
 * PUT /api/admin/therapists/:id/details
 *
 * Edits a therapist's PROFILE DETAILS ONLY, from the Therapists tab lightbox.
 *
 * Deliberately narrow. The column list is an allowlist, so this cannot reach
 * is_active, status, therapist_id, google_refresh_token or anything credential
 * related — those have their own endpoints and their own consequences. Passing
 * them here is ignored rather than rejected, so a future field added to the
 * modal cannot silently gain write access to them.
 *
 * A separate endpoint rather than a reuse of PUT /api/therapist-profile: that
 * one takes therapist_id from the request body with no role gate and no
 * ownership check, so any authenticated user can rewrite any therapist's
 * profile through it. It is left alone here (the therapist-facing profile page
 * depends on it) but must not be the basis for an admin feature.
 *
 * `email` maps to therapists.contact_info and `phone` to phone_number, matching
 * how /api/therapists-admin reads them back.
 */
const THERAPIST_DETAIL_FIELDS: Record<string, string> = {
  name: 'name',
  email: 'contact_info',
  phone: 'phone_number',
  specialization: 'specialization',
  specialization_details: 'specialization_details',
  profile_picture_url: 'profile_picture_url',
  qualification_pdf_url: 'qualification_pdf_url',
};

app.put('/api/admin/therapists/:id/details', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const body = req.body || {};

    const provided = Object.keys(THERAPIST_DETAIL_FIELDS).filter(k => body[k] !== undefined);
    if (provided.length === 0) {
      return res.status(400).json({ error: 'No editable fields supplied' });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if (name !== undefined && name === '') {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    await client.query('BEGIN');

    const sets = provided.map((k, i) => `${THERAPIST_DETAIL_FIELDS[k]} = $${i + 1}`);
    const values = provided.map(k => (typeof body[k] === 'string' ? body[k].trim() : body[k]));

    const result = await client.query(
      `UPDATE therapists SET ${sets.join(', ')} WHERE therapist_id = $${provided.length + 1} RETURNING *`,
      [...values, id]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Therapist not found' });
    }

    // Keep the linked login row in step. The panel reads the therapist's name,
    // email and phone from BOTH tables depending on the screen, so updating only
    // `therapists` leaves the two disagreeing about the same person.
    const userSets: string[] = [];
    const userVals: any[] = [];
    if (body.name !== undefined) { userSets.push(`name = $${userVals.push(name)}`, `full_name = $${userVals.push(name)}`); }
    if (body.email !== undefined) { userSets.push(`email = $${userVals.push(String(body.email).trim())}`); }
    if (body.phone !== undefined) { userSets.push(`phone = $${userVals.push(String(body.phone).trim())}`); }
    if (body.profile_picture_url !== undefined) { userSets.push(`profile_picture_url = $${userVals.push(body.profile_picture_url)}`); }

    if (userSets.length > 0) {
      userVals.push(id);
      await client.query(
        `UPDATE users SET ${userSets.join(', ')}, updated_at = NOW()
          WHERE role = 'therapist' AND therapist_id = $${userVals.length}`,
        userVals
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, therapist: result.rows[0], updated: provided });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating therapist details:', error);
    res.status(500).json({ error: error.message || 'Failed to update therapist details' });
  } finally {
    client.release();
  }
});

// Get therapist details
app.get('/api/therapist-details', async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ error: 'Therapist name is required' });
    }

    // Get unique clients for this therapist - filter out bookings with missing phone/email
    const clientsResult = await pool.query(`
      SELECT DISTINCT
        invitee_name,
        invitee_email,
        invitee_phone,
        booking_start_at
      FROM bookings
      WHERE booking_host_name = $1
      AND (invitee_phone IS NOT NULL AND invitee_phone != '' OR invitee_email IS NOT NULL AND invitee_email != '')
      AND invitee_name IS NOT NULL AND invitee_name != ''
      ORDER BY booking_start_at DESC
    `, [name]);

    // Group by email (primary) or phone (fallback)
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    clientsResult.rows.forEach(row => {
      const email = row.invitee_email ? row.invitee_email.toLowerCase().trim() : null;
      const phone = row.invitee_phone ? row.invitee_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
      } else if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
        if (email) {
          const oldData = clientMap.get(key);
          clientMap.delete(key);
          key = email;
          clientMap.set(key, oldData);
          emailToKey.set(email, key);
        }
      } else {
        key = email || phone;
      }

      if (!key) return;

      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          invitee_name: row.invitee_name,
          invitee_email: row.invitee_email,
          invitee_phone: row.invitee_phone,
          latest_booking_date: row.booking_start_at
        });
      } else {
        const client = clientMap.get(key);
        // Update to most recent phone number
        if (new Date(row.booking_start_at) > new Date(client.latest_booking_date)) {
          client.latest_booking_date = row.booking_start_at;
          client.invitee_phone = row.invitee_phone;
        }
        // Fill in missing email
        if (row.invitee_email && !client.invitee_email) {
          client.invitee_email = row.invitee_email;
        }
      }
    });

    const clients = Array.from(clientMap.values()).map(({ latest_booking_date, ...client }) => client);

    // Get recent appointments for this therapist - filter out incomplete bookings
    const appointmentsResult = await pool.query(`
      SELECT
        invitee_name,
        invitee_email,
        invitee_phone,
        booking_resource_name,
        booking_start_at,
        booking_start_at as booking_start_at_raw,
        booking_invitee_time,
        booking_status,
        booking_mode as mode
      FROM bookings
      WHERE booking_host_name = $1
      AND (invitee_phone IS NOT NULL AND invitee_phone != '' OR invitee_email IS NOT NULL AND invitee_email != '')
      AND invitee_name IS NOT NULL AND invitee_name != ''
      ORDER BY booking_start_at DESC
    `, [name]);

    const appointments = appointmentsResult.rows.map(apt => ({
      ...apt,
      booking_invitee_time: convertToIST(apt.booking_invitee_time)
    }));

    res.json({
      clients,
      appointments
    });
  } catch (error) {
    console.error('Error fetching therapist details:', error);
    res.status(500).json({ error: 'Failed to fetch therapist details' });
  }
});

// Get client details
app.get('/api/client-details', async (req, res) => {
  try {
    const phones = req.query.phone;
    const email = typeof req.query.email === 'string' ? req.query.email : undefined;

    if (!email && !phones) {
      return res.status(400).json({ error: 'Client email or phone is required' });
    }

    // Get all emails and phones for this client
    let allEmails: string[] = [];
    let allPhones: string[] = [];

    if (email) {
      allEmails.push(email);
      // Get all phones for this email
      const phonesResult = await pool.query(
        'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
        [email]
      );
      allPhones = phonesResult.rows.map(r => r.invitee_phone);
    }

    if (phones) {
      const phoneArray = Array.isArray(phones) ? phones : [phones];
      const stringPhones = phoneArray.filter((p): p is string => typeof p === 'string');
      allPhones.push(...stringPhones.filter(p => !allPhones.includes(p)));

      // Get email for these phones if not already provided
      if (!email) {
        for (const phone of phoneArray) {
          if (typeof phone !== 'string') continue;
          const emailResult = await pool.query(
            'SELECT DISTINCT invitee_email FROM bookings WHERE invitee_phone = $1 AND invitee_email IS NOT NULL LIMIT 1',
            [phone]
          );
          if (emailResult.rows.length > 0 && !allEmails.includes(emailResult.rows[0].invitee_email)) {
            allEmails.push(emailResult.rows[0].invitee_email);
          }
        }

        // Get all phones for found emails
        for (const foundEmail of allEmails) {
          const phonesResult = await pool.query(
            'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
            [foundEmail]
          );
          phonesResult.rows.forEach(r => {
            if (!allPhones.includes(r.invitee_phone)) {
              allPhones.push(r.invitee_phone);
            }
          });
        }
      }
    }

    // Build query to get all appointments for all emails and phones
    let query = `
      SELECT 
        b.invitee_name,
        b.invitee_email,
        b.invitee_phone,
        b.booking_resource_name,
        b.booking_start_at,
        b.booking_end_at,
        b.booking_invitee_time,
        b.booking_host_name,
        b.booking_status,
        b.booking_mode,
        b.emergency_contact_name,
        b.emergency_contact_relation,
        b.emergency_contact_number,
        b.invitee_question,
        -- What this client was charged, and by whom. The profile builds its
        -- therapist and price history out of the booking record itself, because
        -- that IS the history — there is no separate "current therapist" or
        -- "current price" stored anywhere to read instead.
        b.booking_id,
        b.booking_subject,
        b.therapist_id,
        b.booking_host_user_id,
        b.service_id,
        b.invitee_payment_amount,
        b.invitee_payment_currency,
        b.quoted_amount,
        b.price_source,
        b.wallet_amount_applied,
        b.refund_amount,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes,
        (b.booking_end_at < NOW()) as is_past
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (allEmails.length > 0) {
      const emailPlaceholders = allEmails.map((_, i) => `$${params.length + i + 1}`).join(', ');
      query += ` AND (b.invitee_email IN (${emailPlaceholders})`;
      params.push(...allEmails);

      if (allPhones.length > 0) {
        const phonePlaceholders = allPhones.map((_, i) => `$${params.length + i + 1}`).join(', ');
        query += ` OR b.invitee_phone IN (${phonePlaceholders}))`;
        params.push(...allPhones);
      } else {
        query += ')';
      }
    } else if (allPhones.length > 0) {
      const phonePlaceholders = allPhones.map((_, i) => `$${params.length + i + 1}`).join(', ');
      query += ` AND b.invitee_phone IN (${phonePlaceholders})`;
      params.push(...allPhones);
    }

    query += ' ORDER BY b.booking_start_at DESC';

    const appointmentsResult = await pool.query(query, params);

    const appointments = appointmentsResult.rows.map(apt => {
      return {
        ...apt,
        booking_invitee_time: convertToIST(apt.booking_invitee_time),
        booking_start_at_raw: apt.booking_start_at,
        booking_end_at_raw: apt.booking_end_at,
        is_past: apt.is_past
      };
    });

    let currentTherapist = null;
    try {
      let transferQuery = `
        SELECT to_therapist_name, transfer_date
        FROM client_transfer_history
        WHERE 1=0
      `;
      const tParams: any[] = [];
      if (allEmails.length > 0) {
        const ePlaceholders = allEmails.map((_, i) => `$${tParams.length + i + 1}`).join(', ');
        transferQuery += ` OR client_email IN (${ePlaceholders})`;
        tParams.push(...allEmails);
      }
      if (allPhones.length > 0) {
        const pPlaceholders = allPhones.map((_, i) => `$${tParams.length + i + 1}`).join(', ');
        transferQuery += ` OR client_phone IN (${pPlaceholders})`;
        tParams.push(...allPhones);
      }
      transferQuery += ' ORDER BY transfer_date DESC LIMIT 1';

      if (tParams.length > 0) {
        const tRes = await pool.query(transferQuery, tParams);
        if (tRes.rows.length > 0 && appointmentsResult.rows.length > 0) {
          const t = tRes.rows[0];
          const tDate = new Date(t.transfer_date);
          const bDate = new Date(appointmentsResult.rows[0].booking_start_at || 0);
          if (tDate > bDate || !appointmentsResult.rows[0].booking_start_at) {
            currentTherapist = t.to_therapist_name;
          }
        } else if (tRes.rows.length > 0) {
          currentTherapist = tRes.rows[0].to_therapist_name;
        }
      }
    } catch (e) {
      console.error('Error fetching transfer history in client-details:', e);
    }

    res.json({
      appointments,
      currentTherapist
    });
  } catch (error) {
    console.error('Error fetching client details:', error);
    res.status(500).json({ error: 'Failed to fetch client details' });
  }
});

// Get therapist stats
app.get('/api/therapist-stats', requireTherapistScope(r => r.query.therapist_id), async (req, res) => {
  try {
    // Prevent caching of stats data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { therapist_id, start, end } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    // Get user info to find therapist_id
    const userResult = await pool.query(
      'SELECT therapist_id, username FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;
    const therapistUsername = userResult.rows[0].username;

    // Get therapist info
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0] || { name: 'Ishika Mahajan', specialization: 'Individual Therapy' };
    const therapistFirstName = therapist.name.split(' ')[0];

    const hasDateFilter = start && end;

    // Calculate last month date range
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Get stats from bookings table with date filter using therapist name
    // Bookings - count everything for this therapist
    const bookings = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_start_at BETWEEN $2 AND $3',
        [`%${therapistFirstName}%`, start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1',
        [`%${therapistFirstName}%`]
      );

    // Sessions Completed - count ALL completed sessions where session date has passed
    const sessionsCompleted = hasDateFilter
      ? await pool.query(
        `SELECT COUNT(*) as total FROM bookings 
           WHERE booking_host_name ILIKE $1
           AND booking_start_at < NOW()
           AND booking_status NOT IN ($2, $3, $4, $5)
           AND booking_start_at BETWEEN $6 AND $7`,
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', 'no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        `SELECT COUNT(*) as total FROM bookings 
           WHERE booking_host_name ILIKE $1
           AND booking_start_at < NOW()
           AND booking_status NOT IN ($2, $3, $4, $5)`,
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', 'no_show', 'no show']
      );

    const noShows = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
        [`%${therapistFirstName}%`, 'no_show', 'no show', start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3)',
        [`%${therapistFirstName}%`, 'no_show', 'no show']
      );

    const cancelled = hasDateFilter
      ? await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
        [`%${therapistFirstName}%`, 'cancelled', 'canceled', start, `${end} 23:59:59`]
      )
      : await pool.query(
        'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3)',
        [`%${therapistFirstName}%`, 'cancelled', 'canceled']
      );

    const lastMonthSessions = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'confirmed', 'rescheduled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthNoShows = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'no_show', 'no show', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const lastMonthCancelled = await pool.query(
      'SELECT COUNT(*) as total FROM bookings WHERE booking_host_name ILIKE $1 AND booking_status IN ($2, $3) AND booking_start_at BETWEEN $4 AND $5',
      [`%${therapistFirstName}%`, 'cancelled', 'canceled', lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
    );

    const avgRating = await pool.query(
      `SELECT ROUND(AVG(client_rating::numeric), 1) as avg_rating FROM bookings WHERE booking_host_name ILIKE $1 AND client_rating IS NOT NULL`,
      [`%${therapistFirstName}%`]
    );


    // Get upcoming bookings directly from bookings table
    const upcomingResult = await pool.query(`
      SELECT 
        booking_id,
        invitee_name as client_name,
        booking_resource_name as session_name,
        booking_mode as mode,
        booking_invitee_time as session_timings,
        booking_start_at as booking_date
      FROM bookings
      WHERE booking_host_name ILIKE $1
        AND booking_status NOT IN ('cancelled', 'canceled', 'no_show', 'no show')
      ORDER BY booking_start_at ASC
    `, [`%${therapistFirstName}%`]);

    // Filter upcoming sessions based on booking_invitee_time
    const nowUTC = new Date();
    const upcomingBookings = upcomingResult.rows.filter(row => {
      const timeMatch = (row.session_timings || '').match(/at\s+(\d+):(\d+)\s+([AP]M)\s+-\s+(\d+):(\d+)\s+([AP]M)/);

      if (timeMatch) {
        const dateStr = (row.session_timings || '').match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d+)/);

        if (dateStr) {
          const month = dateStr[2];
          const day = parseInt(dateStr[3]);
          const year = parseInt(dateStr[4]);

          // Parse end time
          let endHour = parseInt(timeMatch[4]);
          const endMinute = parseInt(timeMatch[5]);
          const endPeriod = timeMatch[6];

          // Convert to 24-hour format
          if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
          if (endPeriod === 'AM' && endHour === 12) endHour = 0;

          // Parse timezone offset
          const timezoneMatch = (row.session_timings || '').match(/GMT([+-])(\d+):(\d+)/);
          let timezoneOffset = 330; // Default to IST (+5:30)

          if (timezoneMatch) {
            const sign = timezoneMatch[1] === '+' ? 1 : -1;
            const hours = parseInt(timezoneMatch[2]);
            const minutes = parseInt(timezoneMatch[3]);
            timezoneOffset = sign * (hours * 60 + minutes);
          }

          // Create date in UTC
          const monthMap: { [key: string]: number } = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
          };

          const endDate = new Date(Date.UTC(year, monthMap[month], day, endHour, endMinute));
          // Adjust for timezone offset (subtract because we want UTC)
          endDate.setMinutes(endDate.getMinutes() - timezoneOffset);

          // Session is upcoming if end time hasn't passed
          return endDate > nowUTC;
        }
      }
      return false;
    }).slice(0, 10);

    res.json({
      therapist: {
        name: therapist.name,
        specialization: therapist.specialization
      },
      stats: {
        bookings: parseInt(bookings.rows[0].total) || 0,
        sessionsCompleted: parseInt(sessionsCompleted.rows[0].total) || 0,
        noShows: parseInt(noShows.rows[0].total) || 0,
        cancelled: parseInt(cancelled.rows[0].total) || 0,
        lastMonthSessions: parseInt(lastMonthSessions.rows[0].total) || 0,
        lastMonthNoShows: parseInt(lastMonthNoShows.rows[0].total) || 0,
        lastMonthCancelled: parseInt(lastMonthCancelled.rows[0].total) || 0,
        avgRating: avgRating.rows[0].avg_rating || null
      },
      upcomingBookings: upcomingBookings.map(booking => ({
        booking_id: booking.booking_id,
        client_name: booking.client_name,
        therapy_type: booking.session_name,
        mode: booking.mode?.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Google Meet',
        session_timings: convertToIST(booking.session_timings)
      }))
    });

  } catch (error) {
    console.error('Therapist stats error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist stats' });
  }
});

// Get therapist appointments
app.get('/api/therapist-appointments', requireTherapistScope(r => r.query.therapist_id), async (req, res) => {
  try {
    const { therapist_id } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    const userResult = await pool.query(
      'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0];
    const therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';

    const appointmentsResult = await pool.query(`
      SELECT 
        b.booking_id,
        b.invitee_name as client_name,
        b.invitee_phone as contact_info,
        b.invitee_email,
        b.booking_resource_name as session_name,
        b.booking_invitee_time as session_timings,
        b.booking_mode as mode,
        b.booking_start_at as booking_date,
        b.booking_start_at,
        b.booking_status,
        b.booking_joining_link,
        b.client_rating,
        CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
      FROM bookings b
      LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
      LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
      LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
      WHERE b.booking_host_name ILIKE $1
      ORDER BY b.booking_start_at DESC
    `, [`%${therapistFirstName}%`]);

    const appointments = appointmentsResult.rows.map(apt => ({
      ...apt,
      invitee_phone: apt.contact_info, // Add this for compatibility with getClientStatus
      session_timings: convertToIST(apt.session_timings),
      mode: apt.mode?.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || 'Google Meet'
    }));

    res.json({ appointments });
  } catch (error) {
    console.error('Therapist appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist appointments' });
  }
});

// Get therapist clients
app.get('/api/therapist-clients', requireTherapistScope(r => r.query.therapist_id), async (req, res) => {
  try {
    const { therapist_id } = req.query;

    if (!therapist_id) {
      return res.status(400).json({ error: 'Therapist ID is required' });
    }

    // Get user info to find therapist_id
    const userResult = await pool.query(
      'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
      [therapist_id, 'therapist']
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Therapist user not found' });
    }

    const therapistUserId = userResult.rows[0].therapist_id;

    // Get therapist info to get the name
    const therapistResult = await pool.query(
      'SELECT * FROM therapists WHERE therapist_id = $1',
      [therapistUserId]
    );

    const therapist = therapistResult.rows[0];
    const therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';

    // Get clients for this therapist with mode and session info
    const clientsResult = await pool.query(`
      SELECT 
        invitee_name as client_name,
        invitee_email as client_email,
        invitee_phone as client_phone,
        booking_start_at,
        booking_resource_name,
        booking_mode,
        client_type
      FROM bookings
      WHERE booking_host_name ILIKE $1
        AND booking_status NOT IN ('payment_pending', 'waiting_for_payment', 'payment_failed', 'pending')
      ORDER BY booking_start_at DESC
    `, [`%${therapistFirstName}%`]);

    // Group by email (primary) or phone (fallback)
    const clientMap = new Map();
    const emailToKey = new Map();
    const phoneToKey = new Map();

    clientsResult.rows.forEach(row => {
      const email = row.client_email ? row.client_email.toLowerCase().trim() : null;
      const phone = row.client_phone ? row.client_phone.replace(/[\s\-\(\)\+]/g, '') : null;

      let key = null;

      // Check if email already exists
      if (email && emailToKey.has(email)) {
        key = emailToKey.get(email);
      }
      // Check if phone already exists
      else if (phone && phoneToKey.has(phone)) {
        key = phoneToKey.get(phone);
      }
      // New client
      else {
        key = email || phone;
      }

      if (!key) return; // Skip if both are missing

      // Map both email and phone to this key
      if (email) emailToKey.set(email, key);
      if (phone) phoneToKey.set(phone, key);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          client_name: row.client_name,
          client_phone: row.client_phone,
          client_email: row.client_email,
          total_sessions: 0,
          latest_booking_date: row.booking_start_at,
          booking_resource_name: row.booking_resource_name,
          booking_mode: row.booking_mode,
          client_type: row.client_type === 'NRI' ? 'NRI' : 'Indian'
        });
      }

      const client = clientMap.get(key);
      client.total_sessions += 1;

      // If ANY booking is NRI, the client is NRI
      if (row.client_type === 'NRI') {
        client.client_type = 'NRI';
      }

      // Update to most recent session info
      if (new Date(row.booking_start_at) > new Date(client.latest_booking_date)) {
        client.latest_booking_date = row.booking_start_at;
        client.client_phone = row.client_phone;
        client.booking_resource_name = row.booking_resource_name;
        client.booking_mode = row.booking_mode;
      }

      // Fill in missing email if found
      if (row.client_email && !client.client_email) {
        client.client_email = row.client_email;
        // Update emailToKey mapping
        emailToKey.set(email!, key);
      }
    });

    const clients = Array.from(clientMap.values()).map(client => {
      return {
        client_name: client.client_name,
        client_phone: client.client_phone,
        client_email: client.client_email,
        total_sessions: client.total_sessions,
        booking_resource_name: client.booking_resource_name,
        booking_mode: client.booking_mode,
        last_session_date: client.latest_booking_date,
        client_type: client.client_type
      };
    });

    res.json({ clients });

  } catch (error) {
    console.error('Therapist clients error:', error);
    res.status(500).json({ error: 'Failed to fetch therapist clients' });
  }
});

// Get client appointments
app.get('/api/client-appointments', async (req, res) => {
  try {
    const { client_phone, therapist_id } = req.query;

    if (!client_phone) {
      return res.status(400).json({ error: 'Client phone is required' });
    }

    // Get therapist info
    let therapistFirstName = '';
    if (therapist_id) {
      const userResult = await pool.query(
        'SELECT therapist_id FROM users WHERE id = $1 AND role = $2',
        [therapist_id, 'therapist']
      );

      if (userResult.rows.length > 0) {
        const therapistUserId = userResult.rows[0].therapist_id;
        const therapistResult = await pool.query(
          'SELECT * FROM therapists WHERE therapist_id = $1',
          [therapistUserId]
        );

        const therapist = therapistResult.rows[0];
        therapistFirstName = therapist ? therapist.name.split(' ')[0] : '';
      }
    }

    // First, find all emails and phones for this client using normalized phone matching
    const clientEmailResult = await pool.query(
      `SELECT DISTINCT invitee_email FROM bookings 
       WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
       AND invitee_email IS NOT NULL LIMIT 1`,
      [client_phone]
    );

    const clientEmail = clientEmailResult.rows.length > 0 ? clientEmailResult.rows[0].invitee_email : null;

    // Get all phone numbers associated with this email
    let allPhones = [client_phone as string];
    if (clientEmail) {
      const phonesResult = await pool.query(
        'SELECT DISTINCT invitee_phone FROM bookings WHERE invitee_email = $1 AND invitee_phone IS NOT NULL',
        [clientEmail]
      );
      allPhones = phonesResult.rows.map(r => r.invitee_phone);
    }

    // Use normalized phone matching to handle +91 9999 vs +919999 variations
    const phoneConditions = allPhones.map((_, i) => 
      `regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($${clientEmail ? i + 2 : i + 1}::text, '[^0-9]', '', 'g')`
    ).join(' OR ');

    const query = therapistFirstName
      ? `SELECT 
          b.booking_id,
          b.booking_invitee_time as session_timings,
          b.booking_mode as mode,
          b.booking_start_at as booking_date,
          b.booking_status,
          b.invitee_payment_amount,
          b.emergency_contact_name,
          b.emergency_contact_relation,
          b.emergency_contact_number,
          b.invitee_age,
          b.invitee_gender,
          b.invitee_occupation,
          b.invitee_marital_status,
          b.clinical_profile,
          b.client_rating,
          b.client_type,
          CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
        FROM bookings b
        LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
        LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
        LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
        WHERE (${clientEmail ? 'b.invitee_email = $1 OR' : ''} ${phoneConditions})
          AND b.booking_host_name ILIKE $${clientEmail ? allPhones.length + 2 : allPhones.length + 1}
        ORDER BY b.booking_start_at DESC`
      : `SELECT 
          b.booking_id,
          b.booking_invitee_time as session_timings,
          b.booking_mode as mode,
          b.booking_start_at as booking_date,
          b.booking_status,
          b.invitee_payment_amount,
          b.emergency_contact_name,
          b.emergency_contact_relation,
          b.emergency_contact_number,
          b.invitee_age,
          b.invitee_gender,
          b.invitee_occupation,
          b.invitee_marital_status,
          b.clinical_profile,
          b.client_rating,
          b.client_type,
          CASE WHEN (csn.note_id IS NOT NULL OR cpn.id IS NOT NULL OR fcn.id IS NOT NULL OR pcf.booking_id IS NOT NULL OR cch.id IS NOT NULL) THEN true ELSE false END as has_session_notes
        FROM bookings b
        LEFT JOIN client_session_notes csn ON b.booking_id = csn.booking_id
        LEFT JOIN client_progress_notes cpn ON b.booking_id = cpn.booking_id
        LEFT JOIN free_consultation_pretherapy_notes fcn ON b.booking_id = fcn.booking_id
      LEFT JOIN pretherapy_call_forms pcf ON b.booking_id::text = pcf.booking_id::text
      LEFT JOIN client_case_history cch ON b.booking_id = cch.booking_id
        WHERE ${clientEmail ? 'b.invitee_email = $1 OR' : ''} ${phoneConditions}
        ORDER BY b.booking_start_at DESC`;

    const params = clientEmail
      ? (therapistFirstName ? [clientEmail, ...allPhones, `%${therapistFirstName}%`] : [clientEmail, ...allPhones])
      : (therapistFirstName ? [...allPhones, `%${therapistFirstName}%`] : allPhones);

    const appointmentsResult = await pool.query(query, params);

    const appointments = appointmentsResult.rows.map(row => ({
      booking_id: row.booking_id,
      session_timings: row.session_timings || 'N/A',
      mode: row.mode ? row.mode.replace(/\s*\(.*?\)\s*/g, '').split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : 'Google Meet',
      has_session_notes: row.has_session_notes,
      booking_status: row.booking_status,
      booking_date: row.booking_date,
      invitee_payment_amount: row.invitee_payment_amount,
      emergency_contact_name: row.emergency_contact_name,
      emergency_contact_relation: row.emergency_contact_relation,
      emergency_contact_number: row.emergency_contact_number,
      invitee_age: row.invitee_age,
      invitee_gender: row.invitee_gender,
      invitee_occupation: row.invitee_occupation,
      invitee_marital_status: row.invitee_marital_status,
      clinical_profile: row.clinical_profile
    }));

    res.json({ appointments });
  } catch (error) {
    console.error('Client appointments error:', error);
    res.status(500).json({ error: 'Failed to fetch client appointments' });
  }
});


// Get therapist average rating
app.get('/api/therapist-avg-rating', async (req, res) => {
  try {
    const { therapist_name } = req.query;
    if (!therapist_name) return res.status(400).json({ error: 'therapist_name required' });

    const result = await pool.query(`
      SELECT 
        ROUND(AVG(client_rating::numeric), 1) as avg_rating,
        COUNT(*) FILTER (WHERE client_rating IS NOT NULL) as total_ratings
      FROM bookings
      WHERE booking_host_name ILIKE $1
      AND client_rating IS NOT NULL
    `, [`%${therapist_name}%`]);

    res.json({
      avg_rating: result.rows[0].avg_rating || null,
      total_ratings: parseInt(result.rows[0].total_ratings) || 0
    });
  } catch (error) {
    console.error('Error fetching avg rating:', error);
    res.status(500).json({ error: 'Failed to fetch rating' });
  }
});

// Transfer client endpoint
// ── Client transfer ──────────────────────────────────────────────────────────
//
// Replaces a single UPDATE that moved EVERY booking a client had ever made.
// That rewrote history: past bookings record who delivered the session, the
// stats endpoints compute revenue live from booking_host_name, and a therapist
// reaches a client's clinical records only through a booking of their own. So
// the old behaviour moved the previous therapist's completed work and revenue
// onto someone else, and revoked their access to notes they had written.
//
// Only future, slot-holding sessions move now. See lib/transfer.ts.

/**
 * The therapist a client is moving TO, with contact details attached.
 *
 * Contact comes from `users`, not `therapists`: that table has no email column
 * at all and stores the number as phone_number. A booking's host contact has to
 * be right, or a later cancellation notifies the previous therapist about a
 * session they no longer hold.
 */
async function loadTransferTherapist(therapistId: string): Promise<any | null> {
  const t = await pool.query('SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1', [therapistId]);
  if (t.rows.length === 0) return null;
  const therapist = t.rows[0];
  const u = await pool.query(
    "SELECT id, email, phone FROM users WHERE therapist_id = $1 AND role = 'therapist' LIMIT 1",
    [therapistId]
  );
  return {
    ...therapist,
    userId: u.rows[0]?.id ?? null,
    contactEmail: u.rows[0]?.email ?? null,
    contactPhone: u.rows[0]?.phone ?? therapist.phone_number ?? null,
  };
}

/** The therapist a client is moving FROM. */
async function resolveSourceTherapist(fromTherapistId: any, fromTherapistName: any): Promise<any | null> {
  if (fromTherapistId) {
    const r = await pool.query('SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1', [fromTherapistId]);
    if (r.rows[0]) return r.rows[0];
  }
  if (fromTherapistName) {
    // TRIM/LOWER rather than the old exact `name = $1`, which returned nothing
    // whenever the stored display name differed by so much as a space — leaving
    // from_therapist_id null and the outgoing therapist never notified.
    const r = await pool.query(
      'SELECT * FROM therapists WHERE TRIM(LOWER(name)) = TRIM(LOWER($1)) LIMIT 1',
      [fromTherapistName]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

/**
 * Google busy blocks for a therapist.
 *
 * A read FAILURE is reported as `degraded`, never as an empty list. "Nothing in
 * the calendar" and "we could not look" are different answers, and conflating
 * them would let the wizard call a slot free when nobody checked.
 */
async function loadBusyBlocks(therapist: any, fromMs: number, toMs: number) {
  if (!therapist?.google_refresh_token) return { busy: [], hasCalendar: false, degraded: false };
  try {
    const auth = await getAuthenticatedClient(therapist);
    const calendar = google.calendar({ version: 'v3', auth });
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        items: [{ id: 'primary' }],
      },
    });
    const busy = (fb.data.calendars?.primary?.busy || [])
      .map((b: any) => ({ startMs: new Date(b.start).getTime(), endMs: new Date(b.end).getTime() }))
      .filter((b: any) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs));
    return { busy, hasCalendar: true, degraded: false };
  } catch (err: any) {
    console.error('[transfer] free/busy lookup failed:', err?.message || err);
    return { busy: [], hasCalendar: true, degraded: true };
  }
}

/**
 * Calendar plumbing handed to lib/transfer.
 *
 * insertEvent is the SHARED helper on purpose — it is what keeps the client's
 * real email off a therapist's calendar, falling back to name-only if the
 * masked address is rejected. A hand-rolled insert here would quietly lose that.
 */
const transferCalendarDeps = {
  getCalendarFor: async (therapist: any) => {
    if (!therapist?.google_refresh_token) return null;
    const auth = await getAuthenticatedClient(therapist);
    return google.calendar({ version: 'v3', auth });
  },
  insertEvent: insertClientCalendarEvent,
  resolveMasked: (maskId: any, realEmail: string | null) => resolveMaskedEmail(pool, maskId, realEmail),
  canonicalLabel: canonicalTherapyLabel,
};

const TRANSFER_WINDOW_DAYS = 21;

/**
 * What WOULD happen. Read-only and safe to call repeatedly — the wizard
 * re-runs it every time the admin picks a different therapist.
 */
app.post('/api/transfer-client/preview', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { clientName, clientEmail, clientPhone, fromTherapistName, fromTherapistId, toTherapistId } = req.body;

    if (!toTherapistId) return res.status(400).json({ error: 'Choose a therapist to transfer this client to.' });
    if (!clientEmail && !clientPhone) {
      return res.status(400).json({
        error: 'This client has no email or phone on file, so their bookings cannot be identified.',
      });
    }

    const target = await loadTransferTherapist(String(toTherapistId));
    if (!target) return res.status(404).json({ error: 'That therapist no longer exists.' });

    const source = await resolveSourceTherapist(fromTherapistId, fromTherapistName);
    if (source && String(source.therapist_id) === String(target.therapist_id)) {
      return res.status(400).json({ error: 'That is already this client\'s therapist.' });
    }

    const nowMs = Date.now();
    const toMs = nowMs + TRANSFER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const { busy, hasCalendar, degraded } = await loadBusyBlocks(target, nowMs, toMs);

    const availability = await loadAvailability(pool, String(target.therapist_id), busy, {
      hasCalendar, fromMs: nowMs, toMs,
    });

    const preview = await buildPreview(
      { db: pool, availability },
      {
        client: { name: clientName, email: clientEmail, phone: clientPhone },
        fromTherapistId: source?.therapist_id ?? null,
        fromTherapistName: source?.name ?? fromTherapistName ?? null,
        toTherapist: target,
        nowMs,
      }
    );

    if (degraded) {
      preview.warnings.push(
        `${target.name}'s Google Calendar could not be read just now, so their personal commitments were not checked for clashes.`
      );
    }

    res.json(preview);
  } catch (error: any) {
    console.error('[transfer] preview failed:', error);
    res.status(500).json({ error: 'Could not work out what this transfer would do.', detail: error.message });
  }
});

/**
 * Do it.
 *
 * Order is load-bearing and is the whole reason this is not one big query:
 *
 *   re-validate  ->  remove old calendar events  ->  BEGIN…COMMIT  ->  create
 *   new calendar events, settle money, notify
 *
 * The removals must precede the row updates because a booking's calendar is
 * resolved from its therapist_id; the creations must follow the commit because
 * they are network calls and this pool has five connections.
 */
app.post('/api/transfer-client/execute', requireRole(ADMIN_ROLES), async (req, res) => {
  const {
    idempotencyKey, toTherapistId, reason,
    clientName, clientEmail, clientPhone,
    fromTherapistName, fromTherapistId, decisions,
  } = req.body;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'This request is missing its safety key. Reopen the transfer and try again.' });
  }
  if (!toTherapistId) return res.status(400).json({ error: 'Choose a therapist to transfer this client to.' });
  if (!Array.isArray(decisions)) return res.status(400).json({ error: 'No session decisions were supplied.' });

  const actor = optionalUser(req);
  const actorName = actor?.full_name || actor?.username || actor?.email || 'admin';

  try {
    // ── Replay guard ─────────────────────────────────────────────────────────
    // Checked before ANY work, because the calendar half cannot be rolled back:
    // running this twice would orphan an event on the old therapist's calendar
    // and duplicate it on the new one.
    const already = await findExistingTransfer(pool, idempotencyKey);
    if (already) {
      return res.json({
        success: true,
        replayed: true,
        transferId: already.transfer_id,
        bookingsMoved: already.bookings_moved,
        sessionsCancelled: already.sessions_cancelled,
        walletCredited: Number(already.wallet_credited) || 0,
        calendarStatus: already.calendar_status,
        outcomes: already.outcome || [],
        message: 'This transfer has already been completed.',
      });
    }

    const target = await loadTransferTherapist(String(toTherapistId));
    if (!target) return res.status(404).json({ error: 'That therapist no longer exists.' });

    const source = await resolveSourceTherapist(fromTherapistId, fromTherapistName);
    if (source && String(source.therapist_id) === String(target.therapist_id)) {
      return res.status(400).json({ error: 'That is already this client\'s therapist.' });
    }

    const nowMs = Date.now();
    const toMs = nowMs + TRANSFER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const { busy, hasCalendar } = await loadBusyBlocks(target, nowMs, toMs);
    const availability = await loadAvailability(pool, String(target.therapist_id), busy, {
      hasCalendar, fromMs: nowMs, toMs,
    });

    const all = await findClientBookings(pool, { name: clientName, email: clientEmail, phone: clientPhone });
    const byId = new Map(all.map((b: any) => [String(b.booking_id), b]));

    // ── Re-validate every decision against the world as it is NOW ────────────
    // The wizard may have been open for ten minutes. Slots get taken, sessions
    // get cancelled from other screens. Applying the preview's conclusions
    // unchecked would act on a world that no longer exists.
    const validated: any[] = [];
    for (const d of decisions) {
      const booking = byId.get(String(d.bookingId));
      if (!booking) {
        return res.status(409).json({
          error: 'stale',
          message: 'One of these sessions no longer exists. Reload the transfer and try again.',
        });
      }
      if (!holdsASlot(booking.booking_status)) {
        return res.status(409).json({
          error: 'stale',
          message: `"${sessionNameOf(booking)}" was cancelled while this was open. Reload the transfer and try again.`,
        });
      }

      const durationMin = booking.booking_duration || 50;
      const money = assessMoney(booking, nowMs);

      const sName = sessionNameOf(booking);
      const newServiceId = await resolveServiceIdFromLabel(pool, String(target.therapist_id), sName);
      let newPrice = money.amount;
      if (newServiceId && money.amount > 0) {
        const priceRes = await resolvePrice(pool, {
          serviceId: newServiceId,
          clientEmail: clientEmail,
          clientPhone: clientPhone,
          at: new Date(nowMs)
        });
        newPrice = priceRes.amount;
      }
      const priceDifference = newPrice - money.amount;

      // Whether a price difference is allowed to MOVE MONEY. Built on positive
      // evidence of payment, because invitee_payment_amount is the session's
      // price rather than proof anyone paid it — see wasActuallyPaid().
      const paidFor = wasActuallyPaid(money);

      // Only a paid session can be blocked over an upgrade: it carries money the
      // wizard cannot collect a shortfall against. An unpaid one is re-quoted.
      if (d.action === 'move' && paidFor && priceDifference > 0) {
        return res.status(409).json({
          error: 'upgrade_blocked',
          message: `"${sName}" is already paid for and ${target.name} charges ₹${priceDifference.toLocaleString('en-IN')} more. Cancel and settle it here, then rebook at the new price.`,
        });
      }

      if (d.action === 'cancel') {
        // Never let the wizard cancel a session whose money this path cannot
        // handle — a gateway refund belongs to /api/cancel-booking alone.
        if (!money.cancellable) {
          return res.status(409).json({ error: 'not_cancellable', message: money.detail });
        }
      } else {
        const startMs = d.action === 'move'
          ? Number(d.newStartMs)
          : getBookingStartMs(booking.booking_invitee_time);

        if (!startMs || !Number.isFinite(startMs)) {
          return res.status(400).json({
            error: 'bad_time',
            message: `The time for "${sName}" could not be read, so it cannot be moved.`,
          });
        }
        if (startMs <= nowMs) {
          return res.status(409).json({
            error: 'stale',
            message: `"${sName}" has already started. Reload the transfer and try again.`,
          });
        }
        // Enforced only where it can be judged. An unconfigured schedule is a
        // warning on the preview, not grounds to refuse the whole transfer.
        if (availability.hasSchedule) {
          const verdict = assessSlot(availability, startMs, durationMin, booking.booking_id);
          if (verdict.kind !== 'none') {
            return res.status(409).json({
              error: 'conflict',
              bookingId: booking.booking_id,
              message: `${target.name} is no longer free for "${sName}" — ${verdict.detail}`,
            });
          }
        }
        d.newStartMs = startMs;
      }

      validated.push({ decision: d, booking, money, durationMin, priceDifference, newPrice, paidFor });
    }

    // ── 1. Calendar removals, while therapist_id still names the OLD therapist ─
    const calendarNotes = new Map<string, string>();
    for (const v of validated) {
      const r = await removeOldEvent(transferCalendarDeps, v.booking, source);
      if (!r.removed && r.detail && v.booking.google_event_id) {
        calendarNotes.set(String(v.booking.booking_id), r.detail);
      }
    }

    // ── 2. Every database write, in one transaction ──────────────────────────
    const tx = await pool.connect();
    const applied: any[] = [];
    let transferId: number | null = null;
    try {
      await tx.query('BEGIN');

      for (const v of validated) {
        const r = await applyDecision(tx, v.booking, v.decision, target, {
          newPrice: v.newPrice,
          priceDifference: v.priceDifference
        });
        applied.push({ ...v, ...r });
      }

      const movedIds = applied.filter(a => a.moved).map(a => String(a.booking.booking_id));
      const cancelledCount = applied.filter(a => a.decision.action === 'cancel').length;

      const inserted = await tx.query(
        `INSERT INTO client_transfer_history
           (client_name, client_email, client_phone,
            from_therapist_id, from_therapist_name,
            to_therapist_id, to_therapist_name,
            transferred_by_admin_id, transferred_by_admin_name,
            reason, idempotency_key, booking_ids, bookings_moved,
            sessions_cancelled, calendar_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,'pending')
         RETURNING transfer_id`,
        [
          clientName || null, clientEmail || null, clientPhone || null,
          source?.therapist_id ?? null, source?.name ?? fromTherapistName ?? null,
          target.therapist_id, target.name,
          actor?.id ?? null, actorName,
          reason || null, String(idempotencyKey),
          JSON.stringify(movedIds), movedIds.length, cancelledCount,
        ]
      );
      transferId = inserted.rows[0].transfer_id;

      await tx.query(
        `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          // audit_logs.therapist_id is a FOREIGN KEY into therapists, so it must
          // hold a real therapist or nothing. The therapist this record concerns
          // is the one losing the client; the ADMIN who performed it is named in
          // therapist_name, which is free text.
          //
          // The previous version passed the admin's users.id here, which cannot
          // satisfy that constraint — every transfer would have died on it. That
          // it was never noticed is the clearest evidence this feature had never
          // once run end to end.
          source?.therapist_id ?? null, actorName, 'client_transfer',
          `Transferred ${clientName || 'a client'} from ${source?.name || fromTherapistName || 'unassigned'} ` +
          `to ${target.name} — ${movedIds.length} session(s) moved, ${cancelledCount} cancelled`,
          clientName || null, getCurrentISTTimestamp(),
        ]
      );

      await tx.query('COMMIT');
    } catch (err) {
      await tx.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      tx.release();
    }

    // ── 3. After commit: external effects, each one recorded ─────────────────
    const outcomes: any[] = [];
    let walletTotal = 0;
    let anyCalendarFailure = false;
    let anyCalendarSuccess = false;

    for (const a of applied) {
      const out: any = {
        bookingId: a.booking.booking_id,
        sessionName: sessionNameOf(a.booking),
        action: a.decision.action,
        moved: a.moved,
        calendar: 'skipped',
      };

      if (a.decision.action === 'cancel') {
        out.calendar = 'removed';
        try {
          const credited = await settleCancelledSession(
            a.booking, a.money, { id: actor?.id ?? null, name: actorName }
          );
          if (credited > 0) { out.walletCredited = credited; walletTotal += credited; }
        } catch (e: any) {
          out.error = `The session was cancelled but its wallet credit failed: ${e?.message || e}`;
          console.error('[transfer] wallet credit failed:', e?.message || e);
        }
      } else {
        // A refund is only owed when money actually arrived. Without the
        // `a.paidFor` guard this credited real, spendable wallet balance against
        // sessions that were never paid for — inventing money from a quote.
        if (a.paidFor && a.priceDifference < 0) {
          try {
            const refundAmount = Math.abs(a.priceDifference);
            const credited = await creditWallet({
              name: a.booking.invitee_name,
              phone: a.booking.invitee_phone,
              email: a.booking.invitee_email,
              bookingId: a.booking.booking_id,
              amount: refundAmount,
              currency: a.booking.invitee_payment_currency || 'INR',
              // NOT 'BOOKING_SETTLEMENT'. That reason sits inside
              // uq_wallet_txn_booking_reason, which is unique on
              // (source_booking_id, reason) and ignores direction — so this
              // credit would collide with the settlement DEBIT written when the
              // same booking was paid from wallet credit, and be dropped by
              // ON CONFLICT DO NOTHING. Silently: no row, no error, and a client
              // owed money who is never told.
              reason: 'TRANSFER_ADJUSTMENT',
              sourcePaymentMode: a.booking.invitee_payment_gateway,
              notes: `Downgrade refund during transfer from ${source?.name || 'unassigned'} to ${target.name}`,
              userId: actor?.id ?? null,
              userName: actorName,
            });
            if (credited) { out.walletCredited = Number(credited.amount); walletTotal += Number(credited.amount); }
          } catch (e: any) {
            out.error = `The session moved but its wallet refund failed: ${e?.message || e}`;
            console.error('[transfer] wallet refund failed:', e?.message || e);
          }
        }

        const ev = await createNewEvent(
          transferCalendarDeps, a.booking, source, target,
          { startMs: a.newStartMs, durationMin: a.durationMin }
        );
        out.calendar = ev.status;
        out.joiningLink = ev.meetLink || null;
        if (ev.detail) out.calendarDetail = ev.detail;
        if (ev.status === 'failed') anyCalendarFailure = true;
        if (ev.status === 'moved' || ev.status === 'created') anyCalendarSuccess = true;

        // A new event carries a NEW Meet link. Storing it is not optional: the
        // old link points at a room on the previous therapist's calendar that
        // no longer exists, and the client holds that link already.
        await pool.query(
          'UPDATE bookings SET google_event_id = $1, booking_joining_link = $2 WHERE booking_id = $3',
          [ev.eventId, ev.meetLink || null, a.booking.booking_id]
        ).catch((e: any) => console.error('[transfer] could not store the new event id:', e?.message || e));
      }

      const note = calendarNotes.get(String(a.booking.booking_id));
      if (note) out.calendarDetail = [out.calendarDetail, note].filter(Boolean).join(' ');
      outcomes.push(out);
    }

    const calendarStatus = anyCalendarFailure ? 'partial' : (anyCalendarSuccess ? 'ok' : 'skipped');
    await pool.query(
      `UPDATE client_transfer_history
          SET calendar_status = $1, wallet_credited = $2, outcome = $3::jsonb
        WHERE transfer_id = $4`,
      [calendarStatus, walletTotal, JSON.stringify(outcomes), transferId]
    ).catch((e: any) => console.error('[transfer] could not record the outcome:', e?.message || e));

    // ── Notifications. Best effort; a failure here must not undo a transfer. ──
    try {
      const movedCount = outcomes.filter(o => o.moved).length;
      const cancelledCount = outcomes.filter(o => o.action === 'cancel').length;
      const summary =
        `${clientName || 'A client'} has been transferred from ` +
        `${source?.name || fromTherapistName || 'unassigned'} to ${target.name}.`;

      if (target.userId) {
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message)
           VALUES ($1,'therapist','client_transfer',$2,$3)`,
          [target.userId, 'New client assigned',
           `${clientName || 'A client'} is now yours` +
           (movedCount ? `, with ${movedCount} upcoming session(s).` : '. They have no upcoming sessions.')]
        );
      }

      if (source?.therapist_id) {
        const outgoing = await pool.query(
          "SELECT id FROM users WHERE therapist_id = $1 AND role = 'therapist' LIMIT 1",
          [source.therapist_id]
        );
        if (outgoing.rows[0]) {
          await pool.query(
            `INSERT INTO notifications (user_id, user_role, notification_type, title, message)
             VALUES ($1,'therapist','client_transfer',$2,$3)`,
            [outgoing.rows[0].id, 'Client transferred',
             `${clientName || 'A client'} has moved to ${target.name}. ` +
             `Your notes for the sessions you delivered remain available to you.`]
          );
        }
      }

      const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
      for (const admin of admins.rows) {
        await pool.query(
          `INSERT INTO notifications (user_id, user_role, notification_type, title, message)
           VALUES ($1,'admin','client_transfer',$2,$3)`,
          [admin.id, 'Client transferred',
           `${summary} ${movedCount} session(s) moved, ${cancelledCount} cancelled.`]
        );
      }
    } catch (notifyErr: any) {
      console.error('[transfer] notifications failed (non-fatal):', notifyErr?.message || notifyErr);
    }

    // ── Tell the CLIENT. Their therapist, and often their meeting link, changed.
    // Reschedule and cancel both message the client; a transfer changes more
    // than either and used to say nothing at all.
    try {
      if (clientEmail) {
        await sendClientTherapistTransferEmail(clientEmail, {
          clientName: clientName || 'there',
          newTherapistName: target.name,
          sessions: applied
            .filter(a => a.moved)
            .map(a => {
              const o = outcomes.find(x => x.bookingId === a.booking.booking_id);
              return {
                sessionName: sessionNameOf(a.booking),
                when: formatInviteeTime(a.newStartMs, a.durationMin),
                // Only an ACTUAL new link is passed on. A session whose event
                // could not be re-created is listed without one, because a stale
                // link opens a room on a calendar that no longer holds it.
                joiningLink: o?.joiningLink || null,
              };
            }),
        });
      }
    } catch (mailErr: any) {
      console.error('[transfer] client email failed (non-fatal):', mailErr?.message || mailErr);
    }

    let walletBalance = 0;
    try { walletBalance = await balanceFor(clientPhone, clientEmail); } catch { /* display only */ }

    res.json({
      success: true,
      transferId,
      fromTherapistName: source?.name ?? fromTherapistName ?? null,
      toTherapistName: target.name,
      bookingsMoved: outcomes.filter(o => o.moved).length,
      sessionsCancelled: outcomes.filter(o => o.action === 'cancel').length,
      walletCredited: walletTotal,
      walletBalance,
      calendarStatus,
      outcomes,
    });
  } catch (error: any) {
    console.error('[transfer] execute failed:', error);
    res.status(500).json({ error: 'The transfer could not be completed.', detail: error.message });
  }
});

/**
 * A client's transfer history.
 *
 * The client profile derives "current" and "previous" therapist from the
 * bookings themselves, which cannot see a transfer that produced no booking —
 * the client had nothing upcoming, or every upcoming session was cancelled and
 * settled. This table is the only record of those, so the profile reads both
 * and merges them.
 */
app.get('/api/client-transfers', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
    if (!email && !phone) return res.json({ transfers: [] });

    const { rows } = await pool.query(
      `SELECT transfer_id, client_name, from_therapist_name, to_therapist_name,
              transferred_by_admin_name, transfer_date, reason,
              bookings_moved, sessions_cancelled, wallet_credited, calendar_status
         FROM client_transfer_history
        WHERE ($1::text <> '' AND LOWER(client_email) = LOWER($1::text))
           OR ($2::text <> '' AND client_phone IS NOT NULL
               AND regexp_replace(client_phone, '[^0-9]', '', 'g')
                 = regexp_replace($2::text, '[^0-9]', '', 'g'))
        ORDER BY transfer_date DESC`,
      [email, phone]
    );

    res.json({ transfers: rows });
  } catch (error: any) {
    console.error('[transfer] history lookup failed:', error);
    res.status(500).json({ error: 'Could not load this client\'s transfer history.' });
  }
});

// Get audit logs (last 30 days only for frontend)
app.get('/api/audit-logs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       WHERE is_visible = true 
       ORDER BY log_id DESC 
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// Clear audit logs (soft delete)
app.post('/api/audit-logs/clear', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    await pool.query('UPDATE audit_logs SET is_visible = false WHERE is_visible = true');
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing audit logs:', error);
    res.status(500).json({ error: 'Failed to clear audit logs' });
  }
});

// Get CRM audit logs
app.get('/api/crm-audit-logs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM crm_audit_logs 
       ORDER BY timestamp DESC 
       LIMIT 500`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching CRM audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch CRM audit logs' });
  }
});

// Create CRM audit log
app.post('/api/crm-audit-logs', async (req, res) => {
  try {
    const { user_id, user_name, action_type, action_description, lead_id, lead_name, metadata } = req.body;
    
    const result = await pool.query(
      `INSERT INTO crm_audit_logs (user_id, user_name, action_type, action_description, lead_id, lead_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user_id, user_name, action_type, action_description, lead_id, lead_name, metadata ? JSON.stringify(metadata) : null]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating CRM audit log:', error);
    res.status(500).json({ error: 'Failed to create CRM audit log' });
  }
});

// Create audit log
app.post('/api/audit-logs', async (req, res) => {
  try {
    const { therapist_id, therapist_name, action_type, action_description, client_name, ip_address } = req.body;
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, ip_address, timestamp, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [therapist_id, therapist_name, action_type, action_description, client_name, ip_address, getCurrentISTTimestamp()]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error creating audit log:', error);
    res.status(500).json({ error: 'Failed to create audit log' });
  }
});

// Logout endpoint
app.post('/api/logout', async (req, res) => {
  try {
    const { user } = req.body;

    if (user?.role === 'therapist') {
      try {
        await pool.query(
          `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, timestamp, is_visible)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [user.therapist_id, user.username, 'logout', `${user.username} logged out`, getCurrentISTTimestamp()]
        );
      } catch (auditError) {
        console.error('❌ Failed to create audit log for logout:', auditError);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Logout failed' });
  }
});

// Get additional notes for a booking
app.get('/api/additional-notes', async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      'SELECT * FROM client_additional_notes WHERE booking_id = $1 ORDER BY created_at DESC',
      [booking_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching additional notes:', error);
    res.status(500).json({ error: 'Failed to fetch additional notes' });
  }
});

// Save/Update additional note
app.post('/api/additional-notes', async (req, res) => {
  try {
    const { note_id, booking_id, therapist_id, therapist_name, note_text } = req.body;

    if (!booking_id || !therapist_id || !note_text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (note_id) {
      // Update existing note
      await pool.query(
        'UPDATE client_additional_notes SET note_text = $1, updated_at = CURRENT_TIMESTAMP WHERE note_id = $2',
        [note_text, note_id]
      );
    } else {
      // Insert new note
      await pool.query(
        'INSERT INTO client_additional_notes (booking_id, therapist_id, therapist_name, note_text) VALUES ($1, $2, $3, $4)',
        [booking_id, therapist_id, therapist_name, note_text]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving additional note:', error);
    res.status(500).json({ error: 'Failed to save additional note' });
  }
});

// Get session notes
app.get('/api/session-notes', requireClientRecordAccess(r => ({ bookingId: r.query.booking_id })), async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      `SELECT csn.*, b.booking_invitee_time as session_timing
       FROM client_session_notes csn
       LEFT JOIN bookings b ON csn.booking_id = b.booking_id
       WHERE csn.booking_id = $1`,
      [booking_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session notes not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching session notes:', error);
    res.status(500).json({ error: 'Failed to fetch session notes' });
  }
});

// Get paperform link
app.get('/api/paperform-link', async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const result = await pool.query(
      'SELECT custom_form_link FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (result.rows.length > 0) {
      res.json({ paperform_link: result.rows[0].custom_form_link });
    } else {
      res.json({ paperform_link: null });
    }
  } catch (error) {
    console.error('Error fetching paperform link:', error);
    res.status(500).json({ error: 'Failed to fetch paperform link' });
  }
});

// Get session info for in-app session notes form
app.get('/api/session-notes-info', async (req, res) => {
  try {
    const { booking_id } = req.query;
    if (!booking_id) return res.status(400).json({ error: 'Booking ID is required' });

    const result = await pool.query(
      `SELECT
        b.booking_id,
        b.invitee_name AS client_name,
        b.invitee_email,
        b.invitee_phone,
        b.booking_start_at,
        b.booking_end_at,
        b.booking_duration,
        COALESCE(
          NULLIF(b.booking_mode, \x27\x27),
          (
            SELECT b3.booking_mode FROM bookings b3
            WHERE (LOWER(TRIM(b3.invitee_email)) = LOWER(TRIM(b.invitee_email)) 
               OR (regexp_replace(b3.invitee_phone, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
              AND b3.booking_mode IS NOT NULL
              AND b3.booking_mode != ''
            ORDER BY b3.booking_start_at DESC
            LIMIT 1
          )
        ) AS booking_mode,
        b.booking_status,
        b.booking_host_name AS therapist_name,
        b.booking_invitee_time,
        b.booking_resource_name AS session_name,
        b.booking_subject,
        act.client_id,
        (
          SELECT COUNT(*) FROM bookings b2
          WHERE (LOWER(TRIM(b2.invitee_email)) = LOWER(TRIM(b.invitee_email))
             OR (regexp_replace(b2.invitee_phone, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
            AND b2.booking_start_at <= b.booking_start_at
            AND b2.booking_status NOT IN ('cancelled', 'canceled')
        ) AS session_number
      FROM bookings b
      LEFT JOIN all_clients_table act ON (LOWER(TRIM(act.email_id)) = LOWER(TRIM(b.invitee_email)) OR (regexp_replace(act.phone_number, '[^0-9]', '', 'g') = regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') AND b.invitee_phone IS NOT NULL))
      WHERE b.booking_id = $1
      LIMIT 1`,
      [booking_id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const row = result.rows[0];
    // booking_start_at/booking_end_at are stored inconsistently (some UTC, some IST
    // wall-clock), so prefer the true instant parsed from booking_invitee_time. Fall
    // back to the raw timestamp only when the invitee_time string can't be parsed.
    const startMs = getBookingStartMs(row.booking_invitee_time);
    const startAt = startMs !== null ? new Date(startMs) : new Date(row.booking_start_at);
    const endAt = startMs !== null
      ? new Date(startMs + (row.booking_duration || 50) * 60000)
      : new Date(row.booking_end_at);

    // Always format in IST so the date/time don't shift with the server's timezone.
    const fmt = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });

    const inviteeTime = row.booking_invitee_time || '';
    let sessionTiming = `${fmt(startAt)} – ${fmt(endAt)}`;
    if (inviteeTime.includes(' at ')) {
      sessionTiming = inviteeTime.split(' at ')[1].replace(' - ', ' – ');
    }

    const isConsultation = 
      row.booking_subject?.toLowerCase().includes('consultation') || 
      row.booking_subject?.toLowerCase().includes('pre-therapy') ||
      row.booking_duration === 15 ||
      row.booking_host_name?.toLowerCase().trim() === 'safestories';

    // Auto-populate custom_form_link in DB for consultations if empty
    if (isConsultation) {
      const host = req.headers.host || '';
      const baseUrl = host.includes('localhost') ? 'http://localhost:3004' : frontendBaseUrl();
      const publicLink = `${baseUrl}/session-notes/${row.booking_id}`;
      
      // Upsert into client_doc_form
      await pool.query(`
        INSERT INTO client_doc_form (booking_id, status, custom_form_link)
        VALUES ($1, 'pending', $2)
        ON CONFLICT (booking_id) DO UPDATE SET
          custom_form_link = EXCLUDED.custom_form_link
        WHERE (client_doc_form.custom_form_link IS NULL 
           OR client_doc_form.custom_form_link = '' 
           OR client_doc_form.custom_form_link LIKE '%paperform.co%')
      `, [row.booking_id, publicLink]);
    }

    res.json({
      clientName: row.client_name || '',
      // Stable client identifier (#6): all_clients_table id when available,
      // else the booking's phone (what the client view queries case history by),
      // else email. Prevents empty client_ids that collide across clients.
      clientId: row.client_id || row.invitee_phone || row.invitee_email || '',
      bookingId: row.booking_id,
      bookingSubject: row.booking_subject || '',
      sessionDate: fmtDate(startAt),
      sessionTiming,
      sessionDuration: isConsultation ? '15 min' : (row.booking_duration ? `${row.booking_duration} min` : ''),
      therapistName: isConsultation ? 'Safestories' : (row.therapist_name || ''),
      modeOfSession: row.booking_mode || '',
      bookingStatus: row.booking_status || '',
      sessionNumber: parseInt(row.session_number) || 0,
    });
  } catch (error) {
    console.error('Error fetching session notes info:', error);
    res.status(500).json({ error: 'Failed to fetch session info' });
  }
});

// Save/Update session notes
app.post('/api/session-notes', async (req, res) => {
  try {
    const { booking_id, therapist_id, therapist_name, client_name, notes } = req.body;

    if (!booking_id || !therapist_id || !notes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if notes exist
    const existing = await pool.query(
      'SELECT note_id FROM client_session_notes WHERE booking_id = $1',
      [booking_id]
    );

    if (existing.rows.length > 0) {
      // Update existing notes
      await pool.query(
        'UPDATE client_session_notes SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $2',
        [notes, booking_id]
      );
    } else {
      // Insert new notes
      await pool.query(
        'INSERT INTO client_session_notes (booking_id, therapist_id, notes) VALUES ($1, $2, $3)',
        [booking_id, therapist_id, notes]
      );
    }

    // Log session note update
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [therapist_id, therapist_name, 'session_notes',
        `${existing.rows.length > 0 ? 'Updated' : 'Added'} session notes for ${client_name}`, client_name, getCurrentISTTimestamp()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving session notes:', error);
    res.status(500).json({ error: 'Failed to save session notes' });
  }
});

// Cancel booking
app.post('/api/bookings/cancel', async (req, res) => {
  try {
    const { booking_id, therapist_id, therapist_name, client_name, reason } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    // Read before updating so the wallet credit below sees the payment details.
    const existing = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);
    const bookingRow = existing.rows[0];

    // Update booking status
    await pool.query(
      'UPDATE bookings SET booking_status = $1 WHERE booking_id = $2',
      ['cancelled', booking_id]
    );

    // Log cancellation
    await pool.query(
      `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [therapist_id, therapist_name, 'booking_cancel',
        `Cancelled booking for ${client_name}${reason ? ': ' + reason : ''}`, client_name, getCurrentISTTimestamp()]
    );

    // Mirror the wallet credit from /api/cancel-booking. This endpoint has no
    // frontend caller today, but leaving the two cancel paths divergent is how
    // they silently drift apart later. The unique index makes it safe for both
    // to run against the same booking.
    let walletCredit: { amount: number; balance: number } | null = null;
    if (bookingRow && isWalletEligible(bookingRow)) {
      try {
        const txn = await creditWallet({
          name: bookingRow.invitee_name,
          phone: bookingRow.invitee_phone,
          email: bookingRow.invitee_email,
          bookingId: booking_id,
          amount: Number(bookingRow.invitee_payment_amount),
          currency: bookingRow.invitee_payment_currency || 'INR',
          reason: 'CANCELLATION_CREDIT',
          sourcePaymentMode: bookingRow.invitee_payment_gateway,
          notes: reason || null,
        });
        if (txn) {
          const key = buildClientKey(bookingRow.invitee_phone, bookingRow.invitee_email);
          walletCredit = {
            amount: Number(txn.amount),
            balance: key ? await getBalance(key) : Number(txn.amount),
          };
        }
      } catch (walletErr: any) {
        console.error('[Cancel Booking] Wallet credit failed (non-fatal):', walletErr?.message || walletErr);
      }
    }

    res.json({ success: true, walletCredit });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

// ── What identifies a therapy ────────────────────────────────────────────────
// There is no therapies table: a "therapy" is a GROUP of therapy_services rows
// that happen to share a name. So the only identifier a therapy can have is a
// key derived from that name — and the derivation has to be identical wherever
// it is computed, or a link built on one side stops matching the other. These
// three live here, at module scope, for exactly that reason: the catalogue and
// the booking-link resolver share them rather than each keeping a copy.

/** The rows a client may actually book. */
const BOOKABLE_SERVICE_WHERE = `
        s.is_active = true
        AND COALESCE(t.is_active, true) = true
        AND COALESCE(u.is_active, true) = true
        AND s.title !~* '\\mtest\\M'`;

/** "Individual Therapy Session with Muskan Negi" -> "Individual Therapy Session" */
const therapyNameOf = (r: any): string => {
  if (r.therapy_type && String(r.therapy_type).trim()) return String(r.therapy_type).trim();
  return String(r.title || '').split(/\s+with\s+/i)[0].replace(/\s*[-–]\s*safestories\s*$/i, '').trim();
};

/**
 * Group key for a therapy name.
 *
 * therapy_type is set on some rows and NULL on others, so the same therapy
 * arrives spelled two ways — "Adolescent Therapy" from the column and
 * "Adolescent Therapy Session" from a title. Grouped verbatim those become two
 * cards for one therapy. Dropping a trailing "session" collapses them.
 */
const groupKeyOf = (name: string): string =>
  name.toLowerCase().replace(/\s+session\s*$/i, '').replace(/\s+/g, ' ').trim();

/**
 * Turn whatever the admin settled into identifiers the booking link can carry.
 *
 * A name in a URL is a guess the public page then has to match back fuzzily, and
 * it breaks silently the moment a service or a therapist is renamed. An id is
 * the row itself. Resolution happens once, HERE, against the same rows the
 * catalogue is built from — so the link either carries something that exists or
 * carries nothing at all, and the client is never sent to an empty list.
 */
async function resolveBookingLinkTargets(input: {
  serviceId?: any; therapistId?: any; therapy?: any; therapist?: any;
}): Promise<{ sid: number | null; tkey: string | null }> {
  const { rows } = await pool.query(`
    SELECT s.id, s.title, s.therapy_type, s.therapist_id, s.therapist_name
      FROM therapy_services s
      JOIN therapists t ON t.therapist_id = s.therapist_id
      LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = s.therapist_id
     WHERE ${BOOKABLE_SERVICE_WHERE}
     ORDER BY s.title, s.therapist_name
  `);

  const wantedService = Number(input.serviceId);
  const wantedTherapist = String(input.therapistId ?? '').trim();
  const therapyKey = input.therapy ? groupKeyOf(String(input.therapy)) : '';
  const firstName = String(input.therapist ?? '').trim().toLowerCase().split(/\s+/)[0];

  // A therapist is only ever meant within the therapy the admin picked.
  const inTherapy = therapyKey
    ? rows.filter((r: any) => groupKeyOf(therapyNameOf(r)) === therapyKey)
    : rows;

  // Strongest identifier first. The name is a last resort, kept only so an older
  // caller that sends nothing else still resolves.
  const hit =
    (wantedService > 0 ? rows.find((r: any) => Number(r.id) === wantedService) : null) ||
    (wantedTherapist ? inTherapy.find((r: any) => String(r.therapist_id) === wantedTherapist) : null) ||
    (firstName ? inTherapy.find((r: any) => String(r.therapist_name || '').toLowerCase().includes(firstName)) : null) ||
    null;

  // A service id pins the therapist AND the therapy, so both travel: the public
  // page can settle the group without a second lookup.
  if (hit) return { sid: Number(hit.id), tkey: groupKeyOf(therapyNameOf(hit)) };

  // No therapist settled — the client picks. The therapy still travels, but only
  // if it is genuinely on offer; a key nothing matches would land them on an
  // empty therapist list with no way back.
  return { sid: null, tkey: therapyKey && inTherapy.length > 0 ? therapyKey : null };
}

/**
 * Redeem a booking-link token into the prefill it stands for.
 *
 * Public, because the client following the link has not logged in and never
 * will. The token IS the authorisation, which is why it is 128 random bits and
 * why nothing here is enumerable: a wrong, expired or revoked token gets the
 * same flat 404, so the endpoint cannot be used to learn which tokens exist.
 *
 * Not single-use. A client may open the link, close it, and come back — an
 * expiry bounds it instead, and the redeem counters are for support to see
 * whether the link was ever opened.
 */
app.get('/api/public/booking-link/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!token || token.length > 64) return res.status(404).json({ error: 'Link not found' });

    const { rows } = await pool.query(
      `UPDATE booking_link_tokens
          SET redeem_count      = redeem_count + 1,
              first_redeemed_at = COALESCE(first_redeemed_at, NOW()),
              last_redeemed_at  = NOW()
        WHERE token = $1
          AND revoked_at IS NULL
          AND expires_at > NOW()
      RETURNING client_name, client_email, client_phone, service_id, therapy_key`,
      [token]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'This booking link is no longer valid.' });

    const r = rows[0];
    res.json({
      name: r.client_name || '',
      email: r.client_email || '',
      phone: r.client_phone || '',
      sid: r.service_id ?? null,
      tkey: r.therapy_key || null,
    });
  } catch (error: any) {
    console.error('Error redeeming booking link:', error);
    res.status(500).json({ error: 'Failed to open this booking link.' });
  }
});

/**
 * Send the client the public booking directory so they can choose their own
 * therapy and therapist.
 *
 * The counterpart to the "Let the client choose" option on the New Session page.
 * No booking is created here — there is nothing to hold, because the choice that
 * would define the booking has not been made yet. The client books themselves
 * through the normal public flow, which already resolves their price, checks
 * slot availability and takes payment.
 */
app.post('/api/admin/send-booking-link', requireRole(ADMIN_ROLES), async (req: any, res) => {
  try {
    const { clientName, clientEmail, clientPhone, therapy, therapist,
            serviceId, therapistId, note } = req.body || {};
    const name = String(clientName || '').trim();
    const email = String(clientEmail || '').trim();
    const phone = String(clientPhone || '').trim();

    // WhatsApp is the delivery path that has to work; email rides along when we
    // have an address. So the requirement is "somewhere to send it", not an
    // email specifically — demanding one to send a WhatsApp message would be
    // arbitrary.
    if (!email && !phone) {
      return res.status(400).json({ error: 'A client WhatsApp number or email is required to send the booking link.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid client email address.' });
    }

    // Whatever the admin already settled is resolved to IDENTIFIERS here, against
    // live rows — never display names for the public page to match back by
    // guesswork.
    //   sid  = therapy_services.id, which pins therapist, price and schedule
    //   tkey = the therapy group key, when only the therapy was settled
    const { sid, tkey } = await resolveBookingLinkTargets({ serviceId, therapistId, therapy, therapist });

    // The prefill is stored, not spelled out in the URL. A link that reads
    // ?name=…&phone=… hands the client's details to anyone they forward the
    // message to; a token reveals nothing until it is redeemed, and can expire.
    // 128 bits, so it cannot be guessed or enumerated.
    const token = crypto.randomBytes(16).toString('base64url');
    await pool.query(
      `INSERT INTO booking_link_tokens
         (token, client_name, client_email, client_phone, service_id, therapy_key, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 days')`,
      [token, name || null, email, phone || null, sid, tkey, req.user?.email || req.user?.username || null]
    );

    // frontendBaseUrl() rather than the raw env var: FRONTEND_URL still points at
    // a dead vercel host in some deploy configs, and a booking link is the one
    // thing that must never be sent to a client pointing nowhere.
    const link = `${frontendBaseUrl()}/book?t=${token}`;

    // ── delivery ──────────────────────────────────────────────────────────
    // Both legs are best-effort and NEITHER may fail the request. The token is
    // already committed; the link exists and works whether or not a message got
    // out. Awaiting the email unguarded is what turned this endpoint into a 500:
    // smtp.gmail.com is dual-stack and the host has no working IPv6 route, so
    // the send died ~10s in, the throw skipped the WhatsApp block entirely, and
    // the admin was told nothing had happened while a perfectly good token sat
    // in the table. Three of those are in booking_link_tokens right now.
    //
    // WhatsApp is therefore attempted FIRST and independently: it is the leg
    // that has to work.

    /**
     * Which campaign depends on how much the admin already settled.
     *
     * All three carry the link the same way: as a BODY variable, {{1}} being the
     * client's name and {{2}} the link. No button component is sent.
     *
     * That is deliberate, not a simplification. A template's URL button is fixed
     * at approval time — a static one rejects any parameter outright ("Button at
     * index 0 of type Url does not require parameters"), and a dynamic one only
     * ever appends to its approved prefix, so it cannot carry a whole address
     * either. A body variable has neither limit, and WhatsApp still renders the
     * URL as a tappable link.
     *
     * Named here rather than left to env alone so a deploy that forgets the vars
     * still reaches the right template instead of silently degrading to the
     * no-link fallback.
     */
    const campaignBasicDetails = process.env.AISENSY_BOOKING_LINK_CLIENT_CHOOSE
      || 'basic_details_prefilled_booking_link';
    const campaignPrefilledTherapy = process.env.AISENSY_BOOKING_LINK_CLIENT_THERAPY
      || 'prefilled_therapist_booking_link';
    const campaignGeneric = process.env.AISENSY_BOOKING_LINK_CAMPAIGN;

    let whatsappSent = false;
    let whatsappCarriedLink = false;
    let whatsappError: string | null = null;

    if (phone) {
      // sid set   → therapy AND therapist are pinned; the link needs no choices.
      // tkey only → the therapy is pinned, the client picks the therapist.
      // neither   → the client picks both.
      //
      // resolveBookingLinkTargets always returns tkey alongside sid on a hit, so
      // these are keyed on sid first; testing `sid && !tkey` never matched.
      const plan =
        !sid && !tkey
          // Basic details prefilled; the client still picks therapy and therapist.
          ? { campaign: campaignBasicDetails, params: [name || 'there', link], carries: true }
        : !sid && tkey
          // Basic details AND therapy prefilled; the client picks the therapist.
          ? { campaign: campaignPrefilledTherapy, params: [name || 'there', link], carries: true }
        : campaignGeneric
          // Everything pinned. No dedicated template for this shape yet, so the
          // older generic one carries it — same two body variables.
          ? { campaign: campaignGeneric, params: [name || 'there', link], carries: true }
          // Nothing configured for this shape. The generic prompt still reaches
          // the client, but without the link — reported honestly, not as sent.
          //
          // Sent with NO params: panel_free_consultation declares no body
          // variables, and passing one was rejected outright with "Template
          // params does not match the campaign", so the client heard nothing.
          : { campaign: 'panel_free_consultation', params: [], carries: false };

      try {
        await sendAiSensyMessage(
          'manual_booking_link', plan.campaign, phone, name || 'there', plan.params
        );
        whatsappSent = true;
        whatsappCarriedLink = plan.carries;
      } catch (waErr: any) {
        whatsappError = waErr?.message || String(waErr);
        console.warn(`[Booking Link] WhatsApp to ${phone} failed: ${whatsappError}`);
      }
    }

    // Email rides along when we have an address, bounded and non-fatal. Gmail's
    // IPv6 route is broken from this host often enough that it cannot be allowed
    // to decide whether the request succeeded.
    const emailResult = email
      ? await sendEmailBounded(`Booking link email to ${email}`,
          () => sendBookingLinkEmail(email, { clientName: name || 'there', link, note: note || undefined }))
      : { ok: false, error: 'No email address on file' };

    console.log(
      `[Booking Link] ${link} — whatsapp=${whatsappSent ? (whatsappCarriedLink ? 'with link' : 'generic') : 'no'}` +
      ` email=${emailResult.ok ? 'sent' : emailResult.pending ? 'pending' : 'failed'}`
    );

    // Always 200 with the link. The token is real and the admin can pass it on
    // by hand if neither channel got through, which is strictly better than a
    // 500 that hides a link which already exists.
    res.json({
      success: true,
      link,
      delivered: whatsappCarriedLink || emailResult.ok,
      whatsappSent,
      whatsappCarriedLink,
      whatsappError,
      emailSent: emailResult.ok,
      emailPending: Boolean(emailResult.pending),
      emailError: emailResult.error || null,
    });
  } catch (error: any) {
    console.error('Error sending booking link:', error);
    res.status(500).json({ error: error?.message || 'Failed to send the booking link.' });
  }
});

/**
 * What the cancel dialog needs to know before it can offer money options.
 *
 * A dedicated read rather than new columns on the bookings/appointments list
 * queries: those feed several screens, and widening them to answer a question
 * only this dialog asks is how unrelated pages start breaking.
 */
app.get('/api/bookings/:bookingId/cancellation-options', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT invitee_name, invitee_payment_amount, invitee_payment_currency,
              invitee_payment_gateway, payment_status, booking_status, cancellation_action
         FROM bookings WHERE booking_id = $1`,
      [req.params.bookingId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found' });

    const b = rows[0];
    res.json({
      // Same rule the server enforces on cancel, so the dialog can never offer
      // an option the write path would then refuse.
      eligible: isWalletEligible(b),
      clientName: b.invitee_name || 'this client',
      amount: Number(b.invitee_payment_amount) || 0,
      currency: b.invitee_payment_currency || 'INR',
      paymentGateway: b.invitee_payment_gateway || null,
      // Needed by the dialog to say what happens to an INELIGIBLE booking's
      // money — a paid card booking refunds through the gateway, an unpaid one
      // has nothing to return. Without it the dialog can only stay silent.
      paymentStatus: b.payment_status || null,
      alreadyActioned: b.cancellation_action || null,
    });
  } catch (error) {
    console.error('Error loading cancellation options:', error);
    res.status(500).json({ error: 'Failed to load cancellation options' });
  }
});

// ── Client wallet ────────────────────────────────────────────────────────────
// Balance + recent statement for one client. Called by the booking form for
// EVERY client, so a client with no wallet is a 200 with a zero balance, never
// a 404.
//
// Role-gated, like /api/wallets and /api/wallet/adjust beside it. It was the odd
// one out: no middleware at all, taking the client's identity straight from the
// query string, so any authenticated account — a therapist, a sales user — could
// read any client's balance and statement by supplying a phone number. Client
// keys are normalised phone numbers, so they are guessable, not secret.
app.get('/api/wallet', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    // Read-only. Consolidation used to run here, which made a GET rewrite the
    // ledger — a caller chose which keys got merged, and a prefetch or a retry
    // moved rows on its own. It now runs on the write paths that have a reason
    // to touch the ledger: /api/wallet/adjust and booking creation.
    const clientKey = buildClientKey(phone, email);

    if (!clientKey) {
      return res.json({ client_key: null, balance: 0, currency: 'INR', transactions: [] });
    }

    const [balance, transactions] = await Promise.all([
      getBalance(clientKey),
      getTransactions(clientKey, 10, 0),
    ]);

    res.json({
      client_key: clientKey,
      balance,
      currency: transactions[0]?.currency || 'INR',
      client_name: transactions[0]?.client_name || null,
      transactions,
    });
  } catch (error) {
    console.error('Error fetching wallet:', error);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// Full statement for the client-profile Wallet tab. Role-gated for the same
// reason as /api/wallet above.
app.get('/api/wallet/transactions', requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    // clientKey is accepted because the Payments page opens a statement straight
    // from the wallets list, where the key is what it already holds. That is safe
    // now the route is admin-gated — the same caller can enumerate every wallet
    // through /api/wallets anyway, so naming one directly grants nothing extra.
    // It would NOT have been safe on the ungated version this replaces.
    const clientKey = typeof req.query.clientKey === 'string' && req.query.clientKey
      ? req.query.clientKey
      : buildClientKey(phone, email);

    if (!clientKey) return res.json({ balance: 0, transactions: [] });

    // Clamped rather than trusted: parseInt('abc') is NaN, and NaN survives
    // Math.min to reach the query as `LIMIT NaN`, which Postgres rejects.
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const [balance, transactions] = await Promise.all([
      getBalance(clientKey),
      getTransactions(clientKey, limit, offset),
    ]);
    res.json({ client_key: clientKey, balance, transactions });
  } catch (error) {
    console.error('Error fetching wallet transactions:', error);
    res.status(500).json({ error: 'Failed to fetch wallet transactions' });
  }
});

// Admin view: every client currently holding credit, plus total liability.
app.get('/api/wallets', requireRole(['admin', 'superadmin', 'fluidadmin']), async (req, res) => {
  try {
    const minBalance = parseFloat(String(req.query.minBalance || '0.01')) || 0.01;
    const [wallets, totalLiability] = await Promise.all([
      listWallets(minBalance),
      getTotalLiability(),
    ]);
    res.json({ wallets, totalLiability });
  } catch (error) {
    console.error('Error fetching wallets:', error);
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});

// Manual credit / payout. This mints money, so unlike most endpoints in this
// file it is role-gated. Do not relax that.
app.post('/api/wallet/adjust', requireRole(['admin', 'superadmin', 'fluidadmin']), async (req: any, res) => {
  try {
    const { phone, email, name, direction, amount, reason, notes } = req.body;

    const numericAmount = Number(amount);
    if (!(numericAmount > 0)) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }
    if (direction !== 'CREDIT' && direction !== 'DEBIT') {
      return res.status(400).json({ error: "direction must be 'CREDIT' or 'DEBIT'" });
    }
    // Only these two reasons are manually assignable. CANCELLATION_CREDIT and
    // BOOKING_SETTLEMENT are written by their own flows and carry a booking id.
    if (reason !== 'MANUAL_ADJUSTMENT' && reason !== 'REFUND_OUT') {
      return res.status(400).json({ error: "reason must be 'MANUAL_ADJUSTMENT' or 'REFUND_OUT'" });
    }
    if (!buildClientKey(phone, email)) {
      return res.status(400).json({ error: 'A phone number or email is required to identify the wallet' });
    }
    // Enforced HERE, not only in the form. This is money moved by hand with no
    // booking behind it, so the note is the ONLY record of why — and a check
    // that lives only in the browser is not a check.
    // Consolidation moved here from GET /api/wallet, which is a read and should
    // not have been rewriting the ledger. This is the right place for it: the
    // balance is about to change, so pulling in credit stranded under an older
    // phone number has to happen first or the adjustment lands on a partial one.
    await consolidateWallet(phone, email);

    if (!String(notes || '').trim()) {
      return res.status(400).json({ error: 'A note explaining this adjustment is required.' });
    }

    const actorName = req.user?.name || req.user?.username || req.user?.email || 'admin';
    const movement = {
      name, phone, email,
      amount: numericAmount,
      reason: reason as 'MANUAL_ADJUSTMENT' | 'REFUND_OUT',
      notes: String(notes).trim(),
      userId: req.user?.id ?? null,
      userName: actorName,
    };

    const txn = direction === 'CREDIT'
      ? await creditWallet(movement)
      : await debitWallet(movement);

    const balance = await getBalanceForClient(phone, email);

    // The ledger already records this, and the client profile renders it. This
    // second entry is for the people who look at the AUDIT trail rather than at
    // one client — cancel-booking files its money decisions the same way, and a
    // manual payout is the least traceable movement in the system.
    //
    // therapist_id stays NULL: it is a foreign key into therapists, and an admin
    // is not one. The actor is named in therapist_name, which is free text.
    try {
      const label = direction === 'CREDIT'
        ? 'Added to wallet'
        : (reason === 'REFUND_OUT' ? 'Encashed from wallet' : 'Reduced wallet balance');
      await pool.query(
        `INSERT INTO audit_logs (therapist_id, therapist_name, action_type, action_description, client_name, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          null,
          actorName,
          `wallet_${direction === 'CREDIT' ? 'credit' : 'debit'}`,
          `${label} — ₹${numericAmount} for ${name || phone || email} (${reason}). ` +
          `Balance now ₹${balance}. Note: ${String(notes).trim()}`,
          name || null,
          getCurrentISTTimestamp(),
        ]
      );
    } catch (auditErr: any) {
      // Non-fatal: the ledger is the source of truth and the movement has
      // already happened. Losing the audit copy must not fail the request.
      console.error('[wallet] audit log insert failed (non-fatal):', auditErr?.message || auditErr);
    }

    res.json({ success: true, transaction: txn, balance });
  } catch (error: any) {
    if (error instanceof InsufficientWalletBalance) {
      return res.status(409).json({
        error: 'Wallet balance is not sufficient for this adjustment',
        availableBalance: error.availableBalance,
      });
    }
    console.error('Error adjusting wallet:', error);
    res.status(500).json({ error: 'Failed to adjust wallet' });
  }
});

// Get refunds and cancellations
app.get('/api/refunds', async (req, res) => {
  try {
    const { status } = req.query;
    const statusStr = typeof status === 'string' ? status : '';

    let query = `
      SELECT
        COALESCE(r.client_name, b.invitee_name) as client_name,
        COALESCE(r.session_name, b.booking_resource_name) as session_name,
        COALESCE(r.session_timings::text, b.booking_start_at::text, b.booking_invitee_time) as session_timings,
        b.booking_invitee_time,
        b.booking_host_name AS therapist_name,
        b.refund_status,
        -- What the admin decided about the money on a Cash/QR cancellation.
        -- NULL for gateway refunds and for cancellations made before this
        -- existed, which the Payments page renders as plain "Cancelled".
        b.cancellation_action,
        b.cancellation_action_by,
        b.cancellation_action_at,
        COALESCE(b.invitee_phone, '') as invitee_phone,
        COALESCE(b.invitee_email, '') as invitee_email,
        COALESCE(b.refund_amount, 0) as refund_amount,
        b.invitee_payment_amount AS payment_amount,
        b.payment_status,
        -- Gateway: payments.payment_gateway_name is the real gateway column
        -- (payment_mode is the instrument — card/upi — and is NULL on every
        -- cancelled row, so the old COALESCE always fell through to the raw
        -- invitee value). Fall back through both before giving up.
        COALESCE(p.payment_gateway_name, b.invitee_payment_gateway, p.payment_mode) as payment_gateway,
        -- Razorpay order id: organic bookings store it on
        -- bookings.invitee_payment_reference_id ('order_...'); only the admin
        -- payment-link flow populates bookings.razorpay_order_id.
        COALESCE(b.razorpay_order_id, p.razorpay_order_id, b.invitee_payment_reference_id, p.payment_reference_id) as razorpay_order_id,
        COALESCE(b.payment_id, p.razorpay_payment_id) as payment_id,
        -- Fields the shared payment-details modal renders. Without them a row
        -- opened from the Cancellation tab showed N/A for mode and timestamps.
        p.payment_mode,
        p.utr,
        p.failure_reason,
        -- Legacy cancellations have no payments row and no invitee_created_at,
        -- so fall through to the payment record's own timestamps.
        COALESCE(b.invitee_created_at, p.payment_date, p.created_at) AS created_at,
        -- The moment the booking was actually cancelled. booking_updated_at is
        -- only set by newer flows (9/34), while invitee_cancelled_at is present
        -- on 29/34 — and on all 12 refund-initiated rows.
        COALESCE(b.invitee_cancelled_at, b.booking_updated_at) AS cancelled_at,
        COALESCE(b.booking_updated_at, b.invitee_cancelled_at) AS booking_updated_at,
        b.booking_joining_link,
        b.booking_status,
        b.refund_id,
        COALESCE(b.refund_initiated_at, p.refund_initiation_date) AS refund_initiated_at
      FROM bookings b
      LEFT JOIN refund_cancellation_table r ON b.booking_id = r.session_id
      LEFT JOIN payments p ON b.booking_id = p.booking_id
      WHERE b.booking_status IN ('cancelled', 'canceled')
        -- Expired/failed payment links are ALSO stored as 'cancelled' by
        -- startPaymentLinkExpiryCron. They are not real cancellations and
        -- belong on the Failed/Expired tab, so keep them out of here.
        AND COALESCE(b.payment_status, '') <> 'Failed'
    `;

    const params: any[] = [];

    if (statusStr && statusStr !== 'all') {
      if (statusStr.toLowerCase() === 'pending') {
        query += " AND LOWER(b.refund_status) = 'initiated'";
      } else {
        query += ' AND LOWER(b.refund_status) = LOWER($1)';
        params.push(statusStr);
      }
    }

    // NOTE: bookings has no `created_at` column — its creation timestamp is
    // `invitee_created_at`. Referencing b.created_at made this query throw and
    // 500'd every refund/cancellation tab.
    query += ' ORDER BY COALESCE(b.booking_start_at, b.invitee_created_at) DESC NULLS LAST';

    const result = await pool.query(query, params);

    const refunds = result.rows.map(row => {
      // Prefer the authoritative pre-formatted IST string captured at booking time.
      // Fall back to deriving from the stored timestamp (formatted in Asia/Kolkata)
      // only when the invitee string is missing.
      let formattedTimings: string = (row.booking_invitee_time && String(row.booking_invitee_time).trim())
        ? String(row.booking_invitee_time).trim()
        : 'N/A';
      if (formattedTimings === 'N/A' && row.session_timings) {
        const date = new Date(row.session_timings);
        const endDate = new Date(date.getTime() + (50 * 60 * 1000));
        const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
        const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
        const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
        const day = date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Kolkata' });
        const year = date.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
        formattedTimings = `${weekday}, ${month} ${day}, ${year} at ${fmt(date)} - ${fmt(endDate)} IST`;
      }

      // The gateway is stored with inconsistent casing across flows
      // ('razorpay' vs 'Razorpay'), which made the same gateway render as two
      // different values. Normalise to one canonical label per gateway.
      const rawGateway = String(row.payment_gateway || '').trim();
      const gatewayLabels: Record<string, string> = {
        razorpay: 'Razorpay',
        'payment link': 'Razorpay',
        cash: 'Cash',
        qr: 'QR',
        upi: 'UPI',
        wallet: 'Wallet',
        'wallet+cash': 'Wallet + Cash',
        'wallet+qr': 'Wallet + QR',
      };
      const payment_gateway = rawGateway
        ? (gatewayLabels[rawGateway.toLowerCase()] || rawGateway)
        : null;

      return {
        ...row,
        session_timings: formattedTimings,
        payment_gateway,
        refund_status: row.refund_status
      };
    });

    res.json(refunds);
  } catch (error) {
    console.error('Error fetching refunds:', error);
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// Get payments
app.get('/api/payments', async (req, res) => {
  try {
    const { status } = req.query;

    // Helper to format a booking row into the payments shape
    const formatRow = (row: any, startAtField: string, endAtField: string) => {
      // Prefer the authoritative pre-formatted IST string captured at booking time
      // (booking_invitee_time is exactly what the client saw/agreed to). Historical
      // booking_start_at values use inconsistent storage conventions (some naive-IST,
      // some naive-UTC), so re-deriving the time from it is unreliable. Only fall back
      // to deriving from the timestamp when no invitee string exists (e.g. legacy rows).
      let formattedTimings: string = (row.booking_invitee_time && String(row.booking_invitee_time).trim())
        ? String(row.booking_invitee_time).trim()
        : 'N/A';
      const startRaw = row[startAtField];
      if (formattedTimings === 'N/A' && startRaw) {
        const date = new Date(startRaw);
        const endDate = new Date(row[endAtField] || date.getTime() + 50 * 60 * 1000);
        const fmt = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
        const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
        const month   = date.toLocaleDateString('en-US', { month: 'short',  timeZone: 'Asia/Kolkata' });
        const day     = date.toLocaleDateString('en-US', { day: 'numeric',  timeZone: 'Asia/Kolkata' });
        const year    = date.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
        formattedTimings = `${weekday}, ${month} ${day}, ${year} at ${fmt(date)} - ${fmt(endDate)} IST`;
      }
      return {
        booking_id: row.booking_id,
        client_name: row.invitee_name,
        session_name: row.booking_resource_name,
        session_timings: formattedTimings,
        payment_status: row.payment_status,
        invitee_phone: row.invitee_phone || '',
        invitee_email: row.invitee_email || '',
        payment_amount: row.payment_amount || row.invitee_payment_amount || 0,
        razorpay_order_id: row.razorpay_order_id || null,
        payment_id: row.payment_id || null,
        created_at: row.created_at || row.invitee_created_at,
        booking_updated_at: row.booking_updated_at || null,
        booking_joining_link: row.booking_joining_link || null,
        // Cash/QR bookings record their mode on bookings.invitee_payment_gateway
        // (the payments table is only populated for Razorpay/UPI). Fall back to it
        // so the payment-detail modal shows the mode for cash and QR too.
        payment_mode: row.payment_mode || row.invitee_payment_gateway || null,
        utr: row.utr || null,
        failure_reason: row.failure_reason || null,
        customer_details: row.customer_details || null,
        therapist_name: row.booking_host_name || row.therapist_name || null,
        refund_id: row.refund_id || null,
        refund_initiated_at: row.refund_initiated_at || null,
        refund_status: row.refund_status || null,
        refund_amount: row.refund_amount || null,
        booking_status: row.booking_status || null
      };
    };

    let rows: any[] = [];

    if (!status || status === 'all_payments' || status === 'completed') {
      // Completed payments: from dashboard_api_booking (legacy) AND bookings (recent Razorpay)
      const dRes = await pool.query(
        `SELECT *, invitee_name, booking_resource_name, payment_amount, payment_status, NULL as payment_mode, NULL as utr, NULL as failure_reason, NULL as customer_details
         FROM dashboard_api_booking
         WHERE payment_amount IS NOT NULL AND payment_amount > 0
           AND payment_status = 'Completed'
         ORDER BY created_at DESC`
      );
      rows.push(...dRes.rows.map(r => formatRow(r, 'start_at', 'end_at')));

      const pRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE (b.booking_status = 'confirmed' OR b.payment_status = 'Paid' OR b.payment_status = 'Completed')
           AND b.invitee_payment_amount IS NOT NULL AND b.invitee_payment_amount >= 0
         ORDER BY b.invitee_created_at DESC`
      );
      rows.push(...pRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'pending') {
      // Pending payments: bookings table
      const pRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE (b.booking_status IN ('payment_pending', 'waiting_for_payment') OR b.payment_status = 'Pending')
           AND b.booking_status NOT IN ('Canceled', 'cancelled', 'canceled', 'payment_failed', 'Failed')
           AND b.invitee_payment_amount IS NOT NULL AND b.invitee_payment_amount >= 0
         ORDER BY b.invitee_created_at DESC`
      );
      rows.push(...pRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'expired') {
      // Failed payments (including expired payment links).
      // An expired link is NOT left as 'waiting_for_payment': startPaymentLinkExpiryCron
      // rewrites it to booking_status='cancelled' + payment_status='Failed' within 60s of
      // the 30-minute deadline, so `payment_status = 'Failed'` is what actually catches it.
      const fRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE b.booking_status = 'payment_failed'
           OR b.payment_status = 'Failed'
         ORDER BY b.invitee_created_at DESC`
      );
      rows.push(...fRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'refunded') {
      // Refunded payments: refund processed/completed
      const rRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE b.refund_status IS NOT NULL
           AND LOWER(b.refund_status) IN ('processed', 'refunded', 'completed')
         ORDER BY b.refund_initiated_at DESC NULLS LAST`
      );
      rows.push(...rRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    if (!status || status === 'all_payments' || status === 'refund_failed') {
      // Refund failed payments
      const rfRes = await pool.query(
        `SELECT b.*, p.payment_mode, p.utr, p.failure_reason, p.customer_details, b.invitee_payment_amount AS payment_amount
         FROM bookings b
         LEFT JOIN payments p ON b.booking_id = p.booking_id
         WHERE b.refund_status IS NOT NULL
           AND LOWER(b.refund_status) IN ('failed', 'refund_failed')
         ORDER BY b.refund_failed_time DESC NULLS LAST`
      );
      rows.push(...rfRes.rows.map(r => formatRow(r, 'booking_start_at', 'booking_end_at')));
    }

    // Sort combined results by created_at desc
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json(rows);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Get notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const { user_id, user_role } = req.query;

    if (!user_id || !user_role) {
      return res.status(400).json({ error: 'User ID and role required' });
    }

    const result = await pool.query(
      `SELECT notification_id, user_id, user_role, notification_type, title, message, is_read,
              (created_at AT TIME ZONE 'Asia/Kolkata') as created_at, related_id
       FROM notifications WHERE user_id = $1 AND user_role = $2 ORDER BY created_at DESC LIMIT 50`,
      [user_id, user_role]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get client profile
app.get('/api/client-profile', async (req, res) => {
  try {
    const { userId } = req.query;

    const userResult = await pool.query(
      'SELECT id, username, full_name FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    const bookingResult = await pool.query(
      `SELECT invitee_phone, invitee_email, emergency_contact_name, emergency_contact_number 
       FROM bookings 
       WHERE invitee_name ILIKE $1 
       ORDER BY invitee_created_at DESC 
       LIMIT 1`,
      [`%${user.full_name}%`]
    );

    const booking = bookingResult.rows[0] || {};

    res.json({
      full_name: user.full_name,
      whatsapp_no: booking.invitee_phone?.replace('+91 ', '') || '',
      email: booking.invitee_email || '',
      emergency_contact_name: booking.emergency_contact_name || '',
      emergency_contact_number: booking.emergency_contact_number || ''
    });
  } catch (error) {
    console.error('Error fetching client profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update client profile
app.post('/api/client-profile', async (req, res) => {
  try {
    const { userId, fullName } = req.body;

    await pool.query(
      'UPDATE users SET full_name = $1 WHERE id = $2',
      [fullName, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating client profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE notifications SET is_read = true WHERE notification_id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
app.put('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const { user_id, user_role } = req.body;
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND user_role = $2',
      [user_id, user_role]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Delete notification
app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM notifications WHERE notification_id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Create notification for all admins
app.post('/api/request-feedback', async (req, res) => {
  try {
    const { bookingId, clientName, clientEmail, clientPhone, therapistName, sessionName, sessionDate } = req.body;
    
    // Equivalent template: client_sessionfeedback
    await sendSessionFeedbackRequest(
      bookingId,
      clientPhone,
      clientName,
      therapistName
    );

    res.status(200).json({ success: true, message: 'Feedback request sent successfully' });
  } catch (error) {
    console.error('Error sending feedback request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/send-session-notes-reminder', async (req, res) => {
  try {
    const { bookingId, therapistId, therapistName, clientName, sessionName, sessionTimings, domain } = req.body;
    
    // We need therapist phone to send this
    let phone = 'Unknown';
    if (therapistId) {
      const tRes = await pool.query('SELECT contact_info FROM therapists WHERE therapist_id = $1', [therapistId]);
      if (tRes.rows.length > 0) phone = tRes.rows[0].contact_info;
    } else {
      const tRes = await pool.query('SELECT contact_info FROM therapists WHERE name = $1', [therapistName]);
      if (tRes.rows.length > 0) phone = tRes.rows[0].contact_info;
    }

    if (phone === 'Unknown' || !phone) {
      return res.status(400).json({ error: 'Therapist phone not found' });
    }

    const shortLink = domain + '/session-notes/' + bookingId;

    await sendPostSessionTherapistForm(
      bookingId,
      phone,
      therapistName,
      clientName,
      sessionTimings,
      shortLink
    );

    res.status(200).json({ success: true, message: 'Session notes reminder sent successfully' });
  } catch (error) {
    console.error('Error sending session notes reminder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/send-whatsapp-reminder', async (req, res) => {
  try {
    const { sessionTimings, sessionName, clientName, phone, email, therapistName, mode, meetingLink, checkinUrl } = req.body;
    
    await sendAiSensyMessage(
      "manual_reminder",
      meetingLink ? "1hr_onlinesession_reminder_api_campaign" : "clientsessionreminder_1hr_inperson_pabbly_api",
      phone,
      clientName,
      meetingLink ? [clientName, sessionName, sessionTimings, meetingLink] : [clientName, sessionName, sessionTimings]
    );

    res.status(200).json({ success: true, message: 'WhatsApp reminder sent successfully' });
  } catch (error) {
    console.error('Error sending WhatsApp reminder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/notifications/create-admin', async (req, res) => {
  try {
    const { notification_type, title, message, related_id } = req.body;

    // Deduplication: skip if a notification with same related_id + type already exists for any admin
    if (related_id) {
      const dupCheck = await pool.query(
        `SELECT 1 FROM notifications WHERE related_id = $1 AND notification_type = $2 AND user_role = 'admin' LIMIT 1`,
        [String(related_id), notification_type]
      );
      if (dupCheck.rows.length > 0) {
        console.log(`[Notifications] Skipping duplicate ${notification_type} for related_id=${related_id}`);
        return res.json({ success: true, skipped: true });
      }
    }

    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, user_role, notification_type, title, message, related_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [admin.id, 'admin', notification_type, title, message, related_id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating admin notifications:', error);
    res.status(500).json({ error: 'Failed to create notifications' });
  }
});

// Send booking link webhook
app.post('/api/send-booking-link', async (req, res) => {
  try {
    const { clientName, email, phone, therapistName, therapy } = req.body;

    // Validate required fields
    if (!clientName) {
      return res.status(400).json({ error: 'Missing required fields: clientName is required' });
    }

    try {
      let campaignName = 'panel_free_consultation';

      if (therapy && therapy !== 'Free Consultation' && therapistName && therapistName !== 'Safestories') {
        const campaignResult = await pool.query(
          `SELECT campaign_name FROM aisensy_campaign_api 
           WHERE TRIM(LOWER(therapy)) = TRIM(LOWER($1)) 
           AND TRIM(LOWER(therapist_name)) ILIKE $2 LIMIT 1`,
          [therapy, `%${therapistName.split(' ')[0]}%`]
        );
        
        if (campaignResult.rows.length > 0 && campaignResult.rows[0].campaign_name) {
          campaignName = campaignResult.rows[0].campaign_name;
        } else {
          console.warn(`[send-booking-link] No custom campaign found for ${therapy} / ${therapistName}. Falling back.`);
        }
      }

      const params = campaignName === 'panel_free_consultation' ? [] : [clientName];

      await sendAiSensyMessage(
        "manual_booking_link",
        campaignName,
        phone,
        clientName,
        params
      );

      res.status(200).json({ success: true, message: 'Booking link sent successfully' });

    } catch (apiError: any) {
      console.error('❌ Error sending booking link via AiSensy:', apiError);

      res.status(200).json({
        success: true,
        message: 'Request processed (AiSensy service unavailable)',
        warning: apiError.message || 'Could not reach AiSensy service'
      });
    }
  } catch (error) {
    console.error('❌ Error in booking link endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Which calendar days a therapist works at all, over a range.
 *
 * /api/fetch-slots answers for ONE day and does real work per call — schedule
 * lookup, booking deconfliction, sometimes a Google free/busy round trip — so
 * probing it 30 times to paint a month is not an option. This reads the
 * schedule once and applies only the day-level rules, in the same precedence
 * fetch-slots uses: exclusion beats override beats weekly rule.
 *
 * A day listed here is OPEN, not necessarily FREE — every slot on it may already
 * be booked. fetch-slots remains the authority on actual times; this only stops
 * the picker offering days the therapist never works.
 */
/**
 * The platform's own calendar, which the free consultation is booked against.
 *
 * Was written out as the literal 999999 in two places - one digit longer than
 * the row that actually exists (99999) - and matched against the exact string
 * "SafeStories" while therapy_services spells the same calendar "Safestories".
 * Either mistake alone resolved the free consultation to no schedule, so every
 * day came back with no slots and the consultation could not be booked at all.
 * Looked up now rather than spelled out, and matched case-insensitively, so
 * neither can happen again.
 */
const isPlatformCalendar = (name: string) => name.trim().toLowerCase() === 'safestories';

async function platformScheduleId(): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT schedule_id FROM therapist_schedules
      WHERE LOWER(therapist_id) = 'safestories'
      ORDER BY schedule_id DESC LIMIT 1`
  );
  return rows[0]?.schedule_id ?? null;
}

app.get('/api/therapist-open-days', async (req, res) => {
  try {
    const therapistName = String(req.query.therapistName || '').trim();
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!therapistName || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'therapistName, from and to (YYYY-MM-DD) are required' });
    }

    let scheduleId: number | null = null;
    if (isPlatformCalendar(therapistName)) {
      scheduleId = await platformScheduleId();
    } else {
      const tRes = await pool.query(
        `SELECT tr.schedule_id FROM therapists t
         LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id
         WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1`,
        [therapistName.toLowerCase()]
      );
      scheduleId = tRes.rows[0]?.schedule_id ?? null;
    }
    // No schedule on file means no rules to go on. Say so rather than returning
    // an empty list, which the picker would render as "never available".
    if (!scheduleId) return res.json({ days: null, unscheduled: true });

    const schedRes = await pool.query(
      'SELECT availability, date_overrides, exclusions FROM therapist_schedules WHERE schedule_id = $1',
      [scheduleId]
    );
    if (schedRes.rows.length === 0) return res.json({ days: null, unscheduled: true });

    const parse = (v: any, fallback: any) => {
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
      return v ?? fallback;
    };
    const availabilityRules = parse(schedRes.rows[0].availability, []);
    const dateOverrides = parse(schedRes.rows[0].date_overrides, []);
    const exclusions = parse(schedRes.rows[0].exclusions, []);
    if (!Array.isArray(availabilityRules) || availabilityRules.length === 0) {
      return res.json({ days: null, unscheduled: true });
    }

    /** At least one window long enough to hold a 50-minute session. */
    const hasRoom = (times: any) => Array.isArray(times) && times.some((t: any) => {
      const [sh, sm] = String(t?.start || '').split(':').map(Number);
      const [eh, em] = String(t?.end || '').split(':').map(Number);
      if ([sh, sm, eh, em].some(n => !Number.isFinite(n))) return false;
      return (eh * 60 + em) - (sh * 60 + sm) >= 50;
    });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
    const start = from < today ? today : from;
    const days: string[] = [];

    for (let cur = new Date(`${start}T12:00:00Z`), guard = 0;
         guard < 92 && cur.toISOString().split('T')[0] <= to;
         cur = new Date(cur.getTime() + 86400000), guard++) {
      const dStr = cur.toISOString().split('T')[0];

      // 1. Exclusions block the whole day, across the full range — not just its
      //    endpoints, or a multi-day holiday would leave its middle bookable.
      const excluded = (Array.isArray(exclusions) ? exclusions : []).some((ex: any) => {
        const f = ex?.start ?? ex?.date;
        const t = ex?.end ?? ex?.start ?? ex?.date;
        return f && dStr >= f && dStr <= t;
      });
      if (excluded) continue;

      const dayOfWeek = cur.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toLowerCase();
      const weekly = availabilityRules.find((r: any) => (r.day || '').toLowerCase() === dayOfWeek);
      const override = (Array.isArray(dateOverrides) ? dateOverrides : [])
        .find((ov: any) => ov?.date === dStr || ov?.day === dStr);

      let open: boolean;
      if (override) {
        // Anything ambiguous fails CLOSED — never silently open a day.
        let isAvailable: boolean;
        if (typeof override.is_available === 'boolean') isAvailable = override.is_available;
        else if (typeof override.isAvailable === 'boolean') isAvailable = override.isAvailable;
        else if (typeof override.availability === 'boolean') isAvailable = override.availability;
        else isAvailable = Array.isArray(override.availability) && override.availability.length > 0;

        const overrideTimes = Array.isArray(override.availability) ? override.availability
          : (Array.isArray(override.times) ? override.times : []);

        if (isAvailable) {
          // An "available" override with no windows falls back to the weekly rule.
          open = overrideTimes.length > 0 ? hasRoom(overrideTimes)
            : Boolean(weekly?.is_available && hasRoom(weekly.times));
        } else {
          // A partial block still leaves the rest of the weekly day open; a full
          // one closes it. Whether the remainder holds 50 minutes is left to
          // fetch-slots, which does the interval arithmetic.
          open = overrideTimes.length > 0 && Boolean(weekly?.is_available && hasRoom(weekly.times));
        }
      } else {
        open = Boolean(weekly?.is_available && hasRoom(weekly.times));
      }

      if (open) days.push(dStr);
    }

    res.json({ days, unscheduled: false });
  } catch (error) {
    console.error('Error computing open days:', error);
    res.status(500).json({ error: 'Failed to compute available days' });
  }
});

app.post('/api/fetch-slots', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.selectedDate || !payload.timezone) {
      return res.status(400).json({ error: 'Missing required fields: date and timezone' });
    }

    console.log('--- NATIVE FETCH SLOTS ---');

    const therapistName = payload.selectedTherapist || payload.therapistName;
    let scheduleId: number | null = null;
    let therapistId: string | null = null;

    // When the service already knows its own schedule, use it directly (most reliable path)
    if (payload.scheduleId) {
      scheduleId = Number(payload.scheduleId);
      // Still resolve therapistId for booking deconfliction (filter out existing bookings)
      if (payload.therapistId) {
        therapistId = payload.therapistId;
      } else if (therapistName && !isPlatformCalendar(therapistName)) {
        const tRes = await pool.query(
          'SELECT therapist_id FROM therapists WHERE TRIM(LOWER(name)) = $1 LIMIT 1',
          [therapistName.trim().toLowerCase()]
        );
        if (tRes.rows.length > 0) therapistId = tRes.rows[0].therapist_id;
      }
    } else if (therapistName && isPlatformCalendar(therapistName)) {
      scheduleId = await platformScheduleId();
      if (payload.therapistId) {
        therapistId = payload.therapistId;
      }
    } else if (therapistName) {
      const therapistResult = await pool.query(
        'SELECT t.therapist_id, tr.schedule_id FROM therapists t LEFT JOIN therapist_resources tr ON t.therapist_id = tr.therapist_id WHERE TRIM(LOWER(t.name)) = $1 ORDER BY tr.schedule_id DESC NULLS LAST LIMIT 1',
        [therapistName.trim().toLowerCase()]
      );
      if (therapistResult.rows.length > 0) {
        therapistId = therapistResult.rows[0].therapist_id;
        scheduleId = therapistResult.rows[0].schedule_id;
      }
    }

    let availabilityRules = [];
    let dateOverrides = [];
    let exclusions = [];
    if (scheduleId) {
      const schedRes = await pool.query('SELECT availability, date_overrides, exclusions FROM therapist_schedules WHERE schedule_id = $1', [scheduleId]);
      if (schedRes.rows.length > 0) {
        availabilityRules = schedRes.rows[0].availability;
        dateOverrides = schedRes.rows[0].date_overrides || [];
        exclusions = schedRes.rows[0].exclusions || [];
      }
    }
    
    if (typeof availabilityRules === 'string') {
      try { availabilityRules = JSON.parse(availabilityRules); } catch(e){}
    }
    if (typeof dateOverrides === 'string') {
      try { dateOverrides = JSON.parse(dateOverrides); } catch(e){}
    }
    if (typeof exclusions === 'string') {
      try { exclusions = JSON.parse(exclusions); } catch(e){}
    }

    let availableSlots = [];
    const targetDateStr = payload.selectedDate;
    const targetDate = new Date(`${targetDateStr}T12:00:00Z`);
    const daysToCheck = [-1, 0, 1].map(offset => {
      const d = new Date(targetDate.getTime() + offset * 86400000);
      return d.toISOString().split('T')[0];
    });

    if (Array.isArray(availabilityRules) && availabilityRules.length > 0) {
      for (const dStr of daysToCheck) {
        // Resolve this date's weekly rule up front — several branches below need it.
        const dObj = new Date(`${dStr}T12:00:00Z`);
        const dayOfWeekIST = dObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toLowerCase();
        const weeklyRule = availabilityRules.find((r: any) => (r.day || '').toLowerCase() === dayOfWeekIST);

        // 1. Exclusions block the whole day. Compare against the full range rather
        //    than only its endpoints, otherwise a multi-day holiday
        //    ({start:'2026-08-01', end:'2026-08-10'}) would leave 02–09 bookable.
        const isExcluded = exclusions.some((ex: any) => {
          const from = ex.start ?? ex.date;
          const to = ex.end ?? ex.start ?? ex.date;
          return from && dStr >= from && dStr <= to; // ISO YYYY-MM-DD compares lexicographically
        });
        if (isExcluded) continue;

        // 2. Check date overrides
        const override = dateOverrides.find((ov: any) => ov.date === dStr || ov.day === dStr);
        let dayRule: any = null;

        if (override) {
          // Resolve availability explicitly. Anything ambiguous must fail CLOSED
          // (blocked) — never silently open a day to clients.
          let isAvailable: boolean;
          if (typeof override.is_available === 'boolean') isAvailable = override.is_available;
          else if (typeof override.isAvailable === 'boolean') isAvailable = override.isAvailable;
          else if (typeof override.availability === 'boolean') isAvailable = override.availability;
          else isAvailable = Array.isArray(override.availability) && override.availability.length > 0;

          const overrideTimes = Array.isArray(override.availability)
            ? override.availability
            : (Array.isArray(override.times) ? override.times : []);

          if (isAvailable) {
            // An "available" override carrying no windows must not wipe the day out.
            // Fall back to the weekly schedule instead of producing zero slots — a
            // day marked available should never yield fewer slots than no override.
            const times = overrideTimes.length > 0
              ? overrideTimes
              : (weeklyRule && weeklyRule.is_available && Array.isArray(weeklyRule.times) ? weeklyRule.times : []);
            dayRule = {
              day: dStr,
              is_available: true,
              times
            };
          } else {
            // Unavailability override
            if (overrideTimes.length > 0) {
              // Partial day unavailability override: base is standard weekly schedule
              if (weeklyRule && weeklyRule.is_available && Array.isArray(weeklyRule.times)) {
                dayRule = {
                  day: dStr,
                  is_available: true,
                  times: weeklyRule.times,
                  excludeTimes: overrideTimes
                };
              } else {
                dayRule = {
                  day: dStr,
                  is_available: false,
                  times: []
                };
              }
            } else {
              // Full day unavailability
              dayRule = {
                day: dStr,
                is_available: false,
                times: []
              };
            }
          }
        } else {
          // 3. Fallback to weekly schedule
          dayRule = weeklyRule;
        }
        
        if (dayRule && dayRule.is_available && Array.isArray(dayRule.times)) {
          for (const timeBlock of dayRule.times) {
            let current = new Date(`${dStr}T${timeBlock.start}:00+05:30`);
            const end = new Date(`${dStr}T${timeBlock.end}:00+05:30`);
            
            while (current < end) {
              const slotEndCheck = new Date(current.getTime() + 50 * 60000);
              if (slotEndCheck > end) break;
              
              // Check if this slot overlaps with any hourly unavailability override
              let isExcludedSlot = false;
              if (Array.isArray(dayRule.excludeTimes)) {
                for (const exBlock of dayRule.excludeTimes) {
                  const exStart = new Date(`${dStr}T${exBlock.start}:00+05:30`);
                  const exEnd = new Date(`${dStr}T${exBlock.end}:00+05:30`);
                  
                  if (current < exEnd && slotEndCheck > exStart) {
                    isExcludedSlot = true;
                    break;
                  }
                }
              }
              
              if (!isExcludedSlot) {
                availableSlots.push({ 
                  timestampMs: current.getTime(), 
                  dateObj: new Date(current.getTime())
                });
              }
              
              current.setMinutes(current.getMinutes() + 30);
            }
          }
        }
      }
    }

    if (therapistId || therapistName === 'SafeStories') {
      try {
        let bookingsRes;
        if (therapistId) {
          bookingsRes = await pool.query(
            `SELECT booking_start_at, booking_end_at FROM bookings 
             WHERE therapist_id = $1 AND booking_status NOT IN ('Canceled', 'canceled', 'cancelled')
             AND booking_start_at >= $2::timestamp WITH TIME ZONE 
             AND booking_start_at <= $3::timestamp WITH TIME ZONE`,
            [therapistId, `${daysToCheck[0]}T00:00:00+05:30`, `${daysToCheck[2]}T23:59:59+05:30`]
          );
        } else {
          bookingsRes = await pool.query(
            `SELECT booking_start_at, booking_end_at FROM bookings 
             WHERE booking_resource_name ILIKE '%Free Consultation%' AND booking_status NOT IN ('Canceled', 'canceled', 'cancelled')
             AND booking_start_at >= $1::timestamp WITH TIME ZONE 
             AND booking_start_at <= $2::timestamp WITH TIME ZONE`,
            [`${daysToCheck[0]}T00:00:00+05:30`, `${daysToCheck[2]}T23:59:59+05:30`]
          );
        }
        
        availableSlots = availableSlots.filter(slot => {
          const slotStartMs = slot.timestampMs;
          const slotEndMs = slotStartMs + 50 * 60000;
          
          return !bookingsRes.rows.some(booking => {
            if (!booking.booking_start_at) return false;
            const bookedStartMs = new Date(booking.booking_start_at).getTime();
            const bookedEndMs = booking.booking_end_at 
              ? new Date(booking.booking_end_at).getTime()
              : bookedStartMs + 50 * 60000;
              
            return slotStartMs < bookedEndMs && slotEndMs > bookedStartMs;
          });
        });
      } catch (err) {
        console.error('Error fetching bookings to filter slots:', err);
      }

      // Google Calendar Free/Busy Filter
      //
      // WHICH CALENDAR TO ASK. therapistId is null for the platform calendar:
      // the branch above sets it only when the caller supplied one, and the
      // callers that pick "SafeStories" send a NAME and no id. This lookup then
      // ran as `WHERE therapist_id = NULL`, matched no row, and free/busy was
      // skipped in silence — so a free consultation offered every slot the
      // weekly schedule allowed, including hours already blocked in the very
      // Google calendar someone had just connected.
      //
      // The platform has a real therapists row, keyed 'SafeStories', and that is
      // where its token lives; fall back to it by name when there is no id.
      // Compared case-insensitively because the column holds 'SafeStories' while
      // isPlatformCalendar() works in lower case.
      const calendarOwnerId = therapistId
        || (isPlatformCalendar(String(therapistName || '')) ? 'SafeStories' : null);
      try {
        const tRes = calendarOwnerId
          ? await pool.query(
              `SELECT therapist_id, google_refresh_token, name FROM therapists
                WHERE LOWER(therapist_id) = LOWER($1)`, [calendarOwnerId])
          : { rows: [] as any[] };
        if (tRes.rows.length > 0 && tRes.rows[0].google_refresh_token) {
          const therapist = tRes.rows[0];
          // Since getAuthenticatedClient expects an object with google_refresh_token, we can pass therapist directly.
          // Note: Ensure google API requires are available in scope.
          const { google } = require('googleapis');
          const oauth2ClientFb = await getAuthenticatedClient(therapist);
          const calendarFb = google.calendar({ version: 'v3', auth: oauth2ClientFb });
          
          const timeMin = new Date(`${daysToCheck[0]}T00:00:00+05:30`);
          const timeMax = new Date(`${daysToCheck[2]}T23:59:59+05:30`);
          
          const fb = await calendarFb.freebusy.query({
            requestBody: {
              timeMin: timeMin.toISOString(),
              timeMax: timeMax.toISOString(),
              items: [{ id: 'primary' }]
            }
          });
          
          const busyBlocks = fb.data.calendars?.primary?.busy || [];
          if (busyBlocks.length > 0) {
            availableSlots = availableSlots.filter(slot => {
              const slotStart = slot.timestampMs;
              const slotEnd = slotStart + 50 * 60000; // 50 mins duration
              
              return !busyBlocks.some((busy: any) => {
                const busyStart = new Date(busy.start).getTime();
                const busyEnd = new Date(busy.end).getTime();
                // Check if slot overlaps with busy block
                return slotStart < busyEnd && slotEnd > busyStart;
              });
            });
          }
        }
      } catch (err) {
        console.error('Error fetching Google Calendar free/busy for slots:', err);
      }
    }

    const realNow = new Date();
    const fourHoursFromNow = new Date(realNow.getTime() + 4 * 60 * 60 * 1000);
    
    availableSlots = availableSlots.filter(slot => {
      return slot.timestampMs >= fourHoursFromNow.getTime();
    });

    const formattedSlots = availableSlots
      .map(slot => {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: payload.timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23'
        });
        const parts = formatter.formatToParts(slot.dateObj);
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        const h = parts.find(p => p.type === 'hour').value;
        const min = parts.find(p => p.type === 'minute').value;
        const s = parts.find(p => p.type === 'second').value;
        
        return {
          clientDateStr: `${y}-${m}-${d}`,
          clientTimeStr: `${h}:${min}:${s}`,
          absoluteIso: slot.dateObj.toISOString()
        };
      })
      .filter(slot => slot.clientDateStr === payload.selectedDate)
      .map(slot => slot.absoluteIso);
    // Session charges, via the same resolver every other path uses.
    //
    // This replaced a 4-level ILIKE fallback ladder that ended in "any active
    // service by this therapist, ORDER BY id DESC" — which happily returned a
    // different therapy's price. Identifying the service first, then pricing it,
    // means this quote cannot disagree with what create-order charges.
    let sessionCharges = 0;
    let sessionPriceSource = 'none';
    const selectedTherapy = payload.selectedTherapy;
    try {
      // Narrow to one service before pricing. Two candidates means the label was
      // ambiguous, and guessing would quote the wrong therapy.
      const svc = await pool.query(
        `SELECT id FROM therapy_services
          WHERE is_active = true
            AND ($1::text IS NULL OR therapist_id = $1::text)
            AND ($2::text IS NULL OR title ILIKE '%' || $2::text || '%')`,
        [therapistId || null, selectedTherapy || null]
      );

      const serviceId = svc.rows.length === 1
        ? svc.rows[0].id
        : await resolveServiceIdFromLabel(pool, therapistId, selectedTherapy);

      if (serviceId) {
        const price = await resolvePrice(pool, {
          serviceId,
          // Present when the admin booking form has already captured the client;
          // absent on the first load, which then quotes list price.
          clientEmail: payload.clientEmail,
          clientPhone: payload.clientPhone || payload.clientWhatsApp,
        });
        sessionCharges = price.amount;
        sessionPriceSource = price.source;
        console.log(`[Fetch Slots] Resolved ₹${price.amount} (${price.source}) for service ${serviceId} / "${selectedTherapy}"`);
      } else {
        console.warn(`[Fetch Slots] No unambiguous service for therapist="${therapistName}", therapy="${selectedTherapy}"`);
      }
    } catch (chargeErr) {
      console.error('[Fetch Slots] Failed to resolve session charges (non-fatal):', chargeErr);
    }

    res.json([{
      "Available Slots": formattedSlots,
      "session charges": sessionCharges,
      price_source: sessionPriceSource,
      success: true,
    }]);
  } catch (error) {
    console.error('Error in native fetch-slots:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET public service details by slug
app.delete('/api/services/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM therapy_services WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Therapy service not found' });
    }
    res.json({ message: 'Therapy service deleted successfully' });
  } catch (error) {
    console.error('Error deleting therapy service:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/public/services/:slug', async (req, res) => {
  try {
    let { slug } = req.params;
    // Normalise: stored slugs always have a leading "/"
    if (!slug.startsWith('/')) slug = '/' + slug;

    const result = await pool.query(
      'SELECT * FROM therapy_services WHERE slug = $1 AND is_active = true',
      [slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const s = result.rows[0];

    // The list price, resolved from therapy_price_schedule. This is the
    // anonymous quote — the visitor has not identified themselves yet, so no
    // grandfathered rate or client override can apply. BookingPage re-quotes
    // via /api/public/resolve-price once an email or phone is entered.
    const listPrice = await resolvePrice(pool, { serviceId: s.id });

    res.json({
      id: s.id,
      title: s.title,
      duration: s.duration,
      type: s.type,
      therapy_type: s.therapy_type,
      description: s.description,
      // "detailedDescription" is what BookingPage renders — use the description column
      detailedDescription: s.description || '',
      charges: `₹${listPrice.amount}`,
      list_amount: listPrice.amount,
      // Tells the client this figure may drop once they identify themselves.
      price_is_provisional: true,
      slug: s.slug,
      owner: s.therapist_name,
      therapist_id: s.therapist_id,
      schedule_id: s.schedule_id,
      form_questions: s.form_questions || [],
      is_payment_enabled: s.is_payment_enabled ?? true,
      payment_gateway: s.payment_gateway || 'Razorpay',
      requires_tnc: s.requires_tnc ?? true,
    });
  } catch (error) {
    console.error('Error fetching public service:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/public/catalogue
 *
 * Everything bookable, grouped by therapy, for the single public booking page.
 *
 * Why this exists rather than reusing /api/services: the visitor picks a
 * therapy and then a therapist, and each option must carry the service row it
 * stands for. Matching a chosen therapy NAME back to a service later is the
 * fragile step this endpoint removes — the id travels with the choice.
 *
 * The therapy name is parsed off the title ("Individual Therapy Session with
 * Muskan Negi" -> "Individual Therapy Session") because therapy_type is NULL on
 * most rows and cannot be grouped on.
 *
 * Public and read-only. It exposes the catalogue a visitor is about to be shown
 * anyway, and no client data of any kind.
 */
app.get('/api/public/catalogue', async (req, res) => {
  try {
    // BOOKABLE_SERVICE_WHERE, which decides whether a VISITOR should ever see a
    // row, and is shared with the booking-link resolver so a link can never
    // point at something this list would hide:
    //
    //  1. BOTH active flags, because they mean different things and either one
    //     being off must hide the therapist:
    //       therapists.is_active  gates the therapist RECORD
    //       users.is_active       gates their LOGIN, and is what "deactivate
    //                             therapist" in the panel actually sets
    //     /api/services reports therapist_is_active from users, and
    //     /api/therapist-availability blocks bookings on it — so checking only
    //     therapists.is_active left a deactivated therapist bookable here while
    //     every other screen showed them as disabled. Missing users row means an
    //     external therapist, which stays allowed (COALESCE), matching
    //     /api/therapist-availability.
    //  2. No internal/test calendars. Matched on a WORD boundary so "Test
    //     Update" goes and a real therapy like "Latest Approaches" stays.
    //  3. Free Consultation is excluded further down by its own flag, not here,
    //     because it is a real service the admin may still want listed.
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.therapy_type, s.duration, s.slug, s.type,
             s.description, s.therapist_id, s.therapist_name, s.schedule_id,
             s.is_payment_enabled,
             t.profile_picture_url, t.specialization, t.specialization_details,
             t.qualification_pdf_url
        FROM therapy_services s
        JOIN therapists t ON t.therapist_id = s.therapist_id
        LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = s.therapist_id
       WHERE ${BOOKABLE_SERVICE_WHERE}
       ORDER BY s.title, s.therapist_name
    `);

    // therapyNameOf and groupKeyOf are module-level on purpose - the booking-link
    // resolver builds tkey with the very same functions, so a key that leaves in
    // a link is a key this catalogue will recognise.

    // The anonymous list price. A visitor who has not identified themselves can
    // hold no grandfathered rate, and the booking page re-quotes through
    // /api/public/resolve-price the moment a phone or email is entered.
    const priced = await Promise.all(rows.map(async (r: any) => {
      let amount: number | null = null;
      try { amount = (await resolvePrice(pool, { serviceId: r.id })).amount; } catch { /* price is display-only here */ }
      return { ...r, amount };
    }));

    const groups = new Map<string, any>();
    for (const r of priced) {
      const name = therapyNameOf(r);
      if (!name) continue;
      const key = groupKeyOf(name);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          // Display the collapsed form ("Adolescent Therapy"), not whichever
          // spelling happened to arrive first.
          name: name.replace(/\s+session\s*$/i, '').trim() || name,
          // Free Consultation is not a therapy the client chooses between; it
          // has no therapist and no payment, and the caller renders it apart.
          is_free_consultation: /free consultation/i.test(name),
          therapists: [],
        });
      }
      groups.get(key).therapists.push({
        service_id: r.id,
        slug: r.slug,
        therapist_id: r.therapist_id,
        therapist_name: r.therapist_name,
        profile_picture_url: r.profile_picture_url || null,
        specialization: r.specialization || null,
        specialization_details: r.specialization_details || null,
        qualification_pdf_url: r.qualification_pdf_url || null,
        duration: r.duration,
        session_mode: r.type || null,
        amount: r.amount,
        is_payment_enabled: r.is_payment_enabled ?? true,
      });
    }

    res.json({ success: true, therapies: Array.from(groups.values()) });
  } catch (error: any) {
    console.error('Error building public catalogue:', error);
    res.status(500).json({ error: 'Failed to load the catalogue' });
  }
});

/**
 * POST /api/public/resolve-price
 *
 * What THIS client pays for THIS therapy, right now. Called from the public
 * booking page on the same debounce that already fires /api/public/client-history,
 * as soon as a valid email or phone is entered.
 *
 * Public on purpose (the booking page is unauthenticated), and safe to be:
 * it is read-only and reveals only a price the client is about to be quoted
 * anyway. It deliberately does NOT report whether the client exists — that
 * would turn it into an account-enumeration oracle. `is_existing_client` is
 * derived from the price rule that won, which the client can see regardless.
 */
app.post('/api/public/resolve-price', async (req, res) => {
  try {
    const { slug, serviceId, email, phone } = req.body || {};
    if (!slug && !serviceId) {
      return res.status(400).json({ error: 'slug or serviceId is required' });
    }

    const price = await resolvePrice(pool, {
      serviceId: serviceId ? Number(serviceId) : null,
      slug: slug || null,
      clientEmail: email,
      clientPhone: phone,
    });

    // Fire-and-forget; a failed audit write must not fail the quote.
    logPriceResolution(pool, price, { context: 'quote', clientEmail: email, clientPhone: phone })
      .catch(() => {});

    res.json({
      success: true,
      amount: price.amount,
      currency: price.currency,
      list_amount: price.listAmount,
      is_special_price: price.amount !== price.listAmount,
      is_grandfathered: price.isGrandfathered,
      // 'lock' means an existing client on their original rate; 'override'
      // means an admin set this client's price by hand.
      price_source: price.source,
    });
  } catch (error: any) {
    console.error('Error resolving price:', error);
    res.status(500).json({ error: 'Failed to resolve price' });
  }
});

/* ================================================================== *
 * Admin pricing (User Settings -> Pricing tab)
 *
 * Every write here goes through requireRole, which sits behind the global
 * activity-logging middleware — so price changes and client overrides show up
 * in Organization Settings -> Audit Logs without any extra wiring.
 * ================================================================== */

/**
 * GET /api/admin/pricing/therapies
 * One row per therapy: the price in force, when it started, the next scheduled
 * change if any, and how many clients are grandfathered on an older rate.
 *
 * Deactivated therapies and deactivated therapists are excluded — they cannot
 * be booked, so a price for them is not a thing anyone can act on.
 *
 * "Deactivated" means either of two independent flags, matching how the
 * Therapists and Therapies tabs read it:
 *   therapists.is_active — the therapist record
 *   users.is_active      — whether they can log in; /api/services keys off this
 *                          one to disable public booking links
 * COALESCE defaults both to true so a therapy whose therapist has no matching
 * row (the SafeStories platform calendar) is not silently dropped.
 */
app.get('/api/admin/pricing/therapies', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id            AS service_id,
        s.title,
        s.therapist_id,
        s.therapist_name,
        s.is_active,
        s.is_payment_enabled,
        s.charges       AS legacy_charges,
        cur.amount      AS current_amount,
        cur.effective_from AS current_since,
        nxt.id          AS next_id,
        nxt.amount      AS next_amount,
        nxt.effective_from AS next_effective_from,
        nxt.grandfather_existing AS next_grandfathers,
        COALESCE(lk.locked_clients, 0) AS locked_clients,
        COALESCE(ov.override_count, 0) AS override_count
      FROM therapy_services s
      LEFT JOIN therapists th ON th.therapist_id = s.therapist_id
      LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = s.therapist_id
      LEFT JOIN LATERAL (
        SELECT amount, effective_from FROM therapy_price_schedule
         WHERE service_id = s.id AND revoked_at IS NULL AND effective_from <= NOW()
         ORDER BY effective_from DESC, id DESC LIMIT 1
      ) cur ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, amount, effective_from, grandfather_existing FROM therapy_price_schedule
         WHERE service_id = s.id AND revoked_at IS NULL AND effective_from > NOW()
         ORDER BY effective_from ASC, id ASC LIMIT 1
      ) nxt ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS locked_clients FROM client_price_lock
         WHERE service_id = s.id AND released_at IS NULL
      ) lk ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS override_count FROM client_price_override
         WHERE service_id = s.id AND revoked_at IS NULL
      ) ov ON TRUE
      WHERE COALESCE(s.is_active, true) = true
        AND COALESCE(th.is_active, true) = true
        AND COALESCE(u.is_active, true) = true
      ORDER BY s.therapist_name ASC, s.title ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error listing pricing therapies:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/admin/pricing/schedule/:serviceId — full price history for one therapy. */
app.get('/api/admin/pricing/schedule/:serviceId', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, amount, effective_from, grandfather_existing, note, created_by, created_at, revoked_at
         FROM therapy_price_schedule
        WHERE service_id = $1
        ORDER BY effective_from DESC, id DESC`,
      [req.params.serviceId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching price schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/pricing/schedule — set a new price from a given date.
 * Body: { service_id, amount, effective_from: 'YYYY-MM-DD', grandfather_existing, note }
 */
app.post('/api/admin/pricing/schedule', requireSuperAdmin, async (req, res) => {
  try {
    const { service_id, amount, effective_from, grandfather_existing = true, note } = req.body || {};

    const amt = Number(amount);
    if (!service_id || !Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: 'service_id and a non-negative amount are required' });
    }
    if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
      return res.status(400).json({ error: 'effective_from must be a YYYY-MM-DD date' });
    }

    const svc = await pool.query('SELECT id, title FROM therapy_services WHERE id = $1', [service_id]);
    if (svc.rows.length === 0) return res.status(404).json({ error: 'Therapy not found' });

    // The admin picks a calendar date; they mean IST midnight, not the server's
    // idea of midnight. Pinning the offset here keeps a change from landing 5.5
    // hours early or late if this ever runs outside IST.
    const effectiveTs = istDateToTimestamp(effective_from);

    const { rows } = await pool.query(
      `INSERT INTO therapy_price_schedule
         (service_id, amount, effective_from, grandfather_existing, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (service_id, effective_from) WHERE revoked_at IS NULL
       DO UPDATE SET amount = EXCLUDED.amount,
                     grandfather_existing = EXCLUDED.grandfather_existing,
                     note = EXCLUDED.note,
                     created_by = EXCLUDED.created_by,
                     created_at = NOW()
       RETURNING *`,
      [service_id, amt, effectiveTs, grandfather_existing !== false, note || null, (req as any).user?.username || 'admin']
    );

    // Keep the legacy column in step with whatever is now in force. A
    // future-dated change must NOT move it yet, which syncLegacyCharges handles
    // by re-resolving rather than writing the submitted amount blindly.
    await syncLegacyCharges(pool, Number(service_id));

    res.json({ success: true, schedule: rows[0] });
  } catch (error: any) {
    console.error('Error creating price schedule:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/** POST /api/admin/pricing/schedule/:id/revoke — cancel a price change. */
app.post('/api/admin/pricing/schedule/:id/revoke', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE therapy_price_schedule
          SET revoked_at = NOW(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING *`,
      [req.params.id, (req as any).user?.username || 'admin']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Price change not found or already revoked' });

    // Revoking a change that had ALREADY taken effect rolls the price back to
    // the previous row, so the displayed figure has to follow it back down.
    await syncLegacyCharges(pool, Number(rows[0].service_id));

    res.json({ success: true, schedule: rows[0] });
  } catch (error) {
    console.error('Error revoking price schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/pricing/impact?service_id=&amount=
 * What a proposed change would actually do, before it is saved.
 */
app.get('/api/admin/pricing/impact', requireSuperAdmin, async (req, res) => {
  try {
    const serviceId = Number(req.query.service_id);
    const amount = Number(req.query.amount);
    if (!serviceId) return res.status(400).json({ error: 'service_id is required' });

    const cur = await resolvePrice(pool, { serviceId });
    const locked = await pool.query(
      `SELECT COUNT(*)::int AS n FROM client_price_lock
        WHERE service_id = $1 AND released_at IS NULL`,
      [serviceId]
    );
    const overrides = await pool.query(
      `SELECT COUNT(*)::int AS n FROM client_price_override
        WHERE revoked_at IS NULL AND (service_id = $1 OR service_id IS NULL)`,
      [serviceId]
    );

    res.json({
      current_amount: cur.amount,
      proposed_amount: Number.isFinite(amount) ? amount : null,
      grandfathered_clients: locked.rows[0].n,
      overridden_clients: overrides.rows[0].n,
    });
  } catch (error) {
    console.error('Error computing pricing impact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/pricing/clients?search=
 * Client picker for per-client pricing. Sourced from bookings, which is the
 * real client record here — all_clients_table is not written by the booking
 * flow and would miss most people.
 */
app.get('/api/admin/pricing/clients', requireSuperAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT
         LOWER(TRIM(invitee_email)) AS email,
         NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(invitee_phone, ''), '[^0-9]', '', 'g'), 10), '') AS phone_digits,
         MAX(invitee_name)  AS name,
         COUNT(*)::int      AS bookings,
         MAX(booking_host_name) AS last_therapist
       FROM bookings
       WHERE invitee_email IS NOT NULL AND TRIM(invitee_email) <> ''
         AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
         AND ($1 = '' OR LOWER(invitee_email) LIKE '%' || $1 || '%'
                      OR LOWER(COALESCE(invitee_name, '')) LIKE '%' || $1 || '%'
                      OR REGEXP_REPLACE(COALESCE(invitee_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1 || '%')
       GROUP BY 1, 2
       ORDER BY bookings DESC, name ASC
       LIMIT 50`,
      [search]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error searching pricing clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/pricing/client-context?email=&phone=
 *
 * Everything the Client Pricing dialog needs about one client, so the admin is
 * not setting a price blind: which therapies this client actually books, what
 * each of them costs THEM right now, whether they count as existing or new for
 * that therapy, and any custom price already in force.
 *
 * Therapies are drawn from the client's own booking history rather than the
 * full catalogue — a per-client price is only meaningful for a therapy they
 * use. Deactivated therapies and therapists are excluded, matching the tab.
 */
app.get('/api/admin/pricing/client-context', requireSuperAdmin, async (req, res) => {
  try {
    const email = normalizeEmail(String(req.query.email || ''));
    const phone = normalizePhoneDigits(String(req.query.phone || ''));
    if (!email && !phone) {
      return res.status(400).json({ error: 'email or phone is required' });
    }

    // Which therapies has this client actually booked, and how often.
    // service_id is NULL on bookings the migration could not map unambiguously
    // (see migrations/2026-08-06_pricing_engine.sql) — those are skipped rather
    // than guessed at.
    const { rows: history } = await pool.query(
      `SELECT b.service_id,
              COUNT(*)::int                AS bookings,
              MAX(b.invitee_created_at)    AS last_booked,
              s.title, s.therapist_name
         FROM bookings b
         JOIN therapy_services s ON s.id = b.service_id
         LEFT JOIN therapists th ON th.therapist_id = s.therapist_id
         LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = s.therapist_id
        WHERE b.service_id IS NOT NULL
          AND b.booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
          AND COALESCE(s.is_active, true) = true
          AND COALESCE(s.is_payment_enabled, true) = true
          AND COALESCE(th.is_active, true) = true
          AND COALESCE(u.is_active, true) = true
          AND ( ($1::text IS NOT NULL AND LOWER(b.invitee_email) = $1::text)
             OR ($2::text IS NOT NULL AND RIGHT(REGEXP_REPLACE(COALESCE(b.invitee_phone, ''), '[^0-9]', '', 'g'), 10) = $2::text) )
        GROUP BY b.service_id, s.title, s.therapist_name
        ORDER BY bookings DESC`,
      [email, phone]
    );

    const therapies = [];
    for (const h of history) {
      const price = await resolvePrice(pool, {
        serviceId: h.service_id,
        clientEmail: email,
        clientPhone: phone,
      });

      const { rows: ovr } = await pool.query(
        `SELECT id, amount, reason, effective_until, created_by, created_at
           FROM client_price_override
          WHERE revoked_at IS NULL
            AND (service_id = $1 OR service_id IS NULL)
            AND ( ($2::text IS NOT NULL AND client_email = $2::text)
               OR ($3::text IS NOT NULL AND client_phone_digits = $3::text) )
          ORDER BY (service_id IS NOT NULL) DESC, created_at DESC
          LIMIT 1`,
        [h.service_id, email, phone]
      );

      therapies.push({
        service_id: h.service_id,
        title: h.title,
        therapist_name: h.therapist_name,
        bookings: h.bookings,
        last_booked: h.last_booked,
        amount: price.amount,
        list_amount: price.listAmount,
        price_source: price.source,
        // 'lock' is the grandfathered rate, which only an existing client has.
        is_existing_client: price.source === 'lock',
        // Null unless a custom price is actually set — nothing is shown for it
        // in the dialog otherwise.
        existing_override: ovr.length > 0 ? ovr[0] : null,
      });
    }

    res.json({
      is_existing_client: history.length > 0,
      total_bookings: history.reduce((n, h) => n + h.bookings, 0),
      therapies,
    });
  } catch (error) {
    console.error('Error fetching client pricing context:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /api/admin/pricing/overrides — all active per-client prices. */
app.get('/api/admin/pricing/overrides', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, s.title AS service_title, s.therapist_name
         FROM client_price_override o
         LEFT JOIN therapy_services s ON s.id = o.service_id
        WHERE o.revoked_at IS NULL
        ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing price overrides:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/pricing/overrides — set a price for one or many clients.
 * Body: { clients: [{ email, phone_digits, name }], service_id | null, amount, reason, effective_until }
 *
 * All-or-nothing: a partial apply across a batch of clients would leave the
 * admin with no way to tell who got the new price.
 */
app.post('/api/admin/pricing/overrides', requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { clients, service_id, amount, reason, effective_until } = req.body || {};
    const amt = Number(amount);

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(400).json({ error: 'At least one client is required' });
    }
    if (!Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: 'A non-negative amount is required' });
    }

    const createdBy = (req as any).user?.username || 'admin';
    await client.query('BEGIN');

    const created: any[] = [];
    for (const c of clients) {
      const email = normalizeEmail(c?.email);
      const phone = normalizePhoneDigits(c?.phone_digits || c?.phone);
      if (!email && !phone) continue;

      // One active override per client per therapy. Re-applying replaces the
      // old figure rather than stacking a second rule the resolver would have
      // to arbitrate between.
      await client.query(
        `UPDATE client_price_override
            SET revoked_at = NOW(), revoked_by = $1
          WHERE revoked_at IS NULL
            AND service_id IS NOT DISTINCT FROM $2
            AND ( ($3::text IS NOT NULL AND client_email = $3::text)
               OR ($4::text IS NOT NULL AND client_phone_digits = $4::text) )`,
        [createdBy, service_id || null, email, phone]
      );

      const { rows } = await client.query(
        `INSERT INTO client_price_override
           (client_email, client_phone_digits, client_name, service_id, amount, reason, effective_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [email, phone, c?.name || null, service_id || null, amt, reason || null, effective_until || null, createdBy]
      );
      created.push(rows[0]);
    }

    await client.query('COMMIT');
    res.json({ success: true, created: created.length, overrides: created });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating price overrides:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

/** POST /api/admin/pricing/overrides/:id/revoke */
app.post('/api/admin/pricing/overrides/:id/revoke', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE client_price_override
          SET revoked_at = NOW(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING *`,
      [req.params.id, (req as any).user?.username || 'admin']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Override not found or already revoked' });
    res.json({ success: true, override: rows[0] });
  } catch (error) {
    console.error('Error revoking price override:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/pricing/locks?service_id=
 * Who is grandfathered on this therapy, and at what rate.
 */
app.get('/api/admin/pricing/locks', requireSuperAdmin, async (req, res) => {
  try {
    const serviceId = req.query.service_id ? Number(req.query.service_id) : null;
    const { rows } = await pool.query(
      `SELECT l.id, l.client_email, l.client_phone_digits, l.service_id, l.locked_amount,
              l.source, l.locked_at, s.title AS service_title, s.therapist_name
         FROM client_price_lock l
         LEFT JOIN therapy_services s ON s.id = l.service_id
        WHERE l.released_at IS NULL
          AND ($1::int IS NULL OR l.service_id = $1::int)
        ORDER BY l.locked_at DESC
        LIMIT 500`,
      [serviceId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing price locks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/admin/pricing/locks/:id/release — move one client onto list price. */
app.post('/api/admin/pricing/locks/:id/release', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE client_price_lock
          SET released_at = NOW(), released_by = $2
        WHERE id = $1 AND released_at IS NULL
        RETURNING *`,
      [req.params.id, (req as any).user?.username || 'admin']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lock not found or already released' });
    res.json({ success: true, lock: rows[0] });
  } catch (error) {
    console.error('Error releasing price lock:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET payment settings
// GET /api/payment-settings (Admin)
app.get('/api/payment-settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0) {
      return res.json({ settings: {} });
    }
    res.json({ settings: rows[0] });
  } catch (error) {
    console.error('Error fetching payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payment-settings (Admin)
app.post('/api/payment-settings', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { settings } = req.body;
    const check = await pool.query('SELECT COUNT(*) FROM payment_settings');
    if (parseInt(check.rows[0].count) === 0) {
      await pool.query(
        'INSERT INTO payment_settings (active_gateway, razorpay_key_id, razorpay_key_secret) VALUES ($1, $2, $3)',
        ['razorpay', settings.razorpay_key_id, settings.razorpay_key_secret]
      );
    } else {
      await pool.query(
        'UPDATE payment_settings SET active_gateway = $1, razorpay_key_id = $2, razorpay_key_secret = $3',
        ['razorpay', settings.razorpay_key_id, settings.razorpay_key_secret]
      );
    }
    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ORGANIZATION SETTINGS ====================
// Stored as rows in the existing admin_settings key/value table (PK on
// setting_key), so no schema migration is needed. That table also holds the
// payment keys, which is exactly why writes below are restricted to an explicit
// allowlist — an unfiltered upsert here would let this endpoint overwrite
// razorpay_key_id / active_gateway.
const ORG_SETTING_KEYS = [
  'org_name',
  'org_logo_url',
  'org_support_email',
  'org_support_phone',
  'org_address',
  'org_website',
  'org_timezone',
  'org_gstin',
] as const;

// GET /api/org-settings
// Organisation configuration. The matching POST was already restricted.
app.get('/api/org-settings', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT setting_key, setting_value FROM admin_settings WHERE setting_key = ANY($1)`,
      [ORG_SETTING_KEYS]
    );
    const settings: Record<string, string> = {};
    for (const key of ORG_SETTING_KEYS) settings[key] = '';
    for (const row of rows) settings[row.setting_key] = row.setting_value ?? '';
    res.json({ settings });
  } catch (error) {
    console.error('Error fetching org settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/org-settings (Admin)
app.post('/api/org-settings', requireSuperAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required' });
    }

    const updates = ORG_SETTING_KEYS.filter(key => settings[key] !== undefined);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No recognised organization settings supplied' });
    }

    for (const key of updates) {
      await pool.query(
        `INSERT INTO admin_settings (setting_key, setting_value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
        [key, String(settings[key] ?? '')]
      );
    }

    res.json({ message: 'Organization settings saved successfully', updated: updates });
  } catch (error) {
    console.error('Error saving org settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * POST /api/razorpay/create-order
 *
 * The amount is resolved SERVER-SIDE and is never taken from the request body.
 *
 * This endpoint previously did `const { amount } = req.body` and created the
 * Razorpay order for whatever number arrived, while verify-payment checked only
 * the HMAC signature and never the amount. A modified request could therefore
 * book a ₹3000 session for ₹1 and it would confirm cleanly through the whole
 * pipeline. Callers now identify WHAT is being paid for, not HOW MUCH:
 *
 *   { slug | serviceId, email, phone }  — public booking page
 *   { bookingId }                       — admin payment link, amount already
 *                                         pinned on the booking row by an
 *                                         authenticated admin
 */
app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { slug, serviceId, email, phone, bookingId } = req.body || {};

    let amount: number;
    let priceMeta: { source: string; serviceId: number | null } = { source: 'booking', serviceId: null };

    if (bookingId) {
      // Admin payment-link path: the admin already set and stored the amount.
      const bRes = await pool.query(
        `SELECT invitee_payment_amount, service_id, booking_status
           FROM bookings WHERE booking_id = $1 LIMIT 1`,
        [bookingId]
      );
      if (bRes.rows.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }
      amount = Number(bRes.rows[0].invitee_payment_amount || 0);
      priceMeta = { source: 'booking', serviceId: bRes.rows[0].service_id ?? null };
    } else if (slug || serviceId) {
      const price = await resolvePrice(pool, {
        serviceId: serviceId ? Number(serviceId) : null,
        slug: slug || null,
        clientEmail: email,
        clientPhone: phone,
      });
      amount = price.amount;
      priceMeta = { source: price.source, serviceId: price.serviceId };
      logPriceResolution(pool, price, { context: 'order', clientEmail: email, clientPhone: phone })
        .catch(() => {});
    } else {
      return res.status(400).json({ error: 'slug, serviceId or bookingId is required' });
    }

    if (!(amount > 0)) {
      return res.status(400).json({ error: 'This session has no payable amount.' });
    }

    const { rows } = await pool.query('SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0 || !rows[0].razorpay_key_id || !rows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Razorpay API keys are not configured in Admin Settings.' });
    }

    const { razorpay_key_id, razorpay_key_secret } = rows[0];

    const razorpay = new Razorpay({
      key_id: razorpay_key_id,
      key_secret: razorpay_key_secret,
    });

    const options = {
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: 'receipt_' + Date.now()
    };

    const order = await razorpay.orders.create(options);

    if (!order) {
      return res.status(500).json({ error: 'Failed to create order with Razorpay' });
    }

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      // Rupees, for the client to display. order.amount is in paise.
      resolved_amount: amount,
      price_source: priceMeta.source,
      service_id: priceMeta.serviceId,
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: error.message || 'Error communicating with Razorpay' });
  }
});

// Called by frontend payment.failed event to mark a pending booking as failed immediately
// (rather than waiting for the 15-min cron) when a Razorpay payment attempt fails.
app.post('/api/mark-payment-failed', async (req, res) => {
  try {
    const { bookingId, razorpayPaymentId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });
    await pool.query(
      `UPDATE bookings
       SET payment_status = 'Failed', payment_id = COALESCE($1, payment_id), booking_updated_at = NOW()
       WHERE booking_id = $2 AND booking_status = 'payment_pending'`,
      [razorpayPaymentId || null, bookingId]
    );
    await pool.query(
      `UPDATE payments
       SET failure_reason = 'Failed during frontend checkout', updated_at = NOW()
       WHERE booking_id = $1`,
      [bookingId]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error marking payment failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Verify Razorpay HMAC signature and confirm a pending booking.
// Called by the frontend after Razorpay's success handler fires.

// Helper function to process successful payments
// Enforce one-therapist-per-client (#4).
// A client's current therapist is the therapist of their most recent active
// (non-cancelled, non-failed) booking, excluding SafeStories free consultations.
// Booking with a different therapist is blocked — admins should use the
// Transfer Client feature to change a client's therapist (transfers rewrite
// past bookings to the new therapist, so this check stays consistent).
// Conservative by design: when in doubt (no match / missing data), it allows.
async function checkExistingTherapistConflict(
  clientEmail?: string | null,
  clientPhone?: string | null,
  newTherapistId?: string | null,
  newTherapistName?: string | null
): Promise<{ existingTherapistName: string; existingTherapistId: string | null } | null> {
  try {
    // Free consultations (platform calendar) never bind a client to a therapist
    // and are never blocked.
    if (!newTherapistName || newTherapistName === 'Unknown Therapist') return null;
    if (newTherapistName === 'SafeStories' || newTherapistId === 'SafeStories') return null;

    const e = (clientEmail || '').trim();
    const p = (clientPhone || '').trim();
    if (!e && !p) return null;

    const res = await pool.query(
      `SELECT therapist_id, booking_host_name, invitee_created_at FROM bookings
       WHERE (($1 <> '' AND LOWER(invitee_email) = LOWER($1))
           OR ($2 <> '' AND invitee_phone = $2))
         AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
         AND COALESCE(therapist_id, '') <> 'SafeStories'
         AND COALESCE(booking_host_name, '') NOT ILIKE 'safestories%'
         AND COALESCE(booking_resource_name, '') NOT ILIKE '%free consultation%'
       ORDER BY invitee_created_at DESC NULLS LAST
       LIMIT 1`,
      [e, p]
    );
    
    const transferRes = await pool.query(
      `SELECT to_therapist_id, to_therapist_name, transfer_date FROM client_transfer_history
       WHERE (($1 <> '' AND LOWER(client_email) = LOWER($1))
           OR ($2 <> '' AND client_phone = $2))
       ORDER BY transfer_date DESC LIMIT 1`,
      [e, p]
    );

    const existing = res.rows.length > 0 ? res.rows[0] : null;
    const transfer = transferRes.rows.length > 0 ? transferRes.rows[0] : null;

    if (!existing && !transfer) return null;

    let currentTherapistId = null;
    let currentTherapistName = null;

    if (transfer && existing) {
       const transferDate = new Date(transfer.transfer_date);
       const bookingDate = new Date(existing.invitee_created_at || 0);
       if (transferDate > bookingDate) {
          currentTherapistId = transfer.to_therapist_id;
          currentTherapistName = transfer.to_therapist_name;
       } else {
          currentTherapistId = existing.therapist_id;
          currentTherapistName = existing.booking_host_name;
       }
    } else if (transfer) {
       currentTherapistId = transfer.to_therapist_id;
       currentTherapistName = transfer.to_therapist_name;
    } else {
       currentTherapistId = existing.therapist_id;
       currentTherapistName = existing.booking_host_name;
    }

    const sameId = newTherapistId && currentTherapistId &&
      String(newTherapistId) === String(currentTherapistId);
    const sameName = newTherapistName && currentTherapistName &&
      currentTherapistName.toLowerCase().trim() === newTherapistName.toLowerCase().trim();
    if (sameId || sameName) return null;

    return {
      existingTherapistName: currentTherapistName || 'their current therapist',
      existingTherapistId: currentTherapistId || null,
    };
  } catch (err) {
    // Never block bookings because the check itself failed — log and allow.
    console.error('[checkExistingTherapistConflict] failed (allowing booking):', err);
    return null;
  }
}

// ── Typo guard for contact reconciliation ──
// Prevents a fat-fingered email domain (gnail.com, hotmial.com, …) on the
// newest booking from overwriting a known-good provider domain everywhere.
const COMMON_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'rediffmail.com', 'yahoo.in', 'live.com'];

function emailEditDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function isSuspiciousEmailTypo(newEmail: string, existingEmail: string): boolean {
  const nd = (newEmail.toLowerCase().split('@')[1] || '');
  const ed = (existingEmail.toLowerCase().split('@')[1] || '');
  const nl = (newEmail.toLowerCase().split('@')[0] || '');
  const el = (existingEmail.toLowerCase().split('@')[0] || '');
  // Same mailbox name, the old domain is a genuine provider, and the new one
  // is a near-miss of a genuine provider → almost certainly a typo.
  return nl === el &&
    COMMON_EMAIL_DOMAINS.includes(ed) &&
    !COMMON_EMAIL_DOMAINS.includes(nd) &&
    COMMON_EMAIL_DOMAINS.some(cd => emailEditDistance(nd, cd) <= 2);
}

// Reconcile a client's contact info across their bookings (#8).
// If the same email books with a new phone (or same phone with a new email),
// propagate the newest value to all of that client's records so the dashboard
// shows the latest contact info, not a stale one.
async function reconcileClientContact(email?: string | null, phone?: string | null) {
  try {
    const e = (email || '').trim();
    const p = (phone || '').trim();
    if (e && p) {
      // Wallet credit is keyed on the normalised phone (see lib/wallet.ts). This
      // function is about to rewrite invitee_phone across this client's bookings,
      // which would move the wallet key out from under any balance they hold and
      // orphan it. Capture the phones we are about to replace so the ledger can
      // follow the client.
      const priorPhonesRes = await pool.query(
        `SELECT DISTINCT invitee_phone FROM bookings
         WHERE LOWER(invitee_email) = LOWER($1)
           AND COALESCE(invitee_phone, '') <> ''
           AND COALESCE(invitee_phone, '') <> $2`,
        [e, p]
      );

      // Same email → push the latest phone onto all of this client's bookings.
      await pool.query(
        `UPDATE bookings SET invitee_phone = $1
         WHERE LOWER(invitee_email) = LOWER($2)
           AND COALESCE(invitee_phone, '') <> $1`,
        [p, e]
      );

      for (const row of priorPhonesRes.rows) {
        try {
          await remapClientKey(row.invitee_phone, e, p, e);
        } catch (remapErr: any) {
          console.error('[reconcileClientContact] Wallet remap failed (non-fatal):', remapErr?.message || remapErr);
        }
      }

      // Same phone → push the latest email onto all of this client's bookings,
      // unless the new email looks like a typo of the one already on record.
      const existingRes = await pool.query(
        `SELECT invitee_email FROM bookings
         WHERE invitee_phone = $1 AND COALESCE(invitee_email, '') <> ''
           AND LOWER(invitee_email) <> LOWER($2)
         ORDER BY invitee_created_at DESC NULLS LAST LIMIT 1`,
        [p, e]
      );
      const existingEmail = existingRes.rows[0]?.invitee_email || '';
      if (existingEmail && isSuspiciousEmailTypo(e, existingEmail)) {
        console.warn(`[reconcileClientContact] Skipping email propagation: "${e}" looks like a typo of "${existingEmail}"`);
        return;
      }
      await pool.query(
        `UPDATE bookings SET invitee_email = $1
         WHERE invitee_phone = $2
           AND COALESCE(LOWER(invitee_email), '') <> LOWER($1)`,
        [e, p]
      );
    }
  } catch (err) {
    console.error('[reconcileClientContact] failed (non-fatal):', err);
  }
}

async function processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload, paymentInfo = null) {
  const client = await pool.connect();

  try {
    // Start transaction for all database updates
    await client.query('BEGIN');

    // Atomic claim: exactly one confirmation path may proceed. This conditional UPDATE
    // row-locks the booking; any concurrent caller (the Razorpay webhook and the browser
    // verify-payment racing, a webhook retry, or the pending-payment cron) will match 0 rows
    // once the winner commits, and returns here without creating a duplicate Google Calendar
    // event. Replaces the old check-then-act on a stale, unlocked booking object.
    const claim = await client.query(
      `UPDATE bookings SET booking_status = 'confirmed'
       WHERE booking_id = $1
         AND booking_status IN ('payment_pending', 'waiting_for_payment')
       RETURNING google_event_id`,
      [bookingId]
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log(`[processConfirmedBooking] Booking ${bookingId} already confirmed by another path — skipping to avoid a duplicate event.`);
      return; // finally{} releases the client; nothing below this runs for the loser
    }
    // Freshly locked event id — use this instead of the stale passed-in booking object.
    const claimedEventId = claim.rows[0].google_event_id;

    // 3. Resolve therapist (for Google Calendar)
    const therapistName = payload.therapistName || booking.booking_host_name || 'Unknown Therapist';
    let therapistId = payload.therapistId || booking.therapist_id || null;
    let therapist = null;
    if (therapistName !== 'SafeStories' && therapistName !== 'Unknown Therapist') {
      const qParam = therapistId ? therapistId : `%${therapistName.split(' ')[0]}%`;
      const qStr = therapistId
        ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
        : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
      const tRes = await client.query(qStr, [qParam]);
      if (tRes.rows.length > 0) { therapist = tRes.rows[0]; therapistId = therapist.therapist_id; }
    }

  // 4. Build time strings from stored booking dates
  const { randomUUID } = require('crypto');
  const startAt = new Date(booking.booking_start_at);
  const endAt   = new Date(booking.booking_end_at);
  const formatTime = (d) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
  });
  const dayName   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: 'Asia/Kolkata' });
  const monthName = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: 'Asia/Kolkata' });
  const dateNum   = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: 'Asia/Kolkata' });
  const yearNum   = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: 'Asia/Kolkata' });
  const startTimeStr = formatTime(startAt);
  const endTimeStr   = formatTime(endAt);
  const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${startTimeStr} - ${endTimeStr} IST`;

  const clientTz = payload.clientTimezone || payload.timezone || 'Asia/Kolkata';
  const fmtClient = (d) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz
  });
  const cDay   = startAt.toLocaleDateString('en-US', { weekday: 'long',   timeZone: clientTz });
  const cMonth = startAt.toLocaleDateString('en-US', { month:   'short',  timeZone: clientTz });
  const cDate  = startAt.toLocaleDateString('en-US', { day:     'numeric',timeZone: clientTz });
  const cYear  = startAt.toLocaleDateString('en-US', { year:    'numeric',timeZone: clientTz });
  let tzShort = 'IST';
  if (clientTz !== 'Asia/Kolkata') {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startAt);
      tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
    } catch { tzShort = clientTz; }
  }
  const inviteeTime = `${cDay}, ${cMonth} ${cDate}, ${cYear} at ${fmtClient(startAt)} - ${fmtClient(endAt)} ${tzShort}`;

  // Masked email for the therapist's calendar — generate/reuse; never the real email.
  const maskedEmail = await resolveMaskedEmail(client, booking.mask_id, payload.clientEmail || booking.invitee_email);

  // 5. Create Google Calendar event (best-effort)
  let hasCalendar = false;
  let meetLink = '';
  let google_event_id = null;
  if (therapist && therapist.google_refresh_token && !claimedEventId) {
    try {
      const oauth2Client = await getAuthenticatedClient(therapist);
      const { google } = require('googleapis');
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const isOnline = (payload.sessionMode || '') === 'online' ||
                       booking.booking_mode?.toLowerCase().includes('online');
      const ev = await insertClientCalendarEvent(calendar, {
        therapyLabel: payload.therapyName || booking.booking_resource_name,
        clientName: payload.clientName || booking.invitee_name,
        mode: payload.sessionMode || 'online',
        notes: payload.notes || 'None',
        maskedEmail,
        startISO: startAt.toISOString(),
        endISO: endAt.toISOString(),
        isOnline,
        location: 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv'
      });
      google_event_id = ev.eventId;
      if (isOnline) meetLink = ev.meetLink;
      hasCalendar = true;
    } catch (calErr) {
      console.error('[verify-payment] Google Calendar event creation failed:', calErr);
    }
  }

  // 6. Update booking: confirmed + payment info
  const joinLink = (hasCalendar && (payload.sessionMode === 'online' || booking.booking_mode?.toLowerCase().includes('online')))
    ? meetLink : (booking.booking_joining_link || null);

  // Authoritative captured amount from Razorpay (paise → rupees), falling back to stored amount.
  const capturedAmount = paymentInfo && paymentInfo.amount != null
    ? Number(paymentInfo.amount) / 100
    : Math.round(Number(booking.invitee_payment_amount || payload.amount || 0));
  // Razorpay payment creation timestamp (unix seconds → JS Date), falling back to now.
  const paidAt = paymentInfo && paymentInfo.created_at
    ? new Date(Number(paymentInfo.created_at) * 1000)
    : new Date();

  // Update bookings table (critical - must succeed or roll back)
  await client.query(
    `UPDATE bookings
     SET booking_status = 'confirmed', payment_status = 'Paid',
         payment_id = $1, invitee_payment_gateway = 'Razorpay', razorpay_order_id = $2,
         booking_joining_link = $3, google_event_id = $4,
         booking_invitee_time = $5, booking_host_time = $6,
         invitee_payment_amount = $7,
         booking_updated_at = NOW()
     WHERE booking_id = $8`,
    [razorpayPaymentId, razorpayOrderId, joinLink, google_event_id || claimedEventId,
     inviteeTime, hostTime, capturedAmount, bookingId]
  );

  // Update payments table with deep Razorpay info if available (critical - must succeed or roll back)
  if (paymentInfo) {
    const pMode = paymentInfo.method || null;
    const utr = paymentInfo.acquirer_data?.utr || paymentInfo.acquirer_data?.rrn || null;
    const custEmail = paymentInfo.email || null;
    const custPhone = paymentInfo.contact || null;
    await client.query(
      `UPDATE payments
       SET razorpay_payment_id = $1,
           razorpay_order_id = COALESCE($2, razorpay_order_id),
           amount = $3,
           payment_date = $4,
           payment_mode = $5,
           utr = $6,
           customer_details = $7,
           updated_at = NOW()
       WHERE razorpay_order_id = $2 OR booking_id = $8`,
      [
        razorpayPaymentId,
        razorpayOrderId,
        capturedAmount,
        paidAt,
        pMode,
        utr,
        JSON.stringify({ email: custEmail, phone: custPhone, full_response: paymentInfo }),
        bookingId
      ]
    );
  } else {
    // Basic update if no deep info
    await client.query(
      `UPDATE payments SET razorpay_payment_id = $1,
           razorpay_order_id = COALESCE($2, razorpay_order_id),
           amount = COALESCE(NULLIF($3, 0), amount),
           payment_date = COALESCE(payment_date, $4),
           updated_at = NOW()
       WHERE razorpay_order_id = $2 OR booking_id = $5`,
      [razorpayPaymentId, razorpayOrderId, capturedAmount, paidAt, bookingId]
    );
  }

  const clientName  = payload.clientName  || booking.invitee_name;
  const clientEmail = payload.clientEmail || booking.invitee_email;
  const clientPhone = payload.clientWhatsApp || booking.invitee_phone;
  const therapyName = payload.therapyName  || booking.booking_resource_name;
  const sessionMode = payload.sessionMode  || 'online';
  const checkinUrl  = booking.public_booking_checkin_url;
  // Authoritative mode for the confirmation email: prefer the stored booking_mode
  // (set from the client's original selection at booking time). Only fall back to
  // the request payload's sessionMode when the stored mode is missing.
  const isOnlineForEmail = booking.booking_mode
    ? /online|meet|video/i.test(booking.booking_mode)
    : (payload.sessionMode === 'online');
  // Duration shown in the email is derived from the same start/end instants that
  // build the Google Calendar event, so it always matches the calendar (15 min for
  // free consultations, 50 for therapy sessions). Falls back to 50 only if the
  // stored times are missing/invalid.
  const emailDurationMinutes = (() => {
    const d = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    return Number.isFinite(d) && d > 0 ? d : 50;
  })();

    // 7. Send confirmation emails and log (best-effort, but log within transaction)
    try {
      await sendClientBookingConfirmationEmail(clientEmail, {
        clientName,
        inviteeTimeStr: inviteeTime,
        sessionName: therapyName,
        dateStr: `${dayName}, ${monthName} ${dateNum}, ${yearNum}`,
        timeRangeStr: `${startTimeStr} - ${endTimeStr}`,
        duration: emailDurationMinutes,
        joinLink: hasCalendar ? meetLink : sessionMode,
        isOnline: isOnlineForEmail,
        checkinUrl,
        calendarStartRaw: startAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
        calendarEndRaw:   endAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
      });
      await client.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
        [bookingId, 'client_confirmation_email', clientEmail, 'success', JSON.stringify({ sent: true })]
      );
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@safestories.in';
      await sendAdminBookingConfirmationEmail(adminEmail, {
        clientName, clientPhone, clientEmail,
        sessionName: therapyName, sessionTiming: hostTime, sessionMode: sessionMode,
        therapistName, therapistEmail: therapist?.contact_info || 'Not available'
      });

      // Notify the therapist of the confirmed session (best-effort; only if we have their email)
      const therapistEmailAddr = therapist?.contact_info;
      if (therapistEmailAddr) {
        // Meet link: prefer the freshly-generated one, else the link already stored on the
        // booking. Most online bookings arrive from DaySchedule with booking_joining_link
        // already set and no regenerated meetLink, so the stored link is the reliable source.
        // Only attach a link for online sessions (authoritative check via booking_mode).
        const therapistMeetLink = isOnlineForEmail
          ? (meetLink || booking.booking_joining_link || undefined)
          : undefined;
        await sendTherapistBookingConfirmationEmail(therapistEmailAddr, {
          therapistName: therapist?.name || therapistName,
          clientName,
          sessionName: therapyName,
          sessionTiming: hostTime,
          isOnline: isOnlineForEmail,
          meetLink: therapistMeetLink,
        });
        await client.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
           VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
          [bookingId, 'therapist_confirmation_email', therapistEmailAddr, 'success', JSON.stringify({ sent: true })]
        );
      } else {
        console.warn(`[verify-payment] No therapist email for booking ${bookingId}; skipped therapist confirmation email.`);
      }
    } catch (emailErr) {
      console.error('[verify-payment] Email send failed:', emailErr);
    }

    // 8. Send WhatsApp confirmation and log (best-effort, but log within transaction)
    try {
      const { sendBookingConfirmedClient } = await import('./automations/whatsapp.js');
      await sendBookingConfirmedClient(bookingId, clientPhone, clientName, therapyName, inviteeTime, checkinUrl);
      await client.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
        [bookingId, 'client_confirmation_whatsapp', clientPhone, 'success', JSON.stringify({ sent: true })]
      );
    } catch (waErr: any) {
      console.error('[verify-payment] WhatsApp send failed:', waErr?.message || waErr);
      try {
        await client.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at)
           VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)`,
          [bookingId, 'client_confirmation_whatsapp', clientPhone, 'failed', waErr?.message || String(waErr)]
        );
      } catch (logErr) {
        console.error('[verify-payment] Failed to log WhatsApp error:', logErr);
      }
    }

    // 9. Lock in this client's rate for this therapy.
    //
    // Runs inside the same transaction, and only for the winner of the atomic
    // claim above — so the webhook, the browser's verify-payment call, and the
    // pending-payment cron racing to confirm the same booking cannot produce
    // duplicate or conflicting locks.
    //
    // From here on this client keeps this price for this therapy, and a future
    // price rise reaches only people who have never booked it.
    try {
      const priced = await client.query(
        `SELECT service_id, invitee_payment_amount, invitee_email, invitee_phone, price_source
           FROM bookings WHERE booking_id = $1`,
        [bookingId]
      );
      const row = priced.rows[0];
      if (row?.service_id) {
        await recordPriceLock(client, {
          serviceId: row.service_id,
          clientEmail: row.invitee_email,
          clientPhone: row.invitee_phone,
          amount: Number(row.invitee_payment_amount || 0),
          bookingId,
          resolvedFrom: row.price_source,
        });
      }
    } catch (lockErr) {
      console.error('[processConfirmedBooking] price lock write failed (non-fatal):', lockErr);
    }

    // Commit transaction if all database operations succeed
    await client.query('COMMIT');
    console.log(`[verify-payment] ✅ Database transaction committed for booking ${bookingId}`);

  } catch (txErr) {
    // Rollback on any error
    try {
      await client.query('ROLLBACK');
      console.error(`[verify-payment] ❌ Transaction rolled back for booking ${bookingId}:`, txErr);
    } catch (rollbackErr) {
      console.error(`[verify-payment] ❌ Rollback failed:`, rollbackErr);
    }
    throw txErr;
  } finally {
    // Always release the client back to the pool
    client.release();
  }

  // 9. New-booking webhook for CRM pipeline movement (outside transaction, best-effort).
  // The handler lives on the CRM backend (port 3003), not this process.
  try {
    const crmBase = process.env.CRM_WEBHOOK_URL || 'http://localhost:3003';
    const whRes = await fetch(`${crmBase}/api/webhooks/new-booking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId })
    });
    if (!whRes.ok) {
      console.error(`[verify-payment] CRM new-booking webhook returned ${whRes.status} for booking ${bookingId}`);
    }
  } catch (e) {
    console.error('[verify-payment] CRM new-booking webhook failed:', e);
  }

  console.log(`[verify-payment] ✅ Booking ${bookingId} confirmed. Payment: ${razorpayPaymentId}`);
}

app.post('/api/razorpay/webhook', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Webhook secret not configured in .env');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const crypto = require('crypto');
  const razorpaySignature = req.headers['x-razorpay-signature'] as string;
  const rawBody = (req as any).rawBody;

  if (!rawBody) {
    console.error('No raw body available for webhook verification');
    return res.status(400).send('No raw body');
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody.toString('utf8'))
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    console.error('Invalid signature in Razorpay webhook');
    return res.status(400).send('Invalid signature');
  }

  try {
    const event = req.body.event;

    if (event === 'payment_link.paid') {
      const plinkEntity = req.body.payload.payment_link.entity;
      const paymentEntity = req.body.payload.payment.entity;
      const razorpayPaymentId = paymentEntity.id;
      const referenceId = plinkEntity.reference_id;
      
      if (!referenceId) {
        return res.status(400).send('No reference_id in payment_link payload');
      }

      const bookingCheck = await pool.query(
        `SELECT * FROM bookings WHERE booking_id = $1 AND booking_status IN ('payment_pending', 'waiting_for_payment')`,
        [referenceId]
      );

      if (bookingCheck.rows.length === 0) {
        console.log(`[Webhook] Booking for payment link reference ${referenceId} already processed or not pending.`);
        return res.status(200).send('OK');
      }

      const booking = bookingCheck.rows[0];
      const bookingId = booking.booking_id;

      await processConfirmedBooking(bookingId, razorpayPaymentId, plinkEntity.id, booking, {}, paymentEntity);
      console.log(`[Webhook] ✅ Successfully verified and confirmed payment link booking ${bookingId}`);

    } else if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = req.body.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      if (!razorpayOrderId) {
        return res.status(400).send('No order_id in webhook payload');
      }

      const bookingCheck = await pool.query(
        `SELECT * FROM bookings WHERE razorpay_order_id = $1 AND booking_status IN ('payment_pending', 'waiting_for_payment')`,
        [razorpayOrderId]
      );

      if (bookingCheck.rows.length === 0) {
        console.log(`[Webhook] Booking for order ${razorpayOrderId} already processed or not pending.`);
        return res.status(200).send('OK');
      }

      const booking = bookingCheck.rows[0];
      const bookingId = booking.booking_id;

      // Ensure we have deep payment details (Razorpay Webhook sends full payment entity!)
      const paymentInfo = paymentEntity;
      
      // We pass empty payload {} because frontend specific tracking isn't sent in webhook
      await processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, {}, paymentInfo);
      console.log(`[Webhook] ✅ Successfully verified and confirmed booking ${bookingId}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/razorpay/verify-payment', async (req, res) => {
  const { bookingId, razorpayPaymentId, razorpayOrderId, razorpaySignature, ...payload } = req.body;
  try {
    // 1. Check booking exists
    const bookingCheck = await pool.query(
      `SELECT * FROM bookings WHERE booking_id = $1`,
      [bookingId]
    );
    if (bookingCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Booking not found' });
    }
    const booking = bookingCheck.rows[0];

    // If the Webhook already processed this payment milliseconds ago, let the frontend succeed!
    if (booking.booking_status === 'confirmed' || booking.payment_status === 'Paid') {
      console.log(`[verify-payment] Booking ${bookingId} already confirmed by webhook. Returning success to frontend.`);
      return res.json({ success: true, booking_id: bookingId, public_token: booking.public_token });
    }

    // Otherwise, ensure it's pending
    if (booking.booking_status !== 'payment_pending') {
      return res.status(400).json({ error: 'Booking is no longer pending' });
    }

    // 2. Verify Razorpay HMAC-SHA256 signature
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }
    const crypto = require('crypto');
    const generated = crypto
      .createHmac('sha256', keyRows[0].razorpay_key_secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (generated !== razorpaySignature) {
      console.error(`[verify-payment] Signature mismatch for booking ${bookingId}`);
      return res.status(400).json({ error: 'Payment verification failed – invalid signature' });
    }

    let paymentInfo = null;
    try {
      if (keyRows[0].razorpay_key_id) {
        const razorpay = new Razorpay({
          key_id: keyRows[0].razorpay_key_id,
          key_secret: keyRows[0].razorpay_key_secret,
        });
        paymentInfo = await razorpay.payments.fetch(razorpayPaymentId);
      }
    } catch (fetchErr) {
      console.error('[verify-payment] Failed to fetch payment deep details:', fetchErr);
    }

    // 3. Assert the client actually paid what the booking says they owe.
    //
    // The signature proves Razorpay authorised THIS payment for THIS order; it
    // says nothing about the amount. With the order amount now resolved
    // server-side this should never fire, so treat it as a tripwire.
    //
    // Deliberately does NOT reject: the money has already moved, and refusing
    // to confirm would leave a paid client with no booking. Flag it and let an
    // admin decide.
    if (paymentInfo && paymentInfo.amount != null) {
      const paidPaise = Number(paymentInfo.amount);
      const owedPaise = Math.round(Number(booking.invitee_payment_amount || 0) * 100);
      if (owedPaise > 0 && paidPaise !== owedPaise) {
        console.error(
          `[verify-payment] AMOUNT MISMATCH on booking ${bookingId}: ` +
          `paid ₹${paidPaise / 100} but booking says ₹${owedPaise / 100}. Flagging for review.`
        );
        await pool.query(
          `UPDATE payments SET failure_reason = $1, updated_at = NOW() WHERE booking_id = $2`,
          [`Amount mismatch: paid ${paidPaise / 100}, expected ${owedPaise / 100}`, bookingId]
        ).catch(() => {});
        try {
          await notifyAllAdmins(
            'payment_amount_mismatch',
            'Payment amount mismatch',
            `Booking ${bookingId}: client paid ₹${paidPaise / 100} but the booking was priced at ₹${owedPaise / 100}.`,
            bookingId
          );
        } catch { /* notification failure must not block confirmation */ }
      }
    }

    await processConfirmedBooking(bookingId, razorpayPaymentId, razorpayOrderId, booking, payload, paymentInfo);

    res.json({ success: true, booking_id: bookingId, public_token: booking.public_token });
  } catch (error) {
    console.error('❌ Error in verify-payment:', error);
    res.status(500).json({ error: error.message || 'Payment verification failed' });
  }
});

// API for cron job to verify pending payments
app.post('/api/cron/verify-pending-payments', async (req, res) => {
  try {
    console.log('[CRON] Starting 15-minute Razorpay pending payment verification...');
    
    // Get razorpay keys
    const { rows: keyRows } = await pool.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
    );
    if (!keyRows.length || !keyRows[0].razorpay_key_secret) {
      return res.status(500).json({ error: 'Payment configuration missing' });
    }

    const razorpay = new Razorpay({
      key_id: keyRows[0].razorpay_key_id,
      key_secret: keyRows[0].razorpay_key_secret,
    });

    // Find bookings that have been pending for > 15 mins and < 60 mins
    const pendingBookings = await pool.query(`
      SELECT * FROM bookings 
      WHERE booking_status = 'payment_pending' 
      AND razorpay_order_id IS NOT NULL
      AND invitee_created_at <= NOW() - INTERVAL '30 minutes'
      AND invitee_created_at >= NOW() - INTERVAL '90 minutes'
    `);

    let confirmedCount = 0;
    let failedCount = 0;

    for (const booking of pendingBookings.rows) {
      try {
        const orderId = booking.razorpay_order_id;
        // Fetch payments for this order
        const payments = await razorpay.orders.fetchPayments(orderId);
        
        // Check if there is any successful payment (captured or authorized)
        const successfulPayment = payments.items.find(p => p.status === 'captured' || p.status === 'authorized');
        
        if (successfulPayment) {
          console.log(`[CRON] Found successful payment ${successfulPayment.id} for order ${orderId}`);
          await processConfirmedBooking(
            booking.booking_id, 
            successfulPayment.id, 
            orderId, 
            booking, 
            {}, // Empty payload, falls back to booking row data
            successfulPayment
          );
          confirmedCount++;
        } else {
          // No successful payment found after 15 mins -> Fail the booking and release slot
          console.log(`[CRON] Order ${orderId} has no successful payments. Marking as Failed.`);
          await pool.query(
            `UPDATE bookings
             SET booking_status = 'Failed', payment_status = 'Failed', booking_updated_at = NOW()
             WHERE booking_id = $1 AND booking_status = 'payment_pending'`,
            [booking.booking_id]
          );

          const failedPayment = payments.items.find(p => p.status === 'failed');
          let fReason = null;
          let fCustDetails = null;
          if (failedPayment) {
            fReason = failedPayment.error_description || failedPayment.error_reason || 'Payment failed';
            fCustDetails = JSON.stringify({ email: failedPayment.email, phone: failedPayment.contact, full_response: failedPayment });
          }

          await pool.query(
            `UPDATE payments
             SET failure_reason = $1, customer_details = COALESCE($2, customer_details), updated_at = NOW()
             WHERE razorpay_order_id = $3 OR booking_id = $4`,
            [fReason || 'Payment dropped or expired', fCustDetails, orderId, booking.booking_id]
          );

          failedCount++;
        }
      } catch (err) {
        console.error(`[CRON] Error verifying order ${booking.razorpay_order_id}:`, err.message);
      }
    }

    res.json({ success: true, confirmedCount, failedCount });
  } catch (error) {
    console.error('[CRON] Error in verify-pending-payments:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payment-settings/public', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT active_gateway, razorpay_key_id FROM payment_settings ORDER BY id ASC LIMIT 1');
    if (rows.length > 0 && rows[0].active_gateway === 'razorpay' && rows[0].razorpay_key_id) {
      res.json({
        success: true,
        activeGateway: 'razorpay',
        publicKey: rows[0].razorpay_key_id,
        paymentsEnabled: true
      });
    } else {
      res.json({ paymentsEnabled: false });
    }
  } catch (error) {
    console.error('Error fetching public payment settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Lookup budget for the public client lookup.
 *
 * This endpoint answers "who holds this phone number" without authentication,
 * which is what lets the public booking page prefill a returning client in one
 * step. The cost is that it can also be walked: a caller with a list of numbers
 * learns who is in therapy and with whom.
 *
 * A verification step was considered and deliberately not taken — it would add
 * a screen to every returning booking. This budget is the mitigation instead:
 * a real visitor looks up one number, so 12 an hour is invisible to them while
 * bulk enumeration stops early. It raises the cost of walking the list; it does
 * not make it impossible.
 *
 * In-memory on purpose: one process, and a restart clearing it is acceptable
 * for a throttle. Anything durable belongs in Redis, which this stack has not
 * got.
 */
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
const LOOKUP_MAX_PER_WINDOW = 12;
const lookupHits = new Map<string, number[]>();

function lookupBudgetExceeded(ip: string): boolean {
  const now = Date.now();
  const recent = (lookupHits.get(ip) || []).filter(t => now - t < LOOKUP_WINDOW_MS);
  recent.push(now);
  lookupHits.set(ip, recent);
  // Opportunistic sweep so the map cannot grow without bound.
  if (lookupHits.size > 5000) {
    for (const [k, v] of lookupHits) {
      if (v.every(t => now - t >= LOOKUP_WINDOW_MS)) lookupHits.delete(k);
    }
  }
  return recent.length > LOOKUP_MAX_PER_WINDOW;
}

/**
 * WhatsApp verification for the public booking page.
 *
 * The per-number limits live in the module; this adds a per-IP budget on top,
 * because a caller rotating through numbers is not abusing any one of them — it
 * is using SafeStories' WhatsApp account to message strangers. 20 an hour is far
 * more than a real visitor needs and far less than that is worth.
 */
const OTP_SEND_MAX_PER_IP = 20;
const otpSendHits = new Map<string, number[]>();

function otpSendBudgetExceeded(ip: string): boolean {
  const now = Date.now();
  const recent = (otpSendHits.get(ip) || []).filter(t => now - t < LOOKUP_WINDOW_MS);
  recent.push(now);
  otpSendHits.set(ip, recent);
  if (otpSendHits.size > 5000) {
    for (const [k, v] of otpSendHits) {
      if (v.every(t => now - t >= LOOKUP_WINDOW_MS)) otpSendHits.delete(k);
    }
  }
  return recent.length > OTP_SEND_MAX_PER_IP;
}

app.post('/api/public/send-otp', async (req, res) => {
  try {
    const { phone, name } = req.body || {};
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    if (otpSendBudgetExceeded(ip)) {
      console.warn(`[Public OTP] Send budget exceeded for ${ip}`);
      return res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
    }

    const result = await sendPublicOtp(String(phone || ''), name);
    if (!result.ok) {
      // 429 for "wait a moment", 400 for a number we cannot send to at all.
      return res.status(result.retryAfterSec ? 429 : 400)
        .json({ success: false, error: result.error, retryAfterSec: result.retryAfterSec });
    }
    res.json({ success: true, expiresInSec: result.expiresInSec, resendInSec: result.resendInSec });
  } catch (error: any) {
    console.error('Error sending public OTP:', error?.message || error);
    res.status(502).json({ success: false, error: 'Could not send the code on WhatsApp. Please try again.' });
  }
});

app.post('/api/public/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body || {};
    const result = verifyPublicOtp(String(phone || ''), String(otp || ''));
    if (!result.ok) return res.status(401).json({ success: false, error: result.error });
    console.log(`[Public OTP] Verified ...${otpKey(String(phone || '')).slice(-4)}`);
    res.json({ success: true, verified: true });
  } catch (error: any) {
    console.error('Error verifying public OTP:', error?.message || error);
    res.status(500).json({ success: false, error: 'Could not verify that code.' });
  }
});

app.post('/api/public/client-history', async (req, res) => {
  try {
    const { email, phone } = req.body;

    // Authenticated staff are not walking a list of strangers' numbers — the
    // dashboard legitimately looks up many clients in a sitting.
    if (!optionalUser(req)) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
      if (lookupBudgetExceeded(ip)) {
        console.warn(`[client-history] Lookup budget exceeded for ${ip}`);
        // Deliberately not "not found": a different answer for throttled vs
        // absent would itself leak whether the number matched.
        return res.status(429).json({ success: false, error: 'Too many lookups. Please try again later.' });
      }
    }
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : '';

    if (!cleanEmail && !cleanPhone) {
      return res.json({ success: true, exists: false });
    }

    // 1. Query bookings for the client (excluding canceled and payment_failed)
    const bookingsQuery = `
      SELECT invitee_name, invitee_email, invitee_phone, booking_resource_name, booking_host_name, therapist_id, booking_mode, emergency_contact_name, emergency_contact_relation, emergency_contact_number, invitee_created_at, service_id
      FROM bookings
      WHERE 
        (($1 <> '' AND LOWER(invitee_email) = LOWER($1))
        OR 
        ($2 <> '' AND (
          REGEXP_REPLACE(invitee_phone, '[^0-9]', '', 'g') = $2
          OR (LENGTH($2) >= 7 AND REGEXP_REPLACE(invitee_phone, '[^0-9]', '', 'g') LIKE '%' || $2)
          OR (LENGTH(REGEXP_REPLACE(invitee_phone, '[^0-9]', '', 'g')) >= 7 AND $2 LIKE '%' || REGEXP_REPLACE(invitee_phone, '[^0-9]', '', 'g'))
        )))
        AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
      ORDER BY invitee_created_at DESC NULLS LAST
    `;
    const bookingsResult = await pool.query(bookingsQuery, [cleanEmail, cleanPhone]);
    const bookings = bookingsResult.rows;

    let exists = false;
    let clientName = '';
    let clientEmail = '';
    let clientPhone = '';
    let sessionMode = '';
    let emergencyName = '';
    let emergencyRelation = '';
    let emergencyNumber = '';
    let assignedTherapy = null;
    let assignedTherapistName = null;
    let assignedTherapistId = null;
    let assignedServiceId: number | null = null;

    if (bookings.length > 0) {
      exists = true;
      const latestBooking = bookings[0];
      clientName = latestBooking.invitee_name || '';
      clientEmail = latestBooking.invitee_email || '';
      clientPhone = latestBooking.invitee_phone || '';
      sessionMode = latestBooking.booking_mode || '';
      emergencyName = latestBooking.emergency_contact_name || '';
      emergencyRelation = latestBooking.emergency_contact_relation || '';
      emergencyNumber = latestBooking.emergency_contact_number || '';

      // Find the most recent non-Free Consultation booking
      const therapyBooking = bookings.find(b => 
        b.booking_resource_name && 
        !b.booking_resource_name.toLowerCase().includes('free consultation') &&
        b.booking_host_name && 
        b.booking_host_name.toLowerCase() !== 'safestories' &&
        b.therapist_id && 
        b.therapist_id !== 'SafeStories'
      );

      if (therapyBooking) {
        assignedTherapy = therapyBooking.booking_resource_name;
        assignedTherapistName = therapyBooking.booking_host_name;
        assignedTherapistId = therapyBooking.therapist_id;
        // The exact service they booked last time, when it was recorded.
        // Returning it lets the public page skip therapy/therapist selection
        // outright instead of matching names back to a service row. Present on
        // ~95% of bookings from the last six months; older ones fall back to
        // the therapist + therapy pair, which the catalogue can still resolve.
        assignedServiceId = therapyBooking.service_id ?? null;
      }
    } else {
      // Check all_clients_table if no booking found
      const clientQuery = `
        SELECT client_name, email_id, phone_number, assigned_therapist, therapist_id
        FROM all_clients_table
        WHERE 
          (($1 <> '' AND LOWER(email_id) = LOWER($1))
          OR 
          ($2 <> '' AND (
            REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') = $2
            OR (LENGTH($2) >= 7 AND REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g') LIKE '%' || $2)
            OR (LENGTH(REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g')) >= 7 AND $2 LIKE '%' || REGEXP_REPLACE(phone_number, '[^0-9]', '', 'g'))
          )))
        LIMIT 1
      `;
      const clientResult = await pool.query(clientQuery, [cleanEmail, cleanPhone]);
      if (clientResult.rows.length > 0) {
        exists = true;
        const client = clientResult.rows[0];
        clientName = client.client_name || '';
        clientEmail = client.email_id || '';
        clientPhone = client.phone_number || '';
        assignedTherapistName = client.assigned_therapist || null;
        assignedTherapistId = client.therapist_id || null;
        assignedTherapy = null;
      }
    }

    return res.json({
      success: true,
      exists,
      clientName,
      clientEmail,
      clientPhone,
      sessionMode,
      emergencyName,
      emergencyRelation,
      emergencyNumber,
      assignedTherapy,
      assignedTherapistName,
      assignedTherapistId,
      assignedServiceId
    });
  } catch (error) {
    console.error('Error fetching client history:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Create Direct Booking natively
app.post('/api/create-booking', async (req, res) => {
  try {
    const payload = req.body;
    const { randomUUID } = require('crypto');
    // Generated here, never taken from the request. This route is on the public
    // allowlist because it also serves the client-facing /book/* flow, so
    // `payload.bookingId` let an anonymous caller choose a primary key — squat
    // identifiers, or force collisions against what used to be a 900k space.
    const booking_id = newBookingId();
    const public_token = newPublicToken();
    const invitee_id = newBookingId();

    // 1. Generate Masked Email
    const maskInsertRes = await pool.query(
      `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
       RETURNING id, masked_email`,
      [payload.clientEmail]
    );
    const maskId = maskInsertRes.rows[0].id;
    const maskedEmail = maskInsertRes.rows[0].masked_email;

    const therapistName = payload.therapistName || 'Unknown Therapist';
    let therapistId = payload.therapistId || null;
    let therapist = null;

    if (therapistName === 'SafeStories') {
      therapistId = 'SafeStories';
    } else if (therapistName !== 'Unknown Therapist') {
      const queryParam = therapistId ? therapistId : `%${therapistName.split(' ')[0]}%`;
      const queryStr = therapistId 
        ? 'SELECT * FROM therapists WHERE therapist_id = $1 LIMIT 1'
        : 'SELECT * FROM therapists WHERE name ILIKE $1 LIMIT 1';
      
      const therapistRes = await pool.query(queryStr, [queryParam]);
      if (therapistRes.rows.length > 0) {
        therapist = therapistRes.rows[0];
        // Check if therapist is active
        if (therapist.is_active === false) {
          return res.status(403).json({ error: 'This therapist is no longer accepting bookings' });
        }
        therapistId = therapist.therapist_id;
      }
    }

    // ── One-therapist-per-client rule (#4) ──
    const therapistConflict = await checkExistingTherapistConflict(
      payload.clientEmail, payload.clientWhatsApp, therapistId, therapistName
    );
    if (therapistConflict && !payload.isAdmin) {
      return res.status(409).json({
        error: `This client is already working with ${therapistConflict.existingTherapistName}. To change therapists, please use the Transfer Client option.`,
        conflict: 'therapist',
        existing_therapist: therapistConflict.existingTherapistName,
      });
    }

    // ── Wallet settlement (validate early, debit late) ──
    // Validated here, before the Google Calendar event is created, so an invalid
    // wallet request cannot orphan a calendar event. The actual debit happens
    // after the booking row exists, so a failed insert cannot burn the balance.
    //
    // The price is checked against payload.amount rather than the resolved
    // finalAmount because finalAmount is not computed until after the calendar
    // step — and for an admin (the only role allowed to redeem) finalAmount IS
    // Number(payload.amount). It is clamped against finalAmount again at the
    // point of use below.
    let walletApplied = 0;
    let walletActor: any = null;
    if (payload.useWallet && !payload.isFreeConsultation) {
      // This route is on the PUBLIC allowlist because it also serves the /book/*
      // client-facing flow, so req.user is never populated here. Wallet credit is
      // redeemable ONLY by an admin creating a booking from the dashboard —
      // without this check anyone who knows a client's phone and email could
      // spend that client's balance. payload.isAdmin is client-supplied and is
      // NOT sufficient.
      walletActor = getOptionalUser(req);
      if (!walletActor || !WALLET_REDEEM_ROLES.includes(walletActor.role)) {
        return res.status(403).json({
          error: 'Wallet credit can only be applied by an admin from the dashboard.',
          conflict: 'wallet',
        });
      }

      // Pulls credit off any older phone number this client used, so a recent
      // contact change does not hide their balance.
      const clientKey = await consolidateWallet(payload.clientWhatsApp, payload.clientEmail);
      const balance = clientKey ? await getBalance(clientKey) : 0;
      const quotedPrice = Number(payload.amount || payload.paymentDetails?.amount) || 0;
      const requested = Number(payload.walletAmount) || 0;

      // A wallet can never over-pay a session, and never pay more than it holds.
      walletApplied = Math.min(requested, balance, quotedPrice);

      if (requested > walletApplied) {
        // The browser's copy of the balance is stale — another admin settled this
        // client's wallet, or the amount was tampered with in transit.
        return res.status(409).json({
          error: 'Wallet balance has changed. Please review the amount and try again.',
          conflict: 'wallet',
          availableBalance: balance,
        });
      }
    }

    let startAt: Date;

    // Handle both formats: date+slot OR startTime
    if (payload.startTime) {
      // Parse ISO format startTime: "2026-09-10T04:30:00Z" or "2026-09-10T04:30:00+05:30"
      startAt = new Date(payload.startTime);
    } else if (payload.date && payload.slot) {
      // Legacy format: separate date and slot
      startAt = new Date(`${payload.date} ${payload.slot} GMT+0530`);
    } else {
      startAt = new Date();
    }

    if (isNaN(startAt.getTime())) {
      startAt = new Date();
    }

    console.log(`[Create Booking] Parsed startTime: ${startAt.toISOString()} from payload.startTime: ${payload.startTime || 'not provided'}`);

    const sessionDurationMinutes = payload.therapyName === 'Free Consultation' || payload.isFreeConsultation ? 15 : 50;
    const endAt = new Date(startAt.getTime() + sessionDurationMinutes * 60000);

    // ── Double-booking / conflict prevention (#3) ──
    // 1. Idempotency: if an identical active booking for this client+slot already exists
    //    (e.g. the Book button was clicked twice), return it instead of creating a duplicate.
    if (therapistId) {
      const dupRes = await pool.query(
        `SELECT booking_id FROM bookings
         WHERE therapist_id = $1
           AND booking_start_at = $2
           AND COALESCE(invitee_email, '') = COALESCE($3, '')
           AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
         LIMIT 1`,
        [therapistId, startAt.toISOString(), payload.clientEmail || '']
      );
      if (dupRes.rows.length > 0) {
        console.log(`[Create Booking] Duplicate suppressed; returning existing booking ${dupRes.rows[0].booking_id}`);
        return res.status(200).json({ success: true, booking_id: dupRes.rows[0].booking_id, id: dupRes.rows[0].booking_id, duplicate: true });
      }

      // 2. System calendar conflict: the therapist already has an overlapping active booking.
      const conflictRes = await pool.query(
        `SELECT booking_id FROM bookings
         WHERE therapist_id = $1
           AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
           AND booking_start_at < $3
           AND booking_end_at > $2
         LIMIT 1`,
        [therapistId, startAt.toISOString(), endAt.toISOString()]
      );
      if (conflictRes.rows.length > 0) {
        console.warn(`[Create Booking] Slot conflict for therapist ${therapistId} at ${startAt.toISOString()}`);
        return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.', conflict: 'system' });
      }
    }

    // 3. Google Calendar conflict: the therapist's connected calendar is busy at this time.
    if (therapist && therapist.google_refresh_token) {
      try {
        const oauth2ClientFb = await getAuthenticatedClient(therapist);
        const calendarFb = google.calendar({ version: 'v3', auth: oauth2ClientFb });
        const fb = await calendarFb.freebusy.query({
          requestBody: {
            timeMin: startAt.toISOString(),
            timeMax: endAt.toISOString(),
            items: [{ id: 'primary' }],
          },
        });
        const busy = fb.data.calendars?.primary?.busy || [];
        if (busy.length > 0) {
          console.warn(`[Create Booking] Google Calendar busy for therapist ${therapist.name} at ${startAt.toISOString()}`);
          return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.', conflict: 'google' });
        }
      } catch (fbErr) {
        // Don't block booking if the free/busy check itself fails — just log it.
        console.error('[Create Booking] Free/busy check failed (continuing):', fbErr);
      }
    }

    const formatTime = (dateObj: Date) => {
      return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    };

    const dayName = startAt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const monthName = startAt.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
    const dateNum = startAt.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Kolkata' });
    const yearNum = startAt.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
    const startTimeStr = formatTime(startAt);
    const endTimeStr = formatTime(endAt);

    const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${startTimeStr} - ${endTimeStr} IST`;

    const clientTz = payload.timezone || 'Asia/Kolkata';
    const formatTimeClient = (dateObj: Date) => dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz });
    const clientDayName = startAt.toLocaleDateString('en-US', { weekday: 'long', timeZone: clientTz });
    const clientMonthName = startAt.toLocaleDateString('en-US', { month: 'short', timeZone: clientTz });
    const clientDateNum = startAt.toLocaleDateString('en-US', { day: 'numeric', timeZone: clientTz });
    const clientYearNum = startAt.toLocaleDateString('en-US', { year: 'numeric', timeZone: clientTz });
    
    let tzShort = 'IST';
    if (clientTz !== 'Asia/Kolkata') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startAt);
        tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
      } catch (e) {
        tzShort = clientTz;
      }
    }
    const inviteeTime = `${clientDayName}, ${clientMonthName} ${clientDateNum}, ${clientYearNum} at ${formatTimeClient(startAt)} - ${formatTimeClient(endAt)} ${tzShort}`;

    const origin = req.get('origin') || 'http://localhost:3004';
    
    let hasCalendar = false;
    let meetLink = '';
    let google_event_id: string | null = null;
    
    if (therapist && therapist.google_refresh_token) {
      console.log(`[Create Booking] Therapist ${therapist.name} has Google Calendar connected. Creating Event.`);
      try {
        console.log(`[Create Booking] Getting authenticated client for ${therapist.name}...`);
        const oauth2Client = await getAuthenticatedClient(therapist);
        console.log(`[Create Booking] Got OAuth2 client, creating calendar service...`);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const isOnline = payload.sessionMode === 'online';

        console.log(`[Create Booking] Inserting event into calendar for ${therapist.name}...`);
        const ev = await insertClientCalendarEvent(calendar, {
          therapyLabel: payload.isFreeConsultation ? (payload.therapyName || 'Free Consultation') : canonicalTherapyLabel(payload.therapyName),
          clientName: payload.clientName,
          mode: payload.sessionMode || 'online',
          notes: payload.notes || 'None',
          maskedEmail,
          startISO: startAt.toISOString(),
          endISO: endAt.toISOString(),
          isOnline,
          location: 'SafeStories Office - Lullanagar, Pune, Maharashtra 411040 | https://share.google/3tnQB1ORUWCJcmZyv'
        });
        google_event_id = ev.eventId;
        if (isOnline) meetLink = ev.meetLink;
        hasCalendar = true;
        console.log(`✅ [Create Booking] Created calendar event ${google_event_id} on ${therapist.name}'s calendar (client shown as name + masked email).`);
      } catch (calendarError: any) {
        console.error(`❌ [Create Booking] Failed creating Google Calendar event for therapist ${therapist.name}:`, calendarError?.message || calendarError);
        console.error(`[Create Booking] Error details:`, calendarError?.errors || calendarError?.response?.data || calendarError);
      }
    } else if (therapist) {
      console.warn(`⚠️ [Create Booking] Therapist "${therapist.name}" does not have Google Calendar connected. Event will not appear on therapist's calendar.`);
    }

    // Keyed on the token, not the id: this URL is emailed and pasted around, and
    // it is the only thing standing between a stranger and this client's record.
    const publicBookingCheckinUrl = `${origin}/booking-confirmation/${public_token}`;

    const bookingResourceName = payload.isFreeConsultation
      ? (payload.therapyName || 'Free Consultation')
      : canonicalTherapyLabel(payload.therapyName);

    const bookingServiceId = payload.serviceId
      ? Number(payload.serviceId)
      : await resolveServiceIdFromLabel(pool, therapistId, bookingResourceName);

    const bookingPrice = await resolvePrice(pool, {
      serviceId: bookingServiceId,
      clientEmail: payload.clientEmail,
      clientPhone: payload.clientWhatsApp,
    });

    // This endpoint is reached without a payment step in three legitimate cases:
    // a genuinely free session, an admin recording a QR/cash payment, and a
    // Razorpay booking arriving with a verified payment id.
    //
    // `isFreeConsultation` is computed in the BROWSER from the charges string,
    // so on its own it let a tampered request book a ₹3000 session for free —
    // the same class of hole as the client-supplied amount in create-order.
    // A public caller claiming "free" is now checked against the resolved price.
    const claimsPaid = Boolean(payload.payment_id || payload.razorpay_payment_id)
      || payload.paymentMode === 'qr' || payload.paymentMode === 'cash';
    if (!payload.isAdmin && !claimsPaid && bookingPrice.amount > 0) {
      console.warn(
        `[Create Booking] Rejected unpaid booking for a chargeable therapy. ` +
        `service=${bookingServiceId} resolved=₹${bookingPrice.amount} client=${payload.clientEmail}`
      );
      return res.status(402).json({
        error: 'This session requires payment. Please complete checkout to confirm your booking.',
        amount: bookingPrice.amount,
      });
    }

    // An admin may deliberately charge something other than list price (a
    // concession, a package rate). Their figure wins; everyone else gets the
    // resolved one.
    const finalAmount = payload.isAdmin
      ? Number(payload.amount ?? payload.paymentDetails?.amount ?? 0)
      : bookingPrice.amount;

    // ── Wallet-aware payment fields ──
    // Re-clamp against the authoritative resolved price. The early check above
    // ran before finalAmount existed, so this is what guarantees the wallet can
    // never over-pay the session actually being booked.
    //
    // NOTE: invitee_payment_amount below stays the FULL session price even when
    // the wallet covers all of it. That is deliberate and load-bearing: revenue
    // is SUM(invitee_payment_amount) over non-cancelled bookings, and the
    // original booking dropped out of revenue when it was cancelled. Storing 0
    // here would lose that money permanently instead of recognising it against
    // the session that actually happens. The wallet portion is recorded
    // separately in wallet_amount_applied.
    walletApplied = Math.min(walletApplied, finalAmount);
    const walletCoversAll = walletApplied > 0 && walletApplied >= finalAmount;
    const manualModeLabel = payload.paymentMode === 'qr' ? 'QR' : (payload.paymentMode === 'cash' ? 'Cash' : null);

    const resolvedPaymentStatus = (walletCoversAll || payload.paymentMode === 'qr' || payload.paymentMode === 'cash')
      ? 'Paid'
      : (payload.payment_id ? 'Paid' : (payload.isFreeConsultation ? 'Free' : 'Pending'));

    const resolvedPaymentGateway = walletApplied > 0
      ? (walletCoversAll ? 'Wallet' : `Wallet+${manualModeLabel || 'Cash'}`)
      : (manualModeLabel || payload.payment_gateway || null);

    // The overlap check ~150 lines above and this INSERT are far apart, with a
    // Google Calendar round trip in between — so two requests for the same slot
    // could both pass that check and both land here. Re-checked under a lock on
    // the therapist, immediately before the write, which is the only place the
    // answer is still true when it is acted on.
    //
    // Deliberately NOT wrapping the whole handler: that would hold a database
    // connection across the calendar call, and the pool has ten.
    const slotTaken = await withTherapistSlotLock(pool, therapistId, async (tx) => {
      if (therapistId) {
        const clash = await tx.query(
          `SELECT booking_id FROM bookings
            WHERE therapist_id = $1
              AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
              AND booking_start_at < $3
              AND booking_end_at > $2
            LIMIT 1`,
          [therapistId, startAt.toISOString(), endAt.toISOString()]
        );
        if (clash.rows.length > 0) return clash.rows[0].booking_id as string;
      }

      await tx.query(
      `INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        booking_invitee_time, booking_host_time, invitee_payment_amount, invitee_payment_currency,
        booking_status, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, booking_joining_link, mask_id, google_event_id,
        payment_id, payment_status, invitee_payment_gateway, invitee_question,
        service_id, price_source, quoted_amount, public_token,
        invitee_created_at, booking_updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, NOW(), NOW())`,
      [
        booking_id,
        invitee_id,
        'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        bookingResourceName,
        startAt.toISOString(),
        endAt.toISOString(),
        inviteeTime,
        hostTime,
        finalAmount,
        payload.currency || 'INR',
        'confirmed',
        publicBookingCheckinUrl,
        therapistName,
        therapistId,
        payload.sessionMode === 'online' ? 'Online Video Call' : 'In Person (Pune)',
        hasCalendar && payload.sessionMode === 'online' ? meetLink : null,
        maskId,
        google_event_id,
        payload.payment_id || payload.razorpay_payment_id || null,
        resolvedPaymentStatus,
        resolvedPaymentGateway,
        payload.invitee_question || payload.notes || null,
        bookingPrice.serviceId,
        payload.isAdmin ? 'admin_manual' : bookingPrice.source,
        bookingPrice.amount,
        public_token
      ]
      );
      return null;
    });

    if (slotTaken) {
      console.warn(`[Create Booking] Lost the race for therapist ${therapistId} at ${startAt.toISOString()} to ${slotTaken}`);
      return res.status(409).json({
        error: 'This time slot was just taken. Please choose another slot.',
        conflict: 'system',
      });
    }

    // Spend the wallet credit only now that the booking row exists, so a failed
    // insert above cannot burn the client's balance. The debit takes an advisory
    // lock on the client key, so two admins settling the same client serialise.
    if (walletApplied > 0) {
      try {
        await debitWallet({
          name: payload.clientName,
          phone: payload.clientWhatsApp,
          email: payload.clientEmail,
          bookingId: booking_id,
          amount: walletApplied,
          currency: payload.currency || 'INR',
          reason: 'BOOKING_SETTLEMENT',
          notes: `Applied to booking ${booking_id}`,
          userId: walletActor?.id ?? null,
          userName: walletActor?.username || null,
        });
        await pool.query(
          'UPDATE bookings SET wallet_amount_applied = $1 WHERE booking_id = $2',
          [walletApplied, booking_id]
        );
        console.log(`[Create Booking] Applied ₹${walletApplied} wallet credit to ${booking_id}`);
      } catch (walletErr: any) {
        // The balance was validated above, so reaching here means a genuine race
        // or a ledger problem. The booking is already created and the slot held,
        // so do not fail the request — record the shortfall loudly instead and
        // let an admin settle it with a manual adjustment.
        console.error(`[Create Booking] Wallet debit FAILED for ${booking_id} (₹${walletApplied} not deducted):`, walletErr?.message || walletErr);
        walletApplied = 0;
        await pool.query(
          `UPDATE bookings SET invitee_payment_gateway = $1, payment_status = $2 WHERE booking_id = $3`,
          [manualModeLabel || payload.payment_gateway || null,
           manualModeLabel ? 'Paid' : 'Pending',
           booking_id]
        ).catch(() => {});
      }
    }

    logPriceResolution(pool, bookingPrice, {
      context: 'booking', bookingId: booking_id,
      clientEmail: payload.clientEmail, clientPhone: payload.clientWhatsApp,
    }).catch(() => {});

    // If payment was made directly (QR/Cash/Wallet) or it's a Free Consultation, record it in the payments table
    const paymentAmount = finalAmount;
    if (payload.paymentMode === 'qr' || payload.paymentMode === 'cash' || walletApplied > 0 || payload.isFreeConsultation || paymentAmount === 0) {
      await pool.query(
        `INSERT INTO payments (
          booking_id, invitee_name, invitee_email, amount, currency,
          payment_gateway_name, payment_date, payment_screenshot
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
        [
          booking_id,
          payload.clientName || 'Unknown Client',
          payload.clientEmail,
          paymentAmount,
          payload.currency || 'INR',
          walletApplied > 0
            ? (walletApplied >= paymentAmount ? 'Wallet' : `Wallet+${manualModeLabel || 'Cash'}`)
            : (payload.paymentMode === 'qr' ? 'QR' : (payload.paymentMode === 'cash' ? 'Cash' : 'Free')),
          payload.paymentScreenshot || null
        ]
      );
    }

    // Keep this client's contact info up to date across their bookings (#8)
    await reconcileClientContact(payload.clientEmail, payload.clientWhatsApp);

    // Send native email confirmation
    try {
      await sendClientBookingConfirmationEmail(payload.clientEmail, {
        clientName: payload.clientName,
        inviteeTimeStr: inviteeTime,
        sessionName: payload.therapyName || 'Session',
        dateStr: `${dayName}, ${monthName} ${dateNum}, ${yearNum}`,
        timeRangeStr: `${startTimeStr} - ${endTimeStr}`,
        duration: sessionDurationMinutes,
        joinLink: hasCalendar ? meetLink : (payload.sessionMode || 'online'),
        isOnline: payload.sessionMode === 'online',
        checkinUrl: publicBookingCheckinUrl,
        calendarStartRaw: startAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
        calendarEndRaw: endAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
      });
      console.log(`[Create Booking] Sent confirmation email to ${payload.clientEmail}`);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_email', payload.clientEmail, 'success', JSON.stringify({ sent: true })]
      );

      const adminEmailTarget = process.env.ADMIN_EMAIL || 'admin@safestories.in';
      await sendAdminBookingConfirmationEmail(adminEmailTarget, {
        clientName: payload.clientName || 'Unknown Client',
        clientPhone: payload.clientWhatsApp || 'Not provided',
        clientEmail: payload.clientEmail,
        sessionName: payload.therapyName || 'Session',
        sessionTiming: hostTime, // Send admin the IST hostTime!
        sessionMode: payload.sessionMode || 'Online',
        therapistName: therapistName,
        therapistEmail: therapist?.contact_info || 'Not available'
      });
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'admin_confirmation_email', adminEmailTarget, 'success', JSON.stringify({ sent: true })]
      );

      // Notify the therapist of the confirmed session (best-effort; only if we have their email)
      const therapistEmailAddr = therapist?.contact_info;
      if (therapistEmailAddr) {
        const isOnlineSession = payload.sessionMode === 'online';
        await sendTherapistBookingConfirmationEmail(therapistEmailAddr, {
          therapistName: therapist?.name || therapistName,
          clientName: payload.clientName || 'Unknown Client',
          sessionName: payload.therapyName || 'Session',
          sessionTiming: hostTime,
          isOnline: isOnlineSession,
          meetLink: isOnlineSession && hasCalendar ? (meetLink || undefined) : undefined,
        });
        await pool.query(
          `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
          [booking_id, 'therapist_confirmation_email', therapistEmailAddr, 'success', JSON.stringify({ sent: true })]
        );
      } else {
        console.warn(`[Create Booking] No therapist email for booking ${booking_id}; skipped therapist confirmation email.`);
      }
    } catch (emailErr: any) {
      console.error('[Create Booking] Failed to send confirmation email:', emailErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'confirmation_emails', payload.clientEmail, 'failed', emailErr?.message || String(emailErr)]
      );
    }

    // Send confirmation WhatsApp natively
    try {
      const { sendBookingConfirmedClient } = await import('./automations/whatsapp.js');
      await sendBookingConfirmedClient(
        booking_id,
        payload.clientWhatsApp,
        payload.clientName,
        payload.therapyName || 'Session',
        inviteeTime,
        publicBookingCheckinUrl
      );
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, response_data, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_whatsapp', payload.clientWhatsApp, 'success', JSON.stringify({ sent: true })]
      );
    } catch (waErr: any) {
      console.error('[Create Booking] Failed to send AiSensy client confirmation:', waErr?.message || waErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [booking_id, 'client_confirmation_whatsapp', payload.clientWhatsApp, 'failed', waErr?.message || String(waErr)]
      ).catch(() => {});
    }

    try {
      // The new-booking handler lives on the CRM backend (port 3003), not this process.
      const crmBase = process.env.CRM_WEBHOOK_URL || 'http://localhost:3003';
      const whRes = await fetch(`${crmBase}/api/webhooks/new-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id })
      });
      if (!whRes.ok) {
        console.error(`[Create Booking] CRM new-booking webhook returned ${whRes.status} for booking ${booking_id}`);
      }
    } catch (e) {
      console.error('[Create Booking] CRM new-booking webhook failed:', e);
    }

    // public_token is what the confirmation page is reached by; booking_id stays
    // in the response because the dashboard and the payment flow key on it.
    res.status(200).json({ success: true, booking_id, id: booking_id, public_token });

  } catch (error) {
    console.error('❌ Error in create-booking endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a minimal "pending" booking record before Razorpay opens.
// Holds the slot in DB (payment_pending) for up to 30 minutes; confirmed by verify-payment.
app.post('/api/create-pending-booking', async (req, res) => {
  try {
    const payload = req.body;
    const booking_id = newBookingId();
    const invitee_id = newBookingId();
    const public_token = newPublicToken();

    const maskInsertRes = await pool.query(
      `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
       RETURNING id`,
      [payload.clientEmail]
    );
    const maskId = maskInsertRes.rows[0].id;

    let startAt = new Date(`${payload.date} ${payload.slot} GMT+0530`);
    if (isNaN(startAt.getTime())) startAt = new Date();
    const endAt = new Date(startAt.getTime() + 50 * 60000);

    const therapistName = payload.therapistName || 'Unknown Therapist';
    let therapistId = payload.therapistId || null;
    if (therapistName === 'SafeStories') {
      therapistId = 'SafeStories';
    } else if (therapistName !== 'Unknown Therapist' && !therapistId) {
      const tRes = await pool.query(
        'SELECT therapist_id FROM therapists WHERE name ILIKE $1 LIMIT 1',
        [`%${therapistName.split(' ')[0]}%`]
      );
      if (tRes.rows.length > 0) therapistId = tRes.rows[0].therapist_id;
    }

    // One-therapist-per-client rule (#4)
    const therapistConflict = await checkExistingTherapistConflict(
      payload.clientEmail, payload.clientWhatsApp, therapistId, therapistName
    );
    if (therapistConflict) {
      return res.status(409).json({
        error: `This client is already working with ${therapistConflict.existingTherapistName}. To change therapists, please use the Transfer Client option.`,
        conflict: 'therapist',
        existing_therapist: therapistConflict.existingTherapistName,
      });
    }

    // Double-booking / conflict prevention (#3) — don't hold a slot already taken.
    if (therapistId) {
      const conflictRes = await pool.query(
        `SELECT booking_id FROM bookings
         WHERE therapist_id = $1
           AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
           AND booking_start_at < $3
           AND booking_end_at > $2
         LIMIT 1`,
        [therapistId, startAt.toISOString(), endAt.toISOString()]
      );
      if (conflictRes.rows.length > 0) {
        return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.', conflict: 'system' });
      }
    }

    const origin = req.get('origin') || 'http://localhost:3004';
    // Keyed on the token, not the id: this URL is emailed and pasted around, and
    // it is the only thing standing between a stranger and this client's record.
    const publicBookingCheckinUrl = `${origin}/booking-confirmation/${public_token}`;

    const resourceName = payload.isFreeConsultation
      ? (payload.therapyName || 'Free Consultation')
      : canonicalTherapyLabel(payload.therapyName);

    // Re-resolve rather than trusting payload.amount. The browser has already
    // been quoted this price and the Razorpay order was created for it
    // server-side, but the booking row is what refunds and reporting read, so
    // it gets its own authoritative resolution.
    const serviceId = payload.serviceId
      ? Number(payload.serviceId)
      : (await resolvePrice(pool, { slug: payload.slug || null })).serviceId
        ?? await resolveServiceIdFromLabel(pool, therapistId, resourceName);

    const price = await resolvePrice(pool, {
      serviceId,
      clientEmail: payload.clientEmail,
      clientPhone: payload.clientWhatsApp,
    });

    await pool.query(
      `INSERT INTO bookings (
        booking_id, invitee_id, source, invitee_name, invitee_email, invitee_phone, invitee_timezone,
        booking_resource_name, booking_start_at, booking_end_at,
        invitee_payment_amount, invitee_payment_currency,
        booking_status, payment_status, invitee_payment_gateway,
        razorpay_order_id, public_booking_checkin_url,
        booking_host_name, therapist_id, booking_mode, mask_id,
        booking_invitee_time, booking_host_time, invitee_question,
        service_id, price_source, quoted_amount, public_token,
        invitee_created_at, booking_updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28, NOW(), NOW())`,
      [
        booking_id, invitee_id, 'Direct Booking',
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        payload.clientWhatsApp,
        payload.timezone || 'Asia/Kolkata',
        resourceName,
        startAt.toISOString(), endAt.toISOString(),
        price.amount, 'INR',
        'payment_pending', 'Pending', 'Razorpay',
        payload.razorpayOrderId,
        publicBookingCheckinUrl,
        therapistName, therapistId,
        payload.sessionMode === 'online' ? 'Online Video Call' : 'In Person (Pune)',
        maskId,
        '', '',
        payload.invitee_question || payload.notes || null,
        price.serviceId, price.source, price.amount, public_token
      ]
    );

    logPriceResolution(pool, price, {
      context: 'booking', bookingId: booking_id,
      clientEmail: payload.clientEmail, clientPhone: payload.clientWhatsApp,
    }).catch(() => {});

    // Insert pending payment record
    await pool.query(
      `INSERT INTO payments (
        booking_id, invitee_name, invitee_email, amount, currency,
        payment_gateway_name, razorpay_order_id, payment_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [
        booking_id,
        payload.clientName || 'Unknown Client',
        payload.clientEmail,
        price.amount,
        'INR',
        'Razorpay',
        payload.razorpayOrderId
      ]
    );

    // Keep this client's contact info up to date across their bookings (#8)
    await reconcileClientContact(payload.clientEmail, payload.clientWhatsApp);

    res.json({ success: true, booking_id, public_token });
  } catch (error: any) {
    console.error('Error creating pending booking:', error);
    res.status(500).json({ error: error.message || 'Failed to create pending booking' });
  }
});

// SOS Risk Assessments endpoints
app.post('/api/sos-assessments', async (req, res) => {
  try {
    const {
      booking_id,
      therapist_id,
      therapist_name,
      client_name,
      session_name,
      session_timings,
      contact_info,
      mode,
      risk_assessment
    } = req.body;

    // Validate required fields
    if (!risk_assessment || !risk_assessment.severity_level || !risk_assessment.risk_summary) {
      return res.status(400).json({ error: 'Missing required risk assessment data' });
    }

    const insertQuery = `
      INSERT INTO sos_risk_assessments (
        booking_id, therapist_id, therapist_name, client_name, session_name,
        session_timings, contact_info, mode,
        risk_severity_level, risk_severity_description,
        emotional_dysregulation, physical_harm_ideas, drug_alcohol_abuse,
        suicidal_attempt, self_harm, delusions_hallucinations, impulsiveness,
        severe_stress, social_isolation, concern_by_others, other_risk,
        other_details, risk_summary
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
      ) RETURNING id, created_at
    `;

    const values = [
      booking_id,
      therapist_id,
      therapist_name,
      client_name,
      session_name,
      session_timings,
      contact_info,
      mode,
      risk_assessment.severity_level,
      risk_assessment.severity_description,
      risk_assessment.risk_indicators?.emotionalDysregulation || null,
      risk_assessment.risk_indicators?.physicalHarmIdeas || null,
      risk_assessment.risk_indicators?.drugAlcoholAbuse || null,
      risk_assessment.risk_indicators?.suicidalAttempt || null,
      risk_assessment.risk_indicators?.selfHarm || null,
      risk_assessment.risk_indicators?.delusionsHallucinations || null,
      risk_assessment.risk_indicators?.impulsiveness || null,
      risk_assessment.risk_indicators?.severeStress || null,
      risk_assessment.risk_indicators?.socialIsolation || null,
      risk_assessment.risk_indicators?.concernByOthers || null,
      risk_assessment.risk_indicators?.other || null,
      risk_assessment.other_details || null,
      risk_assessment.risk_summary
    ];

    const result = await pool.query(insertQuery, values);
    const assessmentId = result.rows[0].id;
    const createdAt = result.rows[0].created_at;

    res.status(201).json({
      success: true,
      assessment_id: assessmentId,
      created_at: createdAt,
      message: 'SOS Risk Assessment saved successfully'
    });

  } catch (error) {
    console.error('Error saving SOS Risk Assessment:', error);
    res.status(500).json({
      error: 'Failed to save SOS Risk Assessment',
      details: error.message
    });
  }
});

// Update SOS Risk Assessment
app.put('/api/sos-assessments', async (req, res) => {
  try {
    const { id } = req.query;
    const { webhook_sent, webhook_response, status, reviewed_by, resolution_notes } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Assessment ID is required' });
    }

    const updateQuery = `
      UPDATE sos_risk_assessments 
      SET 
        webhook_sent = COALESCE($2, webhook_sent),
        webhook_response = COALESCE($3, webhook_response),
        status = COALESCE($4, status),
        reviewed_by = COALESCE($5, reviewed_by),
        resolution_notes = COALESCE($6, resolution_notes),
        updated_at = CURRENT_TIMESTAMP,
        reviewed_at = CASE WHEN $5 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE reviewed_at END
      WHERE id = $1
      RETURNING *
    `;

    const values = [id, webhook_sent, webhook_response, status, reviewed_by, resolution_notes];
    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'SOS Risk Assessment not found' });
    }

    res.status(200).json({
      success: true,
      assessment: result.rows[0],
      message: 'SOS Risk Assessment updated successfully'
    });

  } catch (error) {
    console.error('Error updating SOS Risk Assessment:', error);
    res.status(500).json({
      error: 'Failed to update SOS Risk Assessment',
      details: error.message
    });
  }
});

// Generate SOS Access Token
app.post('/api/generate-sos-token', async (req, res) => {
  try {
    const { sos_assessment_id, client_email, client_phone, client_name, expires_in_days = 7 } = req.body;

    if (!sos_assessment_id) {
      return res.status(400).json({ error: 'Missing sos_assessment_id', received: req.body });
    }

    if (!client_email) {
      return res.status(400).json({ error: 'Missing client_email', received: req.body });
    }

    if (!client_phone) {
      return res.status(400).json({ error: 'Missing client_phone', received: req.body });
    }

    // Generate unique token (UUID)
    const token = randomUUID();

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Insert token into database
    const insertQuery = `
      INSERT INTO sos_access_tokens (
        token, sos_assessment_id, client_email, client_phone, client_name, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      token,
      sos_assessment_id,
      client_email,
      client_phone,
      client_name,
      expiresAt
    ]);

    res.status(201).json({
      success: true,
      token: token,
      expires_at: expiresAt,
      message: 'SOS access token generated successfully'
    });

  } catch (error) {
    console.error('Error generating SOS token:', error);
    res.status(500).json({
      error: 'Failed to generate SOS token',
      details: error.message
    });
  }
});


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
      const contactQuery = `
        SELECT emergency_contact_name, emergency_contact_number
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND emergency_contact_name IS NOT NULL
          AND emergency_contact_name != ''
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const contactRes = await pool.query(contactQuery, [data.client_email, data.client_phone]);
      if (contactRes.rows.length > 0) {
        emergencyContactName = contactRes.rows[0].emergency_contact_name;
        emergencyContactNumber = contactRes.rows[0].emergency_contact_number;
      }
      
      // Get total completed bookings
      const countQuery = `
        SELECT count(*) as total
        FROM bookings
        WHERE (invitee_email = $1 OR invitee_phone = $2)
          AND booking_status = 'completed'
      `;
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
    
    // Send Whatsapp (best-effort, log failures but don't block)
    let whatsappSent = false;
    const adminPhone = "+917522911068";
    try {
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
      whatsappSent = true;
    } catch (waErr: any) {
      console.error('[SOS Alert] Failed to send WhatsApp notification:', waErr?.message || waErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [data.booking_id || 'unknown', 'sos_whatsapp_alert', adminPhone, 'failed', waErr?.message || String(waErr)]
      ).catch(() => {});
    }

    // Send Email (best-effort, log failures but don't block)
    let emailSent = false;
    const adminEmail = "admin@safestories.in";
    try {
      await sendSOSAdminEmail(adminEmail, details);
      emailSent = true;
    } catch (emailErr: any) {
      console.error('[SOS Alert] Failed to send email notification:', emailErr?.message || emailErr);
      await pool.query(
        `INSERT INTO automation_logs (booking_id, automation_type, recipient, status, error_message, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [data.booking_id || 'unknown', 'sos_email_alert', adminEmail, 'failed', emailErr?.message || String(emailErr)]
      ).catch(() => {});
    }

    // Return success with notification status
    const response: any = { success: true, message: 'SOS Alert processed' };
    if (whatsappSent && emailSent) {
      response.message = 'SOS Alert triggered successfully - all notifications sent';
      response.notificationStatus = 'all_sent';
    } else if (whatsappSent || emailSent) {
      response.message = 'SOS Alert recorded. Some notifications failed.';
      response.notificationStatus = 'partial_sent';
      response.details = {
        whatsapp: whatsappSent ? 'sent' : 'failed',
        email: emailSent ? 'sent' : 'failed'
      };
    } else {
      response.message = 'SOS Alert recorded. No notifications could be sent.';
      response.notificationStatus = 'none_sent';
      response.warning = 'Admin should be notified manually of this SOS alert';
    }
    res.status(200).json(response);
  } catch (error) {
    console.error('Error in send-sos-alert:', error);
    res.status(500).json({ error: 'Failed to process SOS Alert', details: error.message });
  }
});


// Get SOS Documentation by Token (Public endpoint - no auth required)
app.get('/api/sos-documentation', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // 1. Validate token
    const tokenQuery = `
      SELECT 
        sat.*,
        sra.risk_severity_level,
        sra.risk_severity_description,
        sra.risk_summary,
        sra.created_at as sos_created_at
      FROM sos_access_tokens sat
      LEFT JOIN sos_risk_assessments sra ON sat.sos_assessment_id = sra.id
      WHERE sat.token = $1
    `;

    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    const tokenData = tokenResult.rows[0];

    // Check if token is active
    if (!tokenData.is_active) {
      return res.status(403).json({ error: 'This link has been revoked' });
    }

    // Check if token is expired
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.status(403).json({ error: 'This link has expired' });
    }

    // 2. Fetch client documentation
    const clientEmail = tokenData.client_email;
    const clientPhone = tokenData.client_phone;
    const clientName = tokenData.client_name;

    // Get client_id from bookings table
    const clientIdQuery = `
      SELECT DISTINCT invitee_email || '_' || invitee_phone as client_id
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      LIMIT 1
    `;
    const clientIdResult = await pool.query(clientIdQuery, [clientEmail, clientPhone]);
    const clientId = clientIdResult.rows[0]?.client_id || `${clientEmail}_${clientPhone}`;

    // Get case history
    const caseHistoryQuery = `
      SELECT * FROM client_case_history
      WHERE client_name = $1 OR client_id = $2
      ORDER BY created_at DESC
    `;
    const caseHistory = await pool.query(caseHistoryQuery, [clientName, clientId]);

    // Get all progress notes
    const progressNotesQuery = `
      SELECT * FROM client_progress_notes
      WHERE client_name = $1 OR client_id = $2
      ORDER BY session_date DESC
    `;
    const progressNotes = await pool.query(progressNotesQuery, [clientName, clientId]);

    // Get therapy goals
    const goalsQuery = `
      SELECT * FROM client_therapy_goals
      WHERE client_name = $1 OR client_id = $2
      ORDER BY created_at DESC
    `;
    const goals = await pool.query(goalsQuery, [clientName, clientId]);

    // Get session count
    const sessionCountQuery = `
      SELECT COUNT(*) as session_count
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      AND booking_status != 'cancelled'
    `;
    const sessionCount = await pool.query(sessionCountQuery, [clientEmail, clientPhone]);

    // Get emergency contact from bookings
    const emergencyContactQuery = `
      SELECT invitee_question
      FROM bookings
      WHERE invitee_email = $1 AND invitee_phone = $2
      AND invitee_question IS NOT NULL
      ORDER BY booking_start_at DESC
      LIMIT 1
    `;
    const emergencyContact = await pool.query(emergencyContactQuery, [clientEmail, clientPhone]);

    // 3. Update access tracking
    const updateAccessQuery = `
      UPDATE sos_access_tokens
      SET 
        accessed_at = CASE WHEN accessed_at IS NULL THEN CURRENT_TIMESTAMP ELSE accessed_at END,
        access_count = access_count + 1
      WHERE token = $1
    `;
    await pool.query(updateAccessQuery, [token]);

    // 4. Return all documentation
    res.status(200).json({
      success: true,
      client: {
        name: tokenData.client_name,
        email: clientEmail,
        phone: clientPhone,
        session_count: sessionCount.rows[0]?.session_count || 0,
        emergency_contact: emergencyContact.rows[0]?.invitee_question || null
      },
      sos_assessment: {
        severity_level: tokenData.risk_severity_level,
        severity_description: tokenData.risk_severity_description,
        risk_summary: tokenData.risk_summary,
        created_at: tokenData.sos_created_at
      },
      documentation: {
        case_history: caseHistory.rows,
        progress_notes: progressNotes.rows,
        therapy_goals: goals.rows
      },
      token_info: {
        created_at: tokenData.created_at,
        expires_at: tokenData.expires_at,
        access_count: tokenData.access_count + 1
      }
    });

  } catch (error) {
    console.error('Error fetching SOS documentation:', error);
    res.status(500).json({
      error: 'Failed to fetch documentation',
      details: error.message
    });
  }
});

// ==================== THERAPY DOCUMENTATION ENDPOINTS ====================

// 1. Receive session documentation from N8N
app.post('/api/session-documentation', async (req, res) => {
  const { session_type, session_status, client_id, client_name, booking_id, case_history, progress_notes, therapy_goals, consultation_data } = req.body;

  // Track which sections stored successfully so one bad/optional field doesn't fail the whole submit.
  const sectionErrors: { section: string; error: string }[] = [];
  let primaryStored = false; // the actual session note (consultation / case history / progress notes)

  // Coerce a value to an integer or null (avoids "invalid input syntax for integer")
  const toIntOrNull = (v: any) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  // Coerce to an ISO date (YYYY-MM-DD) or null (avoids "invalid input syntax for date")
  const toDateOrNull = (v: any) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };

  try {
    // Map session_status from form to doc_form status value
    const docFormStatus = session_status
      ? String(session_status).toLowerCase().replace(' ', '_') // 'No Show' → 'no_show', 'Completed' → 'completed', 'Cancelled' → 'cancelled'
      : 'completed';

    // Stable client id (#6): if the form sent an empty client_id, derive one
    // from the booking (phone → email). Empty ids previously collided across
    // clients in client_therapy_goals' (client_id, goal_description) upsert.
    let effectiveClientId = (client_id || '').toString().trim();
    if (!effectiveClientId && booking_id) {
      try {
        const bRes = await pool.query(
          'SELECT invitee_phone, invitee_email FROM bookings WHERE booking_id = $1',
          [booking_id]
        );
        if (bRes.rows.length > 0) {
          effectiveClientId = (bRes.rows[0].invitee_phone || bRes.rows[0].invitee_email || '').trim();
        }
      } catch (e) {
        console.error('[session-documentation] client_id fallback lookup failed:', e);
      }
    }

    // If Consultation - store pre-therapy call form data
    if (session_type === 'Consultation' && consultation_data) {
     try {
      const vals = [
        booking_id,
        consultation_data.age,
        Array.isArray(consultation_data.language) ? consultation_data.language : [consultation_data.language || ''],
        consultation_data.language_other,
        consultation_data.location, consultation_data.location_manual,
        Array.isArray(consultation_data.mode_of_session) ? consultation_data.mode_of_session : [consultation_data.mode_of_session || ''],
        consultation_data.previous_therapy,
        Array.isArray(consultation_data.concerns) ? consultation_data.concerns : [consultation_data.concerns || ''],
        consultation_data.concerns_other,
        consultation_data.clinical_concerns_observed,
        Array.isArray(consultation_data.clinical_concerns) ? consultation_data.clinical_concerns : [consultation_data.clinical_concerns || ''],
        consultation_data.psychiatric_treatment,
        consultation_data.suicidal_thoughts, consultation_data.suicidal_current, consultation_data.suicidal_ideation_1m, consultation_data.suicidal_attempt_1m,
        consultation_data.preferred_therapy_approach, consultation_data.preferred_therapy_text,
        consultation_data.consent_explained, consultation_data.consent_no_reason, consultation_data.scope_explained,
        consultation_data.preferred_price, consultation_data.preferred_price_other,
        Array.isArray(consultation_data.readiness) ? consultation_data.readiness : [consultation_data.readiness || ''],
        consultation_data.readiness_other,
        consultation_data.consented_followup, consultation_data.followup_mode,
        consultation_data.client_questions, consultation_data.source, consultation_data.source_other,
        consultation_data.consultation_outcome, consultation_data.close_reason
      ];
      await pool.query(`
        INSERT INTO pretherapy_call_forms (
          booking_id,
          age, language, language_other,
          location, location_manual, mode_of_session,
          previous_therapy, concerns, concerns_other,
          clinical_concerns_observed, clinical_concerns,
          psychiatric_treatment,
          suicidal_thoughts, suicidal_current, suicidal_ideation_1m, suicidal_attempt_1m,
          preferred_therapy_approach, preferred_therapy_text,
          consent_explained, consent_no_reason, scope_explained,
          preferred_price, preferred_price_other,
          readiness, readiness_other,
          consented_followup, followup_mode,
          client_questions, source, source_other,
          consultation_outcome, close_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
        ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO UPDATE SET
          age = EXCLUDED.age,
          language = EXCLUDED.language,
          language_other = EXCLUDED.language_other,
          location = EXCLUDED.location,
          location_manual = EXCLUDED.location_manual,
          mode_of_session = EXCLUDED.mode_of_session,
          previous_therapy = EXCLUDED.previous_therapy,
          concerns = EXCLUDED.concerns,
          concerns_other = EXCLUDED.concerns_other,
          clinical_concerns_observed = EXCLUDED.clinical_concerns_observed,
          clinical_concerns = EXCLUDED.clinical_concerns,
          psychiatric_treatment = EXCLUDED.psychiatric_treatment,
          suicidal_thoughts = EXCLUDED.suicidal_thoughts,
          suicidal_current = EXCLUDED.suicidal_current,
          suicidal_ideation_1m = EXCLUDED.suicidal_ideation_1m,
          suicidal_attempt_1m = EXCLUDED.suicidal_attempt_1m,
          preferred_therapy_approach = EXCLUDED.preferred_therapy_approach,
          preferred_therapy_text = EXCLUDED.preferred_therapy_text,
          consent_explained = EXCLUDED.consent_explained,
          consent_no_reason = EXCLUDED.consent_no_reason,
          scope_explained = EXCLUDED.scope_explained,
          preferred_price = EXCLUDED.preferred_price,
          preferred_price_other = EXCLUDED.preferred_price_other,
          readiness = EXCLUDED.readiness,
          readiness_other = EXCLUDED.readiness_other,
          consented_followup = EXCLUDED.consented_followup,
          followup_mode = EXCLUDED.followup_mode,
          client_questions = EXCLUDED.client_questions,
          source = EXCLUDED.source,
          source_other = EXCLUDED.source_other,
          consultation_outcome = EXCLUDED.consultation_outcome,
          close_reason = EXCLUDED.close_reason
      `, vals);
      console.log('✅ Consultation form data stored');
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] consultation insert failed:', e?.message || e);
       sectionErrors.push({ section: 'consultation', error: e?.message || String(e) });
     }
    }

    // If First Session - store case history
    if (session_type === 'First Session' && case_history) {
     try {
      await pool.query(`
        INSERT INTO client_case_history (
          client_id, client_name, booking_id,
          age, gender_identity, education, occupation,
          marital_status, children, religion, socio_economic_status, city_state,
          presenting_concerns, duration_onset, triggers_factors,
          sleep, appetite, energy_levels, weight_changes, libido, menstrual_history,
          family_history, genogram_url, developmental_history,
          medical_history, medications, previous_mental_health, insight_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
        ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_name = EXCLUDED.client_name,
          age = EXCLUDED.age,
          gender_identity = EXCLUDED.gender_identity,
          education = EXCLUDED.education,
          occupation = EXCLUDED.occupation,
          marital_status = EXCLUDED.marital_status,
          children = EXCLUDED.children,
          religion = EXCLUDED.religion,
          socio_economic_status = EXCLUDED.socio_economic_status,
          city_state = EXCLUDED.city_state,
          presenting_concerns = EXCLUDED.presenting_concerns,
          duration_onset = EXCLUDED.duration_onset,
          triggers_factors = EXCLUDED.triggers_factors,
          sleep = EXCLUDED.sleep,
          appetite = EXCLUDED.appetite,
          energy_levels = EXCLUDED.energy_levels,
          weight_changes = EXCLUDED.weight_changes,
          libido = EXCLUDED.libido,
          menstrual_history = EXCLUDED.menstrual_history,
          family_history = EXCLUDED.family_history,
          genogram_url = EXCLUDED.genogram_url,
          developmental_history = EXCLUDED.developmental_history,
          medical_history = EXCLUDED.medical_history,
          medications = EXCLUDED.medications,
          previous_mental_health = EXCLUDED.previous_mental_health,
          insight_level = EXCLUDED.insight_level,
          updated_at = NOW()
      `, [
        effectiveClientId, client_name, booking_id,
        case_history.age, case_history.gender_identity, case_history.education,
        case_history.occupation,
        case_history.marital_status, case_history.children, case_history.religion,
        case_history.socio_economic_status, case_history.city_state,
        case_history.presenting_concerns, case_history.duration_onset, case_history.triggers_factors,
        case_history.sleep, case_history.appetite, case_history.energy_levels,
        case_history.weight_changes, case_history.libido, case_history.menstrual_history,
        case_history.family_history, case_history.genogram_url, case_history.developmental_history,
        case_history.medical_history, case_history.medications,
        case_history.previous_mental_health, case_history.insight_level
      ]);
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] case_history insert failed:', e?.message || e);
       sectionErrors.push({ section: 'case_history', error: e?.message || String(e) });
     }
    }

    // If Follow-up Session - store progress notes
    if ((session_type === 'Follow-up Session' || session_type === 'First Session') && progress_notes) {
     try {
      await pool.query(`
        INSERT INTO client_progress_notes (
          client_id, client_name, booking_id, session_number, session_date,
          session_duration, session_mode,
          client_report, direct_quotes,
          client_presentation, presentation_tags,
          techniques_used, homework_assigned,
          client_reaction, reaction_tags, engagement_notes,
          themes_patterns, progress_regression, clinical_concerns,
          self_harm_mention, self_harm_details, risk_level,
          risk_factors, protective_factors, safety_plan,
          future_interventions, session_frequency,
          therapist_name, therapist_signature, signature_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
        ON CONFLICT (booking_id) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_name = EXCLUDED.client_name,
          session_number = EXCLUDED.session_number,
          session_date = EXCLUDED.session_date,
          session_duration = EXCLUDED.session_duration,
          session_mode = EXCLUDED.session_mode,
          client_report = EXCLUDED.client_report,
          direct_quotes = EXCLUDED.direct_quotes,
          client_presentation = EXCLUDED.client_presentation,
          presentation_tags = EXCLUDED.presentation_tags,
          techniques_used = EXCLUDED.techniques_used,
          homework_assigned = EXCLUDED.homework_assigned,
          client_reaction = EXCLUDED.client_reaction,
          reaction_tags = EXCLUDED.reaction_tags,
          engagement_notes = EXCLUDED.engagement_notes,
          themes_patterns = EXCLUDED.themes_patterns,
          progress_regression = EXCLUDED.progress_regression,
          clinical_concerns = EXCLUDED.clinical_concerns,
          self_harm_mention = EXCLUDED.self_harm_mention,
          self_harm_details = EXCLUDED.self_harm_details,
          risk_level = EXCLUDED.risk_level,
          risk_factors = EXCLUDED.risk_factors,
          protective_factors = EXCLUDED.protective_factors,
          safety_plan = EXCLUDED.safety_plan,
          future_interventions = EXCLUDED.future_interventions,
          session_frequency = EXCLUDED.session_frequency,
          therapist_name = EXCLUDED.therapist_name,
          therapist_signature = EXCLUDED.therapist_signature,
          signature_date = EXCLUDED.signature_date,
          updated_at = NOW()
      `, [
        effectiveClientId, client_name, booking_id,
        toIntOrNull(progress_notes.session_number), progress_notes.session_date || null,
        progress_notes.session_duration, progress_notes.session_mode,
        progress_notes.client_report, progress_notes.direct_quotes,
        progress_notes.client_presentation, progress_notes.presentation_tags ?? null,
        progress_notes.techniques_used, progress_notes.homework_assigned,
        progress_notes.client_reaction, progress_notes.reaction_tags ?? null, progress_notes.engagement_notes,
        progress_notes.themes_patterns, progress_notes.progress_regression, progress_notes.clinical_concerns,
        progress_notes.self_harm_mention, progress_notes.self_harm_details, progress_notes.risk_level,
        progress_notes.risk_factors, progress_notes.protective_factors, progress_notes.safety_plan,
        progress_notes.future_interventions, progress_notes.session_frequency,
        progress_notes.therapist_name, progress_notes.therapist_signature, toDateOrNull(progress_notes.signature_date)
      ]);
      primaryStored = true;
     } catch (e: any) {
       console.error('❌ [session-documentation] progress_notes insert failed:', e?.message || e);
       sectionErrors.push({ section: 'progress_notes', error: e?.message || String(e) });
     }
    }

    // Always store/update therapy goals (secondary — never blocks the note).
    // Requires a non-empty client id: empty ids would collide across clients
    // on the (client_id, goal_description) unique key.
    if (therapy_goals && therapy_goals.goal_description && effectiveClientId) {
     try {
      await pool.query(`
        INSERT INTO client_therapy_goals (
          client_id, client_name, goal_description, current_stage, initiation_date, is_active
        ) VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (client_id, goal_description) DO UPDATE
        SET current_stage = EXCLUDED.current_stage,
            updated_at = NOW(),
            is_active = true
      `, [
        effectiveClientId, client_name,
        therapy_goals.goal_description,
        therapy_goals.current_stage || 'Initiation',
        new Date()
      ]);
      console.log('✅ Therapy goals stored/updated');
     } catch (e: any) {
       console.error('❌ [session-documentation] therapy_goals upsert failed:', e?.message || e);
       sectionErrors.push({ section: 'therapy_goals', error: e?.message || String(e) });
     }
    }

    // Update documentation form status (secondary)
    try {
      await pool.query(`
        UPDATE client_doc_form
        SET status = $1
        WHERE booking_id = $2
      `, [docFormStatus, booking_id]);
    } catch (e: any) {
      console.error('❌ [session-documentation] doc_form status update failed:', e?.message || e);
      sectionErrors.push({ section: 'doc_form_status', error: e?.message || String(e) });
    }

    // Reflect a No Show / Cancelled marked in the notes form onto the booking itself (secondary).
    // The appointment list derives its displayed status from bookings.booking_status (terminal
    // states) + has_session_notes; without this, a No Show still rendered as "Completed" the moment
    // a (possibly empty) note row was inserted. Guard: never touch unpaid/payment-flow or already
    // terminal bookings, so payment and cancellation flows are left entirely untouched.
    if (docFormStatus === 'no_show' || docFormStatus === 'cancelled') {
      try {
        await pool.query(`
          UPDATE bookings
          SET booking_status = $1
          WHERE booking_id = $2
            AND booking_status NOT IN (
              'payment_pending', 'waiting_for_payment', 'payment_failed', 'pending',
              'cancelled', 'canceled'
            )
        `, [docFormStatus, booking_id]);
      } catch (e: any) {
        console.error('❌ [session-documentation] booking_status update failed:', e?.message || e);
        sectionErrors.push({ section: 'booking_status', error: e?.message || String(e) });
      }
    }

    // Decide overall result:
    // - If a primary note section was attempted and failed, surface a 500 with the real error.
    // - Otherwise succeed (secondary failures are logged but don't block the therapist).
    const primaryFailed = sectionErrors.some(s => ['consultation', 'case_history', 'progress_notes'].includes(s.section));
    if (primaryFailed) {
      return res.status(500).json({
        success: false,
        error: 'Failed to store session documentation',
        details: sectionErrors,
      });
    }

    // The submit succeeded — discard any autosaved draft for this booking so a re-open
    // shows a clean form, not stale draft data. Best-effort; never blocks the response.
    if (booking_id) {
      pool.query('DELETE FROM session_notes_drafts WHERE booking_id = $1', [booking_id])
        .catch(e => console.error('[session-documentation] draft cleanup failed:', e?.message || e));
    }

    res.json({
      success: true,
      message: 'Session documentation stored successfully',
      warnings: sectionErrors.length ? sectionErrors : undefined,
    });
  } catch (error: any) {
    console.error('❌ Error storing session documentation:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to store session documentation' });
  }
});

// ── Session-notes DRAFT (autosave failsafe) ─────────────────────────────────
// A fully isolated store: the therapist's in-progress form is saved here continuously
// so a failed submit / closed tab never loses data. NOTHING else reads this table, so
// drafts can't affect has_session_notes, KPIs, booking status, or the appointments list.
// The signature is intentionally NOT stored — the therapist re-signs on submit.
app.post('/api/session-notes-draft', async (req, res) => {
  try {
    const { booking_id, form_type, form_data } = req.body || {};
    if (!booking_id || form_data === undefined || form_data === null) {
      return res.status(400).json({ error: 'booking_id and form_data are required' });
    }
    await pool.query(
      `INSERT INTO session_notes_drafts (booking_id, form_type, form_data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (booking_id) DO UPDATE SET
         form_type = EXCLUDED.form_type,
         form_data = EXCLUDED.form_data,
         updated_at = NOW()`,
      [String(booking_id), form_type || null, JSON.stringify(form_data)]
    );
    res.json({ success: true });
  } catch (error: any) {
    // Autosave is best-effort — surface a 500 but the form keeps working regardless.
    console.error('[session-notes-draft] save failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'Failed to save draft' });
  }
});

app.get('/api/session-notes-draft', async (req, res) => {
  try {
    const { booking_id } = req.query;
    if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });
    const r = await pool.query(
      'SELECT form_type, form_data, updated_at FROM session_notes_drafts WHERE booking_id = $1',
      [String(booking_id)]
    );
    res.json({ draft: r.rows.length ? r.rows[0] : null });
  } catch (error: any) {
    console.error('[session-notes-draft] load failed:', error?.message || error);
    res.status(500).json({ error: 'Failed to load draft' });
  }
});

// Lists a client's IN-PROGRESS (unsubmitted) note drafts so the client profile can show
// them alongside submitted notes. Resolves client → bookings with the SAME normalized
// phone/email logic as /api/progress-notes so the two lists always agree on identity.
// Read-only: this never affects note/KPI/status derivation anywhere.
app.get('/api/progress-note-drafts', requireClientRecordAccess(r => ({ clientId: r.query.client_id })), async (req, res) => {
  try {
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id is required' });

    const result = await pool.query(
      `SELECT d.booking_id, d.form_type, d.updated_at, d.form_data,
              b.booking_invitee_time, b.booking_start_at, b.booking_status,
              b.booking_host_name AS therapist_name,
              b.booking_resource_name AS session_name,
              b.invitee_name AS client_name
       FROM session_notes_drafts d
       JOIN bookings b ON b.booking_id::text = d.booking_id::text
       WHERE NOT EXISTS (SELECT 1 FROM client_progress_notes  x WHERE x.booking_id::text = d.booking_id::text)
         AND NOT EXISTS (SELECT 1 FROM client_case_history    x WHERE x.booking_id::text = d.booking_id::text)
         AND NOT EXISTS (SELECT 1 FROM pretherapy_call_forms  x WHERE x.booking_id::text = d.booking_id::text)
         AND NOT EXISTS (SELECT 1 FROM client_session_notes   x WHERE x.booking_id::text = d.booking_id::text)
         AND (b.invitee_email = $1
          OR regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
          OR (b.invitee_email IS NOT NULL AND b.invitee_email IN (
                SELECT invitee_email FROM bookings
                WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
                  AND invitee_email IS NOT NULL)))
       ORDER BY d.updated_at DESC`,
      [client_id]
    );

    // Surface a short preview so the card can show what was written so far, without
    // shipping the whole form payload to the browser.
    const PREVIEW_KEYS = [
      'clientReport', 'presentingConcerns', 'themesPatterns', 'techniquesUsed',
      'clinical_concerns_observed', 'concerns_other', 'client_questions',
    ];
    const data = result.rows.map(r => {
      const fd = r.form_data || {};
      let preview = '';
      for (const k of PREVIEW_KEYS) {
        if (typeof fd[k] === 'string' && fd[k].trim()) { preview = fd[k].trim(); break; }
      }
      // Rough completeness signal: how many fields actually carry content.
      const filledCount = Object.entries(fd).filter(([k, v]) =>
        !['step', 'sessionType', 'signatureDate'].includes(k) &&
        v !== null && v !== undefined &&
        (typeof v === 'string' ? v.trim() !== '' : (Array.isArray(v) ? v.length > 0 : true))
      ).length;
      return {
        booking_id: r.booking_id,
        form_type: r.form_type,
        updated_at: r.updated_at,
        booking_invitee_time: r.booking_invitee_time,
        booking_start_at: r.booking_start_at,
        booking_status: r.booking_status,
        therapist_name: r.therapist_name,
        session_name: r.session_name,
        client_name: r.client_name,
        preview,
        filled_count: filledCount,
        is_draft: true,
      };
    });

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('[progress-note-drafts] fetch failed:', error?.message || error);
    res.status(500).json({ error: 'Failed to fetch note drafts' });
  }
});

app.delete('/api/session-notes-draft', async (req, res) => {
  try {
    const booking_id = (req.query.booking_id || (req.body && req.body.booking_id)) as string;
    if (!booking_id) return res.status(400).json({ error: 'booking_id is required' });
    await pool.query('DELETE FROM session_notes_drafts WHERE booking_id = $1', [String(booking_id)]);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[session-notes-draft] delete failed:', error?.message || error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

// 2. Get case history
app.get('/api/case-history', requireClientRecordAccess(r => ({ clientId: r.query.client_id, bookingId: r.query.booking_id })), async (req, res) => {
  try {
    const { client_id, booking_id } = req.query;

    if (!client_id && !booking_id) {
      return res.status(400).json({ error: 'client_id or booking_id is required' });
    }

    let result;
    if (booking_id) {
      result = await pool.query('SELECT * FROM client_case_history WHERE booking_id = $1', [booking_id]);
    } else {
      result = await pool.query(
        `SELECT * FROM client_case_history
         WHERE client_id = $1
            OR booking_id IN (
              SELECT b.booking_id FROM bookings b
              WHERE b.invitee_email = $1
                 OR regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
                 OR (b.invitee_email IS NOT NULL AND b.invitee_email IN (
                       SELECT invitee_email FROM bookings
                       WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
                         AND invitee_email IS NOT NULL))
            )
         ORDER BY created_at DESC LIMIT 1`,
        [client_id]
      );
    }

    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching case history:', error);
    res.status(500).json({ error: 'Failed to fetch case history' });
  }
});

// 3. Update case history
app.put('/api/case-history/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Read the row first so the write can be refused on ownership. Checking after
    // the UPDATE would be too late — the record would already have changed.
    const existing = await pool.query(
      'SELECT client_id, booking_id FROM client_case_history WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Case history not found' });
    }
    if (!(await mayAccessClientRecords(req, {
      clientId: existing.rows[0].client_id, bookingId: existing.rows[0].booking_id,
    }))) {
      return res.status(403).json({ error: 'These records belong to another therapist\'s client.' });
    }

    const result = await pool.query(`
      UPDATE client_case_history
      SET ${Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ')},
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, ...Object.values(updates)]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Case history not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating case history:', error);
    res.status(500).json({ error: 'Failed to update case history' });
  }
});

// 4. Get progress notes list
app.get('/api/progress-notes', requireClientRecordAccess(r => ({ clientId: r.query.client_id })), async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    // Fetch from client_progress_notes (new system).
    // Match by stored client_id, OR by any booking that belongs to this client — resolved with
    // NORMALIZED phone matching (so "+91 99..." and "+9199..." are the same) plus email linkage
    // (so a client who booked under two different numbers but one email is still matched). The
    // old exact `invitee_phone = $1` hid notes whenever the profile phone format differed.
    const progressNotesResult = await pool.query(
      `SELECT *, 'progress_note' as note_type
       FROM client_progress_notes
       WHERE client_id::text = $1
          OR booking_id IN (
            SELECT b.booking_id FROM bookings b
            WHERE b.invitee_email = $1
               OR regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
               OR (b.invitee_email IS NOT NULL AND b.invitee_email IN (
                     SELECT invitee_email FROM bookings
                     WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
                       AND invitee_email IS NOT NULL))
          )
       ORDER BY session_date DESC`,
      [client_id]
    );

    // Fetch from client_session_notes (old system)
    // client_id is actually the phone number, so use it directly to match bookings
    const sessionNotesResult = await pool.query(
      `SELECT DISTINCT csn.note_id as id, csn.session_timing, csn.created_at, 
              csn.client_name, csn.host_name,
              csn.concerns_discussed, csn.somatic_cues, csn.interventions_used,
              csn.interventions_helpful, csn.client_participation, csn.goal_progress,
              csn.client_values, csn.self_harm_mention, csn.self_harm_details,
              csn.current_risk_level, csn.protective_factors, csn.health_history,
              csn.past_diagnoses, csn.next_session_plan, csn.homework_suggested,
              csn.session_status, csn.client_age, csn.gender, csn.occupation, csn.marital_status,
              'session_note' as note_type, csn.booking_id
       FROM client_session_notes csn
       INNER JOIN bookings b ON csn.booking_id::text = b.booking_id::text
       WHERE regexp_replace(b.invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
          OR b.invitee_email = $1
          OR (b.invitee_email IS NOT NULL AND b.invitee_email IN (
                SELECT invitee_email FROM bookings
                WHERE regexp_replace(invitee_phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
                  AND invitee_email IS NOT NULL))
       ORDER BY csn.created_at DESC`,
      [client_id]
    );

    // Merge both results
    const allNotes = [
      ...progressNotesResult.rows.map(note => ({
        ...note,
        session_date: note.session_date || note.created_at,
        note_type: 'progress_note'
      })),
      ...sessionNotesResult.rows.map(note => ({
        ...note,
        session_date: note.created_at, // Use created_at as session_date for old notes
        note_type: 'session_note'
      }))
    ];

    // Sort by date descending
    allNotes.sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime());

    res.json({ success: true, data: allNotes });
  } catch (error) {
    console.error('Error fetching progress notes:', error);
    res.status(500).json({ error: 'Failed to fetch progress notes' });
  }
});

// 5. Get single progress note
app.get('/api/progress-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM client_progress_notes WHERE id = $1',
      [id]
    );

    // Checked after the fetch because the row is what says whose client this is;
    // the id in the URL carries no ownership of its own.
    if (result.rows.length > 0 && !(await mayAccessClientRecords(req, {
      clientId: result.rows[0].client_id, bookingId: result.rows[0].booking_id,
    }))) {
      return res.status(403).json({ error: 'These records belong to another therapist\'s client.' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Progress note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching progress note:', error);
    res.status(500).json({ error: 'Failed to fetch progress note' });
  }
});

// 6. Get therapy goals
app.get('/api/therapy-goals', async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    console.log(`🔍 [API] therapy-goals fetching for client_id: "${client_id}"`);
    
    // First, find all unique names associated with this phone or email from bookings
    const associatedNamesRes = await pool.query(
      `SELECT DISTINCT TRIM(invitee_name) as name FROM bookings WHERE invitee_phone = $1 OR invitee_email = $1`,
      [client_id]
    );
    const associatedNames = associatedNamesRes.rows.map(r => r.name);
    console.log(`📋 [API] Associated names for ${client_id}:`, associatedNames);

    const result = await pool.query(
      `SELECT * FROM client_therapy_goals 
       WHERE (
         client_id = $1 
         OR EXISTS (
           SELECT 1 FROM bookings 
           WHERE (invitee_phone = $1 OR invitee_email = $1)
             AND (
               TRIM(invitee_name) ILIKE '%' || TRIM(client_therapy_goals.client_name) || '%'
               OR TRIM(client_therapy_goals.client_name) ILIKE '%' || TRIM(invitee_name) || '%'
             )
         )
       ) AND is_active = true
       ORDER BY created_at DESC`,
      [client_id]
    );
    console.log(`🎯 [API] Found ${result.rows.length} goals for ${client_id}`);

    if (result.rows.length === 0) {
      console.warn(`⚠️ [API] No goals found for ${client_id}. Checking for records matching names directly...`);
      // Final fallback if no booking exists yet
      if (associatedNames.length > 0) {
        const nameMatchResult = await pool.query(
          `SELECT * FROM client_therapy_goals WHERE TRIM(client_name) ILIKE ANY ($1) AND is_active = true`,
          [associatedNames.map(n => `%${n}%`)]
        );
        console.log(`🔄 [API] Name-only fallback found ${nameMatchResult.rows.length} goals`);
        return res.json({ success: true, data: nameMatchResult.rows });
      }
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching therapy goals:', error);
    res.status(500).json({ error: 'Failed to fetch therapy goals' });
  }
});

// 6a. Get free consultation notes list
app.get('/api/free-consultation-notes', requireClientRecordAccess(r => ({ clientId: r.query.client_id })), async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const result = await pool.query(
      `SELECT id, session_date, session_mode, presenting_concerns,
              assigned_therapist_name, created_at
       FROM free_consultation_pretherapy_notes 
       WHERE client_id = $1 
       ORDER BY session_date DESC`,
      [client_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching free consultation notes:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation notes' });
  }
});

// 6b. Get single free consultation note
app.get('/api/free-consultation-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE id = $1',
      [id]
    );

    // See the note on /api/progress-notes/:id — ownership lives on the row.
    if (result.rows.length > 0 && !(await mayAccessClientRecords(req, {
      clientId: result.rows[0].client_id, bookingId: result.rows[0].booking_id,
    }))) {
      return res.status(403).json({ error: 'These records belong to another therapist\'s client.' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Free consultation note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching free consultation note:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation note' });
  }
});

// 7. Create therapy goal
app.post('/api/therapy-goals', async (req, res) => {
  try {
    const { client_id, client_name, goal_description, current_stage } = req.body;

    const result = await pool.query(`
      INSERT INTO client_therapy_goals (
        client_id, client_name, goal_description, current_stage, initiation_date
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [client_id, client_name, goal_description, current_stage || 'Initiation', new Date()]);

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating therapy goal:', error);
    res.status(500).json({ error: 'Failed to create therapy goal' });
  }
});

// 8. Update therapy goal
app.put('/api/therapy-goals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { current_stage } = req.body;

    const stageField = `${current_stage.toLowerCase().replace('-', '_')}_date`;

    const result = await pool.query(`
      UPDATE client_therapy_goals 
      SET current_stage = $1,
          ${stageField} = COALESCE(${stageField}, NOW()),
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [current_stage, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy goal not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating therapy goal:', error);
    res.status(500).json({ error: 'Failed to update therapy goal' });
  }
});

// 9. Paperform Webhook - Free Consultation
app.post('/api/paperform-webhook/free-consultation', async (req, res) => {
  try {
    const { submission_id, booking_id, data } = req.body;

    // Verify booking_id exists and get session_type
    const docForm = await pool.query(
      'SELECT session_type FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (docForm.rows.length === 0) {
      const errMsg = 'Booking not found in client_doc_form';
      await logWebhookApi({
        log_type: 'webhook_incoming',
        name: 'Paperform Free Consultation',
        endpoint: '/api/paperform-webhook/free-consultation',
        method: 'POST',
        status: 'failed',
        request_payload: req.body,
        error_message: errMsg,
        response_data: { success: false, error: errMsg }
      });
      return res.status(404).json({ success: false, error: errMsg });
    }

    const sessionType = docForm.rows[0].session_type;

    // Verify it's a free consultation
    if (sessionType !== 'Free Consultation - SafeStories') {
      const errMsg = `Invalid session type: ${sessionType}. Expected: Free Consultation - SafeStories`;
      await logWebhookApi({
        log_type: 'webhook_incoming',
        name: 'Paperform Free Consultation',
        endpoint: '/api/paperform-webhook/free-consultation',
        method: 'POST',
        status: 'failed',
        request_payload: req.body,
        error_message: errMsg,
        response_data: { success: false, error: errMsg }
      });
      return res.status(400).json({
        success: false,
        error: errMsg
      });
    }

    // Insert into free_consultation_pretherapy_notes
    await pool.query(`
      INSERT INTO free_consultation_pretherapy_notes (
        client_name, client_id, booking_id,
        session_date, session_timing, session_duration,
        therapist_name, session_mode,
        presenting_concerns, duration_onset, triggers_factors,
        therapy_overview_given, client_questions, answers_given,
        preferred_languages, preferred_modes, preferred_price_range,
        preferred_time_slots, assigned_therapist_name,
        chatbot_booking_explained,
        clinical_concerns_mentioned, clinical_concerns_details,
        suicidal_thoughts_mentioned, suicidal_thoughts_details,
        other_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    `, [
      data.client_name,
      data.client_id,
      booking_id,
      data.session_date,
      data.session_timing,
      data.session_duration,
      data.therapist_name,
      data.session_mode,
      data.presenting_concerns,
      data.duration_onset,
      data.triggers_factors,
      data.therapy_overview_given || false,
      data.client_questions,
      data.answers_given,
      data.preferred_languages,
      data.preferred_modes,
      data.preferred_price_range,
      data.preferred_time_slots,
      data.assigned_therapist_name,
      data.chatbot_booking_explained || false,
      data.clinical_concerns_mentioned || false,
      data.clinical_concerns_details,
      data.suicidal_thoughts_mentioned || false,
      data.suicidal_thoughts_details,
      data.other_notes
    ]);

    // Update client_doc_form status
    await pool.query(`
      UPDATE client_doc_form 
      SET status = 'completed',
          paperform_submission_id = $1
      WHERE booking_id = $2
    `, [submission_id, booking_id]);

    console.log('✅ client_doc_form updated to completed');

    const resData = { success: true, message: 'Free consultation notes stored successfully' };
    await logWebhookApi({
      log_type: 'webhook_incoming',
      name: 'Paperform Free Consultation',
      endpoint: '/api/paperform-webhook/free-consultation',
      method: 'POST',
      status: 'success',
      request_payload: req.body,
      response_data: resData
    });

    res.json(resData);
  } catch (error: any) {
    console.error('❌ Error storing free consultation notes:', error);
    const resData = { success: false, error: 'Failed to store free consultation notes' };
    await logWebhookApi({
      log_type: 'webhook_incoming',
      name: 'Paperform Free Consultation',
      endpoint: '/api/paperform-webhook/free-consultation',
      method: 'POST',
      status: 'failed',
      request_payload: req.body,
      error_message: error.message || String(error),
      response_data: resData
    });
    res.status(500).json(resData);
  }
});

// 10. Paperform Webhook - Therapy Documentation
app.post('/api/paperform-webhook/therapy-documentation', async (req, res) => {
  try {
    const { submission_id, booking_id, data } = req.body;

    console.log('📝 Received therapy documentation form submission:', { submission_id, booking_id });

    // Verify booking_id exists and get session_type
    const docForm = await pool.query(
      'SELECT session_type FROM client_doc_form WHERE booking_id = $1',
      [booking_id]
    );

    if (docForm.rows.length === 0) {
      const errMsg = 'Booking not found in client_doc_form';
      await logWebhookApi({
        log_type: 'webhook_incoming',
        name: 'Paperform Therapy Documentation',
        endpoint: '/api/paperform-webhook/therapy-documentation',
        method: 'POST',
        status: 'failed',
        request_payload: req.body,
        error_message: errMsg,
        response_data: { success: false, error: errMsg }
      });
      return res.status(404).json({ success: false, error: errMsg });
    }

    const sessionType = docForm.rows[0].session_type;

    // Verify it's NOT a free consultation
    if (sessionType === 'Free Consultation - SafeStories') {
      const errMsg = 'This is a free consultation. Use /api/paperform-webhook/free-consultation endpoint';
      await logWebhookApi({
        log_type: 'webhook_incoming',
        name: 'Paperform Therapy Documentation',
        endpoint: '/api/paperform-webhook/therapy-documentation',
        method: 'POST',
        status: 'failed',
        request_payload: req.body,
        error_message: errMsg,
        response_data: { success: false, error: errMsg }
      });
      return res.status(400).json({
        success: false,
        error: errMsg
      });
    }

    const sessionNumber = data.session_number || 1;
    const isFirstSession = sessionNumber === 1;

    console.log(`📊 Session type: ${sessionType}, Session number: ${sessionNumber}, First session: ${isFirstSession}`);

    // If First Session - store case history
    if (isFirstSession && data.case_history) {
      await pool.query(`
        INSERT INTO client_case_history (
          client_id, client_name, booking_id,
          age, gender_identity, education, occupation, primary_income,
          marital_status, children, religion, socio_economic_status, city_state,
          presenting_concerns, duration_onset, triggers_factors,
          sleep, appetite, energy_levels, weight_changes, libido, menstrual_history,
          family_history, genogram_url, developmental_history,
          medical_history, medications, previous_mental_health, insight_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
        ON CONFLICT (client_id) DO UPDATE SET
          age = EXCLUDED.age,
          gender_identity = EXCLUDED.gender_identity,
          education = EXCLUDED.education,
          occupation = EXCLUDED.occupation,
          primary_income = EXCLUDED.primary_income,
          marital_status = EXCLUDED.marital_status,
          children = EXCLUDED.children,
          religion = EXCLUDED.religion,
          socio_economic_status = EXCLUDED.socio_economic_status,
          city_state = EXCLUDED.city_state,
          presenting_concerns = EXCLUDED.presenting_concerns,
          duration_onset = EXCLUDED.duration_onset,
          triggers_factors = EXCLUDED.triggers_factors,
          sleep = EXCLUDED.sleep,
          appetite = EXCLUDED.appetite,
          energy_levels = EXCLUDED.energy_levels,
          weight_changes = EXCLUDED.weight_changes,
          libido = EXCLUDED.libido,
          menstrual_history = EXCLUDED.menstrual_history,
          family_history = EXCLUDED.family_history,
          genogram_url = EXCLUDED.genogram_url,
          developmental_history = EXCLUDED.developmental_history,
          medical_history = EXCLUDED.medical_history,
          medications = EXCLUDED.medications,
          previous_mental_health = EXCLUDED.previous_mental_health,
          insight_level = EXCLUDED.insight_level,
          updated_at = NOW()
      `, [
        data.client_id,
        data.client_name,
        booking_id,
        data.case_history.age,
        data.case_history.gender_identity,
        data.case_history.education,
        data.case_history.occupation,
        data.case_history.primary_income,
        data.case_history.marital_status,
        data.case_history.children,
        data.case_history.religion,
        data.case_history.socio_economic_status,
        data.case_history.city_state,
        data.case_history.presenting_concerns,
        data.case_history.duration_onset,
        data.case_history.triggers_factors,
        data.case_history.sleep,
        data.case_history.appetite,
        data.case_history.energy_levels,
        data.case_history.weight_changes,
        data.case_history.libido,
        data.case_history.menstrual_history,
        data.case_history.family_history,
        data.case_history.genogram_url,
        data.case_history.developmental_history,
        data.case_history.medical_history,
        data.case_history.medications,
        data.case_history.previous_mental_health,
        data.case_history.insight_level
      ]);
      console.log('✅ Case history stored');
    }

    // Always store progress notes
    if (data.progress_notes) {
      await pool.query(`
        INSERT INTO client_progress_notes (
          client_id, client_name, booking_id, session_number, session_date,
          session_duration, session_mode,
          client_report, direct_quotes,
          client_presentation, presentation_tags,
          techniques_used, homework_assigned,
          client_reaction, reaction_tags, engagement_notes,
          themes_patterns, progress_regression, clinical_concerns,
          self_harm_mention, self_harm_details, risk_level,
          risk_factors, protective_factors, safety_plan,
          future_interventions, session_frequency,
          therapist_name, therapist_signature, signature_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
      `, [
        data.client_id,
        data.client_name,
        booking_id,
        sessionNumber,
        data.session_date,
        data.session_duration,
        data.session_mode,
        data.progress_notes.client_report,
        data.progress_notes.direct_quotes,
        data.progress_notes.client_presentation,
        data.progress_notes.presentation_tags,
        data.progress_notes.techniques_used,
        data.progress_notes.homework_assigned,
        data.progress_notes.client_reaction,
        data.progress_notes.reaction_tags,
        data.progress_notes.engagement_notes,
        data.progress_notes.themes_patterns,
        data.progress_notes.progress_regression,
        data.progress_notes.clinical_concerns,
        data.progress_notes.self_harm_mention || false,
        data.progress_notes.self_harm_details,
        data.progress_notes.risk_level || 'None',
        data.progress_notes.risk_factors,
        data.progress_notes.protective_factors,
        data.progress_notes.safety_plan,
        data.progress_notes.future_interventions,
        data.progress_notes.session_frequency,
        data.therapist_name,
        data.therapist_signature,
        data.signature_date
      ]);
      console.log('✅ Progress notes stored');
    }

    // Store/update therapy goals
    if (data.therapy_goals) {
      await pool.query(`
        INSERT INTO client_therapy_goals (
          client_id, client_name, goal_description, current_stage, initiation_date
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (client_id) DO UPDATE SET
          goal_description = EXCLUDED.goal_description,
          current_stage = EXCLUDED.current_stage,
          updated_at = NOW()
      `, [
        data.client_id,
        data.client_name,
        data.therapy_goals.goal_description,
        data.therapy_goals.current_stage || 'Initiation',
        new Date()
      ]);
      console.log('✅ Therapy goals stored');
    }

    // Update client_doc_form status
    await pool.query(`
      UPDATE client_doc_form 
      SET status = 'completed',
          paperform_submission_id = $1
      WHERE booking_id = $2
    `, [submission_id, booking_id]);

    console.log('✅ client_doc_form updated to completed');

    const resData = { success: true, message: 'Therapy documentation stored successfully' };
    await logWebhookApi({
      log_type: 'webhook_incoming',
      name: 'Paperform Therapy Documentation',
      endpoint: '/api/paperform-webhook/therapy-documentation',
      method: 'POST',
      status: 'success',
      request_payload: req.body,
      response_data: resData
    });

    res.json(resData);
  } catch (error: any) {
    console.error('❌ Error storing therapy documentation:', error);
    const resData = { success: false, error: 'Failed to store therapy documentation' };
    await logWebhookApi({
      log_type: 'webhook_incoming',
      name: 'Paperform Therapy Documentation',
      endpoint: '/api/paperform-webhook/therapy-documentation',
      method: 'POST',
      status: 'failed',
      request_payload: req.body,
      error_message: error.message || String(error),
      response_data: resData
    });
    res.status(500).json(resData);
  }
});

// ==================== END THERAPY DOCUMENTATION ENDPOINTS ====================

// ==================== FREE CONSULTATION ENDPOINTS ====================

// 9. Check client session type (free consultation vs paid sessions)
app.get('/api/client-session-type', async (req, res) => {
  try {
    const { client_id, email, phone } = req.query;

    console.log('🔍 [API] client-session-type called with client_id:', client_id, 'email:', email, 'phone:', phone);

    let queryConditions = [];
    let queryParams = [];

    if (client_id) {
      queryParams.push(client_id);
      queryConditions.push(`(invitee_phone = $${queryParams.length} OR invitee_email = $${queryParams.length})`);
    }
    
    if (email) {
      queryParams.push(email);
      queryConditions.push(`invitee_email = $${queryParams.length}`);
    }

    if (phone) {
      const phones = String(phone).split(',').map(p => p.trim()).filter(Boolean);
      const phoneConditions = phones.map(p => {
        queryParams.push(p);
        return `invitee_phone = $${queryParams.length}`;
      });
      if (phoneConditions.length > 0) {
        queryConditions.push(`(${phoneConditions.join(' OR ')})`);
      }
    }

    if (queryConditions.length === 0) {
      return res.status(400).json({ error: 'client_id, email, or phone is required' });
    }

    const whereClause = queryConditions.join(' OR ');

    // Check if client has any PAID session bookings (non-free-consultation)
    const paidBookingsResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE (${whereClause})
       AND booking_resource_name NOT ILIKE '%free consultation%'
       LIMIT 1`,
      queryParams
    );
    const hasPaidSessions = paidBookingsResult.rows.length > 0;
    console.log('💰 [API] Paid sessions found:', hasPaidSessions, '(', paidBookingsResult.rows.length, 'rows)');

    // Check if client has free consultation bookings
    const freeConsultBookingResult = await pool.query(
      `SELECT booking_id FROM bookings 
       WHERE (${whereClause})
       AND booking_resource_name ILIKE '%free consultation%'
       LIMIT 1`,
      queryParams
    );
    const hasFreeConsultation = freeConsultBookingResult.rows.length > 0;
    console.log('🆓 [API] Free consultations found:', hasFreeConsultation, '(', freeConsultBookingResult.rows.length, 'rows)');

    const response = {
      success: true,
      data: {
        hasPaidSessions,
        hasFreeConsultation
      }
    };
    console.log('📤 [API] Returning:', response);
    res.json(response);
  } catch (error) {
    console.error('Error checking client session type:', error);
    res.status(500).json({ error: 'Failed to check client session type' });
  }
});

// 10. Get free consultation notes
app.get('/api/free-consultation-notes', requireClientRecordAccess(r => ({ clientId: r.query.client_id })), async (req, res) => {
  try {
    const { client_id } = req.query;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE client_name = $1 ORDER BY session_date DESC',
      [client_id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching free consultation notes:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation notes' });
  }
});

// 11. Get single free consultation note
app.get('/api/free-consultation-notes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM free_consultation_pretherapy_notes WHERE id = $1',
      [id]
    );

    // See the note on /api/progress-notes/:id — ownership lives on the row.
    if (result.rows.length > 0 && !(await mayAccessClientRecords(req, {
      clientId: result.rows[0].client_id, bookingId: result.rows[0].booking_id,
    }))) {
      return res.status(403).json({ error: 'These records belong to another therapist\'s client.' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Free consultation note not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching free consultation note:', error);
    res.status(500).json({ error: 'Failed to fetch free consultation note' });
  }
});

// ==================== END FREE CONSULTATION ENDPOINTS ====================

// ==================== PAYMENT LINK EXPIRATION APIs ====================

// 1. Generate Payment Link (Admin)
app.post('/api/admin/generate-payment-link', requireRole(['admin','superadmin','fluidadmin']), async (req, res) => {
  try {
    const { 
      therapistName, 
      clientName, 
      clientEmail, 
      clientPhone, 
      date, 
      time, 
      serviceType, 
      amount,
      clientType,
      sessionMode,
      timezone
    } = req.body;

    let resolvedTherapistId = null;
    if (therapistName) {
      const therapistResult = await pool.query(
        'SELECT therapist_id FROM therapists WHERE name ILIKE $1 LIMIT 1',
        [`%${therapistName.split(' ')[0]}%`]
      );
      if (therapistResult.rows.length > 0) {
        resolvedTherapistId = therapistResult.rows[0].therapist_id;
      }
    }

    // One-therapist-per-client rule (#4)
    const therapistConflict = await checkExistingTherapistConflict(
      clientEmail, clientPhone, resolvedTherapistId, therapistName
    );
    if (therapistConflict && !req.body.isAdmin) {
      return res.status(409).json({
        error: `This client is already working with ${therapistConflict.existingTherapistName}. To change therapists, please use the Transfer Client option.`,
        conflict: 'therapist',
        existing_therapist: therapistConflict.existingTherapistName,
      });
    }

    const bookingId = randomUUID();
    const publicToken = newPublicToken();
    const startObj = new Date(`${date} ${time} GMT+0530`);
    if (!date || !time || isNaN(startObj.getTime())) {
      return res.status(400).json({ error: `Invalid date or time provided. Received date="${date}", time="${time}". Please select a valid slot.` });
    }
    const sessionDurationMinutes = serviceType === 'Free Consultation' ? 15 : 50;
    const endObj = new Date(startObj.getTime() + sessionDurationMinutes * 60000);

    // ── Double-booking prevention ──
    // Mirrors /api/create-booking. Both paths now sit behind one button, so without this
    // the same slot could be held by a payment link while another admin books it outright.
    // An unpaid hold ('waiting_for_payment') still occupies the slot until it is paid or
    // expired by the cron, so it must count as a conflict here.
    if (resolvedTherapistId) {
      const conflictRes = await pool.query(
        `SELECT booking_id FROM bookings
         WHERE therapist_id = $1
           AND booking_status NOT IN ('cancelled', 'canceled', 'payment_failed')
           AND booking_start_at < $3
           AND booking_end_at > $2
         LIMIT 1`,
        [resolvedTherapistId, startObj.toISOString(), endObj.toISOString()]
      );
      if (conflictRes.rows.length > 0) {
        console.warn(`[generate-payment-link] Slot conflict for therapist ${resolvedTherapistId} at ${startObj.toISOString()}`);
        return res.status(409).json({ error: 'This time slot is no longer available. Please choose another slot.', conflict: 'system' });
      }
    }

    const formatTime = (dateObj: Date) => dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
    const dayName = startObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const monthName = startObj.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Kolkata' });
    const dateNum = startObj.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'Asia/Kolkata' });
    const yearNum = startObj.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'Asia/Kolkata' });
    const hostTime = `${dayName}, ${monthName} ${dateNum}, ${yearNum} at ${formatTime(startObj)} - ${formatTime(endObj)} IST`;

    const clientTz = timezone || 'Asia/Kolkata';
    const formatTimeClient = (dateObj: Date) => dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: clientTz });
    const clientDayName = startObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: clientTz });
    const clientMonthName = startObj.toLocaleDateString('en-US', { month: 'short', timeZone: clientTz });
    const clientDateNum = startObj.toLocaleDateString('en-US', { day: 'numeric', timeZone: clientTz });
    const clientYearNum = startObj.toLocaleDateString('en-US', { year: 'numeric', timeZone: clientTz });
    
    let tzShort = 'IST';
    if (clientTz !== 'Asia/Kolkata') {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: clientTz, timeZoneName: 'short' }).formatToParts(startObj);
        tzShort = parts.find(p => p.type === 'timeZoneName')?.value || clientTz;
      } catch (e) {
        tzShort = clientTz;
      }
    }
    const inviteeTime = `${clientDayName}, ${clientMonthName} ${clientDateNum}, ${clientYearNum} at ${formatTimeClient(startObj)} - ${formatTimeClient(endObj)} ${tzShort}`;
    const bookingMode = sessionMode === 'online' ? 'Online Video Call' : 'In Person (Pune)';

    // Generate/reuse the client's masked email now so the calendar event created
    // after payment shows a masked address (never the real one).
    const maskRes = await pool.query(
      `INSERT INTO masked_emails (real_email, created_at) VALUES ($1, CURRENT_TIMESTAMP)
       ON CONFLICT (real_email) DO UPDATE SET real_email = EXCLUDED.real_email
       RETURNING id`,
      [clientEmail]
    );
    const maskId = maskRes.rows[0].id;

    const linkResourceName = /free consultation/i.test(serviceType || '')
      ? serviceType
      : canonicalTherapyLabel(serviceType);

    // The amount stays whatever this authenticated admin entered — a
    // concession or package rate is a legitimate reason to depart from list
    // price. service_id is still recorded so the booking joins the pricing
    // tables, and price_source marks it as a hand-set figure rather than
    // something the engine produced.
    const linkServiceId = await resolveServiceIdFromLabel(pool, resolvedTherapistId, linkResourceName);

    await pool.query(
      `INSERT INTO bookings (
        booking_id, therapist_id, invitee_name, invitee_email, invitee_phone,
        booking_start_at, booking_end_at, booking_status, payment_status, invitee_payment_amount,
        invitee_payment_currency, booking_resource_name, booking_mode, invitee_timezone,
        booking_invitee_time, booking_host_time, booking_host_name, mask_id,
        service_id, price_source, quoted_amount, public_token, invitee_created_at, booking_updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'INR', $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())`,
      [
        bookingId, resolvedTherapistId, clientName, clientEmail, clientPhone,
        startObj.toISOString(), endObj.toISOString(), 'waiting_for_payment', 'Pending', amount,
        linkResourceName,
        bookingMode, clientTz, inviteeTime, hostTime, therapistName, maskId,
        linkServiceId, 'admin_manual', amount, publicToken
      ]
    );

    // Record the pending payment in payments table
    await pool.query(
      `INSERT INTO payments (
        booking_id, invitee_name, invitee_email, amount, currency,
        payment_gateway_name, payment_date
      ) VALUES ($1, $2, $3, $4, 'INR', 'Payment Link', NOW())`,
      [bookingId, clientName, clientEmail, amount]
    );

    // Keep this client's contact info up to date across their bookings (#2)
    await reconcileClientContact(clientEmail, clientPhone);

    let paymentLink = '';
    
    // Generate native Razorpay Payment Link
    try {
      const { rows: keyRows } = await pool.query(
        'SELECT razorpay_key_id, razorpay_key_secret FROM payment_settings ORDER BY id ASC LIMIT 1'
      );
      if (keyRows.length > 0 && keyRows[0].razorpay_key_id && keyRows[0].razorpay_key_secret) {
        const razorpay = new Razorpay({
          key_id: keyRows[0].razorpay_key_id,
          key_secret: keyRows[0].razorpay_key_secret,
        });

        const rzpAmount = Math.round(Number(amount) * 100);
        const expireBy = Math.floor(Date.now() / 1000) + (30 * 60); // 30 mins

        const plink = await razorpay.paymentLink.create({
          amount: rzpAmount,
          currency: 'INR',
          accept_partial: false,
          reference_id: bookingId,
          description: `${serviceType} with ${therapistName}`,
          customer: {
            name: clientName || "Client",
            email: clientEmail || undefined,
            contact: clientPhone ? clientPhone.replace('+', '') : undefined
          },
          notify: {
            sms: false,
            email: false
          },
          reminder_enable: false,
          expire_by: expireBy
        });

        paymentLink = plink.short_url;

        // Store the Razorpay Payment Link ID in the DB
        await pool.query(
          `UPDATE bookings SET razorpay_order_id = $1, public_booking_checkin_url = $2 WHERE booking_id = $3`,
          [plink.id, paymentLink, bookingId]
        );
      } else {
        throw new Error('Razorpay keys not configured');
      }
    } catch (rzpErr) {
      console.error('Error creating Razorpay Payment Link:', rzpErr);
      // Fallback to internal link if API fails
      paymentLink = `${frontendBaseUrl()}/pay/${bookingId}`;
    }

    const formattedDate = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(startObj);

    // The link goes out on WhatsApp AND email. Both sends are best-effort: the slot is
    // already held and the link already exists, so a messaging failure must not fail the
    // request (that would strand a blocked slot and show the admin an error for a booking
    // that was in fact created).
    if (clientPhone) {
      try {
        await sendAiSensyMessage(
          bookingId,
          "send_paymentlink_client_n8n",
          clientPhone,
          clientName || "Client",
          [
            clientName || "Client",
            serviceType || "Therapy Session",
            formattedDate,
            paymentLink
          ]
        );
        console.log(`[generate-payment-link] Sent payment link WhatsApp to ${clientPhone}`);
      } catch (waErr: any) {
        console.error(`[generate-payment-link] Failed to send payment link WhatsApp to ${clientPhone}:`, waErr?.message || waErr);
      }
    }

    if (clientEmail) {
      try {
        await sendPaymentLinkEmail(clientEmail, {
          clientName: clientName || "Client",
          serviceType: serviceType || "Therapy Session",
          sessionTiming: formattedDate,
          paymentLink
        });
        console.log(`[generate-payment-link] Sent payment link email to ${clientEmail}`);
      } catch (emailErr) {
        console.error(`[generate-payment-link] Failed to send payment link email to ${clientEmail}:`, emailErr);
      }
    }

    res.json({ success: true, paymentLink, bookingId });
  } catch (err) {
    console.error('Error generating payment link:', err);
    res.status(500).json({ error: 'Failed to generate payment link' });
  }
});

// 2. Fetch checkout info for public payment page
app.get('/api/bookings/:id/checkout-info', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT b.*, t.name as therapist_name 
       FROM bookings b 
       LEFT JOIN therapists t ON b.therapist_id = t.therapist_id 
       WHERE b.booking_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    if (booking.booking_status !== 'waiting_for_payment') {
      return res.status(400).json({ error: 'This payment link has either expired or already been paid.' });
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('Error fetching checkout info:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 3. Confirm Payment and Trigger N8N Webhook
app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { bookingId, razorpayPaymentId, razorpayOrderId } = req.body;
    
    // Update local DB to Scheduled
    const updateRes = await pool.query(
      `UPDATE bookings 
       SET booking_status = 'Scheduled', payment_status = 'Paid', 
           payment_id = $1, booking_updated_at = NOW()
       WHERE booking_id = $2 AND booking_status = 'waiting_for_payment'
       RETURNING *`,
      [razorpayPaymentId || razorpayOrderId || 'manual_bypass', bookingId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(400).json({ error: 'Booking not found, expired, or already processed.' });
    }

    const booking = updateRes.rows[0];

    // Trigger Native Booking Confirmation (Google Calendar + Whatsapp + Email)
    try {
      await processConfirmedBooking(bookingId, razorpayPaymentId || null, razorpayOrderId || null, booking, {});
    } catch (processErr: any) {
      console.error('❌ Failed to process confirmed booking:', processErr);
    }

    res.json({ success: true, message: 'Payment confirmed and booking scheduled!' });
  } catch (err) {
    console.error('Error confirming payment:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

function startPaymentLinkExpiryCron() {
  console.log('[Cron] Starting Payment Link Expiry background job...');
  setInterval(async () => {
    try {
      // Expire old-style "waiting_for_payment" links.
      // payment_status must move to 'Failed' too — leaving it 'Pending' on a
      // cancelled booking reads as "payment still expected", which it isn't.
      // This mirrors the payment_pending branch below.
      const result = await pool.query(
        `UPDATE bookings
         SET booking_status = 'cancelled', payment_status = 'Failed', booking_updated_at = NOW()
         WHERE booking_status = 'waiting_for_payment'
           AND invitee_created_at < NOW() - INTERVAL '30 minutes'
         RETURNING booking_id`
      );
      if (result.rows.length > 0) {
        console.log(`[Cron] Expired ${result.rows.length} waiting_for_payment links.`);
      }

      // Expire "payment_pending" bookings (created via create-pending-booking before Razorpay)
      const pending = await pool.query(
        `UPDATE bookings
         SET booking_status = 'cancelled', payment_status = 'Failed', booking_updated_at = NOW()
         WHERE booking_status = 'payment_pending'
           AND invitee_created_at < NOW() - INTERVAL '30 minutes'
         RETURNING booking_id`
      );
      if (pending.rows.length > 0) {
        console.log(`[Cron] Expired ${pending.rows.length} unpaid pending bookings (slots freed).`);
      }
    } catch (err) {
      console.error('[Cron] Error expiring payment links:', err);
    }
  }, 60000); // Check every 60 seconds
}

// Start crons (skipped when READONLY_BOOT=1 — local read-only dev boot, no client emails / prod writes)
if (process.env.READONLY_BOOT !== '1') {
  startPaymentLinkExpiryCron();
  startSessionRemindersCron();
}

// ==================== END PAYMENT LINK EXPIRATION APIs ====================

// ==================== OTP APIs ====================
app.post('/api/otp/generate', async (req: any, res) => {
  try {
    const { action } = req.body;
    if (!action) return res.status(400).json({ error: 'Action is required' });
    // This route is authenticated, so req.user is the admin asking to confirm
    // something. Send the code to them rather than to a fixed mailbox.
    const otpId = await generateAdminOTP(action, {
      email: req.user?.email || null,
      name: req.user?.username || null,
    });
    res.json({ success: true, otpId });
  } catch (error: any) {
    console.error('Error generating OTP:', error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
});

app.post('/api/otp/verify', async (req, res) => {
  try {
    const { otpId, otp } = req.body;
    if (!otpId || !otp) return res.status(400).json({ error: 'Missing otpId or otp' });
    const isValid = verifyAdminOTP(otpId, otp);
    if (!isValid) return res.status(400).json({ error: 'Invalid or expired OTP' });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Global error handler - must be after all routes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);

  // Always return JSON
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ==================== THERAPY SERVICES APIs ====================
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ts.*, (t.google_refresh_token IS NOT NULL) as google_calendar_connected, s.availability,
             COALESCE(u.is_active, true) as therapist_is_active
      FROM therapy_services ts
      LEFT JOIN therapists t ON ts.therapist_id = t.therapist_id
      LEFT JOIN users u ON u.role = 'therapist' AND u.therapist_id = ts.therapist_id
      LEFT JOIN therapist_schedules s ON ts.schedule_id = s.schedule_id
      ORDER BY ts.therapist_name, ts.title
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapy services:', error);
    res.status(500).json({ error: 'Failed to fetch therapy services' });
  }
});

app.get('/api/therapist-schedules/:therapist_id', async (req, res) => {
  try {
    const { therapist_id } = req.params;
    const result = await pool.query(`
      SELECT schedule_id, name, availability 
      FROM therapist_schedules 
      WHERE therapist_id = $1 
      ORDER BY created_at DESC
    `, [therapist_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching therapist schedules:', error);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/services', requireSuperAdmin, async (req, res) => {
  try {
    const {
      title, duration, type, therapy_type, description, charges, therapist_id, therapist_name,
      payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled
    } = req.body;

    if (!title || !therapist_name) {
      return res.status(400).json({ error: 'title and therapist_name are required' });
    }

    // Slug stored WITH leading "/" so it matches the /api/public/services/:slug lookup
    const safeTitle = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const safeName  = String(therapist_name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slugBase  = `/${safeTitle}-${safeName}-${Math.random().toString(36).substring(2, 7)}`;

    // Auto-create schedule if not provided (#Fix1)
    let finalScheduleId = schedule_id ? Number(schedule_id) : null;
    if (!finalScheduleId) {
      try {
        // Create a default blank schedule with all days unavailable
        const defaultAvail = [
          { day: 'monday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'tuesday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'wednesday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'thursday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'friday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'saturday', is_available: false, times: [{ start: '09:00', end: '17:00' }] },
          { day: 'sunday', is_available: false, times: [{ start: '09:00', end: '17:00' }] }
        ];
        const schedRes = await pool.query(
          `INSERT INTO therapist_schedules (therapist_id, name, time_zone, availability, date_overrides, exclusions)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
           RETURNING schedule_id`,
          [therapist_id || null, `${therapist_name}'s Schedule`, 'Asia/Calcutta', JSON.stringify(defaultAvail), JSON.stringify([]), JSON.stringify([])]
        );
        if (schedRes.rows.length > 0) {
          finalScheduleId = schedRes.rows[0].schedule_id;
        }
      } catch (schedErr) {
        console.warn('[Service Create] Auto-schedule creation failed (non-fatal):', schedErr);
        // Continue without schedule_id; user can add later
      }
    }

    const result = await pool.query(`
      INSERT INTO therapy_services (
        title, duration, type, therapy_type, description, charges, slug, therapist_id, therapist_name,
        payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, true)
      RETURNING *
    `, [
      title,
      duration || '50 Mins',
      type || 'Online',
      therapy_type || null,
      description || '',
      charges || '0',
      slugBase,
      therapist_id,
      therapist_name,
      payment_gateway || 'Razorpay',
      finalScheduleId,
      JSON.stringify(form_questions || []),
      requires_tnc ?? true,
      is_payment_enabled ?? true
    ]);

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error creating therapy service:', error);
    res.status(500).json({ error: error.message || 'Failed to create therapy service' });
  }
});

app.put('/api/services/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, duration, type, therapy_type, description, charges, therapist_id, therapist_name,
      payment_gateway, schedule_id, form_questions, requires_tnc, is_payment_enabled
    } = req.body;

    const result = await pool.query(`
      UPDATE therapy_services
      SET title             = COALESCE($1,  title),
          duration          = COALESCE($2,  duration),
          type              = COALESCE($3,  type),
          therapy_type      = COALESCE($4,  therapy_type),
          description       = COALESCE($5,  description),
          charges           = COALESCE($6,  charges),
          therapist_id      = COALESCE($7,  therapist_id),
          therapist_name    = COALESCE($8,  therapist_name),
          payment_gateway   = COALESCE($9,  payment_gateway),
          schedule_id       = COALESCE($10, schedule_id),
          form_questions    = COALESCE($11::jsonb, form_questions),
          requires_tnc      = COALESCE($12, requires_tnc),
          is_payment_enabled= COALESCE($13, is_payment_enabled)
      WHERE id = $14
      RETURNING *
    `, [
      title || null,
      duration || null,
      type || null,
      therapy_type || null,
      description || null,
      charges || null,
      therapist_id || null,
      therapist_name || null,
      payment_gateway || null,
      schedule_id ? Number(schedule_id) : null,
      form_questions ? JSON.stringify(form_questions) : null,
      requires_tnc ?? null,
      is_payment_enabled ?? null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy service not found' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('Error updating therapy service:', error);
    res.status(500).json({ error: error.message || 'Failed to update therapy service' });
  }
});

// DELETE therapy calendar
app.delete('/api/therapy-calendars/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM therapy_services WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar deleted' });
  } catch (error: any) {
    console.error('Error deleting therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to delete calendar' });
  }
});

// PATCH deactivate therapy calendar
app.patch('/api/therapy-calendars/:id/deactivate', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapy_services SET is_active = false WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar deactivated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error deactivating therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to deactivate calendar' });
  }
});

// PATCH activate therapy calendar
app.patch('/api/therapy-calendars/:id/activate', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE therapy_services SET is_active = true WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Therapy calendar not found' });
    }
    res.json({ success: true, message: 'Calendar activated', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error activating therapy calendar:', error);
    res.status(500).json({ error: error.message || 'Failed to activate calendar' });
  }
});

// Automation Logs API
app.get('/api/automation-logs', async (req, res) => {
  try {
    const { limit = 100, status, type } = req.query;
    
    let query = 'SELECT * FROM automation_logs';
    const params: any[] = [];
    
    if (status || type) {
      query += ' WHERE';
      if (status) {
        params.push(status);
        query += ` status = $${params.length}`;
      }
      if (type) {
        if (params.length > 0) query += ' AND';
        params.push(type);
        query += ` automation_type = $${params.length}`;
      }
    }
    
    params.push(Number(limit));
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching automation logs:', error);
    res.status(500).json({ error: 'Failed to fetch automation logs' });
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const httpServer = createServer(app);

export const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
  console.log('[Socket.io] Client connected:', socket.id);
  socket.on('join_room', (data) => {
    if (data?.role === 'admin') socket.join('admin_room');
    else if (data?.role === 'therapist' && data?.userId) socket.join('therapist_room_' + data.userId);
  });
});

async function runStartupMigrations() {
  try {
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS therapy_type TEXT`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS is_payment_enabled BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS requires_tnc BOOLEAN NOT NULL DEFAULT true`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS payment_gateway TEXT DEFAULT 'Razorpay'`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS form_questions JSONB DEFAULT '[]'::jsonb`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS schedule_id INTEGER`);
    await pool.query(`ALTER TABLE therapy_services ADD COLUMN IF NOT EXISTS slug TEXT`);
    // Bookings: payment tracking columns
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_id TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT`);

    // Ticketing: ensure the report_issues table + tracking columns exist.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_issues (
        id SERIAL PRIMARY KEY,
        subject TEXT NOT NULL,
        component TEXT NOT NULL,
        description TEXT NOT NULL,
        screenshot_url TEXT,
        reported_by TEXT NOT NULL,
        user_role TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        notes TEXT
      )`);
    await pool.query(`ALTER TABLE report_issues ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_issues_status ON report_issues(status)`);
    // Ownership by user id, not display name. `reported_by` stays as a denormalised
    // label for old rows and for showing who raised it without a join.
    await pool.query(`ALTER TABLE report_issues ADD COLUMN IF NOT EXISTS reported_by_user_id INTEGER`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_report_issues_owner ON report_issues(reported_by_user_id)`);
    // Multiple screenshots per ticket. screenshot_url is kept in sync with the
    // first attachment so anything still reading the old column keeps working.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_issue_attachments (
        id          SERIAL PRIMARY KEY,
        ticket_id   INTEGER NOT NULL REFERENCES report_issues(id) ON DELETE CASCADE,
        file_url    TEXT NOT NULL,
        file_name   TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rin_ticket ON report_issue_attachments(ticket_id)`);

    // Activity log. Holds request-level actions across every role; automation and
    // API traffic keep their own purpose-built tables (automation_logs,
    // webhook_api_logs) and are surfaced alongside this one in the logs UI.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id          BIGSERIAL PRIMARY KEY,
        category    TEXT NOT NULL,
        actor_id    TEXT,
        actor_name  TEXT,
        actor_role  TEXT,
        action      TEXT NOT NULL,
        method      TEXT NOT NULL,
        route       TEXT NOT NULL,
        path        TEXT NOT NULL,
        entity_type TEXT,
        entity_id   TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        ip_address  TEXT,
        user_agent  TEXT,
        metadata    JSONB,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_category ON activity_logs(category, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_logs(actor_id, created_at DESC)`);
    // Backfill ownership for pre-existing rows by matching the stored display name.
    await pool.query(`
      UPDATE report_issues r SET reported_by_user_id = u.id
      FROM users u
      WHERE r.reported_by_user_id IS NULL
        AND LOWER(r.reported_by) IN (LOWER(u.username), LOWER(u.full_name))`);

    // Make masked_email unique per client. The old generated expression used
    // lpad(id,5,'0'), which TRUNCATES ids longer than 5 digits — collapsing every
    // recent client onto client10000@safestories.in. Recompute as client<id>@.
    try {
      const genExpr = await pool.query(
        `SELECT generation_expression FROM information_schema.columns
         WHERE table_name = 'masked_emails' AND column_name = 'masked_email'`
      );
      if ((genExpr.rows[0]?.generation_expression || '').includes('lpad')) {
        const mc = await pool.connect();
        try {
          await mc.query('BEGIN');
          await mc.query('ALTER TABLE masked_emails DROP COLUMN masked_email');
          await mc.query(`ALTER TABLE masked_emails ADD COLUMN masked_email TEXT GENERATED ALWAYS AS ('client' || id::text || '@safestories.in') STORED`);
          await mc.query('COMMIT');
          console.log('[migration] masked_email regenerated as unique client<id>@safestories.in');
        } catch (e: any) {
          await mc.query('ROLLBACK');
          console.error('[migration] masked_email fix failed, rolled back:', e?.message || e);
        } finally {
          mc.release();
        }
      }
    } catch (e: any) {
      console.error('[migration] masked_email check failed:', e?.message || e);
    }

    // Webhook/API logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_api_logs (
        id SERIAL PRIMARY KEY,
        log_type VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        endpoint VARCHAR(255) NOT NULL,
        method VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL,
        request_payload JSONB,
        response_data JSONB,
        error_message TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_api_logs_type_created
      ON webhook_api_logs(log_type, created_at DESC)
    `);

    // Session-notes drafts (autosave failsafe). Isolated store: one row per booking,
    // read only by the draft endpoints + the client-profile drafts list.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_notes_drafts (
        booking_id TEXT PRIMARY KEY,
        form_type  TEXT,
        form_data  JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Prefill behind a booking link.
    //
    // The client's name, number and email used to travel in the link's query
    // string, where a forwarded message or a screenshot handed them to whoever
    // saw it. They live here instead, and the link carries only an unguessable
    // token. That also buys an expiry, revocation, and a record of which admin
    // sent which link — none of which a URL parameter can offer.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_link_tokens (
        token             TEXT PRIMARY KEY,
        client_name       TEXT,
        client_email      TEXT,
        client_phone      TEXT,
        service_id        INTEGER,
        therapy_key       TEXT,
        created_by        TEXT,
        created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        expires_at        TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at        TIMESTAMP WITH TIME ZONE,
        redeem_count      INTEGER NOT NULL DEFAULT 0,
        first_redeemed_at TIMESTAMP WITH TIME ZONE,
        last_redeemed_at  TIMESTAMP WITH TIME ZONE
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_link_tokens_created
      ON booking_link_tokens(created_at DESC)
    `);

    // Heal existing bookings where invitee_created_at is null so they can be processed by expiry cron
    await pool.query(
      `UPDATE bookings 
       SET invitee_created_at = NOW() 
       WHERE invitee_created_at IS NULL 
         AND booking_status IN ('payment_pending', 'waiting_for_payment')`
    );
    
    console.log('✅ Startup migrations complete');
  } catch (err) {
    console.error('⚠️ Startup migration warning (non-fatal):', err);
  }
}

// ==================== AUTOMATION LOGS ENDPOINTS ====================

app.get('/api/automation-logs/stats', async (req, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_ran,
        COUNT(*) FILTER (WHERE status = 'success') as total_success,
        COUNT(*) FILTER (WHERE status = 'failed') as total_failed
      FROM automation_logs
    `);
    
    res.json({
      success: true,
      data: statsResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching automation log stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch automation log stats' });
  }
});

app.get('/api/automation-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM automation_logs');
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    const logsResult = await pool.query(`
      SELECT * FROM automation_logs
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      success: true,
      data: logsResult.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching automation logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch automation logs' });
  }
});

app.get('/api/automation-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const logResult = await pool.query('SELECT * FROM automation_logs WHERE id = $1', [id]);
    
    if (logResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Log not found' });
    }
    
    res.json({
      success: true,
      data: logResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching automation log details:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch automation log details' });
  }
});

// ==================== UNIFIED ACTIVITY LOGS (superadmin) ====================
// One endpoint backs all five tabs. Request-level activity lives in activity_logs;
// automation and API traffic keep their purpose-built tables and are read from
// there rather than duplicated, so their existing detail (payloads, retry state)
// stays intact.
const LOG_VIEWER_ROLES = ['admin', 'superadmin', 'fluidadmin'];

// created_at on activity_logs and automation_logs is `timestamp WITHOUT time zone`
// holding IST wall-clock: lib/db.ts sets the session to Asia/Kolkata, so NOW() is
// stored as local time with the offset discarded. node-postgres then parses that
// naked value in the SERVER process's timezone, which is UTC inside the container.
// So 11:46 IST was serialized as 11:46Z, and the dashboard — formatting in
// Asia/Kolkata — rendered it as 5:16 PM. Every timestamp appeared 5:30 late.
//
// Emitting an explicit +05:30 offset makes the instant unambiguous no matter what
// timezone the container runs in. webhook_api_logs.created_at is already
// `timestamp WITH time zone` and serializes correctly, so it is left alone.
const IST_CREATED_AT = `to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30' AS created_at`;

app.get('/api/activity-logs', requireRole(LOG_VIEWER_ROLES), async (req: any, res) => {
  try {
    const source = String(req.query.source || 'activity');
    // `|| default` before the clamp, because parseInt('abc') is NaN and NaN
    // survives both Math.min and Math.max — it reached the SQL below as
    // `LIMIT NaN OFFSET NaN`, which Postgres rejects with a 500. Not injectable
    // (parseInt only ever yields a number or NaN), just a crash on bad input.
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const { category, search, from, to } = req.query;

    const where: string[] = [];
    const params: any[] = [];
    const add = (clause: string, value: any) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

    if (from) add('created_at >= ?', from);
    if (to) add('created_at <= ?', to);

    if (source === 'automation') {
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(`(automation_type ILIKE ${p} OR recipient ILIKE ${p} OR booking_id ILIKE ${p})`);
      }
      const sql = `SELECT id, booking_id, automation_type AS action, recipient, status,
                          error_message, ${IST_CREATED_AT}
                   FROM automation_logs
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      const rows = await pool.query(sql, params);
      const total = await pool.query(`SELECT COUNT(*)::int n FROM automation_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);
      return res.json({ source, logs: rows.rows, total: total.rows[0].n });
    }

    if (source === 'api') {
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(`(name ILIKE ${p} OR endpoint ILIKE ${p})`);
      }
      const sql = `SELECT id, log_type, name AS action, endpoint, method, status,
                          error_message, created_at
                   FROM webhook_api_logs
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      const rows = await pool.query(sql, params);
      const total = await pool.query(`SELECT COUNT(*)::int n FROM webhook_api_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);
      return res.json({ source, logs: rows.rows, total: total.rows[0].n });
    }

    // Default: request-level activity, optionally scoped to one category tab.
    if (category && category !== 'all') add('category = ?', category);
    if (search) {
      params.push(`%${search}%`);
      where.push(`(actor_name ILIKE $${params.length} OR action ILIKE $${params.length} OR path ILIKE $${params.length})`);
    }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await pool.query(
      `SELECT id, category, actor_id, actor_name, actor_role, action, method, route, path,
              entity_type, entity_id, status_code, duration_ms, ip_address, metadata, ${IST_CREATED_AT}
       FROM activity_logs ${clause}
       ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const total = await pool.query(`SELECT COUNT(*)::int n FROM activity_logs ${clause}`, params);
    res.json({ source: 'activity', logs: rows.rows, total: total.rows[0].n });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// Counts for the tab badges and the header cards.
app.get('/api/activity-logs/stats', requireRole(LOG_VIEWER_ROLES), async (_req, res) => {
  try {
    const byCategory = await pool.query(
      `SELECT category, COUNT(*)::int n,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int today
       FROM activity_logs GROUP BY category`
    );
    const failures = await pool.query(
      `SELECT COUNT(*)::int n FROM activity_logs WHERE status_code >= 400
        AND created_at > NOW() - INTERVAL '24 hours'`
    );
    const automation = await pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE status = 'failed')::int failed FROM automation_logs`
    );
    const api = await pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE status = 'failed')::int failed FROM webhook_api_logs`
    );

    const categories: Record<string, { total: number; today: number }> = {};
    byCategory.rows.forEach((r: any) => { categories[r.category] = { total: r.n, today: r.today }; });

    res.json({
      categories,
      failures24h: failures.rows[0].n,
      automation: { total: automation.rows[0].n, failed: automation.rows[0].failed },
      api: { total: api.rows[0].n, failed: api.rows[0].failed },
    });
  } catch (error) {
    console.error('Error fetching activity log stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/webhook-api-logs/stats', async (req, res) => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total_ran,
        COUNT(*) FILTER (WHERE log_type IN ('webhook_incoming', 'webhook_outgoing')) as total_webhooks,
        COUNT(*) FILTER (WHERE log_type IN ('webhook_incoming', 'webhook_outgoing') AND status = 'success') as webhook_success,
        COUNT(*) FILTER (WHERE log_type IN ('webhook_incoming', 'webhook_outgoing') AND status = 'failed') as webhook_failed,
        COUNT(*) FILTER (WHERE log_type = 'api_outgoing') as total_apis,
        COUNT(*) FILTER (WHERE log_type = 'api_outgoing' AND status = 'success') as api_success,
        COUNT(*) FILTER (WHERE log_type = 'api_outgoing' AND status = 'failed') as api_failed
      FROM webhook_api_logs
    `);
    
    res.json({
      success: true,
      data: statsResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching webhook/API stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Role-gated to match /api/activity-logs beside it. These carry request paths,
// payloads and error text from every integration — the same class of data the
// other log routes are guarded for, and this one was the odd route out.
app.get('/api/webhook-api-logs', requireRole(LOG_VIEWER_ROLES), async (req, res) => {
  try {
    // Clamped, not just defaulted: ?page=0 or ?page=-5 produced a negative
    // OFFSET, which Postgres rejects.
    const page = Math.max(parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 10, 1), 200);
    const { type, status } = req.query;
    const offset = (page - 1) * limit;

    let queryConditions = [];
    const params: any[] = [];

    if (type) {
      if (type === 'webhook') {
        queryConditions.push(`log_type IN ('webhook_incoming', 'webhook_outgoing')`);
      } else if (type === 'api') {
        queryConditions.push(`log_type = 'api_outgoing'`);
      }
    }

    if (status) {
      params.push(status);
      queryConditions.push(`status = $${params.length}`);
    }

    const whereClause = queryConditions.length > 0 ? 'WHERE ' + queryConditions.join(' AND ') : '';

    const countQuery = `SELECT COUNT(*) FROM webhook_api_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const selectQuery = `
      SELECT * FROM webhook_api_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;
    const logsResult = await pool.query(selectQuery, params);

    res.json({
      success: true,
      data: logsResult.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching webhook/API logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch webhook/API logs' });
  }
});

app.get('/api/webhook-api-logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const logResult = await pool.query('SELECT * FROM webhook_api_logs WHERE id = $1', [id]);
    
    if (logResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Log not found' });
    }
    
    res.json({
      success: true,
      data: logResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching webhook/API log details:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch details' });
  }
});

// ==================== END AUTOMATION LOGS ENDPOINTS ====================

// ==================== GLOBAL ERROR HANDLING ====================
// Catch unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('[CRITICAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  // Attempt graceful shutdown
  process.exit(1);
});

// Global error middleware (must be last)
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[ERROR] Express Error Handler:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  // Don't expose error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const errorResponse = {
    error: 'Internal Server Error',
    ...(isDevelopment && { details: err.message })
  };

  res.status(err.status || 500).json(errorResponse);
});

// ==================== GRACEFUL SHUTDOWN ====================
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[SHUTDOWN] ${signal} received. Shutting down gracefully...`);

  httpServer.close(async () => {
    console.log('[SHUTDOWN] HTTP server closed');

    try {
      // Close database pool
      await pool.end();
      console.log('[SHUTDOWN] Database pool closed');
    } catch (err) {
      console.error('[SHUTDOWN] Error closing database pool:', err);
    }

    console.log('[SHUTDOWN] ✅ Graceful shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] ❌ Forced shutdown after 30 seconds');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==================== SERVER STARTUP ====================
httpServer.listen(PORT as number, '0.0.0.0', async () => {
  console.log(`\nAPI server running on http://localhost:${PORT}`);
  console.log(`Allowed CORS origins: ${getAllowedOrigins().join(', ')}`);
  if (process.env.READONLY_BOOT !== '1') {
    await runStartupMigrations();
    startPaymentLinkExpiryCron();
  } else {
    console.log('[READONLY_BOOT] Skipped migrations + crons (no prod writes, no client emails).');
  }
}).on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use. Please use a different port or kill the process using this port.`);
  } else {
    console.error('[ERROR] Server failed to start:', err);
  }
  process.exit(1);
});
