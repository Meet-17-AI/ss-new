import React, { useState, useEffect, useRef } from 'react';
import Lottie from 'lottie-react';
import toast from 'react-hot-toast';
import sessionBookedAnimation from '../session-booked.json';
import paymentSentAnimation from '../payment-sent.json';

interface CreateBookingProps {
  onBack: () => void;
}

export const CreateBooking: React.FC<CreateBookingProps> = ({ onBack }) => {
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientWhatsApp, setClientWhatsApp] = useState('');
  const [selectedTherapy, setSelectedTherapy] = useState('');
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [isFreeConsultation, setIsFreeConsultation] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [displayDate, setDisplayDate] = useState('');
  const [sessionMode, setSessionMode] = useState<'online' | 'in-person' | ''>('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [therapies, setTherapies] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);
  const [filteredTherapists, setFilteredTherapists] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [sessionCharges, setSessionCharges] = useState(0);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [availableModes, setAvailableModes] = useState<string[]>([]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [countryCode, setCountryCode] = useState('+91');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState('Asia/Kolkata');
  const [timezoneSearch, setTimezoneSearch] = useState('');
  const [isTimezoneDropdownOpen, setIsTimezoneDropdownOpen] = useState(false);
  const timezoneRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const dateContainerRef = useRef<HTMLDivElement>(null);
  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [filteredClients, setFilteredClients] = useState<any[]>([]);
  const [generatedPaymentLink, setGeneratedPaymentLink] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [autoFilledFields, setAutoFilledFields] = useState({
    therapy: false,
    therapist: false,
    mode: false,
  });
  const [clientBookingHistory, setClientBookingHistory] = useState<any>(null);
  const [allowedTherapies, setAllowedTherapies] = useState<string[]>([]);
  const [allowedTherapists, setAllowedTherapists] = useState<string[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [hasRestrictions, setHasRestrictions] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'link' | 'qr' | 'cash' | ''>('');
  const [customAmount, setCustomAmount] = useState<string>('');
  // Server-resolved price for the selected client + therapy: which rule won,
  // and what a new client would pay for comparison.
  const [priceInfo, setPriceInfo] = useState<{
    amount: number;
    list_amount: number;
    price_source: string;
    is_special_price: boolean;
  } | null>(null);
  // Set once the admin edits the amount, so a re-resolve does not overwrite it.
  const amountTouchedRef = useRef(false);
  // Mirror of priceInfo for use inside async callbacks. fetchAvailableSlots
  // would otherwise close over a stale value and treat a resolved price as
  // absent.
  const priceInfoRef = useRef<typeof priceInfo>(null);
  useEffect(() => { priceInfoRef.current = priceInfo; }, [priceInfo]);
  const [currency, setCurrency] = useState<string>('INR');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [clientType, setClientType] = useState<string>('Indian');

  // Guard against selecting a past date — the date picker's earliest allowed day is today.
  const todayStr = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();

  // Reduce a full therapy name (e.g. "Individual Therapy with Muskan Negi") to just its
  // type — "Individual" or "Adolescent" — for compact previews. Falls back to the raw name.
  const shortTherapyLabel = (raw?: string) => {
    if (!raw) return '';
    if (/adolescent/i.test(raw)) return 'Adolescent';
    if (/individual/i.test(raw)) return 'Individual';
    if (/couples?/i.test(raw)) return 'Couples';
    return raw.split(/\s+with\s+/i)[0].trim();
  };

  // Strip a trailing " with <therapist>" from a stored therapy name so the dropdown shows
  // just "Individual Therapy Session" instead of "…Session with Muskan Negi". The cleaned
  // value still resolves charges/slots (backend matches by substring ILIKE) and is
  // normalized to the canonical label on booking creation.
  const cleanTherapyName = (raw?: string) => {
    if (!raw) return '';
    return raw.split(/\s+with\s+/i)[0].trim();
  };

  // Resolve the session charge for a therapy+therapist pair straight from the services
  // list, so the Amount field can prefill immediately — before a date/slot is chosen.
  /**
   * Which therapy is being booked, as a service id.
   *
   * Replaces the old resolveCharge(), which read therapy_services.charges
   * directly and returned a number. That was a second, parallel pricing path:
   * it only ever saw the list price, so an admin booking for a grandfathered
   * client — or one on an admin-set rate — was quoted the wrong amount, and
   * that amount is what /api/admin/generate-payment-link bills. This resolves
   * the SERVICE only; the price comes from the server.
   */
  const resolveServiceId = (therapy: string, therapist: string): number | null => {
    if (!therapy || !therapist || services.length === 0) return null;
    const firstWord = therapist.trim().toLowerCase().split(/\s+/)[0];
    const therapyLc = cleanTherapyName(therapy).toLowerCase();
    const active = services.filter((s: any) => s.is_active !== false);
    let match = active.find((s: any) =>
      (s.therapist_name || '').toLowerCase().includes(firstWord) &&
      (s.title || '').toLowerCase().includes(therapyLc)
    );
    if (!match) match = active.find((s: any) => (s.therapist_name || '').toLowerCase().includes(firstWord));
    return match?.id ?? null;
  };

  // Suppresses the client dropdown from re-opening immediately after a selection,
  // so picking a client takes a single click.
  const suppressClientDropdownRef = useRef(false);

  const timezones = [
    { name: 'Asia/Kolkata', offset: 'GMT+5:30' },
    { name: 'America/New_York', offset: 'GMT-5:00' },
    { name: 'America/Chicago', offset: 'GMT-6:00' },
    { name: 'America/Denver', offset: 'GMT-7:00' },
    { name: 'America/Los_Angeles', offset: 'GMT-8:00' },
    { name: 'America/Anchorage', offset: 'GMT-9:00' },
    { name: 'Pacific/Honolulu', offset: 'GMT-10:00' },
    { name: 'Europe/London', offset: 'GMT+0:00' },
    { name: 'Europe/Paris', offset: 'GMT+1:00' },
    { name: 'Europe/Berlin', offset: 'GMT+1:00' },
    { name: 'Europe/Rome', offset: 'GMT+1:00' },
    { name: 'Europe/Madrid', offset: 'GMT+1:00' },
    { name: 'Europe/Amsterdam', offset: 'GMT+1:00' },
    { name: 'Europe/Brussels', offset: 'GMT+1:00' },
    { name: 'Europe/Vienna', offset: 'GMT+1:00' },
    { name: 'Europe/Stockholm', offset: 'GMT+1:00' },
    { name: 'Europe/Oslo', offset: 'GMT+1:00' },
    { name: 'Europe/Copenhagen', offset: 'GMT+1:00' },
    { name: 'Europe/Helsinki', offset: 'GMT+2:00' },
    { name: 'Europe/Warsaw', offset: 'GMT+1:00' },
    { name: 'Europe/Prague', offset: 'GMT+1:00' },
    { name: 'Europe/Budapest', offset: 'GMT+1:00' },
    { name: 'Europe/Athens', offset: 'GMT+2:00' },
    { name: 'Europe/Istanbul', offset: 'GMT+3:00' },
    { name: 'Europe/Moscow', offset: 'GMT+3:00' },
    { name: 'Asia/Dubai', offset: 'GMT+4:00' },
    { name: 'Asia/Karachi', offset: 'GMT+5:00' },
    { name: 'Asia/Dhaka', offset: 'GMT+6:00' },
    { name: 'Asia/Bangkok', offset: 'GMT+7:00' },
    { name: 'Asia/Singapore', offset: 'GMT+8:00' },
    { name: 'Asia/Hong_Kong', offset: 'GMT+8:00' },
    { name: 'Asia/Shanghai', offset: 'GMT+8:00' },
    { name: 'Asia/Tokyo', offset: 'GMT+9:00' },
    { name: 'Asia/Seoul', offset: 'GMT+9:00' },
    { name: 'Australia/Sydney', offset: 'GMT+11:00' },
    { name: 'Australia/Melbourne', offset: 'GMT+11:00' },
    { name: 'Australia/Brisbane', offset: 'GMT+10:00' },
    { name: 'Australia/Perth', offset: 'GMT+8:00' },
    { name: 'Pacific/Auckland', offset: 'GMT+13:00' },
    { name: 'Pacific/Fiji', offset: 'GMT+12:00' },
  ];

  const countryCodes = [
    { code: '+1', country: 'USA/Canada' },
    { code: '+7', country: 'Russia' },
    { code: '+20', country: 'Egypt' },
    { code: '+27', country: 'South Africa' },
    { code: '+30', country: 'Greece' },
    { code: '+31', country: 'Netherlands' },
    { code: '+32', country: 'Belgium' },
    { code: '+33', country: 'France' },
    { code: '+34', country: 'Spain' },
    { code: '+36', country: 'Hungary' },
    { code: '+39', country: 'Italy' },
    { code: '+40', country: 'Romania' },
    { code: '+41', country: 'Switzerland' },
    { code: '+43', country: 'Austria' },
    { code: '+44', country: 'UK' },
    { code: '+45', country: 'Denmark' },
    { code: '+46', country: 'Sweden' },
    { code: '+47', country: 'Norway' },
    { code: '+48', country: 'Poland' },
    { code: '+49', country: 'Germany' },
    { code: '+51', country: 'Peru' },
    { code: '+52', country: 'Mexico' },
    { code: '+53', country: 'Cuba' },
    { code: '+54', country: 'Argentina' },
    { code: '+55', country: 'Brazil' },
    { code: '+56', country: 'Chile' },
    { code: '+57', country: 'Colombia' },
    { code: '+58', country: 'Venezuela' },
    { code: '+60', country: 'Malaysia' },
    { code: '+61', country: 'Australia' },
    { code: '+62', country: 'Indonesia' },
    { code: '+63', country: 'Philippines' },
    { code: '+64', country: 'New Zealand' },
    { code: '+65', country: 'Singapore' },
    { code: '+66', country: 'Thailand' },
    { code: '+81', country: 'Japan' },
    { code: '+82', country: 'South Korea' },
    { code: '+84', country: 'Vietnam' },
    { code: '+86', country: 'China' },
    { code: '+90', country: 'Turkey' },
    { code: '+91', country: 'India' },
    { code: '+92', country: 'Pakistan' },
    { code: '+93', country: 'Afghanistan' },
    { code: '+94', country: 'Sri Lanka' },
    { code: '+95', country: 'Myanmar' },
    { code: '+98', country: 'Iran' },
    { code: '+212', country: 'Morocco' },
    { code: '+213', country: 'Algeria' },
    { code: '+216', country: 'Tunisia' },
    { code: '+218', country: 'Libya' },
    { code: '+220', country: 'Gambia' },
    { code: '+221', country: 'Senegal' },
    { code: '+234', country: 'Nigeria' },
    { code: '+254', country: 'Kenya' },
    { code: '+351', country: 'Portugal' },
    { code: '+353', country: 'Ireland' },
    { code: '+358', country: 'Finland' },
    { code: '+370', country: 'Lithuania' },
    { code: '+371', country: 'Latvia' },
    { code: '+372', country: 'Estonia' },
    { code: '+380', country: 'Ukraine' },
    { code: '+420', country: 'Czech Republic' },
    { code: '+421', country: 'Slovakia' },
    { code: '+852', country: 'Hong Kong' },
    { code: '+853', country: 'Macau' },
    { code: '+855', country: 'Cambodia' },
    { code: '+856', country: 'Laos' },
    { code: '+880', country: 'Bangladesh' },
    { code: '+886', country: 'Taiwan' },
    { code: '+960', country: 'Maldives' },
    { code: '+961', country: 'Lebanon' },
    { code: '+962', country: 'Jordan' },
    { code: '+965', country: 'Kuwait' },
    { code: '+966', country: 'Saudi Arabia' },
    { code: '+968', country: 'Oman' },
    { code: '+971', country: 'UAE' },
    { code: '+972', country: 'Israel' },
    { code: '+973', country: 'Bahrain' },
    { code: '+974', country: 'Qatar' },
    { code: '+975', country: 'Bhutan' },
    { code: '+977', country: 'Nepal' },
  ];

  useEffect(() => {
    fetchTherapies();
    fetchClients();
    fetchServices();

    const handleClickOutside = (event: MouseEvent) => {
      if (dateContainerRef.current && !dateContainerRef.current.contains(event.target as Node)) {
        dateInputRef.current?.blur();
        setIsPickerOpen(false);
      }
      if (timezoneRef.current && !timezoneRef.current.contains(event.target as Node)) {
        setIsTimezoneDropdownOpen(false);
        setTimezoneSearch('');
      }
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setShowClientDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // If the name just changed because a client was picked from the list, keep the
    // dropdown closed instead of re-filtering it open (avoids needing a second click).
    if (suppressClientDropdownRef.current) {
      suppressClientDropdownRef.current = false;
      setShowClientDropdown(false);
      return;
    }
    if (clientName.length > 0) {
      const filtered = clients.filter(client =>
        client.invitee_name?.toLowerCase().includes(clientName.toLowerCase()) ||
        client.invitee_phone?.includes(clientName) ||
        client.invitee_email?.toLowerCase().includes(clientName.toLowerCase())
      );
      setFilteredClients(filtered);
      setShowClientDropdown(filtered.length > 0);
    } else {
      setFilteredClients([]);
      setShowClientDropdown(false);
    }
  }, [clientName, clients]);

  const fetchTherapies = async () => {
    try {
      const response = await fetch('/api/therapies');
      if (response.ok) {
        const data = await response.json();
        const validTherapies = data.filter((t: any) => 
          t.therapy_name !== 'Platform Therapy' && 
          t.therapy_name !== 'Platform Calendar'
        );
        setTherapies(validTherapies);
      }
    } catch (error) {
      console.error('Error fetching therapies:', error);
    }
  };

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients');
      if (response.ok) {
        const data = await response.json();
        setClients(data);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
  };

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/services');
      if (response.ok) {
        const data = await response.json();
        setServices(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const handleExistingClientSelect = async (client: any) => {
    try {
      setIsLoadingHistory(true);
      // Pass phone/email — invitee_id is NULL on many bookings, so the server keys history
      // off these to reliably find a repeat client's past (non-cancelled) bookings.
      const params = new URLSearchParams();
      if (client.invitee_phone) params.set('phone', client.invitee_phone);
      if (client.invitee_email) params.set('email', client.invitee_email);
      const clientKey = encodeURIComponent(client.invitee_id || 'unknown');
      const response = await fetch(`/api/client-booking-history/${clientKey}?${params.toString()}`);
      const history = await response.json();

      setClientBookingHistory(history);

      // Restrict and auto-select based on the client's last booking history, unless it was a Free Consultation
      if (
        history.lastBooking && 
        history.lastBooking.therapy && 
        history.lastBooking.therapist &&
        history.lastBooking.therapy !== 'Free Consultation'
      ) {
        // Show the last booking's therapy and therapist (not changeable). Display the
        // therapy without the trailing "with <therapist>" — just "Individual Therapy Session".
        const cleanTherapy = cleanTherapyName(history.lastBooking.therapy);
        setAllowedTherapies([cleanTherapy]);
        setAllowedTherapists([history.lastBooking.therapist]);
        setHasRestrictions(true);

        // Auto-select from last booking
        setSelectedTherapy(cleanTherapy);
        setAutoFilledFields(prev => ({ ...prev, therapy: true }));

        setSelectedTherapist(history.lastBooking.therapist);
        setAutoFilledFields(prev => ({ ...prev, therapist: true }));

        const mode = history.lastBooking.mode?.toLowerCase().includes('online') ||
                     history.lastBooking.mode?.toLowerCase().includes('meet')
          ? 'online'
          : 'in-person';
        setSessionMode(mode);
        setAutoFilledFields(prev => ({ ...prev, mode: true }));
      } else {
        // Free consultation or no booking history - allow all selections
        setAllowedTherapies([]);
        setAllowedTherapists([]);
        setHasRestrictions(false);
      }

      setIsLoadingHistory(false);
    } catch (error) {
      console.error('Error fetching booking history:', error);
      setIsLoadingHistory(false);
      toast.error('Failed to load client history');
    }
  };

  const handleClientSelect = (client: any) => {
    suppressClientDropdownRef.current = true;
    setClientName(client.invitee_name);
    setSelectedClientId(client.invitee_id || client.id);
    setIsNewClient(false);

    const phone = client.invitee_phone || '';
    if (phone.startsWith('+')) {
      const code = countryCodes.find(c => phone.startsWith(c.code));
      if (code) {
        setCountryCode(code.code);
        setClientWhatsApp(phone.substring(code.code.length));
      } else {
        setClientWhatsApp(phone);
      }
    } else {
      setClientWhatsApp(phone);
    }
    setClientEmail(client.invitee_email || '');

    // Reset dropdowns before loading history
    setSelectedTherapy('');
    setSelectedTherapist('');
    setSessionMode('');
    setAutoFilledFields({ therapy: false, therapist: false, mode: false });

    // Fetch and restrict to client's booking history
    handleExistingClientSelect(client);

    setShowClientDropdown(false);
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateValue = e.target.value;
    setSelectedDate(dateValue);
    
    if (dateValue) {
      const [year, month, day] = dateValue.split('-');
      setDisplayDate(`${day}/${month}/${year}`);
    } else {
      setDisplayDate('');
    }
    
    e.target.blur();
    setIsPickerOpen(false);
  };

  const handleCalendarIconClick = () => {
    if (isPickerOpen) {
      dateInputRef.current?.blur();
      setIsPickerOpen(false);
    } else {
      dateInputRef.current?.showPicker();
      setIsPickerOpen(true);
    }
  };

  const fetchTherapistsByTherapy = async (therapyName: string) => {
    try {
      const response = await fetch(`/api/therapists-by-therapy?therapy_name=${encodeURIComponent(therapyName)}`);
      if (response.ok) {
        const data = await response.json();
        const validTherapists = data.filter((t: any) => t.therapist_name !== 'Platform Calendar');
        setFilteredTherapists(validTherapists);
      }
    } catch (error) {
      console.error('Error fetching therapists by therapy:', error);
    }
  };

  const handleTherapyChange = (therapy: string) => {
    setSelectedTherapy(therapy);
    setSelectedTherapist('');
    if (therapy) {
      fetchTherapistsByTherapy(therapy);
    } else {
      setFilteredTherapists([]);
    }
  };

  const isFormValid = () => {
    // Client selection is mandatory first
    if (!clientName.trim()) {
      return false;
    }
    const hasDate = selectedDate.trim();
    const hasTimezone = selectedTimezone.trim();
    if (isFreeConsultation) {
      return hasDate && hasTimezone;
    }
    return hasDate && hasTimezone && selectedTherapy && selectedTherapist;
  };

  useEffect(() => {
    if (selectedDate && selectedTimezone) {
      if (isFreeConsultation || (selectedTherapy && selectedTherapist)) {
        fetchAvailableSlots();
      }
    }
  }, [selectedTherapy, selectedTherapist, selectedDate, isFreeConsultation]);

  // Prefill the Amount immediately when a therapy + therapist are chosen (or a client is
  // selected, which auto-fills both) — without waiting for a date/slot fetch.
  const selectedServiceId = resolveServiceId(selectedTherapy, selectedTherapist);

  // Reset the "admin typed their own figure" guard whenever the inputs that
  // determine the price change. Picking a different therapy or a different
  // client should re-quote; simply re-rendering should not discard an edit.
  useEffect(() => {
    amountTouchedRef.current = false;
  }, [selectedServiceId, clientEmail, clientWhatsApp]);

  // Auto-fetch the price FOR THIS CLIENT.
  //
  // Runs on the client's email/phone as well as the therapy, so an existing
  // client's grandfathered rate and any admin-set per-client price reach this
  // form — the same figures the public booking page and Razorpay use. The
  // amount stays editable: a concession or package rate is a legitimate reason
  // for an admin to depart from it, and /api/admin/generate-payment-link
  // treats their figure as authoritative.
  useEffect(() => {
    if (isFreeConsultation || !selectedServiceId) {
      setPriceInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/public/resolve-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: selectedServiceId,
            email: clientEmail,
            phone: clientWhatsApp ? `${countryCode}${clientWhatsApp}` : '',
          }),
        });
        if (!res.ok) return;
        const p = await res.json();
        if (!p?.success) return;
        setPriceInfo(p);
        setSessionCharges(p.amount);
        if (!amountTouchedRef.current) setCustomAmount(String(p.amount));
      } catch (err) {
        console.error('Error resolving price:', err);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedServiceId, clientEmail, clientWhatsApp, countryCode, isFreeConsultation]);

  const fetchAvailableSlots = async () => {
    setIsLoadingSlots(true);
    
    const payload = {
      selectedTherapy: isFreeConsultation ? 'Free Consultation' : selectedTherapy,
      selectedTherapist: isFreeConsultation ? 'SafeStories' : selectedTherapist,
      selectedDate,
      isFreeConsultation,
      timezone: selectedTimezone,
      // Kept for payload compatibility only — /api/fetch-slots does not read this field.
      isDirectBooking: paymentMode !== 'link',
      isAdmin: true
    };
    
    try {
      const response = await fetch('/api/fetch-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data && data.length > 0) {
          const availableSlots = data[0]['Available Slots'] || [];
          // Always read charges from the response, even if no slots are available for this date
          const charges = data[0]['session charges'] || 0;
          const modeString = data[0]['mode'] || '';

          // Fallback only. This quote carries no client identity, so it is the
          // LIST price — applying it unconditionally would overwrite a
          // grandfathered or custom rate that the resolve effect had already
          // filled in, and would discard an amount the admin typed.
          if (charges > 0 && !priceInfoRef.current && !amountTouchedRef.current) {
            setSessionCharges(charges);
            setCustomAmount(charges.toString());
          }
          
          const modes: string[] = [];
          try {
            if (modeString && !modeString.startsWith('[') && !modeString.startsWith('{')) {
              if (modeString.includes('google_meet')) modes.push('online');
              if (modeString.includes('physical')) modes.push('in-person');
            } else {
              const decodedMode = modeString
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
              
              const parsedModes = JSON.parse(decodedMode);
              parsedModes.forEach((mode: any) => {
                if (mode.type === 'google_meet') modes.push('online');
                if (mode.type === 'physical') modes.push('in-person');
              });
            }
          } catch (e) {
            if (modeString.includes('google_meet')) modes.push('online');
            if (modeString.includes('physical')) modes.push('in-person');
          }
          
          // If the service didn't declare any modes, allow the admin to pick either one
          // rather than locking both radios.
          const effectiveModes = modes.length > 0 ? modes : ['online', 'in-person'];
          setAvailableModes(effectiveModes);

          // Respect a mode already chosen from the client's history or by the admin —
          // the admin can always switch it. Only auto-select when nothing is chosen yet.
          setSessionMode(prevMode => {
            if (prevMode) return prevMode;
            if (effectiveModes.length === 1) return effectiveModes[0] as 'online' | 'in-person';
            return '';
          });
          
          if (availableSlots.length > 0) {
            const formattedSlots = availableSlots.map((slot: string) => {
              const date = new Date(slot);
              return date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: true,
                timeZone: 'Asia/Kolkata' 
              });
            });
            setAvailableSlots(formattedSlots);
          } else {
            setAvailableSlots([]);
          }
        } else {
          setAvailableSlots([]);
          setSessionCharges(0);
          setAvailableModes([]);
        }
      } else {
        setAvailableSlots([]);
        setSessionCharges(0);
        setCustomAmount('0');
        setAvailableModes([]);
        setScreenshotFile(null);
      }
    } catch (error) {
      console.error('Error:', error);
      setAvailableSlots([]);
      setSessionCharges(0);
      setCustomAmount('0');
      setAvailableModes([]);
      setScreenshotFile(null);
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleSendPaymentLink = async () => {
    if (isSubmitting) return;
    // Require an explicit session-mode choice when more than one mode is available
    if (!isFreeConsultation && availableModes.length > 1 && !sessionMode) {
      toast.error('Please select a session mode (Google Meet or In-person)');
      return;
    }
    setIsSubmitting(true);
    
    // Check if we should generate a payment link
    if (!isFreeConsultation && paymentMode === 'link') {
      const linkPayload = {
        therapistName: selectedTherapist,
        clientName,
        clientEmail,
        clientPhone: `${countryCode}${clientWhatsApp}`,
        date: selectedDate,
        time: selectedSlot,
        serviceType: selectedTherapy,
        amount: Number(customAmount) || sessionCharges,
        clientType,
        sessionMode,
        timezone: selectedTimezone,
        isAdmin: true
      };

      try {
        const response = await fetch('/api/admin/generate-payment-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(linkPayload)
        });

        if (response.ok) {
          const data = await response.json();
          setGeneratedPaymentLink(data.paymentLink);
          setShowSuccessModal(true);
        } else {
          const errData = await response.json().catch(() => ({}));
          toast.error(errData.error || 'Failed to generate payment link');
        }
      } catch (err) {
        toast.error('Error generating link');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    let uploadedScreenshotUrl = null;
    if (screenshotFile) {
      try {
        const formData = new FormData();
        formData.append('file', screenshotFile);
        
        const uploadRes = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });
        
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.fileUrl) {
            uploadedScreenshotUrl = uploadData.fileUrl;
          }
        }
      } catch (err) {
        console.error('Failed to upload screenshot:', err);
        // Continue with booking even if screenshot upload fails, as it's optional
      }
    }

    const payload = {
      therapyName: isFreeConsultation ? 'Free Consultation' : selectedTherapy,
      therapistName: isFreeConsultation ? 'SafeStories' : selectedTherapist,
      isFreeConsultation,
      date: selectedDate,
      slot: selectedSlot,
      clientName,
      clientEmail,
      clientWhatsApp: `${countryCode}${clientWhatsApp}`,
      sessionMode,
      timezone: selectedTimezone,
      skipPayment: true,
      isAdmin: true,
      paymentMode: !isFreeConsultation ? paymentMode : null,
      amount: !isFreeConsultation ? (Number(customAmount) || sessionCharges) : 0,
      currency: !isFreeConsultation ? currency : 'INR',
      paymentScreenshot: uploadedScreenshotUrl,
      clientType
    };
    
    try {
      const webhookUrl = '/api/create-booking';
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (response.ok) {
        setGeneratedPaymentLink(''); // clear just in case
        setShowSuccessModal(true);
      } else if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error || 'This time slot is no longer available. Please choose another slot.');
      } else {
        toast.error('Failed to create booking');
      }
    } catch (error) {
      console.error('Error creating booking:', error);
      alert('Error creating booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPaymentLinkEnabled = () => {
    const isTherapistSelected = isFreeConsultation || selectedTherapist;
    const baseValid = isTherapistSelected && selectedSlot && clientName.trim() && clientEmail.trim() && clientWhatsApp.trim();
    if (!isFreeConsultation) {
      return baseValid && paymentMode !== '' && customAmount.trim() !== '';
    }
    return baseValid;
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md mx-4 shadow-xl">
            <div className="flex justify-center mb-4">
              <Lottie 
                animationData={grandTotal === 0 ? sessionBookedAnimation : paymentSentAnimation}
                loop={true}
                style={{ width: 200, height: 200 }}
              />
            </div>
            {/* Success modal title */}
            <h2 className="text-xl font-bold mb-4 text-gray-800 text-center">
              {generatedPaymentLink ? 'Payment Link Generated' : 'Session Booked'}
            </h2>
            <div className="text-gray-600 mb-6 text-center">
              {generatedPaymentLink ? (
                <>
                  <p className="mb-4">
                    The calendar slot has been blocked for 30 minutes. Please copy and share this payment link with the client:
                  </p>
                  <div className="flex items-center gap-2 mb-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={generatedPaymentLink} 
                      className="w-full bg-gray-100 p-3 rounded-lg text-sm border focus:outline-teal-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedPaymentLink);
                      toast.success('Link copied to clipboard!');
                    }}
                    className="text-teal-700 font-medium text-sm hover:underline"
                  >
                    Copy Link
                  </button>
                  <p className="mt-4 text-xs text-red-500 font-medium">
                    If payment is not received within 30 minutes, the slot will become available again automatically.
                  </p>
                </>
              ) : (
                <p>The session has been created successfully. The client will receive a confirmation via WhatsApp.</p>
              )}
            </div>
            <button
              onClick={onBack}
              className="w-full bg-teal-700 text-white px-6 py-3 rounded-lg hover:bg-teal-800 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="text-2xl text-gray-600 hover:text-gray-900">
          ←
        </button>
        <h1 className="text-3xl font-bold">New Session</h1>
      </div>

      {/* Form Content */}
      <div className="grid grid-cols-[2fr_1fr] gap-8 max-w-7xl">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Therapy and Therapist Row */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Select Therapy</label>
              <div className="relative">
                <select
                  value={selectedTherapy}
                  onChange={(e) => handleTherapyChange(e.target.value)}
                  disabled={isFreeConsultation || isLoadingHistory}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-10"
                >
                  <option value="">
                    {isLoadingHistory ? 'Loading...' : 'Select'}
                  </option>
                  {hasRestrictions && allowedTherapies.length > 0 ? (
                    allowedTherapies.map((therapy, index) => (
                      <option key={index} value={therapy}>
                        {therapy}
                      </option>
                    ))
                  ) : !isLoadingHistory && !clientBookingHistory ? (
                    therapies.map((therapy, index) => (
                      <option key={index} value={therapy.therapy_name}>
                        {therapy.therapy_name}
                      </option>
                    ))
                  ) : isLoadingHistory ? (
                    <option disabled>Loading...</option>
                  ) : (
                    therapies.map((therapy, index) => (
                      <option key={index} value={therapy.therapy_name}>
                        {therapy.therapy_name}
                      </option>
                    ))
                  )}
                </select>
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                  ▼
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Select Therapist</label>
              <div className="relative">
                <select
                  value={selectedTherapist}
                  onChange={(e) => setSelectedTherapist(e.target.value)}
                  disabled={isFreeConsultation || isLoadingHistory}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-10"
                >
                  <option value="">
                    {isLoadingHistory ? 'Loading...' : 'Select'}
                  </option>
                  {hasRestrictions && allowedTherapists.length > 0 ? (
                    allowedTherapists.map((therapist, index) => (
                      <option key={index} value={therapist}>
                        {therapist}
                      </option>
                    ))
                  ) : !isLoadingHistory && !clientBookingHistory ? (
                    filteredTherapists.map((therapist) => (
                      <option key={therapist.therapist_id} value={therapist.therapist_name}>
                        {therapist.therapist_name}
                      </option>
                    ))
                  ) : isLoadingHistory ? (
                    <option disabled>Loading...</option>
                  ) : (
                    filteredTherapists.map((therapist) => (
                      <option key={therapist.therapist_id} value={therapist.therapist_name}>
                        {therapist.therapist_name}
                      </option>
                    ))
                  )}
                </select>
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                  ▼
                </div>
              </div>
            </div>
          </div>

          {/* Date Selection */}
          <div ref={dateContainerRef}>
            <label className="block text-sm font-medium mb-2">Select Date</label>
            <div className="relative">
              <input
                ref={dateInputRef}
                type="date"
                value={selectedDate}
                min={todayStr}
                onChange={handleDateChange}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white pr-12"
              />
              <button
                type="button"
                onClick={handleCalendarIconClick}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 text-xl"
              >
                📅
              </button>
            </div>
          </div>

          {/* Client Details */}
          <div className="flex gap-4 mb-6 relative">
            <div className="w-1/3">
              <label className="block text-sm font-medium mb-2">
                Client Type
              </label>
              <div className="relative">
                <select
                  value={clientType}
                  onChange={(e) => setClientType(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white pr-8"
                >
                  <option value="Indian">Indian</option>
                  <option value="NRI">NRI</option>
                </select>
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                  ▼
                </div>
              </div>
            </div>
            
            <div className="w-2/3" ref={clientDropdownRef}>
              <label className="block text-sm font-medium mb-2">
                Client Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter client name"
                value={clientName}
                onChange={(e) => {
                  const newName = e.target.value;
                  setClientName(newName);

                  if (newName === '') {
                    setClientWhatsApp('');
                    setClientEmail('');
                    setCountryCode('+91');
                    // Reset booking history for cleared input
                    setClientBookingHistory(null);
                    setAllowedTherapies([]);
                    setAllowedTherapists([]);
                    setSelectedTherapy('');
                    setSelectedTherapist('');
                    setSessionMode('');
                    setAutoFilledFields({ therapy: false, therapist: false, mode: false });
                  } else {
                    // Check if typed name matches any existing client
                    const matchingClient = clients.find(c =>
                      c.invitee_name.toLowerCase() === newName.toLowerCase()
                    );
                    // If no match, reset booking history (new client flow)
                    if (!matchingClient) {
                      setClientBookingHistory(null);
                      setAllowedTherapies([]);
                      setAllowedTherapists([]);
                      setSelectedTherapy('');
                      setSelectedTherapist('');
                      setSessionMode('');
                      setAutoFilledFields({ therapy: false, therapist: false, mode: false });
                    }
                  }
                }}
                onFocus={() => clientName.length > 0 && filteredClients.length > 0 && setShowClientDropdown(true)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              />
              {showClientDropdown && filteredClients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredClients.map((client, index) => (
                    <div
                      key={index}
                      onClick={() => handleClientSelect(client)}
                      className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                    >
                      <div className="font-semibold text-gray-900">{client.invitee_name}</div>
                      <div className="text-sm text-gray-600">{client.invitee_phone}</div>
                      {client.invitee_email && (
                        <div className="text-xs text-gray-500">{client.invitee_email}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Client Booking History Info */}
            {clientBookingHistory && (
              <div className="col-span-2 rounded-lg p-3 text-sm" style={{ backgroundColor: '#21615D', borderColor: '#21615D' }}>
                <div className="font-semibold text-white">
                  ✓ {clientBookingHistory.clientName} {clientBookingHistory.lastBooking ? `previously booked ${shortTherapyLabel(clientBookingHistory.lastBooking.therapy)}` : `has ${clientBookingHistory.totalBookings} booking(s)`}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-2">
                Client Email Address<span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                placeholder="Enter client email address"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              />
            </div>
          </div>

          {/* WhatsApp Number */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Client WhatsApp No.<span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-32 px-2 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm"
              >
                {countryCodes.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} {item.country}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Enter client whatsapp number"
                value={clientWhatsApp}
                onChange={(e) => setClientWhatsApp(e.target.value)}
                className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              />
            </div>
          </div>

          {/* Session Mode */}
          <div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sessionMode === 'online'}
                  onChange={(e) => setSessionMode(e.target.checked ? 'online' : '')}
                  className="w-4 h-4"
                />
                <span className="text-sm">Google Meet</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sessionMode === 'in-person'}
                  onChange={(e) => setSessionMode(e.target.checked ? 'in-person' : '')}
                  className="w-4 h-4"
                />
                <span className="text-sm">In-person</span>
              </label>
            </div>
            
            {/* Warning if mode is different from history */}
            {clientBookingHistory?.lastBooking?.mode && sessionMode && (() => {
              const historyMode = clientBookingHistory.lastBooking.mode.toLowerCase().includes('online') || clientBookingHistory.lastBooking.mode.toLowerCase().includes('meet') ? 'online' : 'in-person';
              if (sessionMode !== historyMode) {
                return (
                  <div className="mt-3 p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-800 flex items-start gap-2">
                    <span className="text-orange-500 font-bold">⚠️</span>
                    <div>
                      <span className="font-semibold">Notice:</span> {clientBookingHistory.clientName} previously booked <strong>{historyMode === 'online' ? 'Google Meet' : 'In-person'}</strong> sessions. Are you sure you want to change the mode to <strong>{sessionMode === 'online' ? 'Google Meet' : 'In-person'}</strong>?
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {/* Grand Total and Payment */}
          <div className="pt-6 border-t">
            {!isFreeConsultation && (
              <div className="flex flex-col gap-6 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Payment Method<span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value as any)}
                        className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white pr-10"
                      >
                        <option value="">Select Payment Method</option>
                        <option value="cash">Cash (Paid)</option>
                        <option value="qr">QR (Paid)</option>
                        <option value="link">Send Payment Link</option>
                      </select>
                      <div className="absolute right-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                        ▼
                      </div>
                    </div>
                    {paymentMode === 'link' && (
                      <p className="text-xs text-gray-500 mt-2">
                        The slot is held until payment completes, and released automatically if the link expires (30 minutes).
                      </p>
                    )}
                  </div>
                  <div className="flex gap-4">
                    <div className="w-1/3">
                      <label className="block text-sm font-medium mb-2">
                        Currency
                      </label>
                      {/* Locked to INR: the Razorpay account settles in INR, and the payment-link
                          flow bills in INR regardless of what is chosen here. */}
                      <input
                        type="text"
                        value="₹ INR"
                        readOnly
                        disabled
                        className="w-full px-4 py-3 border rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    <div className="w-2/3">
                      <label className="block text-sm font-medium mb-2">
                        Amount<span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={customAmount}
                        onChange={(e) => {
                          // Marks the figure as the admin's own, so a later
                          // re-resolve leaves it alone.
                          amountTouchedRef.current = true;
                          setCustomAmount(e.target.value);
                        }}
                        placeholder={sessionCharges > 0 ? `e.g. ${sessionCharges}` : "Enter amount"}
                        className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                      />
                      {/* Say where the auto-filled figure came from, so an admin
                          can tell a protected rate from a plain list price
                          before overriding it. */}
                      {priceInfo && (
                        <p className="text-xs mt-1.5">
                          {priceInfo.price_source === 'lock' ? (
                            <span className="text-teal-700 font-medium">
                              Existing client rate ₹{priceInfo.amount.toLocaleString('en-IN')}
                              {priceInfo.is_special_price && (
                                <span className="text-gray-400 font-normal"> · list ₹{priceInfo.list_amount.toLocaleString('en-IN')}</span>
                              )}
                            </span>
                          ) : priceInfo.price_source === 'override' ? (
                            <span className="text-purple-700 font-medium">
                              Custom price set for this client ₹{priceInfo.amount.toLocaleString('en-IN')}
                              <span className="text-gray-400 font-normal"> · list ₹{priceInfo.list_amount.toLocaleString('en-IN')}</span>
                            </span>
                          ) : (
                            <span className="text-gray-400">
                              Current price ₹{priceInfo.amount.toLocaleString('en-IN')}
                              {!clientEmail && ' · enter the client to check for a protected or custom rate'}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {paymentMode === 'qr' && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Upload Payment screenshot here <span className="text-gray-400 text-xs">(Optional)</span>
                    </label>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setScreenshotFile(e.target.files?.[0] || null)}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                    />
                  </div>
                )}
              </div>
            )}
            
            <button
              onClick={handleSendPaymentLink}
              disabled={!isPaymentLinkEnabled() || isSubmitting}
              className="w-full bg-teal-700 text-white px-6 py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? 'Processing...'
                : (!isFreeConsultation
                    ? (paymentMode === 'link' ? 'Send Payment Link' : (paymentMode ? 'Create Booking' : 'Select Payment Mode'))
                    : 'Create Booking'
                  )
              }
            </button>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Free Consultation hidden/removed */}          {/* Available Slots */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Available Slots</label>
              <div className="px-3 py-1.5 border rounded-lg bg-gray-50 text-sm text-gray-700">
                Asia/Kolkata - GMT+5:30
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm max-h-[400px] overflow-y-auto">
              {isLoadingSlots ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-teal-700 border-t-transparent rounded-full animate-spin mb-3"></div>
                  <p className="text-gray-500 text-sm">Loading slots...</p>
                </div>
              ) : availableSlots.length > 0 ? (
                <div className="space-y-3">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      onClick={() => {
                        setSelectedSlot(selectedSlot === slot ? '' : slot);
                        setGrandTotal(selectedSlot === slot ? 0 : sessionCharges);
                      }}
                      className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                        selectedSlot === slot
                          ? 'bg-white border-2 border-teal-700 text-teal-700'
                          : 'text-gray-700 hover:opacity-80'
                      }`}
                      style={selectedSlot !== slot ? { backgroundColor: '#2D75792E' } : {}}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No slots available
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
