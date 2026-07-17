// Single source of truth for turning a raw `bookings.booking_status` value into
// the status the UI renders.
//
// Production data is dirty: statuses appear as 'confirmed', 'scheduled',
// 'no show' (space) and 'no_show', 'pending notes' and 'pending_notes', and one
// NULL. Normalising first means each variant only has to be listed once.
//
// The unpaid states must never fall through to 'scheduled': a booking created by
// the dashboard "send payment link" flow sits at 'waiting_for_payment' until
// Razorpay's webhook confirms payment, and showing it as Upcoming presents an
// unpaid hold as a committed session.

export type DerivedBookingStatus =
  | 'cancelled'
  | 'no_show'
  | 'completed'
  | 'pending_notes'
  | 'awaiting_payment'
  | 'scheduled';

const normalizeStatus = (raw: unknown): string =>
  (raw ?? '').toString().trim().toLowerCase().replace(/[\s-]+/g, '_');

// Booking is on hold and NOT committed: payment has not been confirmed yet.
const AWAITING_PAYMENT = new Set([
  'waiting_for_payment', // dashboard "send payment link" flow
  'payment_pending',     // public booking page hold
  'awaiting_payment',
  'pending',
]);

// Terminal states where the money never arrived.
const PAYMENT_DEAD = new Set(['payment_failed', 'expired']);

export function deriveBookingStatus(rawStatus: unknown): DerivedBookingStatus {
  const s = normalizeStatus(rawStatus);

  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (PAYMENT_DEAD.has(s)) return 'cancelled';
  if (s === 'no_show') return 'no_show';
  if (s === 'completed') return 'completed';
  if (s === 'pending_notes') return 'pending_notes';
  if (AWAITING_PAYMENT.has(s)) return 'awaiting_payment';

  return 'scheduled';
}

export function isAwaitingPayment(rawStatus: unknown): boolean {
  return deriveBookingStatus(rawStatus) === 'awaiting_payment';
}

export const STATUS_LABELS: Record<DerivedBookingStatus, string> = {
  cancelled: 'Cancelled',
  no_show: 'No Show',
  completed: 'Completed',
  pending_notes: 'Pending Notes',
  awaiting_payment: 'Waiting for Payment',
  scheduled: 'Scheduled',
};

export const STATUS_BADGE_CLASSES: Record<DerivedBookingStatus, string> = {
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  pending_notes: 'bg-yellow-100 text-yellow-700',
  awaiting_payment: 'bg-amber-100 text-amber-800',
  scheduled: 'bg-blue-100 text-blue-700',
};

export const statusLabel = (rawStatus: unknown): string =>
  STATUS_LABELS[deriveBookingStatus(rawStatus)];

export const statusBadgeClass = (rawStatus: unknown): string =>
  STATUS_BADGE_CLASSES[deriveBookingStatus(rawStatus)];
