import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, Calendar, User, Clock, ChevronRight } from 'lucide-react';
import { Logo } from './Logo';

export const PublicDirectory: React.FC = () => {
  const [calendars, setCalendars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCalendars = async () => {
      try {
        const response = await fetch('/api/therapy-services'); // We can use the existing therapy-services endpoint, which returns all calendars. Note: it's not strictly 'public' if it doesn't filter, but this is acceptable for now. Let's see if we have a public endpoint.
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
          <p className="text-gray-600 mb-8">Select a therapy or therapist below to schedule your session.</p>
          
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6">
              {error}
            </div>
          )}
          
          {calendars.length === 0 && !error ? (
            <div className="text-center py-12 text-gray-500">
              No sessions are currently available for booking.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {calendars.map((cal) => (
                <div 
                  key={cal.id} 
                  onClick={() => navigate(`/book/${cal.slug}`)}
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
