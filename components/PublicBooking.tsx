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
  qualification_pdf_url?: string | null;
  /**
   * Not in the database yet. Rendered only when present, so filling these in
   * later is a data change rather than a code change.
   */
  languages?: string | null;
  education?: string | null;
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

/**
 * text-base below sm, not text-sm.
 *
 * Safari on iOS zooms the whole page in when a focused input's font is under
 * 16px, and it does not zoom back out - the client is left scrolled sideways
 * mid-form. 16px on phones is the only reliable way to stop it; the smaller size
 * returns from sm up, where no browser does this.
 */
const inputCls =
  'px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-base sm:text-sm text-slate-900 ' +
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
const GUTTER = 'px-3 sm:px-6 xl:pr-[300px]';

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

    {/* The outer card and the wizard card each carry their own padding, which on
        a 360px phone spent nearly a third of the width on margins. Both shrink
        together below sm and return to full size from there. */}
    <div className={`flex-1 flex items-center justify-center py-6 sm:py-12 relative z-10 ${GUTTER}`}>
      <div className="w-full max-w-[900px] bg-slate-50/60 border border-slate-200 rounded-2xl sm:rounded-3xl
                      px-3 py-6 sm:px-8 sm:py-9 lg:px-12">
        {children}
      </div>
    </div>

    {/* Sits at the page margin, not the card's. It belongs to the page rather
        than to the wizard, so it deliberately ignores GUTTER — which exists only
        to keep the card clear of the illustration. */}
    <footer className="relative z-10 px-4 sm:px-6 pb-7">
      <p className="text-xs text-slate-500">
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
      {/* Five labels never fit across a phone. Rather than hide all five and
          leave the client reading bare numbers, only the CURRENT one keeps its
          label — which is the one they need. It takes the room it needs and the
          rest collapse to circles. Every label returns from sm up. */}
      {TABS.map((t, i) => (
        <div key={t.label}
          className={`min-w-0 flex items-center justify-center gap-1.5 px-1.5 py-3.5 text-xs font-medium border-b-2 -mb-px ${
            i === activeIdx ? 'flex-1 border-teal-600 text-teal-800 bg-white' : 'sm:flex-1 border-transparent'} ${
            i === activeIdx ? '' : i < activeIdx ? 'text-slate-500' : 'text-slate-300'}`}>
          <span className={`w-5 h-5 shrink-0 rounded-full text-[11px] flex items-center justify-center ${
            i === activeIdx ? 'bg-teal-600 text-white'
              : i < activeIdx ? 'bg-teal-100 text-teal-700'
              : 'bg-slate-200 text-slate-400'}`}>
            {i < activeIdx ? <Check size={11} /> : i + 1}
          </span>
          <span className={`truncate ${i === activeIdx ? '' : 'hidden sm:inline'}`}>{t.label}</span>
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

  // ── WhatsApp verification ──
  // Proves the number belongs to whoever is filling the form, before anything is
  // held or charged against it.
  const [otp, setOtp] = useState('');
  const [otpStage, setOtpStage] = useState<'idle' | 'sending' | 'sent' | 'verifying' | 'verified'>('idle');
  const [otpError, setOtpError] = useState('');
  /** Seconds until Resend is offered again, counted down by the effect below. */
  const [resendIn, setResendIn] = useState(0);

  // ── what they are booking ──
  const [catalogue, setCatalogue] = useState<CatalogueTherapy[]>([]);
  const [chosenTherapy, setChosenTherapy] = useState<CatalogueTherapy | null>(null);
  const [service, setService] = useState<CatalogueTherapist | null>(null);
  /** True once the client picked a therapy themselves, so Back knows where to go. */
  const [pickedManually, setPickedManually] = useState(false);
  /** Therapist whose full profile is open, if any. */
  const [profileOf, setProfileOf] = useState<CatalogueTherapist | null>(null);

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
   * State rather than a ref, because a token link has to fetch this and the
   * catalogue may well arrive first — the resolution below has to re-run once it
   * lands. Null means "not known yet", which is not the same as "nothing was
   * settled" and must not be resolved as though it were.
   *
   * sid/tkey are IDENTIFIERS the server resolved when it built the link, so they
   * match exactly. therapy/therapist are display names, kept only for links sent
   * before that changed — they still have to be matched by guesswork, which is
   * why nothing new is built on them.
   */
  const [linkChoice, setLinkChoice] =
    useState<{ sid?: string; tkey?: string; therapy?: string; therapist?: string } | null>(null);
  const linkApplied = useRef(false);
  /** True when the link fixed a therapy or therapist, which then outranks history. */
  const [fromLink, setFromLink] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);

    const applyIdentity = (v: { name?: string; email?: string; phone?: string }) => {
      if (v.name) setName(v.name);
      if (v.email) setEmail(v.email);
      const p = (v.phone || '').replace(/\D/g, '');
      if (p) {
        setPhone(p.length > 10 ? p.slice(-10) : p);
        if (p.length > 10) setCountryCode(`+${p.slice(0, p.length - 10)}`);
      }
    };

    // A token link carries nothing but the token. The client's name and number
    // are fetched, so a forwarded message or a screenshot of the address bar
    // shows a stranger nothing about them.
    const token = q.get('t');
    if (token) {
      fetch(`/api/public/booking-link/${encodeURIComponent(token)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (d) applyIdentity(d);
          // An expired or unknown token is not something the client can act on,
          // and an error screen would only strand them. The wizard simply starts
          // from the beginning, which still works.
          setLinkChoice({
            sid: d?.sid != null ? String(d.sid) : undefined,
            tkey: d?.tkey || undefined,
          });
        })
        .catch(() => setLinkChoice({}));
      return;
    }

    // Links sent before tokens existed, still sitting in inboxes.
    applyIdentity({
      name: q.get('name') || '', email: q.get('email') || '', phone: q.get('phone') || '',
    });
    setLinkChoice({
      sid: q.get('sid') || undefined,
      tkey: q.get('tkey') || undefined,
      therapy: q.get('therapy') || undefined,
      therapist: q.get('therapist') || undefined,
    });
  }, []);

  /**
   * Resolve the link's therapy/therapist against the catalogue.
   *
   * Runs when the catalogue lands. The admin may have fixed both, only the
   * therapy (leaving the therapist to the client), or neither — each simply
   * lands the client further along the wizard.
   */
  useEffect(() => {
    if (!catalogue.length || !linkChoice || linkApplied.current) return;
    linkApplied.current = true; // apply once, so a later render cannot re-fix it
    const { sid, tkey, therapy, therapist } = linkChoice;
    if (!sid && !tkey && !therapy && !therapist) return;

    const groupOf = (s: CatalogueTherapist) =>
      catalogue.find(t => t.therapists.some(x => x.service_id === s.service_id)) || null;

    // ── by id: an exact row, or nothing ──
    const wanted = Number(sid);
    let person = wanted > 0 ? allServices.find(s => s.service_id === wanted) || null : null;
    // The key is built by the server with the same rule the catalogue groups by,
    // so this is a straight equality test, not a search.
    let group = person ? groupOf(person) : tkey ? catalogue.find(t => t.key === tkey) || null : null;

    // ── legacy links, still sitting in inboxes, that carry names ──
    if (!person && !group && (therapy || therapist)) {
      const norm = (s: string) =>
        s.toLowerCase().replace(/\s+session\s*$/i, '').replace(/\s+/g, ' ').trim();
      group = therapy
        ? catalogue.find(t => norm(t.name) === norm(therapy))
          ?? catalogue.find(t => norm(t.name).includes(norm(therapy)) || norm(therapy).includes(norm(t.name)))
          ?? null
        : null;
      // Match the therapist on first name: the admin picks from a list of full
      // names while service rows spell the same person inconsistently.
      const first = therapist ? therapist.trim().toLowerCase().split(/\s+/)[0] : '';
      const pool = group ? group.therapists : allServices;
      person = first ? pool.find(p => p.therapist_name.toLowerCase().includes(first)) || null : null;
      if (person && !group) group = groupOf(person);
    }

    if (group) setChosenTherapy(group);
    if (person) setService(person);
    if (group || person) { setFromLink(true); setPickedManually(true); }
  }, [catalogue, allServices, linkChoice]);

  /**
   * The number is the way in. A match fills what we know and, where their last
   * session recorded one, fixes the service outright — so a returning client
   * never picks a therapy or therapist again.
   */
  useEffect(() => {
    const key = last10(phone);
    if (key.length < 10) { setIdentified(false); setLookup('idle'); lookedUp.current = ''; return; }
    // Nothing is said about a number until whoever typed it has proved they hold
    // it. "Welcome back, Meet" to an unverified caller answers the one question
    // this page should never answer for free.
    if (otpStage !== 'verified') { setIdentified(false); setLookup('idle'); return; }
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
  }, [phone, countryCode, allServices, catalogue, fromLink, otpStage]);

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

  const fullPhone = `${countryCode}${phone}`;

  /** Countdown for the Resend link. */
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /**
   * Editing the number undoes the verification.
   *
   * Otherwise a client could verify one number, change it, and book against a
   * number nobody ever proved they hold - which is the entire thing this step
   * exists to prevent.
   */
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
        // A cooldown is not a failure to send - the earlier code still works, so
        // the client stays on the code entry with the timer running.
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

  const canContinue = Boolean(
    identified && name.trim() && email.trim() && last10(phone).length === 10 && otpStage === 'verified');

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

        <div className="p-4 sm:p-6">
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
                        {/* inputMode numeric so a phone offers the number pad, and
                            Enter submits - this is a field people expect to type
                            and press go, not hunt for a button. */}
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
                    </>
                  )}

                  {otpError && <p className="text-sm text-rose-600 mt-3">{otpError}</p>}
                </div>
              )}

              {otpStage === 'verified' && (
                <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 bg-teal-50 text-teal-800">
                  <Check size={15} />
                  <span>WhatsApp number verified.</span>
                </div>
              )}

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
                    className="text-left bg-white border border-slate-200 rounded-xl p-4 sm:p-5
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
              {/* A div, not a button: "View more" is itself a button, and a
                  button inside a button is invalid and swallows the click. */}
              {(chosenTherapy?.therapists ?? []).map(p => (
                <div key={p.service_id}
                  onClick={() => { setService(p); setDate(''); setSlot(''); setStep('schedule'); }}
                  className="cursor-pointer text-left bg-white border border-slate-200 rounded-xl p-4 sm:p-5
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
                  <div className="border-t border-slate-100 mt-4 pt-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-teal-800">
                      {p.amount != null ? <>{rupees(p.amount)}</> : 'On request'}
                    </span>
                    {/* Padded out and pulled back in with -my/-mr: the text is
                        small, but the tap target must not be. */}
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setProfileOf(p); }}
                      className="text-xs font-semibold text-teal-700 hover:underline shrink-0 px-2 py-1.5 -my-1.5 -mr-2">
                      View more
                    </button>
                  </div>
                </div>
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
                    // Three across on a phone, where this column has the whole
                    // screen; two from sm up, where it shares the row with the
                    // calendar.
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
              {/* Emergency contact stays tucked away - it is rarely changed.
                  The note is not: it is the one thing a client actually wants to
                  say before a first session, and behind a collapse it went
                  unnoticed. */}
              <details className="mt-4">
                <summary className="text-sm text-teal-700 cursor-pointer select-none">
                  Add an emergency contact (optional)
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
                </div>
              </details>

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Anything you would like your therapist to know? <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  placeholder="Anything that will help them prepare for your session"
                  className={`w-full ${inputCls}`} />
              </div>

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

      {/* Therapist profile, over the wizard rather than as another step - it is
          a detour, and coming back must not lose the client's place. */}
      {profileOf && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setProfileOf(null)}>
          {/* Rises from the bottom on a phone, where a centred dialog leaves dead
              space above and below and puts the close button out of thumb reach.
              overscroll-contain stops a flick inside it scrolling the page behind. */}
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[88vh] sm:max-h-[85vh]
                          overflow-y-auto overscroll-contain"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-4 p-4 sm:p-5 border-b border-slate-100">
              {profileOf.profile_picture_url
                ? <img src={profileOf.profile_picture_url} alt="" className="w-16 h-16 rounded-full object-cover shrink-0 bg-slate-200" />
                : <div className="w-16 h-16 rounded-full bg-slate-200 shrink-0" />}
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-900">{profileOf.therapist_name}</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {profileOf.amount != null ? `${rupees(profileOf.amount)} per session` : 'Session charges on request'}
                </p>
              </div>
              <button type="button" onClick={() => setProfileOf(null)} aria-label="Close"
                className="text-slate-400 hover:text-slate-700 text-xl leading-none shrink-0 px-2 py-1 -m-1">&times;</button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {profileOf.specialization && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Specialises in</div>
                  <div className="flex flex-wrap gap-1.5">
                    {profileOf.specialization.split(',').map(x => x.trim()).filter(Boolean).map(x => (
                      <span key={x} className="text-xs px-2 py-1 rounded-full bg-teal-50 text-teal-800">{x}</span>
                    ))}
                  </div>
                </div>
              )}

              {profileOf.education && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Education</div>
                  <p className="text-sm text-slate-800">{profileOf.education}</p>
                </div>
              )}

              {profileOf.languages && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Speaks</div>
                  <p className="text-sm text-slate-800">{profileOf.languages}</p>
                </div>
              )}

              {profileOf.specialization_details && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">About</div>
                  <p className="text-sm text-slate-800 leading-relaxed">{profileOf.specialization_details}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-1">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Session length</div>
                  <p className="text-sm text-slate-800">{profileOf.duration || '50 m'}</p>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Therapy</div>
                  <p className="text-sm text-slate-800">{chosenTherapy?.name || '-'}</p>
                </div>
              </div>

              {profileOf.qualification_pdf_url && (
                <a href={profileOf.qualification_pdf_url} target="_blank" rel="noreferrer"
                  className="inline-block text-sm text-teal-700 hover:underline">
                  View credentials
                </a>
              )}
            </div>

            <div className="p-4 sm:p-5 pt-0">
              <button type="button"
                onClick={() => { setService(profileOf); setDate(''); setSlot(''); setProfileOf(null); setStep('schedule'); }}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 transition-colors">
                Book with {profileOf.therapist_name.split(' ')[0]}
              </button>
            </div>
          </div>
        </div>
      )}

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
