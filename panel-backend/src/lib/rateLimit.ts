/**
 * Request rate limits.
 *
 * WHY THIS EXISTS. Neither service had any rate limiting at all, and the gap was
 * not theoretical: /api/forgot-password/verify-otp accepted unlimited guesses at
 * a six-digit reset code. Issuing a code was throttled to three per hour;
 * CHECKING one was not throttled at all, which is the half that matters, because
 * an attacker needs exactly one code to exist and then wants to guess at it a
 * million times. That is ~75 minutes to take over any account at 100 req/s.
 *
 * The per-record attempt counter on the reset flow is the specific fix for that.
 * These limiters are the blanket: they bound every other credential-guessing and
 * enumeration surface at once, including ones nobody has thought of yet.
 *
 * THREE TIERS, by what an attacker gains from volume:
 *   authLimiter   — endpoints that answer "is this credential right?"
 *   publicLimiter — unauthenticated reads that can be walked to harvest data
 *   apiLimiter    — everything else, keyed per user, purely to bound abuse
 */

import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';

/**
 * Disabled in local development so a dashboard that polls does not lock the
 * developer out of their own machine. Set RATE_LIMIT_DISABLED=true only there —
 * it is never right in a deployed environment.
 */
const DISABLED = String(process.env.RATE_LIMIT_DISABLED || '').toLowerCase() === 'true';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Bypass rather than branch at every call site, so the limiter list below
  // reads the same in every environment.
  skip: () => DISABLED,
};

const tooMany = (message: string) => (_req: any, res: any) =>
  res.status(429).json({ success: false, error: message });

/**
 * Credential endpoints: login, the whole reset flow, password re-confirmation,
 * handoff redemption.
 *
 * Keyed on IP. `ipKeyGenerator` is the library's own helper and is used rather
 * than `req.ip` directly because it normalises IPv6 to a /56 prefix — without
 * that, an attacker with any IPv6 allocation gets a fresh bucket per request by
 * walking the low bits of their own address, and the limit does nothing.
 *
 * Failures only: a correct password should not consume budget, or a busy admin
 * signing in on a shared office IP gets locked out by everyone else's successes.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req: any) => ipKeyGenerator(req.ip ?? ''),
  skipSuccessfulRequests: true,
  handler: tooMany('Too many attempts. Please wait 15 minutes and try again.'),
});

/**
 * Unauthenticated reads. Deliberately looser — these serve the real public
 * booking page, where one visitor legitimately makes a burst of calls (catalogue,
 * therapists, open days, slots, price) while working through the form.
 *
 * The ceiling is set to stop bulk enumeration, not to police a single booking.
 */
export const publicLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req: any) => ipKeyGenerator(req.ip ?? ''),
  handler: tooMany('Too many requests. Please slow down and try again shortly.'),
});

/**
 * Everything else, keyed on the authenticated user rather than the address, so
 * a whole clinic behind one office NAT is not treated as a single client.
 *
 * The ceiling is high on purpose: several dashboards poll. This is a backstop
 * against a runaway loop or a scripted scrape, not a usage policy.
 */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (req: any) =>
    req.user?.id != null ? `u:${req.user.id}` : ipKeyGenerator(req.ip ?? ''),
  handler: tooMany('Too many requests. Please slow down.'),
});
