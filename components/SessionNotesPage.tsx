import React, { useEffect, useState } from 'react';
import { SessionNotesForm } from './SessionNotesForm';
import { ConsultationNotesForm } from './ConsultationNotesForm';
import { Loader } from './Loader';
import { loadDraft } from './sessionDraft';

interface SessionNotesPageProps {
  bookingId: string;
}

export function SessionNotesPage({ bookingId }: SessionNotesPageProps) {
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [initialDraft, setInitialDraft] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // Load the session info and any autosaved draft in parallel. The draft is a pure
    // best-effort enhancement — if it fails we simply render an empty form as before.
    Promise.all([
      fetch(`/api/session-notes-info?booking_id=${bookingId}`)
        .then(r => r.json())
        .then(data => { if (data.error) setError(data.error); else setSessionInfo(data); })
        .catch(() => setError('Failed to load session details.')),
      loadDraft(bookingId).then(d => setInitialDraft(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [bookingId]);

  const handleSubmit = async (formData: any) => {
    try {
      const res = await fetch('/api/session-documentation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, ...formData }),
      });
      if (res.ok) setSubmitted(true);
      else setError('Submission failed. Please try again.');
    } catch {
      setError('Submission failed. Please try again.');
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center p-8">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center p-8 max-w-sm">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: '#21615D' }}>
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Session Notes Submitted</h2>
        <p className="text-sm text-gray-500">Your documentation has been saved successfully.</p>
      </div>
    </div>
  );

  const isConsultation = 
    sessionInfo.bookingSubject?.toLowerCase().includes('consultation') || 
    sessionInfo.bookingSubject?.toLowerCase().includes('pre-therapy') ||
    sessionInfo.sessionDuration === '15 min' ||
    sessionInfo.therapistName?.toLowerCase().trim() === 'safestories';

  if (isConsultation) {
    return (
      <ConsultationNotesForm
        sessionInfo={sessionInfo}
        initialDraft={initialDraft}
        onClose={() => window.close()}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <SessionNotesForm
      sessionInfo={sessionInfo}
      initialDraft={initialDraft}
      onClose={() => window.close()}
      onSubmit={handleSubmit}
    />
  );
}
