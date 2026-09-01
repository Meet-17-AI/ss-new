/**
 * Therapist availability, as one engine.
 *
 * THE CENTRAL IDEA — the thing that ANSWERS "is this slot free?" must be the
 * same thing that OFFERS alternatives.
 *
 * Before this module the panel had two disagreeing implementations: the
 * reschedule guard derived each session's instant from booking_invitee_time,
 * while the slot picker filtered on booking_start_at — a column stored in
 * inconsistent timezone conventions. So the picker could offer a slot the guard
 * would then reject, and the admin would watch a valid-looking choice 409.
 *
 * Everything here works in absolute instants (ms since epoch). Wall-clock text
 * is parsed once, at the edge, via getBookingStartMs().
 *
 * Deliberately PURE with respect to I/O: Google free/busy blocks are passed in
 * rather than fetched, because only the caller holds the OAuth client. That also
 * makes every rule below testable without a network.
 *
 * NOTE: /api/fetch-slots still carries its own older copy of this logic. It is
 * the booking form's path and is left alone here on purpose — rewriting it in
 * the same change as the transfer wizard would put two risky things in one
 * diff. It should be migrated onto this module next.
 */

import { getBookingStartMs } from './timezone';

/**
 * Serialise everything that books a given therapist.
 *
 * Every conflict check in this codebase reads, decides, then inserts, with
 * nothing held in between — so two admins (or two visitors on the public form)
 * choosing the same slot at the same moment both pass the check and both write.
 * The window is small and the paths are many.
 *
 * The database is the only place that can hold this invariant, since the racing
 * parties are separate requests and potentially separate processes. An advisory
 * lock keyed on the therapist is the cheap version: it costs one round trip,
 * needs no schema change, and releases automatically on COMMIT or ROLLBACK.
 * Different therapists never contend.
 *
 * The thorough version is an exclusion constraint on (therapist_id, time range).
 * It is deliberately NOT used yet: it would have to be built on
 * booking_start_at, which holds a mix of UTC instants and IST wall-clock text —
 * so it would compare values that do not mean the same thing and reject valid
 * bookings. Normalise that column first, then add the constraint and keep this
 * as belt-and-braces.
 *
 * Callers must do the conflict check INSIDE the callback, not before it.
 */
export async function withTherapistSlotLock<T>(
  pool: { connect: () => Promise<any> },
  therapistId: string | null | undefined,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A null therapist cannot double-book anyone, but still needs the
    // transaction so the caller has one connection to work on.
    if (therapistId) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`therapist:${therapistId}`]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A half-open interval [startMs, endMs). */
export interface Window {
  startMs: number;
  endMs: number;
}

export interface TimeBlock {
  start: string; // "HH:MM" IST
  end: string;   // "HH:MM" IST
}

export interface DayRule {
  is_available?: boolean;
  times?: TimeBlock[];
  excludeTimes?: TimeBlock[];
}

export interface ScheduleData {
  availability: any[];
  dateOverrides: any[];
  exclusions: any[];
}

export interface AvailabilityContext {
  therapistId: string | null;
  /** Null when the therapist has no therapist_resources row — see hasSchedule. */
  scheduleId: number | null;
  schedule: ScheduleData | null;
  /** Sessions already on this therapist's panel calendar. */
  booked: Window[];
  /** Blocks from the therapist's own Google Calendar. Empty when not connected. */
  busy: Window[];
  hasSchedule: boolean;
  hasCalendar: boolean;
}

export type ConflictKind =
  | 'none'
  | 'no_schedule'
  | 'outside_hours'
  | 'day_excluded'
  | 'booked'
  | 'calendar_busy';

export interface Conflict {
  kind: ConflictKind;
  detail: string;
  /** Set when kind is 'booked' — which session is in the way. */
  bookingId?: string;
}

const MINUTE = 60000;
const DEFAULT_DURATION_MIN = 50;

/** Statuses that do not hold a slot. Mirrors the reschedule guard exactly. */
const NON_HOLDING_STATUSES = new Set([
  'cancelled', 'canceled', 'no_show', 'payment_failed',
  'waiting_for_payment', 'payment_pending', 'pending',
]);

export const holdsASlot = (status: string | null | undefined): boolean => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return !NON_HOLDING_STATUSES.has(normalized);
};

const overlaps = (a: Window, b: Window): boolean =>
  a.startMs < b.endMs && b.startMs < a.endMs;

/** Parse a JSON column that may arrive as text or as already-parsed JSON. */
const asArray = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * Load everything needed to judge a therapist's availability.
 *
 * `busyBlocks` comes from the caller because fetching it needs an authenticated
 * Google client. Passing an empty array is valid and means "we could not or did
 * not check the calendar" — which is why hasCalendar is tracked separately, so
 * a caller can tell "free" from "unknown".
 */
export async function loadAvailability(
  db: { query: Function },
  therapistId: string,
  busyBlocks: Window[] = [],
  opts: { hasCalendar?: boolean; fromMs?: number; toMs?: number } = {}
): Promise<AvailabilityContext> {
  const resource = await db.query(
    `SELECT tr.schedule_id
       FROM therapist_resources tr
      WHERE tr.therapist_id = $1
      ORDER BY tr.schedule_id DESC NULLS LAST
      LIMIT 1`,
    [therapistId]
  );
  const scheduleId: number | null = resource.rows[0]?.schedule_id ?? null;

  let schedule: ScheduleData | null = null;
  if (scheduleId) {
    const s = await db.query(
      'SELECT availability, date_overrides, exclusions FROM therapist_schedules WHERE schedule_id = $1',
      [scheduleId]
    );
    if (s.rows.length > 0) {
      schedule = {
        availability: asArray(s.rows[0].availability),
        dateOverrides: asArray(s.rows[0].date_overrides),
        exclusions: asArray(s.rows[0].exclusions),
      };
    }
  }

  // Every session this therapist is holding in the window of interest.
  //
  // Read via booking_invitee_time rather than booking_start_at, for the reason
  // in this file's header — but FILTERED on booking_start_at, which is the
  // column with an index and a usable type. That column's timezone conventions
  // are inconsistent, so the bound is widened by a day at each end and the
  // precise cut is still made in JS below against getBookingStartMs(). A sloppy
  // pre-filter is safe here in a way a sloppy final answer is not.
  //
  // Without this the query returned every booking the therapist had ever taken,
  // and assessSlot() then scanned all of them for each candidate slot —
  // suggestAcrossDays() made that days × slots × entire-career.
  const SQL_FILTER_SLACK_MS = 24 * 60 * MINUTE;
  const params: any[] = [therapistId];
  const bounds: string[] = [];
  if (opts.fromMs) {
    params.push(new Date(opts.fromMs - SQL_FILTER_SLACK_MS).toISOString());
    bounds.push(`booking_start_at >= $${params.length}`);
  }
  if (opts.toMs) {
    params.push(new Date(opts.toMs + SQL_FILTER_SLACK_MS).toISOString());
    bounds.push(`booking_start_at <= $${params.length}`);
  }
  const bookingRows = await db.query(
    `SELECT booking_id, booking_invitee_time, booking_duration, booking_status
       FROM bookings
      WHERE therapist_id = $1
        AND booking_invitee_time IS NOT NULL
        ${bounds.length ? `AND booking_start_at IS NOT NULL AND ${bounds.join(' AND ')}` : ''}`,
    params
  );

  const booked: Window[] = [];
  for (const row of bookingRows.rows) {
    if (!holdsASlot(row.booking_status)) continue;
    const startMs = getBookingStartMs(row.booking_invitee_time);
    if (startMs === null) continue; // unparseable: cannot judge, do not guess
    const endMs = startMs + (row.booking_duration || DEFAULT_DURATION_MIN) * MINUTE;
    if (opts.fromMs && endMs < opts.fromMs) continue;
    if (opts.toMs && startMs > opts.toMs) continue;
    (booked as any[]).push({ startMs, endMs, bookingId: row.booking_id });
  }

  return {
    therapistId,
    scheduleId,
    schedule,
    booked,
    busy: busyBlocks,
    hasSchedule: Boolean(scheduleId && schedule && schedule.availability.length > 0),
    hasCalendar: opts.hasCalendar ?? busyBlocks.length > 0,
  };
}

/** The IST calendar date ("YYYY-MM-DD") an instant falls on. */
export function istDateOf(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the working rule for one IST date.
 *
 * Ported deliberately from /api/fetch-slots, including its two load-bearing
 * decisions: an ambiguous override fails CLOSED (never silently open a day),
 * and an "available" override carrying no windows falls back to the weekly rule
 * rather than wiping the day out.
 */
export function resolveDayRule(schedule: ScheduleData, dateStr: string): DayRule | null {
  const dObj = new Date(`${dateStr}T12:00:00Z`);
  const dayOfWeekIST = dObj
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' })
    .toLowerCase();
  const weeklyRule = schedule.availability.find(
    (r: any) => String(r.day || '').toLowerCase() === dayOfWeekIST
  );

  // A holiday blocks the whole day. Compared against the full range so a
  // multi-day exclusion does not leave its interior bookable.
  const isExcluded = schedule.exclusions.some((ex: any) => {
    const from = ex.start ?? ex.date;
    const to = ex.end ?? ex.start ?? ex.date;
    return from && dateStr >= from && dateStr <= to; // ISO dates compare lexicographically
  });
  if (isExcluded) return null;

  const override = schedule.dateOverrides.find(
    (ov: any) => ov.date === dateStr || ov.day === dateStr
  );
  if (!override) return weeklyRule ?? null;

  let isAvailable: boolean;
  if (typeof override.is_available === 'boolean') isAvailable = override.is_available;
  else if (typeof override.isAvailable === 'boolean') isAvailable = override.isAvailable;
  else if (typeof override.availability === 'boolean') isAvailable = override.availability;
  else isAvailable = Array.isArray(override.availability) && override.availability.length > 0;

  const overrideTimes: TimeBlock[] = Array.isArray(override.availability)
    ? override.availability
    : (Array.isArray(override.times) ? override.times : []);

  if (isAvailable) {
    const times = overrideTimes.length > 0
      ? overrideTimes
      : (weeklyRule?.is_available && Array.isArray(weeklyRule.times) ? weeklyRule.times : []);
    return { is_available: true, times };
  }

  // Partial unavailability subtracts from the weekly rule; total wipes the day.
  if (overrideTimes.length > 0 && weeklyRule?.is_available && Array.isArray(weeklyRule.times)) {
    return { is_available: true, times: weeklyRule.times, excludeTimes: overrideTimes };
  }
  return { is_available: false, times: [] };
}

/** Absolute working windows for one IST date. */
function windowsForDate(schedule: ScheduleData, dateStr: string): Window[] {
  const rule = resolveDayRule(schedule, dateStr);
  if (!rule || !rule.is_available || !Array.isArray(rule.times)) return [];

  const windows: Window[] = [];
  for (const block of rule.times) {
    const startMs = new Date(`${dateStr}T${block.start}:00+05:30`).getTime();
    const endMs = new Date(`${dateStr}T${block.end}:00+05:30`).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;
    windows.push({ startMs, endMs });
  }

  if (!Array.isArray(rule.excludeTimes) || rule.excludeTimes.length === 0) return windows;

  // Subtract the excluded blocks rather than testing against them later, so a
  // caller cannot forget to apply them.
  let result = windows;
  for (const ex of rule.excludeTimes) {
    const exStart = new Date(`${dateStr}T${ex.start}:00+05:30`).getTime();
    const exEnd = new Date(`${dateStr}T${ex.end}:00+05:30`).getTime();
    if (Number.isNaN(exStart) || Number.isNaN(exEnd)) continue;
    const next: Window[] = [];
    for (const w of result) {
      if (exEnd <= w.startMs || exStart >= w.endMs) { next.push(w); continue; }
      if (exStart > w.startMs) next.push({ startMs: w.startMs, endMs: exStart });
      if (exEnd < w.endMs) next.push({ startMs: exEnd, endMs: w.endMs });
    }
    result = next;
  }
  return result;
}

/**
 * Can this therapist take a session at this exact instant?
 *
 * Answers with the FIRST reason it cannot, because the wizard shows one reason
 * per session and "outside working hours" is more useful to an admin than a
 * generic "unavailable".
 *
 * `excludeBookingId` is the session being moved — it must not be treated as
 * blocking itself when a booking is re-checked in place.
 */
export function assessSlot(
  ctx: AvailabilityContext,
  startMs: number,
  durationMin: number = DEFAULT_DURATION_MIN,
  excludeBookingId?: string | null
): Conflict {
  const candidate: Window = { startMs, endMs: startMs + durationMin * MINUTE };

  if (!ctx.hasSchedule || !ctx.schedule) {
    return {
      kind: 'no_schedule',
      detail: 'This therapist has no working hours configured, so availability cannot be checked.',
    };
  }

  const dateStr = istDateOf(startMs);
  const windows = windowsForDate(ctx.schedule, dateStr);
  if (windows.length === 0) {
    return { kind: 'day_excluded', detail: 'This therapist does not work on that day.' };
  }

  const insideHours = windows.some(w => candidate.startMs >= w.startMs && candidate.endMs <= w.endMs);
  if (!insideHours) {
    return { kind: 'outside_hours', detail: 'That time falls outside this therapist\'s working hours.' };
  }

  for (const b of ctx.booked as any[]) {
    if (excludeBookingId && b.bookingId === excludeBookingId) continue;
    if (overlaps(candidate, b)) {
      return {
        kind: 'booked',
        detail: 'This therapist already has a session at that time.',
        bookingId: b.bookingId,
      };
    }
  }

  for (const b of ctx.busy) {
    if (overlaps(candidate, b)) {
      return {
        kind: 'calendar_busy',
        detail: 'This therapist\'s Google Calendar is busy at that time.',
      };
    }
  }

  return { kind: 'none', detail: 'Available.' };
}

/**
 * Open slots on one IST date, as absolute instants.
 *
 * Walks the same windows assessSlot() validates against and filters with the
 * same assessSlot(), so an offered slot is one that will pass the check. That
 * identity is the entire point of this module.
 *
 * `notBeforeMs` exists because a session cannot be moved into the past. The
 * booking form applies a 4-hour lead time; a transfer deliberately does not,
 * since an admin moving an imminent session is exactly when the tool is needed.
 */
export function suggestSlots(
  ctx: AvailabilityContext,
  dateStr: string,
  durationMin: number = DEFAULT_DURATION_MIN,
  opts: { notBeforeMs?: number; limit?: number; stepMin?: number; excludeBookingId?: string | null } = {}
): number[] {
  if (!ctx.hasSchedule || !ctx.schedule) return [];

  const step = (opts.stepMin ?? 30) * MINUTE;
  const notBefore = opts.notBeforeMs ?? Date.now();
  const limit = opts.limit ?? 12;
  const out: number[] = [];

  for (const w of windowsForDate(ctx.schedule, dateStr)) {
    for (let t = w.startMs; t + durationMin * MINUTE <= w.endMs; t += step) {
      if (t < notBefore) continue;
      if (assessSlot(ctx, t, durationMin, opts.excludeBookingId).kind !== 'none') continue;
      out.push(t);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Open slots across a range of days, used when the session's own date has
 * nothing left. Returns at most `limit` instants, earliest first.
 */
export function suggestAcrossDays(
  ctx: AvailabilityContext,
  fromMs: number,
  days: number = 14,
  durationMin: number = DEFAULT_DURATION_MIN,
  opts: { limit?: number; excludeBookingId?: string | null } = {}
): number[] {
  const limit = opts.limit ?? 12;
  const out: number[] = [];
  for (let i = 0; i < days && out.length < limit; i++) {
    const dateStr = istDateOf(fromMs + i * 24 * 60 * MINUTE);
    const found = suggestSlots(ctx, dateStr, durationMin, {
      notBeforeMs: fromMs,
      limit: limit - out.length,
      excludeBookingId: opts.excludeBookingId,
    });
    out.push(...found);
  }
  return out;
}
