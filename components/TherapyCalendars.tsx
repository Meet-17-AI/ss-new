import React, { useState, useEffect } from 'react';
import { User, Search, Loader, Plus, ChevronDown, Trash2, Power, MoreVertical, Ban, Edit, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { TherapyDetailsModal } from './TherapyDetailsModal';
import { displayTherapistName, isPlatformTherapist } from '../lib/platformTherapist';
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Only deletion is confirmed from this page now; activate/deactivate moved
  // into the therapy's edit page.
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'delete', id: number, title: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [pendingOtpId, setPendingOtpId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [selectedTherapy, setSelectedTherapy] = useState<TherapyService | null>(null);
  // Roster from /api/therapists-admin — the only source for therapists who have
  // no therapy_services rows yet.
  const [therapists, setTherapists] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      // The roster is fetched alongside the calendars so therapists who have no
      // therapies yet still get a group with an "Add New Therapy" card.
      const [calRes, therRes] = await Promise.all([
        fetch('/api/services'),
        fetch('/api/therapists-admin'),
      ]);
      if (!calRes.ok) throw new Error('Failed to fetch data');
      const calData = await calRes.json();
      setCalendars(calData);
      // A failed roster fetch is not fatal — the page still renders every
      // therapist who already has calendars.
      setTherapists(therRes.ok ? await therRes.json() : []);
    } catch (err: any) {
      console.error('Error fetching data:', err);
      setError('Failed to load therapy calendars');
    } finally {
      setLoading(false);
    }
  };

  // Two independent "active" flags matter here: therapist_is_active (whole
  // therapist switched off) and is_active (this one calendar switched off).
  const isCalendarActive = (c: TherapyService) => c.is_active !== false;
  const isTherapistActive = (c: TherapyService) => c.therapist_is_active !== false;

  // A deactivated therapist's calendars are dead — their booking links are
  // already disabled — so they are hidden from this page entirely rather than
  // listed as unusable entries. Counted so the omission is visible, not silent.
  const hiddenTherapists = new Set(
    calendars.filter(c => !isTherapistActive(c)).map(c => c.therapist_name || 'Unassigned')
  );
  const visibleCalendars = calendars.filter(isTherapistActive);

  const filteredCalendars = visibleCalendars.filter(item =>
    item.therapist_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.title?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Therapists who have no therapies yet.
  //
  // /api/services is driven by therapy_services, so it returns nothing at all
  // for a therapist without calendars — they simply would not exist on this
  // page, and there would be no "+" card to give them their first therapy.
  // A newly invited therapist is exactly that case, so the roster is merged in
  // separately and seeded as an empty group.
  const groupsFromCalendars = filteredCalendars.reduce((acc, calendar) => {
    const therapistName = calendar.therapist_name || 'Unassigned';
    if (!acc[therapistName]) acc[therapistName] = [];
    acc[therapistName].push(calendar);
    return acc;
  }, {} as Record<string, TherapyService[]>);

  const search = searchTerm.toLowerCase();
  therapists
    .filter(t => t.is_active !== false && t.login_enabled !== false)
    .filter(t => !search || (t.name || '').toLowerCase().includes(search))
    .forEach(t => {
      const name = t.name || 'Unassigned';
      if (!groupsFromCalendars[name]) groupsFromCalendars[name] = [];
    });

  const groupedCalendars = Object.entries(groupsFromCalendars)
    .map(([therapistName, therapistCalendars]) => [
      therapistName,
      [...therapistCalendars].sort((a, b) => {
        if (isCalendarActive(a) !== isCalendarActive(b)) return isCalendarActive(a) ? -1 : 1;
        return (a.title || '').localeCompare(b.title || '');
      }),
    ] as [string, TherapyService[]])
    // Every remaining group belongs to an active therapist, so ordering is by
    // whether the group still has a live calendar, then by name.
    .sort(([nameA, calsA], [nameB, calsB]) => {
      const aHasLive = calsA.some(isCalendarActive);
      const bHasLive = calsB.some(isCalendarActive);
      if (aHasLive !== bHasLive) return aHasLive ? -1 : 1;
      return nameA.localeCompare(nameB);
    });

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

  return (
    // Scrolling lives on this outer element rather than on the card list, so the
    // header row (description, search, Add New Therapy) scrolls away with the
    // content instead of staying pinned.
    <div className="h-full flex flex-col p-6 animate-fade-in bg-gray-50 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-gray-500 text-sm">
            Manage and view all therapies
            {hiddenTherapists.size > 0 && (
              <span className="text-gray-400">
                {' '}· {hiddenTherapists.size} deactivated therapist
                {hiddenTherapists.size === 1 ? '' : 's'} hidden
              </span>
            )}
          </p>
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
          {/* The top-level "Add New Therapy" button was removed. It opened the
              form with no therapist selected, while every therapist group below
              has its own "+" card that prefills them. Having one entry point
              that always carries a therapistId is what lets the form name the
              therapist in its heading. */}
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
        <div className="flex-1 flex flex-col pr-2 pb-10">
          {/* Gated on the GROUPS, not the calendars. A therapist with no
              therapies yet forms a valid group with only an add card, and
              gating on filteredCalendars would hide exactly those. */}
          {groupedCalendars.length > 0 ? (
            <div className="space-y-8">
              {groupedCalendars.map(([therapistName, therapistCalendars]) => {
                const first = therapistCalendars[0];
                const therapistInactive =
                  therapistCalendars.length > 0 && first.therapist_is_active === false;
                // An empty group has no calendar to read the id from, so fall
                // back to the roster — without this the "+" card would be
                // withheld from exactly the therapists who most need it.
                const therapistId =
                  first?.therapist_id ||
                  therapists.find(t => (t.name || '') === therapistName)?.therapist_id ||
                  '';
                const isPlatform = isPlatformTherapist(therapistName, therapistId);
                const shownName = displayTherapistName(therapistName, therapistId);
                // "Unassigned" has no therapist to prefill, and a deactivated
                // therapist would only get dead calendars, so the add card is
                // withheld in both cases.
                // The platform "Free Consultation" host is excluded too. It is
                // not real staff and does not appear in /api/therapists, which
                // is the list the therapy form resolves its prefilled
                // therapistId against — so its add card led to a form that
                // could not identify a therapist and could not be saved.
                const canAddTherapy =
                  user?.username !== 'Test' && !!therapistId &&
                  therapistName !== 'Unassigned' && !isPlatform;
                return (
                <div key={therapistName} className="bg-transparent">
                  {/* Therapist Header */}
                  <div className={`flex items-center gap-4 mb-4 p-4 rounded-lg shadow-sm border ${
                    therapistInactive
                      ? 'bg-gray-50 border-gray-200 border-l-4 border-l-red-400'
                      : 'bg-white border-gray-200'
                  }`}>
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm"
                      style={{ backgroundColor: therapistInactive ? '#9CA3AF' : '#21615D' }}
                    >
                      {isPlatform
                        ? <Sparkles size={22} />
                        : therapistName !== 'Unassigned' ? shownName.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 flex items-center gap-3">
                      <h2 className={`text-lg font-bold ${therapistInactive ? 'text-gray-500' : 'text-gray-900'}`}>
                        {shownName}
                      </h2>
                      {isPlatform && (
                        <span className="text-[10px] font-bold text-teal-800 bg-teal-100 border border-teal-200 px-2 py-1 rounded-md uppercase tracking-wider">
                          Platform
                        </span>
                      )}
                      {therapistInactive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-md uppercase tracking-wider">
                          <Ban size={10} />
                          Deactivated
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Therapist's Calendars */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {therapistCalendars.map((item, index) => {
                      const cleanSlug = item.slug ? item.slug.replace(/^\/+/, '') : '';
                      const calendarInactive = item.is_active === false;

                      return (
                        <div
                          key={`${item.id}-${index}`}
                          className={`rounded-xl shadow-sm border transition-all overflow-hidden flex flex-col cursor-pointer ${
                            calendarInactive
                              ? 'bg-gray-50 border-gray-200 border-l-4 border-l-red-400 opacity-75 hover:opacity-100'
                              : 'bg-white border-gray-200 hover:shadow-md'
                          }`}
                          onClick={() => setSelectedTherapy(item)}
                        >
                          <div className="p-5 flex-1">
                            <div className="flex justify-between items-start mb-3">
                              <div className="pr-4 flex-1 min-w-0">
                                <h3 className={`text-base font-bold leading-tight ${calendarInactive ? 'text-gray-500' : 'text-gray-900'}`}>
                                  {item.title}
                                </h3>
                                {calendarInactive && (
                                  <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                    <Ban size={10} />
                                    Deactivated
                                  </span>
                                )}
                              </div>
                              {user?.username !== 'Test' && (
                                <div className="relative group flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                  <button className="text-gray-400 hover:text-gray-600 p-1">
                                    <MoreVertical size={18} />
                                  </button>
                                  {/* Dropdown Menu */}
                                  <div className="absolute right-0 mt-1 w-44 bg-white text-gray-800 rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/userSettings/therapies/${item.id}`); }}
                                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-xs flex items-center gap-2 border-b border-gray-100"
                                    >
                                      <Edit size={12} />
                                      Edit
                                    </button>
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
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Add-therapy card. Carries therapistId so the create page
                        prefills the therapist, which in turn cascades into their
                        schedule, availability and therapy-type options. */}
                    {canAddTherapy && (
                      <button
                        onClick={() => navigate(`/admin/userSettings/therapies/new?therapistId=${encodeURIComponent(therapistId)}`)}
                        disabled={therapistInactive}
                        title={
                          therapistInactive
                            ? `${shownName} is deactivated — reactivate before adding therapies`
                            : `Add a new therapy for ${shownName}`
                        }
                        className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center p-5 min-h-[190px] transition-all ${
                          therapistInactive
                            ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                            : 'border-gray-300 bg-white/50 hover:border-teal-400 hover:bg-teal-50/40 cursor-pointer group'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${
                          therapistInactive
                            ? 'bg-gray-200 text-gray-400'
                            : 'bg-teal-100 text-teal-700 group-hover:bg-teal-600 group-hover:text-white'
                        }`}>
                          <Plus size={24} />
                        </div>
                        <span className={`font-semibold text-sm ${therapistInactive ? 'text-gray-400' : 'text-gray-800'}`}>
                          Add New Therapy
                        </span>
                        <span className={`text-xs mt-1 ${therapistInactive ? 'text-gray-400' : 'text-gray-500'}`}>
                          for {shownName}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
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
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Calendar</h3>
            <p className="text-gray-600 mb-2">
              <strong>{confirmDialog.title}</strong>
            </p>
            <p className="text-gray-600 mb-6">This will delete the calendar permanently.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCalendar}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 bg-red-600 hover:bg-red-700"
              >
                {actionLoading ? 'Processing...' : 'Delete'}
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

      {selectedTherapy && (
        <TherapyDetailsModal
          therapy={selectedTherapy}
          onClose={() => setSelectedTherapy(null)}
          onEdit={() => navigate(`/admin/userSettings/therapies/${selectedTherapy.id}`)}
        />
      )}
    </div>
  );
}
