import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, Check, Loader2, ArrowRight, ArrowLeft, Mail, CalendarDays, Clock,
  Video, MapPin, User, MessageCircle,
} from 'lucide-react';
import { Logo } from './Logo';
import { InlineCalendar } from './InlineCalendar';
import { Shell, WizardTabs, inputCls, last10, slotLabel, istClock, dateLabel } from './PublicBooking';

/**
 * The free consultation, on its own link.
 *
 * A short introductory call is not a smaller version of booking therapy — it is
 * a different decision. There is no therapy to choose, no therapist to compare,
 * no price to weigh and nothing to pay, so the five-step wizard at /book would
 * spend three of its steps telling this visitor there is nothing to decide.
 * Three steps: who you are, when, and confirm.
 *
 * It deliberately shares /book's frame, tab strip and field styling — the same
 * product, a shorter path through it — and shares its verification too, because
 * an unverified number can hold a real slot in a real calendar here just as it
 * can there.
 */

type Step = 'identity' | 'schedule' | 'confirm';

const TAB_LABELS = ['Your Details', 'Date & Time', 'Confirm'];
const STEP_ORDER: Step[] = ['identity', 'schedule', 'confirm'];

const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+971'];

interface FreeService {
  service_id: number;
  slug: string;
  therapist_name: string;
  duration: string | null;
  therapyName: string;
}

/** One row on the confirmation card. */
const Row: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> =
  ({ icon, label, value }) => (
    <div className="flex items-start gap-3 py-2.5">
      <span className="text-slate-400 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-sm text-slate-900 break-words">{value}</div>
      </div>
    </div>
  );

export const FreeConsultation: React.FC = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('identity');

  // ── identity ──
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [identified, setIdentified] = useState(false);
  const lookedUp = useRef('');

  // ── WhatsApp verification ──
  const [otp, setOtp] = useState('');
  const [otpStage, setOtpStage] = useState<'idle' | 'sending' | 'sent' | 'verifying' | 'verified'>('idle');
  const [otpError, setOtpError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // ── what is being booked ──
  const [service, setService] = useState<FreeService | null>(null);
  const [catalogueFailed, setCatalogueFailed] = useState(false);

  // ── when ──
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [mode, setMode] = useState<'online' | 'in-person'>('online');
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);
  const [monthCursor, setMonthCursor] = useState('');

  // ── final details ──
  const [notes, setNotes] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayIST = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), []);

  const fullPhone = `${countryCode}${phone}`;

  /**
   * The free consultation comes from the same catalogue the booking page uses,
   * found by its flag rather than by name — "Free Consultation" is a title
   * someone can edit, is_free_consultation is what the rest of the system
   * actually keys on.
   */
  useEffect(() => {
    fetch('/api/public/catalogue')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const group = (d?.therapies || []).find((t: any) => t.is_free_consultation);
        const first = group?.therapists?.[0];
        if (!first) { setCatalogueFailed(true); return; }
        setService({
          service_id: first.service_id,
          slug: first.slug,
          therapist_name: first.therapist_name,
          duration: first.duration,
          therapyName: group.name,
        });
      })
      .catch(() => setCatalogueFailed(true));
  }, []);

  // Name and email arrive from the URL when a link was sent; the number still
  // has to be verified, so nothing here shortcuts the step below.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('name')) setName(q.get('name') || '');
    if (q.get('email')) setEmail(q.get('email') || '');
    const p = (q.get('phone') || '').replace(/\D/g, '');
    if (p) {
      setPhone(p.length > 10 ? p.slice(-10) : p);
      if (p.length > 10) setCountryCode(`+${p.slice(0, p.length - 10)}`);
    }
  }, []);

  /** Countdown for the Resend link. */
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /** Editing the number undoes the verification — see /book for why. */
  useEffect(() => {
    setOtpStage('idle'); setOtp(''); setOtpError(''); setResendIn(0);
  }, [phone, countryCode]);

  const requestOtp = async () => {
    setOtpStage('sending'); setOtpError('');
    try {
      const r = await fetch('/api/public/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setOtpError(d.error || 'Could not send the code. Please try again.');
        setOtpStage(d.retryAfterSec ? 'sent' : 'idle');
        if (d.retryAfterSec) setResendIn(d.retryAfterSec);
        return;
      }
      setOtpStage('sent');
      setResendIn(d.resendInSec || 45);
    } catch {
      setOtpError('Could not send the code. Please check your connection.');
      setOtpStage('idle');
    }
  };

  const submitOtp = async () => {
    if (otp.length !== 6) return;
    setOtpStage('verifying'); setOtpError('');
    try {
      const r = await fetch('/api/public/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, otp }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setOtpError(d.error || 'That code is not correct.');
        setOtpStage('sent');
        return;
      }
      setOtpStage('verified');
      setOtpError('');
    } catch {
      setOtpError('Could not verify that code. Please check your connection.');
      setOtpStage('sent');
    }
  };

  /** Fills what we already know once the number is proven, never before it. */
  useEffect(() => {
    const key = last10(phone);
    if (key.length < 10 || otpStage !== 'verified') { setIdentified(false); return; }
    if (lookedUp.current === key) return;

    const t = setTimeout(async () => {
      lookedUp.current = key;
      try {
        const r = await fetch('/api/public/client-history', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: fullPhone }),
        });
        const d = r.ok ? await r.json() : null;
        if (d?.exists) {
          if (d.clientName) setName(d.clientName);
          if (d.clientEmail) setEmail(d.clientEmail);
          if (d.sessionMode) setMode(/online|meet/i.test(d.sessionMode) ? 'online' : 'in-person');
        }
      } catch {
        // A failed lookup must never block a booking.
      }
      setIdentified(true);
    }, 350);

    return () => clearTimeout(t);
  }, [phone, fullPhone, otpStage]);

  // ── which days are open, for the visible month ──
  useEffect(() => {
    if (!service || !monthCursor) { setOpenDays(null); return; }
    const [y, m] = monthCursor.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const to = `${monthCursor.slice(0, 8)}${String(last).padStart(2, '0')}`;
    let live = true;
    fetch(`/api/therapist-open-days?therapistName=${encodeURIComponent(service.therapist_name)}&from=${monthCursor}&to=${to}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setOpenDays(Array.isArray(d?.days) ? new Set<string>(d.days) : null); })
      .catch(() => { if (live) setOpenDays(null); });
    return () => { live = false; };
  }, [service, monthCursor]);

  useEffect(() => {
    if (step === 'schedule' && !monthCursor) setMonthCursor(`${(date || todayIST).slice(0, 7)}-01`);
  }, [step, monthCursor, date, todayIST]);

  // ── free slots for the chosen day ──
  useEffect(() => {
    if (!service || !date) { setSlots([]); return; }
    setLoadingSlots(true); setSlot('');
    fetch('/api/fetch-slots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTherapy: service.therapyName,
        selectedTherapist: service.therapist_name,
        selectedDate: date,
        isFreeConsultation: true,
        timezone: 'Asia/Kolkata',
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        // A single-element ARRAY wrapping an object, slots under a key with a
        // space in it. Same shape the booking page unpacks.
        const payload = Array.isArray(d) ? d[0] : d;
        const list = payload?.['Available Slots'];
        setSlots(Array.isArray(list) ? list.filter((s: any) => typeof s === 'string') : []);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [service, date]);

  const canContinue = Boolean(
    identified && name.trim() && email.trim() && last10(phone).length === 10 && otpStage === 'verified');

  const confirm = async () => {
    setError(null);
    if (!service || !slot) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/create-booking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapyName: service.therapyName,
          therapistName: service.therapist_name,
          isFreeConsultation: true,
          date,
          // Both spellings on purpose. `startTime` is the ISO branch the server
          // parses reliably; `slot` is the legacy clock-time branch. Sending the
          // ISO as `slot` alone yields Invalid Date, and the server then
          // silently books NOW.
          startTime: slot,
          slot: istClock(slot),
          clientName: name,
          clientEmail: email,
          clientWhatsApp: fullPhone,
          sessionMode: mode,
          timezone: 'Asia/Kolkata',
          clientTimezone: 'Asia/Kolkata',
          notes: notes || undefined,
          invitee_question: notes || undefined,
          isAdmin: false,
          serviceId: service.service_id,
          slug: service.slug,
          amount: 0,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not book your consultation.');
      navigate(`/booking-confirmation/${d.booking_id || d.bookingId || ''}`);
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
      setSubmitting(false);
    }
  };

  const CARD = 'max-w-[720px]';

  const heading =
    step === 'schedule' ? { title: 'Pick a date and time', sub: 'A short call, at a time that suits you.' }
    : step === 'confirm' ? { title: 'Confirm your consultation', sub: 'Please check everything below.' }
    : { title: 'Free consultation', sub: 'A short introductory call to help you find the right fit. Start with your WhatsApp number.' };

  const backTo: Partial<Record<Step, Step>> = { schedule: 'identity', confirm: 'schedule' };

  const nextButton =
    step === 'identity' && identified ? (
      <button onClick={() => canContinue && setStep('schedule')} disabled={!canContinue}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                   disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors">
        Date &amp; Time <ArrowRight size={15} />
      </button>
    ) : step === 'schedule' ? (
      <button onClick={() => setStep('confirm')} disabled={!date || !slot}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                   disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors">
        Continue <ArrowRight size={15} />
      </button>
    ) : null;

  return (
    <Shell>
      <div className="flex justify-center mb-8"><Logo size="small" showTagline={false} /></div>

      <div className={`${CARD} mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden`}>
        <WizardTabs labels={TAB_LABELS} activeIdx={STEP_ORDER.indexOf(step)} />

        <div className="p-4 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-slate-900">{heading.title}</h2>
            {heading.sub && <p className="text-sm text-slate-500 mt-0.5">{heading.sub}</p>}
          </div>

          {/* -- who -- */}
          {step === 'identity' && (
            <div className="space-y-5">
              {/* Says what this is before asking for anything. A visitor who
                  landed here from an ad has no other way to know. */}
              <div className="flex items-start gap-2.5 rounded-lg bg-teal-50 px-3.5 py-3 text-sm text-teal-900">
                <MessageCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  This call is <strong>free</strong>{service?.duration ? <> and lasts about {service.duration}</> : null}.
                  There is nothing to pay, and you can decide about therapy afterwards.
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  WhatsApp number<span className="text-rose-500 ml-0.5">*</span>
                </label>
                <div className="flex gap-2">
                  <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
                    className={`w-24 shrink-0 ${inputCls}`}>
                    {COUNTRY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="relative flex-1 min-w-0">
                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input autoFocus value={phone} placeholder="10-digit number"
                      onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                      className={`w-full pl-9 ${inputCls}`} />
                  </div>
                </div>
              </div>

              {/* -- prove the number -- */}
              {last10(phone).length === 10 && otpStage !== 'verified' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  {otpStage === 'idle' || otpStage === 'sending' ? (
                    <>
                      <p className="text-sm text-slate-600 mb-3">
                        We will send a 6-digit code to this number on WhatsApp to confirm it is yours.
                      </p>
                      <button type="button" onClick={requestOtp} disabled={otpStage === 'sending'}
                        className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700
                                   hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed
                                   inline-flex items-center gap-2 transition-colors">
                        {otpStage === 'sending'
                          ? <><Loader2 size={15} className="animate-spin" /> Sending...</>
                          : <>Get OTP on WhatsApp</>}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-slate-600 mb-3">
                        Enter the 6-digit code sent to <strong>{countryCode} {phone}</strong> on WhatsApp.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input value={otp} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                          onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') submitOtp(); }}
                          placeholder="000000"
                          className={`w-32 tracking-[0.3em] text-center ${inputCls}`} />
                        <button type="button" onClick={submitOtp}
                          disabled={otp.length !== 6 || otpStage === 'verifying'}
                          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700
                                     hover:bg-teal-800 disabled:bg-slate-300 disabled:cursor-not-allowed
                                     inline-flex items-center gap-2 transition-colors">
                          {otpStage === 'verifying'
                            ? <><Loader2 size={15} className="animate-spin" /> Verifying...</>
                            : 'Verify'}
                        </button>
                        <button type="button" onClick={requestOtp} disabled={resendIn > 0}
                          className="px-3 py-2.5 text-sm font-medium text-teal-700 hover:underline
                                     disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed">
                          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                        </button>
                      </div>
                      {otpError && <p className="text-sm text-rose-600 mt-3">{otpError}</p>}
                    </>
                  )}
                  {otpStage !== 'sent' && otpStage !== 'verifying' && otpError && (
                    <p className="text-sm text-rose-600 mt-3">{otpError}</p>
                  )}
                </div>
              )}

              {otpStage === 'verified' && (
                <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 bg-teal-50 text-teal-800">
                  <Check size={15} />
                  <span>WhatsApp number verified.</span>
                </div>
              )}

              {identified && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Full name<span className="text-rose-500 ml-0.5">*</span>
                    </label>
                    <input value={name} onChange={e => setName(e.target.value)}
                      placeholder="Full name" className={`w-full ${inputCls}`} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Email<span className="text-rose-500 ml-0.5">*</span>
                    </label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="name@example.com" className={`w-full ${inputCls}`} />
                  </div>
                </div>
              )}

              {catalogueFailed && (
                <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  Free consultations are not available to book right now. Please try again later.
                </p>
              )}
            </div>
          )}

          {/* -- when -- */}
          {step === 'schedule' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Date<span className="text-rose-500 ml-0.5">*</span>
                  </label>
                  <InlineCalendar
                    value={date}
                    onChange={setDate}
                    min={todayIST}
                    enabledDates={openDays ?? undefined}
                    onMonthChange={setMonthCursor}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Time<span className="text-rose-500 ml-0.5">*</span>
                  </label>
                  {!date ? (
                    <p className="text-sm text-slate-400 py-2">Choose a date first.</p>
                  ) : loadingSlots ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                      <Loader2 size={15} className="animate-spin" /> Loading times...
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-amber-700 py-2">Nothing free on {dateLabel(date)}. Try another day.</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-2 gap-2">
                      {slots.map(s => (
                        <button key={s} type="button" onClick={() => setSlot(s)}
                          className={`px-2 sm:px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                            slot === s ? 'border-teal-600 bg-teal-50 text-teal-800'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-teal-400'}`}>
                          {slotLabel(s)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  How would you like to meet?<span className="text-rose-500 ml-0.5">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  <button type="button" onClick={() => setMode('online')}
                    className={`px-4 py-2.5 rounded-lg border text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
                      mode === 'online' ? 'border-teal-600 bg-teal-50 text-teal-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                    <Video size={15} /> Google Meet
                  </button>
                  <button type="button" onClick={() => setMode('in-person')}
                    className={`px-4 py-2.5 rounded-lg border text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
                      mode === 'in-person' ? 'border-teal-600 bg-teal-50 text-teal-800'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                    <MapPin size={15} /> In-person
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* -- confirm -- */}
          {step === 'confirm' && (
            <>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 flex items-center gap-3 border-b border-slate-200">
                  <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-sm font-semibold shrink-0">
                    {name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{name}</div>
                    <div className="text-xs text-slate-500 truncate">{email}</div>
                  </div>
                </div>

                <div className="px-4 py-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <Row icon={<Phone size={14} />} label="WhatsApp" value={`${countryCode} ${phone}`} />
                  <Row icon={<Mail size={14} />} label="Email" value={email} />
                  <Row icon={<User size={14} />} label="Session" value={service?.therapyName || 'Free Consultation'} />
                  <Row icon={<Clock size={14} />} label="Length" value={service?.duration || '-'} />
                  <Row icon={<CalendarDays size={14} />} label="Date" value={date ? dateLabel(date) : '-'} />
                  <Row icon={<Clock size={14} />} label="Time" value={slot ? `${slotLabel(slot)} IST` : '-'} />
                  <Row icon={mode === 'online' ? <Video size={14} /> : <MapPin size={14} />}
                    label="Mode" value={mode === 'online' ? 'Google Meet' : 'In-person'} />
                </div>

                {/* Where /book shows the amount payable. Saying "Free" in the
                    same place answers the question before it is asked. */}
                <div className="bg-slate-50 border-t border-slate-200 px-4 py-3.5 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-slate-600">Amount payable</span>
                  <span className="text-xl font-bold text-teal-800">Free</span>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  What would you like to talk about? <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  placeholder="A sentence or two is plenty"
                  className={`w-full ${inputCls}`} />
              </div>

              <label className="flex items-start gap-2.5 mt-5 cursor-pointer">
                <input type="checkbox" checked={agreedTerms} className="w-4 h-4 mt-0.5"
                  onChange={e => setAgreedTerms(e.target.checked)} />
                <span className="text-sm text-slate-700">
                  I confirm that I have read and agree to the Terms &amp; Conditions.
                  <span className="text-rose-500 ml-0.5">*</span>
                </span>
              </label>

              {error && (
                <p className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button onClick={confirm} disabled={submitting || !agreedTerms || !slot}
                className="w-full mt-5 py-3 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                           disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2">
                {submitting && <Loader2 size={15} className="animate-spin" />}
                Confirm Free Consultation
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`${CARD} mx-auto flex items-center justify-between mt-5 min-h-[42px]`}>
        {backTo[step] ? (
          <button onClick={() => setStep(backTo[step]!)}
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft size={15} /> Back
          </button>
        ) : <span />}
        {nextButton}
      </div>
    </Shell>
  );
};

export default FreeConsultation;
