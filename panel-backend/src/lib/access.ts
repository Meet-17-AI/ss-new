/**
 * Dashboard access control.
 *
 * THE CENTRAL IDEA — identity and view are different things.
 *
 *   role   = who you are        (immutable: therapist | admin | sales)
 *   scope  = what you may open  (grantable, additive)
 *   view   = what you are on now (UI state, never trusted, never sent as auth)
 *
 * Switching dashboards changes only the view. No token is re-minted and no role
 * is swapped, because an endpoint that hands out a token saying `role: 'admin'`
 * is a privilege-escalation endpoint whose only guard is itself. One identity
 * holding several scopes says the same thing and cannot be turned into a
 * different person.
 *
 * Scopes are read from the DATABASE per request, not from the JWT. Tokens live
 * 24h, so a scope baked into one would keep working for a day after it was taken
 * away, and there would be no way to undo a mistaken grant except waiting.
 */

import { Client } from 'pg';
import pool from './db';

export type Scope = 'admin_dashboard' | 'therapist_dashboard' | 'crm';

export const ALL_SCOPES: Scope[] = ['admin_dashboard', 'therapist_dashboard', 'crm'];

export const isScope = (value: any): value is Scope => ALL_SCOPES.includes(value);

/**
 * The dashboard a role comes with. Never stored and never revocable — it is the
 * reason a user exists, and taking it away would lock them out of everything with
 * no way back in except a DB console.
 */
const BASE_SCOPE: Record<string, Scope> = {
  therapist: 'therapist_dashboard',
  admin: 'admin_dashboard',
  superadmin: 'admin_dashboard',
  fluidadmin: 'admin_dashboard',
  sales: 'crm',
};

export const baseScopeForRole = (role: any): Scope | null =>
  BASE_SCOPE[String(role || '').toLowerCase()] ?? null;

/**
 * Which scopes a role is even ELIGIBLE to hold.
 *
 * A therapist can hold all three. An admin cannot hold `therapist_dashboard`, and
 * that is a data fact rather than a tidiness rule: an admin row has no
 * therapist_id, so a therapist dashboard would have nothing to scope its
 * schedule, clients or notes to. It would render broken, not privileged.
 */
export function grantableScopes(user: { role?: any; therapist_id?: any }): Scope[] {
  const role = String(user?.role || '').toLowerCase();
  const hasTherapistId = user?.therapist_id !== null && user?.therapist_id !== undefined;
  return ALL_SCOPES.filter((s) => s !== 'therapist_dashboard' || (role === 'therapist' && hasTherapistId));
}

// ---------------------------------------------------------------------------
// Lookup + cache
// ---------------------------------------------------------------------------

/**
 * Short-lived cache of resolved scopes, invalidated the moment a grant changes.
 *
 * Invalidation goes through Postgres NOTIFY rather than just clearing the local
 * map, so it reaches EVERY instance. Clearing only the local copy is correct on a
 * single process and quietly wrong the day this runs under PM2 cluster or behind
 * a second container — a revoke would land on whichever worker served the write
 * and the others would keep honouring it until the TTL lapsed. That is the kind
 * of bug that surfaces months later as "we removed their access and they could
 * still get in", so it is closed here rather than written down as a caveat.
 *
 * The TTL remains as a backstop for the case where the listener connection is
 * down and a notification is missed entirely.
 */
const CACHE_TTL_MS = 30_000;
const ACCESS_CHANNEL = 'access_changed';
const cache = new Map<string, { scopes: Set<Scope>; at: number }>();

/** Apply an invalidation locally. Called directly and from the NOTIFY listener. */
const applyInvalidation = (payload: string) => {
  if (payload === '*') cache.clear();
  else cache.delete(payload);
};

/**
 * One dedicated connection for LISTEN — it must not be borrowed from the pool,
 * because a pooled connection gets handed to someone else and stops listening.
 * Reconnects on drop; a listener that dies silently is worse than none, since the
 * cache would then look fresh while going stale.
 */
let listener: Client | null = null;
function startAccessListener(): void {
  if (listener) return;
  const client = new Client({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432'),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  listener = client;

  const retry = (why: string) => {
    console.error(`[access] invalidation listener ${why}; retrying in 5s`);
    listener = null;
    // Everything cached may have been invalidated while we were deaf.
    cache.clear();
    setTimeout(startAccessListener, 5000).unref?.();
  };

  client.on('notification', (msg) => applyInvalidation(String(msg.payload ?? '*')));
  client.on('error', (err: any) => retry(`errored (${err?.message || err})`));
  client.on('end', () => retry('disconnected'));

  client
    .connect()
    .then(() => client.query(`LISTEN ${ACCESS_CHANNEL}`))
    .then(() => console.log('[access] invalidation listener ready'))
    .catch((err: any) => retry(`could not connect (${err?.message || err})`));
}
startAccessListener();

/** Drop a user's cached scopes here and on every other instance. */
export function invalidateAccess(userId: any): void {
  const payload = String(userId);
  applyInvalidation(payload);
  pool
    .query('SELECT pg_notify($1, $2)', [ACCESS_CHANNEL, payload])
    .catch((err: any) => console.error('[access] could not broadcast invalidation:', err?.message || err));
}

/** Drop everything, everywhere. For changes that could affect more than one user. */
export function invalidateAllAccess(): void {
  applyInvalidation('*');
  pool
    .query('SELECT pg_notify($1, $2)', [ACCESS_CHANNEL, '*'])
    .catch((err: any) => console.error('[access] could not broadcast invalidation:', err?.message || err));
}

/**
 * Every scope a caller currently holds: the one their role implies, plus whatever
 * has been granted on top.
 *
 * Falls back to the base scope alone if the table is missing or the query fails.
 * Deliberately fail-CLOSED on extras and fail-OPEN on the base: a database blip
 * must not lock a therapist out of their own dashboard, but it must never be a
 * way to acquire access nobody granted.
 */
export async function loadScopes(user: any): Promise<Set<Scope>> {
  const base = baseScopeForRole(user?.role);
  const fallback = new Set<Scope>(base ? [base] : []);
  if (!user?.id) return fallback;

  const key = String(user.id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.scopes;

  try {
    const { rows } = await pool.query(
      'SELECT scope FROM user_access_grants WHERE user_id = $1',
      [user.id]
    );
    const scopes = new Set<Scope>(fallback);
    for (const row of rows) if (isScope(row.scope)) scopes.add(row.scope);
    cache.set(key, { scopes, at: Date.now() });
    return scopes;
  } catch (err: any) {
    console.error('[access] scope lookup failed:', err?.message || err);
    return fallback;
  }
}

export async function hasScope(user: any, scope: Scope): Promise<boolean> {
  return (await loadScopes(user)).has(scope);
}

// ---------------------------------------------------------------------------
// Object-level ownership
//
// A scope says which dashboard you may OPEN. It cannot say which rows you may
// read, and most of this API's routes are shared by more than one dashboard —
// /api/bookings serves admins and therapists alike, so there is no scope to
// require on it. Those routes are secured by asking "is this yours?" instead.
// ---------------------------------------------------------------------------

/** Roles that ARE administrators, as opposed to holding a granted admin dashboard. */
const BASE_ADMIN_ROLES = ['admin', 'superadmin', 'fluidadmin'];

export const isBaseAdminRole = (user: any): boolean =>
  BASE_ADMIN_ROLES.includes(String(user?.role || '').toLowerCase());

/**
 * Reserved to accounts that ARE administrators — not to anyone holding a granted
 * admin dashboard.
 *
 * requireRole deliberately passes on the equivalent scope, which is what lets a
 * granted therapist use the admin panel at all. These routes are the exception:
 * organisation settings, pricing, the service catalogue and the therapist roster
 * shape how the whole clinic operates, and lending someone the day-to-day
 * dashboard is not the same as handing them the configuration behind it.
 *
 * The check is on ROLE, so no grant can confer it — the same reasoning that
 * keeps clinical records out of a granted therapist's reach.
 */
export const requireBaseAdmin = (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!isBaseAdminRole(req.user)) {
    return res.status(403).json({ error: 'This area is restricted to administrators.' });
  }
  next();
};

/**
 * May this caller act on this therapist's data?
 *
 * Yes when it is their own, or when they hold the admin dashboard. Anything else
 * is refused — including a therapist passing a colleague's id, which every one of
 * these endpoints accepted without asking before this existed.
 */
export async function mayActAsTherapist(req: any, therapistId: any): Promise<boolean> {
  if (therapistId === null || therapistId === undefined || therapistId === '') return false;
  if (req?.user?.therapist_id != null && String(req.user.therapist_id) === String(therapistId)) return true;
  return (await loadScopes(req?.user)).has('admin_dashboard');
}

/** Express guard form of mayActAsTherapist, reading the id from wherever it arrived. */
export const requireTherapistScope = (pick: (req: any) => any) => async (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    if (!(await mayActAsTherapist(req, pick(req)))) {
      return res.status(403).json({ error: 'Not your therapist record' });
    }
  } catch (err: any) {
    console.error('[access] therapist scope check failed:', err?.message || err);
    return res.status(500).json({ error: 'Could not verify permissions' });
  }
  next();
};

/**
 * May this caller read or write THIS CLIENT'S clinical records?
 *
 * Deliberately stricter than the admin dashboard. A therapist granted admin
 * access gets the whole operational panel — bookings, payments, scheduling, the
 * client list — but session notes, case histories, progress notes and SOS
 * assessments stay scoped to people they have actually seen. Being handed an
 * operations tool is not consent to read every client's therapy record, and this
 * is the one place in the panel where that distinction has legal weight.
 *
 * Real administrators are unaffected: overseeing clinical work is their job, and
 * the check is on ROLE rather than scope precisely so a grant cannot confer it.
 *
 * A therapist reaches a client only through a booking of their own — the same
 * email/phone matching the clinical tables themselves use to resolve a client.
 */
export async function mayAccessClientRecords(
  req: any,
  ref: { clientId?: any; bookingId?: any }
): Promise<boolean> {
  if (isBaseAdminRole(req?.user)) return true;

  const therapistId = req?.user?.therapist_id;
  if (!therapistId) return false;

  const clientId = ref.clientId ? String(ref.clientId) : null;
  const bookingId = ref.bookingId ? String(ref.bookingId) : null;
  if (!clientId && !bookingId) return false;

  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM bookings b
        WHERE b.therapist_id = $1
          AND (
                ($2::text IS NOT NULL AND b.booking_id = $2)
             OR ($3::text IS NOT NULL AND (
                   LOWER(b.invitee_email) = LOWER($3)
                   OR (b.invitee_phone IS NOT NULL AND $3 ~ '[0-9]' AND
                       regexp_replace(b.invitee_phone, '[^0-9]', '', 'g')
                         = regexp_replace($3, '[^0-9]', '', 'g'))
                ))
          )
        LIMIT 1`,
      [therapistId, bookingId, clientId]
    );
    return rows.length > 0;
  } catch (err: any) {
    console.error('[access] client record check failed:', err?.message || err);
    // Fail closed. A database blip must not open every client's notes.
    return false;
  }
}

/**
 * Express guard for a clinical route. `pick` pulls the client and/or booking the
 * request is about, from query, params or body as the route happens to carry it.
 */
export const requireClientRecordAccess =
  (pick: (req: any) => { clientId?: any; bookingId?: any }) =>
  async (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      if (!(await mayAccessClientRecords(req, pick(req)))) {
        return res.status(403).json({
          // Named plainly. A therapist hitting this has not done anything wrong —
          // they have opened a client who is not theirs — and a bare "forbidden"
          // reads as a bug.
          error: 'These records belong to another therapist\'s client.',
        });
      }
    } catch (err: any) {
      console.error('[access] client record guard failed:', err?.message || err);
      return res.status(500).json({ error: 'Could not verify permissions' });
    }
    next();
  };

// ---------------------------------------------------------------------------
// Who may hand out access
// ---------------------------------------------------------------------------

/**
 * Who may see and edit the Roles tab.
 *
 * An identity check, not a role check — the AI team signs in with the `admin`
 * role, the very role this has to be told apart from, so no role test can express
 * it. Same shape as CALENDAR_DISCONNECT_USERS in index.ts, for the same reason.
 */
const ACCESS_ADMIN_USERS = (process.env.ACCESS_ADMIN_USERS || 'aiteam@fluid.live,aiteam')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const canManageAccess = (user: any): boolean =>
  Boolean(user) &&
  [user.email, user.username].some(
    (id: any) => id && ACCESS_ADMIN_USERS.includes(String(id).toLowerCase())
  );

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Gate a route on a scope. This is the control — hiding a tab or a route in the
 * frontend only decides whether a control is worth showing.
 */
export const requireScope = (scope: Scope) => async (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    if (!(await loadScopes(req.user)).has(scope)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  } catch (err: any) {
    console.error('[access] requireScope failed:', err?.message || err);
    return res.status(500).json({ error: 'Could not verify permissions' });
  }
  next();
};

/** Gate a route on being one of the accounts that may hand out access. */
export const requireAccessAdmin = (req: any, res: any, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!canManageAccess(req.user)) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
};

// ---------------------------------------------------------------------------
// Blanket route gate
// ---------------------------------------------------------------------------

/**
 * Path prefixes that belong to one dashboard, so the whole surface is covered
 * without annotating 188 route definitions by hand.
 *
 * Modelled on PUBLIC_API_ROUTES in index.ts: matching is by pattern, and a route
 * that matches nothing here is left to whatever guard it declares itself. That is
 * NOT default-deny — flipping ~150 authenticated-only routes to closed in one
 * step would take the panel down. See ACCESS_ENFORCE below for how it tightens.
 */
const SCOPED_API_ROUTES: { pattern: RegExp; scope: Scope }[] = [
  // --- owned by the admin dashboard ---
  // Every pattern below was checked against the route table AND against which
  // frontend calls it. A pattern that matches no route is worse than no pattern:
  // it reads as coverage that does not exist.
  { pattern: /^\/api\/admin\//, scope: 'admin_dashboard' },
  { pattern: /^\/api\/wallets?(\/|$)/, scope: 'admin_dashboard' },
  { pattern: /^\/api\/org-settings(\/|$)/, scope: 'admin_dashboard' },
  { pattern: /^\/api\/refunds(\/|$)/, scope: 'admin_dashboard' },

  // --- owned by the CRM ---
  { pattern: /^\/api\/crm(\/|-|$)/, scope: 'crm' },
  { pattern: /^\/api\/leads(\/|$)/, scope: 'crm' },
  { pattern: /^\/api\/lead-managers(\/|$)/, scope: 'crm' },
  { pattern: /^\/api\/pretherapy-form(\/|$)/, scope: 'crm' },
];

/**
 * Everything NOT listed above is either genuinely shared between dashboards
 * (/api/bookings, /api/clients, /api/notifications, /api/tickets — an admin and a
 * therapist both need them) or already carries its own requireRole/requireScope.
 *
 * Shared routes are the reason this is not, and should not become, a default-deny
 * list: there is no single scope that describes them. They are secured by the
 * ownership checks above instead, which is the right control for them — asking
 * "may you open this dashboard" cannot answer "may you read this row".
 */

/**
 * Whether the gate BLOCKS or merely reports.
 *
 * Defaults to shadow mode: every would-be denial is logged and allowed through.
 * Run it that way first, read the log for a week, then set ACCESS_ENFORCE=true.
 * The alternative — enforcing on day one against routes nobody has audited — is
 * how a permissions rollout becomes an outage.
 */
const ENFORCING = String(process.env.ACCESS_ENFORCE || '').toLowerCase() === 'true';

/**
 * Shadow denials, collapsed to one entry per route+role+day.
 *
 * Logging every request would bury the signal — dashboards poll, so a single
 * misclassified route produces thousands of identical lines and the week's data
 * becomes unreadable. What the audit actually needs is the DISTINCT set of
 * (route, role) pairs that would break, which is a short list.
 *
 * Call `getShadowDenials()` to read it. In-memory rather than a table because it
 * is a diagnostic for a one-off rollout decision, not a record worth keeping.
 */
const shadowSeen = new Map<string, { route: string; role: string; scope: Scope; count: number; firstAt: string; lastAt: string }>();

export const getShadowDenials = () =>
  Array.from(shadowSeen.values()).sort((a, b) => b.count - a.count);

export const scopeGate = async (req: any, res: any, next: any) => {
  const path = req.path || '';
  const match = SCOPED_API_ROUTES.find((r) => r.pattern.test(path));
  if (!match || !req.user) return next();

  let allowed = true;
  try {
    allowed = (await loadScopes(req.user)).has(match.scope);
  } catch {
    // A lookup failure must not masquerade as a denial while shadowing, and must
    // not silently open the route while enforcing.
    allowed = !ENFORCING;
  }
  if (allowed) return next();

  const who = req.user.username || req.user.email || req.user.id;
  const role = String(req.user.role || 'unknown');

  if (!ENFORCING) {
    const key = `${req.method} ${path}|${role}`;
    const now = new Date().toISOString();
    const seen = shadowSeen.get(key);
    if (seen) {
      seen.count += 1;
      seen.lastAt = now;
    } else {
      shadowSeen.set(key, { route: `${req.method} ${path}`, role, scope: match.scope, count: 1, firstAt: now, lastAt: now });
      // Printed only the FIRST time, so the console shows the distinct list.
      console.warn(`[access] SHADOW would deny ${role} ${req.method} ${path} — needs ${match.scope}`);
    }
    return next();
  }

  console.warn(`[access] denied ${who} (${role}) ${req.method} ${path} — needs ${match.scope}`);
  return res.status(403).json({ error: 'Insufficient permissions' });
};
