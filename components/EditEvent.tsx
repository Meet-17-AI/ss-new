import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Copy, ExternalLink, Code, Save,
  Settings, Clock, DollarSign, Shield, List,
  RefreshCw, Share2, MoreHorizontal, Bold, Italic,
  ListOrdered, Link, MessageCircle, ChevronDown, User as UserIcon,
  Loader2, AlertCircle
} from 'lucide-react';
import './EditEvent.css';
import { Toast } from './Toast';
import ScheduleCalendarGrid from './ScheduleCalendarGrid';

interface EditEventProps {
  event: {
    title: string;
    description: string;
    detailedDescription?: string;
    editViewDescription?: string;
    slug: string;
    owner: string;
    initialTab?: string;
    scheduleId?: number;
  };
  therapistId?: string | number;
  onBack: () => void;
  onSave: (updatedEvent: any) => void;
  services?: any[];
  isAdminView?: boolean;
}

const EditEvent: React.FC<EditEventProps> = ({ event, therapistId, onBack, onSave, services = [], isAdminView = false }) => {
  const [eventName, setEventName] = useState(event.title);
  const [description, setDescription] = useState(event.editViewDescription || event.detailedDescription || event.description);
  const [slug, setSlug] = useState(event.slug.replace('/', ''));
  const [activeTab, setActiveTab] = useState(event.initialTab || 'Basic');
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [showLinkDropdown, setShowLinkDropdown] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // #9: availability management requires a connected Google Calendar.
  // null = unknown (fail open so a status-check outage never locks the UI).
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!therapistId) return; // no id → can't check; don't block
    let cancelled = false;
    fetch(`/api/auth/google/status?therapistId=${encodeURIComponent(String(therapistId))}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data) setGoogleConnected(!!data.connected); })
      .catch(() => { /* fail open */ });
    return () => { cancelled = true; };
  }, [therapistId]);

  // Schedule API State
  const [scheduleData, setScheduleData] = useState<any>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activePicker, setActivePicker] = useState<{ dayIdx: number, tIdx: number, field: 'start' | 'end', type: 'weekly' | 'override' } | null>(null);
  const [modalTimeSlots, setModalTimeSlots] = useState<{start: string, end: string}[]>([{ start: "09:00", end: "17:00" }]);

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    return timeStr;
  };

  // Format a YYYY-MM-DD override date without UTC-parsing pitfalls
  // (new Date('YYYY-MM-DD') is parsed as UTC midnight, which can render
  // as the previous day in timezones behind UTC).
  const formatOverrideDate = (dayStr: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{1,2})$/.exec(dayStr || '');
    if (!m) return dayStr;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      setActivePicker(null);
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLinkDropdown(false);
      }
    };
    if (activePicker || showLinkDropdown) {
      window.addEventListener('click', handleClickOutside);
    }
    return () => window.removeEventListener('click', handleClickOutside);
  }, [activePicker, showLinkDropdown]);

  useEffect(() => {
    if (activeTab === 'Schedule') {
      if (!scheduleData) {
        if (event.scheduleId) {
          fetchSchedule();
        } else {
          // #Fix3: If scheduleId is missing, show error and prevent edit
          setError('Schedule not configured. Please go back and ensure the service was created properly.');
        }
      }
    }
  }, [activeTab, event.scheduleId, scheduleData]);

  const fetchSchedule = async () => {
    try {
      setLoadingSchedule(true);
      setError(null);
      const response = await fetch(`/api/dayschedule/schedules/${event.scheduleId}`);
      if (!response.ok) throw new Error('Failed to fetch schedule');
      let data = await response.json();
      console.log('[DEBUG Frontend] Received scheduleData:', data);

      // Handle case where API returns [ { ... } ] instead of { ... }
      if (Array.isArray(data) && data.length > 0) {
        data = data[0];
      }

      if (data) {
        let mergedAvail = [...(data.availability || [])];
        if (data.date_overrides) {
          data.date_overrides.forEach((ov: any) => {
            mergedAvail.push({ day: ov.date, is_available: true, times: ov.availability || [] });
          });
        }
        if (data.exclusions) {
          data.exclusions.forEach((ex: any) => {
            mergedAvail.push({ day: ex.start, is_available: false, times: [] });
          });
        }
        data.availability = mergedAvail;
      }

      setScheduleData(data);
    } catch (err: any) {
      console.error('Error:', err);
      setError(err.message);
    } finally {
      setLoadingSchedule(false);
    }
  };

  const handleUpdateSchedule = async () => {
    if (!event.scheduleId || !scheduleData) return;
    if (googleConnected === false) {
      alert('Google Calendar is not connected for this therapist. Connect it before updating availability.');
      return;
    }

    try {
      setSaveLoading(true);
      const dayMap: { [key: string]: string } = {
        'SUN': 'sunday', 'MON': 'monday', 'TUE': 'tuesday', 'WED': 'wednesday',
        'THU': 'thursday', 'FRI': 'friday', 'SAT': 'saturday'
      };

      const daysToEnsure = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const standardAvailability = scheduleData.availability.filter((a: any) => !/\d{4}-\d{2}-\d{2}/.test(a.day || a.date));
      const overridesList = scheduleData.availability.filter((a: any) => /\d{4}-\d{2}-\d{2}/.test(a.day || a.date));

      // Match by 3-letter prefix so both stored full names ("sunday") and grid short
      // names ("SUN") are recognized. Previously this used exact equality against "SUN",
      // which never matched DB-loaded "sunday" entries and silently wiped the weekly
      // schedule to all-unavailable whenever an override was saved without re-dragging
      // the grid.
      const finalAvailability = daysToEnsure.map(d => {
        const existing = standardAvailability.find((a: any) => (a.day || '').toUpperCase().startsWith(d));
        return existing || { day: d, is_available: false, times: [{ start: '09:00', end: '17:00' }] };
      });

      const cleanAvailability = finalAvailability.map((a: any) => ({
        // Normalize any day-name variant (SUN / sunday / Sunday) to the canonical
        // lowercase full name the backend slot generator expects.
        day: dayMap[(a.day || '').toUpperCase().slice(0, 3)] || a.day,
        is_available: a.is_available,
        times: (a.times || []).map((t: any) => ({
          start: t.start,
          end: t.end
        }))
      }));

      // Format overrides for schedule schema
      const dateOverrides = overridesList
        .filter((a: any) => a.is_available)
        .map((a: any) => ({
          date: a.day || a.date,
          availability: (a.times || []).map((t: any) => ({ start: t.start, end: t.end }))
        }));

      const exclusions = overridesList
        .filter((a: any) => !a.is_available)
        .map((a: any) => ({
          start: a.day || a.date,
          end: a.day || a.date,
          reason: "Override Unavailable"
        }));

      const updateBody: any = {
        name: `${event.owner}'s Schedule`,
        time_zone: scheduleData.time_zone,
        availability: cleanAvailability,
        date_overrides: dateOverrides,
        exclusions: exclusions,
        is_default: false,
        therapist_id: therapistId,
        scheduleId: event.scheduleId
      };

      const response = await fetch(`/api/dayschedule/schedules/${event.scheduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      });
      if (!response.ok) {
        let errMsg = 'Failed to update schedule';
        try {
          const errBody = await response.json();
          errMsg = errBody.detail || errBody.error || errMsg;
          console.error('[EditEvent] PUT failed:', errBody);
        } catch { /* ignore parse error */ }
        throw new Error(errMsg);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setIsEditingSchedule(false);

      // Optimistic UI Update: Instantly reflect the changes locally
      setScheduleData((prev: any) => ({
        ...prev,
        availability: cleanAvailability
      }));

      // Refresh local schedule data from database
      fetchSchedule();
    } catch (err: any) {
      alert(`Error updating schedule: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  };

  const toggleDayAvailabilityByName = (dayName: string) => {
    if (!scheduleData) return;
    const existingIndex = (scheduleData.availability || []).findIndex((a: any) => a.day.toUpperCase() === dayName.toUpperCase());

    let newAvailability = [...(scheduleData.availability || [])];
    if (existingIndex > -1) {
      newAvailability[existingIndex] = { ...newAvailability[existingIndex], is_available: !newAvailability[existingIndex].is_available };
    } else {
      // Add missing day back
      newAvailability.push({ day: dayName.toUpperCase(), is_available: true, times: [{ start: '09:00', end: '17:00' }] });
    }
    setScheduleData({ ...scheduleData, availability: newAvailability });
  };

  const updateTimeRangeByName = (dayName: string, timeIndex: number, field: 'start' | 'end', value: string) => {
    if (!scheduleData) return;
    const existingIndex = (scheduleData.availability || []).findIndex((a: any) => a.day.toUpperCase() === dayName.toUpperCase());

    let newAvailability = [...(scheduleData.availability || [])];
    if (existingIndex > -1) {
      const newTimes = [...newAvailability[existingIndex].times];
      newTimes[timeIndex] = { ...newTimes[timeIndex], [field]: value };
      newAvailability[existingIndex] = { ...newAvailability[existingIndex], times: newTimes };
    }
    setScheduleData({ ...scheduleData, availability: newAvailability });
  };

  const addTimeSlotByName = (dayName: string) => {
    if (!scheduleData) return;
    const existingIndex = (scheduleData.availability || []).findIndex((a: any) => a.day.toUpperCase() === dayName.toUpperCase());
    let newAvailability = [...(scheduleData.availability || [])];
    if (existingIndex > -1) {
      const currentTimes = newAvailability[existingIndex].times || [];
      // Default new slot starts after the last end time
      const lastEnd = currentTimes.length > 0 ? currentTimes[currentTimes.length - 1].end : '09:00';
      newAvailability[existingIndex] = {
        ...newAvailability[existingIndex],
        times: [...currentTimes, { start: lastEnd, end: lastEnd }]
      };
    }
    setScheduleData({ ...scheduleData, availability: newAvailability });
  };

  const removeTimeSlotByName = (dayName: string, timeIndex: number) => {
    if (!scheduleData) return;
    const existingIndex = (scheduleData.availability || []).findIndex((a: any) => a.day.toUpperCase() === dayName.toUpperCase());
    let newAvailability = [...(scheduleData.availability || [])];
    if (existingIndex > -1) {
      const newTimes = newAvailability[existingIndex].times.filter((_: any, i: number) => i !== timeIndex);
      newAvailability[existingIndex] = { ...newAvailability[existingIndex], times: newTimes };
    }
    setScheduleData({ ...scheduleData, availability: newAvailability });
  };

  const addOverride = () => {
    if (!scheduleData || !selectedDate) return;

    // Format date as YYYY-MM-DD (Local)
    const dayStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`;

    const newOverride = {
      day: dayStr,
      is_available: overrideAvailability === 'available',
      times: (overrideAvailability === 'unavailable' && allDayUnavailable) ? [] : [...modalTimeSlots]
    };

    // Avoid duplicates
    const filtered = (scheduleData.availability || []).filter((a: any) => a.day !== dayStr);
    setScheduleData({
      ...scheduleData,
      availability: [...filtered, newOverride]
    });
    setModalTimeSlots([{ start: "09:00", end: "17:00" }]);
    setAllDayUnavailable(true);
    setShowOverrideModal(false);
  };

  const deleteOverride = (dayStr: string) => {
    if (!scheduleData) return;
    const newAvailability = (scheduleData.availability || []).filter((a: any) => a.day !== dayStr);
    setScheduleData({ ...scheduleData, availability: newAvailability });
  };

  // Calendar state
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<number | null>(today.getDate());
  const [overrideAvailability, setOverrideAvailability] = useState<'available' | 'unavailable'>('available');
  const [allDayUnavailable, setAllDayUnavailable] = useState(true);

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

  const prevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const handleSave = () => {
    onSave({
      ...event,
      title: eventName,
      description,
      slug: `/${slug}`
    });
  };

  const TimePicker = ({ current, onSelect }: { current: string, onSelect: (val: string) => void }) => {
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
    const [currH, currM] = current.split(':');

    const hRef = React.useRef<HTMLDivElement>(null);
    const mRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      if (hRef.current) hRef.current.scrollIntoView({ block: 'start' });
      if (mRef.current) mRef.current.scrollIntoView({ block: 'start' });
    }, []);

    return (
      <div className="custom-time-picker">
        <div className="picker-column">
          {hours.map(h => (
            <div
              key={h}
              ref={h === currH ? hRef : null}
              className={`picker-option ${h === currH ? 'selected' : ''}`}
              onClick={() => onSelect(`${h}:${currM || '00'}`)}
            >
              {h}
            </div>
          ))}
        </div>
        <div className="picker-column">
          {minutes.map(m => (
            <div
              key={m}
              ref={m === currM ? mRef : null}
              className={`picker-option ${m === currM ? 'selected' : ''}`}
              onClick={() => onSelect(`${currH || '09'}:${m}`)}
            >
              {m}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderScheduleTab = () => {
    if (isEditingSchedule) {
      return (
        <div className="edit-schedule-view full-width">
          <div className="edit-schedule-header">
            <div className="header-left">
              <button className="back-btn-pill" onClick={() => setIsEditingSchedule(false)}>
                <ArrowLeft size={16} />
              </button>
            </div>
            <div className="header-actions">
              <button className="cancel-btn" onClick={() => setIsEditingSchedule(false)}>Cancel</button>
              <button
                className="update-btn"
                onClick={handleUpdateSchedule}
                disabled={saveLoading}
              >
                {saveLoading ? <Loader2 size={16} className="animate-spin" /> : 'Update Schedule'}
              </button>
            </div>
          </div>

          <div className="edit-form-grid">
            {/* LEFT COLUMN */}
            <div className="form-column main">
              {/* Schedule Name + Timezone row */}
              <div className="fields-row">
                <div className="field">
                  <label className="field-label">Schedule Name</label>
                  <input className="field-input readonly" type="text" value={(event.owner ? `${event.owner}'s Schedule` : scheduleData?.name) || "Loading..."} readOnly />
                </div>
                <div className="field">
                  <label className="field-label">Time zone</label>
                  <div className="dropdown-mock readonly">
                    <span>{scheduleData?.time_zone || "Calculating..."}</span>
                    <ChevronDown size={14} />
                  </div>
                </div>
              </div>

              {/* Weekly Availability — drag-to-select calendar grid */}
              <div className="availability-grid">
                <span className="section-label">Weekly Availability</span>
                {loadingSchedule ? (
                  <div className="loading-state">
                    <Loader2 className="animate-spin" />
                    <p>Fetching availability...</p>
                  </div>
                ) : error ? (
                  <div className="error-state">
                    <AlertCircle className="text-red-500" />
                    <p>{error}</p>
                    <button onClick={fetchSchedule} className="retry-btn">Retry</button>
                  </div>
                ) : (
                  <ScheduleCalendarGrid
                    availability={scheduleData?.availability || []}
                    onChange={(newAvail) => {
                      setScheduleData((prev: any) => ({
                        ...prev,
                        availability: newAvail,
                      }));
                    }}
                  />
                )}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="form-column side">
              {/* Date Overrides - HIDDEN */}
              <div className="override-section">
                <div className="override-header">
                  <span className="override-title">Date Overrides</span>
                  <button className="add-override-btn" onClick={() => setShowOverrideModal(true)}>+ Add Override</button>
                </div>

                {(scheduleData?.availability || []).filter((a: any) => /\d{4}-\d{2}-\d{1,2}/.test(a.day)).length === 0 ? (
                  <div className="empty-override-box">
                    <p className="no-override-text">No date overrides</p>
                    <button className="add-override-inner-btn" onClick={() => setShowOverrideModal(true)}>+ Add Override</button>
                  </div>
                ) : (
                  <div className="overrides-edit-list">
                    {(scheduleData?.availability || [])
                      .filter((a: any) => /\d{4}-\d{2}-\d{1,2}/.test(a.day))
                      .map((ov: any) => (
                        <div key={ov.day} className="override-edit-item">
                          <div className="override-info">
                            <span className="ov-date-label">
                              {formatOverrideDate(ov.day)}
                            </span>
                            <span className="ov-time-label">
                              {ov.is_available
                                ? ((ov.times || []).length > 0 ? (ov.times || []).map((t: any) => `${t.start}-${t.end}`).join(', ') : 'Available')
                                : ((ov.times || []).length > 0 ? 'Unavailable: ' + (ov.times || []).map((t: any) => `${t.start}-${t.end}`).join(', ') : 'Unavailable All Day')}
                            </span>
                          </div>
                          <button className="delete-ov-btn" onClick={() => deleteOverride(ov.day)}>✕</button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Add Date Override Modal */}
          {showOverrideModal && (
            <div className="modal-backdrop" onClick={() => { setShowOverrideModal(false); setModalTimeSlots([{ start: "09:00", end: "17:00" }]); }}>
              <div className="override-modal" onClick={e => { e.stopPropagation(); setActivePicker(null); }}>
                {/* Modal Header */}
                <div className="modal-header">
                  <div>
                    <h2 className="modal-title">Add Date Override</h2>
                    <p className="modal-subtitle">
                      Use date override to customize your schedule by selecting multiple dates for holidays, adjusted work hours, or special exceptions.{' '}
                      <a href="#" className="learn-more-link">Learn more ↗</a>
                    </p>
                  </div>
                  <button className="modal-close-btn" onClick={() => { setShowOverrideModal(false); setModalTimeSlots([{ start: "09:00", end: "17:00" }]); }}>✕</button>
                </div>

                {/* Modal Body */}
                <div className="modal-body">
                  {/* Calendar */}
                  <div className="modal-calendar">
                    <div className="cal-nav">
                      <button className="cal-arrow" onClick={prevMonth}>‹</button>
                      <span className="cal-month-label">{MONTH_NAMES[calMonth]} {calYear}</span>
                      <button className="cal-arrow" onClick={nextMonth}>›</button>
                    </div>
                    <div className="cal-grid">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                        <div key={d} className="cal-day-header">{d}</div>
                      ))}
                      {Array.from({ length: getFirstDayOfMonth(calMonth, calYear) }).map((_, i) => (
                        <div key={`empty-${i}`} className="cal-day empty" />
                      ))}
                      {Array.from({ length: getDaysInMonth(calMonth, calYear) }, (_, i) => i + 1).map(day => {
                        const thisDate = new Date(calYear, calMonth, day);
                        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                        const isPast = thisDate < todayDate;
                        const isSunday = thisDate.getDay() === 0;
                        const isDisabled = isPast || isSunday;
                        const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                        const isSelected = day === selectedDate;
                        return (
                          <div
                            key={day}
                            className={`cal-day${isSelected ? ' selected' : ''}${isToday && !isSelected ? ' today' : ''}${isDisabled ? ' past' : ''}`}
                            onClick={() => !isDisabled && setSelectedDate(day)}
                          >
                            {day}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Panel */}
                  <div className="modal-right">
                    {/* Availability */}
                    <div className="modal-section">
                      <span className="modal-section-title">Availability</span>
                      <label className="radio-label mt8">
                        <input type="radio" name="overrideAvail" checked={overrideAvailability === 'available'} onChange={() => setOverrideAvailability('available')} />
                        <span>Available</span>
                      </label>
                      <label className="radio-label">
                        <input type="radio" name="overrideAvail" checked={overrideAvailability === 'unavailable'} onChange={() => setOverrideAvailability('unavailable')} />
                        <span>Unavailable</span>
                      </label>
                      
                      {overrideAvailability === 'unavailable' && (
                        <label className="checkbox-label mt8" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, marginTop: 8 }}>
                          <input type="checkbox" checked={allDayUnavailable} onChange={(e) => setAllDayUnavailable(e.target.checked)} />
                          <span>Unavailable All Day</span>
                        </label>
                      )}
                    </div>

                    {/* Time Slots */}
                    {(overrideAvailability === 'available' || !allDayUnavailable) && (
                      <div className="modal-section">
                        <span className="modal-section-title">Time Slots</span>
                        {modalTimeSlots.map((slot, tIdx) => (
                          <div key={tIdx} className="time-slot-row mb-2">
                            <div className="time-input-wrap" onClick={(e) => {
                              e.stopPropagation();
                              const isOpen = activePicker?.type === 'override' && activePicker.tIdx === tIdx && activePicker.field === 'start';
                              setActivePicker(isOpen ? null : { dayIdx: -1, tIdx, field: 'start', type: 'override' });
                            }}>
                              <input className="time-input" type="text" value={slot.start} readOnly />
                              <Clock size={13} className="time-icon" />
                              {activePicker?.type === 'override' && activePicker.tIdx === tIdx && activePicker.field === 'start' && (
                                <TimePicker
                                  current={slot.start}
                                  onSelect={(val) => {
                                    const newSlots = [...modalTimeSlots];
                                    newSlots[tIdx] = { ...newSlots[tIdx], start: val };
                                    setModalTimeSlots(newSlots);
                                    setActivePicker(null);
                                  }}
                                />
                              )}
                            </div>
                            <span className="to-label">to</span>
                            <div className="time-input-wrap" onClick={(e) => {
                              e.stopPropagation();
                              const isOpen = activePicker?.type === 'override' && activePicker.tIdx === tIdx && activePicker.field === 'end';
                              setActivePicker(isOpen ? null : { dayIdx: -1, tIdx, field: 'end', type: 'override' });
                            }}>
                              <input className="time-input" type="text" value={slot.end} readOnly />
                              <Clock size={13} className="time-icon" />
                              {activePicker?.type === 'override' && activePicker.tIdx === tIdx && activePicker.field === 'end' && (
                                <TimePicker
                                  current={slot.end}
                                  onSelect={(val) => {
                                    const newSlots = [...modalTimeSlots];
                                    newSlots[tIdx] = { ...newSlots[tIdx], end: val };
                                    setModalTimeSlots(newSlots);
                                    setActivePicker(null);
                                  }}
                                />
                              )}
                            </div>
                            
                            {modalTimeSlots.length > 1 && (
                              <button 
                                className="icon-btn remove-slot-btn" 
                                style={{ marginLeft: 8 }}
                                title="Remove this slot"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setModalTimeSlots(modalTimeSlots.filter((_, i) => i !== tIdx));
                                }}
                              >
                                ×
                              </button>
                            )}
                            <button 
                              className="icon-btn" 
                              title="Add new slot"
                              onClick={(e) => {
                                e.preventDefault();
                                const newSlots = [...modalTimeSlots, { start: slot.end, end: slot.end }];
                                setModalTimeSlots(newSlots);
                              }}
                            >
                              +
                            </button>
                            <button 
                              className="icon-btn" 
                              title="Copy this slot"
                              onClick={(e) => {
                                e.preventDefault();
                                const newSlots = [...modalTimeSlots];
                                newSlots.splice(tIdx + 1, 0, { ...slot });
                                setModalTimeSlots(newSlots);
                              }}
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="modal-footer">
                  <button className="cancel-btn" onClick={() => { setShowOverrideModal(false); setModalTimeSlots([{ start: "09:00", end: "17:00" }]); }}>Cancel</button>
                  <button className="update-btn" onClick={addOverride}>Add Override</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    const weeklyDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const getWeeklyAvailability = () => {
      if (!scheduleData) return weeklyDays.map(day => ({ day, time: 'Unavailable', active: false }));
      const availArray = scheduleData.availability || [];
      return weeklyDays.map(day => {
        const match = availArray.find((a: any) => {
          const apiDay = (a.day || '').toUpperCase();
          const targetDay = day.toUpperCase();
          return apiDay === targetDay || apiDay.startsWith(targetDay);
        });
        return {
          day,
          time: match?.is_available && match.times?.length > 0
            ? match.times.map((t: any) => `${formatTime(t.start)} - ${formatTime(t.end)}`).join(', ')
            : 'Unavailable',
          active: match?.is_available || false
        };
      });
    };

    const getOverrides = () => {
      if (!scheduleData || !scheduleData.availability) return [];
      return scheduleData.availability.filter((a: any) => /\d{4}-\d{2}-\d{2}/.test(a.day));
    };

    return (
      <div className="main-schedule-view">
        <div className="schedule-card-header">
          <div className="title-block">
            <h3>Weekly Availability</h3>
            <p>Your default hours and time slot settings</p>
          </div>
          <div className="header-actions">
            <button
              className="edit-schedule-btn"
              onClick={() => setIsEditingSchedule(true)}
              disabled={googleConnected === false}
              style={googleConnected === false ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              title={googleConnected === false ? 'Connect Google Calendar to manage availability' : undefined}
            >
              <Clock size={16} />
              Edit Schedule
            </button>
          </div>
        </div>

        {!event.scheduleId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', margin: '12px 0', fontSize: 14 }}>
            <AlertCircle size={16} />
            <span>Schedule not found. Please go back and ensure this service is properly saved.</span>
          </div>
        )}

        {googleConnected === false && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', borderRadius: 8, padding: '10px 14px', margin: '12px 0', fontSize: 14 }}>
            <AlertCircle size={16} />
            <span>Google Calendar is not connected for this therapist. Availability cannot be managed until it is connected.</span>
          </div>
        )}

        {loadingSchedule ? (
          <div className="loading-state">
            <Loader2 className="animate-spin" size={24} />
            <p>Loading schedule...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <AlertCircle size={24} />
            <p>{error}</p>
            <button onClick={fetchSchedule} className="retry-btn">Retry</button>
          </div>
        ) : (
          <>
            <div className="availability-visual-grid">
              {getWeeklyAvailability().map((item) => (
                <div key={item.day} className={`day-card ${!item.active ? 'inactive' : ''}`}>
                  <div className="day-header">{item.day}</div>
                  <div className="day-body">
                    {item.active ? (
                      <span className="time-pill">{item.time}</span>
                    ) : (
                      <span className="unavailable-pill">Unavailable</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {getOverrides().length > 0 && (
              <div className="overrides-summary-section">
                <h4 className="section-subtitle">Date Overrides</h4>
                <div className="overrides-list">
                  {getOverrides().map((ov: any) => (
                    <div key={ov.day} className="override-item-pill">
                      <span className="override-date">
                        {formatOverrideDate(ov.day)}
                      </span>
                      <span className="override-time">
                        {ov.is_available && (ov.times || []).length > 0
                          ? (ov.times || []).map((t: any) => `${formatTime(t.start)} - ${formatTime(t.end)}`).join(', ')
                          : 'Unavailable'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="schedule-meta">
          <div className="meta-item">
            <UserIcon size={16} />
            <span>Timezone: <strong>{scheduleData?.time_zone || 'Asia/Calcutta'}</strong></span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="edit-event-container">
      <header className="edit-event-header">
        <div className="header-left-group">
          <button className="back-btn" onClick={onBack}>
            <ArrowLeft size={24} />
          </button>
          <div className="header-title-group">
            <h1>{isAdminView && event.owner ? `${event.owner}'s Availabilities` : 'My Availabilities'}</h1>
            <p>Set and manage your weekly therapy schedule and date overrides.</p>
          </div>
        </div>
        {!isAdminView && (
          <div className="header-right-group" style={{ position: 'relative' }} ref={dropdownRef}>
            <button
              className="update-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={(e) => {
                e.stopPropagation();
                setShowLinkDropdown(!showLinkDropdown);
              }}
            >
              <Link size={16} />
              Public Booking Links
              <ChevronDown size={14} className={showLinkDropdown ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>

            {showLinkDropdown && (
              <div className="absolute right-0 top-full mt-2 w-[400px] bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b">
                  <h3 className="text-sm font-semibold text-gray-800">Your Booking Links</h3>
                  <p className="text-xs text-gray-500 mt-1">Share these links with your clients to allow them to book sessions.</p>
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {(services || []).length > 0 ? (
                    services.map((service: any, idx: number) => (
                      <div key={idx} className="p-4 border-b last:border-0 hover:bg-gray-50 transition-colors">
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 mb-1">{service.title}</p>
                            <p className="text-xs text-teal-700 font-mono bg-teal-50 inline-block px-2 py-1 rounded">/book{service.slug}</p>
                          </div>
                          <div className="flex flex-col gap-2">
                            <button
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-100 text-gray-700 font-medium w-full justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(`${window.location.origin}/book${service.slug}`);
                                setShowLinkDropdown(false);
                                setToast({ message: 'Booking link copied to clipboard!', type: 'success' });
                              }}
                            >
                              <Copy size={12} />
                              Copy Link
                            </button>
                            <button
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-teal-50 text-teal-700 border border-teal-100 rounded hover:bg-teal-100 font-medium w-full justify-center"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`${window.location.origin}/book${service.slug}`, '_blank');
                              }}
                            >
                              <ExternalLink size={12} />
                              Open
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-sm text-gray-500">
                      No links available
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="edit-event-content">
        <section className="main-form-area full-width">
          {renderScheduleTab()}
        </section>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

// Simple helper icon for the list item
const FileTextIcon = ({ size }: { size: number }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

export default EditEvent;
