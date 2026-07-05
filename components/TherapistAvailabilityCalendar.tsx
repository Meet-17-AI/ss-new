import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, X, Plus, Trash2, Loader2, Save, Calendar, Clock, RefreshCw } from 'lucide-react';
import { Toast } from './Toast';
import './TherapistAvailabilityCalendar.css';

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */
interface TimeSlot {
  start: string;
  end: string;
  enabled: boolean;
}

interface DayAvailability {
  day: string;           // weekday name or YYYY-MM-DD
  is_available: boolean;
  times: { start: string; end: string }[];
}

interface ScheduleData {
  name?: string;
  time_zone?: string;
  availability: DayAvailability[];
  date_overrides?: any[];
  exclusions?: any[];
}

interface TherapistOption {
  therapist_id: string | number;
  name: string;
  schedule_id?: number | null;
}

interface TherapistAvailabilityCalendarProps {
  user: any;
  isAdmin?: boolean;
  therapistsList?: TherapistOption[];
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

/** Generate time options in 15-min increments (00:00 .. 23:45) */
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

/** Format HH:mm → 12-hour display */
const formatTime12 = (t: string) => {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = parseInt(hh, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
};

/** Match a weekday name (case-insensitive, supports "SUN" / "sunday" / "Sun") */
const matchesWeekday = (stored: string, target: string) => {
  const s = (stored || '').toUpperCase().slice(0, 3);
  const t = (target || '').toUpperCase().slice(0, 3);
  return s === t;
};

const DAY_MAP: Record<string, string> = {
  SUN: 'sunday', MON: 'monday', TUE: 'tuesday', WED: 'wednesday',
  THU: 'thursday', FRI: 'friday', SAT: 'saturday',
};

/* ═══════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════ */
const TherapistAvailabilityCalendar: React.FC<TherapistAvailabilityCalendarProps> = ({
  user,
  isAdmin = false,
  therapistsList = [],
}) => {
  // Calendar state
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());

  // Schedule data
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Therapist selector (admin)
  const [selectedTherapist, setSelectedTherapist] = useState<TherapistOption | null>(null);
  const [showTherapistDropdown, setShowTherapistDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<number | null>(null);
  const [modalAvailable, setModalAvailable] = useState(true);
  const [modalSlots, setModalSlots] = useState<TimeSlot[]>([{ start: '09:00', end: '17:00', enabled: true }]);
  const [applyAsDefault, setApplyAsDefault] = useState(false);

  // ── Initialize therapist ────────────────────────────
  useEffect(() => {
    if (isAdmin && therapistsList.length > 0 && !selectedTherapist) {
      setSelectedTherapist(therapistsList[0]);
    }
  }, [isAdmin, therapistsList, selectedTherapist]);

  // ── Fetch schedule ID ───────────────────────────────
  const therapistId = isAdmin ? selectedTherapist?.therapist_id : user.therapist_id;

  useEffect(() => {
    if (!therapistId) return;
    setLoading(true);
    setScheduleData(null);
    setScheduleId(null);

    fetch(`/api/therapist-schedule?therapist_id=${therapistId}`)
      .then(r => r.json())
      .then((data: any) => {
        const sid = data.scheduleId ?? null;
        setScheduleId(sid);
        if (sid) fetchScheduleData(sid);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [therapistId]);

  // ── Fetch schedule data ─────────────────────────────
  const fetchScheduleData = useCallback(async (sid: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/dayschedule/schedules/${sid}`);
      if (!res.ok) throw new Error('Failed to fetch');
      let data = await res.json();
      if (Array.isArray(data) && data.length > 0) data = data[0];

      // Merge date_overrides into availability
      let merged = [...(data.availability || [])];
      if (data.date_overrides) {
        data.date_overrides.forEach((ov: any) => {
          merged.push({ day: ov.date, is_available: ov.is_available !== false, times: ov.availability || [] });
        });
      }
      if (data.exclusions) {
        data.exclusions.forEach((ex: any) => {
          merged.push({ day: ex.start, is_available: false, times: [] });
        });
      }
      data.availability = merged;
      setScheduleData(data);
    } catch (err) {
      console.error('[AvailCalendar] Fetch error:', err);
      setToast({ message: 'Failed to load availability', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Close dropdown on outside click ─────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowTherapistDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Get availability info for a specific date ───────
  const getDateAvailability = (day: number) => {
    if (!scheduleData) return null;
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Check date override first
    const override = (scheduleData.availability || []).find((a: DayAvailability) =>
      /\d{4}-\d{2}-\d{2}/.test(a.day) && a.day === dateStr
    );
    if (override) return { ...override, isOverride: true };

    // Fallback to weekly rule
    const d = new Date(calYear, calMonth, day);
    const weekday = WEEKDAY_NAMES[d.getDay()];
    const weekly = (scheduleData.availability || []).find((a: DayAvailability) =>
      !/\d{4}-\d{2}-\d{2}/.test(a.day) && matchesWeekday(a.day, weekday.slice(0, 3))
    );
    return weekly ? { ...weekly, isOverride: false } : null;
  };

  // ── Open modal for a date ───────────────────────────
  const openDateModal = (day: number) => {
    const info = getDateAvailability(day);
    setModalDate(day);
    setApplyAsDefault(false);

    if (info) {
      setModalAvailable(info.is_available);
      setModalSlots(
        info.times && info.times.length > 0
          ? info.times.map((t: any) => ({ start: t.start, end: t.end, enabled: true }))
          : [{ start: '09:00', end: '17:00', enabled: true }]
      );
    } else {
      setModalAvailable(false);
      setModalSlots([{ start: '09:00', end: '17:00', enabled: true }]);
    }
    setModalOpen(true);
  };

  // ── Save from modal ─────────────────────────────────
  const handleModalSave = async () => {
    if (!scheduleData || !scheduleId || modalDate === null) return;
    setSaving(true);

    try {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(modalDate).padStart(2, '0')}`;
      const d = new Date(calYear, calMonth, modalDate);
      const weekdayShort = WEEKDAY_SHORT[d.getDay()].toUpperCase();
      const activeTimes = modalSlots.filter(s => s.enabled).map(s => ({ start: s.start, end: s.end }));

      let newAvailability = [...(scheduleData.availability || [])];

      if (applyAsDefault) {
        // Update the weekly rule for this day of the week
        const idx = newAvailability.findIndex((a: DayAvailability) =>
          !/\d{4}-\d{2}-\d{2}/.test(a.day) && matchesWeekday(a.day, weekdayShort)
        );
        const newEntry: DayAvailability = {
          day: DAY_MAP[weekdayShort] || weekdayShort,
          is_available: modalAvailable,
          times: modalAvailable ? activeTimes : [],
        };
        if (idx > -1) newAvailability[idx] = newEntry;
        else newAvailability.push(newEntry);

        // Also remove any date override for this specific date
        newAvailability = newAvailability.filter((a: DayAvailability) => a.day !== dateStr);
      } else {
        // Save as date-specific override
        const filtered = newAvailability.filter((a: DayAvailability) => a.day !== dateStr);
        filtered.push({
          day: dateStr,
          is_available: modalAvailable,
          times: modalAvailable ? activeTimes : [],
        });
        newAvailability = filtered;
      }

      // Prepare payload matching EditEvent's handleUpdateSchedule format
      const therapistName = isAdmin ? selectedTherapist?.name : user.full_name;

      // Split into weekly and overrides
      const standardAvailability = newAvailability.filter((a: DayAvailability) => !/\d{4}-\d{2}-\d{2}/.test(a.day));
      const overridesList = newAvailability.filter((a: DayAvailability) => /\d{4}-\d{2}-\d{2}/.test(a.day));

      // Ensure all 7 days exist
      const daysToEnsure = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const finalAvailability = daysToEnsure.map(d => {
        const existing = standardAvailability.find((a: DayAvailability) => matchesWeekday(a.day, d));
        return existing || { day: d, is_available: false, times: [{ start: '09:00', end: '17:00' }] };
      });

      const cleanAvailability = finalAvailability.map((a: DayAvailability) => ({
        day: DAY_MAP[(a.day || '').toUpperCase().slice(0, 3)] || a.day,
        is_available: a.is_available,
        times: (a.times || []).map((t: any) => ({ start: t.start, end: t.end })),
      }));

      const dateOverrides = overridesList
        .filter((a: DayAvailability) => a.is_available || (a.times || []).length > 0)
        .map((a: DayAvailability) => ({
          date: a.day,
          is_available: a.is_available,
          availability: (a.times || []).map((t: any) => ({ start: t.start, end: t.end })),
        }));

      const exclusions = overridesList
        .filter((a: DayAvailability) => !a.is_available && (a.times || []).length === 0)
        .map((a: DayAvailability) => ({
          start: a.day,
          end: a.day,
          reason: 'Override Unavailable',
        }));

      const updateBody = {
        name: `${therapistName}'s Schedule`,
        time_zone: scheduleData.time_zone || 'Asia/Calcutta',
        availability: cleanAvailability,
        date_overrides: dateOverrides,
        exclusions,
        is_default: false,
        therapist_id: therapistId,
        scheduleId,
      };

      const res = await fetch(`/api/dayschedule/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
      });

      if (!res.ok) {
        let errMsg = 'Failed to update schedule';
        try { const errBody = await res.json(); errMsg = errBody.detail || errBody.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      // Optimistic local update
      setScheduleData(prev => prev ? { ...prev, availability: newAvailability } : prev);
      setToast({ message: applyAsDefault ? `Default ${WEEKDAY_NAMES[d.getDay()]} hours updated!` : 'Availability saved!', type: 'success' });
      setModalOpen(false);

      // Re-fetch to sync
      setTimeout(() => fetchScheduleData(scheduleId), 500);
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // ── Calendar nav ────────────────────────────────────
  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const goToday = () => {
    setCalMonth(today.getMonth());
    setCalYear(today.getFullYear());
  };

  // ── Render Calendar Grid ────────────────────────────
  const daysInMonth = getDaysInMonth(calMonth, calYear);
  const firstDay = getFirstDayOfMonth(calMonth, calYear);

  const renderCalendarGrid = () => {
    const cells: React.ReactNode[] = [];

    // Day headers
    WEEKDAY_SHORT.forEach(d => (
      cells.push(<div key={`h-${d}`} className="avail-grid-day-header">{d}</div>)
    ));

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`e-${i}`} className="avail-day-cell empty" />);
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const info = getDateAvailability(day);
      const thisDate = new Date(calYear, calMonth, day);
      const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const isPast = thisDate < todayDate;
      const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
      const isAvailable = info?.is_available ?? false;
      const isOverride = info?.isOverride ?? false;

      const classes = [
        'avail-day-cell',
        isToday && 'today',
        isPast && 'past',
        isAvailable ? 'available' : 'unavailable',
        isOverride && 'has-override',
      ].filter(Boolean).join(' ');

      cells.push(
        <div
          key={day}
          className={classes}
          onClick={() => !isPast && openDateModal(day)}
        >
          <div className="day-number">{day}</div>
          <div className="day-slots">
            {isAvailable && info?.times && info.times.length > 0 ? (
              info.times.slice(0, 2).map((t: any, idx: number) => (
                <div key={idx} className={`day-slot-pill${isOverride ? ' override' : ''}`}>
                  {formatTime12(t.start)} – {formatTime12(t.end)}
                </div>
              ))
            ) : !isAvailable ? (
              <div className="day-status-badge off">Off</div>
            ) : null}
            {isAvailable && info?.times && info.times.length > 2 && (
              <div className="day-slot-pill" style={{ background: '#f3f4f6', color: '#4b5563' }}>
                +{info.times.length - 2} more
              </div>
            )}
          </div>
        </div>
      );
    }

    return cells;
  };

  // ── Render ──────────────────────────────────────────
  return (
    <div className="avail-calendar-container">
      {/* Header */}
      <div className="avail-calendar-header">
        <div className="header-left">
          <h2>Availability Calendar</h2>
          <p>{isAdmin ? 'Manage therapist schedules' : 'Manage your weekly hours & date overrides'}</p>
        </div>
        <div className="header-right">
          {isAdmin && therapistsList.length > 0 && (
            <div className="therapist-selector" ref={dropdownRef}>
              <button
                className="therapist-selector-btn"
                onClick={() => setShowTherapistDropdown(!showTherapistDropdown)}
              >
                <div className="avatar-circle" style={{ width: 24, height: 24, borderRadius: '50%', background: '#0f766e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {(selectedTherapist?.name || '?')[0].toUpperCase()}
                </div>
                <span>{selectedTherapist?.name || 'Select Therapist'}</span>
                <ChevronDown size={14} className={`chevron${showTherapistDropdown ? ' open' : ''}`} />
              </button>

              {showTherapistDropdown && (
                <div className="therapist-dropdown">
                  {therapistsList.map(t => (
                    <button
                      key={t.therapist_id}
                      className={`therapist-dropdown-item${selectedTherapist?.therapist_id === t.therapist_id ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedTherapist(t);
                        setShowTherapistDropdown(false);
                      }}
                    >
                      <div className="avatar-circle">{(t.name || '?')[0].toUpperCase()}</div>
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="avail-calendar-nav">
        <div className="nav-month-group">
          <button className="nav-arrow" onClick={prevMonth}>‹</button>
          <span className="nav-month-label">{MONTH_NAMES[calMonth]} {calYear}</span>
          <button className="nav-arrow" onClick={nextMonth}>›</button>
          <button className="nav-today-btn" onClick={goToday}>Today</button>
        </div>
        <div className="avail-legend">
          <div className="legend-item"><div className="legend-dot available" /> Available</div>
          <div className="legend-item"><div className="legend-dot unavailable" /> Unavailable</div>
          <div className="legend-item"><div className="legend-dot override" /> Override</div>
          <div className="legend-item"><div className="legend-dot today" /> Today</div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="avail-calendar-grid-wrapper">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12 }}>
            <Loader2 size={32} className="spinner" style={{ animation: 'spin 0.8s linear infinite', color: '#0f766e' }} />
            <p style={{ color: '#6b7280', fontSize: 14 }}>Loading availability...</p>
          </div>
        ) : !scheduleId ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 12 }}>
            <Calendar size={48} style={{ color: '#d1d5db' }} />
            <p style={{ color: '#6b7280', fontSize: 14, textAlign: 'center' }}>
              No schedule configured for this therapist.<br />
              Please ensure a service is created and the therapist's Google Calendar is connected.
            </p>
          </div>
        ) : (
          <div className="avail-calendar-grid">
            {renderCalendarGrid()}
          </div>
        )}
      </div>

      {/* ── Availability Modal (Slide-over Panel) ───── */}
      {modalOpen && modalDate !== null && (
        <div className="avail-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="avail-modal-panel" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="avail-modal-header" style={{ position: 'relative' }}>
              <p className="modal-date">
                {new Date(calYear, calMonth, modalDate).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric'
                })}
              </p>
              <p className="modal-weekday">
                {new Date(calYear, calMonth, modalDate).toLocaleDateString('en-US', { weekday: 'long' })}
              </p>
              <button className="avail-modal-close" onClick={() => setModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Availability Toggle */}
            <div className="avail-toggle-row">
              <div>
                <div className="avail-toggle-label">
                  {modalAvailable ? 'Available' : 'Unavailable'}
                </div>
                <div className="avail-toggle-sublabel">
                  {modalAvailable ? 'Clients can book during your time slots' : 'No bookings will be accepted'}
                </div>
              </div>
              <button
                className={`toggle-switch${modalAvailable ? ' on' : ''}`}
                onClick={() => setModalAvailable(!modalAvailable)}
              >
                <div className="toggle-knob" />
              </button>
            </div>

            {/* Body */}
            <div className="avail-modal-body">
              {modalAvailable && (
                <div className="time-slots-section">
                  <div className="section-title">Time Slots</div>

                  {modalSlots.map((slot, idx) => (
                    <div key={idx} className={`time-slot-card${!slot.enabled ? ' disabled' : ''}`}>
                      {/* Slot toggle */}
                      <button
                        className={`slot-toggle${slot.enabled ? ' on' : ''}`}
                        onClick={() => {
                          const ns = [...modalSlots];
                          ns[idx] = { ...ns[idx], enabled: !ns[idx].enabled };
                          setModalSlots(ns);
                        }}
                      >
                        <div className="slot-toggle-knob" />
                      </button>

                      {/* From time */}
                      <select
                        className="time-select"
                        value={slot.start}
                        disabled={!slot.enabled}
                        onChange={e => {
                          const ns = [...modalSlots];
                          ns[idx] = { ...ns[idx], start: e.target.value };
                          setModalSlots(ns);
                        }}
                      >
                        {TIME_OPTIONS.map(t => (
                          <option key={t} value={t}>{formatTime12(t)}</option>
                        ))}
                      </select>

                      <span className="time-to-label">to</span>

                      {/* To time */}
                      <select
                        className="time-select"
                        value={slot.end}
                        disabled={!slot.enabled}
                        onChange={e => {
                          const ns = [...modalSlots];
                          ns[idx] = { ...ns[idx], end: e.target.value };
                          setModalSlots(ns);
                        }}
                      >
                        {TIME_OPTIONS.map(t => (
                          <option key={t} value={t}>{formatTime12(t)}</option>
                        ))}
                      </select>

                      {/* Remove button */}
                      {modalSlots.length > 1 && (
                        <button
                          className="slot-remove-btn"
                          onClick={() => setModalSlots(modalSlots.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add slot */}
                  <button
                    className="add-slot-btn"
                    onClick={() => {
                      const lastEnd = modalSlots.length > 0 ? modalSlots[modalSlots.length - 1].end : '09:00';
                      setModalSlots([...modalSlots, { start: lastEnd, end: lastEnd, enabled: true }]);
                    }}
                  >
                    <Plus size={16} /> Add Time Slot
                  </button>
                </div>
              )}

              {/* Default Hours Section */}
              <div className="default-hours-section">
                <div className="section-heading">
                  <RefreshCw size={14} />
                  Default Hours
                </div>
                <div className="section-desc">
                  When checked, this schedule will apply to every{' '}
                  <strong>{modalDate ? new Date(calYear, calMonth, modalDate).toLocaleDateString('en-US', { weekday: 'long' }) : 'day'}</strong>{' '}
                  going forward.
                </div>
                <label className="default-hours-check">
                  <input
                    type="checkbox"
                    checked={applyAsDefault}
                    onChange={e => setApplyAsDefault(e.target.checked)}
                  />
                  <span>Apply as default weekly hours</span>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="avail-modal-footer">
              <button className="cancel-btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="save-btn" onClick={handleModalSave} disabled={saving}>
                {saving ? (
                  <><Loader2 size={14} className="spinner" /> Saving...</>
                ) : (
                  <><Save size={14} /> Save Changes</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default TherapistAvailabilityCalendar;
