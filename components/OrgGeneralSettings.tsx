import React, { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, Upload, Building2, Check, X, Pencil } from 'lucide-react';
import { resolveMediaUrl } from '../lib/mediaUrl';

interface OrgSettings {
  org_name: string;
  org_logo_url: string;
  org_support_email: string;
  org_support_phone: string;
  org_address: string;
  org_website: string;
  org_timezone: string;
  org_gstin: string;
}

const EMPTY: OrgSettings = {
  org_name: '',
  org_logo_url: '',
  org_support_email: '',
  org_support_phone: '',
  org_address: '',
  org_website: '',
  org_timezone: 'Asia/Kolkata',
  org_gstin: '',
};

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export const OrgGeneralSettings: React.FC = () => {
  const [settings, setSettings] = useState<OrgSettings>(EMPTY);
  const [saved, setSaved] = useState<OrgSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Read-only until the admin explicitly clicks Edit. These are org-wide values
  // that rarely change, so the default state should be "look", not "type".
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/org-settings');
      if (res.ok) {
        const data = await res.json();
        const merged = { ...EMPTY, ...(data.settings || {}) };
        // A blank stored timezone should still show the platform default rather
        // than an empty select.
        if (!merged.org_timezone) merged.org_timezone = EMPTY.org_timezone;
        setSettings(merged);
        setSaved(merged);
      } else {
        setMessage({ type: 'error', text: 'Failed to load organization settings.' });
      }
    } catch (err) {
      console.error('Error fetching org settings:', err);
      setMessage({ type: 'error', text: 'Failed to load organization settings.' });
    } finally {
      setLoading(false);
    }
  };

  const isDirty = JSON.stringify(settings) !== JSON.stringify(saved);

  const update = (key: keyof OrgSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Logo must be an image file.' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Logo must be under 5 MB.' });
      return;
    }
    try {
      setUploading(true);
      setMessage(null);
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'org-logos');
      const res = await fetch('/api/upload-file', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.success && data.url) {
        update('org_logo_url', data.url);
      } else {
        setMessage({ type: 'error', text: data.error || 'Logo upload failed.' });
      }
    } catch (err) {
      console.error('Logo upload failed:', err);
      setMessage({ type: 'error', text: 'Logo upload failed.' });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch('/api/org-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setSaved(settings);
        setEditing(false);
        setMessage({ type: 'success', text: 'Organization settings saved successfully.' });
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || 'Failed to save settings.' });
      }
    } catch (err) {
      console.error('Error saving org settings:', err);
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="animate-spin text-teal-600" size={32} />
        <span className="text-gray-500 font-medium">Loading organization settings...</span>
      </div>
    );
  }

  const logoPreview = resolveMediaUrl(settings.org_logo_url);

  /**
   * One labelled setting. Renders as plain text until Edit is pressed, then as
   * an input. `link` turns the read-only value into a mailto:/https: anchor —
   * a support email and a website are things an admin wants to click, not
   * select and copy.
   */
  const field = (
    key: keyof OrgSettings,
    label: string,
    opts: { type?: string; placeholder?: string; textarea?: boolean; link?: 'mailto' | 'url' } = {}
  ) => {
    const value = settings[key];

    if (!editing) {
      let display: React.ReactNode;
      if (!value) {
        display = <span className="text-gray-400 italic">Not set</span>;
      } else if (opts.link === 'mailto') {
        display = <a href={`mailto:${value}`} className="text-teal-700 hover:underline break-all">{value}</a>;
      } else if (opts.link === 'url') {
        const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        display = <a href={href} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline break-all">{value}</a>;
      } else {
        // whitespace-pre-line keeps a multi-line address readable instead of
        // collapsing it onto one line.
        display = <span className="text-gray-800 whitespace-pre-line break-words">{value}</span>;
      }
      return (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
          <div className="text-sm">{display}</div>
        </div>
      );
    }

    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
        {opts.textarea ? (
          <textarea
            rows={3}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => update(key, e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm resize-y"
          />
        ) : (
          <input
            type={opts.type || 'text'}
            value={value}
            placeholder={opts.placeholder}
            onChange={(e) => update(key, e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
          />
        )}
      </div>
    );
  };

  const handleCancel = () => {
    // Same rule as the pricing dialogs: never discard typed input silently.
    if (isDirty && !window.confirm('Discard your unsaved changes?')) return;
    setSettings(saved);
    setEditing(false);
    setMessage(null);
  };

  return (
    // Scrolling lives on the page root, matching every sibling settings tab.
    // It used to sit on an inner max-w-3xl box, which put the scrollbar at that
    // box's right edge — mid-screen, with dead space beyond it.
    <div className="p-6 flex flex-col h-full bg-white overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-800">General</h2>
          <p className="text-sm text-gray-500 mt-1">
            Your organization's name, logo and contact details.
          </p>
        </div>
        {editing ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 font-medium text-sm rounded-lg transition-all whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm rounded-lg transition-all flex items-center gap-2 whitespace-nowrap"
            >
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setEditing(true); setMessage(null); }}
            className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 font-medium text-sm rounded-lg transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <Pencil size={16} />
            Edit
          </button>
        )}
      </div>

      {message && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {message.text}
        </div>
      )}

      <div className="flex-1 space-y-8">
        {/* Logo */}
        <div>
          <p className={editing
            ? 'block text-sm font-medium text-gray-700 mb-2'
            : 'text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2'}>
            Organization Logo
          </p>
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="Organization logo" className="w-full h-full object-contain" />
              ) : (
                <Building2 size={32} className="text-gray-300" />
              )}
            </div>
            {/* Upload and remove are edit actions — hidden until Edit is pressed
                so the read-only view cannot mutate anything. */}
            {editing ? (
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(file);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2 w-fit"
                >
                  {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploading ? 'Uploading...' : 'Upload Logo'}
                </button>
                {settings.org_logo_url && (
                  <button
                    onClick={() => update('org_logo_url', '')}
                    className="text-sm text-red-600 hover:text-red-700 font-medium w-fit"
                  >
                    Remove logo
                  </button>
                )}
                <p className="text-xs text-gray-400">PNG or SVG, up to 5 MB.</p>
              </div>
            ) : (
              !settings.org_logo_url && <span className="text-sm text-gray-400 italic">No logo uploaded</span>
            )}
          </div>
        </div>

        {/* Details */}
        {/* Three columns on wide screens so the reclaimed width is used, rather
            than stretching two fields across the whole page. Mirrors the card
            grid on the Therapists tab. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {field('org_name', 'Organization Name', { placeholder: 'SafeStories' })}
          {field('org_website', 'Website', { placeholder: 'https://safestories.in', link: 'url' })}
          {field('org_support_email', 'Support Email', { type: 'email', placeholder: 'therapy@safestories.in', link: 'mailto' })}
          {field('org_support_phone', 'Support Phone', { placeholder: '+91 98765 43210' })}
          {field('org_gstin', 'GSTIN', { placeholder: '22AAAAA0000A1Z5' })}
          {editing ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
              <select
                value={settings.org_timezone}
                onChange={(e) => update('org_timezone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm bg-white"
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Timezone</p>
              <span className="text-sm text-gray-800">{settings.org_timezone || EMPTY.org_timezone}</span>
            </div>
          )}
        </div>

        <div>{field('org_address', 'Address', { textarea: true, placeholder: 'Street, city, state, postal code' })}</div>
      </div>
    </div>
  );
};

export default OrgGeneralSettings;
