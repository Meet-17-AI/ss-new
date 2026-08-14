import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, Calendar, User, Clock, ChevronRight } from 'lucide-react';
import { Logo } from './Logo';

export const PublicDirectory: React.FC = () => {
  const [calendars, setCalendars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  /**
   * What the admin already decided, handed over in the link.
   *
   * `therapy` and `therapist` narrow this list — the admin may have fixed one
   * and left the other to the client. The identity fields are carried through
   * untouched so the booking form on the far side opens prefilled.
   */
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const wantTherapy = (params.get('therapy') || '').trim().toLowerCase();
  const wantTherapist = (params.get('therapist') || '').trim().toLowerCase();

  /** Only the identity fields travel on to the booking form. */
  const identityQuery = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of ['name', 'email', 'phone']) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '';
  }, [params]);

  const visible = useMemo(() => calendars.filter(c => {
    const title = String(c.title || '').toLowerCase();
    const owner = String(c.therapist_name || '').toLowerCase();
    // Match on the therapist's first name: the admin picks from a list of full
    // names, while service rows spell the same person inconsistently.
    const firstName = wantTherapist.split(/\s+/)[0];
    if (wantTherapy && !title.includes(wantTherapy)) return false;
    if (wantTherapist && firstName && !owner.includes(firstName)) return false;
    return true;
  }), [calendars, wantTherapy, wantTherapist]);

  // A filter that hides everything is worse than no filter — it reads as "fully
  // booked" and the client leaves. Fall back to the whole list instead.
  const list = visible.length > 0 ? visible : calendars;
  const narrowed = visible.length > 0 && visible.length < calendars.length;

  useEffect(() => {
    const fetchCalendars = async () => {
      try {
        const response = await fetch('/api/services'); // We can use the existing therapy-services endpoint, which returns all calendars. Note: it's not strictly 'public' if it doesn't filter, but this is acceptable for now. Let's see if we have a public endpoint.
        if (response.ok) {
          const data = await response.json();
          // Filter to only active ones
          const active = data.filter((c: any) => c.is_active !== false);
          setCalendars(active);
        } else {
          setError('Failed to load therapy calendars');
        }
      } catch (err) {
        setError('Error connecting to server');
      } finally {
        setLoading(false);
      }
    };
    
    fetchCalendars();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader className="animate-spin text-teal-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-center mb-10">
          <Logo />
        </div>
        
        <div className="bg-white rounded-2xl shadow-sm p-8 border border-gray-100">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Book a Session</h1>
          <p className="text-gray-600 mb-8">
            {narrowed
              ? 'Choose from the options below to schedule your session.'
              : 'Select a therapy or therapist below to schedule your session.'}
          </p>
          
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
              {error}
            </div>
          )}
          
          {list.length === 0 && !error ? (
            <div className="text-center py-12 text-gray-500">
              No sessions are currently available for booking.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {list.map((cal) => (
                <div 
                  key={cal.id} 
                  onClick={() => navigate(`/book/${cal.slug}${identityQuery}`)}
                  className="group relative bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md hover:border-teal-500 transition-all cursor-pointer flex flex-col h-full"
                >
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-teal-700 transition-colors mb-2">
                    {cal.title}
                  </h3>
                  
                  <div className="space-y-2 mt-auto pt-4">
                    <div className="flex items-center text-sm text-gray-600">
                      <User size={16} className="mr-2 text-gray-400" />
                      {cal.therapist_name}
                    </div>
                    <div className="flex items-center text-sm text-gray-600">
                      <Clock size={16} className="mr-2 text-gray-400" />
                      {cal.duration}
                    </div>
                  </div>
                  
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight size={20} className="text-teal-600" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
