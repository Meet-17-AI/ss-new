import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Compact month-grid date picker.
 *
 * Replaces <input type="date">, whose native popup differs per browser and gives
 * no room to show which days are actually selectable. Dates before `min` are
 * rendered but disabled, so the shape of the month stays readable.
 *
 * Works entirely in YYYY-MM-DD strings to avoid timezone drift — constructing
 * Date objects from calendar days and reading them back shifts the day for
 * anyone east or west of UTC.
 */

interface InlineCalendarProps {
  /** Currently selected date, YYYY-MM-DD, or '' for none. */
  value: string;
  onChange: (date: string) => void;
  /** Earliest selectable date, YYYY-MM-DD. Days before this are disabled. */
  min?: string;
  /** Latest selectable date, YYYY-MM-DD. */
  max?: string;
  /**
   * When given, ONLY these days are selectable — everything else is greyed out
   * on top of the min/max rules. Omit it to leave every day in range open, which
   * is what existing callers rely on.
   */
  enabledDates?: Set<string>;
  /** Called when the visible month changes, so a caller can fetch its days. */
  onMonthChange?: (firstOfMonth: string) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export const InlineCalendar: React.FC<InlineCalendarProps> = ({
  value, onChange, min, max, enabledDates, onMonthChange,
}) => {
  // Open on the selected month, or the month containing `min`, or this month.
  const initial = value || min || '';
  const [cursor, setCursor] = useState(() => {
    if (initial) {
      const [y, m] = initial.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const { year, month } = cursor;

  const grid = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const step = (delta: number) => {
    const m = month + delta;
    const next = m < 0 ? { year: year - 1, month: 11 }
      : m > 11 ? { year: year + 1, month: 0 }
      : { year, month: m };
    setCursor(next);
    onMonthChange?.(ymd(next.year, next.month, 1));
  };

  // Disable back-navigation once the visible month can hold no selectable day.
  const lastOfMonth = ymd(year, month, new Date(year, month + 1, 0).getDate());
  const firstOfMonth = ymd(year, month, 1);
  const canGoBack = !min || lastOfMonth > min;
  const canGoForward = !max || firstOfMonth < max;

  return (
    <div className="border rounded-xl p-3 bg-white select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-sm font-semibold text-gray-800">
          {MONTHS[month]} {year}
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[11px] font-medium text-gray-400 text-center py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, i) => {
          if (day === null) return <div key={i} />;

          const date = ymd(year, month, day);
          const disabled = (min && date < min) || (max && date > max) ||
            (enabledDates && !enabledDates.has(date));
          const selected = value === date;
          const isToday = date === min; // `min` is today for forward-only pickers

          return (
            <button
              key={i}
              type="button"
              disabled={!!disabled}
              onClick={() => onChange(date)}
              className={`h-9 rounded-lg text-sm transition-colors ${
                selected
                  ? 'text-white font-semibold'
                  : disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : isToday
                  ? 'text-teal-700 font-semibold ring-1 ring-teal-500 hover:bg-teal-50'
                  : 'text-gray-700 hover:bg-teal-50 hover:text-teal-700'
              }`}
              style={selected ? { backgroundColor: '#21615D' } : undefined}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default InlineCalendar;
