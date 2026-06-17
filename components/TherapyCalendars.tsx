import React, { useState, useEffect } from 'react';
import { User, Search, Loader, Plus, Copy, ExternalLink, ChevronDown, Trash2, Power, MoreVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
  therapist_is_active?: boolean;
}

export function TherapyCalendars() {
  const { user } = useAuth();
  const [calendars, setCalendars] = useState<TherapyService[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'delete' | 'deactivate' | 'activate', id: number, title: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [pendingOtpId, setPendingOtpId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
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
      setError('');
      const res = await fetch('/api/otp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: `Delete Calendar - ${confirmDialog.title}` })
      });
      const data = await res.json();
      setActionLoading(false);
      
      if (data.success) {
        setPendingOtpId(data.otpId);
        setPendingDeleteId(confirmDialog.id);
        setConfirmDialog(null);
        setOtpModalVisible(true);
      } else {
        setError('Failed to send OTP');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP for deletion');
      setActionLoading(false);
    }
  };

  const handleVerifyDeleteOtp = async () => {
    if (!otpInput || !pendingOtpId || !pendingDeleteId || otpLoading) return;
    setOtpLoading(true);
    setError('');
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpId: pendingOtpId, otp: otpInput })
      });
      const data = await res.json();
      if (data.success) {
        setError('');
        // Now actually delete
        const delRes = await fetch(`/api/therapy-calendars/${pendingDeleteId}`, { method: 'DELETE' });
        if (!delRes.ok) throw new Error('Failed to delete calendar');
        setCalendars(calendars.filter(c => c.id !== pendingDeleteId));
        setExpandedId(null);
        setOtpModalVisible(false);
        setOtpInput('');
      } else {
        setError(data.error || 'Invalid OTP');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify OTP');
    } finally {
      setOtpLoading(false);
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

  const handleActivateCalendar = async () => {
    if (!confirmDialog || confirmDialog.type !== 'activate') return;
    try {
      setActionLoading(true);
      const res = await fetch(`/api/therapy-calendars/${confirmDialog.id}/activate`, { method: 'PATCH' });
      if (!res.ok) throw new Error('Failed to activate calendar');
      setCalendars(calendars.map(c =>
        c.id === confirmDialog.id ? { ...c, is_active: true } : c
      ));
      setConfirmDialog(null);
      setExpandedId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to activate calendar');
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
          {user?.username !== 'Test' && (
            <button
              onClick={() => navigate('/admin/therapy-calendars/new')}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              <Plus size={18} />
              Create New Calendar
            </button>
          )}
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
        <div className="flex-1 flex flex-col overflow-y-auto pr-2 pb-10">
          {filteredCalendars.length > 0 ? (
            <div className="space-y-8">
              {Object.entries(
                filteredCalendars.reduce((acc, calendar) => {
                  const therapistName = calendar.therapist_name || 'Unassigned';
                  if (!acc[therapistName]) acc[therapistName] = [];
                  acc[therapistName].push(calendar);
                  return acc;
                }, {} as Record<string, TherapyService[]>)
              ).map(([therapistName, therapistCalendars]) => (
                <div key={therapistName} className="bg-transparent">
                  {/* Therapist Header */}
                  <div className="flex items-center gap-4 mb-4 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm" style={{ backgroundColor: '#21615D' }}>
                      {therapistName !== 'Unassigned' ? therapistName.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 flex items-center gap-3">
                      <h2 className="text-lg font-bold text-gray-900">{therapistName}</h2>
                      {therapistCalendars.length > 0 && therapistCalendars[0].therapist_is_active === false && (
                        <span className="text-[10px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-md uppercase tracking-wider">
                          Inactive
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Therapist's Calendars */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {therapistCalendars.map((item, index) => {
                      const cleanSlug = item.slug ? item.slug.replace(/^\/+/, '') : '';
                      const fullLink = `${window.location.origin}/book/${cleanSlug}`;

                      return (
                        <div
                          key={`${item.id}-${index}`}
                          className="bg-white rounded-xl shadow-sm border hover:shadow-md transition-all overflow-hidden flex flex-col cursor-pointer"
                          style={{ borderColor: '#E5E7EB' }}
                          onClick={() => navigate(`/admin/therapy-calendars/${item.id}`)}
                        >
                          <div className="p-5 flex-1">
                            <div className="flex justify-between items-start mb-3">
                              <h3 className="text-base font-bold text-gray-900 pr-4 leading-tight">{item.title}</h3>
                              {user?.username !== 'Test' && (
                                <div className="relative group flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <button className="text-gray-400 hover:text-gray-600 p-1">
                                    <MoreVertical size={18} />
                                  </button>
                                  {/* Dropdown Menu */}
                                  <div className="absolute right-0 mt-1 w-44 bg-white text-gray-800 rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleCopy(new MouseEvent('click') as any, fullLink, item.id); }}
                                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-xs flex items-center gap-2 border-b border-gray-100"
                                    >
                                      <Copy size={12} />
                                      Copy Link
                                    </button>
                                    <a
                                      href={fullLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-xs flex items-center gap-2 border-b border-gray-100"
                                    >
                                      <ExternalLink size={12} />
                                      Open Link
                                    </a>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setConfirmDialog({ type: 'delete', id: item.id, title: item.title }); }}
                                      className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 text-xs flex items-center gap-2"
                                    >
                                      <Trash2 size={12} />
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mb-4 flex-wrap">
                              <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium bg-gray-100 px-2.5 py-1 rounded-md">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {item.duration || '50 m'}
                              </div>
                              {item.google_calendar_connected && (
                                 <div className="text-[10px] font-bold text-blue-800 bg-blue-50 px-2 py-1 rounded-md uppercase tracking-wider border border-blue-100">
                                   Connected
                                 </div>
                              )}
                            </div>

                            <div 
                              className="text-sm text-gray-500 line-clamp-2 leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: item.description || 'No description provided.' }}
                            />
                          </div>

                          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                            {item.therapist_is_active === false ? (
                              <div className="text-xs text-red-500 font-medium truncate flex-1 pr-4">
                                Links disabled (Therapist Inactive)
                              </div>
                            ) : (
                              <>
                                <div className="text-sm text-gray-500 font-medium truncate flex-1 pr-4">
                                  /{cleanSlug}
                                </div>
                                <div className="flex items-center gap-4">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleCopy(e as any, fullLink, item.id); }}
                                    className="text-gray-400 hover:text-gray-600"
                                    title="Copy link"
                                  >
                                    {copiedId === item.id ? <span className="text-teal-600 text-xs font-bold">Copied!</span> : <Copy size={16} />}
                                  </button>
                                </div>
                              </>
                            )}
                            <div className="flex items-center gap-4 ml-4">
                              {/* Toggle switch for active/inactive */}
                              {user?.username !== 'Test' && (
                                <div 
                                  className={`w-10 h-5 flex items-center rounded-full p-1 cursor-pointer transition-colors ${item.is_active !== false ? 'bg-teal-600' : 'bg-gray-300'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDialog({ type: item.is_active !== false ? 'deactivate' : 'activate', id: item.id, title: item.title });
                                  }}
                                  title={item.is_active !== false ? 'Active' : 'Inactive'}
                                >
                                  <div className={`bg-white w-3.5 h-3.5 rounded-full shadow-sm transform transition-transform ${item.is_active !== false ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500 text-lg">No therapy calendars found.</p>
            </div>
          )}
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {confirmDialog.type === 'delete' ? 'Delete Calendar' : confirmDialog.type === 'activate' ? 'Activate Calendar' : 'Deactivate Calendar'}
            </h3>
            <p className="text-gray-600 mb-2">
              <strong>{confirmDialog.title}</strong>
            </p>
            <p className="text-gray-600 mb-6">
              {confirmDialog.type === 'delete'
                ? 'This will delete the calendar permanently.'
                : confirmDialog.type === 'activate'
                ? 'This will activate the calendar and allow accepting bookings.'
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
                onClick={confirmDialog.type === 'delete' ? handleDeleteCalendar : confirmDialog.type === 'activate' ? handleActivateCalendar : handleDeactivateCalendar}
                disabled={actionLoading}
                className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
                  confirmDialog.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : confirmDialog.type === 'activate'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-yellow-600 hover:bg-yellow-700'
                }`}
              >
                {actionLoading ? 'Processing...' : confirmDialog.type === 'delete' ? 'Delete' : confirmDialog.type === 'activate' ? 'Activate' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
      {otpModalVisible && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Admin OTP Verification</h3>
            <p className="text-sm text-gray-600 mb-4">
              Please enter the 6-digit OTP sent to the admin's Email and WhatsApp to confirm deletion.
            </p>
            <input
              type="text"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter OTP"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 outline-none text-center text-xl tracking-widest mb-6"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setOtpModalVisible(false); setOtpInput(''); }}
                disabled={otpLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyDeleteOtp}
                disabled={otpLoading || otpInput.length !== 6}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {otpLoading ? 'Verifying...' : 'Verify & Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
