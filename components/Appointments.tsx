import React, { useState, useEffect } from 'react';
import { MessageCircle, Search, Download, Copy, Send, FileText, Plus, Calendar, X, RefreshCw, Filter } from 'lucide-react';
import * as XLSX from 'xlsx'
import { SendBookingModal } from './SendBookingModal';
import { Toast } from './Toast';
import { Loader } from './Loader';

interface Appointment {
  booking_id?: number;
  booking_start_at: string;
  booking_start_at_raw?: string;
  booking_resource_name: string;
  booking_subject?: string;
  invitee_name: string;
  invitee_phone: string;
  invitee_email: string;
  booking_host_name: string;
  booking_mode: string;
  booking_joining_link?: string;
  booking_checkin_url?: string;
  has_session_notes?: boolean;
  therapist_id?: string;
  session_status?: string;
  paperform_link?: string;
  booking_status?: string;
  duration?: number;
  client_rating?: string | null;
}

// Returns a clean session name — falls back to booking_subject if resource_name is just a location string
const getSessionName = (apt: Appointment): string => {
  const name = (apt.booking_resource_name || '').trim();
  const isLocationOnly = /^(in-person|online|offline)\s*\(/i.test(name);

  if (isLocationOnly) {
    // Try booking_subject first (e.g. "Individual Therapy with Indrayani")
    if (apt.booking_subject) {
      return apt.booking_subject.replace(/ with .+$/i, '').trim();
    }
    // Strip the parenthetical address, e.g. "In-person (SafeStories Office...)" → "In-person Session"
    const modeOnly = name.replace(/\s*\(.*\)$/i, '').trim();
    return modeOnly ? `${modeOnly} Session` : name;
  }
  // Normal case: strip " with TherapistName" suffix
  return name.replace(/ with .+$/i, '').trim() || name;
};

export const Appointments: React.FC<{ onClientClick?: (client: any) => void; onCreateBooking?: () => void; initialTab?: string }> = ({ onClientClick, onCreateBooking, initialTab }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState(initialTab || 'scheduled');
  const itemsPerPage = 10;
  const appointmentActionsRef = React.useRef<HTMLTableElement>(null);

  // Filter panel
  const [selectedMonth, setSelectedMonth] = useState('All Time');
  const [selectedTherapist, setSelectedTherapist] = useState('All Therapists');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = React.useRef<HTMLDivElement>(null);

  const generateMonthOptions = () => {
    const months: string[] = [];
    const start = new Date(2025, 9, 1); // Oct 2025
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let d = new Date(end); d >= start; d.setMonth(d.getMonth() - 1)) {
      months.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
    }
    return months;
  };
  const monthOptions = generateMonthOptions();

  const therapistOptions = ['All Therapists', ...Array.from(new Set(appointments.map(a => a.booking_host_name).filter(Boolean).filter(n => n.trim().toLowerCase() !== 'safestories'))).sort()];
  const isFilterActive = selectedMonth !== 'All Time' || selectedTherapist !== 'All Therapists';

  // Reschedule state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');
  const [rescheduleDuration, setRescheduleDuration] = useState(50);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleNotify, setRescheduleNotify] = useState(true);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotify, setCancelNotify] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  const tabs = [
    { id: 'scheduled', label: 'Upcoming' },
    { id: 'all', label: 'All Bookings' },
    { id: 'completed', label: 'Completed' },
    { id: 'pending_notes', label: 'Pending Session Notes' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'no_show', label: 'No Show' },
  ];

  // Feedback state
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<Appointment | null>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);

  // Multi-select feedback state
  const [selectedForFeedback, setSelectedForFeedback] = useState<Set<number>>(new Set());
  const [showBulkFeedbackModal, setShowBulkFeedbackModal] = useState(false);
  const [isSendingBulkFeedback, setIsSendingBulkFeedback] = useState(false);
  const [bulkFeedbackProgress, setBulkFeedbackProgress] = useState(0);

  const isFeedbackTab = activeTab === 'completed' || activeTab === 'pending_notes';

  const toggleSelectForFeedback = (bookingId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedForFeedback(prev => {
      const next = new Set(prev);
      next.has(bookingId) ? next.delete(bookingId) : next.add(bookingId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const eligibleIds = paginatedAppointments
      .filter(a => a.booking_id != null)
      .map(a => a.booking_id as number);
    const allSelected = eligibleIds.every(id => selectedForFeedback.has(id));
    if (allSelected) {
      setSelectedForFeedback(new Set());
    } else {
      setSelectedForFeedback(new Set(eligibleIds));
    }
  };

  const sendFeedbackWebhook = async (apt: Appointment) => {
    const response = await fetch('/api/request-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId: apt.booking_id,
        clientName: apt.invitee_name,
        clientEmail: apt.invitee_email,
        clientPhone: apt.invitee_phone,
        therapistName: apt.booking_host_name,
        sessionName: apt.booking_resource_name,
        sessionDate: apt.booking_start_at,
      }),
    });
    return response.ok;
  };

  const handleBulkFeedbackSend = async () => {
    const targets = filteredAppointments.filter(a => a.booking_id != null && selectedForFeedback.has(a.booking_id as number));
    setIsSendingBulkFeedback(true);
    setBulkFeedbackProgress(0);
    let successCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const ok = await sendFeedbackWebhook(targets[i]);
      if (ok) successCount++;
      setBulkFeedbackProgress(i + 1);
    }
    setIsSendingBulkFeedback(false);
    setShowBulkFeedbackModal(false);
    setSelectedForFeedback(new Set());
    setToast({ message: `Feedback request sent to ${successCount} of ${targets.length} client(s)`, type: successCount === targets.length ? 'success' : 'error' });
  };

  const fetchAppointments = () => {
    setLoading(true);
    fetch('/api/appointments')
      .then(res => res.json())
      .then(data => {
        setAppointments(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching appointments:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchAppointments();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (appointmentActionsRef.current && !appointmentActionsRef.current.contains(event.target as Node)) {
        setSelectedRowIndex(null);
      }
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const copyAppointmentDetails = (apt: Appointment) => {
    const details = `${apt.booking_resource_name}
${apt.booking_start_at}
Time zone: Asia/Kolkata
${apt.booking_mode} joining info${apt.booking_joining_link ? `\nVideo call link: ${apt.booking_joining_link}` : ''}`;

    navigator.clipboard.writeText(details).then(() => {
      setToast({ message: 'Appointment details copied to clipboard!', type: 'success' });
    }).catch(err => {
      console.error('Failed to copy:', err);
      setToast({ message: 'Failed to copy details', type: 'error' });
    });
  };

  const isMeetingEnded = (apt: Appointment) => {
    if (apt.booking_start_at_raw) {
      return new Date(apt.booking_start_at_raw) < new Date();
    }
    const timeMatch = apt.booking_start_at?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M) IST/);
    if (timeMatch) {
      const [, dateStr, , endTimeStr] = timeMatch;
      const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
      return new Date() > endDateTime;
    }
    return false;
  };

  const formatMode = (mode: string | undefined): string => {
    if (!mode) return 'N/A';
    const modeLower = mode.toLowerCase();
    if (modeLower.includes('person') || modeLower.includes('office') || modeLower.includes('clinic')) return 'In-person';
    if (modeLower.includes('google') || modeLower.includes('meet')) return 'Google Meet';
    return mode;
  };

  const handleReminderClick = (apt: Appointment) => {
    if (isMeetingEnded(apt)) {
      setToast({ message: 'Cannot send reminder after meeting has ended', type: 'error' });
      return;
    }
    setSelectedAppointment(apt);
    setShowReminderModal(true);
  };

  const sendWhatsAppNotification = async () => {
    if (!selectedAppointment) return;
    const webhookData = {
      sessionTimings: selectedAppointment.booking_start_at,
      sessionName: selectedAppointment.booking_resource_name,
      clientName: selectedAppointment.invitee_name,
      phone: selectedAppointment.invitee_phone,
      email: selectedAppointment.invitee_email,
      therapistName: selectedAppointment.booking_host_name,
      mode: selectedAppointment.booking_mode,
      meetingLink: selectedAppointment.booking_joining_link || '',
      checkinUrl: selectedAppointment.booking_checkin_url || ''
    };
    try {
      const response = await fetch('https://n8n.srv1169280.hstgr.cloud/webhook/0d1db363-bf04-41e5-a667-a9fe1b5ffc83', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookData)
      });
      if (response.ok) {
        setToast({ message: 'WhatsApp notification sent successfully!', type: 'success' });
      } else {
        setToast({ message: 'Failed to send WhatsApp notification', type: 'error' });
      }
    } catch (err) {
      console.error('Error sending notification:', err);
      setToast({ message: 'Failed to send WhatsApp notification', type: 'error' });
    }
    setShowReminderModal(false);
    setSelectedAppointment(null);
  };

  const handleSessionNotesReminder = async (apt: Appointment) => {
    if (!isMeetingEnded(apt)) {
      setToast({ message: 'Cannot send reminder before meeting ends', type: 'error' });
      return;
    }
    if (apt.has_session_notes) {
      setToast({ message: 'Session notes already filled for this appointment', type: 'error' });
      return;
    }
    const webhookData = {
      bookingId: apt.booking_id,
      therapistId: apt.therapist_id,
      therapistName: apt.booking_host_name,
      clientName: apt.invitee_name,
      sessionName: apt.booking_resource_name,
      sessionTimings: apt.booking_start_at,
      domain: window.location.origin
    };
    try {
      const response = await fetch('https://n8n.srv1169280.hstgr.cloud/webhook/fd13ea75-06b4-49e5-8188-75a88a9aaade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookData)
      });
      if (response.ok) {
        setToast({ message: 'Reminder sent to therapist to fill session notes', type: 'success' });
      } else {
        setToast({ message: 'Failed to send reminder', type: 'error' });
      }
    } catch (err) {
      console.error('Error sending reminder:', err);
      setToast({ message: 'Failed to send reminder', type: 'error' });
    }
  };

  // ── Reschedule ──────────────────────────────────────────────────────────────
  const openRescheduleModal = (apt: Appointment) => {
    setRescheduleTarget(apt);
    setRescheduleDateTime('');
    setRescheduleDuration(apt.duration || 50);
    setRescheduleReason('');
    setRescheduleNotify(true);
    setShowRescheduleModal(true);
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDateTime || !rescheduleReason.trim()) {
      setToast({ message: 'Please fill in all required fields', type: 'error' });
      return;
    }
    setIsRescheduling(true);
    try {
      const response = await fetch('/api/reschedule-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: rescheduleTarget.booking_id,
          new_start_at: new Date(rescheduleDateTime).toISOString(),
          duration: rescheduleDuration,
          reason: rescheduleReason,
          notify: rescheduleNotify
        })
      });
      if (response.ok) {
        setToast({ message: 'Booking rescheduled successfully!', type: 'success' });
        setShowRescheduleModal(false);
        setRescheduleTarget(null);
        setSelectedRowIndex(null);
        fetchAppointments();
      } else {
        setToast({ message: 'Failed to reschedule booking', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to reschedule booking', type: 'error' });
    }
    setIsRescheduling(false);
  };

  // ── Cancel ──────────────────────────────────────────────────────────────────
  const openCancelModal = (apt: Appointment) => {
    setCancelTarget(apt);
    setCancelReason('');
    setCancelNotify(true);
    setShowCancelModal(true);
  };

  const handleCancelBooking = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      setToast({ message: 'Please enter a reason for cancellation', type: 'error' });
      return;
    }
    setIsCancelling(true);
    try {
      const response = await fetch('/api/cancel-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: cancelTarget.booking_id,
          reason: cancelReason,
          notify: cancelNotify
        })
      });
      if (response.ok) {
        setToast({ message: 'Booking cancelled successfully!', type: 'success' });
        setShowCancelModal(false);
        setCancelTarget(null);
        setSelectedRowIndex(null);
        fetchAppointments();
      } else {
        setToast({ message: 'Failed to cancel booking', type: 'error' });
      }
    } catch {
      setToast({ message: 'Failed to cancel booking', type: 'error' });
    }
    setIsCancelling(false);
  };

  const getAppointmentStatus = (apt: Appointment) => {
    if (apt.booking_status === 'cancelled' || apt.booking_status === 'canceled') return 'cancelled';
    if (apt.booking_status === 'no_show' || apt.booking_status === 'no show') return 'no_show';
    if (apt.has_session_notes) return 'completed';
    if (apt.booking_start_at) {
      const timeMatch = apt.booking_start_at.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
      if (timeMatch) {
        const [, dateStr, , endTimeStr] = timeMatch;
        const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
        if (endDateTime < new Date() && !apt.has_session_notes) return 'pending_notes';
      }
    }
    return 'scheduled';
  };

  const filteredAppointments = appointments.filter(apt => {
    // Exclude free consultations (SafeStories) — managed in CRM
    if ((apt.booking_host_name || '').trim().toLowerCase() === 'safestories') return false;

    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      apt.booking_resource_name.toLowerCase().includes(query) ||
      apt.invitee_name.toLowerCase().includes(query) ||
      apt.booking_host_name.toLowerCase().includes(query)
    );
    if (!matchesSearch) return false;

    // Month filter
    if (selectedMonth !== 'All Time') {
      const [mName, mYear] = selectedMonth.split(' ');
      const monthMap: { [key: string]: number } = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };
      const rawDate = apt.booking_start_at_raw
        ? new Date(apt.booking_start_at_raw)
        : (() => {
            const m = apt.booking_start_at?.match(/(\w+, \w+ \d+, \d+)/);
            return m ? new Date(m[1]) : null;
          })();
      if (!rawDate) return false;
      if (rawDate.getFullYear() !== parseInt(mYear) || rawDate.getMonth() !== monthMap[mName]) return false;
    }

    // Therapist filter
    if (selectedTherapist !== 'All Therapists' && apt.booking_host_name !== selectedTherapist) return false;

    if (activeTab === 'all') return true;
    return getAppointmentStatus(apt) === activeTab;
  }).sort((a, b) => {
    // Sort appointments by date - for upcoming appointments, show soonest first
    const getAppointmentDate = (apt: Appointment) => {
      if (apt.booking_start_at_raw) {
        return new Date(apt.booking_start_at_raw);
      }
      // Parse from formatted string like "Monday, March 30th, 2026 at 10:00 AM - 10:50 AM IST"
      const timeMatch = apt.booking_start_at?.match(/(\w+, \w+ \d+(?:st|nd|rd|th)?, \d+) at (\d+:\d+ [AP]M)/);
      if (timeMatch) {
        const [, dateStr, timeStr] = timeMatch;
        // Remove ordinal suffixes (st, nd, rd, th) for proper date parsing
        const cleanDateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1');
        return new Date(`${cleanDateStr} ${timeStr}`);
      }
      return new Date(0); // fallback to epoch if can't parse
    };

    const dateA = getAppointmentDate(a);
    const dateB = getAppointmentDate(b);

    // For upcoming appointments (scheduled), sort ascending (soonest first)
    if (activeTab === 'scheduled') {
      return dateA.getTime() - dateB.getTime();
    }
    
    // For other tabs, sort descending (most recent first)
    return dateB.getTime() - dateA.getTime();
  });

  const totalPages = Math.ceil(filteredAppointments.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedAppointments = filteredAppointments.slice(startIndex, startIndex + itemsPerPage);

  const showRating = ['all', 'completed', 'pending_notes'].includes(activeTab);
  const colCount = 7 + (isFeedbackTab ? 1 : 0) + (showRating ? 1 : 0);

  const exportToCSV = () => {
    const headers = ['Session Timings', 'Session Name', 'Client Name', 'Phone', 'Email', 'Therapist Name', 'Mode'];
    const rows = filteredAppointments.map(apt => [
      apt.booking_start_at,
      apt.booking_resource_name,
      apt.invitee_name,
      apt.invitee_phone,
      apt.invitee_email,
      apt.booking_host_name,
      apt.booking_mode
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Appointments')
    XLSX.writeFile(wb, `appointments_export_${new Date().toISOString().split('T')[0]}.xlsx`)
  };

  // Formats raw datetime string as "Monday, March 30th, 2026" and "10:00 AM - 10:50 AM"
  const formatCurrentDateTime = (apt: Appointment) => {
    return apt.booking_start_at || 'N/A';
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Bookings</h1>
          <p className="text-gray-600">View Recently Book Session, Send Invite and more...</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 flex-wrap">
        {tabs.map((tab) => {
          const tabCount = appointments.filter(apt => {
            if ((apt.booking_host_name || '').trim().toLowerCase() === 'safestories') return false;
            if (selectedTherapist !== 'All Therapists' && apt.booking_host_name !== selectedTherapist) return false;
            if (selectedMonth !== 'All Time') {
              const [mName, mYear] = selectedMonth.split(' ');
              const monthMap: { [key: string]: number } = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
              const rawDate = apt.booking_start_at_raw ? new Date(apt.booking_start_at_raw) : (() => { const m = apt.booking_start_at?.match(/(\w+, \w+ \d+, \d+)/); return m ? new Date(m[1]) : null; })();
              if (!rawDate) return false;
              if (rawDate.getFullYear() !== parseInt(mYear) || rawDate.getMonth() !== monthMap[mName]) return false;
            }
            return tab.id === 'all' ? true : getAppointmentStatus(apt) === tab.id;
          }).length;

          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setCurrentPage(1);
                setSelectedForFeedback(new Set());
              }}
              className={`pb-2 font-medium flex items-center gap-1.5 ${activeTab === tab.id
                  ? 'text-teal-700 border-b-2 border-teal-700'
                  : 'text-gray-400'
                }`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                {tabCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div className="relative mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search appointments by session, client or therapist name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {/* Unified Filter Button */}
        <div className="relative self-stretch flex" ref={filterRef}>
          <button
            onClick={() => setIsFilterOpen(prev => !prev)}
            className="relative flex items-center justify-center rounded-lg text-white text-sm h-full aspect-square"
            style={{ backgroundColor: '#21615D' }}
          >
            <Filter size={20} className="text-white" />
            {isFilterActive && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-400 rounded-full border-2 border-white" />
            )}
          </button>

          {isFilterOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-50 w-64 p-4">
              {/* Month */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Month</p>
                <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                  <button
                    onClick={() => { setSelectedMonth('All Time'); setCurrentPage(1); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-sm ${selectedMonth === 'All Time' ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    All Time
                  </button>
                  {monthOptions.map(m => (
                    <button
                      key={m}
                      onClick={() => { setSelectedMonth(m); setCurrentPage(1); }}
                      className={`w-full text-left px-3 py-1.5 rounded text-sm ${selectedMonth === m ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Therapist */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Therapist</p>
                <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
                  {therapistOptions.map(t => (
                    <button
                      key={t}
                      onClick={() => { setSelectedTherapist(t); setCurrentPage(1); }}
                      className={`w-full text-left px-3 py-1.5 rounded text-sm ${selectedTherapist === t ? 'bg-teal-50 text-teal-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clear */}
              {isFilterActive && (
                <button
                  onClick={() => { setSelectedMonth('All Time'); setSelectedTherapist('All Therapists'); setCurrentPage(1); }}
                  className="mt-3 w-full text-center text-xs text-red-500 hover:text-red-700"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>

        <button
          onClick={exportToCSV}
          className="bg-teal-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-800 whitespace-nowrap text-sm"
        >
          <Download size={16} />
          Export Excel
        </button>
      </div>

      {/* Appointments Table */}
      {loading ? (
        <Loader />
      ) : (
        <div className="bg-white rounded-lg border flex-1 flex flex-col">
          {/* Bulk feedback bar */}
          {isFeedbackTab && selectedForFeedback.size > 0 && (
            <div className="flex items-center gap-4 px-6 py-3 bg-teal-50 border-b border-teal-200">
              <span className="text-sm font-medium text-teal-800">{selectedForFeedback.size} selected</span>
              <button
                onClick={() => setShowBulkFeedbackModal(true)}
                className="px-4 py-1.5 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 flex items-center gap-2"
              >
                ⭐ Request Feedback ({selectedForFeedback.size})
              </button>
              <button
                onClick={() => setSelectedForFeedback(new Set())}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Clear
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full" ref={appointmentActionsRef}>
              <thead className="bg-gray-50 border-b">
                <tr>
                  {isFeedbackTab && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-teal-600 cursor-pointer"
                        checked={paginatedAppointments.length > 0 && paginatedAppointments.filter(a => a.booking_id != null).every(a => selectedForFeedback.has(a.booking_id as number))}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Timings</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Contact Info</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Therapist Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                  {showRating && <th className="px-6 py-3 text-center text-sm font-medium text-gray-600">Feedback</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={colCount} className="text-center text-gray-400 py-8">Loading...</td>
                  </tr>
                ) : filteredAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="text-center text-gray-400 py-8">No bookings found</td>
                  </tr>
                ) : (
                  paginatedAppointments.map((apt, index) => (
                    <React.Fragment key={index}>
                      <tr
                        className={`border-b cursor-pointer transition-colors ${selectedRowIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                          }`}
                        onClick={() => setSelectedRowIndex(selectedRowIndex === index ? null : index)}
                      >
                        {isFeedbackTab && (
                          <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-teal-600 cursor-pointer"
                              checked={apt.booking_id != null && selectedForFeedback.has(apt.booking_id)}
                              onChange={e => toggleSelectForFeedback(apt.booking_id as number, e as any)}
                              onClick={e => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td className="px-6 py-4 text-sm">{apt.booking_start_at}</td>
                        <td className="px-6 py-4 text-sm">{getSessionName(apt)}</td>
                        <td className="px-6 py-4 text-sm whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onClientClick) {
                                onClientClick({
                                  invitee_name: apt.invitee_name,
                                  invitee_email: apt.invitee_email,
                                  invitee_phone: apt.invitee_phone
                                });
                              }
                            }}
                            className="text-teal-700 hover:underline font-medium"
                          >
                            {apt.invitee_name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div>{apt.invitee_phone}</div>
                          <div className="text-gray-500 text-xs">{apt.invitee_email}</div>
                        </td>
                        <td className="px-6 py-4 text-sm">{apt.booking_host_name}</td>
                        <td className="px-6 py-4 text-sm">{formatMode(apt.booking_mode)}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getAppointmentStatus(apt) === 'completed' ? 'bg-green-100 text-green-700' :
                              getAppointmentStatus(apt) === 'cancelled' ? 'bg-red-100 text-red-700' :
                                getAppointmentStatus(apt) === 'no_show' ? 'bg-orange-100 text-orange-700' :
                                  getAppointmentStatus(apt) === 'pending_notes' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-blue-100 text-blue-700'
                            }`}>
                            {getAppointmentStatus(apt) === 'pending_notes' ? 'Pending Notes' :
                              getAppointmentStatus(apt) === 'no_show' ? 'No Show' :
                                getAppointmentStatus(apt).charAt(0).toUpperCase() + getAppointmentStatus(apt).slice(1)}
                          </span>
                        </td>
                        {showRating && (
                          <td className="px-6 py-4 text-sm font-medium text-gray-700 text-center" onClick={e => e.stopPropagation()}>
                            {apt.client_rating ? (
                              <span className="inline-flex px-2 py-1 rounded-lg text-xs items-center gap-1 bg-yellow-50 border border-yellow-200 text-yellow-700 whitespace-nowrap">
                                ⭐ {apt.client_rating}/5
                              </span>
                            ) : (
                              (getAppointmentStatus(apt) === 'completed' || getAppointmentStatus(apt) === 'pending_notes') ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFeedbackTarget(apt);
                                    setShowFeedbackModal(true);
                                  }}
                                  className="px-4 py-1.5 rounded-lg text-sm flex items-center justify-center gap-1.5 bg-white border border-teal-700 hover:bg-teal-50 whitespace-nowrap mx-auto"
                                >
                                  <span>⭐</span>
                                  <span className="text-teal-700 font-medium">Request</span>
                                </button>
                              ) : '-'
                            )}
                          </td>
                        )}
                      </tr>
                      {selectedRowIndex === index && (
                        <tr className="bg-gray-100">
                          <td colSpan={colCount} className="px-6 py-4">
                            <div className="flex gap-2 justify-center items-center">
                              <button
                                onClick={() => copyAppointmentDetails(apt)}
                                className="px-3 py-1.5 border border-gray-400 rounded-lg text-xs text-gray-700 hover:bg-white flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <Copy size={13} />
                                Copy Details
                              </button>
                              <button
                                onClick={() => handleReminderClick(apt)}
                                disabled={isMeetingEnded(apt) || apt.booking_status === 'cancelled'}
                                className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 whitespace-nowrap ${isMeetingEnded(apt) || apt.booking_status === 'cancelled'
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                    : 'border border-gray-400 text-gray-700 hover:bg-white'
                                  }`}
                              >
                                <Send size={13} />
                                Send Reminder
                              </button>
                              <button
                                onClick={() => handleSessionNotesReminder(apt)}
                                disabled={!isMeetingEnded(apt) || apt.has_session_notes || apt.booking_status === 'cancelled'}
                                className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 whitespace-nowrap ${!isMeetingEnded(apt) || apt.has_session_notes || apt.booking_status === 'cancelled'
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                    : 'bg-white text-blue-600 border border-blue-600 hover:bg-blue-50'
                                  }`}
                              >
                                <FileText size={13} />
                                Session Notes Reminder
                              </button>
                              {/* Reschedule — only for upcoming/scheduled bookings */}
                              {getAppointmentStatus(apt) === 'scheduled' && apt.booking_status !== 'cancelled' && (
                                <button
                                  onClick={() => openRescheduleModal(apt)}
                                  className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-teal-600 text-teal-700 bg-white hover:bg-teal-50 whitespace-nowrap"
                                >
                                  <RefreshCw size={13} />
                                  Reschedule
                                </button>
                              )}
                              {/* Cancel — only for upcoming/scheduled bookings */}
                              {getAppointmentStatus(apt) === 'scheduled' && apt.booking_status !== 'cancelled' && (
                                <button
                                  onClick={() => openCancelModal(apt)}
                                  className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-red-500 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap"
                                >
                                  <X size={13} />
                                  Cancel Booking
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t flex justify-between items-center">
            <span className="text-sm text-gray-600">Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredAppointments.length)} of {filteredAppointments.length} booking{filteredAppointments.length !== 1 ? 's' : ''}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ←
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}

      <SendBookingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Give Feedback Confirmation Modal */}
      {showFeedbackModal && feedbackTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">Request Feedback</h3>
            <p className="text-gray-600 mb-6 font-medium">
              This will send a feedback reminder to <span className="text-teal-700">{feedbackTarget.invitee_name}</span> asking them to rate their session. Would you like to proceed?
            </p>
            <div className="flex gap-3">
              <button 
                onClick={async () => {
                  setIsSendingFeedback(true);
                  try {
                    const webhookData = {
                      bookingId: feedbackTarget.booking_id,
                      clientName: feedbackTarget.invitee_name,
                      clientEmail: feedbackTarget.invitee_email,
                      clientPhone: feedbackTarget.invitee_phone,
                      therapistName: feedbackTarget.booking_host_name,
                      sessionName: feedbackTarget.booking_resource_name,
                      sessionDate: feedbackTarget.booking_start_at
                    };
                    
                    const response = await fetch('https://n8n.srv1169280.hstgr.cloud/webhook/6e110a22-ddc7-487b-8995-233b94ecb2c5', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(webhookData)
                    });

                    if (response.ok) {
                      setToast({ message: `Feedback request sent to ${feedbackTarget.invitee_name} successfully!`, type: 'success' });
                    } else {
                      setToast({ message: 'Failed to send feedback request', type: 'error' });
                    }
                  } catch (err) {
                    console.error('Error sending feedback:', err);
                    setToast({ message: 'Failed to send feedback request', type: 'error' });
                  } finally {
                    setIsSendingFeedback(false);
                    setShowFeedbackModal(false);
                    setFeedbackTarget(null);
                  }
                }} 
                disabled={isSendingFeedback}
                className="flex-1 px-4 py-2.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 font-semibold disabled:opacity-50"
              >
                {isSendingFeedback ? 'Sending...' : 'Yes'}
              </button>
              <button 
                onClick={() => { setShowFeedbackModal(false); setFeedbackTarget(null); }} 
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 font-semibold"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Feedback Confirmation Modal */}
      {showBulkFeedbackModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">Request Feedback</h3>
            <p className="text-gray-600 mb-6 font-medium">
              This will send a feedback reminder to <span className="text-teal-700">{selectedForFeedback.size} client{selectedForFeedback.size > 1 ? 's' : ''}</span> asking them to rate their session. Would you like to proceed?
            </p>
            {isSendingBulkFeedback && (
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Sending...</span>
                  <span>{bulkFeedbackProgress} / {selectedForFeedback.size}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-teal-600 h-2 rounded-full transition-all"
                    style={{ width: `${(bulkFeedbackProgress / selectedForFeedback.size) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleBulkFeedbackSend}
                disabled={isSendingBulkFeedback}
                className="flex-1 px-4 py-2.5 bg-teal-700 text-white rounded-lg hover:bg-teal-800 font-semibold disabled:opacity-50"
              >
                {isSendingBulkFeedback ? 'Sending...' : 'Yes, Send All'}
              </button>
              <button
                onClick={() => setShowBulkFeedbackModal(false)}
                disabled={isSendingBulkFeedback}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 font-semibold disabled:opacity-50"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* WhatsApp Reminder Modal */}
      {showReminderModal && selectedAppointment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Sending Manual Reminder</h3>
            <p className="text-gray-600 mb-4">This will send a reminder message to {selectedAppointment.invitee_name} on Whatsapp</p>
            <div className="flex gap-3">
              <button onClick={sendWhatsAppNotification} className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">Send</button>
              <button onClick={() => { setShowReminderModal(false); setSelectedAppointment(null); }} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reschedule Booking Modal ──────────────────────────────────────────── */}
      {showRescheduleModal && rescheduleTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]" onClick={() => setShowRescheduleModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-start p-6 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Reschedule Booking</h3>
                <p className="text-sm text-gray-500 mt-1">
                  You can reschedule the booking to a new date & time.{' '}
                </p>
              </div>
              <button onClick={() => setShowRescheduleModal(false)} className="text-gray-400 hover:text-gray-600 ml-4 mt-1">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Current Date & Time */}
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">Current Date &amp; Time</p>
                <div className="space-y-1 text-sm text-gray-400">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} />
                    <span className="line-through">{rescheduleTarget.booking_start_at?.split(' at ')[0] || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300">🕐</span>
                    <span className="line-through">
                      {rescheduleTarget.booking_start_at?.match(/at (.+?) IST/)?.[1] || rescheduleTarget.booking_start_at?.split(' at ')[1] || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              {/* New Date & Time */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  New Date &amp; Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={rescheduleDateTime}
                  onChange={e => setRescheduleDateTime(e.target.value)}
                  min={new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  className="w-full px-4 py-3 border-2 border-gray-900 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <div className="flex items-center gap-3 mt-3">
                  <input
                    type="number"
                    value={rescheduleDuration}
                    onChange={e => setRescheduleDuration(Number(e.target.value))}
                    min={1}
                    className="w-24 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <span className="text-sm text-gray-600">minutes</span>
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Reason for Rescheduling <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={rescheduleReason}
                  onChange={e => setRescheduleReason(e.target.value)}
                  placeholder="Enter reason for rescheduling..."
                  rows={3}
                  className="w-full px-4 py-3 border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Notify toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setRescheduleNotify(!rescheduleNotify)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors`}
                  style={{ backgroundColor: rescheduleNotify ? '#21615D' : '#d1d5db' }}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${rescheduleNotify ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">Notify all participants</span>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setShowRescheduleModal(false)}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReschedule}
                  disabled={isRescheduling}
                  className="px-6 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: '#21615D' }}
                >
                  {isRescheduling ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Rescheduling...</>
                  ) : 'Reschedule'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Booking Modal ───────────────────────────────────────────────── */}
      {showCancelModal && cancelTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]" onClick={() => setShowCancelModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-start p-6 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Cancel Booking</h3>
                <p className="text-sm text-gray-500 mt-1">
                  You can enable or disable the cancellation policy to allow invitees to cancel their bookings if they can't attend.{' '}
                </p>
              </div>
              <button onClick={() => setShowCancelModal(false)} className="text-gray-400 hover:text-gray-600 ml-4 mt-1">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Reason */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Reason for Cancellation <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Enter reason for cancellation..."
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-gray-900 rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              {/* Notify toggle */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCancelNotify(!cancelNotify)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors`}
                  style={{ backgroundColor: cancelNotify ? '#21615D' : '#d1d5db' }}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${cancelNotify ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm font-medium text-gray-700">Notify all participants</span>
              </div>

              {/* Actions */}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleCancelBooking}
                  disabled={isCancelling}
                  className="px-6 py-2.5 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: '#ef4444' }}
                >
                  {isCancelling ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Cancelling...</>
                  ) : 'Cancel Booking'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
