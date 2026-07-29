import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, X, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';

export const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

// Sidebar sections first, in the order they appear in the nav, then the
// cross-cutting systems that have no sidebar entry of their own. Order is
// deliberate — keep it in sync with the nav if that changes.
// 'Other' stays last as the escape hatch, so an issue that fits none of the
// named areas still gets filed rather than mis-categorised.
const SHARED_SYSTEMS = [
  'Chatbot',
  'Email Notification',
  'Whatsapp Notification',
  'Other',
];

const COMPONENTS_BY_ROLE: Record<string, string[]> = {
  // Mirrors the admin sidebar: components/Dashboard.tsx
  admin: [
    'Dashboard',
    'Bookings',
    'Therapists',
    'Clients',
    'Payments',
    'Settings',
    ...SHARED_SYSTEMS,
  ],
  // Mirrors the therapist sidebar: components/TherapistDashboard.tsx
  therapist: [
    'Dashboard',
    'My Availability',
    'My Clients',
    'My Bookings',
    'My Calendar',
    ...SHARED_SYSTEMS,
  ],
};

interface ReportIssuePageProps {
  onBack: () => void;
  userInfo: {
    username: string;
    role: string;
  };
  hideHeader?: boolean;
}

interface PendingShot {
  file: File;
  preview: string;
}

export const ReportIssuePage: React.FC<ReportIssuePageProps> = ({ onBack, userInfo, hideHeader }) => {
  const [subject, setSubject] = useState('');
  const [component, setComponent] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<PendingShot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [issueId, setIssueId] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const components =
    COMPONENTS_BY_ROLE[String(userInfo.role || '').toLowerCase()] || COMPONENTS_BY_ROLE.admin;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const readPreview = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  const handleScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_SCREENSHOTS - screenshots.length;
    if (room <= 0) {
      setErrors({ ...errors, screenshot: `You can attach at most ${MAX_SCREENSHOTS} screenshots` });
      return;
    }

    const problems: string[] = [];
    const accepted: File[] = [];
    for (const file of picked.slice(0, room)) {
      if (!file.type.startsWith('image/')) problems.push(`${file.name}: not an image`);
      else if (file.size > MAX_SCREENSHOT_BYTES) problems.push(`${file.name}: over 5MB`);
      else accepted.push(file);
    }
    if (picked.length > room) problems.push(`only the first ${room} added (max ${MAX_SCREENSHOTS})`);

    const withPreviews = await Promise.all(
      accepted.map(async (file) => ({ file, preview: await readPreview(file) }))
    );
    setScreenshots((prev) => [...prev, ...withPreviews]);
    setErrors({ ...errors, screenshot: problems.join(' · ') });
  };

  const removeScreenshot = (index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
    setErrors({ ...errors, screenshot: '' });
  };

  const validate = () => {
    const newErrors: { [key: string]: string } = {};

    if (!subject.trim()) {
      newErrors.subject = 'Subject is required';
    }

    if (!component) {
      newErrors.component = 'Please select a component';
    }

    if (!description.trim()) {
      newErrors.description = 'Description is required';
    } else if (description.trim().length < 20) {
      newErrors.description = 'Description must be at least 20 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setLoading(true);

    try {
      // /api/upload-file takes one file per call, so fan out. If any upload fails
      // we stop rather than silently filing a ticket with missing evidence.
      const screenshotUrls: string[] = [];
      for (const shot of screenshots) {
        const formData = new FormData();
        formData.append('file', shot.file);
        formData.append('folder', 'issue-screenshots');

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) throw new Error(`Failed to upload ${shot.file.name}`);
        const uploadData = await uploadResponse.json();
        if (!uploadData.url) throw new Error(`Upload returned no URL for ${shot.file.name}`);
        screenshotUrls.push(uploadData.url);
      }

      // reported_by / user_role are intentionally NOT sent — the server takes the
      // reporter's identity from the auth token so it cannot be spoofed.
      const response = await fetch('/api/report-issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject,
          component,
          description,
          screenshot_urls: screenshotUrls
        })
      });

      if (response.ok) {
        const data = await response.json();
        setIssueId(data.issueId);
        setShowSuccess(true);

        // Reset form
        setSubject('');
        setComponent('');
        setDescription('');
        setScreenshots([]);
        setErrors({});
      } else {
        throw new Error('Failed to submit issue');
      }
    } catch (error) {
      console.error('Error submitting issue:', error);
      setErrors({ submit: 'Failed to submit issue. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (showSuccess) {
    // Only the confirmation is shown here — the form behind it was a dead,
    // non-functional duplicate of the real one below.
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 w-full max-w-md text-center mx-4">
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-3">
              Thank You for Reporting!
            </h2>
            <p className="text-gray-600 mb-6">
              We've received your feedback and will look into it shortly.
            </p>
            <div className="bg-gray-50 rounded-lg p-4 inline-block mb-6">
              <p className="text-sm text-gray-500 mb-1">Issue ID</p>
              <p className="text-3xl font-bold text-teal-700">#{issueId}</p>
            </div>
            <button
              onClick={() => {
                setShowSuccess(false);
                onBack();
              }}
              className="w-full px-6 py-3 bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors font-medium"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-teal-700" />
            <h1 className="text-2xl font-semibold text-gray-800">Report an Issue</h1>
          </div>
        </div>
      )}

      {/* Form Container */}
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  errors.subject ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Brief summary of the issue"
              />
              {errors.subject && (
                <p className="text-red-500 text-sm mt-1">{errors.subject}</p>
              )}
            </div>

            {/* Component */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Component/Section <span className="text-red-500">*</span>
              </label>
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-left flex items-center justify-between ${
                    errors.component ? 'border-red-500' : 'border-gray-300'
                  } ${component ? 'text-gray-900' : 'text-gray-400'}`}
                >
                  <span>{component || 'Select a component'}</span>
                  <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {isDropdownOpen && (
                  <div className="absolute z-10 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {components.map((comp) => (
                      <button
                        key={comp}
                        type="button"
                        onClick={() => {
                          setComponent(comp);
                          setIsDropdownOpen(false);
                          setErrors({ ...errors, component: '' });
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-teal-50 transition-colors ${
                          component === comp ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        {comp}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {errors.component && (
                <p className="text-red-500 text-sm mt-1">{errors.component}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none ${
                  errors.description ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Please describe the issue in detail (minimum 20 characters)"
              />
              <div className="flex justify-between items-center mt-2">
                {errors.description ? (
                  <p className="text-red-500 text-sm">{errors.description}</p>
                ) : (
                  <p className="text-gray-500 text-sm">
                    {description.length} / 20 characters minimum
                  </p>
                )}
              </div>
            </div>

            {/* Screenshot Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Screenshots (Optional)
              </label>
              {screenshots.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                  {screenshots.map((shot, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={shot.preview}
                        alt={`Screenshot ${index + 1}`}
                        className="w-full h-32 object-cover rounded-lg border border-gray-300"
                      />
                      <button
                        type="button"
                        onClick={() => removeScreenshot(index)}
                        aria-label={`Remove screenshot ${index + 1}`}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-gray-500 mt-1 truncate" title={shot.file.name}>
                        {shot.file.name}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {screenshots.length < MAX_SCREENSHOTS && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-teal-500 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleScreenshotChange}
                    className="hidden"
                    id="screenshot-upload"
                  />
                  <label
                    htmlFor="screenshot-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <Upload className="w-12 h-12 text-gray-400 mb-3" />
                    <p className="text-sm text-gray-600 font-medium mb-1">
                      {screenshots.length === 0
                        ? 'Click to upload screenshots'
                        : `Add more (${MAX_SCREENSHOTS - screenshots.length} remaining)`}
                    </p>
                    <p className="text-xs text-gray-400">
                      PNG, JPG up to 5MB each · up to {MAX_SCREENSHOTS} files
                    </p>
                  </label>
                </div>
              )}
              {errors.screenshot && (
                <p className="text-red-500 text-sm mt-2">{errors.screenshot}</p>
              )}
            </div>

            {/* Reporter Info */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600">
                Reported by: <span className="font-medium">{userInfo.username}</span> ({userInfo.role})
              </p>
            </div>

            {/* Submit Error */}
            {errors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-600 text-sm">{errors.submit}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={onBack}
                className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-6 py-3 bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                disabled={loading}
              >
                {loading ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
