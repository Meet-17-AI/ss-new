/**
 * The true session START instant (ms since epoch), derived from
 * booking_invitee_time.
 *
 * WHY NOT booking_start_at: that column is stored inconsistently across this
 * table — some rows hold a real UTC instant, others hold IST wall-clock text —
 * so comparing it against anything gives an answer that is right for some
 * bookings and silently 5:30 out for others. booking_invitee_time carries its
 * own zone marker, which convertToIST() normalises into a single IST form that
 * can be parsed unambiguously.
 *
 * Lives here rather than beside its callers because a second implementation of
 * this parse is exactly how the inconsistency above got started. Anything that
 * needs to know when a session actually happens should import THIS.
 *
 * Returns null when the string cannot be parsed — callers must treat that as
 * "unknown", never as "now" or "zero".
 */
const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function getBookingStartMs(inviteeTime: string | null | undefined): number | null {
  if (!inviteeTime) return null;

  // Only a string that is actually IST may be parsed as IST.
  //
  // convertToIST() returns its INPUT UNCHANGED when the shape does not match —
  // and the regex below was loose enough to match most of that unconverted
  // string anyway, then subtract 5:30 from it as though it were IST. A booking
  // recorded as "Aug 27, 2026 at 10:00 AM (GMT-06:00)" (no weekday, no end
  // time) came back 11.5 hours out, with no null and no error. slots.ts builds
  // its whole picture of a therapist's booked time from this, so the session
  // sat in the wrong place: the real slot free, a phantom one blocked.
  //
  // tryConvertToIST() returns null on that path instead, so the failure is a
  // failure — while still accepting the many rows that are stored already in
  // IST and need no conversion at all. The trailing IST anchor below is the
  // second half of the same guard.
  const istStr = tryConvertToIST(inviteeTime);
  if (istStr === null) {
    console.warn(`[timezone] unparseable booking time, treating as unknown: ${JSON.stringify(inviteeTime)}`);
    return null;
  }

  const m = istStr.match(/(\w{3}) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) ([AP]M)[^]*IST/);
  if (!m) {
    console.warn(`[timezone] converted string did not parse: ${JSON.stringify(istStr)}`);
    return null;
  }
  const [, mon, day, year, hh, mm, period] = m;
  const monthIdx = MONTH_IDX[mon];
  if (monthIdx === undefined) return null;
  let hour = parseInt(hh, 10);
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  // The parsed time is IST wall-clock; the real UTC instant is that minus 5:30.
  return Date.UTC(parseInt(year, 10), monthIdx, parseInt(day, 10), hour, parseInt(mm, 10)) - 330 * 60000;
}

/**
 * IST rendering of a booking time, or null when the input is not a shape this
 * understands.
 *
 * The null-returning half of convertToIST(), which cannot report failure because
 * every display caller relies on it handing back something printable. Anything
 * that needs to KNOW whether the conversion worked must use this — see
 * getBookingStartMs() for what silent failure cost.
 *
 * TWO shapes are valid, and conflating them is a bug this function has already
 * caused once:
 *
 *   1. Carries a zone offset — "… 3:00 PM - 3:50 PM (GMT-06:00)". Needs
 *      converting, and convertToIST() does it.
 *   2. ALREADY IST — "… 3:00 PM - 3:50 PM IST". Needs nothing done to it.
 *
 * The second is not a failure, and treating it as one is not a safe default:
 * 19% of live bookings are stored that way, and returning null for them made
 * every one of those sessions stop blocking its own slot. Identity alone is
 * therefore NOT the failure signal — an already-IST string is legitimately
 * returned unchanged. The trailing 'IST' marker is what separates the two.
 */
export const tryConvertToIST = (timeStr: string): string | null => {
  const converted = convertToIST(timeStr);
  // Ends in IST either because convertToIST() put it there, or because it was
  // already IST and came back untouched. Both are usable; neither is a failure.
  // Anything else is a shape this module does not understand.
  return converted.trimEnd().endsWith('IST') ? converted : null;
};

export const convertToIST = (timeStr: string): string => {
  if (!timeStr) return timeStr;

  // `Z` is accepted alongside ±HH:MM because live rows carry "(GMTZ)" — the
  // ISO spelling of UTC. Without it those rows matched nothing, convertToIST
  // returned them unchanged, and they were then read as though they were
  // already IST: 5:30 out, silently.
  const match = timeStr.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M) \(GMT([+-]\d+:\d+|Z)\)/);
  if (!match) return timeStr;

  try {
    const [, dateStr, startTime, endTime, offset] = match;
    
    // Parse date
    const dateParts = dateStr.match(/\w+, (\w+) (\d+), (\d+)/);
    if (!dateParts) return timeStr;
    
    const [, month, day, year] = dateParts;
    const monthMap: {[key: string]: number} = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    
    // Parse start time to 24-hour format
    const parseTime = (time: string) => {
      const [h, rest] = time.split(':');
      const [m, period] = rest.split(' ');
      let hour = parseInt(h);
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
      return { hour, minute: parseInt(m) };
    };
    
    const start = parseTime(startTime);
    const end = parseTime(endTime);
    
    // Parse timezone offset (e.g., "-06:00" or "+05:30").
    //
    // The sign is taken from the STRING, not from the parsed hour. Reading it
    // from the number went wrong for sub-hour negative offsets: parseInt('-00')
    // is -0, and `-0 < 0` is false in JavaScript, so '-00:30' added its minutes
    // instead of subtracting them and landed an hour out.
    const sign = offset.trim().startsWith('-') ? -1 : 1;
    const [offsetH, offsetM] = offset === 'Z'
      ? [0, 0]
      : offset.split(':').map(n => Math.abs(parseInt(n)));
    const offsetMinutes = sign * (offsetH * 60 + offsetM);

    // Create a date in the source timezone by treating it as UTC, then adjusting
    // The time given is in the source timezone, so we create it as if it's UTC
    const sourceDate = Date.UTC(parseInt(year), monthMap[month], parseInt(day), start.hour, start.minute);
    // A session that runs past midnight ends on the NEXT day. Building both from
    // the same date reported an end ~23 hours before the start.
    let sourceEndDate = Date.UTC(parseInt(year), monthMap[month], parseInt(day), end.hour, end.minute);
    if (sourceEndDate < sourceDate) sourceEndDate += 24 * 60 * 60000;

    // Convert from source timezone to UTC (subtract the source offset)
    const utcDate = sourceDate - (offsetMinutes * 60000);
    const utcEndDate = sourceEndDate - (offsetMinutes * 60000);
    
    // Convert from UTC to IST (add IST offset: +5:30 = 330 minutes)
    const istDate = new Date(utcDate + (330 * 60000));
    const istEndDate = new Date(utcEndDate + (330 * 60000));
    
    // Format output
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const formatTime = (date: Date) => {
      const h = date.getUTCHours();
      const m = date.getUTCMinutes();
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h % 12 || 12;
      return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
    };
    
    const istDateStr = `${weekdays[istDate.getUTCDay()]}, ${months[istDate.getUTCMonth()]} ${istDate.getUTCDate()}, ${istDate.getUTCFullYear()}`;
    const istStartTime = formatTime(istDate);
    const istEndTime = formatTime(istEndDate);
    
    return `${istDateStr} at ${istStartTime} - ${istEndTime} IST`;
  } catch (error) {
    console.error('Error converting time:', error);
    return timeStr;
  }
};
