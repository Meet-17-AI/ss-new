import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, Save, Plus, Trash2, GripVertical } from 'lucide-react';
import { Toast } from './Toast';

interface Therapist {
  therapist_id: string;
  name: string;
  specializations: string[];
}

interface Schedule {
  schedule_id: number;
  name: string;
  availability: any;
}

interface FormQuestion {
  id: string;
  type: string;
  label: string;
  required: boolean;
  options?: string;
}

interface TherapyService {
  id?: number;
  title: string;
  duration: string;
  type: string;
  description: string;
  charges: string;
  slug?: string;
  therapist_id: string;
  therapist_name: string;
  payment_gateway: string;
  schedule_id?: number | null;
  form_questions: FormQuestion[];
  requires_tnc: boolean;
  is_payment_enabled: boolean;
}

const DEFAULT_QUESTIONS: FormQuestion[] = [
  { id: '1', type: 'text', label: 'Name', required: true },
  { id: '2', type: 'email', label: 'Email Address', required: true },
  { id: '3', type: 'tel', label: 'WhatsApp Number', required: true }
];

export function TherapyCalendarDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = id && id !== 'new';

  const [activeTab, setActiveTab] = useState<'basic' | 'form' | 'payment'>('basic');
  const [loading, setLoading] = useState(isEdit ? true : false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const [formData, setFormData] = useState<TherapyService>({
    title: '',
    duration: '50 Mins',
    type: 'Online',
    description: '',
    charges: '',
    therapist_id: '',
    therapist_name: '',
    payment_gateway: 'Razorpay',
    schedule_id: null,
    form_questions: DEFAULT_QUESTIONS,
    requires_tnc: true,
    is_payment_enabled: true
  });

  useEffect(() => {
    fetchInitialData();
  }, [id]);

  const fetchInitialData = async () => {
    try {
      const therRes = await fetch('/api/therapists');
      if (therRes.ok) {
        setTherapists(await therRes.json());
      }

      if (isEdit) {
        setLoading(true);
        const calRes = await fetch('/api/therapy-services');
        if (calRes.ok) {
          const allCals: TherapyService[] = await calRes.json();
          const target = allCals.find(c => c.id === Number(id));
          if (target) {
            setFormData({
              ...target,
              form_questions: (target.form_questions && target.form_questions.length > 0) 
                ? target.form_questions 
                : DEFAULT_QUESTIONS,
              requires_tnc: target.requires_tnc ?? true,
              is_payment_enabled: target.is_payment_enabled ?? true
            });
            if (target.therapist_id) {
              fetchSchedules(target.therapist_id);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setToast({ message: 'Failed to load details', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedules = async (therapistId: string) => {
    try {
      const res = await fetch(`/api/therapist-schedules/${therapistId}`);
      if (res.ok) {
        setSchedules(await res.json());
      }
    } catch (err) {
      console.error('Error fetching schedules:', err);
    }
  };

  const handleTherapistChange = (therapistId: string) => {
    const selected = therapists.find(t => t.therapist_id === therapistId);
    setFormData({
      ...formData,
      therapist_id: therapistId,
      therapist_name: selected?.name || '',
      title: '', // reset title since specializations change
      schedule_id: null
    });
    if (therapistId) {
      fetchSchedules(therapistId);
    } else {
      setSchedules([]);
    }
  };

  const handleSave = async () => {
    if (!formData.therapist_id || !formData.title) {
      setToast({ message: 'Therapist and Therapy Name are required', type: 'error' });
      return;
    }

    try {
      setSaving(true);
      const url = isEdit ? `/api/therapy-services/${id}` : '/api/therapy-services';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!res.ok) throw new Error('Failed to save');

      setToast({ message: `Calendar ${isEdit ? 'updated' : 'created'} successfully!`, type: 'success' });
      setTimeout(() => navigate('/admin/therapy-calendars'), 1500);
    } catch (err) {
      console.error('Save error:', err);
      setToast({ message: 'Failed to save calendar', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addQuestion = () => {
    setFormData({
      ...formData,
      form_questions: [
        ...formData.form_questions,
        { id: Date.now().toString(), type: 'text', label: '', required: false }
      ]
    });
  };

  const updateQuestion = (index: number, field: keyof FormQuestion, value: any) => {
    const updated = [...formData.form_questions];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, form_questions: updated });
  };

  const removeQuestion = (index: number) => {
    const updated = formData.form_questions.filter((_, i) => i !== index);
    setFormData({ ...formData, form_questions: updated });
  };

  const selectedTherapistObj = therapists.find(t => t.therapist_id === formData.therapist_id);
  const dynamicTherapyOptions = selectedTherapistObj?.specializations || [];

  if (loading) {
    return (
      <div className="h-full flex justify-center items-center bg-gray-50">
        <Loader className="animate-spin text-teal-600" size={32} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in bg-gray-50 overflow-y-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex items-center gap-4 mb-6">
        <button 
          onClick={() => navigate('/admin/therapy-calendars')}
          className="p-2 hover:bg-gray-200 rounded-full transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-teal-800">
            {isEdit ? 'Edit Therapy Calendar' : 'Create New Calendar'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isEdit ? 'Modify calendar details and settings' : 'Set up a new booking calendar for a therapist'}
          </p>
        </div>
        <div className="ml-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
          >
            {saving ? <Loader size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col mb-10">
        {/* Tabs Header */}
        <div className="flex border-b">
          {['basic', 'form', 'payment'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`flex-1 py-4 text-sm font-medium transition-colors ${
                activeTab === tab 
                  ? 'border-b-2 border-teal-600 text-teal-700 bg-teal-50/30' 
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} Settings
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-8">
          {/* ================= BASIC TAB ================= */}
          {activeTab === 'basic' && (
            <div className="space-y-6 max-w-4xl">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Therapist *</label>
                  <select
                    value={formData.therapist_id}
                    onChange={(e) => handleTherapistChange(e.target.value)}
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  >
                    <option value="">Select Therapist</option>
                    {therapists.map(t => (
                      <option key={t.therapist_id} value={t.therapist_id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Therapy Name *</label>
                  <select
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    disabled={!formData.therapist_id}
                  >
                    <option value="">Select Therapy Specialization</option>
                    {dynamicTherapyOptions.map((opt, i) => (
                      <option key={i} value={opt.trim()}>{opt.trim()}</option>
                    ))}
                    <option value="Free Consultation">Free Consultation</option>
                    <option value="Other">Other (Custom)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Availability Schedule</label>
                <select
                  value={formData.schedule_id || ''}
                  onChange={(e) => setFormData({ ...formData, schedule_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  disabled={!formData.therapist_id || schedules.length === 0}
                >
                  <option value="">{schedules.length > 0 ? 'Select a Schedule' : 'No schedules available for this therapist'}</option>
                  {schedules.map(s => (
                    <option key={s.schedule_id} value={s.schedule_id}>
                      {s.name} (ID: {s.schedule_id})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Select which live availability calendar applies to this service.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all min-h-[120px]"
                  placeholder="Enter detailed description of the therapy session..."
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Location Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                  >
                    <option value="Online">Online Video Call</option>
                    <option value="In Person">In Person</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Duration</label>
                  <input
                    type="text"
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    placeholder="e.g. 50 Mins"
                  />
                </div>
              </div>

              {isEdit && formData.slug && (
                <div className="bg-teal-50 p-4 rounded-lg border border-teal-100">
                  <span className="text-sm font-medium text-teal-800">Public Booking Link: </span>
                  <a href={`${window.location.origin}/book/${formData.slug.replace(/^\/+/, '')}`} target="_blank" rel="noreferrer" className="text-sm text-teal-600 hover:underline">
                    {`${window.location.origin}/book/${formData.slug.replace(/^\/+/, '')}`}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* ================= FORM TAB ================= */}
          {activeTab === 'form' && (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Booking Form Questions</h3>
                <p className="text-sm text-gray-500 mb-4">Define the information required from clients when booking this calendar.</p>
                
                <div className="space-y-4">
                  {formData.form_questions.map((q, idx) => (
                    <div key={q.id} className="flex gap-4 items-start p-4 bg-gray-50 border rounded-xl hover:shadow-md transition-shadow">
                      <div className="pt-3 text-gray-400 cursor-grab">
                        <GripVertical size={20} />
                      </div>
                      
                      <div className="flex-1 grid grid-cols-12 gap-4">
                        <div className="col-span-5">
                          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Question Label</label>
                          <input 
                            type="text" 
                            value={q.label}
                            onChange={(e) => updateQuestion(idx, 'label', e.target.value)}
                            placeholder="e.g. Full Name"
                            className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Type</label>
                          <select 
                            value={q.type}
                            onChange={(e) => updateQuestion(idx, 'type', e.target.value)}
                            className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                          >
                            <option value="text">Short Text</option>
                            <option value="textarea">Long Text (Paragraph)</option>
                            <option value="email">Email</option>
                            <option value="tel">Phone/WhatsApp</option>
                            <option value="dropdown">Dropdown Options</option>
                          </select>
                        </div>
                        <div className="col-span-3 flex items-center justify-between pt-6">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={q.required}
                              onChange={(e) => updateQuestion(idx, 'required', e.target.checked)}
                              className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Required</span>
                          </label>
                        </div>
                        
                        {q.type === 'dropdown' && (
                          <div className="col-span-12 mt-2">
                            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wider">Dropdown Options (Comma Separated)</label>
                            <input 
                              type="text" 
                              value={q.options || ''}
                              onChange={(e) => updateQuestion(idx, 'options', e.target.value)}
                              placeholder="e.g. Option 1, Option 2, Option 3"
                              className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                            />
                          </div>
                        )}
                      </div>

                      <button 
                        onClick={() => removeQuestion(idx)}
                        className="pt-2 text-red-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  ))}
                </div>
                
                <button 
                  onClick={addQuestion}
                  className="mt-4 flex items-center gap-2 text-teal-600 font-medium hover:text-teal-800 hover:bg-teal-50 px-4 py-2 rounded-lg transition-colors border border-dashed border-teal-200"
                >
                  <Plus size={18} />
                  Add New Question
                </button>
              </div>

              <div className="pt-6 border-t">
                <h3 className="text-lg font-bold text-gray-800 mb-4">Legal & Consent</h3>
                <label className="flex items-center gap-3 p-4 bg-gray-50 border rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={formData.requires_tnc}
                    onChange={(e) => setFormData({ ...formData, requires_tnc: e.target.checked })}
                    className="w-5 h-5 text-teal-600 rounded focus:ring-teal-500"
                  />
                  <div>
                    <span className="block font-medium text-gray-800">Require Terms & Conditions</span>
                    <span className="block text-sm text-gray-500">Clients must check a consent box before completing the booking.</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* ================= PAYMENT TAB ================= */}
          {activeTab === 'payment' && (
            <div className="space-y-6 max-w-4xl">
              <label className="flex items-center justify-between p-5 bg-gray-50 border rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
                <div>
                  <span className="block text-lg font-bold text-gray-800">Enable Payments</span>
                  <span className="block text-sm text-gray-500 mt-1">Require payment or display price during the booking process.</span>
                </div>
                <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_payment_enabled ? 'bg-teal-600' : 'bg-gray-300'}`}>
                  <input 
                    type="checkbox" 
                    className="sr-only"
                    checked={formData.is_payment_enabled}
                    onChange={(e) => setFormData({ ...formData, is_payment_enabled: e.target.checked })}
                  />
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_payment_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </div>
              </label>

              {formData.is_payment_enabled && (
                <div className="grid grid-cols-2 gap-6 p-6 border rounded-xl bg-white">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Price / Charges</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-gray-500 font-medium">₹</span>
                      <input
                        type="text"
                        value={formData.charges.replace(/[^0-9]/g, '')}
                        onChange={(e) => setFormData({ ...formData, charges: `₹${e.target.value}` })}
                        className="w-full border rounded-lg pl-8 pr-4 py-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all font-medium text-lg"
                        placeholder="1500"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Enter the numeric value. Symbol is added automatically.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Gateway</label>
                    <select
                      value={formData.payment_gateway}
                      onChange={(e) => setFormData({ ...formData, payment_gateway: e.target.value })}
                      className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    >
                      <option value="Razorpay">Razorpay (Live Payment)</option>
                      <option value="Offline">Offline / Manual Bank Transfer</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
