import React, { useState, useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';
import { Toast } from './Toast';

interface SendBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefilledClient?: {
    name: string;
    phone: string;
    email: string;
  };
}

interface Therapy {
  therapy_name: string;
}

interface Therapist {
  name: string;
  specialization: string;
}

export const SendBookingModal: React.FC<SendBookingModalProps> = ({ isOpen, onClose, prefilledClient }) => {
  const [clientName, setClientName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [clientWhatsapp, setClientWhatsapp] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [therapyType, setTherapyType] = useState('');
  const [therapistName, setTherapistName] = useState('');
  const [therapies, setTherapies] = useState<Therapy[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFreeConsultation, setIsFreeConsultation] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [filteredClients, setFilteredClients] = useState<any[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      fetchClients();
    }
  }, [isOpen]);

  // Prefill client data when provided
  useEffect(() => {
    if (prefilledClient && isOpen) {
      setClientName(prefilledClient.name);
      setClientEmail(prefilledClient.email);
      
      // Parse phone number to extract country code
      const phone = prefilledClient.phone || '';
      if (phone.startsWith('+')) {
        const code = countryCodes.find(c => phone.startsWith(c.code));
        if (code) {
          setCountryCode(code.code);
          setClientWhatsapp(phone.substring(code.code.length).trim());
        } else {
          setClientWhatsapp(phone);
        }
      } else {
        setClientWhatsapp(phone);
      }
    }
  }, [prefilledClient, isOpen]);

  useEffect(() => {
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

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowClientDropdown(false);
      }
    };

    if (showClientDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showClientDropdown]);

  // Filter therapists based on selected therapy
  const filteredTherapists = therapyType
    ? therapists.filter(therapist => 
        therapist.specialization?.toLowerCase().includes(therapyType.toLowerCase())
      )
    : therapists;

  const fetchTherapies = async () => {
    try {
      const response = await fetch('/api/therapies');
      const data = await response.json();
      setTherapies(data);
    } catch (error) {
      console.error('Error fetching therapies:', error);
    }
  };

  const fetchTherapists = async () => {
    try {
      const response = await fetch('/api/therapists');
      const data = await response.json();
      // Map the response to match Therapist interface
      const mappedTherapists = data.map((therapist: any) => ({
        name: therapist.full_name || therapist.name,
        specialization: therapist.specialization || therapist.specializations?.join(', ') || ''
      }));
      setTherapists(mappedTherapists);
    } catch (error) {
      console.error('Error fetching therapists:', error);
    }
  };

  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients');
      const data = await response.json();
      setClients(data);
    } catch (error) {
      console.error('Error fetching clients:', error);
    }
  };

  const handleClientSelect = (client: any) => {
    setClientName(client.invitee_name);
    const phone = client.invitee_phone || '';
    if (phone.startsWith('+')) {
      const code = countryCodes.find(c => phone.startsWith(c.code));
      if (code) {
        setCountryCode(code.code);
        setClientWhatsapp(phone.substring(code.code.length).trim());
      } else {
        setClientWhatsapp(phone);
      }
    } else {
      setClientWhatsapp(phone);
    }
    setClientEmail(client.invitee_email || '');
    
    // Autofill therapist - find full therapist name from booking_host_name
    if (client.booking_host_name && therapists.length > 0) {
      const clientTherapistName = client.booking_host_name.toLowerCase().trim();
      const matchingTherapist = therapists.find(t => {
        const therapistName = t.name.toLowerCase().trim();
        const therapistFirstName = t.name.split(' ')[0].toLowerCase().trim();
        return therapistName.includes(clientTherapistName) || 
               clientTherapistName.includes(therapistFirstName) ||
               clientTherapistName.includes(therapistName);
      });
      
      if (matchingTherapist) {
        setTherapistName(matchingTherapist.name);
        if (matchingTherapist.specialization) {
          const specs = matchingTherapist.specialization.split(',').map((s: string) => s.trim());
          if (specs.length > 0) {
            setTherapyType(specs[0]);
          }
        }
      }
    }
    
    setShowClientDropdown(false);
    setFilteredClients([]);
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowConfirmModal(true);
  };

  const confirmSend = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/send-booking-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          email: clientEmail,
          phone: `${countryCode}${clientWhatsapp}`,
          therapistName,
          therapy: therapyType
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.warning) {
          setToast({ message: `${result.message} (${result.warning})`, type: 'success' });
        } else {
          setToast({ message: 'Booking link sent to client successfully!', type: 'success' });
        }
        setClientName('');
        setClientWhatsapp('');
        setClientEmail('');
        setTherapyType('');
        setTherapistName('');
        setTimeout(() => {
          setShowConfirmModal(false);
          onClose();
        }, 2000);
      } else {
        setToast({ message: 'Failed to send booking link', type: 'error' });
        setShowConfirmModal(false);
      }
    } catch (error) {
      console.error('Error:', error);
      setToast({ message: 'An error occurred', type: 'error' });
      setShowConfirmModal(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 w-full max-w-xl relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Send size={24} />
            <h2 className="text-2xl font-bold">Send booking link</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Client Name */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-sm font-semibold mb-2">
                Client Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter client name"
                value={clientName}
                onChange={(e) => {
                  setClientName(e.target.value);
                  if (e.target.value === '') {
                    setClientWhatsapp('');
                    setClientEmail('');
                    setTherapyType('');
                    setTherapistName('');
                    setCountryCode('+91');
                  }
                }}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
              {showClientDropdown && filteredClients.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {filteredClients.map((client, index) => (
                    <div
                      key={index}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleClientSelect(client);
                      }}
                      className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                    >
                      <div className="font-semibold text-gray-900">{client.invitee_name}</div>
                      <div className="text-sm text-gray-600">{client.invitee_phone}</div>
                      {client.invitee_email && (
                        <div className="text-xs text-gray-500">{client.invitee_email}</div>
                      )}
                    </div>
                  ))}
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setShowClientDropdown(false);
                      setFilteredClients([]);
                    }}
                    className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-t font-medium text-center"
                    style={{ backgroundColor: '#21615D', color: 'white' }}
                  >
                    + New client
                  </div>
                </div>
              )}
            </div>

            {/* Client WhatsApp No */}
            <div>
              <label className="block text-sm font-semibold mb-2">
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
                  value={clientWhatsapp}
                  onChange={(e) => setClientWhatsapp(e.target.value)}
                  className="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>
            </div>

            {/* Client Email Address */}
            <div>
              <label className="block text-sm font-semibold mb-2">
                Client Email Address
              </label>
              <input
                type="email"
                placeholder="Enter client email address (optional)"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Free Consultation Checkbox */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="freeConsultation"
                checked={isFreeConsultation}
                onChange={(e) => {
                  setIsFreeConsultation(e.target.checked);
                  if (e.target.checked) {
                    setTherapyType('');
                    setTherapistName('');
                  }
                }}
                className="w-4 h-4 text-teal-700 border-gray-300 rounded focus:ring-teal-500"
              />
              <label htmlFor="freeConsultation" className="text-sm font-medium cursor-pointer">
                Free Consultation
              </label>
            </div>

            {/* Select Therapy and Therapist */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Select Therapy
                </label>
                <div className="relative">
                  <select 
                    value={therapyType}
                    onChange={(e) => {
                      setTherapyType(e.target.value);
                      setTherapistName(''); // Reset therapist when therapy changes
                    }}
                    className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                    required={!isFreeConsultation}
                    disabled={isFreeConsultation}
                  >
                    <option value="">Select</option>
                    {therapies.map((therapy) => (
                      <option key={therapy.therapy_name} value={therapy.therapy_name}>
                        {therapy.therapy_name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor">
                      <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Select Therapist
                </label>
                <div className="relative">
                  <select 
                    value={therapistName}
                    onChange={(e) => setTherapistName(e.target.value)}
                    className="w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 appearance-none bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                    required={!isFreeConsultation}
                    disabled={isFreeConsultation}
                  >
                    <option value="">Select</option>
                    {filteredTherapists.map((therapist) => (
                      <option key={therapist.name} value={therapist.name}>
                        {therapist.name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor">
                      <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-700 text-white py-3 rounded-lg mt-6 hover:bg-teal-800 font-medium disabled:bg-gray-400"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Send booking link</h3>
            <p className="text-gray-600 mb-6">
              This will send a booking link to <span className="font-semibold">{clientName}</span> on WhatsApp. Would you like to proceed?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100 font-medium"
              >
                No
              </button>
              <button
                onClick={confirmSend}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400"
              >
                {loading ? 'Sending...' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
