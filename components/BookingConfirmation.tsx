import React, { useEffect, useState } from 'react';
import {
  Check, X, Calendar, Clock, User, Video, MapPin,
  ChevronLeft, AlertCircle, Loader2, CalendarPlus
} from 'lucide-react';
import moment from 'moment';
import { therapistData } from '../lib/sessionData';
import './BookingPage.css';

interface BookingConfirmationProps {
  bookingId: string;
}

interface BookingDetails {
  booking_id: string;
  invitee_name: string;
  booking_start_at: string;
  booking_invitee_time: string;
  booking_resource_name: string;
  booking_host_name: string;
  booking_status: 'confirmed' | 'cancelled';
  booking_cancel_reason: string | null;
  booking_joining_link: string | null;
  booking_mode: string | null;
}

// Normalize the stored booking_mode into a customer-friendly label + online/in-person flag
const resolveSessionMode = (mode: string | null | undefined) => {
  const m = (mode || '').toLowerCase();
  const isInPerson = m.includes('person') || m.includes('office') || m.includes('clinic') || m.includes('physical');
  return {
    isOnline: !isInPerson,
    label: isInPerson ? 'In-person' : 'Google Meet',
  };
};

const OFFICE_LOCATION = 'SafeStories Office — Lullanagar, Pune, Maharashtra 411040';

export const BookingConfirmation: React.FC<BookingConfirmationProps> = ({ bookingId }) => {
  const [booking, setBooking] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'details' | 'cancelling'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'cancel' ? 'cancelling' : 'details';
  });
  const [cancelReason, setCancelReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);

  useEffect(() => {
    fetchBooking();
  }, [bookingId]);

  const fetchBooking = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/public/booking/${bookingId}`);
      if (!res.ok) throw new Error('Booking not found');
      const data = await res.json();
      setBooking(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) return;
    
    try {
      setIsSubmitting(true);
      const res = await fetch('/api/cancel-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          reason: cancelReason,
          notify: true
        })
      });

      if (!res.ok) throw new Error('Failed to cancel booking');
      
      // Refresh local state
      await fetchBooking();
      setView('details');
    } catch (err: any) {
      alert('Error cancelling booking: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bp-root">
        <Loader2 className="animate-spin text-teal-600" size={48} />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="bp-root">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Link Expired or Invalid</h2>
          <p className="text-gray-700">{error || "The booking information is no longer available."}</p>
        </div>
      </div>
    );
  }

  // Determine session data from therapistData for left sidebar
  const therapistName = booking.booking_host_name;

  // 1. Exact match, 2. Fuzzy match (partial name), 3. Generic fallback
  const findTherapistInfo = (name: string) => {
    if (!name) return null;
    // Exact match
    if (therapistData[name]) return therapistData[name];
    // Fuzzy: key contains name or name contains key
    const nameLower = name.toLowerCase();
    const fuzzyMatch = Object.entries(therapistData).find(([key]) => {
      const keyLower = key.toLowerCase();
      return keyLower.includes(nameLower) || nameLower.includes(keyLower);
    });
    return fuzzyMatch ? fuzzyMatch[1] : null;
  };

  const therapistInfo = findTherapistInfo(therapistName) || {
    url: '',
    services: [{
      title: booking.booking_resource_name || 'Therapy Session',
      detailedDescription: `Your session with **${therapistName}** at SafeStories has been confirmed.\n\nSessions are conducted either via Google Meet or in-person at SafeStories, Lullanagar, Pune.\n\nCancellations are free until 24 hours before the appointment.`,
      duration: '50 mins',
      charges: '',
      slug: '',
      label: ''
    }]
  };

  const service = therapistInfo.services.find((s: any) =>
    s.title.toLowerCase().includes((booking.booking_resource_name || '').toLowerCase()) ||
    (booking.booking_resource_name || '').toLowerCase().includes(s.title.toLowerCase())
  ) || therapistInfo.services[0];

  const isCancelled = booking.booking_status?.toLowerCase() === 'cancelled';
  const sessionMode = resolveSessionMode(booking.booking_mode);
  // Use booking_start_at, fall back to booking_invitee_time
  const rawDate = booking.booking_start_at || booking.booking_invitee_time;
  const startTime = rawDate ? moment.utc(rawDate).utcOffset('+05:30') : null;
  const durationMatch = service.duration.match(/\d+/);
  const duration = durationMatch ? parseInt(durationMatch[0]) : 50;

  return (
    <div className="bp-root">
      <div className="bp-container">
        
        {/* ── LEFT: Session Summary ── */}
        <div className="bp-pane bp-summary">
          <div className="bp-logo">
            <div className="bp-logo-top">
              <span className="bp-safe">Safe</span>
              <svg width="48" height="32" viewBox="0 0 60 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: 6 }}>
                <path d="M15 5 H45 A12 12 0 0 1 57 17 V17 A12 12 0 0 1 45 29 H42 L38 38 L34 29 H15 A12 12 0 0 1 3 17 V17 A12 12 0 0 1 15 5 Z"
                  stroke="#21615D" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="16" cy="17" r="3" fill="#F4A936" />
                <circle cx="26" cy="17" r="3" fill="#F4A936" />
                <circle cx="36" cy="17" r="3" fill="#F4A936" />
                <circle cx="46" cy="17" r="3" fill="#F4A936" />
              </svg>
            </div>
            <span className="bp-stories">Stories</span>
          </div>

          <h1 className="bp-title">{service.title}</h1>

          <div className="bp-desc">
            {(() => {
              const paragraphs = service.detailedDescription.split('\n\n');
              const isMobile = window.innerWidth <= 1024;
              const visible = (isMobile && !showFullDesc) ? paragraphs.slice(0, 1) : paragraphs;
              return (
                <>
                  {visible.map((paragraph, i) => {
                    const parts = paragraph.split('**');
                    return (
                      <p key={i} className="bp-desc-line" style={i > 0 ? { marginTop: 16 } : {}}>
                        {parts.map((part, index) =>
                          index % 2 === 1 ? <strong key={index}>{part}</strong> : part
                        )}
                      </p>
                    );
                  })}
                  {isMobile && paragraphs.length > 1 && (
                    <button
                      onClick={() => setShowFullDesc(v => !v)}
                      style={{ marginTop: 8, fontSize: 13, color: '#21615D', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {showFullDesc ? 'Show less ▲' : 'Read more ▼'}
                    </button>
                  )}
                </>
              );
            })()}
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <div className="bp-control-group" style={{ padding: '4px 12px' }}>
              <Clock size={14} style={{ color: '#21615D' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{service.duration}</span>
            </div>
            <div className="bp-control-group" style={{ padding: '4px 12px' }}>
              {sessionMode.isOnline
                ? <Video size={14} style={{ color: '#21615D' }} />
                : <MapPin size={14} style={{ color: '#21615D' }} />}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{sessionMode.label}</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Confirmation Content ── */}
        <div className="bp-pane" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
          
          <div className="bp-conf-content">
            
            {view === 'details' ? (
              <>
                <div className="bp-conf-icon-wrapper">
                  <div className={`bp-conf-icon-circle ${isCancelled ? 'error' : 'success'}`}>
                    {isCancelled ? <X size={40} /> : <Check size={40} />}
                  </div>
                </div>

                <h2 className="bp-conf-status-title">
                  {isCancelled ? 'Booking Canceled' : 'Booking Confirmed!'}
                </h2>
                <p className="bp-conf-status-subtitle">
                  {isCancelled 
                    ? `Your session with ${therapistName} has been cancelled.` 
                    : `You're all set! A confirmation with the meeting details has been sent to your email.`
                  }
                </p>

                <div className="bp-conf-card">
                  <div className="bp-conf-item">
                    <User className="bp-conf-item-icon" size={20} />
                    <div className="bp-conf-item-text">
                      {booking.invitee_name}
                      <span className={`bp-conf-badge ${isCancelled ? 'cancelled' : 'confirmed'}`}>
                        {booking.booking_status}
                      </span>
                    </div>
                  </div>

                  <div className="bp-conf-item">
                    <Calendar className="bp-conf-item-icon" size={20} />
                    <div className="bp-conf-item-text">
                      {startTime ? startTime.format('dddd, D MMMM, YYYY') : '—'}
                    </div>
                  </div>

                  <div className="bp-conf-item">
                    <Clock className="bp-conf-item-icon" size={20} />
                    <div className="bp-conf-item-text">
                      {booking.booking_invitee_time
                        ? booking.booking_invitee_time.replace(/^.*at\s*/i, '').replace(/\s*IST$/, ' (IST)')
                        : startTime ? `${startTime.format('h:mm A')} - ${startTime.clone().add(duration, 'minutes').format('h:mm A')} (IST)` : '—'}
                    </div>
                  </div>

                  {isCancelled ? (
                    booking.booking_cancel_reason && (
                      <div className="bp-conf-item">
                        <AlertCircle className="bp-conf-item-icon" size={20} style={{ color: '#ef4444' }} />
                        <div className="bp-conf-item-text bp-conf-reason-text">
                          {booking.booking_cancel_reason}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="bp-conf-item">
                      {sessionMode.isOnline
                        ? <Video className="bp-conf-item-icon" size={20} />
                        : <MapPin className="bp-conf-item-icon" size={20} />}
                      <div className="bp-conf-item-text">
                        <span style={{ display: 'block', fontWeight: 600, marginBottom: 2 }}>{sessionMode.label}</span>
                        {sessionMode.isOnline
                          ? (booking.booking_joining_link
                              ? <a href={booking.booking_joining_link} target="_blank" rel="noopener noreferrer" className="bp-conf-meet-link">{booking.booking_joining_link}</a>
                              : <span style={{ fontSize: 13, color: '#6b7280' }}>The meeting link will be shared before your session.</span>)
                          : <span style={{ fontSize: 13, color: '#374151' }}>{OFFICE_LOCATION}</span>}
                      </div>
                    </div>
                  )}
                </div>

                {!isCancelled && (
                  <>
                    <button className="bp-conf-calendar-btn" onClick={() => {
                      if (!startTime) return;
                      const start = startTime.clone().utc().format('YYYYMMDDTHHmmss') + 'Z';
                      const end = startTime.clone().add(duration, 'minutes').utc().format('YYYYMMDDTHHmmss') + 'Z';
                      const title = encodeURIComponent(service.title);
                      const details = encodeURIComponent(`Meeting link: ${booking.booking_joining_link || ''}`);
                      const location = encodeURIComponent('SafeStories, Lullanagar, Pune / Google Meet');
                      const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
                      window.open(url, '_blank');
                    }}>
                      <CalendarPlus size={20} />
                      Add to Calendar
                    </button>

                    <button className="bp-conf-cancel-trigger" onClick={() => setView('cancelling')}>
                      <X size={16} />
                      Cancel Booking
                    </button>
                  </>
                )}
              </>
            ) : (
              /* CANCELLATION FORM */
              <div className="bp-conf-cancel-form">
                <button className="bp-back" onClick={() => setView('details')} style={{ marginBottom: 20 }}>
                  <ChevronLeft size={18} /> Back
                </button>
                
                <h2 className="bp-conf-status-title" style={{ textAlign: 'left' }}>Cancel Booking</h2>
                <p className="bp-conf-status-subtitle" style={{ textAlign: 'left', marginBottom: 24 }}>
                  Please let us know the reason for cancellation.
                </p>

                <div className="bp-conf-card" style={{ marginBottom: 24 }}>
                   <div className="bp-conf-item">
                    <Calendar className="bp-conf-item-icon" size={18} />
                    <div className="bp-conf-item-text" style={{ fontSize: 14 }}>
                      {booking.booking_invitee_time
                        ? booking.booking_invitee_time.replace(/^.*at\s*/i, '').replace(/\s*IST$/, ' (IST)')
                        : startTime ? `${startTime.format('dddd, D MMMM, YYYY')} at ${startTime.format('h:mm A')}` : '—'}
                    </div>
                  </div>
                </div>

                <label className="bp-conf-cancel-label">Reason for Cancellation</label>
                <textarea 
                  className="bp-conf-cancel-input" 
                  placeholder="Tell us why you need to cancel..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />

                <button 
                  className="bp-conf-cancel-submit" 
                  onClick={() => {
                    if (!cancelReason.trim()) return;
                    setShowCancelConfirm(true);
                  }}
                  disabled={isSubmitting || !cancelReason.trim()}
                >
                  {isSubmitting ? 'Cancelling...' : 'Cancel Booking'}
                </button>

                {/* Confirmation modal */}
                {showCancelConfirm && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: '#fff', borderRadius: 12, padding: 32, maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: '#111' }}>Confirm Cancellation</h3>
                      <p style={{ fontSize: 14, color: '#4b5563', marginBottom: 20, lineHeight: 1.6 }}>
                        Cancellations are free until 24 hours before the appointment, but changes within that 24-hour window incur a <strong>100% charge for cancellations</strong>.
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 24 }}>Are you sure you want to cancel?</p>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setShowCancelConfirm(false)}
                          style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #d1d5db', background: '#f9fafb', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: '#374151' }}
                        >
                          No, Keep It
                        </button>
                        <button
                          onClick={async () => { setShowCancelConfirm(false); await handleCancel(); }}
                          disabled={isSubmitting}
                          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Yes, Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
};
