/**
 * UI-side copies of permission rules the server enforces.
 *
 * These decide whether a control is worth SHOWING. The server decides whether
 * the action is allowed — every rule here has a counterpart in
 * panel-backend/src/index.ts, and that one is the control.
 */

/**
 * Who may disconnect a Google Calendar. Mirrors CALENDAR_DISCONNECT_USERS on the
 * backend.
 *
 * Not a role check: the AI team signs in as `admin`, the same role as the clinic
 * admins it has to be told apart from. Admins and therapists may still CONNECT a
 * calendar — only breaking an existing link is reserved, because a dropped
 * refresh token stops bookings syncing with nothing on screen to explain it.
 */
const CALENDAR_DISCONNECT_USERS = ['aiteam@fluid.live', 'aiteam'];

export const canDisconnectCalendar = (user: any): boolean =>
  Boolean(user) &&
  [user?.email, user?.username].some(
    (id: any) => id && CALENDAR_DISCONNECT_USERS.includes(String(id).toLowerCase())
  );

/* -------------------------------------------------------------------------- */
/* Dashboard access                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A scope is a dashboard someone may open. It is NOT a role: a therapist granted
 * admin access keeps `role: 'therapist'` and gains `admin_dashboard`, because
 * swapping the role would mean issuing a token that lies about who is holding it.
 *
 * Mirrors panel-backend/src/lib/access.ts. That file is the control.
 */
export type Scope = 'admin_dashboard' | 'therapist_dashboard' | 'crm';

export const SCOPE_LABEL: Record<Scope, string> = {
  admin_dashboard: 'Admin dashboard',
  therapist_dashboard: 'Therapist dashboard',
  crm: 'CRM',
};

/** Where each dashboard lives, so the switcher and the redirects agree. */
export const SCOPE_PATH: Record<Scope, string> = {
  admin_dashboard: '/admin',
  therapist_dashboard: '/therapist',
  crm: '/crm',
};

/**
 * The CRM runs as a SEPARATE application on its own origin, so reaching it is a
 * page load rather than a route change — and its origin cannot read this one's
 * stored token. See handoffToCrm below for how the session travels.
 *
 * Empty means "not configured": the switcher then falls back to the panel's own
 * embedded /crm, which is what existed before the split.
 */
export const CRM_APP_URL: string =
  (import.meta as any).env?.VITE_CRM_URL || 'http://localhost:3000';

/** Scopes served by a different origin, so callers know a link will not do. */
export const isExternalScope = (scope: Scope): boolean => scope === 'crm' && Boolean(CRM_APP_URL);

/**
 * Move the signed-in session to the CRM.
 *
 * Asks this backend for a one-time ticket, then navigates with it in the URL
 * FRAGMENT — fragments are never sent to a server, so it stays out of access logs
 * and Referer headers. The CRM exchanges it for its own session.
 *
 * The ticket is not the session token. It is single-use, expires in 60 seconds,
 * and is useless once redeemed, so a copy left in browser history grants nothing.
 */
export async function handoffToCrm(): Promise<void> {
  const res = await fetch('/api/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'crm' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ticket) {
    throw new Error(data?.error || `Could not open the CRM (HTTP ${res.status})`);
  }
  window.location.href = `${CRM_APP_URL.replace(/\/$/, '')}/#t=${encodeURIComponent(data.ticket)}`;
}

/** Order used everywhere a set of scopes is shown, so lists never reshuffle. */
export const SCOPE_ORDER: Scope[] = ['admin_dashboard', 'therapist_dashboard', 'crm'];

export const sortScopes = (scopes: Scope[]): Scope[] =>
  SCOPE_ORDER.filter((s) => scopes.includes(s));

/**
 * Where to land someone who has not asked for a particular page.
 *
 * Driven by what they hold rather than by their role — a therapist granted admin
 * access would otherwise be bounced back to /therapist by every redirect in the
 * app, fighting the switcher they just used.
 */
export const defaultPathForScopes = (scopes: Scope[], role?: string): string => {
  if (String(role || '').toLowerCase() === 'fluidadmin') return '/automation-logs';
  const first = sortScopes(scopes)[0];
  return first ? SCOPE_PATH[first] : '/login';
};
