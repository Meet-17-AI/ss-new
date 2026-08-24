import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, User, Mail, Phone, RefreshCw, CalendarCheck, Star, Ban, MailCheck } from 'lucide-react';
import { resolveMediaUrl, initialsFor } from '../lib/mediaUrl';
import { ViewTherapistModal } from './ViewTherapistModal';

interface TherapistCard {
  therapist_id: string;
  name: string;
  specialization: string | null;
  contact_info: string | null;
  phone_number: string | null;
  profile_picture_url: string | null;
  is_active?: boolean;
  // Optional on purpose: an older/lagging API build omits it, and the code must
  // treat "absent" as active rather than deactivating everyone.
  login_enabled?: boolean;
  // True while an invited therapist has no users row yet — the admin sent the
  // invite, they have not verified the OTP and set their own password. They are
  // neither Active nor Deactivated, so they get their own badge.
  awaiting_onboarding?: boolean;
  status?: string | null;
  google_calendar_connected: boolean;
  total_sessions_lifetime: string | number;
  sessions_this_month: string | number;
  average_rating: string | number | null;
}

const specializationList = (raw: string | null): string[] =>
  (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Two separate flags can take a therapist out of service:
//   is_active     — the therapist record itself (soft delete / deactivate)
//   login_enabled — users.is_active; whether they can sign in. /api/services
//                   keys off this one to disable public booking links.
// Either being false means "not currently operating" — the card just says
// Deactivated, without naming which flag tripped.
//
// Test against === false rather than falsiness on purpose: if a field is ever
// missing from the response, undefined must read as ACTIVE. The falsy version
// flagged every therapist as deactivated the moment the API lagged the UI.
const isDeactivated = (t: TherapistCard) =>
  t.is_active === false || t.login_enabled === false;

// Invited but not yet onboarded. Checked BEFORE isDeactivated when picking a
// badge: such a therapist has no users row, so login_enabled COALESCEs to true
// and they would otherwise read as a fully working account.
const isAwaitingOnboarding = (t: TherapistCard) =>
  t.awaiting_onboarding === true && !isDeactivated(t);

// The stored placeholder for "no number entered" is the bare country code, which
// reads as a real value in the UI. Treat it as empty.
const realPhone = (phone: string | null): string => {
  const trimmed = (phone || '').trim();
  return /^\+?\d{0,3}$/.test(trimmed) ? '' : trimmed;
};

export const TherapistProfileGrid: React.FC = () => {
  const navigate = useNavigate();
  const [therapists, setTherapists] = useState<TherapistCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTherapist, setSelectedTherapist] = useState<TherapistCard | null>(null);

  useEffect(() => {
    fetchTherapists();
  }, []);

  const fetchTherapists = async () => {
    try {
      setLoading(true);
      setError('');
      // This list is real staff only — the SafeStories free-consultation calendar
      // host is excluded server-side. It still appears on the Therapies tab.
      const res = await fetch('/api/therapists-admin');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTherapists(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching therapists:', err);
      setError('Failed to load therapists.');
      setTherapists([]);
    } finally {
      setLoading(false);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const filtered = therapists
    .filter(t => {
      if (!query) return true;
      return (
        (t.name || '').toLowerCase().includes(query) ||
        (t.contact_info || '').toLowerCase().includes(query) ||
        (t.specialization || '').toLowerCase().includes(query)
      );
    })
    // Deactivated therapists sink to the bottom, alphabetical within each group.
    .sort((a, b) => {
      const aOff = isDeactivated(a);
      const bOff = isDeactivated(b);
      if (aOff !== bOff) return aOff ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });

  const deactivatedCount = filtered.filter(isDeactivated).length;

  return (
    // Scrolling lives on this outer element rather than on the card grid, so the
    // header row (description, search, Add Therapist) scrolls away with the
    // content instead of staying pinned.
    <div className="p-6 flex flex-col h-full bg-white overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Therapists</h2>
          <p className="text-sm text-gray-500 mt-1">
            View and manage every therapist profile — open a card to see or update their
            contact number, email.
            {deactivatedCount > 0 && (
              <span className="text-gray-400"> · {deactivatedCount} deactivated, shown last.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search therapists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
            />
          </div>
          <button
            onClick={() => navigate('/admin/userSettings/therapists/new')}
            className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 font-medium text-sm rounded-lg transition-all flex items-center gap-2 hover:shadow-sm whitespace-nowrap"
          >
            <Plus size={18} />
            Add Therapist
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 pr-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <RefreshCw className="animate-spin text-teal-600" size={32} />
            <span className="text-gray-500 font-medium">Loading therapists...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <p className="text-red-600 font-medium">{error}</p>
            <button
              onClick={fetchTherapists}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
            <User size={40} className="text-gray-300 mb-2" />
            <p className="text-gray-500 font-medium">
              {query ? `No therapists found matching "${searchQuery}"` : 'No therapists yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map(therapist => {
              const photo = resolveMediaUrl(therapist.profile_picture_url);
              const specs = specializationList(therapist.specialization);
              const phone = realPhone(therapist.phone_number);
              const rating = Number(therapist.average_rating);
              const inactive = isDeactivated(therapist);
              return (
                <button
                  key={therapist.therapist_id}
                  onClick={() => setSelectedTherapist(therapist)}
                  className={`text-left rounded-xl p-5 transition-all flex flex-col border ${
                    inactive
                      // Deactivated cards are visibly muted and flagged with a red
                      // left edge so they read as "switched off" at a glance, not
                      // just as a card with a different badge.
                      ? 'bg-gray-50 border-gray-200 border-l-4 border-l-red-400 opacity-75 hover:opacity-100 hover:shadow-sm'
                      : 'bg-white border-gray-200 hover:border-teal-300 hover:shadow-md'
                  }`}
                >
                  {/* Avatar + name */}
                  <div className="flex items-start gap-4">
                    {photo ? (
                      <img
                        src={photo}
                        alt={therapist.name}
                        className={`w-16 h-16 rounded-full object-cover border border-gray-200 shrink-0 ${inactive ? 'grayscale' : ''}`}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          const fallback = (e.target as HTMLImageElement).nextSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className={`w-16 h-16 rounded-full items-center justify-center font-semibold text-lg shrink-0 ${
                        inactive ? 'bg-gray-200 text-gray-500' : 'bg-teal-100 text-teal-700'
                      }`}
                      style={{ display: photo ? 'none' : 'flex' }}
                    >
                      {initialsFor(therapist.name)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-semibold truncate ${inactive ? 'text-gray-500' : 'text-gray-800'}`}>
                          {therapist.name}
                        </h3>
                        {inactive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                            <Ban size={10} />
                            Deactivated
                          </span>
                        ) : isAwaitingOnboarding(therapist) ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200"
                            title="Invite sent. They set their own password after verifying the emailed OTP."
                          >
                            <MailCheck size={10} />
                            Invited
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-200">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        ID: {therapist.therapist_id}
                      </p>
                      {therapist.contact_info && (
                        <p className="text-sm text-gray-500 mt-1.5 flex items-center gap-1.5 truncate">
                          <Mail size={14} className="shrink-0 text-gray-400" />
                          <span className="truncate">{therapist.contact_info}</span>
                        </p>
                      )}
                      {phone && (
                        <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5">
                          <Phone size={14} className="shrink-0 text-gray-400" />
                          {phone}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Specializations */}
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {specs.length > 0 ? (
                      specs.map(spec => (
                        <span
                          key={spec}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                            inactive
                              ? 'bg-gray-100 text-gray-500 border-gray-200'
                              : 'bg-teal-50 text-teal-700 border-teal-100'
                          }`}
                        >
                          {spec}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-400 italic">
                        No specialization recorded
                      </span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      <CalendarCheck size={15} className="text-gray-400" />
                      {Number(therapist.total_sessions_lifetime || 0)} sessions
                    </span>
                    <span className="text-gray-600">
                      {Number(therapist.sessions_this_month || 0)} this month
                    </span>
                    {Number.isFinite(rating) && rating > 0 && (
                      <span className="text-gray-600 flex items-center gap-1">
                        <Star size={15} className="text-amber-400 fill-amber-400" />
                        {rating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  {/* Calendar connection */}
                  <div className="mt-3 text-xs">
                    {therapist.google_calendar_connected ? (
                      <span className="text-green-700 font-medium">● Google Calendar connected</span>
                    ) : (
                      <span className="text-gray-400">○ Google Calendar not connected</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedTherapist && (
        <ViewTherapistModal
          therapist={{
            ...selectedTherapist,
            profile_picture_url: resolveMediaUrl(selectedTherapist.profile_picture_url),
          }}
          onClose={() => setSelectedTherapist(null)}
          // the card shows fields derived server-side.
          onSaved={(updated) => {
            if (updated) setSelectedTherapist(updated);
            fetchTherapists();
          }}
        />
      )}
    </div>
  );
};

export default TherapistProfileGrid;
