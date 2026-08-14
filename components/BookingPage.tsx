import React, { useState, useEffect, useMemo } from 'react';
import Lottie from 'lottie-react';
import sessionBookedAnimation from '../session-booked.json';
import {
  ChevronLeft, ChevronRight, Globe, Clock, Check, X,
  CalendarCheck, User, Mail, MessageSquare, Video, MapPin, CreditCard,
  MessageCircle, Info, Calendar as CalendarIcon, ExternalLink, ChevronDown,
  AlertCircle
} from 'lucide-react';
import moment from 'moment';
import './BookingPage.css';

interface BookingPageProps {
  session: {
    id?: number;
    title: string;
    detailedDescription?: string;
    duration: string;
    /** List price as text ("₹1700"). Provisional until the client identifies themselves. */
    charges: string;
    list_amount?: number;
    price_is_provisional?: boolean;
    owner: string;
    slug: string;
    label?: string;
    therapist_id?: string;
    schedule_id?: number | null;
    form_questions?: any[];
    is_payment_enabled?: boolean;
    payment_gateway?: string;
    requires_tnc?: boolean;
    type?: string;
    description?: string;
  };
  onBack?: () => void;
  isPublic?: boolean;
}

const DEFAULT_QUESTIONS = [
  { id: '1', type: 'text', label: 'Name', required: true },
  { id: '2', type: 'email', label: 'Email address', required: true },
  { id: '3', type: 'tel', label: 'Whatsapp Number', required: true },
  { id: '4', type: 'text', label: 'Emergency Contact Name', required: false },
  { id: '5', type: 'text', label: 'Emergency Contact Relation', required: false },
  { id: '6', type: 'tel', label: 'Emergency Contact Number', required: false },
  { id: '7', type: 'textarea', label: 'Please share anything that will help prepare for our meeting', required: false },
  { id: '8', type: 'checkbox', label: 'I confirm that I have read and agree to the Terms & Conditions.', required: true }
];

export const BookingPage: React.FC<BookingPageProps> = ({ session, onBack, isPublic }) => {
  const [view, setView] = useState<'selection' | 'registration'>('selection');
  const [currentMonth, setCurrentMonth] = useState(moment());
  const [selectedDate, setSelectedDate] = useState(moment());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h');
  const [showFull, setShowFull] = useState(false);

  // Form states
  /**
   * Details the admin already collected, handed over in the link they sent.
   *
   * Read once, at first render, so a later edit by the client is never undone by
   * a re-render. These are a convenience only — every field stays editable, and
   * the server re-resolves identity and price at checkout regardless of what
   * arrives here. Nothing from the URL is trusted for pricing or authorisation.
   */
  const prefill = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const digits = (q.get('phone') || '').replace(/[^\d]/g, '');
    return {
      name: (q.get('name') || '').slice(0, 100),
      email: (q.get('email') || '').slice(0, 120),
      // Stored numbers carry a country code; the form holds it separately.
      phone: digits.length > 10 ? digits.slice(-10) : digits,
      code: digits.length > 10 ? `+${digits.slice(0, digits.length - 10)}` : '+91',
    };
  }, []);

  const [formData, setFormData] = useState({
    name: prefill.name,
    email: prefill.email,
    whatsapp: prefill.phone,
    whatsappCountryCode: prefill.code,
    name2: '',
    email2: '',
    whatsapp2: '',
    whatsapp2CountryCode: '+91',
    emergencyName: '',
    emergencyRelation: '',
    emergencyNumber: '',
    emergencyCountryCode: '+91',
    notes: '',
    location: 'google_meet' as 'google_meet' | 'in_person',
    paymentMethod: 'razorpay',
    agreedTerms: false
  });

  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});

  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [sessionCharges, setSessionCharges] = useState(session.charges);

  // The price THIS client pays, resolved server-side once they identify
  // themselves. Null until then, when the list price on `session` is all that
  // can be known. An existing client on a grandfathered rate, or one the admin
  // has priced individually, sees their own figure appear here.
  const [resolvedPrice, setResolvedPrice] = useState<{
    amount: number;
    list_amount: number;
    is_special_price: boolean;
    price_source: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [bookedDetails, setBookedDetails] = useState<any>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [countdown, setCountdown] = useState(5);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const [paymentFailed, setPaymentFailed] = useState(false);

  // Real-time lookup & care continuity validation states
  const [lastCheckedEmail, setLastCheckedEmail] = useState('');
  const [lastCheckedPhone, setLastCheckedPhone] = useState('');
  const [bookingConflictMessage, setBookingConflictMessage] = useState<string | null>(null);
  const [isBookingBlocked, setIsBookingBlocked] = useState(false);

  // Timezone support
  const [clientTimezone, setClientTimezone] = useState(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Normalize deprecated Calcutta to Kolkata
    return tz === 'Asia/Calcutta' ? 'Asia/Kolkata' : tz;
  });
  const [showTzDropdown, setShowTzDropdown] = useState(false);

  useEffect(() => {
    // We already initialize clientTimezone using Intl.DateTimeFormat().resolvedOptions().timeZone
    // which is standard and doesn't require an external API call, avoiding CORS/429 errors.
  }, []);

  useEffect(() => {
    if (view !== 'registration') return;

    const emailVal = formData.email.trim().toLowerCase();
    const phoneVal = formData.whatsapp.replace(/[^0-9]/g, '');

    const isEmailComplete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);
    const isPhoneComplete = phoneVal.length >= 10;

    const shouldCheckEmail = isEmailComplete && emailVal !== lastCheckedEmail;
    const shouldCheckPhone = isPhoneComplete && phoneVal !== lastCheckedPhone;

    if (!shouldCheckEmail && !shouldCheckPhone) {
      if (!isEmailComplete && !isPhoneComplete) {
        setIsBookingBlocked(false);
        setBookingConflictMessage(null);
      }
      return;
    }

    const timer = setTimeout(async () => {
      setLastCheckedEmail(emailVal);
      setLastCheckedPhone(phoneVal);

      // Re-quote for this specific client. Runs on the same debounce as the
      // history lookup, so an existing client's grandfathered rate (or an
      // admin-set price) replaces the list price as soon as they type their
      // email. Fire-and-forget: a failed quote leaves the list price showing,
      // and the server re-resolves at checkout regardless.
      fetch('/api/public/resolve-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: session.slug, serviceId: session.id, email: emailVal, phone: phoneVal }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(p => {
          if (p?.success) {
            setResolvedPrice(p);
            setSessionCharges(`₹${p.amount}`);
          }
        })
        .catch(err => console.error('Error resolving price:', err));

      try {
        const response = await fetch('/api/public/client-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailVal, phone: phoneVal }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.exists) {
            const updatedForm = { ...formData };
            let formChanged = false;

            if (data.clientName && !formData.name) {
              updatedForm.name = data.clientName;
              formChanged = true;
            }

            if (shouldCheckPhone && data.clientEmail && formData.email !== data.clientEmail) {
              updatedForm.email = data.clientEmail;
              setLastCheckedEmail(data.clientEmail.trim().toLowerCase());
              formChanged = true;
            }

            if (shouldCheckEmail && data.clientPhone) {
              const parsed = parsePhoneNumber(data.clientPhone);
              if (formData.whatsapp !== parsed.localNumber) {
                updatedForm.whatsapp = parsed.localNumber;
                updatedForm.whatsappCountryCode = parsed.countryCode;
                setLastCheckedPhone(parsed.localNumber.replace(/[^0-9]/g, ''));
                formChanged = true;
              }
            }

            if (data.sessionMode) {
              const mappedLocation = (data.sessionMode.toLowerCase().includes('online') || data.sessionMode.toLowerCase().includes('meet'))
                ? 'google_meet'
                : 'in_person';
              if (formData.location !== mappedLocation) {
                updatedForm.location = mappedLocation;
                formChanged = true;
              }
            }

            if (data.emergencyName && !formData.emergencyName) {
              updatedForm.emergencyName = data.emergencyName;
              formChanged = true;
            }
            if (data.emergencyRelation && !formData.emergencyRelation) {
              updatedForm.emergencyRelation = data.emergencyRelation;
              formChanged = true;
            }
            if (data.emergencyNumber && !formData.emergencyNumber) {
              const parsedEmergency = parsePhoneNumber(data.emergencyNumber);
              updatedForm.emergencyNumber = parsedEmergency.localNumber;
              updatedForm.emergencyCountryCode = parsedEmergency.countryCode;
              formChanged = true;
            }

            if (formChanged) {
              setFormData(updatedForm);
            }

            const getCategory = (name: string) => {
              const n = (name || '').toLowerCase();
              if (n.includes('free consultation')) return 'Free Consultation';
              if (n.includes('couple')) return 'Couples Therapy';
              if (n.includes('adolescent')) return 'Adolescent Therapy';
              if (n.includes('individual')) return 'Individual Therapy';
              return n.trim();
            };

            const currentTherapist = session.owner;
            const currentTherapistId = session.therapist_id;

            if (data.assignedTherapistName) {
              const assignedTherapist = data.assignedTherapistName;
              const assignedTherapy = data.assignedTherapy;
              const assignedTherapistId = data.assignedTherapistId;

              // Prefer a stable therapist_id comparison. Display names are stored
              // inconsistently for the same therapist (e.g. "Muskan" vs "Muskan Negi"),
              // which previously produced false "different therapist" blocks for a
              // client trying to re-book their own assigned therapist. Only fall back
              // to name matching when an id is missing (legacy / hardcoded services).
              const therapistMismatch = (currentTherapistId && assignedTherapistId)
                ? String(currentTherapistId).trim() !== String(assignedTherapistId).trim()
                : currentTherapist.toLowerCase().trim() !== assignedTherapist.toLowerCase().trim();
              const therapyMismatch = assignedTherapy && getCategory(session.title) !== getCategory(assignedTherapy);

              if (therapistMismatch || therapyMismatch) {
                setIsBookingBlocked(true);
                if (assignedTherapy) {
                  setBookingConflictMessage(
                    `We noticed you are currently receiving ${assignedTherapy} with ${assignedTherapist}. To ensure continuity of care, please proceed with booking your session with your assigned therapist.`
                  );
                } else {
                  setBookingConflictMessage(
                    `We noticed you are currently assigned to therapist ${assignedTherapist}. To ensure continuity of care, please proceed with booking your session with your assigned therapist.`
                  );
                }
              } else {
                setIsBookingBlocked(false);
                setBookingConflictMessage(null);
              }
            } else {
              setIsBookingBlocked(false);
              setBookingConflictMessage(null);
            }
          } else {
            setIsBookingBlocked(false);
            setBookingConflictMessage(null);
          }
        }
      } catch (err) {
        console.error('Error fetching client details:', err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [formData.email, formData.whatsapp, view]);

  const COMMON_TIMEZONES = [
    { value: 'Asia/Kolkata', label: 'India (IST, UTC+5:30)' },
    { value: 'America/New_York', label: 'New York (EST/EDT)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
    { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
    { value: 'America/Toronto', label: 'Toronto (EST/EDT)' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST, UTC+4)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT, UTC+8)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST, UTC+9)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  ];

  // Convert an IST HH:mm slot on a given date to the client's timezone
  const convertSlotToClientTz = (istSlot: string, date: moment.Moment): { display: string; istLabel: string; crossDay: string } => {
    const isIST = clientTimezone === 'Asia/Kolkata' || clientTimezone === 'Asia/Calcutta';
    if (isIST) {
      return { display: moment(istSlot, 'HH:mm').format(timeFormat === '12h' ? 'h:mm A' : 'HH:mm'), istLabel: '', crossDay: '' };
    }
    // Build an ISO string treating the slot as IST (UTC+5:30) — avoids local system TZ contamination
    const [h, m] = istSlot.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const istIsoString = `${date.format('YYYY-MM-DD')}T${pad(h)}:${pad(m)}:00+05:30`;
    const utcMs = new Date(istIsoString).getTime();
    const clientDate = new Date(utcMs);

    const displayTime = clientDate.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: timeFormat === '12h',
      timeZone: clientTimezone
    });

    // Check if day differs
    const clientDay = clientDate.toLocaleDateString('en-CA', { timeZone: clientTimezone }); // YYYY-MM-DD
    const istDay = date.format('YYYY-MM-DD');
    let crossDay = '';
    if (clientDay < istDay) crossDay = '(prev day)';
    else if (clientDay > istDay) crossDay = '(next day)';

    // IST label for reference
    const istDisplay = moment(istSlot, 'HH:mm').format(timeFormat === '12h' ? 'h:mm A' : 'HH:mm');
    return { display: displayTime, istLabel: `${istDisplay} IST`, crossDay };
  };

  // Get short timezone abbreviation
  const getTzAbbr = (tz: string): string => {
    try {
      return new Intl.DateTimeFormat('en', { timeZoneName: 'short', timeZone: tz })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value || tz;
    } catch { return tz; }
  };
  const isCoupleSession = session.title.toLowerCase().includes('couple');
  const isAdolescentSession = session.title.toLowerCase().includes('adolescent');
  const rawDesc = (session.detailedDescription || session.description || '').replace(/&nbsp;/g, ' ');

  // If description looks like HTML (from Quill editor), render it as HTML.
  // Otherwise treat as plain markdown-style text.
  const isHtml = /<[a-z][\s\S]*>/i.test(rawDesc);

  // Strip unsafe tags but keep formatting (p, strong, em, ul, ol, li, br, h1-h6)
  const sanitizeHtml = (html: string): string => {
    return html
      .replace(/&nbsp;/g, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '');
  };

  // Auto-redirect countdown when payment link is set
  useEffect(() => {
    if (!paymentLink) return;
    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          window.location.href = paymentLink;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [paymentLink]);

  useEffect(() => {
    // Dynamically load active Payment SDK based on settings
    fetch('/api/payment-settings/public')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPaymentConfig(data);
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.async = true;
          document.head.appendChild(script);
        }
      })
      .catch(err => console.error('Error fetching payment config:', err));
  }, []);

  const formatTime = (timeStr: string) => {
    return moment(timeStr, 'HH:mm').format(timeFormat === '12h' ? 'h:mm A' : 'HH:mm');
  };

  const getSimplifiedTherapyName = () => {
    const isFree = session.charges === '₹0' || session.charges === '0' || session.charges.toLowerCase().includes('free');
    if (isFree) return 'Free Consultation';

    if (!session.label) return session.title;
    const category = session.label.split('/')[0].toLowerCase();
    if (category === 'individual') return 'Individual Therapy';
    if (category === 'couple') return 'Couples Therapy';
    if (category === 'adolescent') return 'Adolescent Therapy';
    return session.title;
  };

  const parsePhoneNumber = (fullPhone: string) => {
    const codes = ['+91', '+1', '+44', '+971', '+61', '+65', '+49', '+33', '+81'];
    const cleanFull = fullPhone.trim();
    for (const code of codes) {
      if (cleanFull.startsWith(code)) {
        return {
          countryCode: code,
          localNumber: cleanFull.substring(code.length)
        };
      }
    }
    if (cleanFull.startsWith('+')) {
      return { countryCode: '+91', localNumber: cleanFull.replace(/^\+91/, '') };
    }
    return { countryCode: '+91', localNumber: cleanFull };
  };

  const fetchSlots = async (date: moment.Moment) => {
    setIsLoadingSlots(true);
    setAvailableSlots([]);
    setSelectedSlot(null);

    const payload = {
      selectedTherapy: getSimplifiedTherapyName(),
      selectedTherapist: session.owner === 'SafeStories' ? 'SafeStories' : session.owner,
      therapistId: session.therapist_id || undefined,
      scheduleId: session.schedule_id || undefined,
      selectedDate: date.format('YYYY-MM-DD'),
      isFreeConsultation: session.charges === '₹0' || session.charges === '0' || (typeof session.charges === 'string' && session.charges.toLowerCase().includes('free')),
      timezone: 'Asia/Kolkata',
      isDirectBooking: false,
      isAdmin: false
    };

    try {
      const response = await fetch('/api/fetch-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0 && data[0]['Available Slots']) {
          const rawSlots = data[0]['Available Slots'];
          const charges = data[0]['session charges'];
          if (charges) setSessionCharges(`₹${charges}`);

          if (rawSlots.length > 0) {
            const formattedSlots = rawSlots.map((slot: string) => {
              const d = new Date(slot);
              // Force the time string to be extracted strictly in IST
              return d.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23', // Use 24-hour format like moment('HH:mm')
                timeZone: 'Asia/Kolkata'
              });
            });
            setAvailableSlots(formattedSlots);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching slots:', error);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchSlots(selectedDate);
  }, [selectedDate, session.owner, session.title]);

  const handleBookingSubmit = async () => {
    if (isSubmitting) return; // guard against double-clicks creating duplicate bookings

    // Validate required questions (standard & custom)
    const questions = session.form_questions || DEFAULT_QUESTIONS;
    for (const q of questions) {
      if (q.required) {
        if (q.id === '1' && !formData.name) { alert(`${q.label || 'Name'} is required`); return; }
        if (q.id === '2' && !formData.email) { alert(`${q.label || 'Email address'} is required`); return; }
        if (q.id === '3' && !formData.whatsapp) { alert(`${q.label || 'Whatsapp Number'} is required`); return; }
        if (q.id === '8' && !formData.agreedTerms) { alert('Please confirm that you have read and agree to the Terms & Conditions'); return; }
        
        // Couple session validations (only if client fields are required, partner fields are also checked)
        if (isCoupleSession) {
          if (q.id === '1' && !formData.name2) { alert("Partner's Name is required"); return; }
          if (q.id === '2' && !formData.email2) { alert("Partner's Email is required"); return; }
          if (q.id === '3' && !formData.whatsapp2) { alert("Partner's Whatsapp number is required"); return; }
        }
        
        // Custom questions validation
        if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(q.id)) {
          if (!customResponses[q.id]) {
            alert(`"${q.label || 'Untitled Question'}" is required`);
            return;
          }
        }
      }
    }

    setIsSubmitting(true);

    // Prefer the client-specific figure once it has resolved. This is only what
    // gets DISPLAYED and what decides whether to open checkout — the amount
    // actually charged is resolved again server-side in create-order, so a
    // tampered value here cannot change the price.
    const amountVal = resolvedPrice
      ? resolvedPrice.amount
      : (parseFloat(sessionCharges.replace('₹', '').replace(',', '')) || 0);
    // Free if charges are zero OR if the service has payment disabled
    const isFree = amountVal === 0 || session.is_payment_enabled === false;

    // Compile custom responses into a readable text block
    let compiledNotes = formData.notes || '';
    const customQuestions = (session.form_questions || DEFAULT_QUESTIONS).filter(
      (q: any) => !['1', '2', '3', '4', '5', '6', '7', '8'].includes(q.id)
    );
    
    if (customQuestions.length > 0) {
      const answersText = customQuestions
        .map((q: any) => {
          const ans = customResponses[q.id];
          if (q.type === 'tel') {
            const code = customResponses[q.id + '_code'] || '+91';
            return `${q.label}: ${code}${ans || ''}`;
          }
          return `${q.label}: ${ans || 'Not answered'}`;
        })
        .join('\n');
      
      compiledNotes = `${compiledNotes}\n\nAdditional Details:\n${answersText}`.trim();
    }

    const payload: any = {
      therapyName: getSimplifiedTherapyName(),
      therapistName: session.owner,
      isFreeConsultation: isFree,
      date: selectedDate.format('YYYY-MM-DD'),
      slot: moment(selectedSlot, 'HH:mm').format('h:mm A'),
      clientName: formData.name,
      clientEmail: formData.email,
      clientWhatsApp: `${formData.whatsappCountryCode}${formData.whatsapp}`,
      partnerName: isCoupleSession ? formData.name2 : undefined,
      partnerEmail: isCoupleSession ? formData.email2 : undefined,
      partnerWhatsApp: isCoupleSession ? `${formData.whatsapp2CountryCode}${formData.whatsapp2}` : undefined,
      emergencyContactName: formData.emergencyName,
      emergencyContactRelation: formData.emergencyRelation,
      emergencyContactNumber: `${formData.emergencyCountryCode}${formData.emergencyNumber}`,
      sessionMode: formData.location === 'google_meet' ? 'online' : 'in-person',
      // The slot itself is an IST time (parsed server-side as GMT+05:30), so the
      // therapist's calendar event is always marked in IST. `timezone` is the
      // CLIENT's own timezone — it's stored in the DB and used to show the client
      // their booking time in their local zone. For an IST client this is IST.
      timezone: clientTimezone,
      notes: compiledNotes,
      invitee_question: compiledNotes, // Send both
      isAdmin: false,
      clientTimezone: clientTimezone,
      // Lets the server identify the therapy directly instead of inferring it
      // from the resource label, which canonicalTherapyLabel() flattens.
      serviceId: session.id,
      slug: session.slug,
      // Display/reference only. The server re-resolves and overwrites this.
      amount: amountVal
    };

    const submitBooking = async (paymentDetails?: any) => {
      try {
        const finalPayload = {
          ...payload,
          ...(paymentDetails || {})
        };

        const response = await fetch('/api/create-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalPayload),
        });

        if (response.ok) {
          const responseData = await response.json();
          console.log('📦 Booking response:', JSON.stringify(responseData, null, 2));
          setBookedDetails(finalPayload);
          
          const returnedBookingId = responseData.booking_id || responseData.id || responseData.bookingId;
          
          if (isPublic) {
            // Store redirect url and display success animation
            setRedirectUrl(`${window.location.origin}/booking-confirmation/${returnedBookingId}`);
            setShowSuccessModal(true);
          } else {
            setShowSuccessModal(true);
          }
        } else {
          const errorData = await response.json();
          alert(`Booking failed: ${errorData.details || errorData.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error creating booking:', error);
        alert('Error creating booking. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    };

    if (isFree) {
      // Free consultation session: bypass payment completely
      await submitBooking();
      return;
    }

    if (!paymentConfig) {
      alert('Payment system is initializing. Please try again in a few seconds.');
      setIsSubmitting(false);
      return;
    }

    try {
      // Step 1 — Create Razorpay order
      // Identify WHAT is being paid for, never HOW MUCH. The server resolves
      // the amount from the pricing rules and returns the order it created.
      const orderResponse = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: session.slug,
          serviceId: session.id,
          email: formData.email,
          phone: formData.whatsapp,
        }),
      });
      if (!orderResponse.ok) {
        const errorMsg = await orderResponse.json();
        throw new Error(errorMsg.error || 'Failed to initialize payment order');
      }
      const orderData = await orderResponse.json();

      // Step 2 — Create a pending booking to hold the slot (15-min window)
      const pendingRes = await fetch('/api/create-pending-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, razorpayOrderId: orderData.order_id }),
      });
      if (!pendingRes.ok) {
        const pendingErr = await pendingRes.json();
        throw new Error(pendingErr.error || 'Failed to reserve booking slot');
      }
      const { booking_id: newPendingId } = await pendingRes.json();
      setPendingBookingId(newPendingId);

      const rzpKeyId = paymentConfig.publicKey || import.meta.env.VITE_RAZORPAY_KEY_ID;

      // Step 3 — Open Razorpay modal
      const options = {
        key: rzpKeyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'SafeStories',
        description: `${payload.therapyName} with ${payload.therapistName}`,
        order_id: orderData.order_id,
        handler: async function (response: any) {
          console.log('💳 Razorpay payment succeeded:', response.razorpay_payment_id);
          try {
            // Step 4 — Verify signature server-side + confirm booking + send notifications
            const verifyRes = await fetch('/api/razorpay/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId: newPendingId,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpayOrderId: response.razorpay_order_id,
                razorpaySignature: response.razorpay_signature,
                ...payload
              }),
            });
            if (verifyRes.ok) {
              const verifyData = await verifyRes.json();
              setBookedDetails(payload);
              if (isPublic) {
                setRedirectUrl(`${window.location.origin}/booking-confirmation/${verifyData.booking_id}`);
              }
              setShowSuccessModal(true);
            } else {
              const errData = await verifyRes.json();
              alert(`Payment verification failed: ${errData.error || 'Please contact support.'}`);
            }
          } catch (verifyErr: any) {
            console.error('❌ verify-payment error:', verifyErr);
            alert('Error confirming payment. Please contact support with your payment reference.');
          } finally {
            setIsSubmitting(false);
          }
        },
        prefill: {
          name: payload.clientName,
          email: payload.clientEmail,
          contact: payload.clientWhatsApp
        },
        theme: { color: '#0f766e' },
        modal: {
          ondismiss: function () {
            // Payment window closed without success — show failure UI
            setPaymentFailed(true);
            setIsSubmitting(false);
            console.log('[Razorpay] Checkout dismissed without payment');
          }
        }
      };

      const razorpay = new (window as any).Razorpay(options);

      // Capture payment failure event (fires while modal is still open for retry)
      razorpay.on('payment.failed', function (response: any) {
        console.warn('[Razorpay] Payment attempt failed:', {
          code: response?.error?.code,
          description: response?.error?.description,
          reason: response?.error?.reason,
          payment_id: response?.error?.metadata?.payment_id,
          order_id: response?.error?.metadata?.order_id
        });
        // Mark the pending booking as payment_failed so it shows correctly in admin panel
        if (newPendingId) {
          fetch('/api/mark-payment-failed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: newPendingId, razorpayPaymentId: response?.error?.metadata?.payment_id })
          }).catch(() => {});
        }
        // Razorpay's UPI flow never visually updates the modal on failure —
        // close it programmatically so ondismiss fires and shows our error UI.
        razorpay.close();
      });

      razorpay.open();
    } catch (err: any) {
      console.error('❌ Payment checkout error:', err);
      alert(err.message || 'Payment initiation failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  const generateCalendarDays = () => {
    const start = currentMonth.clone().startOf('month');
    const end = currentMonth.clone().endOf('month');
    const days = [];
    for (let i = 0; i < start.day(); i++) {
      days.push(<div key={`e${i}`} className="cal-day empty" />);
    }
    for (let d = 1; d <= end.date(); d++) {
      const date = currentMonth.clone().date(d);
      const isSel = date.isSame(selectedDate, 'day');
      const isToday = date.isSame(moment(), 'day');
      const isPast = date.isBefore(moment(), 'day');
      const isSunday = date.day() === 0;
      const isDisabled = isPast || isSunday;

      days.push(
        <div
          key={d}
          className={`cal-day${isSel ? ' selected' : ''}${isToday ? ' today' : ''}${isDisabled ? ' disabled' : ''}`}
          onClick={() => {
            if (!isDisabled) {
              setSelectedDate(date);
              setSelectedSlot(null);
            }
          }}
        >
          {d}
        </div>
      );
    }
    return days;
  };

  const COUNTRY_CODES = [
    { code: '+91', label: 'IND' },
    { code: '+1', label: 'USA/CAN' },
    { code: '+44', label: 'UK' },
    { code: '+971', label: 'UAE' },
    { code: '+61', label: 'AUS' },
    { code: '+65', label: 'SGP' },
    { code: '+49', label: 'GER' },
    { code: '+33', label: 'FRA' },
    { code: '+81', label: 'JPN' }
  ];

  return (
    <div className="bp-root">
      <div className="bp-container">

        {/* ── LEFT: Session Summary ── */}
        <div className="bp-pane bp-summary">
          {!isPublic && onBack && (
            <button className="bp-back" onClick={onBack}>
              <ChevronLeft size={18} /> Back
            </button>
          )}

          {/* SafeStories Logo — matches dashboard style */}
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

          <h1 className="bp-title">{session.title}</h1>

          {isHtml ? (
            <div
              className="bp-desc bp-desc-html"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(rawDesc) }}
            />
          ) : (
            <div className="bp-desc">
              {rawDesc.split('\n\n').filter(Boolean).map((paragraph, i) => {
                const parts = paragraph.split('**');
                return (
                  <p key={i} className="bp-desc-line" style={i > 0 ? { marginTop: 14 } : {}}>
                    {parts.map((part, index) =>
                      index % 2 === 1 ? <strong key={index}>{part}</strong> : part
                    )}
                  </p>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', gap: '16px', fontSize: '14px', fontWeight: '500', color: '#0d9488', marginBottom: '8px' }}>
              <a href="https://safestories.in/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#0d9488' }} onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'} onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>Privacy Policy</a>
              <span style={{ color: '#d1d5db' }}>|</span>
              <a href="https://safestories.in/tnc" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#0d9488' }} onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'} onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>Terms & Conditions</a>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              <a href="https://safestories.in" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#6b7280' }} onMouseOver={e => e.currentTarget.style.color = '#0d9488'} onMouseOut={e => e.currentTarget.style.color = '#6b7280'}>
                &copy; 2026 SAFETY AND YOU WELLBEING CENTRE LLP All Rights Reserved!
              </a>
            </div>
          </div>
        </div>

        {view === 'selection' ? (
          <>
            {/* ── MIDDLE: Calendar ── */}
            <div className="bp-pane bp-calendar">
              <h2 className="bp-pane-title">Select a Date & Time</h2>

              <div className="bp-controls">
                <div className="bp-control-group">
                  <select className="bp-select"><option>{session.duration.split(' ')[0]}m</option></select>
                </div>
              </div>

              <div className="bp-cal-header">
                <button onClick={() => setCurrentMonth(currentMonth.clone().subtract(1, 'month'))}>
                  <ChevronLeft size={20} />
                </button>
                <span className="bp-month">{currentMonth.format('MMMM YYYY')}</span>
                <button onClick={() => setCurrentMonth(currentMonth.clone().add(1, 'month'))}>
                  <ChevronRight size={20} />
                </button>
              </div>

              <div className="bp-day-headers">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
              </div>
              <div className="bp-cal-grid">
                {generateCalendarDays()}
              </div>
            </div>

            {/* ── RIGHT: Slots ── */}
            <div className="bp-pane bp-slots">
              <div className="bp-slots-top">
                <h2 className="bp-date-label">{selectedDate.format('MMM D, YYYY')}</h2>
                <div className="bp-fmt-toggle">
                  <button className={timeFormat === '12h' ? 'active' : ''} onClick={() => setTimeFormat('12h')}>12h</button>
                  <button className={timeFormat === '24h' ? 'active' : ''} onClick={() => setTimeFormat('24h')}>24h</button>
                </div>
              </div>

              {/* Timezone selector */}
              <div className="bp-tz-wrapper">
                <button className="bp-tz-btn" onClick={() => setShowTzDropdown(v => !v)}>
                  <Globe size={13} />
                  <span className="bp-tz-label">
                    {getTzAbbr(clientTimezone)} — {COMMON_TIMEZONES.find(t => t.value === clientTimezone)?.label || clientTimezone}
                  </span>
                  <ChevronDown size={13} />
                </button>
                {showTzDropdown && (
                  <div className="bp-tz-dropdown">
                    {COMMON_TIMEZONES.map(tz => (
                      <div
                        key={tz.value}
                        onClick={() => { setClientTimezone(tz.value); setShowTzDropdown(false); }}
                        className={`bp-tz-option${clientTimezone === tz.value ? ' active' : ''}`}
                      >
                        {tz.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bp-slots-list">
                {isLoadingSlots ? (
                  <div className="bp-loading-slots">
                    <div className="bp-spinner" />
                    <p>Loading slots...</p>
                  </div>
                ) : availableSlots.length > 0 ? (
                  availableSlots.map((s, i) => {
                    // Slots are always shown in IST — the therapist's availability is
                    // defined in IST and the session is booked/marked at that IST time.
                    return (
                      <div
                        key={i}
                        className={`bp-slot available${selectedSlot === s ? ' selected' : ''}`}
                        onClick={() => { setSelectedSlot(s); setView('registration'); }}
                      >
                        <span className="bp-dot available" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span>{formatTime(s)} IST</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bp-no-slots">
                    <p>No slots available for this date.</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── REGISTRATION FORM ── */
          <div className="bp-pane bp-registration">
            <div className="bp-reg-header">
              <button className="bp-reg-back" onClick={() => setView('selection')}>
                <ChevronLeft size={20} />
              </button>
              <h2 className="bp-reg-title">
                {isCoupleSession ? "Please Enter Your & Your Partner's Details" : "Registration"}
              </h2>
            </div>

            <div className="bp-reg-banner">
              <div className="bp-reg-date-box">
                <span className="bp-reg-month">{selectedDate.format('MMM').toUpperCase()}</span>
                <span className="bp-reg-day">{selectedDate.format('DD')}</span>
              </div>
              <div className="bp-reg-info">
                <h3 className="bp-reg-info-date">{selectedDate.format('dddd, D MMMM')}</h3>
                {(() => {
                  const converted = convertSlotToClientTz(selectedSlot!, selectedDate);
                  const endIst = moment(selectedSlot, 'HH:mm').add(parseInt(session.duration), 'minutes');
                  const endConverted = convertSlotToClientTz(endIst.format('HH:mm'), selectedDate);
                  const tzAbbr = getTzAbbr(clientTimezone);
                  const isIST = clientTimezone === 'Asia/Kolkata' || clientTimezone === 'Asia/Calcutta';
                  if (isIST) {
                    return (
                      <p className="bp-reg-info-time">
                        {formatTime(selectedSlot!)} - {endIst.format(timeFormat === '12h' ? 'h:mm A' : 'HH:mm')} (IST)
                      </p>
                    );
                  }
                  return (
                    <>
                      <p className="bp-reg-info-time">
                        {converted.display} - {endConverted.display} ({tzAbbr}) {converted.crossDay}
                      </p>
                      <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {converted.istLabel} - {convertSlotToClientTz(endIst.format('HH:mm'), selectedDate).istLabel} (therapist time)
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="bp-reg-form">
              {!((session.type || '').toLowerCase() === 'free_consultation' || 
                 (session.type || '').toLowerCase().includes('free consultation') || 
                 (session.title || '').toLowerCase().includes('free consultation')) && (
                <div className="bp-info-banner" style={{ background: '#f0fdfa', border: '1px solid #ccfbf1', borderRadius: '12px', padding: '16px', display: 'flex', gap: '12px', marginBottom: '8px' }}>
                  <Info size={20} style={{ color: '#0d9488', flexShrink: 0, marginTop: '2px' }} />
                  <span style={{ fontSize: '13.5px', color: '#115e59', lineHeight: '1.5', fontWeight: 500 }}>
                    Enter your WhatsApp number first! If you’ve booked before, your details will auto-fill—just review and book. If you're new, please fill out the form below
                  </span>
                </div>
              )}

              {(session.form_questions && session.form_questions.length > 0 ? session.form_questions : DEFAULT_QUESTIONS).map((q: any) => {
                // If it is couple session, hide emergency contact questions
                if (isCoupleSession && ['4', '5', '6'].includes(q.id)) {
                  return null;
                }

                // If standard fields, bind to standard state
                if (q.id === '1') {
                  return (
                    <React.Fragment key={q.id}>
                      <div className="bp-form-field">
                        <label>{q.label || 'Name'} {q.required && <span className="req">*</span>}</label>
                        <input type="text" className="bp-input" autoComplete="off"
                          value={formData.name}
                          onChange={e => setFormData({ ...formData, name: e.target.value })} />
                      </div>
                      {isCoupleSession && (
                        <div className="bp-form-field">
                          <label>Partner's Name <span className="req">*</span></label>
                          <input type="text" className="bp-input"
                            value={formData.name2}
                            onChange={e => setFormData({ ...formData, name2: e.target.value })} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                }

                if (q.id === '2') {
                  return (
                    <React.Fragment key={q.id}>
                      <div className="bp-form-field">
                        <label>{q.label || 'Email address'} {q.required && <span className="req">*</span>}</label>
                        <input type="email" className="bp-input" autoComplete="off"
                          value={formData.email}
                          onChange={e => setFormData({ ...formData, email: e.target.value })} />
                      </div>
                      {isCoupleSession && (
                        <div className="bp-form-field">
                          <label>Partner's Email <span className="req">*</span></label>
                          <input type="email" className="bp-input"
                            value={formData.email2}
                            onChange={e => setFormData({ ...formData, email2: e.target.value })} />
                        </div>
                      )}
                    </React.Fragment>
                  );
                }

                if (q.id === '3') {
                  return (
                    <React.Fragment key={q.id}>
                      <div className="bp-form-field">
                        <label>{q.label || 'Whatsapp Number'} {q.required && <span className="req">*</span>}</label>
                        <div className="bp-phone-input">
                          <select
                            className="bp-country-select"
                            value={formData.whatsappCountryCode}
                            onChange={e => setFormData({ ...formData, whatsappCountryCode: e.target.value })}
                          >
                            {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                          </select>
                          <input type="tel" className="bp-input" autoComplete="off"
                            value={formData.whatsapp}
                            onChange={e => setFormData({ ...formData, whatsapp: e.target.value })} />
                        </div>
                      </div>
                      {isCoupleSession && (
                        <div className="bp-form-field">
                          <label>Partner's Whatsapp number <span className="req">*</span></label>
                          <div className="bp-phone-input">
                            <select
                              className="bp-country-select"
                              value={formData.whatsapp2CountryCode}
                              onChange={e => setFormData({ ...formData, whatsapp2CountryCode: e.target.value })}
                            >
                              {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                            </select>
                            <input type="tel" className="bp-input"
                              value={formData.whatsapp2}
                              onChange={e => setFormData({ ...formData, whatsapp2: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                }

                if (q.id === '4') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label || 'Emergency Contact Name'} {q.required && <span className="req">*</span>}</label>
                      <input type="text" className="bp-input"
                        value={formData.emergencyName}
                        onChange={e => setFormData({ ...formData, emergencyName: e.target.value })} />
                    </div>
                  );
                }

                if (q.id === '5') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label || 'Emergency Contact Relation'} {q.required && <span className="req">*</span>}</label>
                      <input type="text" className="bp-input"
                        value={formData.emergencyRelation}
                        onChange={e => setFormData({ ...formData, emergencyRelation: e.target.value })} />
                    </div>
                  );
                }

                if (q.id === '6') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label || 'Emergency Contact Number'} {q.required && <span className="req">*</span>}</label>
                      <div className="bp-phone-input">
                        <select
                          className="bp-country-select"
                          value={formData.emergencyCountryCode}
                          onChange={e => setFormData({ ...formData, emergencyCountryCode: e.target.value })}
                        >
                          {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                        </select>
                        <input type="tel" className="bp-input"
                          value={formData.emergencyNumber}
                          onChange={e => setFormData({ ...formData, emergencyNumber: e.target.value })} />
                      </div>
                    </div>
                  );
                }

                if (q.id === '7') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label || 'Please share anything that will help prepare for our meeting'} {q.required && <span className="req">*</span>}</label>
                      <textarea className="bp-textarea"
                        value={formData.notes}
                        onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                    </div>
                  );
                }

                if (q.id === '8') {
                  return (
                    <div className="bp-form-field checkbox-field-container" key={q.id}>
                      <p className="bp-terms-text">Please review the <a href="https://safestories.in/tnc" target="_blank" rel="noopener noreferrer" style={{ color: '#0d9488', textDecoration: 'none' }} onMouseOver={e => e.currentTarget.style.textDecoration = 'underline'} onMouseOut={e => e.currentTarget.style.textDecoration = 'none'}>Terms & Conditions</a> before completing your booking. <span className="req">*</span></p>
                      <div className="checkbox-field">
                        <label className="bp-checkbox-label">
                          <input type="checkbox" checked={formData.agreedTerms}
                            onChange={e => setFormData({ ...formData, agreedTerms: e.target.checked })} />
                          {q.label || 'I confirm that I have read and agree to the Terms & Conditions.'}
                        </label>
                      </div>
                    </div>
                  );
                }

                // Rendering Custom Questions dynamically
                if (q.type === 'text' || q.type === 'email') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label} {q.required && <span className="req">*</span>}</label>
                      <input 
                        type={q.type} 
                        className="bp-input" 
                        required={q.required}
                        value={customResponses[q.id] || ''}
                        onChange={e => setCustomResponses({ ...customResponses, [q.id]: e.target.value })}
                      />
                    </div>
                  );
                }

                if (q.type === 'textarea') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label} {q.required && <span className="req">*</span>}</label>
                      <textarea 
                        className="bp-textarea" 
                        required={q.required}
                        value={customResponses[q.id] || ''}
                        onChange={e => setCustomResponses({ ...customResponses, [q.id]: e.target.value })}
                      />
                    </div>
                  );
                }

                if (q.type === 'dropdown') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label} {q.required && <span className="req">*</span>}</label>
                      <select 
                        className="bp-input bg-white" 
                        required={q.required}
                        value={customResponses[q.id] || ''}
                        onChange={e => setCustomResponses({ ...customResponses, [q.id]: e.target.value })}
                      >
                        <option value="">Select Option</option>
                        {(q.options || '').split(',').map((opt: string) => {
                          const o = opt.trim();
                          return <option key={o} value={o}>{o}</option>;
                        })}
                      </select>
                    </div>
                  );
                }

                if (q.type === 'checkbox') {
                  return (
                    <div className="bp-form-field checkbox-field-container" key={q.id}>
                      <div className="checkbox-field">
                        <label className="bp-checkbox-label">
                          <input 
                            type="checkbox" 
                            required={q.required}
                            checked={!!customResponses[q.id]}
                            onChange={e => setCustomResponses({ ...customResponses, [q.id]: e.target.checked ? 'true' : '' })}
                          />
                          {q.label} {q.required && <span className="req">*</span>}
                        </label>
                      </div>
                    </div>
                  );
                }

                if (q.type === 'tel') {
                  return (
                    <div className="bp-form-field" key={q.id}>
                      <label>{q.label} {q.required && <span className="req">*</span>}</label>
                      <div className="bp-phone-input">
                        <select
                          className="bp-country-select"
                          value={customResponses[q.id + '_code'] || '+91'}
                          onChange={e => setCustomResponses({ ...customResponses, [q.id + '_code']: e.target.value })}
                        >
                          {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                        </select>
                        <input 
                          type="tel" 
                          className="bp-input" 
                          required={q.required}
                          value={customResponses[q.id] || ''}
                          onChange={e => setCustomResponses({ ...customResponses, [q.id]: e.target.value })}
                        />
                      </div>
                    </div>
                  );
                }

                return null;
              })}

              <div className="bp-reg-section">
                <h3 className="bp-section-title">Select Location</h3>
                <div className="bp-option-grid">
                  <div className={`bp-option-card ${formData.location === 'google_meet' ? 'active' : ''}`}
                    onClick={() => setFormData({ ...formData, location: 'google_meet' })}>
                    <div className="bp-option-header">
                      <div className="bp-option-icon meet">
                        <Video size={18} color="#00897b" /> <strong>Google Meet</strong>
                      </div>
                      {formData.location === 'google_meet' && <Check size={16} className="bp-check-icon" />}
                    </div>
                    <p className="bp-option-desc">Web conference using Google meet</p>
                  </div>
                  <div className={`bp-option-card ${formData.location === 'in_person' ? 'active' : ''}`}
                    onClick={() => setFormData({ ...formData, location: 'in_person' })}>
                    <div className="bp-option-header">
                      <div className="bp-option-icon">
                        <MapPin size={18} color="#21615D" /> <strong>In-person (SafeStories Office - Lullanagar, Pune, Maharashtra 411040)</strong>
                      </div>
                      {formData.location === 'in_person' && <Check size={16} className="bp-check-icon" />}
                    </div>
                  </div>
                </div>
              </div>

              {session.is_payment_enabled !== false && (
                <div className="bp-reg-section">
                  <h3 className="bp-section-title">Select Price</h3>
                  <div className="bp-option-card active">
                    <div className="bp-option-header">
                      {/* Exactly one figure: whatever this client will actually be
                          charged. The resolver already decides that — an existing
                          client gets their held rate, a new one gets the current
                          rate — so showing a struck-through list price alongside it,
                          or naming which rule applied, only invites the question of
                          why two numbers are on screen. */}
                      <div className="bp-option-icon">
                        <strong>₹{parseFloat((sessionCharges || session.charges).replace('₹', '') || '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                      </div>
                      <Check size={16} className="bp-check-icon" />
                    </div>
                    <p className="bp-option-desc">Session Charges</p>
                  </div>
                </div>
              )}

              {(isAdolescentSession) && (
                <div className="bp-add-guests">
                  <button className="bp-add-guests-btn" onClick={() => alert('Feature coming soon...')}>
                    <span>+</span> Add Guests
                  </button>
                </div>
              )}

              {bookingConflictMessage && (
                <div className="bp-conflict-banner">
                  <AlertCircle size={20} className="bp-conflict-icon" />
                  <span className="bp-conflict-text">{bookingConflictMessage}</span>
                </div>
              )}

              <div className="bp-reg-actions">
                <button
                  className="bp-pay-btn"
                  disabled={isSubmitting || !formData.agreedTerms || !formData.name || !formData.email || !formData.whatsapp || isBookingBlocked}
                  onClick={handleBookingSubmit}
                >
                  {isSubmitting ? (
                    <><div className="bp-spinner-small" /> Processing...</>
                  ) : (
                    <><CalendarCheck size={18} /> Confirm Booking</>
                  )}
                </button>
                <button className="bp-cancel-btn" onClick={() => setView('selection')}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Success Modal (fallback when no payment link) */}
        {showSuccessModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center transform animate-in zoom-in duration-300">
              <div className="flex justify-center mb-6">
                <div className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center">
                  <Lottie
                    animationData={sessionBookedAnimation}
                    loop={false}
                    style={{ width: 120, height: 120 }}
                  />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
              <p className="text-gray-600 mb-6 font-medium">
                Your session with {session.owner} has been successfully scheduled.
              </p>
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  if (redirectUrl) {
                    window.location.href = redirectUrl;
                  } else if (onBack) {
                    onBack();
                  } else {
                    window.location.reload();
                  }
                }}
                className="w-full bg-teal-700 text-white font-bold py-4 rounded-xl hover:bg-teal-800 transition-colors shadow-lg shadow-teal-700/20"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Payment Failed Modal */}
        {paymentFailed && !showSuccessModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
                <AlertCircle size={30} className="text-red-500" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Payment Incomplete</h2>
              <p className="text-gray-500 text-sm mb-1">
                Your slot is held for <strong>15 minutes</strong>. You can retry payment before it expires.
              </p>
              <p className="text-gray-400 text-xs mb-7">
                If your money was deducted, it will be automatically refunded within 5–7 business days.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setPaymentFailed(false);
                    setPendingBookingId(null);
                    handleBookingSubmit();
                  }}
                  className="flex-1 bg-teal-700 text-white font-semibold py-3 rounded-xl hover:bg-teal-800 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => {
                    setPaymentFailed(false);
                    setPendingBookingId(null);
                    setView('selection');
                  }}
                  className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Payment Redirect Screen */}
        {paymentLink && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] p-4">
            <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-2xl text-center">
              {/* Spinner */}
              <div className="flex justify-center mb-6">
                <div style={{
                  width: 56, height: 56,
                  border: '4px solid #e2e8f0',
                  borderTopColor: '#1a1a1a',
                  borderRadius: '50%',
                  animation: 'bp-spin 0.8s linear infinite'
                }} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Redirecting to Payment</h2>
              <p className="text-gray-500 text-sm mb-6">
                You will be redirected to the payment page in {countdown} seconds...
              </p>
              <button
                onClick={() => window.open(paymentLink, '_blank')}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <ExternalLink size={16} />
                Click here if you are not redirected automatically
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
