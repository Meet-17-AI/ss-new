import React, { useState, useEffect } from 'react';
import { ArrowLeft, Upload, X, Calendar } from 'lucide-react';
import { Toast } from './Toast';

interface EditProfileProps {
  user: any;
  onBack: () => void;
}

export const EditProfile: React.FC<EditProfileProps> = ({ user, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [specializationDetails, setSpecializationDetails] = useState<{
    [key: string]: { price: string; description: string }
  }>({});
  const [qualification, setQualification] = useState('');
  const [qualificationFile, setQualificationFile] = useState<File | null>(null);
  const [currentQualificationUrl, setCurrentQualificationUrl] = useState('');
  const [profilePicture, setProfilePicture] = useState<File | null>(null);
  const [currentProfilePictureUrl, setCurrentProfilePictureUrl] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; email: string | null } | null>(null);

  useEffect(() => {
    if (user.therapist_id) {
      fetch(`/api/auth/google/status?therapistId=${user.therapist_id}`)
        .then(res => res.json())
        .then(data => setCalendarStatus(data))
        .catch(err => console.error('Error fetching calendar status:', err));
    }
  }, [user.therapist_id]);

  // Ask the API for the consent URL, then navigate. A plain navigation to
  // /api/auth/google cannot carry the auth token, so it always 401'd and the
  // button did nothing — the identity now comes from the token server-side.
  const handleConnectCalendar = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      if (!res.ok) throw new Error(`Auth URL request failed: ${res.status}`);
      const { url } = await res.json();
      if (!url) throw new Error('No authorisation URL returned');
      window.location.href = url;
    } catch (err) {
      console.error('Error starting Google authorisation:', err);
      setToast({ message: 'Could not open Google authorisation. Please try again.', type: 'error' });
    }
  };

  const handleDisconnectCalendar = async () => {
    if (confirm('Are you sure you want to disconnect Google Calendar?')) {
      try {
        const res = await fetch('/api/auth/google/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ therapistId: user.therapist_id })
        });
        if (res.ok) {
          setCalendarStatus({ connected: false, email: null });
          setToast({ message: 'Google Calendar disconnected successfully!', type: 'success' });
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

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

  useEffect(() => {
    fetchTherapistProfile();
  }, []);

  const fetchTherapistProfile = async () => {
    try {
      setLoading(true);
      // Try with therapist_id first, fallback to email for pending therapists
      const url = user.therapist_id 
        ? `/api/therapist-profile?therapist_id=${user.therapist_id}`
        : `/api/therapist-profile?email=${encodeURIComponent(user.email)}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        const profile = data.data;
        setName(profile.name || '');
        setEmail(profile.contact_info || profile.email || '');
        
        // Extract country code and phone
        const phoneStr = profile.phone_number || profile.phone || '';
        const phoneMatch = phoneStr.match(/^(\+\d{1,3})\s*(.+)$/);
        if (phoneMatch) {
          setCountryCode(phoneMatch[1]);
          setPhone(phoneMatch[2]);
        } else {
          setCountryCode('+91'); // Default to +91 if no country code found
          setPhone(phoneStr);
        }

        // Parse specializations
        if (profile.specialization || profile.specializations) {
          const specs = (profile.specialization || profile.specializations).split(', ');
          setSpecializations(specs);
          
          // Parse specialization details if available
          let parsedDetails: any = {};
          if (profile.specialization_details) {
            try {
              const detailsArray = typeof profile.specialization_details === 'string'
                ? JSON.parse(profile.specialization_details)
                : profile.specialization_details;
              
              if (Array.isArray(detailsArray)) {
                detailsArray.forEach((item: any) => {
                  parsedDetails[item.name] = {
                    price: item.price || '',
                    description: item.description || ''
                  };
                });
              }
            } catch (e) {
              console.error('Error parsing specialization details:', e);
            }
          }
          
          // Fill in missing specs with empty details
          specs.forEach((spec: string) => {
            if (!parsedDetails[spec]) {
              parsedDetails[spec] = { price: '', description: '' };
            }
          });
          
          setSpecializationDetails(parsedDetails);
        }

        setQualification(profile.qualification || '');
        setCurrentQualificationUrl(profile.qualification_pdf_url || '');
        setCurrentProfilePictureUrl(profile.profile_picture_url || '');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setToast({ message: 'Failed to load profile', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSpecializationToggle = (spec: string) => {
    setSpecializations(prev => {
      if (prev.includes(spec)) {
        const newDetails = { ...specializationDetails };
        delete newDetails[spec];
        setSpecializationDetails(newDetails);
        return prev.filter(s => s !== spec);
      } else {
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

  const handleQualificationFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setToast({ message: 'Qualification PDF must be less than 5MB', type: 'error' });
        return;
      }
      setQualificationFile(file);
    }
  };

  const handleProfilePictureChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setToast({ message: 'Profile picture must be JPG, PNG, or WebP', type: 'error' });
        return;
      }

      // If file is larger than 5MB, compress it
      if (file.size > 5 * 1024 * 1024) {
        setToast({ message: 'Compressing large image...', type: 'success' });
        
        try {
          const compressedFile = await compressImage(file);
          if (compressedFile.size > 5 * 1024 * 1024) {
            setToast({ message: 'Image is too large even after compression. Please use a smaller image.', type: 'error' });
            return;
          }
          setProfilePicture(compressedFile);
          setToast({ message: 'Image compressed successfully', type: 'success' });
        } catch (error) {
          console.error('Compression error:', error);
          setToast({ message: 'Failed to compress image. Please use a smaller image.', type: 'error' });
        }
      } else {
        setProfilePicture(file);
      }
    }
  };

  // Helper function to compress images
  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if too large
          const maxDimension = 1920;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height / width) * maxDimension;
              width = maxDimension;
            } else {
              width = (width / height) * maxDimension;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                resolve(compressedFile);
              } else {
                reject(new Error('Compression failed'));
              }
            },
            'image/jpeg',
            0.8 // 80% quality
          );
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      let qualificationPdfUrl = currentQualificationUrl;
      let profilePictureUrl = currentProfilePictureUrl;

      if (qualificationFile) {
        const formData = new FormData();
        formData.append('file', qualificationFile);
        formData.append('folder', 'qualification-pdfs');

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('Upload failed:', errorText);
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const uploadData = await uploadResponse.json();
        
        if (uploadData.success) {
          qualificationPdfUrl = uploadData.url;
        } else {
          throw new Error(uploadData.error || 'Failed to upload qualification PDF');
        }
      }

      if (profilePicture) {
        const formData = new FormData();
        formData.append('file', profilePicture);
        formData.append('folder', 'profile-pictures');

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('Upload failed:', errorText);
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        const uploadData = await uploadResponse.json();
        
        if (uploadData.success) {
          profilePictureUrl = uploadData.url;
        } else {
          throw new Error(uploadData.error || 'Failed to upload profile picture');
        }
      }

      const response = await fetch('/api/therapist-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapist_id: user.therapist_id,
          name,
          email,
          phone: `${countryCode}${phone}`,
          specializations: specializations.join(', '),
          qualificationPdfUrl,
          profilePictureUrl
        })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Profile updated successfully!', type: 'success' });
        setQualificationFile(null);
        setProfilePicture(null);
        setCurrentQualificationUrl(qualificationPdfUrl);
        setCurrentProfilePictureUrl(profilePictureUrl);
      } else {
        setToast({ message: data.error || 'Failed to update profile', type: 'error' });
      }
    } catch (error) {
      console.error('Error:', error);
      setToast({ message: 'An error occurred while updating profile', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
      >
        <ArrowLeft size={20} />
        <span>Back</span>
      </button>

      <h1 className="text-3xl font-bold mb-1">Edit Profile</h1>
      <p className="text-gray-600 mb-8">Update your personal information and qualifications</p>

      <div className="bg-white rounded-lg border p-6">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          {/* Profile Picture Upload - MOVED TO TOP */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Profile Picture
            </label>
            {currentProfilePictureUrl && !profilePicture && (
              <div className="flex items-center gap-2 mb-2">
                <img 
                  src={currentProfilePictureUrl} 
                  alt="Current profile" 
                  className="w-16 h-16 rounded-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setCurrentProfilePictureUrl('')}
                  className="text-red-500 hover:text-red-700"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2.5 border rounded-lg cursor-pointer hover:bg-gray-50">
                <Upload size={18} />
                <span className="text-sm">
                  {profilePicture ? profilePicture.name : 'Choose image'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleProfilePictureChange}
                  className="hidden"
                />
              </label>
              {profilePicture && (
                <>
                  <span className="text-xs text-gray-500">
                    {(profilePicture.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => setProfilePicture(null)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X size={18} />
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">JPG, PNG, or WebP. Max size: 12MB</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-500 mt-1 italic">
              *Use the Gmail account associated with your Google Calendar.
            </p>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Phone Number
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
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Specializations */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Specializations
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
                  
                  {specializations.includes(spec) && (
                    <div className="mt-2 ml-7 p-4 bg-gray-50 border rounded-lg space-y-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">
                          Price (₹)
                        </label>
                        <input
                          type="number"
                          placeholder="Enter price"
                          value={specializationDetails[spec]?.price || ''}
                          onChange={(e) => handleDetailChange(spec, 'price', e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
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
          </div>

          {/* Qualification */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Qualification
            </label>
            <input
              type="text"
              value={qualification}
              onChange={(e) => setQualification(e.target.value)}
              placeholder="e.g., M.A. Clinical Psychology"
              className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Qualification PDF Upload */}
          <div>
            <label className="block text-sm font-semibold mb-1.5">
              Qualification Certificate (PDF)
            </label>
            {currentQualificationUrl && !qualificationFile && (
              <div className="flex items-center gap-2 mb-2 text-sm text-gray-600">
                <span>Current file: {currentQualificationUrl.split('/').pop()}</span>
                <button
                  type="button"
                  onClick={() => setCurrentQualificationUrl('')}
                  className="text-red-500 hover:text-red-700"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2.5 border rounded-lg cursor-pointer hover:bg-gray-50">
                <Upload size={18} />
                <span className="text-sm">
                  {qualificationFile ? qualificationFile.name : 'Choose PDF file'}
                </span>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleQualificationFileChange}
                  className="hidden"
                />
              </label>
              {qualificationFile && (
                <>
                  <span className="text-xs text-gray-500">
                    {(qualificationFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => setQualificationFile(null)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X size={18} />
                  </button>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">Max size: 5MB</p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-teal-700 text-white py-3 rounded-lg hover:bg-teal-800 font-medium disabled:bg-gray-400 disabled:cursor-not-allowed mt-6"
          >
            {saving ? 'Saving...' : 'Save Profile Changes'}
          </button>
        </form>
      </div>

      {/* Google Calendar Section */}
      {user.therapist_id && (
        <div className="bg-white rounded-lg border p-6 mt-6">
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <Calendar className="text-teal-700" size={24} />
            Google Calendar Sync
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            Sync bookings and availability directly with your Google Calendar to prevent double bookings.
          </p>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-xl bg-gray-50 gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-gray-800">
                {calendarStatus?.connected ? 'Status: Connected' : 'Status: Disconnected'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {calendarStatus?.connected
                  ? `Your account is connected to ${calendarStatus.email}`
                  : 'Connect your Google account to automatically import busy slots and set up Google Meet links.'}
              </p>
            </div>
            <div>
              {calendarStatus?.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnectCalendar}
                  className="px-6 py-2 bg-red-50 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition-colors border border-red-200"
                >
                  Disconnect Account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectCalendar}
                  className="px-6 py-2 bg-teal-700 text-white font-semibold rounded-lg hover:bg-teal-800 transition-colors"
                >
                  Connect Calendar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
