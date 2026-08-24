/**
 * Moving a client from one therapist to another.
 *
 * THE CENTRAL IDEA — a transfer is not an UPDATE, it is a handover.
 *
 * The version this replaces ran one UPDATE over every booking the client had
 * ever made. That is wrong in three separate ways, and each one is a data loss:
 *
 *   1. Past bookings record WHO DELIVERED the session. Rewriting them moves the
 *      old therapist's completed sessions — and their revenue, which the stats
 *      endpoints compute live from booking_host_name — onto someone who never
 *      did that work.
 *   2. A therapist reaches a client's clinical records only through a booking
 *      of their own (mayAccessClientRecords). Moving every booking therefore
 *      revokes the old therapist's access to notes THEY wrote, including notes
 *      for a session they delivered yesterday and have not written up yet.
 *   3. The client profile derives "current therapist" and "previous therapist"
 *      from the booking history. Rewriting it erases the handover from the one
 *      place a clinician would look for it.
 *
 * So only FUTURE, slot-holding bookings move. The past is a record, not a
 * pointer.
 *
 * ── On atomicity ────────────────────────────────────────────────────────────
 * A transfer spans Postgres and Google Calendar, and those cannot be committed
 * together. This module does not pretend otherwise. Instead:
 *
 *   * database writes happen in ONE transaction
 *   * external effects happen after commit, each recorded per booking
 *   * an idempotency key makes a retry safe
 *   * the caller is handed a per-booking outcome, never a blanket "success"
 *
 * The ORDER of the calendar work is load-bearing and is explained at
 * moveCalendarEvent().
 */

import type { PoolClient } from 'pg';
import { getBookingStartMs } from './timezone';
import {
  AvailabilityContext, Conflict, assessSlot, suggestSlots, suggestAcrossDays,
  istDateOf, holdsASlot,
} from './slots';
import { buildClientKey, isWalletEligible, creditWallet, getBalance } from './wallet';
import { resolveServiceIdFromLabel, resolvePrice } from './pricing';

const MINUTE = 60000;
const DEFAULT_DURATION_MIN = 50;

/**
 * Anything that can run a query — the pool, or a client inside a transaction.
 *
 * Typed with a real call signature rather than `Function`, so that handing one
 * of these to the pricing helpers typechecks. `{ query: Function }` does not:
 * `Function` carries no signature, so TypeScript cannot prove it accepts
 * (text, params) and rejects the call.
 */
type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * What actually happens to a session's money if it is cancelled.
 *
 * These are not policy choices made here — they are what /api/cancel-booking
 * will really do, restated so the wizard can show the truth BEFORE the admin
 * commits. A dialog that promises "credited to wallet" while the code path
 * issues a gateway refund, or does nothing at all, is worse than no dialog.
 */
export type MoneyOutcome =
  | 'wallet_credit'   // cash / QR / wallet-settled → held as credit
  | 'gateway_refund'  // Razorpay, more than 24h out → real refund
  | 'forfeit'         // Razorpay, inside 24h → no refund AND no credit
  | 'nothing';        // never paid, so nothing to return

export interface MoneyAssessment {
  outcome: MoneyOutcome;
  amount: number;
  currency: string;
  gateway: string | null;
  /** Whether THIS module may perform the cancellation. See below. */
  cancellable: boolean;
  detail: string;
}

/**
 * Why 'gateway_refund' is not cancellable here:
 *
 * Issuing a Razorpay refund correctly means reading the gateway keys, calling
 * the API, recording refund_id/refund_amount/refund_initiated_at, and feeding
 * the refund_cancellation trigger. All of that already exists, once, inside
 * /api/cancel-booking. Reproducing it would create a second refund path to keep
 * in step with the first, and refunds are the last place in this codebase that
 * should have two implementations.
 *
 * So the wizard tells the admin to cancel that session through the existing
 * flow first, and transfers the rest. Honest and safe beats convenient.
 */
export function assessMoney(booking: any, nowMs: number = Date.now()): MoneyAssessment {
  const amount = Number(booking.invitee_payment_amount) || 0;
  const currency = booking.invitee_payment_currency || 'INR';
  const gateway = booking.invitee_payment_gateway || null;
  const paid = String(booking.payment_status || '').toLowerCase().trim() === 'paid';

  if (isWalletEligible(booking)) {
    return {
      outcome: 'wallet_credit', amount, currency, gateway, cancellable: true,
      detail: `₹${amount} will be held as wallet credit for the client.`,
    };
  }

  const hasGatewayPayment = Boolean(booking.payment_id) && booking.payment_id !== 'manual_bypass';
  if (paid && amount > 0 && hasGatewayPayment) {
    const startMs = getBookingStartMs(booking.booking_invitee_time);
    const hoursOut = startMs === null ? null : (startMs - nowMs) / (60 * MINUTE);
    const insideDay = hoursOut === null ? true : hoursOut <= 24;

    if (insideDay) {
      return {
        outcome: 'forfeit', amount, currency, gateway, cancellable: false,
        detail: `Paid by ${gateway || 'gateway'} and starts within 24 hours — cancelling returns nothing to the client. Reschedule instead, or cancel from the Appointments page if the client has agreed to forfeit.`,
      };
    }
    return {
      outcome: 'gateway_refund', amount, currency, gateway, cancellable: false,
      detail: `Paid by ${gateway || 'gateway'} — cancelling issues a real refund. Do that from the Appointments page first, then transfer.`,
    };
  }

  return {
    outcome: 'nothing', amount, currency, gateway, cancellable: true,
    detail: amount > 0
      ? 'This session was never paid, so there is nothing to return.'
      : 'No payment is attached to this session.',
  };
}

/**
 * Did money actually reach us for this session?
 *
 * THIS IS A MONEY GUARD, and it is deliberately built on POSITIVE evidence.
 *
 * The tempting test is `invitee_payment_amount > 0`, and it is wrong: that
 * column is the session's PRICE, written at booking time whether or not anyone
 * paid. Using it as proof of payment is how a transfer to a cheaper therapist
 * ends up crediting a client's wallet for money that was never collected —
 * inventing spendable balance out of a quote.
 *
 * The tempting correction is `payment_status = 'paid'`, and it is also wrong
 * here: that column is NULL on the large majority of rows in this database, so
 * testing it directly would answer "unpaid" for almost everything.
 *
 * So this asks assessMoney instead, and keys off its ONE negative branch.
 * 'nothing' is the fallback assessMoney reaches when it could confirm neither a
 * wallet-eligible settlement nor a live gateway payment id — that is precisely
 * "no payment reached us". Every other outcome was reached by confirming one.
 *
 * 'forfeit' counts as PAID, which is easy to get wrong. The money was collected;
 * the only thing that outcome describes is that the 24-hour rule would return
 * nothing if the session were CANCELLED. A price correction is not a
 * cancellation, so a client who paid ₹1700 and is moved to a ₹1200 therapist is
 * owed the difference whether or not their session starts tomorrow. Excluding it
 * would re-price the booking downward and hand back nothing.
 *
 * Anything uncertain therefore counts as UNPAID, which fails toward never moving
 * money that may not exist.
 */
export function wasActuallyPaid(money: MoneyAssessment): boolean {
  return money.outcome !== 'nothing';
}

// ---------------------------------------------------------------------------
// Finding the client's bookings
// ---------------------------------------------------------------------------

export interface ClientRef {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Every booking belonging to this client.
 *
 * Phone is compared on DIGITS ONLY. The panel stores +919876543210,
 * 919876543210 and bare ten-digit numbers interchangeably, so exact equality —
 * which the old endpoint used — silently matches a SUBSET of a client's
 * bookings. A transfer that moves some of a client's sessions and leaves others
 * behind is worse than one that fails outright, because nothing reports it.
 *
 * An empty email is never matched, so a client with no address on file cannot
 * sweep up every other booking that also has none.
 */
export async function findClientBookings(
  db: Queryable,
  client: ClientRef
): Promise<any[]> {
  const email = (client.email || '').trim();
  const phone = (client.phone || '').trim();
  if (!email && !phone) return [];

  const { rows } = await db.query(
    `SELECT *
       FROM bookings
      WHERE ($1::text <> '' AND LOWER(invitee_email) = LOWER($1::text))
         OR ($2::text <> '' AND invitee_phone IS NOT NULL
             AND regexp_replace(invitee_phone, '[^0-9]', '', 'g')
               = regexp_replace($2::text, '[^0-9]', '', 'g'))
      ORDER BY booking_start_at DESC`,
    [email, phone]
  );
  return rows;
}

export interface SplitBookings {
  past: any[];
  upcoming: any[];
  /** Bookings whose time could not be parsed — never moved silently. */
  unknown: any[];
}

/**
 * Split into what stays and what moves.
 *
 * "Upcoming" means the session has not started AND still holds its slot. A
 * cancelled or no-show session is history even when its date is in the future,
 * and moving it would hand the new therapist a session that will never happen.
 *
 * A booking whose time cannot be parsed goes to `unknown` rather than being
 * guessed into either bucket. The caller surfaces those instead of moving them.
 */
export function splitByTime(
  bookings: any[],
  fromTherapistId: string | null,
  fromTherapistName: string | null,
  nowMs: number = Date.now()
): SplitBookings {
  const past: any[] = [];
  const upcoming: any[] = [];
  const unknown: any[] = [];

  for (const b of bookings) {
    const belongsToSource = fromTherapistId
      ? String(b.therapist_id ?? '') === String(fromTherapistId)
      : String(b.booking_host_name || '').trim().toLowerCase()
          === String(fromTherapistName || '').trim().toLowerCase();
    if (!belongsToSource) { past.push(b); continue; }

    if (!holdsASlot(b.booking_status)) { past.push(b); continue; }

    const startMs = getBookingStartMs(b.booking_invitee_time);
    if (startMs === null) { unknown.push(b); continue; }
    if (startMs <= nowMs) { past.push(b); continue; }
    upcoming.push({ ...b, __startMs: startMs });
  }

  upcoming.sort((a, b) => a.__startMs - b.__startMs);
  return { past, upcoming, unknown };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface SessionPlan {
  bookingId: string;
  sessionName: string;
  whenText: string;
  startMs: number;
  durationMin: number;
  mode: string | null;
  status: string;
  conflict: Conflict;
  /** Instants, earliest first. Empty when the therapist has no room at all. */
  suggestedSlots: number[];
  suggestionsAreLaterDays: boolean;
  money: MoneyAssessment;
  /**
   * New price minus old price.
   * > 0: Upgrade (client owes money).
   * < 0: Downgrade (client gets refund).
   * 0: Same price.
   */
  priceDifference: number;
  /**
   * Whether money actually reached us for this session. A price difference only
   * moves money when this is true — see wasActuallyPaid().
   */
  paidFor: boolean;
  /** Whether the price difference itself is what blocks this session. */
  blockedByPrice: boolean;
  /** Explanation of the price difference for the UI. */
  priceMessage?: string;
  /** What the wizard should preselect. */
  recommendedAction: 'keep' | 'move' | 'cancel' | 'blocked';
}

export interface TransferPreview {
  client: { name: string | null; email: string | null; phone: string | null };
  fromTherapist: { id: string | null; name: string | null };
  toTherapist: {
    id: string; name: string;
    hasCalendar: boolean; hasSchedule: boolean; offersTherapy: boolean;
  };
  pastCount: number;
  past: { bookingId: string; whenText: string; therapistName: string; status: string }[];
  upcoming: SessionPlan[];
  unknown: { bookingId: string; whenText: string }[];
  blockers: string[];
  warnings: string[];
}

export interface PreviewDeps {
  db: Queryable;
  /** Google busy blocks for the target therapist; [] when not connected. */
  availability: AvailabilityContext;
}

export async function buildPreview(
  deps: PreviewDeps,
  args: {
    client: ClientRef;
    fromTherapistId: string | null;
    fromTherapistName: string | null;
    toTherapist: any;
    nowMs?: number;
  }
): Promise<TransferPreview> {
  const { db, availability } = deps;
  const nowMs = args.nowMs ?? Date.now();

  const all = await findClientBookings(db, args.client);
  const { past, upcoming, unknown } = splitByTime(
    all, args.fromTherapistId, args.fromTherapistName, nowMs
  );

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!availability.hasSchedule) {
    warnings.push(
      `${args.toTherapist.name} has no working hours configured, so their availability cannot be checked. ` +
      `Sessions can still be moved, but conflicts will not be detected.`
    );
  }
  if (!availability.hasCalendar) {
    warnings.push(
      `${args.toTherapist.name} has no connected Google Calendar. Sessions will move in the panel, ` +
      `but no calendar event will be created for them.`
    );
  }
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.length} booking(s) have an unreadable session time and will be left with the current therapist.`
    );
  }

  const plans: SessionPlan[] = [];
  for (const b of upcoming) {
    const durationMin = b.booking_duration || DEFAULT_DURATION_MIN;
    const startMs: number = b.__startMs;

    const conflict = availability.hasSchedule
      ? assessSlot(availability, startMs, durationMin, b.booking_id)
      : { kind: 'no_schedule' as const, detail: 'Availability unknown — no working hours configured.' };

    // Suggestions come from the SAME engine that produced the verdict above, so
    // an offered slot cannot be one the check would reject.
    let suggestedSlots: number[] = [];
    let suggestionsAreLaterDays = false;
    if (conflict.kind !== 'none' && availability.hasSchedule) {
      suggestedSlots = suggestSlots(availability, istDateOf(startMs), durationMin, {
        notBeforeMs: nowMs, limit: 8, excludeBookingId: b.booking_id,
      });
      if (suggestedSlots.length === 0) {
        suggestedSlots = suggestAcrossDays(availability, nowMs, 14, durationMin, {
          limit: 8, excludeBookingId: b.booking_id,
        });
        suggestionsAreLaterDays = suggestedSlots.length > 0;
      }
    }

    const money = assessMoney(b, nowMs);

    const sName = sessionNameOf(b);
    // Services are keyed by the VARCHAR therapist_id. `toTherapist.id` is the
    // table's integer primary key, and passing it resolved no service at all —
    // so the preview reported "no price change" every single time while execute,
    // which used the right key, went on to find a real difference. The admin was
    // shown one thing and the server did another.
    const newServiceId = await resolveServiceIdFromLabel(db, String(args.toTherapist.therapist_id), sName);
    const paidFor = wasActuallyPaid(money);

    let newPrice = money.amount;
    if (newServiceId && money.amount > 0) {
      const priceRes = await resolvePrice(db, {
        serviceId: newServiceId,
        clientEmail: args.client.email,
        clientPhone: args.client.phone,
        at: new Date(nowMs)
      });
      newPrice = priceRes.amount;
    }

    const priceDifference = newPrice - money.amount;
    let priceMessage = '';
    if (priceDifference > 0) {
      priceMessage = paidFor
        ? `${args.toTherapist.name} charges ₹${priceDifference.toLocaleString('en-IN')} more for this session, and the client has already paid. Cancel and settle it instead, then rebook.`
        : `This session will be re-quoted at ₹${newPrice.toLocaleString('en-IN')} — nothing has been paid for it yet.`;
    } else if (priceDifference < 0) {
      priceMessage = paidFor
        ? `₹${Math.abs(priceDifference).toLocaleString('en-IN')} will be returned to the client's wallet.`
        : `This session will be re-quoted at ₹${newPrice.toLocaleString('en-IN')}. No refund is due — nothing has been paid for it yet.`;
    }

    // Only a session that was actually PAID for can be blocked over an upgrade:
    // there is money on it that the wizard cannot collect the shortfall against.
    // An unpaid session is simply re-quoted at the new therapist's price.
    const blockedByPrice = paidFor && priceDifference > 0;

    let recommendedAction: SessionPlan['recommendedAction'];
    if (blockedByPrice) recommendedAction = 'blocked';
    else if (conflict.kind === 'none' || conflict.kind === 'no_schedule') recommendedAction = 'keep';
    else if (suggestedSlots.length > 0) recommendedAction = 'move';
    else if (money.cancellable) recommendedAction = 'cancel';
    else recommendedAction = 'blocked';

    if (recommendedAction === 'blocked') {
      if (blockedByPrice) {
        blockers.push(
          `"${sName}" is already paid for and ${args.toTherapist.name} charges ` +
          `₹${priceDifference.toLocaleString('en-IN')} more. Cancel and settle it here, then rebook at the new price.`
        );
      } else {
        blockers.push(
          `"${sName}" on ${b.booking_invitee_time || 'an unknown date'} clashes with ` +
          `${args.toTherapist.name}'s schedule, has no alternative slot in the next 14 days, and ` +
          `cannot be cancelled here — ${money.detail}`
        );
      }
    }

    plans.push({
      bookingId: b.booking_id,
      sessionName: sName,
      whenText: b.booking_invitee_time || '',
      startMs,
      durationMin,
      mode: b.booking_mode || null,
      status: b.booking_status,
      conflict,
      suggestedSlots,
      suggestionsAreLaterDays,
      money,
      priceDifference,
      paidFor,
      blockedByPrice,
      priceMessage,
      recommendedAction,
    });
  }

  return {
    client: {
      name: args.client.name ?? null,
      email: args.client.email ?? null,
      phone: args.client.phone ?? null,
    },
    fromTherapist: { id: args.fromTherapistId, name: args.fromTherapistName },
    toTherapist: {
      id: String(args.toTherapist.therapist_id),
      name: args.toTherapist.name,
      hasCalendar: availability.hasCalendar,
      hasSchedule: availability.hasSchedule,
      offersTherapy: true, // resolved by the caller, which holds the pricing helpers
    },
    pastCount: past.length,
    past: past.slice(0, 50).map((b: any) => ({
      bookingId: b.booking_id,
      whenText: b.booking_invitee_time || '',
      therapistName: b.booking_host_name || '',
      status: b.booking_status,
    })),
    upcoming: plans,
    unknown: unknown.map((b: any) => ({
      bookingId: b.booking_id,
      whenText: b.booking_invitee_time || '',
    })),
    blockers,
    warnings,
  };
}

/** Readable session name, matching how the client profile labels a row. */
export function sessionNameOf(b: any): string {
  const name = b.booking_resource_name || '';
  const looksLikeMode = /^(in-person|online|offline)\s*\(/i.test(name.trim());
  const source = looksLikeMode && b.booking_subject ? b.booking_subject : name;
  return source.replace(/ with .+$/i, '').trim() || name || 'Session';
}

/** Render an instant the way booking_invitee_time is stored. */
export function formatInviteeTime(startMs: number, durationMin: number): string {
  const start = new Date(startMs);
  const end = new Date(startMs + durationMin * MINUTE);
  const datePart = start.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
  return `${datePart} at ${fmt(start)} - ${fmt(end)} IST`;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export type DecisionAction = 'keep' | 'move' | 'cancel';

export interface Decision {
  bookingId: string;
  action: DecisionAction;
  /** Required when action is 'move'. An absolute instant. */
  newStartMs?: number;
}

export interface BookingOutcome {
  bookingId: string;
  action: DecisionAction;
  moved: boolean;
  calendar: 'moved' | 'created' | 'removed' | 'skipped' | 'failed';
  calendarDetail?: string;
  walletCredited?: number;
  error?: string;
}

export interface CalendarDeps {
  /** Resolve an authenticated calendar for a therapist row, or null. */
  getCalendarFor: (therapist: any) => Promise<any | null>;
  /** The privacy-preserving insert used everywhere else. Never hand-roll this. */
  insertEvent: (calendar: any, opts: any) => Promise<{ eventId: string | null; meetLink: string }>;
  /** Masked address for the client — never their real one on a therapist calendar. */
  resolveMasked: (maskId: any, realEmail: string | null) => Promise<string | null>;
  canonicalLabel: (raw: string | null | undefined) => string;
}

/**
 * ── The calendar handover, in two halves ────────────────────────────────────
 *
 * These are deliberately NOT one function, because the two halves must straddle
 * the database transaction and a single call could not sit in both places.
 *
 * WHY THE ORDER IS NOT NEGOTIABLE:
 *
 * getCalendarClientForBooking() decides WHOSE calendar to open by reading
 * bookings.therapist_id. So the delete must happen while that column still
 * names the OLD therapist. Update the row first and the old event becomes
 * unreachable forever: it stays on the old therapist's calendar, keeps showing
 * them a session they are not taking, and keeps their free/busy blocked so the
 * slot cannot be rebooked. Google has no "move between accounts" operation, and
 * the cancel path treats a 404 as success — so getting the order wrong fails
 * completely silently.
 *
 * The create, by contrast, must happen AFTER commit: it is a network round trip,
 * and holding a pooled connection open across one is how a five-connection pool
 * becomes an outage.
 *
 *   removeOldEvent()  ->  BEGIN … COMMIT  ->  createNewEvent()
 */
export async function removeOldEvent(
  deps: CalendarDeps,
  booking: any,
  fromTherapist: any
): Promise<{ removed: boolean; detail?: string }> {
  if (!booking.google_event_id) return { removed: false, detail: 'No calendar event on this booking.' };
  if (!fromTherapist?.google_refresh_token) {
    return { removed: false, detail: 'The previous therapist has no connected calendar; nothing to remove.' };
  }
  try {
    const cal = await deps.getCalendarFor(fromTherapist);
    if (!cal) return { removed: false, detail: 'Could not open the previous therapist\'s calendar.' };
    await cal.events.delete({
      calendarId: 'primary', eventId: booking.google_event_id, sendUpdates: 'none',
    });
    return { removed: true };
  } catch (err: any) {
    const code = err?.code || err?.response?.status;
    // Already gone is the outcome we wanted anyway.
    if (code === 404 || code === 410) return { removed: true };
    console.error(
      `[transfer] could not remove event ${booking.google_event_id} from ${fromTherapist?.name}:`,
      err?.message || err
    );
    return {
      removed: false,
      detail: `The old calendar event could not be removed from ${fromTherapist?.name}'s calendar and may still show there.`,
    };
  }
}

/**
 * Put the session on the new therapist's calendar.
 *
 * A new event means a NEW Meet link. The caller MUST write it back to
 * booking_joining_link, or the client joins a dead room.
 */
export async function createNewEvent(
  deps: CalendarDeps,
  booking: any,
  fromTherapist: any,
  toTherapist: any,
  when: { startMs: number; durationMin: number }
): Promise<{ eventId: string | null; meetLink: string; status: BookingOutcome['calendar']; detail?: string }> {
  if (!toTherapist?.google_refresh_token) {
    return {
      eventId: null, meetLink: '', status: 'skipped',
      detail: `${toTherapist?.name || 'The new therapist'} has no connected Google Calendar, so no event was created.`,
    };
  }

  try {
    const cal = await deps.getCalendarFor(toTherapist);
    if (!cal) {
      return {
        eventId: null, meetLink: '', status: 'skipped',
        detail: 'Could not open the new therapist\'s calendar.',
      };
    }

    const isOnline = String(booking.booking_mode || '').toLowerCase().includes('online');
    const maskedEmail = await deps.resolveMasked(booking.mask_id, booking.invitee_email || null);
    const startISO = new Date(when.startMs).toISOString();
    const endISO = new Date(when.startMs + when.durationMin * MINUTE).toISOString();

    const ev = await deps.insertEvent(cal, {
      therapyLabel: deps.canonicalLabel(sessionNameOf(booking)),
      clientName: booking.invitee_name || 'Client',
      mode: booking.booking_mode || (isOnline ? 'Online Video Call' : 'In Person (Pune)'),
      notes: `Transferred from ${fromTherapist?.name || 'a previous therapist'}.`,
      maskedEmail,
      startISO,
      endISO,
      isOnline,
      location: booking.booking_mode || 'SafeStories, Pune',
    });

    return {
      eventId: ev.eventId,
      meetLink: ev.meetLink,
      // 'moved' only when there was an old event to displace; otherwise this is
      // the session's first calendar entry and saying "moved" would misreport it.
      status: booking.google_event_id ? 'moved' : 'created',
    };
  } catch (err: any) {
    return {
      eventId: null, meetLink: '', status: 'failed',
      detail: `The calendar event could not be created for ${toTherapist?.name}: ${err?.message || err}. This session is not on their calendar yet.`,
    };
  }
}

/**
 * Has this exact transfer already run?
 *
 * Checked before any work begins, so a double-clicked confirm or a retried
 * request returns the first result instead of deleting and re-creating calendar
 * events a second time. The unique index on idempotency_key is what makes this
 * safe against two requests racing rather than merely arriving in sequence.
 */
export async function findExistingTransfer(
  db: Queryable,
  idempotencyKey: string
): Promise<any | null> {
  if (!idempotencyKey) return null;
  const { rows } = await db.query(
    'SELECT * FROM client_transfer_history WHERE idempotency_key = $1 LIMIT 1',
    [idempotencyKey]
  );
  return rows[0] || null;
}

/**
 * Apply one session's decision to the database.
 *
 * Runs inside the caller's transaction. Deliberately does NOT touch Google or
 * send anything — those happen after commit, because an external call inside a
 * transaction holds a pooled connection open across a network round trip and
 * this pool has ten.
 */
export async function applyDecision(
  tx: PoolClient,
  booking: any,
  decision: Decision,
  toTherapist: any,
  pricing?: { newPrice: number; priceDifference: number }
): Promise<{ moved: boolean; newStartMs: number; durationMin: number }> {
  const durationMin = booking.booking_duration || DEFAULT_DURATION_MIN;

  if (decision.action === 'cancel') {
    await tx.query(
      `UPDATE bookings
          SET booking_status = 'cancelled',
              booking_cancel_reason = $1,
              invitee_cancelled_at = NOW(),
              booking_updated_at = NOW()
        WHERE booking_id = $2`,
      ['Cancelled during transfer to another therapist', booking.booking_id]
    );
    return { moved: false, newStartMs: getBookingStartMs(booking.booking_invitee_time) ?? 0, durationMin };
  }

  const startMs = decision.action === 'move' && decision.newStartMs
    ? decision.newStartMs
    : (getBookingStartMs(booking.booking_invitee_time) ?? 0);

  const endMs = startMs + durationMin * MINUTE;
  const inviteeTime = formatInviteeTime(startMs, durationMin);

  // The SET clause is assembled alongside its parameters so the two cannot drift
  // apart. The previous version hardcoded `recheduled_from = $10` but had a
  // branch that supplied only nine parameters — a query that throws the moment
  // anything calls this without pricing.
  const sets: string[] = [];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    sets.push(sql.replace('$?', `$${params.length}`));
  };

  add('therapist_id = $?', toTherapist.therapist_id);
  add('booking_host_name = $?', toTherapist.name);
  add('booking_host_email = $?', toTherapist.contactEmail ?? null);
  add('booking_host_phone = $?', toTherapist.contactPhone ?? null);
  add('booking_start_at = $?', new Date(startMs).toISOString());
  add('booking_end_at = $?', new Date(endMs).toISOString());
  add('booking_invitee_time = $?', inviteeTime);

  // Re-price for BOTH keep and move. Applying it only to 'move' meant a kept
  // session on a cheaper therapist refunded the difference to the client while
  // the booking still carried the old, higher amount — money returned and
  // revenue never reduced, disagreeing by exactly the refund.
  if (pricing && pricing.newPrice >= 0 && pricing.priceDifference !== 0) {
    add('invitee_payment_amount = $?', pricing.newPrice);
    add('quoted_amount = $?', pricing.newPrice);
  }

  if (decision.action === 'move') {
    sets.push('rescheduled_at = NOW()');
    add('recheduled_from = $?', booking.booking_start_at);
  }
  sets.push('booking_updated_at = NOW()');

  params.push(booking.booking_id);
  await tx.query(
    `UPDATE bookings SET ${sets.join(', ')} WHERE booking_id = $${params.length}`,
    params
  );

  return { moved: true, newStartMs: startMs, durationMin };
}

/**
 * Credit a cancelled session's money back to the client.
 *
 * Only ever called for a decision the preview marked cancellable, so this
 * cannot silently swallow a gateway payment. creditWallet is idempotent per
 * (booking, reason), so a retry cannot mint a second credit.
 */
export async function settleCancelledSession(
  booking: any,
  money: MoneyAssessment,
  actor: { id?: number | null; name?: string | null }
): Promise<number> {
  if (money.outcome !== 'wallet_credit' || money.amount <= 0) return 0;

  const txn = await creditWallet({
    name: booking.invitee_name,
    phone: booking.invitee_phone,
    email: booking.invitee_email,
    bookingId: booking.booking_id,
    amount: money.amount,
    currency: money.currency,
    reason: 'CANCELLATION_CREDIT',
    sourcePaymentMode: booking.invitee_payment_gateway,
    notes: 'Session cancelled while transferring the client to another therapist',
    userId: actor.id ?? null,
    userName: actor.name ?? null,
  });
  return txn ? Number(txn.amount) : 0;
}

/** Balance for a client, for the confirmation screen. */
export async function balanceFor(phone?: string | null, email?: string | null): Promise<number> {
  const key = buildClientKey(phone, email);
  return key ? getBalance(key) : 0;
}
