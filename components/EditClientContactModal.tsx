import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Toast } from './Toast';

interface EditClientContactModalProps {
  isOpen: boolean;
  client: { name: string; phone: string; email: string; client_type: string };
  onClose: () => void;
  onSaved: (updated: { name: string; phone: string; email: string; client_type: string }) => void;
  adminUser?: any;
}

export const EditClientContactModal: React.FC<EditClientContactModalProps> = ({
  isOpen, client, onClose, onSaved, adminUser
}) => {
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone);
  const [email, setEmail] = useState(client.email);
  const [clientType, setClientType] = useState(client.client_type || 'Indian');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Reset when client changes
  React.useEffect(() => {
    setName(client.name);
    setPhone(client.phone);
    setEmail(client.email);
    setClientType(client.client_type || 'Indian');
  }, [client.name, client.phone, client.email, client.client_type]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setToast({ message: 'Name cannot be empty', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/clients/update-contact', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_phone: client.phone || undefined,
          old_email: client.email || undefined,
          new_name: name !== client.name ? name : undefined,
          new_phone: phone !== client.phone ? phone : undefined,
          new_email: email !== client.email ? email : undefined,
          new_client_type: clientType !== client.client_type ? clientType : undefined,
          _audit_user: { id: adminUser?.id, name: adminUser?.full_name || adminUser?.username || 'Admin' }
        })
      });
      if (res.ok) {
        setToast({ message: 'Client updated successfully!', type: 'success' });
        setTimeout(() => {
          onSaved({ name, phone, email, client_type: clientType });
          onClose();
        }, 800);
      } else {
        const err = await res.json();
        setToast({ message: err.error || 'Failed to update client', type: 'error' });
      }
    } catch {
      setToast({ message: 'Network error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">Edit Client Contact</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Client Type</label>
            <select
              value={clientType}
              onChange={e => setClientType(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm bg-white"
            >
              <option value="Indian">Indian</option>
              <option value="NRI">NRI</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 font-medium text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};
