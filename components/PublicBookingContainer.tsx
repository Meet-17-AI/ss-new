import React, { useEffect, useState } from 'react';
import { BookingPage } from './BookingPage';
import { therapistData } from '../lib/sessionData';
import { Loader } from 'lucide-react';

interface PublicBookingContainerProps {
  slug: string;
}

export const PublicBookingContainer: React.FC<PublicBookingContainerProps> = ({ slug }) => {
  const [sessionData, setSessionData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAvailability = async () => {
      let foundSession = null;
      let therapistName = "";

      // 1. Try to fetch from DB first
      try {
        const response = await fetch(`/api/public/services/${slug}`);
        if (response.ok) {
          const dbService = await response.json();
          // Map all DB fields so BookingPage gets the full service config
          foundSession = {
            ...dbService,
            // BookingPage expects 'owner' as the therapist name
            owner: dbService.owner || dbService.therapist_name,
          };
          therapistName = dbService.owner;
        }
      } catch (err) {
        console.error('Error fetching public service from DB:', err);
      }

      // 2. Fallback to hardcoded therapistData if not found in DB (legacy bookings)
      if (!foundSession) {
        for (const [name, data] of Object.entries(therapistData)) {
          const match = data.services.find(s => s.slug === `/${slug}`);
          if (match) {
            foundSession = { ...match, owner: name };
            therapistName = name;
            break;
          }
        }
      }

      if (!foundSession) {
        setError("Session not found or is no longer available.");
        setLoading(false);
        return;
      }

      // Check if therapist is disabled in database
      try {
        const response = await fetch(`/api/therapist-availability?name=${encodeURIComponent(therapistName)}`);
        const data = await response.json();
        
        if (data.isDisabled) {
          setError("This therapist is currently unavailable for bookings. Please contact support or choose another therapist.");
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('Error checking therapist availability:', err);
        // Continue anyway if API fails
      }

      setSessionData(foundSession);
      setLoading(false);
    };

    checkAvailability();
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <div className="mb-4">
            <svg className="mx-auto h-16 w-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Booking Unavailable</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !sessionData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader className="animate-spin text-teal-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BookingPage session={sessionData} isPublic={true} />
    </div>
  );
};
