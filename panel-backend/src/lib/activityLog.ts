import pool from './db';

/**
 * Request-level activity logging.
 *
 * DESIGN NOTE — we log the FACT of an action, never its contents.
 *
 * This panel handles therapy data: session notes, case histories, SOS
 * assessments, presenting concerns. Capturing request bodies would turn this
 * table into a second, less-protected copy of the most sensitive records in the
 * system, readable by anyone who reaches the logs UI and retained indefinitely.
 *
 * So metadata is built from an ALLOWLIST of harmless identifiers (ids, statuses,
 * amounts). Anything not on the list is dropped — including any field added to a
 * request in future, which is the point: new clinical fields cannot silently
 * start being logged.
 */

export type ActivityCategory =
  | 'admin'
  | 'therapist'
  | 'sales'
  | 'public_booking'
  | 'system';

export interface ActivityEntry {
  category: ActivityCategory;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  method: string;
  route: string;
  path: string;
  entityType?: string | null;
  entityId?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Body/query keys safe to record. Deliberately narrow: identifiers, states and
 * amounts. Never free text, never anything clinical.
 */
const SAFE_KEYS = new Set([
  'booking_id', 'bookingId', 'therapist_id', 'therapistId', 'client_id', 'clientId',
  'lead_id', 'leadId', 'user_id', 'userId', 'service_id', 'serviceId', 'ticket_id',
  'schedule_id', 'scheduleId', 'session_id', 'sessionId', 'id',
  'status', 'booking_status', 'payment_status', 'refund_status', 'stage',
  'pipeline_stage', 'component', 'role', 'user_role', 'is_active', 'active',
  'amount', 'invitee_payment_amount', 'refund_amount', 'currency',
  'razorpay_order_id', 'razorpay_payment_id', 'payment_gateway', 'payment_mode',
  'start', 'end', 'date', 'limit', 'offset', 'page',
]);

/**
 * Keys that must never be recorded even if a name collides with the allowlist.
 * Checked first, and by substring, so `new_password`, `otpToken` etc. are caught.
 */
const FORBIDDEN_FRAGMENTS = [
  'password', 'passwd', 'secret', 'token', 'otp', 'auth', 'credential', 'apikey',
  'api_key', 'note', 'notes', 'description', 'concern', 'history', 'diagnosis',
  'assessment', 'documentation', 'form_data', 'message', 'body', 'content',
  'email', 'phone', 'contact', 'address', 'name',
];

const isForbidden = (key: string): boolean => {
  const k = key.toLowerCase();
  return FORBIDDEN_FRAGMENTS.some((f) => k.includes(f));
};

/** Build a small, safe metadata object from a request's params/query/body. */
export function extractSafeMetadata(req: any): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};

  for (const source of [req.params, req.query, req.body]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (isForbidden(key)) continue;
      if (!SAFE_KEYS.has(key)) continue;
      // Scalars only — objects and arrays can nest anything.
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        const str = String(value);
        if (str.length <= 128) out[key] = value;
      }
    }
  }

  // Record the SHAPE of the payload without its content, which is what makes a
  // log useful for "what did they change" without exposing what it changed to.
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const keys = Object.keys(req.body);
    if (keys.length > 0) {
      out._fields = keys.length;
      out._fieldNames = keys.filter((k) => !isForbidden(k)).slice(0, 20);
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Derive the log category from the authenticated actor, if any. */
export function categoryForRole(role?: string | null): ActivityCategory {
  switch (String(role || '').toLowerCase()) {
    case 'admin':
    case 'superadmin':
    case 'fluidadmin':
      return 'admin';
    case 'therapist':
      return 'therapist';
    case 'sales':
      return 'sales';
    default:
      return 'public_booking';
  }
}

/**
 * Write an entry. Fire-and-forget: a logging failure must never break or slow
 * the request that triggered it.
 */
export function logActivity(entry: ActivityEntry): void {
  pool
    .query(
      `INSERT INTO activity_logs
         (category, actor_id, actor_name, actor_role, action, method, route, path,
          entity_type, entity_id, status_code, duration_ms, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        entry.category,
        entry.actorId ?? null,
        entry.actorName ?? null,
        entry.actorRole ?? null,
        entry.action,
        entry.method,
        entry.route,
        entry.path,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.statusCode ?? null,
        entry.durationMs ?? null,
        entry.ipAddress ?? null,
        entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    )
    .catch((err) => {
      console.error('[activityLog] write failed:', err?.message || err);
    });
}
