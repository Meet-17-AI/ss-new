import React, { useState, useEffect } from 'react';
import { X, Calendar, Plus } from 'lucide-react';

interface CreateBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateBookingModal: React.FC<CreateBookingModalProps> = ({ isOpen, onClose }) => {
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [clientWhatsApp, setClientWhatsApp] = useState('');
  const [selectedTherapy, setSelectedTherapy] = useState('');
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [isFreeConsultation, setIsFreeConsultation] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [sessionMode, setSessionMode] = useState<'online' | 'in-person' | ''>('');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [therapies, setTherapies] = useState<any[]>([]);
  const [therapists, setTherapists] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState(2700);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const dateInputRef = React.useRef<HTMLInputElement>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

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
    { code: '+222', country: 'Mauritania' },
    { code: '+223', country: 'Mali' },
    { code: '+224', country: 'Guinea' },
    { code: '+225', country: 'Ivory Coast' },
    { code: '+226', country: 'Burkina Faso' },
    { code: '+227', country: 'Niger' },
    { code: '+228', country: 'Togo' },
    { code: '+229', country: 'Benin' },
    { code: '+230', country: 'Mauritius' },
    { code: '+231', country: 'Liberia' },
    { code: '+232', country: 'Sierra Leone' },
    { code: '+233', country: 'Ghana' },
    { code: '+234', country: 'Nigeria' },
    { code: '+235', country: 'Chad' },
    { code: '+236', country: 'Central African Republic' },
    { code: '+237', country: 'Cameroon' },
    { code: '+238', country: 'Cape Verde' },
    { code: '+239', country: 'Sao Tome and Principe' },
    { code: '+240', country: 'Equatorial Guinea' },
    { code: '+241', country: 'Gabon' },
    { code: '+242', country: 'Republic of the Congo' },
    { code: '+243', country: 'Democratic Republic of the Congo' },
    { code: '+244', country: 'Angola' },
    { code: '+245', country: 'Guinea-Bissau' },
    { code: '+246', country: 'British Indian Ocean Territory' },
    { code: '+248', country: 'Seychelles' },
    { code: '+249', country: 'Sudan' },
    { code: '+250', country: 'Rwanda' },
    { code: '+251', country: 'Ethiopia' },
    { code: '+252', country: 'Somalia' },
    { code: '+253', country: 'Djibouti' },
    { code: '+254', country: 'Kenya' },
    { code: '+255', country: 'Tanzania' },
    { code: '+256', country: 'Uganda' },
    { code: '+257', country: 'Burundi' },
    { code: '+258', country: 'Mozambique' },
    { code: '+260', country: 'Zambia' },
    { code: '+261', country: 'Madagascar' },
    { code: '+262', country: 'Reunion' },
    { code: '+263', country: 'Zimbabwe' },
    { code: '+264', country: 'Namibia' },
    { code: '+265', country: 'Malawi' },
    { code: '+266', country: 'Lesotho' },
    { code: '+267', country: 'Botswana' },
    { code: '+268', country: 'Eswatini' },
    { code: '+269', country: 'Comoros' },
    { code: '+290', country: 'Saint Helena' },
    { code: '+291', country: 'Eritrea' },
    { code: '+297', country: 'Aruba' },
    { code: '+298', country: 'Faroe Islands' },
    { code: '+299', country: 'Greenland' },
    { code: '+350', country: 'Gibraltar' },
    { code: '+351', country: 'Portugal' },
    { code: '+352', country: 'Luxembourg' },
    { code: '+353', country: 'Ireland' },
    { code: '+354', country: 'Iceland' },
    { code: '+355', country: 'Albania' },
    { code: '+356', country: 'Malta' },
    { code: '+357', country: 'Cyprus' },
    { code: '+358', country: 'Finland' },
    { code: '+359', country: 'Bulgaria' },
    { code: '+370', country: 'Lithuania' },
    { code: '+371', country: 'Latvia' },
    { code: '+372', country: 'Estonia' },
    { code: '+373', country: 'Moldova' },
    { code: '+374', country: 'Armenia' },
    { code: '+375', country: 'Belarus' },
    { code: '+376', country: 'Andorra' },
    { code: '+377', country: 'Monaco' },
    { code: '+378', country: 'San Marino' },
    { code: '+380', country: 'Ukraine' },
    { code: '+381', country: 'Serbia' },
    { code: '+382', country: 'Montenegro' },
    { code: '+383', country: 'Kosovo' },
    { code: '+385', country: 'Croatia' },
    { code: '+386', country: 'Slovenia' },
    { code: '+387', country: 'Bosnia and Herzegovina' },
    { code: '+389', country: 'North Macedonia' },
    { code: '+420', country: 'Czech Republic' },
    { code: '+421', country: 'Slovakia' },
    { code: '+423', country: 'Liechtenstein' },
    { code: '+500', country: 'Falkland Islands' },
    { code: '+501', country: 'Belize' },
    { code: '+502', country: 'Guatemala' },
    { code: '+503', country: 'El Salvador' },
    { code: '+504', country: 'Honduras' },
    { code: '+505', country: 'Nicaragua' },
    { code: '+506', country: 'Costa Rica' },
    { code: '+507', country: 'Panama' },
    { code: '+508', country: 'Saint Pierre and Miquelon' },
    { code: '+509', country: 'Haiti' },
    { code: '+590', country: 'Guadeloupe' },
    { code: '+591', country: 'Bolivia' },
    { code: '+592', country: 'Guyana' },
    { code: '+593', country: 'Ecuador' },
    { code: '+594', country: 'French Guiana' },
    { code: '+595', country: 'Paraguay' },
    { code: '+596', country: 'Martinique' },
    { code: '+597', country: 'Suriname' },
    { code: '+598', country: 'Uruguay' },
    { code: '+599', country: 'Curacao' },
    { code: '+670', country: 'East Timor' },
    { code: '+672', country: 'Antarctica' },
    { code: '+673', country: 'Brunei' },
    { code: '+674', country: 'Nauru' },
    { code: '+675', country: 'Papua New Guinea' },
    { code: '+676', country: 'Tonga' },
    { code: '+677', country: 'Solomon Islands' },
    { code: '+678', country: 'Vanuatu' },
    { code: '+679', country: 'Fiji' },
    { code: '+680', country: 'Palau' },
    { code: '+681', country: 'Wallis and Futuna' },
    { code: '+682', country: 'Cook Islands' },
    { code: '+683', country: 'Niue' },
    { code: '+685', country: 'Samoa' },
    { code: '+686', country: 'Kiribati' },
    { code: '+687', country: 'New Caledonia' },
    { code: '+688', country: 'Tuvalu' },
    { code: '+689', country: 'French Polynesia' },
    { code: '+690', country: 'Tokelau' },
    { code: '+691', country: 'Micronesia' },
    { code: '+692', country: 'Marshall Islands' },
    { code: '+850', country: 'North Korea' },
    { code: '+852', country: 'Hong Kong' },
    { code: '+853', country: 'Macau' },
    { code: '+855', country: 'Cambodia' },
    { code: '+856', country: 'Laos' },
    { code: '+880', country: 'Bangladesh' },
    { code: '+886', country: 'Taiwan' },
    { code: '+960', country: 'Maldives' },
    { code: '+961', country: 'Lebanon' },
    { code: '+962', country: 'Jordan' },
    { code: '+963', country: 'Syria' },
    { code: '+964', country: 'Iraq' },
    { code: '+965', country: 'Kuwait' },
    { code: '+966', country: 'Saudi Arabia' },
    { code: '+967', country: 'Yemen' },
    { code: '+968', country: 'Oman' },
    { code: '+970', country: 'Palestine' },
    { code: '+971', country: 'UAE' },
    { code: '+972', country: 'Israel' },
    { code: '+973', country: 'Bahrain' },
    { code: '+974', country: 'Qatar' },
    { code: '+975', country: 'Bhutan' },
    { code: '+976', country: 'Mongolia' },
    { code: '+977', country: 'Nepal' },
    { code: '+992', country: 'Tajikistan' },
    { code: '+993', country: 'Turkmenistan' },
    { code: '+994', country: 'Azerbaijan' },
    { code: '+995', country: 'Georgia' },
    { code: '+996', country: 'Kyrgyzstan' },
    { code: '+998', country: 'Uzbekistan' },
  ];

  useEffect(() => {
    if (isOpen) {
      fetchTherapies();
      fetchTherapists();
    }
  }, [isOpen]);

  const fetchTherapies = async () => {
    try {
      const response = await fetch('/api/therapies');
      if (response.ok) {
        const data = await response.json();
        setTherapies(data);
      }
    } catch (error) {
      console.error('Error fetching therapies:', error);
    }
  };

  const fetchTherapists = async () => {
    try {
      // /api/therapists-dropdown has never existed on any backend — this call
      // 404'd, leaving the picker permanently empty. /api/therapists is the
      // real list. Not /api/therapists-admin: that one is superadmin-only, so
      // an ordinary admin would get a 403 and the same empty picker.
      const response = await fetch('/api/therapists');
      if (response.ok) {
        const data = await response.json();
        setTherapists(data);
      }
    } catch (error) {
      console.error('Error fetching therapists:', error);
    }
  };

  const handleDateClick = () => {
    if (isDatePickerOpen) {
      dateInputRef.current?.blur();
      setIsDatePickerOpen(false);
    } else {
      dateInputRef.current?.showPicker();
      setIsDatePickerOpen(true);
    }
  };

  const isFormValid = () => {
    const hasBasicInfo = clientName.trim() && clientEmail.trim() && clientWhatsApp.trim() && selectedDate;
    if (isFreeConsultation) {
      return hasBasicInfo;
    }
    return hasBasicInfo && selectedTherapy && selectedTherapist;
  };

  const handleCheckSlots = async () => {
    if (!isFormValid()) {
      return;
    }

    setIsLoadingSlots(true);
    
    const payload = {
      clientName,
      clientEmail,
      clientWhatsApp: `${countryCode}${clientWhatsApp}`,
      selectedTherapy: isFreeConsultation ? 'Free Consultation' : selectedTherapy,
      selectedTherapist: isFreeConsultation ? 'SafeStories' : selectedTherapist,
      selectedDate,
      sessionMode,
      isFreeConsultation,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
    
    try {
      const response = await fetch('/api/fetch-slots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      
      if (response.ok) {
        const data = await response.json();
        setAvailableSlots(data.slots || []);
      } else {
        console.error('Failed to fetch slots, status:', response.status);
        alert('Failed to fetch available slots. Please try again.');
      }
    } catch (error) {
      console.error('Error fetching slots:', error);
      alert('Error fetching slots. Please check your connection.');
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleSendPaymentLink = () => {
    // Handle payment link sending
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900">
              ←
            </button>
            <h2 className="text-2xl font-bold">Book a Session for Client</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        {/* Form Content */}
        <div className="p-8">
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Client Name */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Client Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter client name"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Client WhatsApp */}
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
                  type="tel"
                  placeholder="Enter client whatsapp number"
                  value={clientWhatsApp}
                  onChange={(e) => setClientWhatsApp(e.target.value)}
                  className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Client Email */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Client Email Address<span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                placeholder="Enter client email address"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <div className="mt-3">
              </div>
            </div>

            {/* Select Therapy & Therapist */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Select Therapy</label>
                <select
                  value={selectedTherapy}
                  onChange={(e) => setSelectedTherapy(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                  disabled={isFreeConsultation}
                >
                  <option value="">Select</option>
                  {therapies.map((therapy, index) => (
                    <option key={index} value={therapy.therapy_name}>
                      {therapy.therapy_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Select Therapist</label>
                <select
                  value={selectedTherapist}
                  onChange={(e) => setSelectedTherapist(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                  disabled={isFreeConsultation}
                >
                  <option value="">Select</option>
                  {therapists.map((therapist) => (
                    <option key={therapist.therapist_id} value={therapist.name}>
                      {therapist.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Date Selection & Available Slots */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium mb-2">Select Date</label>
              <div className="relative mb-4">
                <input
                  ref={dateInputRef}
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCheckSlots();
                }}
                disabled={!isFormValid() || isLoadingSlots}
                className="w-full bg-teal-700 text-white px-6 py-3 rounded-lg hover:bg-teal-800 flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400"
              >
                {isLoadingSlots ? 'Loading...' : 'Check Slots →'}
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-medium">Available Slots</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sessionMode === 'online'}
                      onChange={(e) => setSessionMode(e.target.checked ? 'online' : '')}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Online</span>
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
              </div>
              <div className="grid grid-cols-3 gap-3">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      selectedSlot === slot
                        ? 'bg-white border-2 border-teal-700 text-teal-700'
                        : 'bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Payment Section */}
          <div className="border-t pt-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg font-medium text-gray-600">Grand Total:</span>
              <span className="text-2xl font-bold">Rs. {grandTotal}/-</span>
            </div>
            <button
              onClick={handleSendPaymentLink}
              disabled={!selectedSlot}
              className="w-full bg-teal-700 text-white px-6 py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed disabled:hover:bg-gray-400"
            >
              Send Payment Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
