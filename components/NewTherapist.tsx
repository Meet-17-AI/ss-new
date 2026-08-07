import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Lottie from 'lottie-react';
import sessionBookedAnimation from '../session-booked.json';

interface NewTherapistProps {
  onBack: () => void;
}

export const NewTherapist: React.FC<NewTherapistProps> = ({ onBack }) => {
  const [therapistName, setTherapistName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [specializationDetails, setSpecializationDetails] = useState<{
    [key: string]: { price: string; description: string }
  }>({});
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The invite is saved before the email is attempted, so a send failure is not
  // a failed submission — it needs its own, softer message.
  const [emailWarning, setEmailWarning] = useState<string | null>(null);

  const countryCodes = [
    { code: '+91', country: 'India' },
    { code: '+1', country: 'USA/Canada' },
    { code: '+44', country: 'UK' },
    { code: '+61', country: 'Australia' },
    { code: '+971', country: 'UAE' },
  ];

  const specializationOptions = [
    'Individual Therapy',
    'Adolescent Therapy',
    'Couples Therapy'
  ];

  const handleSpecializationToggle = (spec: string) => {
    setSpecializations(prev => {
      if (prev.includes(spec)) {
        // Remove specialization and its details
        const newDetails = { ...specializationDetails };
        delete newDetails[spec];
        setSpecializationDetails(newDetails);
        return prev.filter(s => s !== spec);
      } else {
        // Add specialization with empty details
        setSpecializationDetails(prev => ({
          ...prev,
          [spec]: { price: '', description: '' }
        }));
        return [...prev, spec];
      }
    });
  };

  const handleDetailChange = (spec: string, field: 'price' | 'description', value: string) => {
    setSpecializationDetails(prev => ({
      ...prev,
      [spec]: {
        ...prev[spec],
        [field]: value
      }
    }));
  };

  const areAllDetailsComplete = () => {
    return specializations.every(spec => {
      const details = specializationDetails[spec];
      return details && details.price.trim() !== '';
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setEmailWarning(null);

    try {
      const response = await fetch('/api/new-therapist-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapistName,
          whatsappNumber: `${countryCode}${whatsappNumber}`,
          email,
          specializations: specializations.join(', '),
          specializationDetails: Object.entries(specializationDetails).map(([name, details]) => ({
            name,
            price: details.price,
            description: details.description
          }))
        })
      });

      // A gateway timeout or a crashed backend returns HTML, not JSON.
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
          (response.status === 502 || response.status === 504
            ? 'The server took too long to respond. The therapist may still have been created — check the Therapists tab before retrying.'
            : `Could not add the therapist (HTTP ${response.status}).`)
        );
      }

      if (data && data.emailSent === false) {
        setEmailWarning(
          data.emailPending
            ? 'The therapist was added, but the invite email is taking longer than usual to send. It may still arrive.'
            : `The therapist was added, but the invite email could not be sent${data.emailError ? ` (${data.emailError})` : ''}. Use Resend invite from the Therapists tab.`
        );
      }
      setShowSuccessModal(true);
    } catch (err: any) {
      console.error('Error adding therapist:', err);
      setError(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
      >
        <ArrowLeft size={20} />
        <span>Back</span>
      </button>

      <h1 className="text-3xl font-bold mb-1">New Therapist</h1>
      <p className="text-gray-600 mb-8">Add a new therapist to the platform</p>

      <div className="max-w-3xl">
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Therapist Name */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Therapist Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={therapistName}
                onChange={(e) => setTherapistName(e.target.value)}
                placeholder="Enter therapist name"
                className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
            </div>

            {/* Therapist WhatsApp Number */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Therapist WhatsApp Number<span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-32 px-2 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm"
                >
                  {countryCodes.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} {item.country}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  placeholder="Enter WhatsApp number"
                  className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>
            </div>

            {/* Therapist Email */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Therapist Email<span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter therapist email"
                className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1 italic">
                *Use the Gmail account associated with your Google Calendar.
              </p>
            </div>

            {/* Specializations */}
            <div>
              <label className="block text-sm font-semibold mb-1.5">
                Specializations<span className="text-red-500">*</span>
              </label>
              <div className="space-y-3">
                {specializationOptions.map((spec) => (
                  <div key={spec}>
                    <label className="flex items-center gap-3 p-2.5 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={specializations.includes(spec)}
                        onChange={() => handleSpecializationToggle(spec)}
                        className="w-4 h-4 text-teal-700 border-gray-300 rounded focus:ring-teal-500"
                      />
                      <span className="text-sm">{spec}</span>
                    </label>
                    
                    {/* Expandable Details Box */}
                    {specializations.includes(spec) && (
                      <div className="mt-2 ml-7 p-4 bg-gray-50 border rounded-lg space-y-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">
                            Price (₹)<span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            placeholder="Enter price"
                            value={specializationDetails[spec]?.price || ''}
                            onChange={(e) => handleDetailChange(spec, 'price', e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">
                            Description
                          </label>
                          <textarea
                            placeholder="Enter description"
                            value={specializationDetails[spec]?.description || ''}
                            onChange={(e) => handleDetailChange(spec, 'description', e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {specializations.length === 0 && (
                <p className="text-xs text-red-500 mt-1">
                  Please select at least one specialization
                </p>
              )}
            </div>

            {error && (
              <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Proceed Button */}
            <button
              type="submit"
              disabled={loading || specializations.length === 0 || !therapistName.trim() || !whatsappNumber.trim() || !email.trim() || !areAllDetailsComplete()}
              className="w-full bg-teal-700 text-white py-2.5 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Submitting...' : 'Proceed'}
            </button>
          </div>
        </form>
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 w-full max-w-md text-center">
            <div className="w-32 h-32 mx-auto mb-4">
              <Lottie animationData={sessionBookedAnimation} loop={true} />
            </div>
            <h3 className="text-xl font-bold mb-4">New Therapist Details Captured</h3>
            {emailWarning ? (
              <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-left">
                {emailWarning}
              </p>
            ) : (
              <p className="text-gray-600 mb-6">
                The link has been sent to the therapist for profile completion, once it completed our tech team will further start the new therapist onboarding.
              </p>
            )}
            <button
              onClick={() => {
                setShowSuccessModal(false);
                onBack();
              }}
              className="w-full bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
