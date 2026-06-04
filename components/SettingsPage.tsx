import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { ReportIssuePage } from './ReportIssuePage';
import { AuditLogs } from './AuditLogs';
import { TherapiesManagementPage } from './TherapiesManagementPage';
import { PaymentSettings } from './PaymentSettings';
import { ArrowLeft, AlertCircle, FileText, Calendar, Heart, Search, RefreshCw, CreditCard } from 'lucide-react';

interface SettingsPageProps {
  onBack: () => void;
  user: any;
}

interface TherapistCalendarInfo {
  therapist_id: string;
  name: string;
  contact_info: string;
  profile_picture_url: string;
  connected: boolean;
  google_email: string | null;
}

const CalendarConnectionsAdmin: React.FC = () => {
  const [therapists, setTherapists] = useState<TherapistCalendarInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCalendars = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/therapists-calendars');
      if (res.ok) {
        const data = await res.json();
        setTherapists(data);
      }
    } catch (err) {
      console.error('Error fetching calendar connections:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendars();
  }, []);

  const handleConnect = (therapistId: string) => {
    window.location.href = `/api/auth/google?therapistId=${therapistId}&adminRedirect=true`;
  };

  const handleDisconnect = async (therapistId: string) => {
    if (confirm(`Are you sure you want to disconnect Google Calendar?`)) {
      try {
        setActionLoading(therapistId);
        const res = await fetch('/api/auth/google/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ therapistId })
        });
        if (res.ok) {
          setTherapists(prev => 
            prev.map(t => 
              t.therapist_id === therapistId 
                ? { ...t, connected: false, google_email: null } 
                : t
            )
          );
        } else {
          alert('Failed to disconnect Google Calendar.');
        }
      } catch (err) {
        console.error(err);
        alert('An error occurred while disconnecting.');
      } finally {
        setActionLoading(null);
      }
    }
  };

  const filteredTherapists = Array.isArray(therapists) ? therapists.filter(t => {
    const nameStr = t.name || '';
    return nameStr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.google_email && t.google_email.toLowerCase().includes(searchQuery.toLowerCase()));
  }) : [];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <RefreshCw className="animate-spin text-teal-600" size={32} />
        <span className="text-gray-500 font-medium">Loading calendar connections...</span>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col h-full bg-white">
      {/* Header and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-800 font-sans">Google Calendar Connections</h2>
          <p className="text-sm text-gray-500 mt-1">
            Connect and sync therapist/platform calendars with Google Calendar for direct booking integration.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
          />
        </div>
      </div>

      {/* Calendar List */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {filteredTherapists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            <Calendar size={40} className="text-gray-300 mb-2" />
            <p className="text-gray-500 font-medium">No calendars found matching "{searchQuery}"</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredTherapists.map((therapist) => {
              const isPlatform = therapist.therapist_id === 'SafeStories';
              return (
                <div
                  key={therapist.therapist_id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all ${
                    isPlatform 
                      ? 'bg-teal-50/30 border-teal-200 shadow-sm' 
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Profile Image / Avatar */}
                    {isPlatform ? (
                      <div className="w-12 h-12 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                        SS
                      </div>
                    ) : therapist.profile_picture_url ? (
                      <img
                        src={therapist.profile_picture_url}
                        alt={therapist.name}
                        className="w-12 h-12 rounded-full object-cover border border-gray-200"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          const fallback = (e.target as HTMLImageElement).nextSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    {/* Fallback Initial Avatar */}
                    {(!therapist.profile_picture_url && !isPlatform) || (therapist.profile_picture_url && !isPlatform) ? (
                      <div 
                        className="w-12 h-12 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-semibold text-base"
                        style={{ display: therapist.profile_picture_url && !isPlatform ? 'none' : 'flex' }}
                      >
                        {(therapist.name || 'Unknown').split(' ').map((n: string) => n[0] || '').join('').substring(0, 2).toUpperCase()}
                      </div>
                    ) : null}

                    {/* Name & Details */}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-800">{therapist.name}</span>
                        {isPlatform && (
                          <span className="px-2 py-0.5 bg-teal-100 text-teal-800 text-[10px] font-bold uppercase tracking-wider rounded">
                            Platform
                          </span>
                        )}
                        {therapist.connected ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200">
                            Disconnected
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {therapist.connected && `Google Email: ${therapist.google_email}`}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 sm:mt-0 flex items-center gap-3">
                    {therapist.connected ? (
                      <button
                        onClick={() => handleDisconnect(therapist.therapist_id)}
                        disabled={actionLoading !== null}
                        className="px-4 py-2 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 font-medium text-sm rounded-lg transition-colors flex items-center gap-2"
                      >
                        {actionLoading === therapist.therapist_id ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : null}
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(therapist.therapist_id)}
                        disabled={actionLoading !== null}
                        className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 font-medium text-sm rounded-lg transition-all flex items-center gap-2 hover:shadow-sm"
                      >
                        Connect Google Calendar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, user }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.split('/').pop() || 'menu';

  // handleBack redirects to the main appSettings (menu) or parent
  const handleBack = () => {
    if (activeTab === 'appSettings' || activeTab === 'menu') {
      onBack();
    } else {
      navigate('/admin/appSettings');
    }
  };

  return (
    <div className="p-8 h-full flex flex-col bg-gray-50">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={handleBack} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
          <ArrowLeft size={24} className="text-gray-700" />
        </button>
        <h1 className="text-3xl font-bold">
          {activeTab === 'menu' 
            ? 'Settings' 
            : activeTab === 'report' 
            ? 'Report an Issue' 
            : activeTab === 'audit' 
            ? 'Audit Logs' 
            : activeTab === 'therapies'
            ? 'Therapies Management'
            : activeTab === 'payments'
            ? 'Payment Gateways'
            : 'Calendar Connections'}
        </h1>
      </div>

      <Routes>
        <Route path="" element={
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div 
              onClick={() => navigate('/admin/appSettings/report')} 
              className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-teal-500 transition-all flex flex-col items-center justify-center text-center gap-4 group"
            >
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <AlertCircle size={32} className="text-teal-700" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Report an Issue</h3>
                <p className="text-sm text-gray-500 mt-2">Submit bug reports, feature requests, or general feedback</p>
              </div>
            </div>

            <div 
              onClick={() => navigate('/admin/appSettings/audit')} 
              className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-teal-500 transition-all flex flex-col items-center justify-center text-center gap-4 group"
            >
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <FileText size={32} className="text-teal-700" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Audit Logs</h3>
                <p className="text-sm text-gray-500 mt-2">Track and monitor all therapist activities and system changes</p>
              </div>
            </div>

            <div 
              onClick={() => navigate('/admin/appSettings/calendars')}
              className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-teal-500 transition-all flex flex-col items-center justify-center text-center gap-4 group"
            >
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <Calendar size={32} className="text-teal-700" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Calendar Connections</h3>
                <p className="text-sm text-gray-500 mt-2">Manage Google Calendar sync and connections for all therapists</p>
              </div>
            </div>


            <div 
              onClick={() => navigate('/admin/appSettings/payments')} 
              className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:shadow-md hover:border-teal-500 transition-all flex flex-col items-center justify-center text-center gap-4 group"
            >
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                <CreditCard size={32} className="text-teal-700" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Payment Gateways</h3>
                <p className="text-sm text-gray-500 mt-2">Configure Razorpay and set active payment methods</p>
              </div>
            </div>

          </div>
        } />

        <Route path="*" element={
          <div className="bg-white rounded-xl border shadow-sm flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto relative">
              <Routes>
                <Route path="report" element={
                  <ReportIssuePage 
                    onBack={handleBack} 
                    userInfo={{
                      username: user?.full_name || user?.username || 'Admin',
                      role: 'Admin'
                    }}
                    hideHeader={true}
                  />
                } />
                <Route path="audit" element={<AuditLogs hideHeader={true} />} />
                <Route path="therapies" element={<TherapiesManagementPage />} />
                <Route path="calendars" element={<CalendarConnectionsAdmin />} />
                <Route path="payments" element={<PaymentSettings />} />
              </Routes>
            </div>
          </div>
        } />
      </Routes>
    </div>
  );
};

export default SettingsPage;
