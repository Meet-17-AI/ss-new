import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, Search, Check, Loader2, ArrowRight, ArrowLeft, Mail, CalendarDays, Clock,
  Video, MapPin, User,
} from 'lucide-react';
import { Logo } from './Logo';
import { InlineCalendar } from './InlineCalendar';

/**
 * The one public booking link — the whole journey, identification to payment.
 *
 * Everything a client is sent points here. They identify themselves by phone,
 * pick a therapy and therapist (or have both carried over from their last
 * session), choose a time, and pay — without ever leaving this wizard.
 *
 * The MONEY PATH is deliberately the same sequence the older booking page has
 * always used: create-order, then a pending booking that holds the slot, then
 * Razorpay, then server-side signature verification. None of it is
 * reimplemented here, only driven.
 */

type Step = 'phone' | 'therapy' | 'therapist' | 'schedule' | 'review';

interface CatalogueTherapist {
  service_id: number;
  slug: string;
  therapist_id: string;
  therapist_name: string;
  profile_picture_url: string | null;
  specialization: string | null;
  specialization_details: string | null;
  duration: string | null;
  amount: number | null;
  is_payment_enabled?: boolean;
}
interface CatalogueTherapy {
  key: string;
  name: string;
  is_free_consultation: boolean;
  therapists: CatalogueTherapist[];
}

/**
 * Blurbs and age guidance for the therapy cards.
 *
 * Held here because nothing in the database describes a THERAPY —
 * therapy_services.description belongs to one therapist's service, and
 * therapy_type is NULL on most rows. A therapy with no entry still renders,
 * just without the subtitle, so adding a therapy never blanks this screen.
 */
const THERAPY_BLURB: Record<string, { age?: string; blurb?: string }> = {
  'individual therapy': { age: '18+', blurb: 'Focused on personal growth and emotional wellbeing.' },
  'adolescent therapy': { age: '13+', blurb: 'Focused to support teens dealing with academic pressure, emotional challenges, and behavioral concerns.' },
  'couples therapy': { blurb: 'Support for partners working through conflict, communication and connection.' },
  'free consultation': { blurb: 'A short introductory call to help you find the right fit.' },
};

const last10 = (v?: string) => (v || '').replace(/\D/g, '').slice(-10);
const rupees = (n?: number | null) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);

const COUNTRY_CODES = ['+91', '+1', '+44', '+61', '+971'];

const inputCls =
  'px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent';

/** ISO instant -> "10:00 AM" IST, for display. */
const slotLabel = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(d);
};

/**
 * ISO instant -> "10:00 AM" IST, safe to send BACK to the server.
 *
 * Built from parts on purpose: some ICU builds separate the meridiem with
 * U+202F (narrow no-break space), and `new Date("… 10:00 AM GMT+0530")` cannot
 * parse that. formatToParts guarantees a plain space.
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

/**
 * Page frame: a wide light card, with the illustration standing to its right.
 *
 * The card is NOT centred on the page. It is centred in the space LEFT of the
 * door, which the reserved right padding creates — centring it on the viewport
 * would run it under the artwork. Below xl the door is hidden and the padding
 * goes with it, so the card centres normally on smaller screens.
 */
const GUTTER = 'px-6 xl:pr-[300px]';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-white relative overflow-hidden flex flex-col">
    {/* Decorative: no pointer events, empty alt, hidden below xl where there is
        no room beside the card, and GUTTER reserves its width so the card can
        never run underneath it.

        Sized by HEIGHT, not width. Driving it from width made the height fall
        out of the 273x672 aspect — 320px wide became 788px tall, taller than
        most windows. Capped at natural height so it is never upscaled. */}
    <img
      src="/booking-door.png"
      alt=""
      aria-hidden
      className="hidden xl:block pointer-events-none select-none absolute right-0 bottom-12 h-[72vh] max-h-[672px] w-auto"
    />

    <div className={`flex-1 flex items-center justify-center py-12 relative z-10 ${GUTTER}`}>
      <div className="w-full max-w-[900px] bg-slate-50/60 border border-slate-200 rounded-3xl px-8 py-9 sm:px-12">
        {children}
      </div>
    </div>

    <footer className={`relative z-10 pb-7 ${GUTTER}`}>
      <p className="max-w-[900px] mx-auto text-xs text-slate-500">
        © {new Date().getFullYear()} SafeStories, SAFETY AND YOU WELLBEING CENTRE LLP. All Rights Reserved!
      </p>
    </footer>
  </div>
);

/** One tab per step, in the order the client walks them. */
const TABS: { label: string; steps: Step[] }[] = [
  { label: 'Personal Info', steps: ['phone'] },
  { label: 'Therapy', steps: ['therapy'] },
  { label: 'Therapist', steps: ['therapist'] },
  { label: 'Date & Time', steps: ['schedule'] },
  { label: 'Payment', steps: ['review'] },
];

const Tabs: React.FC<{ step: Step }> = ({ step }) => {
  const activeIdx = TABS.findIndex(t => t.steps.includes(step));
  return (
    <div className="flex border-b border-slate-200 bg-slate-50/70">
      {/* Five tabs share the card's width, so the label drops to text-xs and
          hides on the narrowest screens — the numbered circle still shows how
          far along the client is. */}
      {TABS.map((t, i) => (
        <div key={t.label}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1.5 py-3.5 text-xs font-medium border-b-2 -mb-px ${
            i === activeIdx ? 'border-teal-600 text-teal-800 bg-white'
              : i < activeIdx ? 'border-transparent text-slate-500'
              : 'border-transparent text-slate-300'}`}>
          <span className={`w-5 h-5 shrink-0 rounded-full text-[11px] flex items-center justify-center ${
            i === activeIdx ? 'bg-teal-600 text-white'
              : i < activeIdx ? 'bg-teal-100 text-teal-700'
              : 'bg-slate-200 text-slate-400'}`}>
            {i < activeIdx ? <Check size={11} /> : i + 1}
          </span>
          <span className="hidden sm:inline truncate">{t.label}</span>
        </div>
      ))}
    </div>
  );
};

/** One row on the review card. */
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

export const PublicBooking: React.FC = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('phone');

  // ── identity ──
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [lookup, setLookup] = useState<'idle' | 'searching' | 'found' | 'new' | 'throttled'>('idle');
  const [identified, setIdentified] = useState(false);
  const lookedUp = useRef('');

  // ── what they are booking ──
  const [catalogue, setCatalogue] = useState<CatalogueTherapy[]>([]);
  const [chosenTherapy, setChosenTherapy] = useState<CatalogueTherapy | null>(null);
  const [service, setService] = useState<CatalogueTherapist | null>(null);
  /** True once the client picked a therapy themselves, so Back knows where to go. */
  const [pickedManually, setPickedManually] = useState(false);

  // ── when ──
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const [mode, setMode] = useState<'online' | 'in-person'>('online');
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);
  const [monthCursor, setMonthCursor] = useState('');

  // ── final details ──
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [emergencyNumber, setEmergencyNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [priceInfo, setPriceInfo] = useState<any>(null);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayIST = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), []);

  const isFree = Boolean(chosenTherapy?.is_free_consultation);
  const price = Number(priceInfo?.amount ?? service?.amount ?? 0);

  // ── catalogue + payment SDK ──
  useEffect(() => {
    fetch('/api/public/catalogue')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setCatalogue(Array.isArray(d?.therapies) ? d.therapies : []))
      .catch(() => setCatalogue([]));

    // Same bootstrap the older booking page uses: read the active gateway, then
    // attach its checkout script.
    fetch('/api/payment-settings/public')
      .then(r => r.json())
      .then(d => {
        if (!d?.success) return;
        setPaymentConfig(d);
        if (!document.querySelector('script[src*="checkout.razorpay.com"]')) {
          const s = document.createElement('script');
          s.src = 'https://checkout.razorpay.com/v1/checkout.js';
          s.async = true;
          document.head.appendChild(s);
        }
      })
      .catch(() => { /* the free path still works without a gateway */ });
  }, []);

  const allServices = useMemo(() => catalogue.flatMap(t => t.therapists), [catalogue]);

  /**
   * What the admin already decided, carried in the link they sent.
   *
   * The therapy/therapist names are held rather than applied immediately: the
   * catalogue is still loading at this point, and they can only be resolved to a
   * real service once it arrives.
   */
  const linkChoice = useRef<{ therapy?: string; therapist?: string }>({});
  /** True when the link fixed a therapy or therapist, which then outranks history. */
  const [fromLink, setFromLink] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = (q.get('phone') || '').replace(/\D/g, '');
    if (q.get('name')) setName(q.get('name') || '');
    if (q.get('email')) setEmail(q.get('email') || '');
    if (p) {
      setPhone(p.length > 10 ? p.slice(-10) : p);
      if (p.length > 10) setCountryCode(`+${p.slice(0, p.length - 10)}`);
    }
    linkChoice.current = {
      therapy: q.get('therapy') || undefined,
      therapist: q.get('therapist') || undefined,
    };
  }, []);

  /**
   * Resolve the link's therapy/therapist against the catalogue.
   *
   * Runs when the catalogue lands. The admin may have fixed both, only the
   * therapy (leaving the therapist to the client), or neither — each simply
   * lands the client further along the wizard.
   */
  useEffect(() => {
    if (!catalogue.length) return;
    const { therapy, therapist } = linkChoice.current;
    if (!therapy && !therapist) return;
    linkChoice.current = {}; // apply once, so a later render cannot re-fix it

    // Same collapsing the catalogue uses, so "Individual Therapy Session"
    // from a booking label still matches the "Individual Therapy" group.
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+session\s*$/i, '').replace(/\s+/g, ' ').trim();

    const group = therapy
      ? catalogue.find(t => norm(t.name) === norm(therapy))
        ?? catalogue.find(t => norm(t.name).includes(norm(therapy)) || norm(therapy).includes(norm(t.name)))
      : null;

    // Match the therapist on first name: the admin picks from a list of full
    // names while service rows spell the same person inconsistently.
    const first = therapist ? therapist.trim().toLowerCase().split(/\s+/)[0] : '';
    const pool = group ? group.therapists : catalogue.flatMap(t => t.therapists);
    const person = first ? pool.find(p => p.therapist_name.toLowerCase().includes(first)) : null;

    if (group) setChosenTherapy(group);
    if (person) {
      setService(person);
      if (!group) setChosenTherapy(catalogue.find(t => t.therapists.some(x => x.service_id === person.service_id)) || null);
    }
    if (group || person) { setFromLink(true); setPickedManually(true); }
  }, [catalogue]);

  /**
   * The number is the way in. A match fills what we know and, where their last
   * session recorded one, fixes the service outright — so a returning client
   * never picks a therapy or therapist again.
   */
  useEffect(() => {
    const key = last10(phone);
    if (key.length < 10) { setIdentified(false); setLookup('idle'); lookedUp.current = ''; return; }
    if (lookedUp.current === key) return;

    const t = setTimeout(async () => {
      lookedUp.current = key;
      setLookup('searching');
      try {
        const r = await fetch('/api/public/client-history', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: `${countryCode}${phone}` }),
        });
        if (r.status === 429) { setLookup('throttled'); setIdentified(true); return; }
        const d = await r.json();

        if (d?.exists) {
          if (d.clientName) setName(d.clientName);
          if (d.clientEmail) setEmail(d.clientEmail);
          if (d.emergencyName) setEmergencyName(d.emergencyName);
          if (d.emergencyRelation) setEmergencyRelation(d.emergencyRelation);
          if (d.emergencyNumber) setEmergencyNumber(String(d.emergencyNumber).replace(/\D/g, '').slice(-10));
          if (d.sessionMode) setMode(/online|meet/i.test(d.sessionMode) ? 'online' : 'in-person');

          // Exact first: the service id from their last booking. Only if that is
          // missing do we fall back to matching on therapist.
          const byId = d.assignedServiceId
            ? allServices.find(s => s.service_id === Number(d.assignedServiceId)) : null;
          const byTherapist = !byId && d.assignedTherapistId
            ? allServices.find(s => s.therapist_id === String(d.assignedTherapistId)) : null;
          // History fills in what the LINK did not. An admin who fixed the
          // therapy in the link meant it, so their choice is not overwritten by
          // whatever this client happened to book last time.
          const known = byId || byTherapist || null;
          if (known && !fromLink) {
            setService(known);
            setChosenTherapy(catalogue.find(t => t.therapists.some(x => x.service_id === known.service_id)) || null);
            setPickedManually(false);
          }
          setLookup('found');
        } else {
          setLookup('new');
        }
      } catch {
        // A failed lookup must not block a booking — fall through as new.
        setLookup('new');
      }
      setIdentified(true);
    }, 450);

    return () => clearTimeout(t);
  }, [phone, countryCode, allServices, catalogue, fromLink]);

  // ── which days this therapist works, for the visible month ──
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
    if (!service || !chosenTherapy || !date) { setSlots([]); return; }
    setLoadingSlots(true); setSlot('');
    fetch('/api/fetch-slots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedTherapy: chosenTherapy.name,
        selectedTherapist: service.therapist_name,
        selectedDate: date,
        isFreeConsultation: isFree,
        timezone: 'Asia/Kolkata',
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        // The endpoint answers with a single-element ARRAY wrapping an object,
        // and the slots live under a key with a space in it.
        const payload = Array.isArray(d) ? d[0] : d;
        const list = payload?.['Available Slots'];
        setSlots(Array.isArray(list) ? list.filter((s: any) => typeof s === 'string') : []);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [service, chosenTherapy, date, isFree]);

  // ── what THIS client pays (held rate, custom price, or current) ──
  useEffect(() => {
    if (!service) { setPriceInfo(null); return; }
    fetch('/api/public/resolve-price', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: service.service_id, slug: service.slug,
        email: email || undefined, phone: `${countryCode}${phone}`,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.success) setPriceInfo(d); })
      .catch(() => { /* the catalogue's list price still shows */ });
  }, [service, email, phone, countryCode]);

  const canContinue = Boolean(identified && name.trim() && email.trim() && last10(phone).length === 10);

  /** Everything the server needs to create this booking. */
  const buildPayload = () => ({
    therapyName: chosenTherapy?.name,
    therapistName: service?.therapist_name,
    isFreeConsultation: isFree,
    date,
    // Both spellings on purpose. `startTime` is the ISO branch the server parses
    // reliably; `slot` is the legacy clock-time branch. Sending the ISO as
    // `slot` alone yields Invalid Date, and the server then silently books NOW.
    startTime: slot,
    slot: istClock(slot),
    clientName: name,
    clientEmail: email,
    clientWhatsApp: `${countryCode}${phone}`,
    emergencyContactName: emergencyName || undefined,
    emergencyContactRelation: emergencyRelation || undefined,
    emergencyContactNumber: emergencyNumber ? `+91${emergencyNumber}` : undefined,
    sessionMode: mode,
    timezone: 'Asia/Kolkata',
    clientTimezone: 'Asia/Kolkata',
    notes: notes || undefined,
    invitee_question: notes || undefined,
    isAdmin: false,
    serviceId: service?.service_id,
    slug: service?.slug,
    // Display only. The server re-resolves and overwrites it.
    amount: price,
  });

  const pay = async () => {
    setError(null);
    if (!service || !slot) return;
    setSubmitting(true);
    const payload = buildPayload();

    try {
      // Nothing to collect — create it outright.
      if (isFree || price <= 0) {
        const r = await fetch('/api/create-booking', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not create the booking.');
        return navigate(`/booking-confirmation/${d.booking_id || d.bookingId || ''}`);
      }

      if (!(window as any).Razorpay || !paymentConfig) {
        throw new Error('Payment is still loading. Please try again in a moment.');
      }

      // 1. The server decides the amount from the pricing rules — the browser
      //    says only WHAT is being paid for, never how much.
      const orderRes = await fetch('/api/razorpay/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: service.slug, serviceId: service.service_id,
          email, phone: `${countryCode}${phone}`,
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || 'Could not start the payment.');

      // 2. Hold the slot BEFORE the modal opens, so two people cannot pay for
      //    the same time.
      const pendingRes = await fetch('/api/create-pending-booking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, razorpayOrderId: order.order_id }),
      });
      const pending = await pendingRes.json();
      if (!pendingRes.ok) throw new Error(pending.error || 'That time is no longer available.');

      const rzp = new (window as any).Razorpay({
        key: paymentConfig.publicKey || (import.meta as any).env?.VITE_RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency,
        name: 'SafeStories',
        description: `${chosenTherapy?.name} with ${service.therapist_name}`,
        order_id: order.order_id,
        prefill: { name, email, contact: `${countryCode}${phone}` },
        theme: { color: '#21615D' },
        handler: async (resp: any) => {
          try {
            // 3. Signature verified server-side; the booking is confirmed and
            //    notifications sent there, never from the browser.
            const vr = await fetch('/api/razorpay/verify-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: pending.booking_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpayOrderId: resp.razorpay_order_id,
                razorpaySignature: resp.razorpay_signature,
                ...payload,
              }),
            });
            const vd = await vr.json();
            if (!vr.ok) throw new Error(vd.error || 'Payment verification failed.');
            navigate(`/booking-confirmation/${vd.booking_id || pending.booking_id}`);
          } catch (e: any) {
            setError(e.message || 'Payment could not be confirmed. Please contact support.');
          } finally {
            setSubmitting(false);
          }
        },
        modal: { ondismiss: () => setSubmitting(false) },
      });
      rzp.open();
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
      setSubmitting(false);
    }
  };

  /**
   * ONE frame for every step.
   *
   * Each step used to render its own page - different widths, the logo in a
   * different place, tabs on some screens and not others - so moving through
   * the wizard felt like being handed between three different sites. Everything
   * now renders inside the same card, at the same width, under the same tabs;
   * only the contents of the card change.
   */
  const CARD = 'max-w-[720px]';

  const heading =
    step === 'therapy' ? { title: 'Select therapy', sub: 'What kind of support are you looking for?' }
    : step === 'therapist' ? { title: 'Select therapist', sub: `Choose who you would like to see for ${chosenTherapy?.name || 'your session'}.` }
    : step === 'schedule' ? { title: 'Pick a date and time', sub: [service?.therapist_name, chosenTherapy?.name].filter(Boolean).join(' \u00b7 ') }
    : step === 'review' ? { title: 'Confirm your booking', sub: 'Please check everything below before paying.' }
    : { title: 'Personal details', sub: 'Start with your WhatsApp number.' };

  /**
   * Where step 1 leads. The link may have fixed both the therapy and the
   * therapist (straight to a time), only the therapy (pick a therapist first),
   * or neither (pick both).
   */
  const afterIdentity: Step = service ? 'schedule' : chosenTherapy ? 'therapist' : 'therapy';

  /** Where Back goes from each step. */
  const backTo: Partial<Record<Step, Step>> = {
    therapy: 'phone',
    therapist: 'therapy',
    // A returning client never saw the pickers, so Back returns them to the
    // number rather than a therapist list they never came from.
    schedule: pickedManually ? 'therapist' : 'phone',
    review: 'schedule',
  };

  /** Steps that advance by clicking a card carry no Next button. */
  const nextButton =
    step === 'phone' && identified ? (
      <button onClick={() => canContinue && setStep(afterIdentity)}
        disabled={!canContinue}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                   disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors">
        {afterIdentity === 'schedule' ? 'Date & Time' : afterIdentity === 'therapist' ? 'Choose Therapist' : 'Next'} <ArrowRight size={15} />
      </button>
    ) : step === 'schedule' ? (
      <button onClick={() => setStep('review')} disabled={!date || !slot}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                   disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2 transition-colors">
        Continue <ArrowRight size={15} />
      </button>
    ) : null;

  return (
    <Shell>
      <div className="flex justify-center mb-8"><Logo size="small" showTagline={false} /></div>

      <div className={`${CARD} mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden`}>
        <Tabs step={step} />

        <div className="p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-slate-900">{heading.title}</h2>
            {heading.sub && <p className="text-sm text-slate-500 mt-0.5">{heading.sub}</p>}
          </div>

          {/* -- who -- */}
          {step === 'phone' && (
            <div className="space-y-5">
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

              {lookup !== 'idle' && (
                <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                  lookup === 'found' ? 'bg-teal-50 text-teal-800'
                  : lookup === 'throttled' ? 'bg-amber-50 text-amber-800'
                  : 'bg-slate-100 text-slate-600'}`}>
                  {lookup === 'searching' ? <Loader2 size={15} className="animate-spin mt-0.5" />
                    : lookup === 'found' ? <Check size={15} className="mt-0.5" />
                    : <Search size={15} className="mt-0.5" />}
                  <span>
                    {lookup === 'searching' && 'Looking up this number...'}
                    {lookup === 'found' && <>Welcome back{name ? <>, <strong>{name.split(' ')[0]}</strong></> : ''}.
                      {service ? ' Your sessions are already set up - just pick a time.' : ' Please confirm your details below.'}</>}
                    {lookup === 'new' && 'No previous bookings for this number. Fill in your details below.'}
                    {lookup === 'throttled' && 'Too many lookups from this connection. Please fill in your details below.'}
                  </span>
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
            </div>
          )}

          {/* -- which therapy -- */}
          {step === 'therapy' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Paid therapies only. A free consultation is a different thing
                  from choosing a course of therapy, and listing it beside the
                  paid ones invites a client to pick it by mistake. Therapies
                  whose therapists are all deactivated never arrive here — the
                  catalogue drops them server-side. */}
              {catalogue.filter(t => !t.is_free_consultation && t.therapists.length > 0).map(t => {
                const meta = THERAPY_BLURB[t.key] || {};
                return (
                  <button key={t.key} type="button"
                    onClick={() => { setChosenTherapy(t); setService(null); setPickedManually(true); setStep('therapist'); }}
                    className="text-left bg-white border border-slate-200 rounded-xl p-5
                               hover:border-teal-500 hover:shadow-sm transition-all">
                    <h3 className="text-base font-bold text-slate-900">
                      {t.name}{meta.age ? ` (${meta.age})` : ''}
                    </h3>
                    {meta.blurb && <p className="text-sm text-slate-500 mt-2 leading-relaxed">{meta.blurb}</p>}
                  </button>
                );
              })}
            </div>
          )}

          {/* -- which therapist -- */}
          {step === 'therapist' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(chosenTherapy?.therapists ?? []).map(p => (
                <button key={p.service_id} type="button"
                  onClick={() => { setService(p); setDate(''); setSlot(''); setStep('schedule'); }}
                  className="text-left bg-white border border-slate-200 rounded-xl p-5
                             hover:border-teal-500 hover:shadow-sm transition-all flex flex-col">
                  <div className="flex items-start gap-3">
                    {p.profile_picture_url
                      ? <img src={p.profile_picture_url} alt="" className="w-12 h-12 rounded-full object-cover shrink-0 bg-slate-200" />
                      : <div className="w-12 h-12 rounded-full bg-slate-200 shrink-0" />}
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900">{p.therapist_name}</h3>
                      {p.specialization && <p className="text-xs text-slate-500 mt-0.5">{p.specialization}</p>}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 mt-4 pt-3 text-sm text-teal-800">
                    {p.amount != null ? <>Session charges: {rupees(p.amount)}</> : 'Session charges on request'}
                  </div>
                </button>
              ))}
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
                  <p className="mt-1.5 text-xs text-slate-400">
                    {openDays
                      ? `Only days ${service?.therapist_name} works are selectable.`
                      : 'Every day is open for this therapist.'}
                  </p>
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
                    <div className="grid grid-cols-2 gap-2">
                      {slots.map(s => (
                        <button key={s} type="button" onClick={() => setSlot(s)}
                          className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
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

          {/* -- review and pay -- */}
          {step === 'review' && (
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
                  <Row icon={<User size={14} />} label="Therapy" value={chosenTherapy?.name || '-'} />
                  <Row icon={<User size={14} />} label="Therapist" value={service?.therapist_name || '-'} />
                  <Row icon={<CalendarDays size={14} />} label="Date" value={date ? dateLabel(date) : '-'} />
                  <Row icon={<Clock size={14} />} label="Time" value={slot ? `${slotLabel(slot)} IST` : '-'} />
                  <Row icon={mode === 'online' ? <Video size={14} /> : <MapPin size={14} />}
                    label="Mode" value={mode === 'online' ? 'Google Meet' : 'In-person'} />
                </div>

                {/* The price sits at the very bottom of the card. */}
                <div className="bg-slate-50 border-t border-slate-200 px-4 py-3.5 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-slate-600">Amount payable</span>
                  <span className="text-xl font-bold text-slate-900">{isFree ? 'Free' : rupees(price)}</span>
                </div>
              </div>

              {/* Optional intake the older form collected. Kept optional so it
                  never stands between a client and a booking. */}
              <details className="mt-4">
                <summary className="text-sm text-teal-700 cursor-pointer select-none">
                  Add an emergency contact or a note (optional)
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={emergencyName} onChange={e => setEmergencyName(e.target.value)}
                      placeholder="Emergency contact name" className={`w-full ${inputCls}`} />
                    <input value={emergencyRelation} onChange={e => setEmergencyRelation(e.target.value)}
                      placeholder="Relation" className={`w-full ${inputCls}`} />
                  </div>
                  <input value={emergencyNumber} onChange={e => setEmergencyNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="Emergency contact number" className={`w-full ${inputCls}`} />
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                    placeholder="Anything that will help your therapist prepare"
                    className={`w-full ${inputCls}`} />
                </div>
              </details>

              {/* requires_tnc is true on the service, and consent is a record in
                  its own right - so it is asked for, never assumed. */}
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

              <button
                onClick={pay}
                disabled={submitting || !agreedTerms || !slot}
                className="w-full mt-5 py-3 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800
                           disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {isFree || price <= 0 ? 'Confirm Booking' : `Proceed to Payment - ${rupees(price)}`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* One navigation row for the whole wizard, so Back and Next never move. */}
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

export default PublicBooking;
