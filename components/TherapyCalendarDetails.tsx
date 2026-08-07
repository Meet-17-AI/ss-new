import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader, Save, Plus, Trash2, GripVertical, Edit, Link, Copy, ExternalLink } from 'lucide-react';
import { Toast } from './Toast';
// @ts-ignore
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';

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
  therapy_type?: string;
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
  { id: '2', type: 'email', label: 'Email address', required: true },
  { id: '3', type: 'tel', label: 'Whatsapp Number', required: true },
  { id: '4', type: 'text', label: 'Emergency Contact Name', required: false },
  { id: '5', type: 'text', label: 'Emergency Contact Relation', required: false },
  { id: '6', type: 'tel', label: 'Emergency Contact Number', required: false },
  { id: '7', type: 'textarea', label: 'Please share anything that will help prepare for our meeting', required: false },
  { id: '8', type: 'checkbox', label: 'I confirm that I have read and agree to the Terms & Conditions.', required: true }
];

export function TherapyCalendarDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = id && id !== 'new';
  // Set by the per-therapist "Add New Therapy" card on the Therapies tab.
  const prefillTherapistId = searchParams.get('therapistId');

  // Instant-apply status toggle (create pages have no row to toggle yet).
  const [isActive, setIsActive] = useState(true);
  const [statusConfirm, setStatusConfirm] = useState<'activate' | 'deactivate' | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'basic' | 'form' | 'payment'>('basic');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit ? true : false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // null = unknown/loading, true/false = checked (#9: calendar management requires
  // a connected Google Calendar for the selected therapist)
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);

  const checkGoogleConnection = async (therapistId: string) => {
    if (!therapistId) { setGoogleConnected(null); return; }
    try {
      const res = await fetch(`/api/auth/google/status?therapistId=${encodeURIComponent(therapistId)}`);
      if (res.ok) {
        const data = await res.json();
        setGoogleConnected(!!data.connected);
      } else {
        // Fail open: an outage of the status check must not block admins
        setGoogleConnected(null);
      }
    } catch {
      setGoogleConnected(null);
    }
  };

  const [formData, setFormData] = useState<TherapyService>({
    title: '',
    duration: '50 Mins',
    type: 'Online',
    therapy_type: '',
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

  const getPublicLink = () => {
    if (!formData.slug) return '';
    const cleanSlug = formData.slug.replace(/^\/+/, '');
    return `${window.location.origin}/book/${cleanSlug}`;
  };

  const handleCopyLink = () => {
    const link = getPublicLink();
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  useEffect(() => {
    fetchInitialData();
  }, [id]);

  const fetchInitialData = async () => {
    try {
      const therRes = await fetch('/api/therapists');
      let therapistList: Therapist[] = [];
      if (therRes.ok) {
        therapistList = await therRes.json();
        setTherapists(therapistList);
      }

      // Prefill on create. Deliberately not routed through handleTherapistChange,
      // which blanks title/schedule_id — correct when a user switches therapists,
      // wrong for the initial fill.
      if (!isEdit && prefillTherapistId) {
        const preselected = therapistList.find(t => t.therapist_id === prefillTherapistId);
        if (preselected) {
          setFormData(prev => ({
            ...prev,
            therapist_id: preselected.therapist_id,
            therapist_name: preselected.name,
          }));
          // Populates the schedule dropdown and auto-selects the first schedule.
          fetchSchedules(preselected.therapist_id);
          checkGoogleConnection(preselected.therapist_id);
        }
      }

      if (isEdit) {
        setLoading(true);
        const calRes = await fetch('/api/services');
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
            setIsActive((target as any).is_active !== false);
            if (target.therapist_id) {
              fetchSchedules(target.therapist_id);
              checkGoogleConnection(target.therapist_id);
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
        const data = await res.json();
        setSchedules(data);
        if (data.length > 0) {
          setFormData(prev => {
            if (!prev.schedule_id) return { ...prev, schedule_id: data[0].schedule_id };
            return prev;
          });
        }
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
      checkGoogleConnection(therapistId);
    } else {
      setSchedules([]);
      setGoogleConnected(null);
    }
  };

  // Status applies immediately via the dedicated activate/deactivate endpoints,
  // independently of the form's Save — so it is gated behind a confirmation.
  const handleStatusChange = async () => {
    if (!statusConfirm || !isEdit) return;
    const targetActive = statusConfirm === 'activate';
    try {
      setStatusSaving(true);
      const res = await fetch(
        `/api/therapy-calendars/${id}/${targetActive ? 'activate' : 'deactivate'}`,
        { method: 'PATCH' }
      );
      if (!res.ok) throw new Error('Failed to update status');
      setIsActive(targetActive);
      setStatusConfirm(null);
      setToast({
        message: `Therapy ${targetActive ? 'activated' : 'deactivated'} successfully.`,
        type: 'success',
      });
    } catch (err) {
      console.error('Status change error:', err);
      setToast({ message: 'Failed to update therapy status', type: 'error' });
    } finally {
      setStatusSaving(false);
    }
  };

  const handleSave = async () => {
    if (!formData.therapist_id || !formData.title) {
      setToast({ message: 'Therapist and Therapy Name are required', type: 'error' });
      return;
    }
    // Block calendar creation when Google Calendar is not connected.
    // Existing calendars can still be edited.
    if (!isEdit && googleConnected === false) {
      setToast({ message: "This therapist's Google Calendar is not connected. Connect it in Settings → Calendars before creating new calendars.", type: 'error' });
      return;
    }

    try {
      setSaving(true);
      const url = isEdit ? `/api/services/${id}` : '/api/services';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!res.ok) throw new Error('Failed to save');

      const result = await res.json();
      setToast({ message: `Calendar ${isEdit ? 'updated' : 'created'} successfully!`, type: 'success' });

      if (isEdit) {
        // Refresh the current form data with any server changes (e.g. updated slug)
        setFormData(prev => ({ ...prev, ...result }));
        setTimeout(() => navigate('/admin/userSettings/therapies'), 1500);
      } else {
        // After creation, navigate to the edit page of the newly created service
        // so the admin can immediately see and copy the generated public link
        setTimeout(() => navigate(`/admin/userSettings/therapies/${result.id}`), 1200);
      }
    } catch (err) {
      console.error('Save error:', err);
      setToast({ message: 'Failed to save calendar', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addQuestion = () => {
    const newId = Date.now().toString();
    setFormData({
      ...formData,
      form_questions: [
        ...formData.form_questions,
        { id: newId, type: 'text', label: '', required: false }
      ]
    });
    setEditingQuestionId(newId);
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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updated = [...formData.form_questions];
    const [draggedQuestion] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, draggedQuestion);

    setFormData({ ...formData, form_questions: updated });
    setDraggedIndex(null);
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
    <div className="p-6 animate-fade-in bg-gray-50 min-h-full pb-20">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex items-center gap-4 mb-6">
        <button 
          onClick={() => navigate('/admin/userSettings/therapies')}
          className="p-2 hover:bg-gray-200 rounded-full transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-700" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-teal-800">
            {isEdit ? 'Edit Therapy' : 'Add New Therapy'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isEdit ? 'Modify therapy details and settings' : 'Set up a new therapy for a therapist'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {/* Status toggle — moved here from the therapy card. Applies at once,
              so it always asks first. */}
          {isEdit && (
            <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
              <button
                type="button"
                onClick={() => setStatusConfirm(isActive ? 'deactivate' : 'activate')}
                disabled={statusSaving}
                title={isActive ? 'Deactivate this therapy' : 'Activate this therapy'}
                className={`w-10 h-5 flex items-center rounded-full p-1 transition-colors disabled:opacity-50 ${
                  isActive ? 'bg-teal-600' : 'bg-gray-300'
                }`}
              >
                <div
                  className={`bg-white w-3.5 h-3.5 rounded-full shadow-sm transform transition-transform ${
                    isActive ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`text-sm font-medium ${isActive ? 'text-teal-700' : 'text-gray-500'}`}>
                {isActive ? 'Active' : 'Deactivated'}
              </span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving || (!isEdit && googleConnected === false)}
            className="flex items-center gap-2 px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
          >
            {saving ? <Loader size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Public Booking Link Banner — shown whenever a slug exists */}
      {isEdit && formData.slug && (
        <div className="flex items-center gap-3 bg-teal-600 text-white rounded-xl px-5 py-3 mb-6 shadow-sm">
          <Link size={18} className="shrink-0" />
          <span className="text-sm font-medium shrink-0">Public Booking Link:</span>
          <a
            href={getPublicLink()}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-teal-100 hover:text-white hover:underline flex-1 truncate"
          >
            {getPublicLink()}
          </a>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 shrink-0 bg-teal-700 hover:bg-teal-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          >
            {linkCopied ? 'Copied!' : <><Copy size={13} /> Copy</>}
          </button>
          <a
            href={getPublicLink()}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 bg-teal-700 hover:bg-teal-800 p-1.5 rounded-lg transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-10 pb-6">
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
                  {!isEdit && googleConnected === false && (
                    <p className="text-sm text-red-600 mt-2">
                      ⚠ This therapist's Google Calendar is not connected. Calendar creation is disabled until it is connected (Settings → Calendars).
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Therapy Name *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Individual Counseling"
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    disabled={!formData.therapist_id}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Therapy Type *</label>
                  <select
                    value={formData.therapy_type || ''}
                    onChange={(e) => setFormData({ ...formData, therapy_type: e.target.value })}
                    className="w-full border rounded-lg p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                    disabled={!formData.therapist_id}
                  >
                    <option value="">Select Therapy Type</option>
                    <option value="Individual Therapy">Individual Therapy</option>
                    <option value="Adolescent Therapy">Adolescent Therapy</option>
                    <option value="Couple Therapy">Couple Therapy</option>
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
                <p className="text-xs text-gray-500 mt-1 mb-3">Availability is synced automatically from the therapist's configuration.</p>
                
                {/* Displaying the selected schedule availability */}
                {formData.schedule_id && schedules.find(s => s.schedule_id === formData.schedule_id) && (
                  <div className="bg-white border rounded-lg p-4 mt-2">
                    <h4 className="text-sm font-bold text-gray-700 mb-3 border-b pb-2">Configured Availability</h4>
                    <div className="space-y-2">
                      {schedules.find(s => s.schedule_id === formData.schedule_id)?.availability?.map((dayObj: any, idx: number) => {
                        if (!dayObj.is_available || !dayObj.times || dayObj.times.length === 0) return null;
                        return (
                          <div key={idx} className="flex gap-4 text-sm">
                            <span className="w-24 font-medium text-gray-600 capitalize">{dayObj.day.toLowerCase()}</span>
                            <span className="text-gray-500">
                              {dayObj.times.map((t: any) => `${t.start} - ${t.end}`).join(', ')}
                            </span>
                          </div>
                        );
                      })}
                      {!schedules.find(s => s.schedule_id === formData.schedule_id)?.availability?.some((d: any) => d.is_available && d.times?.length > 0) && (
                        <span className="text-sm text-gray-400 italic">No active availability slots found for this schedule.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

                <div className="mb-8">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                  <div className="rounded-xl overflow-hidden border border-gray-200 focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-teal-500 transition-all bg-white shadow-sm">
                    <ReactQuill 
                      theme="snow"
                      value={formData.description}
                      onChange={(val: string) => setFormData({ ...formData, description: val })}
                      style={{ height: '200px' }}
                      placeholder="Enter detailed description of the therapy session..."
                    />
                  </div>
                </div>

              <div className="grid grid-cols-2 gap-6 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Location Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl p-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-teal-500 outline-none transition-all shadow-sm"
                  >
                    <option value="Online">Google Meet</option>
                    <option value="In Person">In-Person</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Duration</label>
                  <div className="flex items-stretch w-full border border-gray-200 rounded-xl bg-gray-50 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500 overflow-hidden transition-all shadow-sm">
                    <input
                      type="number"
                      min="1"
                      step="5"
                      value={formData.duration.replace(/\D/g, '')}
                      onChange={(e) => setFormData({ ...formData, duration: `${e.target.value} Mins` })}
                      className="w-full p-3 bg-transparent outline-none"
                      placeholder="50"
                    />
                    <div className="px-4 text-gray-500 font-medium bg-gray-100 border-l border-gray-200 flex items-center justify-center pointer-events-none">
                      Mins
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ================= FORM TAB ================= */}
          {activeTab === 'form' && (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Booking Form Questions</h3>
                <p className="text-sm text-gray-500 mb-4">Define the information required from clients when booking this calendar.</p>
                
                <div className="space-y-4">
                  {formData.form_questions.map((q, idx) => {
                    const isEditing = editingQuestionId === q.id;

                    return (
                      <div 
                        key={q.id} 
                        draggable={!isEditing}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                        className={`flex flex-col bg-white border rounded-xl overflow-hidden hover:shadow-md transition-all ${isEditing ? 'ring-2 ring-teal-500' : ''} ${draggedIndex === idx ? 'opacity-50 scale-95 border-teal-200' : ''}`}
                      >
                        {isEditing ? (
                          <div className="flex gap-4 items-start p-6 bg-gray-50">
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
                                  autoFocus
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
                                  <option value="checkbox">Checkbox</option>
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
                              
                              <div className="col-span-12 flex justify-end mt-4">
                                <button
                                  onClick={() => setEditingQuestionId(null)}
                                  className="px-6 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between p-4">
                            <div className="flex items-center gap-4">
                              <GripVertical size={20} className="text-gray-300 cursor-grab" />
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-800">{q.label || 'Untitled Question'}</span>
                                  {q.required && <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">Required</span>}
                                </div>
                                <span className="text-xs text-gray-400 mt-0.5 capitalize">{q.type === 'tel' ? 'Phone/WhatsApp' : q.type}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-6 pr-2">
                              <button 
                                onClick={() => setEditingQuestionId(q.id)} 
                                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
                              >
                                <Edit size={16} /> Edit
                              </button>
                              <button 
                                onClick={() => removeQuestion(idx)} 
                                className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 size={16} /> Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                <button 
                  onClick={addQuestion}
                  className="mt-6 flex items-center justify-center gap-2 w-full text-teal-600 font-medium hover:text-teal-800 hover:bg-teal-50 p-4 rounded-xl transition-colors border-2 border-dashed border-teal-200"
                >
                  <Plus size={18} />
                  Add Question
                </button>
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

      {statusConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {statusConfirm === 'deactivate' ? 'Deactivate this therapy?' : 'Activate this therapy?'}
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              {statusConfirm === 'deactivate' ? (
                <>
                  <span className="font-semibold">{formData.title}</span> will stop accepting new
                  bookings and its public booking link will be disabled immediately. Existing
                  bookings are not affected.
                </>
              ) : (
                <>
                  <span className="font-semibold">{formData.title}</span> will accept bookings again
                  and its public link will go live immediately.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setStatusConfirm(null)}
                disabled={statusSaving}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusChange}
                disabled={statusSaving}
                className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
                  statusConfirm === 'deactivate'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-teal-600 hover:bg-teal-700'
                }`}
              >
                {statusSaving
                  ? 'Working...'
                  : statusConfirm === 'deactivate' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
