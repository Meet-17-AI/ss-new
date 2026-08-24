/**
 * A client's therapist and price history, derived from their bookings.
 *
 * There is no "current therapist" or "current price" column anywhere — a client
 * is not a row that gets updated, they are a sequence of bookings. So "current"
 * means the most recent booking, and "previous" means the last one that was
 * DIFFERENT. That second part is the whole point: a client with six sessions at
 * the same price and the same therapist has no previous anything, and showing
 * them their own current values twice would say nothing.
 *
 * Shared by the overview cards and the Therapists/Pricing tabs so the summary at
 * the top can never disagree with the table below it.
 */

export interface ClientBooking {
  booking_id?: string;
  booking_host_name?: string | null;
  booking_host_email?: string | null;
  booking_resource_name?: string | null;
  booking_subject?: string | null;
  booking_status?: string;
  booking_invitee_time?: string | null;
  booking_start_at_raw?: string | null;
  booking_mode?: string | null;
  mode?: string | null;
  invitee_payment_amount?: number | string | null;
  invitee_payment_currency?: string | null;
  quoted_amount?: number | string | null;
  price_source?: string | null;
  wallet_amount_applied?: number | string | null;
  refund_amount?: number | string | null;
}

/** A change of therapist or price, with the current value and the one before it. */
export interface Change<T> {
  current: T | null;
  previous: T | null;
}

const time = (b: ClientBooking): number => {
  const raw = b.booking_start_at_raw;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Most recent first. Bookings arrive sorted, but nothing here should rely on it. */
export const byNewest = (list: ClientBooking[]): ClientBooking[] =>
  [...list].sort((a, b) => time(b) - time(a));

/**
 * A cancelled session says nothing about who a client sees or what they pay — it
 * is the booking that did not happen. Counting one would let a cancellation
 * rewrite the current therapist.
 */
export const isCountable = (b: ClientBooking): boolean =>
  b.booking_status !== 'cancelled' && b.booking_status !== 'awaiting_payment';

export const amountOf = (b: ClientBooking): number | null => {
  // quoted_amount is the fallback: a session booked but not yet paid still has a
  // price, and showing nothing there would read as free.
  const raw = b.invitee_payment_amount ?? b.quoted_amount;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const formatMoney = (n: number | null, currency?: string | null): string => {
  if (n === null) return '—';
  const symbol = !currency || /inr/i.test(currency) ? '₹' : `${currency} `;
  return `${symbol}${n.toLocaleString('en-IN')}`;
};

/** Readable session name, matching how the bookings table labels a row. */
export const sessionLabel = (b: ClientBooking): string => {
  const name = b.booking_resource_name || '';
  const looksLikeMode = /^(in-person|online|offline)\s*\(/i.test(name.trim());
  const source = looksLikeMode && b.booking_subject ? b.booking_subject : name;
  return source.replace(/ with .+$/i, '').trim() || name || 'Session';
};

/** The date shown against a booking, preferring the text the rest of the UI uses. */
export const bookingDate = (b: ClientBooking): string => {
  if (b.booking_start_at_raw) {
    const d = new Date(b.booking_start_at_raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  return b.booking_invitee_time || '—';
};

export interface TherapistSpell {
  name: string;
  sessions: number;
  firstAt: number;
  lastAt: number;
  /** Whether this is who the client is with now. */
  isCurrent: boolean;
}

/**
 * Every therapist this client has seen, most recent first.
 *
 * Grouped by name rather than by id because that is what the booking carries
 * consistently — therapist_id is null on older rows, and a name that renders is
 * more useful here than an id that resolves for some sessions and not others.
 */
export function therapistHistory(bookings: ClientBooking[]): TherapistSpell[] {
  const rows = byNewest(bookings.filter(isCountable));
  const seen = new Map<string, TherapistSpell>();

  for (const b of rows) {
    const name = (b.booking_host_name || '').trim();
    if (!name) continue;
    const at = time(b);
    const hit = seen.get(name);
    if (hit) {
      hit.sessions += 1;
      hit.firstAt = Math.min(hit.firstAt, at);
      hit.lastAt = Math.max(hit.lastAt, at);
    } else {
      seen.set(name, { name, sessions: 1, firstAt: at, lastAt: at, isCurrent: false });
    }
  }

  const list = Array.from(seen.values()).sort((a, b) => b.lastAt - a.lastAt);
  if (list.length) list[0].isCurrent = true;
  return list;
}

/** Who they see now, and who they saw before that — null when there is no change. */
export function therapistChange(bookings: ClientBooking[]): Change<string> {
  const list = therapistHistory(bookings);
  return { current: list[0]?.name ?? null, previous: list[1]?.name ?? null };
}

export interface PricePoint {
  amount: number;
  currency: string | null;
  at: number;
  booking: ClientBooking;
}

/** Every session that carried a price, most recent first. */
export function priceHistory(bookings: ClientBooking[]): PricePoint[] {
  return byNewest(bookings.filter(isCountable))
    .map((b) => {
      const amount = amountOf(b);
      return amount === null
        ? null
        : { amount, currency: b.invitee_payment_currency ?? null, at: time(b), booking: b };
    })
    .filter((p): p is PricePoint => p !== null);
}

/**
 * What they pay now, and what they paid before it changed.
 *
 * `previous` is the most recent DIFFERENT amount, not simply the second-newest
 * booking — six sessions at ₹1500 followed by one at ₹1800 should read
 * "now ₹1800, was ₹1500", not "now ₹1800, was ₹1800".
 */
export function priceChange(bookings: ClientBooking[]): Change<PricePoint> {
  const points = priceHistory(bookings);
  const current = points[0] ?? null;
  if (!current) return { current: null, previous: null };
  const previous = points.find((p) => p.amount !== current.amount) ?? null;
  return { current, previous };
}
