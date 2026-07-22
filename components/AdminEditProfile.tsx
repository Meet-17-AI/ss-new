import React, { useState, useEffect } from 'react';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { Toast } from './Toast';
import { ChangePassword } from './ChangePassword';

interface AdminEditProfileProps {
  user: any;
  onBack: () => void;
}

export const AdminEditProfile: React.FC<AdminEditProfileProps> = ({ user, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [profilePicture, setProfilePicture] = useState<File | null>(null);
  const [currentProfilePictureUrl, setCurrentProfilePictureUrl] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const countryCodes = [
    { code: '+91', country: 'India' },
    { code: '+1', country: 'USA/Canada' },
    { code: '+44', country: 'UK' },
    { code: '+61', country: 'Australia' },
    { code: '+971', country: 'UAE' },
  ];

  useEffect(() => {
    fetchAdminProfile();
  }, []);

  const fetchAdminProfile = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin-profile?user_id=${user.id}`);
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Server returned non-JSON response. Please restart the server.');
        setToast({ message: 'Server needs to be restarted. Please restart and try again.', type: 'error' });
        setLoading(false);
        return;
      }
      
      const data = await response.json();

      if (data.success) {
        const profile = data.data;
        setName(profile.full_name || '');
        setEmail(profile.email || '');
        
        const phoneMatch = profile.phone?.match(/^(\+\d+)\s*(.+)$/);
        if (phoneMatch) {
          setCountryCode(phoneMatch[1]);
          setPhone(phoneMatch[2]);
        } else {
          setCountryCode('+91'); // Default to +91 if no country code found
          setPhone(profile.phone || '');
        }

        setCurrentProfilePictureUrl(profile.profile_picture_url || '');
      } else {
        setToast({ message: data.error || 'Failed to load profile', type: 'error' });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setToast({ message: 'Failed to load profile. Please restart the server.', type: 'error' });
    } finally {
      setLoading(false);
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
      let profilePictureUrl = currentProfilePictureUrl;

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

      const response = await fetch('/api/admin-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          name,
          email,
          phone: `${countryCode}${phone}`,
          profilePictureUrl
        })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Profile updated successfully!', type: 'success' });
        setProfilePicture(null);
        setCurrentProfilePictureUrl(profilePictureUrl);
        
        // Refresh page after 1 second to show updated profile picture
        setTimeout(() => {
          window.location.reload();
        }, 1000);
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
      <p className="text-gray-600 mb-8">Update your personal information</p>

      <div className="bg-white rounded-lg border p-6">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          {/* Profile Picture Upload */}
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
            <p className="text-xs text-gray-500 mt-1">JPG, PNG, or WebP. Max size: 5MB</p>
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

      <div className="mt-8">
        <h2 className="text-xl font-bold mb-4">Security Settings</h2>
        <ChangePassword user={user} hideHeader={true} />
      </div>

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
