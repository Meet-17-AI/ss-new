import React, { useState, useEffect } from 'react';
import { Calendar, User, Search, Loader, Plus, X } from 'lucide-react';
import { Toast } from './Toast';

interface Therapist {
  therapist_id: string;
  name: string;
  specializations: string[];
  google_calendar_connected: boolean;
}

interface TherapyService {
  id: number;
  title: string;
  duration: string;
  type: string;
  description: string;
  charges: string;
  slug: string;
  therapist_id: string;
  therapist_name: string;
  payment_gateway: string;
  google_calendar_connected?: boolean;
}

export function TherapyCalendars() {
  const [calendars, setCalendars] = useState<TherapyService[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<Partial<TherapyService> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [calRes, therRes] = await Promise.all([
        fetch('/api/therapy-services'),
        fetch('/api/therapists')
      ]);
      
      if (!calRes.ok || !therRes.ok) throw new Error('Failed to fetch data');
      
      const calData = await calRes.json();
      const therData = await therRes.json();
      
      setCalendars(calData);
      setTherapists(therData);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      setError('Failed to load therapy calendars');
    } finally {
      setLoading(false);
    }
  };

  const filteredCalendars = calendars.filter(item => 
    item.therapist_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenEdit = (cal: TherapyService) => {
    setEditingCalendar(cal);
    setIsModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingCalendar({
      title: '',
      therapist_id: '',
      therapist_name: '',
      description: '',
      charges: '',
      type: 'Online',
      payment_gateway: 'Razorpay'
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!editingCalendar?.therapist_id || !editingCalendar?.title) {
      setToast({ message: 'Therapist and Therapy Name are required', type: 'error' });
      return;
    }

    try {
      setIsSaving(true);
      const isEdit = !!editingCalendar.id;
      const url = isEdit ? `/api/therapy-services/${editingCalendar.id}` : '/api/therapy-services';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingCalendar)
      });

      if (!res.ok) throw new Error('Failed to save calendar');

      setToast({ message: `Calendar ${isEdit ? 'updated' : 'created'} successfully!`, type: 'success' });
      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Save error:', err);
      setToast({ message: 'Failed to save calendar', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  // Get dynamic therapy options based on selected therapist
  const selectedTherapistObj = therapists.find(t => t.therapist_id === editingCalendar?.therapist_id);
  const dynamicTherapyOptions = selectedTherapistObj?.specializations || [];

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in bg-gray-50">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-teal-800">Therapy Calendars</h1>
          <p className="text-gray-500 text-sm mt-1">Manage and view all therapist booking calendars</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search therapy or therapist..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 w-64"
            />
            <Search size={18} className="absolute left-3 top-2.5 text-gray-400" />
          </div>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus size={18} />
            Create New Calendar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded-lg mb-6 flex justify-between">
          {error}
          <button onClick={() => setError('')} className="font-bold">&times;</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex justify-center items-center">
          <Loader className="animate-spin text-teal-600" size={32} />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex-1 flex flex-col">
          <div className="overflow-x-auto flex-1">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Therapy Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Therapist Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Calendar Link
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sync Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCalendars.length > 0 ? (
                  filteredCalendars.map((item, index) => {
                    // Slug in DB might already have a leading slash, e.g. "/session-with-ishika"
                    const cleanSlug = item.slug ? item.slug.replace(/^\/+/, '') : '';
                    const fullLink = `${window.location.origin}/book/${cleanSlug}`;
                    return (
                      <tr 
                        key={`${item.id}-${index}`} 
                        className="hover:bg-teal-50 transition-colors cursor-pointer"
                        onClick={() => handleOpenEdit(item)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {item.title}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="h-8 w-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold mr-3">
                              <User size={16} />
                            </div>
                            <div className="text-sm font-medium text-gray-900">{item.therapist_name}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <a 
                            href={fullLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-teal-600 hover:text-teal-800 hover:underline flex items-center gap-1"
                          >
                            {fullLink.replace(/^https?:\/\//, '')}
                          </a>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {item.google_calendar_connected ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              Google Connected
                            </span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                              Not Connected
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                      No therapy calendars found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && editingCalendar && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b sticky top-0 bg-white z-10">
              <h2 className="text-xl font-bold text-gray-800">
                {editingCalendar.id ? 'Edit Therapy Calendar' : 'Create New Calendar'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:bg-gray-100 rounded-full p-1">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Therapist</label>
                  <select
                    value={editingCalendar.therapist_id || ''}
                    onChange={(e) => {
                      const selected = therapists.find(t => t.therapist_id === e.target.value);
                      setEditingCalendar({ 
                        ...editingCalendar, 
                        therapist_id: e.target.value, 
                        therapist_name: selected?.name || '',
                        title: '' // Reset title when therapist changes
                      });
                    }}
                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                  >
                    <option value="">Select Therapist</option>
                    {therapists.map(t => (
                      <option key={t.therapist_id} value={t.therapist_id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Therapy Name</label>
                  <select
                    value={editingCalendar.title || ''}
                    onChange={(e) => setEditingCalendar({ ...editingCalendar, title: e.target.value })}
                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                    disabled={!editingCalendar.therapist_id}
                  >
                    <option value="">Select Therapy</option>
                    {dynamicTherapyOptions.map((opt, i) => (
                      <option key={i} value={opt.trim()}>{opt.trim()}</option>
                    ))}
                    <option value="Free Consultation">Free Consultation</option>
                    <option value="Other">Other (Custom)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editingCalendar.description || ''}
                  onChange={(e) => setEditingCalendar({ ...editingCalendar, description: e.target.value })}
                  className="w-full border rounded-lg p-2.5 min-h-[100px] focus:ring-2 focus:ring-teal-500 outline-none"
                  placeholder="Enter calendar description..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price / Charges</label>
                  <input
                    type="text"
                    value={editingCalendar.charges || ''}
                    onChange={(e) => setEditingCalendar({ ...editingCalendar, charges: e.target.value })}
                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                    placeholder="e.g. ₹1500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <select
                    value={editingCalendar.type || 'Online'}
                    onChange={(e) => setEditingCalendar({ ...editingCalendar, type: e.target.value })}
                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                  >
                    <option value="Online">Online Video Call</option>
                    <option value="In Person">In Person (Pune)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Gateway</label>
                  <select
                    value={editingCalendar.payment_gateway || 'Razorpay'}
                    onChange={(e) => setEditingCalendar({ ...editingCalendar, payment_gateway: e.target.value })}
                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-teal-500 outline-none"
                  >
                    <option value="Razorpay">Razorpay</option>
                    <option value="Offline">Offline / Manual</option>
                    <option value="None">None</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center"
              >
                {isSaving ? <Loader size={18} className="animate-spin" /> : 'Save Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
