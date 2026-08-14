import React, { useState } from 'react';
import {
  X, Edit, Ban, Clock, Video, MapPin, IndianRupee,
  CalendarCheck, FileText, User,
} from 'lucide-react';
import { displayTherapistName, isPlatformTherapist } from '../lib/platformTherapist';

interface TherapyDetailsModalProps {
  therapy: any;
  onClose: () => void;
  onEdit: () => void;
}

const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({
  icon, label, children,
}) => (
  <div className="flex items-start gap-3">
    <div className="text-gray-400 mt-0.5 shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
      <div className="text-sm text-gray-800 mt-0.5 break-words">{children}</div>
    </div>
  </div>
);

// Stored as "Online" / "In Person"; the panel shows these as the two labels used
// everywhere else in the app.
const modeLabel = (type?: string | null): string => {
  const m = (type || '').toLowerCase();
  if (m.includes('person') || m.includes('office') || m.includes('clinic')) return 'In-Person';
  if (m.includes('online') || m.includes('meet') || m.includes('google') || m.includes('video')) return 'Google Meet';
  return type || 'N/A';
};

export const TherapyDetailsModal: React.FC<TherapyDetailsModalProps> = ({ therapy, onClose, onEdit }) => {
  const calendarInactive = therapy.is_active === false;
  const therapistInactive = therapy.therapist_is_active === false;
  const linksDisabled = calendarInactive || therapistInactive;
  const questionCount = Array.isArray(therapy.form_questions) ? therapy.form_questions.length : 0;
  const isInPerson = modeLabel(therapy.type) === 'In-Person';
  const therapistName = displayTherapistName(therapy.therapist_name, therapy.therapist_id);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">{therapy.title}</h2>
              {calendarInactive ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-700 border border-red-200">
                  <Ban size={10} />
                  Deactivated
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-700 border border-green-200">
                  Active
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {therapistName}
              {isPlatformTherapist(therapy.therapist_name, therapy.therapist_id) && ' · Platform calendar'}
              {therapistInactive && ' · therapist deactivated'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Key details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Row icon={<User size={16} />} label="Therapist">{therapistName || 'Unassigned'}</Row>
            <Row icon={<CalendarCheck size={16} />} label="Therapy Type">
              {therapy.therapy_type || <span className="text-gray-400 italic">Not set</span>}
            </Row>
            <Row icon={isInPerson ? <MapPin size={16} /> : <Video size={16} />} label="Mode">
              {modeLabel(therapy.type)}
            </Row>
            <Row icon={<Clock size={16} />} label="Duration">{therapy.duration || '50 Mins'}</Row>
            <Row icon={<IndianRupee size={16} />} label="Price">
              {therapy.is_payment_enabled === false ? (
                <span className="text-gray-600">Free (payment disabled)</span>
              ) : (
                <>
                  ₹{Number(String(therapy.charges || '0').replace(/[^0-9.]/g, '') || 0).toLocaleString('en-IN')}
                  <span className="text-gray-400 text-xs ml-1.5">via {therapy.payment_gateway || 'Razorpay'}</span>
                </>
              )}
            </Row>
            <Row icon={<FileText size={16} />} label="Booking Form">
              {questionCount} question{questionCount === 1 ? '' : 's'}
              {therapy.requires_tnc && <span className="text-gray-400 text-xs ml-1.5">· T&C required</span>}
            </Row>
          </div>

          {/* Description — Quill HTML authored by admins, same as the card and
              the public booking page render it. */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Description</p>
            {therapy.description ? (
              <div
                className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none border border-gray-100 rounded-lg p-4 bg-gray-50"
                dangerouslySetInnerHTML={{ __html: therapy.description }}
              />
            ) : (
              <p className="text-sm text-gray-400 italic">No description provided.</p>
            )}
          </div>

          {/* The public booking link was shown here. Clients are now sent a
              single link (/book) that resolves the therapy and therapist
              itself, so per-service URLs are no longer handed out. The
              deactivated-therapy warning is kept — it explains why an old link
              someone still holds will refuse to book. */}
          {linksDisabled && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <Ban size={15} className="shrink-0" />
              Booking disabled ({calendarInactive ? 'therapy deactivated' : 'therapist inactive'})
            </div>
          )}

          {therapy.google_calendar_connected === false && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              This therapist's Google Calendar is not connected.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 bg-white rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          <button
            onClick={onEdit}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors flex items-center gap-2"
          >
            <Edit size={15} />
            Edit Therapy
          </button>
        </div>
      </div>
    </div>
  );
};

export default TherapyDetailsModal;
