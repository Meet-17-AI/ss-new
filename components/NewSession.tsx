import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Phone, Search, Check, Wallet, Link2, CalendarDays, Clock,
  Mail, Loader2, Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { InlineCalendar } from './InlineCalendar';

interface Props {
  onBack: () => void;
}

/**
 * Sentinel for "the client will pick their own therapy and therapist".
 * Deliberately a value no real record can hold, so it can never be mistaken for
 * a real selection on the way to the server.
 */
export const CLIENT_CHOOSES = '__CLIENT_CHOOSES__';

type PaymentMode = '' | 'cash' | 'qr' | 'link' | 'wallet';
type Lookup = 'idle' | 'searching' | 'found' | 'new';
type Step = 1 | 2 | 3;

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
/** "Individual Therapy Session with Muskan" -> "Individual Therapy Session" */
const cleanTherapy = (raw?: string) => (raw || '').split(/\s+with\s+/i)[0].trim();
/** Stored numbers disagree about the country code; the last 10 digits are the identity. */
const last10 = (v?: string) => (v || '').replace(/\D/g, '').slice(-10);

const COUNTRY_CODES = [
  { code: '+91', country: 'India' },
  { code: '+1', country: 'USA/Canada' },
  { code: '+44', country: 'UK' },
  { code: '+61', country: 'Australia' },
  { code: '+971', country: 'UAE' },
];

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Client' },
  { n: 2, label: 'Date & Time' },
  { n: 3, label: 'Payment' },
];

/** One labelled control. Keeps every field on the page identical in shape. */
const Field: React.FC<{ label: string; required?: boolean; hint?: React.ReactNode; children: React.ReactNode }> =
  ({ label, required, hint, children }) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <div className="mt-1.5 text-xs">{hint}</div>}
    </div>
  );

/**
 * Everything except the width. Two width utilities in one class string do not
 * override each other — Tailwind resolves the clash by stylesheet order, so
 * appending `w-28` to a string already holding `w-full` silently loses. Each
 * caller states its own width instead.
 */
const controlCls =
  'px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ' +
  'disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';

const inputCls = `w-full ${controlCls}`;

const dash = <span className="text-slate-300">Not set</span>;

/**
 * A row on the client card. Label above value, left aligned — a profile reads
 * that way. A billing-style layout (label left, figure hard right) is reserved
 * for the amount block at the bottom, which really is money.
 */
const Detail: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-sm text-slate-900 mt-0.5 break-words">{value}</div>
  </div>
);

export const NewSession: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState<Step>(1);

  // ── identity ──
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<Lookup>('idle');
  const [identified, setIdentified] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const lookedUp = useRef('');

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientType, setClientType] = useState<'Indian' | 'NRI'>('Indian');
  const clientTypeTouched = useRef(false);

  // ── selection ──
  const [therapy, setTherapy] = useState('');
  const [therapist, setTherapist] = useState('');
  const [mode, setMode] = useState<'' | 'online' | 'in-person'>('');
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('');
  const [amount, setAmount] = useState('');
  const amountTouched = useRef(false);

  // ── reference data ──
  const [clients, setClients] = useState<any[]>([]);
  const [therapies, setTherapies] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  // ── derived / async ──
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [priceInfo, setPriceInfo] = useState<any>(null);
  const [wallet, setWallet] = useState<{ balance: number; lastCredit: any } | null>(null);
  /**
   * Wallet credit is a decision, not a default. Empty means the admin has not
   * answered yet, and step 3 will not let the booking through until they have —
   * silently leaving credit unspent is as wrong as silently spending it.
   */
  const [walletChoice, setWalletChoice] = useState<'' | 'use' | 'skip'>('');
  const useWallet = walletChoice === 'use';
  const [submitting, setSubmitting] = useState(false);

  // Days the therapist actually works, for the month on screen. `null` means
  // "no schedule on file", which leaves every day open rather than none.
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);
  const [loadingDays, setLoadingDays] = useState(false);
  const [monthCursor, setMonthCursor] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  const clientWillChoose = therapy === CLIENT_CHOOSES || therapist === CLIENT_CHOOSES;

  /** Today in IST, YYYY-MM-DD — the earliest bookable day. */
  const todayIST = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), []);

  /**
   * A returning client whose last session told us the therapy and therapist has
   * nothing left to choose here — it is fixed. Their profile is shown on the
   * right instead of being re-asked as a form.
   */
  const profileFixed = Boolean(isReturning && therapy && therapist && !unlocked);

  // ── reference data load ──
  useEffect(() => {
    const get = (u: string) => fetch(u).then(r => (r.ok ? r.json() : [])).catch(() => []);
    Promise.all([get('/api/clients'), get('/api/therapies'), get('/api/services')])
      .then(([c, t, s]) => {
        setClients(Array.isArray(c) ? c : []);
        setTherapies(Array.isArray(t) ? t : []);
        setServices(Array.isArray(s) ? s : []);
      });
  }, []);

  // Therapists offering the chosen therapy.
  useEffect(() => {
    if (!therapy || therapy === CLIENT_CHOOSES) { setTherapists([]); return; }
    fetch(`/api/therapists-by-therapy?therapy_name=${encodeURIComponent(therapy)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setTherapists(Array.isArray(d) ? d : []))
      .catch(() => setTherapists([]));
  }, [therapy]);

  /**
   * The number is the way into this form.
   *
   * Once it is a plausible number, look for a client holding it and prefill what
   * we know. No match is not an error — it simply means a new client, and the
   * form opens blank with every option available.
   */
  useEffect(() => {
    const key = last10(phone);
    if (key.length < 10) {
      setIdentified(false); setLookup('idle'); lookedUp.current = '';
      setStep(1);
      return;
    }
    if (lookedUp.current === key) return;

    const t = setTimeout(async () => {
      lookedUp.current = key;
      setLookup('searching');
      // A different number is a different client, so the wizard starts over
      // rather than leaving the previous client's schedule on a later step.
      setStep(1);
      const match = clients.find(c => last10(c.invitee_phone) === key);

      if (match) {
        setClientName(match.invitee_name || '');
        setClientEmail(match.invitee_email || '');
        if (!clientTypeTouched.current) setClientType(match.client_type === 'NRI' ? 'NRI' : 'Indian');
        setIsReturning(true);
        // Their last booking is the best default for a repeat client.
        try {
          const p = new URLSearchParams();
          if (match.invitee_phone) p.set('phone', match.invitee_phone);
          if (match.invitee_email) p.set('email', match.invitee_email);
          const h = await fetch(`/api/client-booking-history/${encodeURIComponent(match.invitee_id || 'unknown')}?${p}`)
            .then(r => (r.ok ? r.json() : null));
          const lb = h?.lastBooking;
          if (lb?.therapy && lb.therapy !== 'Free Consultation') {
            setTherapy(cleanTherapy(lb.therapy));
            if (lb.therapist) setTherapist(lb.therapist);
            if (lb.mode) setMode(/online|meet/i.test(lb.mode) ? 'online' : 'in-person');
          }
        } catch { /* prefill is a convenience, never a blocker */ }
        setLookup('found');
      } else {
        setClientName(''); setClientEmail(''); setIsReturning(false);
        // Nothing on file, so the dialling code is the only signal we have.
        if (!clientTypeTouched.current) setClientType(countryCode === '+91' ? 'Indian' : 'NRI');
        setLookup('new');
      }
      setIdentified(true);
    }, 450);

    return () => clearTimeout(t);
  }, [phone, clients, countryCode]);

  // Open the calendar on the month already chosen, else the current one.
  useEffect(() => {
    if (step === 2 && !monthCursor) setMonthCursor(`${(date || todayIST).slice(0, 7)}-01`);
  }, [step, monthCursor, date, todayIST]);

  // Handing the choice to the client removes the schedule and payment steps
  // entirely, so step 1 is the only one left to be on.
  useEffect(() => { if (clientWillChoose) setStep(1); }, [clientWillChoose]);

  // Wallet follows client identity.
  useEffect(() => {
    const key = last10(phone);
    if (key.length < 10) { setWallet(null); setWalletChoice(''); return; }
    const q = new URLSearchParams({ phone: `${countryCode}${phone}` });
    if (clientEmail) q.set('email', clientEmail);
    fetch(`/api/wallet?${q}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const bal = Number(d?.balance) || 0;
        setWallet(bal > 0 ? { balance: bal, lastCredit: d.transactions?.[0] || null } : null);
        // A different client's answer must never carry over.
        setWalletChoice('');
      })
      .catch(() => setWallet(null));
  }, [phone, countryCode, clientEmail]);

  /** The service row behind therapy+therapist — the id the price resolver keys on. */
  const serviceId = useMemo(() => {
    if (!therapy || !therapist || clientWillChoose) return null;
    const first = therapist.trim().toLowerCase().split(/\s+/)[0];
    const tl = cleanTherapy(therapy).toLowerCase();
    const active = services.filter((s: any) => s.is_active !== false);
    return (
      active.find((s: any) =>
        (s.therapist_name || '').toLowerCase().includes(first) &&
        (s.title || '').toLowerCase().includes(tl))?.id ??
      active.find((s: any) => (s.therapist_name || '').toLowerCase().includes(first))?.id ??
      null
    );
  }, [therapy, therapist, services, clientWillChoose]);

  // Price is resolved by the server for this client — a held rate, a custom
  // price, or the current one. Never computed here.
  useEffect(() => {
    if (!serviceId) { setPriceInfo(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/public/resolve-price', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId, email: clientEmail || undefined, phone: `${countryCode}${phone}` }),
        });
        if (!r.ok) return;
        const d = await r.json();
        setPriceInfo(d);
        if (!amountTouched.current) setAmount(String(d.amount));
      } catch { /* the admin can still type a figure */ }
    }, 350);
    return () => clearTimeout(t);
  }, [serviceId, clientEmail, phone, countryCode]);

  /**
   * Slots for the chosen therapist and day.
   *
   * The endpoint answers with a single-element ARRAY wrapping an object, and the
   * slots live under a key with a space in it:
   *   [{ "Available Slots": ["2026-08-20T04:30:00.000Z", ...], "session charges": 1700 }]
   * Each entry is an ISO instant in UTC. It is kept verbatim as the option value
   * because that is what /api/create-booking expects back; only the label is
   * converted to IST for reading.
   */
  useEffect(() => {
    if (!therapy || !therapist || !date || clientWillChoose) { setSlots([]); return; }
    setLoadingSlots(true); setSlot('');
    fetch('/api/fetch-slots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTherapy: therapy, selectedTherapist: therapist, selectedDate: date,
        isFreeConsultation: false, timezone: 'Asia/Kolkata', isAdmin: true,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const payload = Array.isArray(d) ? d[0] : d;
        const list = payload?.['Available Slots'];
        setSlots(Array.isArray(list) ? list.filter(s => typeof s === 'string') : []);
        // Only a fallback: /api/public/resolve-price is the authority, because it
        // alone knows this client's held or custom rate.
        const fallback = Number(payload?.['session charges']);
        if (!amountTouched.current && !priceInfo && Number.isFinite(fallback) && fallback > 0) {
          setAmount(String(fallback));
        }
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [therapy, therapist, date, clientWillChoose]);

  /**
   * Which days of the visible month this therapist works.
   *
   * Fetched per month rather than per day: painting a calendar by probing
   * /api/fetch-slots thirty times would be thirty round trips, each doing real
   * scheduling work.
   */
  useEffect(() => {
    if (!therapist || clientWillChoose || !monthCursor) { setOpenDays(null); return; }
    const [y, m] = monthCursor.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const to = `${monthCursor.slice(0, 8)}${String(last).padStart(2, '0')}`;
    let live = true;
    setLoadingDays(true);
    fetch(`/api/therapist-open-days?therapistName=${encodeURIComponent(therapist)}&from=${monthCursor}&to=${to}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!live) return;
        setOpenDays(Array.isArray(d?.days) ? new Set<string>(d.days) : null);
      })
      .catch(() => live && setOpenDays(null))
      .finally(() => live && setLoadingDays(false));
    return () => { live = false; };
  }, [therapist, monthCursor, clientWillChoose]);

  /** "2026-08-20T04:30:00.000Z" -> "10:00 AM" in IST. */
  const slotLabel = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }).toUpperCase();
  };

  /**
   * ISO instant -> "10:00 AM" in IST, built from parts.
   *
   * toLocaleTimeString is not safe to feed back to the server: some ICU builds
   * separate the meridiem with U+202F (narrow no-break space), which
   * `new Date("... 10:00 AM GMT+0530")` cannot parse. Assembling it from
   * formatToParts guarantees a plain space.
   */
  const istClock = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }).formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
  };

  /** "2026-08-20" -> "Thu, 20 Aug 2026" */
  const dateLabel = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const price = Number(amount) || Number(priceInfo?.amount) || 0;
  const walletApplied = useWallet && wallet && paymentMode !== 'link'
    ? Math.max(0, Math.min(wallet.balance, price)) : 0;
  const stillDue = Math.max(price - walletApplied, 0);
  const walletCoversAll = walletApplied > 0 && stillDue === 0;

  // Wallet alone can only settle a session it fully covers; anything less still
  // needs Cash or QR, which the server records as Wallet+Cash / Wallet+QR.
  useEffect(() => {
    if (paymentMode === 'wallet' && !walletCoversAll) setPaymentMode('');
  }, [paymentMode, walletCoversAll]);

  // ── what each step needs before it will let you move on ──
  const step1Done = Boolean(
    identified && clientName.trim() && clientEmail.trim() &&
    (clientWillChoose || (therapy && therapist))
  );
  const step2Done = Boolean(mode && date && slot);
  const step3Done = Boolean(amount.trim() && (walletCoversAll || paymentMode));

  const canSubmit = (() => {
    if (submitting || !identified) return false;
    if (clientWillChoose) return step1Done;
    return step1Done && step2Done && step3Done;
  })();

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // No therapy or therapist means no slot and no price — send the client the
      // public directory instead of creating anything.
      if (clientWillChoose) {
        const r = await fetch('/api/admin/send-booking-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName, clientEmail, clientPhone: `${countryCode}${phone}`,
            // Only a real selection travels. The sentinel means "the client
            // decides", so leaving it out is exactly what it should mean.
            //
            // The ids are what the server builds the link from; the names are
            // sent alongside only so it can still resolve a therapy, which has
            // no id of its own to send.
            serviceId: serviceId ?? undefined,
            therapistId: therapist === CLIENT_CHOOSES
              ? undefined
              : therapists.find((t: any) => t.therapist_name === therapist)?.therapist_id || undefined,
            therapy: therapy === CLIENT_CHOOSES ? undefined : therapy || undefined,
            therapist: therapist === CLIENT_CHOOSES ? undefined : therapist || undefined,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not send the booking link.');
        toast.success(d.whatsappCarriedLink
          ? `Booking link sent to ${clientEmail} and WhatsApp.`
          : d.whatsappSent
          ? `Link emailed to ${clientEmail}. WhatsApp sent a generic prompt.`
          : `Booking link sent to ${clientEmail}.`);
        return onBack();
      }

      if (paymentMode === 'link') {
        const r = await fetch('/api/admin/generate-payment-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            therapistName: therapist, clientName, clientEmail,
            // This endpoint parses `date + time` as "YYYY-MM-DD h:mm A GMT+0530"
            // and 400s on anything else, so the ISO slot has to become a clock
            // time here rather than being passed through.
            clientPhone: `${countryCode}${phone}`, date, time: istClock(slot),
            serviceType: therapy, amount: price, clientType,
            sessionMode: mode, timezone: 'Asia/Kolkata', isAdmin: true,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not send the payment link.');
        toast.success('Payment link sent.');
        return onBack();
      }

      const r = await fetch('/api/create-booking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapyName: therapy, therapistName: therapist, isFreeConsultation: false,
          // Send the service the price was quoted against. Without it the server
          // re-resolves from the therapy label, which can pick a different row
          // and store a price the admin never saw.
          serviceId: serviceId ?? undefined,
          // `slot` here is an ISO instant from /api/fetch-slots, which the
          // server's `date + slot` branch cannot parse — it builds
          // "2026-08-20 2026-08-20T04:30:00.000Z GMT+0530", gets Invalid Date,
          // and silently falls back to NOW, booking the session at the moment
          // it was created. `startTime` is the branch that takes an ISO instant.
          startTime: slot,
          date, slot, clientName, clientEmail, clientWhatsApp: `${countryCode}${phone}`,
          sessionMode: mode, timezone: 'Asia/Kolkata', skipPayment: true, isAdmin: true,
          paymentMode, amount: price, currency: 'INR', clientType,
          // A request, not an instruction — the server re-reads the balance and clamps.
          useWallet: walletApplied > 0, walletAmount: walletApplied,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not create the booking.');
      toast.success(walletCoversAll ? 'Booking created — paid from wallet.' : 'Booking created.');
      onBack();
    } catch (e: any) {
      toast.error(e.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const buttonLabel =
    submitting ? 'Working…'
    : clientWillChoose ? 'Send Booking Link'
    : paymentMode === 'link' ? 'Send Payment Link'
    : walletCoversAll ? 'Confirm Booking (Paid from Wallet)'
    : 'Confirm Booking';

  const initials = (clientName || '')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  /** Foot of each step: go back, go on. */
  const Nav: React.FC<{ back?: Step; next?: Step; ready: boolean; nextLabel?: string }> =
    ({ back, next, ready, nextLabel }) => (
      <div className="flex items-center justify-between pt-2">
        {back ? (
          <button type="button" onClick={() => setStep(back)}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">
            Back
          </button>
        ) : <span />}
        {next && (
          <button type="button" onClick={() => setStep(next)} disabled={!ready}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800
                       disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
                       inline-flex items-center gap-2 transition-colors">
            {nextLabel || 'Continue'} <ArrowRight size={15} />
          </button>
        )}
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-5">
          <ArrowLeft size={16} /> Back
        </button>

        <header className="mb-7">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">New Session</h1>
          <p className="text-sm text-slate-500 mt-1">
            Start with the client's number — everything we know about them fills in from there.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          {/* ──────────────────── left: one step at a time ──────────────────── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {/* Steps are clickable only backwards. Jumping ahead would show a
                form whose defaults have not been fetched yet. */}
            <div className="flex border-b border-slate-200 bg-slate-50/70">
              {STEPS.map(({ n, label }) => {
                const done = n < step;
                const active = n === step;
                const reachable = n <= step;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => reachable && setStep(n)}
                    disabled={!reachable}
                    className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      active ? 'border-teal-600 text-teal-800 bg-white'
                        : done ? 'border-transparent text-slate-600 hover:bg-slate-100'
                        : 'border-transparent text-slate-300 cursor-not-allowed'}`}
                  >
                    <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center ${
                      active ? 'bg-teal-600 text-white'
                        : done ? 'bg-teal-100 text-teal-700'
                        : 'bg-slate-200 text-slate-400'}`}>
                      {done ? <Check size={11} /> : n}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="p-6 space-y-6">
              {/* ── step 1: who is this ── */}
              {step === 1 && (
                <>
                  <Field label="Client WhatsApp number" required>
                    <div className="flex gap-2">
                      <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
                        className={`w-24 shrink-0 ${controlCls}`}>
                        {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                      </select>
                      <div className="relative flex-1 min-w-0">
                        <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          autoFocus
                          value={phone}
                          onChange={e => setPhone(e.target.value.replace(/[^\d]/g, ''))}
                          placeholder="10-digit number"
                          className={`${inputCls} pl-9`}
                        />
                      </div>
                    </div>
                  </Field>

                  {lookup !== 'idle' && (
                    <div className={`flex items-start gap-2 -mt-3 text-sm rounded-lg px-3 py-2 ${
                      lookup === 'found' ? 'bg-teal-50 text-teal-800'
                      : lookup === 'new' ? 'bg-slate-100 text-slate-600'
                      : 'bg-slate-50 text-slate-500'}`}>
                      {lookup === 'searching' ? <Loader2 size={15} className="animate-spin mt-0.5" />
                        : lookup === 'found' ? <Check size={15} className="mt-0.5" />
                        : <Search size={15} className="mt-0.5" />}
                      <span>
                        {lookup === 'searching' && 'Looking up this number…'}
                        {lookup === 'found' && <><strong>{clientName}</strong> is an existing client.</>}
                        {lookup === 'new' && 'No previous bookings for this number. Fill in the details below.'}
                      </span>
                    </div>
                  )}

                  {/* Everything about a returning client is already settled — it
                      is displayed on the right, not asked for again. The escape
                      hatch is there for the rare correction. */}
                  {identified && profileFixed && (
                    <>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Therapy, therapist and client type are carried over from
                        {' '}{clientName ? `${clientName}'s` : 'their'} profile — see the right.
                        <button type="button" onClick={() => setUnlocked(true)}
                          className="ml-1.5 text-teal-700 font-medium hover:underline">
                          Change
                        </button>
                      </div>
                      <Nav next={2} ready={step1Done} nextLabel="Date & Time" />
                    </>
                  )}

                  {identified && !profileFixed && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Client name" required>
                          <input value={clientName} onChange={e => setClientName(e.target.value)}
                            placeholder="Full name" className={inputCls} />
                        </Field>
                        <Field label="Client email" required>
                          <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                            placeholder="name@example.com" className={inputCls} />
                        </Field>
                      </div>

                      <Field label="Client type" required>
                        <div className="grid grid-cols-2 gap-3 max-w-xs">
                          {(['Indian', 'NRI'] as const).map(t => (
                            <button key={t} type="button"
                              onClick={() => { clientTypeTouched.current = true; setClientType(t); }}
                              className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                                clientType === t ? 'border-teal-600 bg-teal-50 text-teal-800'
                                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </Field>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Therapy" required>
                          <select value={therapy}
                            onChange={e => { setTherapy(e.target.value); setTherapist(''); amountTouched.current = false; }}
                            className={inputCls}>
                            <option value="">Select therapy</option>
                            <option value={CLIENT_CHOOSES}>— Let the client choose —</option>
                            {therapies.map((t, i) => (
                              <option key={i} value={t.therapy_name}>{t.therapy_name}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Therapist" required>
                          <select value={therapist}
                            onChange={e => { setTherapist(e.target.value); amountTouched.current = false; }}
                            disabled={therapy === CLIENT_CHOOSES} className={inputCls}>
                            <option value="">{therapy ? 'Select therapist' : 'Choose a therapy first'}</option>
                            <option value={CLIENT_CHOOSES}>— Let the client choose —</option>
                            {therapists.map((t: any) => (
                              <option key={t.therapist_id} value={t.therapist_name}>{t.therapist_name}</option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      {clientWillChoose && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2">
                          <Link2 size={16} className="mt-0.5 shrink-0" />
                          <span>
                            A booking link will be sent to the client on WhatsApp and email.
                            They can choose and book their session themselves.
                          </span>
                        </div>
                      )}

                      {!clientWillChoose && <Nav next={2} ready={step1Done} nextLabel="Date & Time" />}
                    </>
                  )}
                </>
              )}

              {/* ── step 2: when ── */}
              {step === 2 && (
                <>
                  <p className="text-sm text-slate-500 -mt-1">
                    {isReturning
                      ? 'Prefilled from their last session — change whatever needs to change.'
                      : 'Pick a mode, a day, and one of the therapist’s free slots.'}
                  </p>

                  <Field label="Session mode" required>
                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                      {(['online', 'in-person'] as const).map(m => (
                        <button key={m} type="button" onClick={() => setMode(m)}
                          className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                            mode === m ? 'border-teal-600 bg-teal-50 text-teal-800'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}>
                          {m === 'online' ? 'Google Meet' : 'In-person'}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <Field label="Date" required
                      hint={loadingDays
                        ? <span className="text-slate-400 inline-flex items-center gap-1.5">
                            <Loader2 size={12} className="animate-spin" /> Checking availability…
                          </span>
                        : openDays
                        ? <span className="text-slate-400">Only days {therapist} works are selectable.</span>
                        : <span className="text-amber-700">No schedule on file — every day is open.</span>}>
                      <InlineCalendar
                        value={date}
                        onChange={setDate}
                        min={todayIST}
                        enabledDates={openDays ?? undefined}
                        onMonthChange={setMonthCursor}
                      />
                    </Field>

                    {/* Slots come straight from the therapist's schedule minus
                        their existing bookings, so anything rendered here is
                        genuinely free. */}
                    <Field label="Time" required>
                      {!date ? (
                        <p className="text-sm text-slate-400 py-2.5">Pick a date first.</p>
                      ) : loadingSlots ? (
                        <div className="flex items-center gap-2 text-sm text-slate-400 py-2.5">
                          <Loader2 size={15} className="animate-spin" /> Loading slots…
                        </div>
                      ) : slots.length === 0 ? (
                        <p className="text-sm text-amber-700 py-2.5">
                          Nothing free on {dateLabel(date)}. Try another day.
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {slots.map(s => (
                            <button key={s} type="button" onClick={() => setSlot(s)}
                              className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                                slot === s ? 'border-teal-600 bg-teal-50 text-teal-800'
                                  : 'border-slate-300 bg-white text-slate-600 hover:border-teal-400 hover:text-teal-700'}`}>
                              {slotLabel(s)}
                            </button>
                          ))}
                        </div>
                      )}
                    </Field>
                  </div>

                  <Nav back={1} next={3} ready={step2Done} nextLabel="Payment" />
                </>
              )}

              {/* ── step 3: how it is paid ── */}
              {step === 3 && (
                <>
                  {/* Sits above the payment method on purpose: the credit is what
                      decides the method, so it has to be read first. Ticking it
                      selects Wallet below rather than making that a second step. */}
                  {wallet && wallet.balance > 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                      <div className="flex items-start gap-2 text-sm text-amber-900">
                        <Wallet size={16} className="mt-0.5 shrink-0" />
                        <div className="flex-1">
                          Wallet credit available: <strong>{rupees(wallet.balance)}</strong>
                          {wallet.lastCredit?.source_payment_mode && (
                            <span className="block text-xs text-amber-700 mt-0.5">
                              From a cancelled session (paid by {wallet.lastCredit.source_payment_mode}).
                            </span>
                          )}
                          {paymentMode === 'link' ? (
                            <p className="text-xs text-amber-700 mt-2">Wallet credit can't be combined with a payment link.</p>
                          ) : (
                            <>
                              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                <input type="checkbox" checked={useWallet} className="w-4 h-4"
                                  onChange={e => {
                                    setWalletChoice(e.target.checked ? 'use' : 'skip');
                                    // Ticking this answers "how is this paid?" when the
                                    // credit settles the whole session.
                                    if (e.target.checked && wallet.balance >= price && price > 0) setPaymentMode('wallet');
                                    if (!e.target.checked && paymentMode === 'wallet') setPaymentMode('');
                                  }} />
                                <span className="text-sm font-medium">Apply wallet credit to this booking</span>
                              </label>
                              {useWallet && price > 0 && wallet.balance < price && (
                                <p className="text-xs text-amber-700 mt-1.5">
                                  Covers part of it — {rupees(stillDue)} still to collect below.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Payment method" required>
                      <select value={paymentMode} onChange={e => {
                        const next = e.target.value as PaymentMode;
                        setPaymentMode(next);
                        if (next === 'wallet') setWalletChoice('use');
                        if (next === 'link') setWalletChoice('skip');
                      }} className={inputCls}>
                        <option value="">Select method</option>
                        {wallet && wallet.balance >= price && price > 0 && <option value="wallet">Wallet (Paid)</option>}
                        <option value="cash">Cash (Paid)</option>
                        <option value="qr">QR (Paid)</option>
                        <option value="link">Send payment link</option>
                      </select>
                    </Field>
                    <Field label="Amount" required
                      hint={priceInfo && (
                        priceInfo.price_source === 'lock' ? <span className="text-teal-700 font-medium">Existing client rate</span>
                        : priceInfo.price_source === 'override' ? <span className="text-purple-700 font-medium">Custom price for this client</span>
                        : <span className="text-slate-400">Current price</span>
                      )}>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                        <input type="number" value={amount}
                          onChange={e => { amountTouched.current = true; setAmount(e.target.value); }}
                          className={`${inputCls} pl-7`} />
                      </div>
                    </Field>
                  </div>

                  <p className="text-sm text-slate-500">
                    {paymentMode === 'link'
                      ? 'Nothing is booked yet — the slot is held when the client pays.'
                      : 'Confirm on the right to create the session.'}
                  </p>

                  <Nav back={2} ready={step3Done} />
                </>
              )}
            </div>
          </div>

          {/* ─────────────── right: the client, then the session ─────────────── */}
          <aside className="bg-white rounded-xl border border-slate-200 lg:sticky lg:top-6 overflow-hidden">
            {!identified ? (
              <p className="text-sm text-slate-400 py-16 px-6 text-center">
                Enter the client's number to begin.
              </p>
            ) : (
              <>
                {/* the person */}
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-sm font-semibold shrink-0">
                      {initials || '?'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-slate-900 truncate">
                        {clientName || 'New client'}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                          {clientType}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <Phone size={13} className="text-slate-400 shrink-0" />
                      <span>{countryCode} {phone}</span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail size={13} className="text-slate-400 shrink-0" />
                      <span className="truncate">{clientEmail || <span className="text-slate-300">No email yet</span>}</span>
                    </div>
                  </div>
                </div>

                {/* what they are booking */}
                <div className="p-5 grid grid-cols-2 gap-x-4 gap-y-4 border-b border-slate-100">
                  <Detail label="Therapy" value={
                    therapy === CLIENT_CHOOSES ? <span className="text-amber-700">Client will choose</span>
                    : (therapy || dash)} />
                  <Detail label="Therapist" value={
                    therapist === CLIENT_CHOOSES ? <span className="text-amber-700">Client will choose</span>
                    : (therapist || dash)} />

                  {clientWillChoose ? (
                    <div className="col-span-2 flex items-start gap-2 text-sm text-amber-800">
                      <Globe size={14} className="mt-0.5 shrink-0" />
                      <span>A booking link will be sent on WhatsApp and email for them to choose and book.</span>
                    </div>
                  ) : (
                    <>
                      <Detail label="Preferred mode" value={
                        mode === 'online' ? 'Google Meet' : mode === 'in-person' ? 'In-person' : dash} />
                      <Detail label="Payment" value={
                        paymentMode === 'link' ? 'Payment link'
                        : paymentMode === 'wallet' ? 'Wallet'
                        : paymentMode ? paymentMode.toUpperCase()
                        : dash} />
                      <Detail label="Date" value={date
                        ? <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" />{dateLabel(date)}</span>
                        : dash} />
                      <Detail label="Time" value={slot
                        ? <span className="inline-flex items-center gap-1.5"><Clock size={13} className="text-slate-400" />{slotLabel(slot)} IST</span>
                        : dash} />
                    </>
                  )}
                </div>

                {/* the money */}
                <div className="p-5">
                  {!clientWillChoose && (
                    <div className="rounded-lg bg-slate-50 p-3.5 mb-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-slate-500">Session</span>
                        <span className="text-lg font-semibold text-slate-900">{rupees(price)}</span>
                      </div>
                      {walletApplied > 0 && (
                        <>
                          <div className="flex items-baseline justify-between mt-1.5 text-sm text-amber-700">
                            <span>From wallet</span><span>− {rupees(walletApplied)}</span>
                          </div>
                          <div className="flex items-baseline justify-between mt-1.5 pt-2 border-t border-slate-200">
                            <span className="text-sm font-medium text-slate-700">To collect</span>
                            <span className="text-base font-semibold text-slate-900">{rupees(stillDue)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                               disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <Loader2 size={15} className="animate-spin" />}
                    {buttonLabel}
                  </button>

                  {!canSubmit && !submitting && (
                    <p className="text-xs text-slate-400 text-center mt-2">
                      {clientWillChoose ? 'Add a name and email to send the link.'
                        : !step1Done ? 'Finish the client details.'
                        : !step2Done ? 'Pick a date and time.'
                        : 'Choose how it is paid.'}
                    </p>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
};

export default NewSession;
