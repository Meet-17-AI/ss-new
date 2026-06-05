import React, { useState, useEffect } from 'react';
import { User, Search, Loader, Plus, Copy, ExternalLink, ChevronDown, Trash2, Power } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  schedule_id?: number;
  google_calendar_connected?: boolean;
  is_active?: boolean;
}

export function TherapyCalendars() {
  const [calendars, setCalendars] = useState<TherapyService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'delete' | 'deactivate', id: number, title: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();

  const handleCopy = (e: React.MouseEvent, link: string, id: number) => {
    e.stopPropagation();
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const calRes = await fetch('/api/services');
      if (!calRes.ok) throw new Error('Failed to fetch data');
      const calData = await calRes.json();
      setCalendars(calData);
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

  const handleDeleteCalendar = async () => {
    if (!confirmDialog || confirmDialog.type !== 'delete') return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/therapy-calendars/${confirmDialog.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete calendar');
      setCalendars(calendars.filter(c => c.id !== confirmDialog.id));
      setConfirmDialog(null);
      setExpandedId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete calendar');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivateCalendar = async () => {
    if (!confirmDialog || confirmDialog.type !== 'deactivate') return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/therapy-calendars/${confirmDialog.id}/deactivate`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to deactivate calendar');
      setCalendars(calendars.map(c =>
        c.id === confirmDialog.id ? { ...c, is_active: false } : c
      ));
      setConfirmDialog(null);
      setExpandedId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate calendar');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in bg-gray-50">
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
            onClick={() => navigate('/admin/therapy-calendars/new')}
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
                    Public Booking Link
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sync Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredCalendars.length > 0 ? (
                  filteredCalendars.map((item, index) => {
                    const cleanSlug = item.slug ? item.slug.replace(/^\/+/, '') : '';
                    const fullLink = `${window.location.origin}/book/${cleanSlug}`;
                    const isExpanded = expandedId === item.id;
                    return (
                      <React.Fragment key={`${item.id}-${index}`}>
                        <tr
                          className="hover:bg-teal-50 transition-colors cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <ChevronDown size={16} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              <div className="text-sm font-medium text-gray-900">
                                {item.title}
                              </div>
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
                          <td className="px-6 py-4" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2 max-w-xs">
                              <a
                                href={fullLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-teal-600 hover:text-teal-800 hover:underline truncate"
                                title={fullLink}
                              >
                                {fullLink.replace(/^https?:\/\/[^/]+/, '')}
                              </a>
                            </div>
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
                          <td className="px-6 py-4 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={e => handleCopy(e, fullLink, item.id)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition-colors"
                                title="Copy public link"
                              >
                                <Copy size={13} />
                                {copiedId === item.id ? 'Copied!' : 'Copy Link'}
                              </button>
                              <a
                                href={fullLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                                title="Open public booking page"
                              >
                                <ExternalLink size={13} />
                                Open
                              </a>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-gray-50">
                            <td colSpan={5} className="px-6 py-4">
                              <div className="flex gap-3 border-t border-gray-200 pt-4">
                                <button
                                  onClick={() => setConfirmDialog({ type: 'deactivate', id: item.id, title: item.title })}
                                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100 transition-colors"
                                >
                                  <Power size={16} />
                                  Deactivate Calendar
                                </button>
                                <button
                                  onClick={() => setConfirmDialog({ type: 'delete', id: item.id, title: item.title })}
                                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                                >
                                  <Trash2 size={16} />
                                  Delete Calendar
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                      No therapy calendars found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {confirmDialog.type === 'delete' ? 'Delete Calendar' : 'Deactivate Calendar'}
            </h3>
            <p className="text-gray-600 mb-2">
              <strong>{confirmDialog.title}</strong>
            </p>
            <p className="text-gray-600 mb-6">
              {confirmDialog.type === 'delete'
                ? 'This will delete the calendar permanently.'
                : 'This will deactivate the calendar and stop accepting bookings.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.type === 'delete' ? handleDeleteCalendar : handleDeactivateCalendar}
                disabled={actionLoading}
                className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
                  confirmDialog.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-yellow-600 hover:bg-yellow-700'
                }`}
              >
                {actionLoading ? 'Processing...' : confirmDialog.type === 'delete' ? 'Delete' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
