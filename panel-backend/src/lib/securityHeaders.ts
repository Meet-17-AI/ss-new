/**
 * Response security headers, chiefly a Content Security Policy.
 *
 * WHY. The session token lives in localStorage (the cross-origin handoff between
 * the panel and the CRM needs it readable by script, so an httpOnly cookie is
 * not a drop-in). That makes any script running on this origin able to read it —
 * and both apps used to pull Tailwind from cdn.tailwindcss.com and React itself
 * from aistudiocdn.com on every page load. Those script tags are gone, bundled
 * from node_modules instead; this policy is what stops new ones appearing, and
 * what contains a reflected XSS if one is ever found.
 *
 * Tokens are honoured across BOTH services, so an exfiltrated one opens the
 * panel and the CRM alike. That is why this ships in both.
 */

/**
 * `unsafe-inline` for styles is deliberate and load-bearing: the app uses inline
 * `style={{...}}` props throughout, and React writes those as element style
 * attributes. Removing it would need every one of those rewritten as a class.
 * Scripts carry no such allowance — that is the half that matters.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // MinIO serves profile pictures and uploads; blob:/data: cover previews the
  // browser generates locally before an upload is sent.
  "img-src 'self' data: blob: https://s3.srv1169280.hstgr.cloud https://*.hstgr.cloud",
  // Razorpay's checkout is opened in a frame and talks back to its own origin.
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.hstgr.cloud",
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Report-only until the policy has been observed in the browser console.
 *
 * A CSP that blocks a script the app genuinely needs breaks the page with no
 * clue in the UI, so this ships reporting first. Set CSP_ENFORCE=true once the
 * console is clean — same staged shape as the scope gate, and unlike that one,
 * please actually finish it.
 */
const CSP_ENFORCING = String(process.env.CSP_ENFORCE || '').toLowerCase() === 'true';

export const securityHeaders = (_req: any, res: any, next: any) => {
  res.setHeader(
    CSP_ENFORCING ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    CSP_DIRECTIVES
  );

  // Stop the browser second-guessing a declared content type — an uploaded file
  // served as text/plain must not be executed as script because it looks like one.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Belt to frame-ancestors' braces, for anything that predates CSP support.
  res.setHeader('X-Frame-Options', 'DENY');
  // Booking-confirmation URLs carry a capability token in the path, so they must
  // not travel to third parties in a Referer header.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
};
