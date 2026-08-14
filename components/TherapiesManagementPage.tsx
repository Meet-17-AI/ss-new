import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, ArrowLeft, Loader, Check, X, ShieldAlert } from 'lucide-react';

interface TherapyService {
  id: number;
  title: string;
  duration: string;
  type: string;
  description: string;
  detailed_description: string;
  edit_view_description: string;
  charges: number;
  slug: string;
  label: string;
  therapist_id: string;
  therapist_name: string;
  schedule_id: string | null;
  is_active: boolean;
}

interface Therapist {
  therapist_id: string;
  name: string;
}

interface TherapistResource {
  schedule_id: string;
  resource_name: string;
  therapy_name: string;
}

export const TherapiesManagementPage: React.FC = () => {
  const [services, setServices] = useState<TherapyService[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [resources, setResources] = useState<TherapistResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<TherapyService | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('50 Mins');
  const [type, setType] = useState('Individual');
  const [description, setDescription] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [editViewDescription, setEditViewDescription] = useState('');
  const [charges, setCharges] = useState(1700);
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('Online (Video Call)');
  const [selectedTherapistId, setSelectedTherapistId] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Load services and therapists
  const fetchData = async () => {
    setLoading(true);
    try {
      const [servicesRes, therapistsRes] = await Promise.all([
        fetch('/api/services'),
        fetch('/api/therapists')
      ]);

      if (servicesRes.ok && therapistsRes.ok) {
        const servicesData = await servicesRes.json();
        const therapistsData = await therapistsRes.json();
        setServices(servicesData);
        // Map therapist objects ensuring therapist_id is set
        setTherapists(
          therapistsData.map((t: any) => ({
            therapist_id: t.therapist_id,
            name: t.name
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching therapies management data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch schedules/resources when selected therapist changes
  useEffect(() => {
    if (!selectedTherapistId) {
      setResources([]);
      return;
    }
    const fetchResources = async () => {
      try {
        const res = await fetch(`/api/therapist-resources?therapist_id=${encodeURIComponent(selectedTherapistId)}`);
        if (res.ok) {
          const data = await res.json();
          setResources(data.resources || []);
        }
      } catch (error) {
        console.error('Error fetching therapist resources:', error);
      }
    };
    fetchResources();
  }, [selectedTherapistId]);

  // Open modal for adding new service
  const handleAddNew = () => {
    setEditingService(null);
    setTitle('');
    setDuration('50 Mins');
    setType('Individual');
    setDescription('');
    setDetailedDescription('');
    setEditViewDescription('');
    setCharges(1700);
    setSlug('');
    setLabel('Online (Video Call)');
    setSelectedTherapistId(therapists[0]?.therapist_id || '');
    setSelectedScheduleId('');
    setIsActive(true);
    setShowModal(true);
  };

  // Open modal for editing service
  const handleEdit = (service: TherapyService) => {
    setEditingService(service);
    setTitle(service.title);
    setDuration(service.duration);
    setType(service.type);
    setDescription(service.description);
    setDetailedDescription(service.detailed_description);
    setEditViewDescription(service.edit_view_description);
    setCharges(service.charges);
    setSlug(service.slug.replace(/^\//, ''));
    setLabel(service.label);
    setSelectedTherapistId(service.therapist_id);
    setSelectedScheduleId(service.schedule_id || '');
    setIsActive(service.is_active);
    setShowModal(true);
  };

  // Delete service
  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this therapy service?')) return;
    try {
      const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
      if (res.ok) {
        alert('Service deleted successfully.');
        fetchData();
      } else {
        const err = await res.json();
        alert(`Failed to delete service: ${err.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Network error occurred.');
    }
  };

  // Submit Add/Edit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !slug || !selectedTherapistId) {
      alert('Please fill out all required fields.');
      return;
    }

    const therapistName = therapists.find(t => t.therapist_id === selectedTherapistId)?.name || 'SafeStories';
    const payload = {
      title,
      duration,
      type,
      description,
      detailed_description: detailedDescription,
      edit_view_description: editViewDescription,
      charges: Number(charges),
      slug: slug.startsWith('/') ? slug : '/' + slug,
      label,
      therapist_id: selectedTherapistId,
      therapist_name: therapistName,
      schedule_id: selectedScheduleId || null,
      is_active: isActive
    };

    try {
      const url = editingService ? `/api/services/${editingService.id}` : '/api/services';
      const method = editingService ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert(editingService ? 'Service updated successfully.' : 'Service created successfully.');
        setShowModal(false);
        fetchData();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (error) {
      console.error(error);
      alert('Network error occurred.');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 text-gray-800">
      {/* Header Panel */}
      <div className="bg-white border-b border-gray-200 px-8 py-6 flex items-center justify-between shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Therapies Management</h2>
          <p className="text-sm text-gray-500 mt-1">Configure individual, couple, or adolescent therapy services and map schedules.</p>
        </div>
        <button
          onClick={handleAddNew}
          className="flex items-center gap-2 bg-teal-700 hover:bg-teal-800 text-white px-5 py-2.5 rounded-lg font-medium transition-all shadow-sm active:scale-95"
        >
          <Plus size={18} />
          Add Therapy Service
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-8">
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader className="animate-spin text-teal-700" size={40} />
          </div>
        ) : services.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm max-w-lg mx-auto mt-8">
            <ShieldAlert className="text-gray-400 mx-auto mb-4" size={48} />
            <h3 className="text-lg font-semibold text-gray-800">No Therapy Services</h3>
            <p className="text-gray-500 mt-2">Click the button above to add your first therapy service to the system.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="px-6 py-4">Service Details</th>
                    <th className="px-6 py-4">Therapist / Owner</th>
                    <th className="px-6 py-4">Pricing & Duration</th>
                    <th className="px-6 py-4">Availability Connection</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 text-sm">
                  {services.map((service) => (
                    <tr key={service.id} className="hover:bg-gray-50/80 transition-colors">
                      {/* Service Details */}
                      <td className="px-6 py-5">
                        <div className="font-semibold text-gray-900">{service.title}</div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                          <span className="bg-teal-50 text-teal-700 font-medium px-2 py-0.5 rounded border border-teal-100">
                            {service.type}
                          </span>
                          <span className="text-gray-400">|</span>
                          <span>{service.label}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 font-mono">{service.slug}</div>
                      </td>

                      {/* Therapist / Owner */}
                      <td className="px-6 py-5">
                        <div className="font-medium text-gray-800">{service.therapist_name}</div>
                        <div className="text-xs text-gray-400 font-mono">ID: {service.therapist_id}</div>
                      </td>

                      {/* Pricing & Duration */}
                      <td className="px-6 py-5">
                        <div className="font-semibold text-gray-900">₹{service.charges}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{service.duration}</div>
                      </td>

                      {/* Availability Connection */}
                      <td className="px-6 py-5">
                        {service.schedule_id ? (
                          <div className="flex flex-col">
                            <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1 rounded border border-blue-100 w-max">
                              ID: {service.schedule_id}
                            </span>
                            <span className="text-xs text-gray-400 mt-1">Custom Schedule Linked</span>
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            <span className="bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded border border-amber-100 w-max">
                              Default
                            </span>
                            <span className="text-xs text-gray-400 mt-1">Google Cal Primary fallback</span>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-5">
                        {service.is_active ? (
                          <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-100">
                            <Check size={12} /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-200">
                            <X size={12} /> Inactive
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(service)}
                            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600 transition-colors"
                            title="Edit Service"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(service.id)}
                            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-red-600 transition-colors"
                            title="Delete Service"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Modal Overlay */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-gray-100 overflow-hidden flex flex-col my-8">
            <div className="bg-teal-700 text-white px-6 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg">
                {editingService ? 'Edit Therapy Service' : 'Add New Therapy Service'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              {/* Row 1: Title & Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Therapy Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Individual Therapy"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Therapy Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors bg-white"
                  >
                    <option value="Individual">Individual</option>
                    <option value="Couples">Couples</option>
                    <option value="Adolescent">Adolescent</option>
                    <option value="Family">Family</option>
                    <option value="Group">Group</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Duration & Charges */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Duration <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="e.g. 50 Mins"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Charges (₹ INR) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    value={charges}
                    onChange={(e) => setCharges(Number(e.target.value))}
                    placeholder="1700"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
              </div>

              {/* Row 3: Slug & Label */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Internal Slug (read-only)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 text-sm font-mono">/book/</span>
                    <input
                      type="text"
                      readOnly
                      value={slug}
                      placeholder="generated automatically"
                      title="Generated automatically. Changing it would break booking links already sent to clients."
                      className="w-full pl-16 pr-4 py-2 border border-gray-200 bg-gray-50 text-gray-500 rounded-lg cursor-not-allowed transition-colors font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Location Label
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Online (Video Call)"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>
              </div>

              {/* Row 4: Assigned Therapist & Schedule Mapping */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Assign Therapist <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedTherapistId}
                    onChange={(e) => setSelectedTherapistId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors bg-white"
                  >
                    {therapists.map((t) => (
                      <option key={t.therapist_id} value={t.therapist_id}>
                        {t.name} ({t.therapist_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Calendar / Availability Connection
                  </label>
                  <select
                    value={selectedScheduleId}
                    onChange={(e) => setSelectedScheduleId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors bg-white"
                  >
                    <option value="">Default (Google Calendar Primary Busy filter)</option>
                    {resources.map((res) => (
                      <option key={res.schedule_id} value={res.schedule_id}>
                        {res.resource_name} ({res.therapy_name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Description inputs */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                  Card Short Description (visible on main booking page)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief 1-2 sentence overview shown in the booking card."
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                  Detailed Description (top header on selected slot view)
                </label>
                <textarea
                  value={detailedDescription}
                  onChange={(e) => setDetailedDescription(e.target.value)}
                  placeholder="Detailed context and expectations for the user during booking."
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                  Edit View Description
                </label>
                <textarea
                  value={editViewDescription}
                  onChange={(e) => setEditViewDescription(e.target.value)}
                  placeholder="Internal description or helper notes."
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <input
                  type="checkbox"
                  id="isActiveToggle"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="isActiveToggle" className="text-sm font-semibold text-gray-700 cursor-pointer select-none">
                  Service is active and open for public bookings
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition-colors font-medium shadow-sm active:scale-95"
                >
                  {editingService ? 'Save Changes' : 'Create Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
