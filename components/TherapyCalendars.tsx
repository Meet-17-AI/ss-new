import React, { useState, useEffect } from 'react';
import { Calendar, User, Search, Loader } from 'lucide-react';
interface Therapist {
  therapist_id: string;
  name: string;
  specializations: string[];
  google_calendar_connected: boolean;
}

export function TherapyCalendars() {
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTherapists();
  }, []);

  const fetchTherapists = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/therapists');
      if (!response.ok) throw new Error('Failed to fetch therapists');
      const data = await response.json();
      setTherapists(data);
    } catch (err: any) {
      console.error('Error fetching therapists:', err);
      setError('Failed to load therapy calendars');
    } finally {
      setLoading(false);
    }
  };

  const flattenedTherapies = therapists.flatMap(t => {
    const specs = (t.specializations || []);
    if (specs.length === 0) return [{ ...t, therapyName: 'General Therapy' }];
    return specs.map(s => ({ ...t, therapyName: s.trim() }));
  });

  const filteredTherapies = flattenedTherapies.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.therapyName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col p-6 animate-fade-in bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-teal-800">Therapy Calendars</h1>
          <p className="text-gray-500 text-sm mt-1">Manage and view all therapist booking calendars</p>
        </div>
        
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
                    Therapy Name (Specialization)
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
                {filteredTherapies.length > 0 ? (
                  filteredTherapies.map((item, index) => (
                    <tr key={`${item.therapist_id}-${index}`} className="hover:bg-teal-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {item.therapyName}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-8 w-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold mr-3">
                            <User size={16} />
                          </div>
                          <div className="text-sm font-medium text-gray-900">{item.name}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <a 
                          href={`https://safestories-checkin.vercel.app/book/${item.name.toLowerCase().replace(/\s+/g, '-')}?service=${encodeURIComponent(item.therapyName)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-teal-600 hover:text-teal-800 hover:underline flex items-center gap-1"
                        >
                          safestories-checkin.vercel.app/book/{item.name.toLowerCase().replace(/\s+/g, '-')}?service={encodeURIComponent(item.therapyName)}
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
                  ))
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
    </div>
  );
}
