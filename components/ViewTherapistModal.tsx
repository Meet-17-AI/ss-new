import React, { useState, useEffect } from 'react';
import { X, User, Mail, Phone, Pencil, Save, RefreshCw, Check } from 'lucide-react';
import { DeactivateTherapistWizard } from './DeactivateTherapistWizard';

interface ViewTherapistModalProps {
  therapist: any;
  onClose: () => void;
  /** Called after a successful save so the grid behind can refresh. */
  onSaved?: (updated: any) => void;
}

/** The only fields this dialog may change — profile details, nothing else. */
interface EditableDetails {
  name: string;
  email: string;
  phone: string;
  specialization: string;
}

const detailsOf = (t: any): EditableDetails => ({
  name: t?.name || '',
  email: t?.email || t?.contact_info || '',
  phone: t?.phone_number || '',
  specialization: t?.specialization || '',
});

export const ViewTherapistModal: React.FC<ViewTherapistModalProps> = ({ therapist, onClose, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [showDeactivateWizard, setShowDeactivateWizard] = useState(false);
  const [form, setForm] = useState<EditableDetails>(detailsOf(therapist));
  const [saved, setSaved] = useState<EditableDetails>(detailsOf(therapist));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const next = detailsOf(therapist);
    setForm(next);
    setSaved(next);
    setEditing(false);
    setMessage(null);
  }, [therapist?.therapist_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);
  const update = (k: keyof EditableDetails, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setMessage(null);
  };

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard your unsaved changes?')) return;
    setForm(saved);
    setEditing(false);
    setMessage(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Name cannot be empty.' });
      return;
    }
    try {
      setSaving(true);
      setMessage(null);
      // Sends only the four detail fields. The endpoint allowlists columns, so
      // status, is_active and credentials are unreachable from here.
      const res = await fetch(`/api/admin/therapists/${encodeURIComponent(therapist.therapist_id)}/details`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');

      setSaved(form);
      setEditing(false);
      setMessage({ type: 'success', text: 'Therapist details updated.' });
      onSaved?.(data.therapist);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save changes' });
    } finally {
      setSaving(false);
    }
  };

  const specs = form.specialization.split(',').map(s => s.trim()).filter(Boolean);

  const field = (
    key: keyof EditableDetails,
    label: string,
    opts: { icon?: React.ReactNode; type?: string; placeholder?: string } = {}
  ) => (
    <div>
      <label className="block text-sm font-semibold text-gray-600 mb-2">{label}</label>
      {editing ? (
        <input
          type={opts.type || 'text'}
          value={form[key]}
          placeholder={opts.placeholder}
          onChange={(e) => update(key, e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      ) : (
        <div className="flex items-center gap-2">
          {opts.icon}
          <p className="text-lg">{form[key] || <span className="text-gray-400 italic text-base">Not set</span>}</p>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">{editing ? 'Edit Therapist Details' : 'Therapist Details'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        {message && (
          <div className={`mb-5 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? <Check size={16} /> : <X size={16} />}
            {message.text}
          </div>
        )}

        {/* Profile Picture — display only. Changing the photo is a separate
            upload flow, and this dialog edits details only. */}
        <div className="flex justify-center mb-6">
          {therapist.profile_picture_url ? (
            <img
              src={therapist.profile_picture_url}
              alt={form.name}
              className="w-32 h-32 rounded-full object-cover border-4 border-teal-100"
            />
          ) : (
            <div className="w-32 h-32 rounded-full bg-teal-100 flex items-center justify-center">
              <User size={48} className="text-teal-700" />
            </div>
          )}
        </div>

        <div className="space-y-6">
          {field('name', 'Name')}
          {field('email', 'Email', { icon: <Mail size={18} className="text-gray-500" />, type: 'email' })}
          {field('phone', 'Phone', { icon: <Phone size={18} className="text-gray-500" />, placeholder: '+91 98765 43210' })}

          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">Specializations</label>
            {editing ? (
              <>
                <input
                  type="text"
                  value={form.specialization}
                  onChange={(e) => update('specialization', e.target.value)}
                  placeholder="Anxiety, Depression, Trauma"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-400 mt-1">Separate each specialization with a comma.</p>
              </>
            ) : specs.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {specs.map((spec, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full text-sm font-medium"
                    style={{ backgroundColor: '#2D757930', color: '#2D7579' }}
                  >
                    {spec}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 italic text-base">No specializations recorded</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between">
          <div>
            {!editing && (
              therapist.is_active ? (
                <button
                  onClick={() => setShowDeactivateWizard(true)}
                  className="px-4 py-2 border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors"
                >
                  Deactivate Therapist
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Reactivate ${therapist.name}?`)) return;
                    try {
                      const res = await fetch(`/api/admin/therapists/${encodeURIComponent(therapist.therapist_id)}/status`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_active: true })
                      });
                      if (!res.ok) throw new Error('Failed to activate');
                      onSaved?.({ ...therapist, is_active: true });
                    } catch (e: any) {
                      alert(e.message);
                    }
                  }}
                  className="px-4 py-2 border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 rounded-lg font-medium transition-colors"
                >
                  Activate Therapist
                </button>
              )
            )}
          </div>
          
          <div className="flex gap-3">
            {editing ? (
              <>
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="px-6 py-2 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => { setEditing(true); setMessage(null); }}
                  className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Pencil size={16} />
                  Edit Details
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      
      <DeactivateTherapistWizard
        isOpen={showDeactivateWizard}
        onClose={() => setShowDeactivateWizard(false)}
        therapistId={therapist.therapist_id}
        therapistName={therapist.name}
        onDeactivated={() => {
          setShowDeactivateWizard(false);
          onSaved?.({ ...therapist, is_active: false });
        }}
      />
    </div>
  );
};
