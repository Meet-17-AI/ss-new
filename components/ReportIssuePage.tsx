import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Upload, X, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react';

interface ReportIssuePageProps {
  onBack: () => void;
  userInfo: {
    username: string;
    role: string;
  };
  hideHeader?: boolean;
}

export const ReportIssuePage: React.FC<ReportIssuePageProps> = ({ onBack, userInfo, hideHeader }) => {
  const [subject, setSubject] = useState('');
  const [component, setComponent] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [issueId, setIssueId] = useState<number | null>(null);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const components = [
    'Dashboard',
    'Clients',
    'Therapists',
    'Appointments',
    'Calendar',
    'Session Notes',
    'Reports',
    'Profile',
    'Audit Logs',
    'Other'
  ];

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

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrors({ ...errors, screenshot: 'File size must be less than 5MB' });
        return;
      }

      // Check file type
      if (!file.type.startsWith('image/')) {
        setErrors({ ...errors, screenshot: 'Only image files are allowed' });
        return;
      }

      setScreenshot(file);
      setErrors({ ...errors, screenshot: '' });

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setScreenshotPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotPreview(null);
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
      let screenshotUrl = null;

      // Upload screenshot if provided
      if (screenshot) {
        const formData = new FormData();
        formData.append('file', screenshot);
        formData.append('folder', 'issue-screenshots');

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          screenshotUrl = uploadData.url;
        }
      }

      // Submit issue report
      const response = await fetch('/api/report-issue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subject,
          component,
          description,
          screenshot_url: screenshotUrl,
          reported_by: userInfo.username,
          user_role: userInfo.role
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
        setScreenshot(null);
        setScreenshotPreview(null);
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
    return (
      <>
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
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Subject */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Subject <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 border-gray-300"
                    placeholder="Brief summary of the issue"
                  />
                </div>

                {/* Component */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Component/Section <span className="text-red-500">*</span>
                  </label>
                  <div className="relative" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-left flex items-center justify-between border-gray-300 text-gray-400"
                    >
                      <span>Select a component</span>
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none border-gray-300"
                    placeholder="Please describe the issue in detail (minimum 20 characters)"
                  />
                </div>

                {/* Screenshot Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Screenshot (Optional)
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    <Upload className="w-12 h-12 text-gray-400 mb-3 mx-auto" />
                    <p className="text-sm text-gray-600 font-medium mb-1">
                      Click to upload screenshot
                    </p>
                    <p className="text-xs text-gray-400">
                      PNG, JPG up to 5MB
                    </p>
                  </div>
                </div>

                {/* Reporter Info */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-sm text-gray-600">
                    Reported by: <span className="font-medium">{userInfo.username}</span> ({userInfo.role})
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={onBack}
                    className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-teal-700 text-white rounded-lg hover:bg-teal-800 transition-colors font-medium"
                  >
                    Submit Report
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Success Modal */}
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
      </>
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
                Screenshot (Optional)
              </label>
              {!screenshotPreview ? (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-teal-500 transition-colors">
                  <input
                    type="file"
                    accept="image/*"
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
                      Click to upload screenshot
                    </p>
                    <p className="text-xs text-gray-400">
                      PNG, JPG up to 5MB
                    </p>
                  </label>
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    className="w-full rounded-lg border border-gray-300"
                  />
                  <button
                    type="button"
                    onClick={removeScreenshot}
                    className="absolute top-3 right-3 bg-red-500 text-white rounded-full p-2 hover:bg-red-600 transition-colors shadow-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
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
