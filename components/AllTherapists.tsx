import React, { useState, useEffect } from 'react';
import { Search, ArrowLeft, User, Mail, Calendar as CalendarIcon, List, Eye, EyeOff, Edit, X, Upload, Link, ChevronDown, Copy, ExternalLink, Pencil, Check } from 'lucide-react';
import { Loader } from './Loader';
import { Toast } from './Toast';
import { TherapistCalendar } from './TherapistCalendar';
import { CaseHistoryTab } from './CaseHistoryTab';
import { ProgressNotesTab } from './ProgressNotesTab';
import { ProgressNoteDetail } from './ProgressNoteDetail';
import { GoalTrackingTab } from './GoalTrackingTab';
import { FreeConsultationDetail } from './FreeConsultationDetail';
import { ViewTherapistModal } from './ViewTherapistModal';
import { EditTherapistForm } from './EditTherapistForm';
import { ConfirmModal } from './ConfirmModal';
import EditEvent from './EditEvent';

interface Client {
  invitee_name: string;
  invitee_email: string;
  invitee_phone: string;
  emergency_contact_name?: string;
  emergency_contact_relation?: string;
  emergency_contact_email?: string;
  emergency_contact_number?: string;
  invitee_age?: number;
  invitee_gender?: string;
  invitee_occupation?: string;
  invitee_marital_status?: string;
  clinical_profile?: string;
  remarks?: string;
}

interface Appointment {
  invitee_name: string;
  invitee_email?: string;
  invitee_phone?: string;
  booking_resource_name: string;
  booking_subject?: string;
  booking_start_at: string;
  booking_invitee_time: string;
  booking_host_name?: string;
  booking_status?: string;
  mode?: string;
  has_session_notes?: boolean;
  booking_start_at_raw?: string;
}

export const AllTherapists: React.FC<{ selectedClientProp?: any; onBack?: () => void }> = ({ selectedClientProp, onBack }) => {
  const [therapists, setTherapists] = useState<any[]>([]);
  const [dbServices, setDbServices] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTherapist, setSelectedTherapist] = useState<any>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientAppointments, setClientAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [clientDetailsLoading, setClientDetailsLoading] = useState(false);

  const formatClientName = (name: string): string => {
    if (!name) return name;
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [expandedClientRows, setExpandedClientRows] = useState<Set<number>>(new Set());
  const [selectedClientForAction, setSelectedClientForAction] = useState<number | null>(null);
  const [clientAppointmentTab, setClientAppointmentTab] = useState('all');
  const [selectedAppointmentIndex, setSelectedAppointmentIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedAppointmentForReminder, setSelectedAppointmentForReminder] = useState<Appointment | null>(null);
  const [showBookingLinkConfirmModal, setShowBookingLinkConfirmModal] = useState(false);
  const [selectedClientForBookingLink, setSelectedClientForBookingLink] = useState<Client | null>(null);
  const appointmentActionsRef = React.useRef<HTMLTableElement>(null);
  const [clientDateFilter, setClientDateFilter] = useState({ start: '', end: '' });
  const [clientSelectedMonth, setClientSelectedMonth] = useState('All Time');
  const [isClientDateDropdownOpen, setIsClientDateDropdownOpen] = useState(false);
  const [showClientCustomCalendar, setShowClientCustomCalendar] = useState(false);
  const [clientStartDate, setClientStartDate] = useState('');
  const [clientEndDate, setClientEndDate] = useState('');
  const clientDropdownRef = React.useRef<HTMLDivElement>(null);
  const [clientAppointmentSearchTerm, setClientAppointmentSearchTerm] = useState('');
  const [appointmentSearchTerm, setAppointmentSearchTerm] = useState('');
  const [assignedClientSearch, setAssignedClientSearch] = useState('');
  const [assignedClientStatusFilter, setAssignedClientStatusFilter] = useState<'all' | 'active' | 'inactive' | 'drop-out'>('all');
  const [appointmentsPage, setAppointmentsPage] = useState(1);
  const appointmentsPerPage = 10;
  const [clientViewTab, setClientViewTab] = useState<'overview' | 'sessions' | 'documents' | 'caseHistory'>('overview');
  const [clientStats, setClientStats] = useState({ bookings: 0, sessionsCompleted: 0, noShows: 0, cancelled: 0 });
  const [isCaseHistoryVisible, setIsCaseHistoryVisible] = useState(false);
  const [caseHistoryData, setCaseHistoryData] = useState<any>(null);
  const [showCaseHistoryPasswordModal, setShowCaseHistoryPasswordModal] = useState(false);
  const [caseHistoryPassword, setCaseHistoryPassword] = useState('');
  const [caseHistoryPasswordError, setCaseHistoryPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedProgressNoteId, setSelectedProgressNoteId] = useState<number | null>(null);
  const [isFreeConsultationNote, setIsFreeConsultationNote] = useState(false);
  const [clientSessionType, setClientSessionType] = useState<{ hasPaidSessions: boolean; hasFreeConsultation: boolean }>({ hasPaidSessions: false, hasFreeConsultation: false });

  // View and Edit therapist states
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditMode, setShowEditMode] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [editedTherapist, setEditedTherapist] = useState<any>(null);
  const [editProfilePicture, setEditProfilePicture] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Pagination for assigned clients
  const [clientsPage, setClientsPage] = useState(1);
  const clientsPerPage = 8;

  // Multi-select for assigned clients
  const [selectedTherapistClients, setSelectedTherapistClients] = useState<Set<string>>(new Set());
  const [showTherapistBulkConfirmModal, setShowTherapistBulkConfirmModal] = useState(false);
  const [isTherapistBulkSending, setIsTherapistBulkSending] = useState(false);

  const getTherapistClientId = (client: Client) =>
    `${client.invitee_email || ''}-${client.invitee_phone || ''}`;

  const toggleTherapistClientSelection = (id: string) => {
    setSelectedTherapistClients(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleTherapistSelectAll = (filteredClients: Client[]) => {
    const allIds = new Set(filteredClients.map(getTherapistClientId));
    const allSelected = filteredClients.every(c => selectedTherapistClients.has(getTherapistClientId(c)));
    setSelectedTherapistClients(allSelected ? new Set() : allIds);
  };

  // Calendar view state
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'availabilities'>('list');
  const [selectedEditEvent, setSelectedEditEvent] = useState<any>(null);

  // Calendar filter states (for calendar view)
  const [selectedTherapistFilters, setSelectedTherapistFilters] = useState<string[]>([]);
  const [selectedModeFilter, setSelectedModeFilter] = useState<'all' | 'online' | 'in-person'>('all');
  const [selectedSessionTypeFilter, setSelectedSessionTypeFilter] = useState<'all' | 'individual' | 'couples' | 'free_consultation'>('all');
  const [openBookingLinksId, setOpenBookingLinksId] = useState<string | null>(null);
  const [editingClientContact, setEditingClientContact] = useState<Client | null>(null);
  const [isClientEditMode, setIsClientEditMode] = useState(false);
  const [clientContactEdit, setClientContactEdit] = useState({ name: '', phone: '', email: '', saving: false });

  const toggleTherapistFilter = (therapistName: string) => {
    setSelectedTherapistFilters(prev =>
      prev.includes(therapistName)
        ? prev.filter(name => name !== therapistName)
        : [...prev, therapistName]
    );
  };

  useEffect(() => {
    fetchTherapists();
    if (selectedClientProp) {
      openClientDetails(selectedClientProp);
    }
  }, [selectedClientProp]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (appointmentActionsRef.current && !appointmentActionsRef.current.contains(event.target as Node)) {
        setSelectedAppointmentIndex(null);
      }
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDateDropdownOpen(false);
        setShowClientCustomCalendar(false);
      }
      // Close booking links dropdown on click outside
      if (!(event.target as Element).closest('.booking-links-dropdown-container')) {
        setOpenBookingLinksId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchTherapists = async () => {
    try {
      setLoading(true);
      const [therapistsRes, liveSessionsRes, servicesRes] = await Promise.all([
        fetch('/api/therapists'),
        fetch('/api/therapists-live-status'),
        fetch('/api/services')
      ]);
      const therapistsData = await therapistsRes.json();
      const liveStatusData = await liveSessionsRes.json();
      const servicesData = await servicesRes.json();

      const therapistsWithStatus = therapistsData.map((t: any) => {
        const firstName = t.name ? t.name.split(' ')[0] : '';
        return {
          ...t,
          isLive: liveStatusData[firstName] || liveStatusData[t.name] || false
        };
      });

      setTherapists(therapistsWithStatus);
      setDbServices(servicesData);
    } catch (error) {
      console.error('Error fetching therapists:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTherapists = therapists
    .filter(therapist => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        therapist.name.toLowerCase().includes(query) ||
        therapist.specialization.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      if (!searchQuery) return 0;
      const query = searchQuery.toLowerCase();
      const aNameMatch = a.name.toLowerCase().includes(query);
      const bNameMatch = b.name.toLowerCase().includes(query);
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;
      return 0;
    });

  const openTherapistDetails = async (therapist: any) => {
    setSelectedTherapist(therapist);
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/therapist-details?name=${encodeURIComponent(therapist.name)}`);
      const data = await response.json();

      // Group clients by email OR phone
      const clientMap = new Map();
      const emailToKey = new Map();
      const phoneToKey = new Map();

      (data.clients || []).forEach((client: Client) => {
        let key = null;

        // Check if email already exists
        if (client.invitee_email && emailToKey.has(client.invitee_email)) {
          key = emailToKey.get(client.invitee_email);
        }
        // Check if phone already exists
        else if (client.invitee_phone && phoneToKey.has(client.invitee_phone)) {
          key = phoneToKey.get(client.invitee_phone);
        }
        // New client
        else {
          key = `client-${clientMap.size}`;
        }

        // Map both email and phone to this key
        if (client.invitee_email) emailToKey.set(client.invitee_email, key);
        if (client.invitee_phone) phoneToKey.set(client.invitee_phone, key);

        if (!clientMap.has(key)) {
          clientMap.set(key, {
            invitee_name: client.invitee_name,
            invitee_email: client.invitee_email,
            invitee_phone: client.invitee_phone,
            phoneNumbers: client.invitee_phone ? [client.invitee_phone] : []
          });
        } else {
          const groupedClient = clientMap.get(key);

          // Update email if missing
          if (!groupedClient.invitee_email && client.invitee_email) {
            groupedClient.invitee_email = client.invitee_email;
            emailToKey.set(client.invitee_email, key);
          }

          // Add phone if not already in list
          if (client.invitee_phone && !groupedClient.phoneNumbers.includes(client.invitee_phone)) {
            groupedClient.phoneNumbers.push(client.invitee_phone);
            phoneToKey.set(client.invitee_phone, key);
          }
        }
      });

      const groupedClients = Array.from(clientMap.values()).map(client => ({
        ...client,
        invitee_phone: client.phoneNumbers.join(', ')
      }));

      setClients(groupedClients);
      setAppointments(data.appointments || []);
    } catch (error) {
      console.error('Error fetching therapist details:', error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeTherapistDetails = () => {
    setSelectedTherapist(null);
    setSelectedClient(null);
    setClients([]);
    setAppointments([]);
    setClientAppointments([]);
    setExpandedClientRows(new Set());
    setAppointmentsPage(1);
  };

  const toggleClientRow = (index: number) => {
    const newExpanded = new Set(expandedClientRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedClientRows(newExpanded);
  };

  const toggleClientActions = (index: number) => {
    setSelectedClientForAction(selectedClientForAction === index ? null : index);
  };

  const handleSendClientReminder = async (client: Client) => {
    // Show confirmation modal instead of sending directly
    setSelectedClientForBookingLink(client);
    setShowBookingLinkConfirmModal(true);
  };

  const confirmSendBookingLink = async () => {
    if (!selectedClientForBookingLink) return;

    const client = selectedClientForBookingLink;

    try {
      // Get the most recent therapy type for this client - same as AllClients.tsx
      let therapyType = 'Individual Therapy';
      try {
        const response = await fetch(`/api/client-therapy-type?email=${encodeURIComponent(client.invitee_email || '')}&phone=${encodeURIComponent(client.invitee_phone || '')}`);
        if (response.ok) {
          const data = await response.json();
          therapyType = data.therapy_type || 'Individual Therapy';
        }
      } catch (error) {
        console.warn('Could not fetch client therapy type, using default:', error);
      }

      // Clean therapy type to remove therapist name and "Session"
      const cleanTherapyType = (therapy: string) => {
        let cleaned = therapy.replace(/\s+with\s+[A-Za-z\s]+$/i, '').trim();
        cleaned = cleaned.replace(/\s+Session$/i, '').trim();
        return cleaned;
      };

      const isFreeConsultation = therapyType.toLowerCase().includes('free consultation');
      const webhookData = {
        clientName: client.invitee_name,
        email: client.invitee_email,
        phone: client.invitee_phone,
        therapistName: isFreeConsultation ? 'Safestories' : (selectedTherapist?.name || 'Unknown'),
        therapy: isFreeConsultation ? 'Free Consultation' : cleanTherapyType(therapyType)
      };

      const response = await fetch('/api/send-booking-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookData)
      });

      if (response.ok) {
        const result = await response.json();
        if (result.warning) {
          setToast({ message: `${result.message} (${result.warning})`, type: 'success' });
        } else {
          setToast({ message: 'Booking link sent to client successfully!', type: 'success' });
        }
      } else {
        setToast({ message: 'Failed to send booking link to client', type: 'error' });
      }
    } catch (error) {
      console.error('Error sending booking link:', error);
      setToast({ message: 'Failed to send booking link to client', type: 'error' });
    }

    // Close the modal and action row
    setShowBookingLinkConfirmModal(false);
    setSelectedClientForBookingLink(null);
    setSelectedClientForAction(null);
  };

  const confirmBulkSendFromTherapistView = async (filteredClients: Client[]) => {
    const selected = filteredClients.filter(c => selectedTherapistClients.has(getTherapistClientId(c)));
    if (selected.length === 0) return;
    setIsTherapistBulkSending(true);

    const cleanTherapyType = (therapy: string) => {
      let cleaned = therapy.replace(/\s+with\s+[A-Za-z\s]+$/i, '').trim();
      cleaned = cleaned.replace(/\s+Session$/i, '').trim();
      return cleaned;
    };

    let successCount = 0;
    let errorCount = 0;

    await Promise.all(selected.map(async (client) => {
      try {
        let therapyType = 'Individual Therapy';
        try {
          const res = await fetch(`/api/client-therapy-type?email=${encodeURIComponent(client.invitee_email || '')}&phone=${encodeURIComponent(client.invitee_phone || '')}`);
          if (res.ok) {
            const data = await res.json();
            therapyType = data.therapy_type || 'Individual Therapy';
          }
        } catch { }

        const isFreeConsultation = therapyType.toLowerCase().includes('free consultation');
        const webhookData = {
          clientName: client.invitee_name,
          email: client.invitee_email,
          phone: client.invitee_phone,
          therapistName: isFreeConsultation ? 'Safestories' : (selectedTherapist?.name || 'Unknown'),
          therapy: isFreeConsultation ? 'Free Consultation' : cleanTherapyType(therapyType)
        };

        const response = await fetch('/api/send-booking-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookData)
        });
        if (response.ok) successCount++;
        else errorCount++;
      } catch {
        errorCount++;
      }
    }));

    setToast({
      message: `Finished: ${successCount} sent successfully.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      type: errorCount === 0 ? 'success' : 'error'
    });
    setIsTherapistBulkSending(false);
    setShowTherapistBulkConfirmModal(false);
    setSelectedTherapistClients(new Set());
  };

  const handleCaseHistoryView = () => {
    if (isCaseHistoryVisible) {
      // Hide case history
      setIsCaseHistoryVisible(false);
    } else {
      // Show password modal to authenticate
      setShowCaseHistoryPasswordModal(true);
      setCaseHistoryPassword('');
      setCaseHistoryPasswordError('');
      setShowPassword(false);
    }
  };

  const handleCaseHistoryPasswordSubmit = async () => {
    if (!caseHistoryPassword) {
      setCaseHistoryPasswordError('Please enter your password');
      return;
    }

    try {
      // For admin, we need to get the username from localStorage or props
      const adminUsername = localStorage.getItem('username') || 'admin';

      // Verify password by attempting to authenticate
      const response = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUsername,
          password: caseHistoryPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        setIsCaseHistoryVisible(true);
        setShowCaseHistoryPasswordModal(false);
        setCaseHistoryPassword('');
        setCaseHistoryPasswordError('');
        setShowPassword(false);
        // Fetch case history from client_case_history table
        try {
          const chRes = await fetch(`/api/case-history?client_id=${encodeURIComponent(selectedClient.client_phone || selectedClient.invitee_phone || '')}`);
          const chData = await chRes.json();
          if (chData.success) setCaseHistoryData(chData.data);
        } catch (e) {
          console.error('Failed to fetch case history', e);
        }
      } else {
        setCaseHistoryPasswordError('Incorrect password');
      }
    } catch (error) {
      console.error('Password verification error:', error);
      setCaseHistoryPasswordError('Error verifying password');
    }
  };

  const openClientDetails = async (client: any) => {
    const normalizedClient = {
      invitee_name: client.invitee_name || client.client_name || 'Unknown',
      invitee_email: client.invitee_email || '',
      invitee_phone: client.invitee_phone || ''
    };

    setSelectedClient(normalizedClient);

    if (!normalizedClient.invitee_email && !normalizedClient.invitee_phone) {
      setClientAppointments([]);
      return;
    }

    setClientDetailsLoading(true);
    try {
      // Fetch client session type
      try {
        const apiUrl = `/api/client-session-type?client_id=${encodeURIComponent(normalizedClient.invitee_phone)}`;
        const sessionTypeRes = await fetch(apiUrl);
        if (sessionTypeRes.ok) {
          const sessionTypeData = await sessionTypeRes.json();
          if (sessionTypeData.success) {
            setClientSessionType(sessionTypeData.data);
          } else {
            console.error('❌ [AllTherapists] Session type API returned success: false');
            // Default to showing paid session UI if API fails
            setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
          }
        } else {
          console.error('❌ [AllTherapists] Session type API failed:', sessionTypeRes.status);
          // Default to showing paid session UI if API fails
          setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
        }
      } catch (sessionTypeError) {
        console.error('❌ [AllTherapists] Session type API error:', sessionTypeError);
        // Default to showing paid session UI if API call throws error
        setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
      }

      const params = new URLSearchParams();
      if (normalizedClient.invitee_email) params.append('email', normalizedClient.invitee_email);
      if (normalizedClient.invitee_phone) {
        // Handle multiple phone numbers
        const phones = normalizedClient.invitee_phone.split(', ');
        phones.forEach(phone => params.append('phone', phone.trim()));
      }

      const response = await fetch(`/api/client-details?${params.toString()}`);
      const data = await response.json();

      const appointmentsWithStatus = (data.appointments || []).map((apt: any) => {
        // Use the same logic as Appointments component
        let status = apt.booking_status || 'confirmed';

        // Calculate status using the same logic as Appointments.tsx
        if (status === 'cancelled' || status === 'canceled') {
          status = 'cancelled';
        } else if (status === 'no_show' || status === 'no show') {
          status = 'no_show';
        } else if (apt.has_session_notes) {
          status = 'completed';
        } else {
          // Parse booking_invitee_time to check if session ended
          if (apt.booking_invitee_time) {
            const timeMatch = apt.booking_invitee_time.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
            if (timeMatch) {
              const [, dateStr, , endTimeStr] = timeMatch;
              const endDateTime = new Date(`${dateStr} ${endTimeStr}`);

              // Check if the date is valid and if session has ended
              if (!isNaN(endDateTime.getTime())) {
                const now = new Date();
                if (endDateTime < now && !apt.has_session_notes) {
                  status = 'pending_notes';
                } else {
                  status = 'scheduled';
                }
              } else {
                status = 'scheduled';
              }
            } else {
              status = 'scheduled';
            }
          } else {
            status = 'scheduled';
          }
        }

        return {
          ...apt,
          booking_status: status
        };
      });

      setClientAppointments(appointmentsWithStatus);

      // Calculate stats (same logic as Appointments component)
      const bookings = appointmentsWithStatus.length; // Total appointments
      const sessionsCompleted = appointmentsWithStatus.filter((apt: any) => {
        // Check if session has ended (not just started)
        let hasEnded = false;
        if (apt.booking_invitee_time) {
          const timeMatch = apt.booking_invitee_time.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
          if (timeMatch) {
            const [, dateStr, , endTimeStr] = timeMatch;
            const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
            hasEnded = endDateTime < new Date();
          }
        }
        const isNotCancelledOrNoShow = apt.booking_status !== 'cancelled' && apt.booking_status !== 'no_show';
        return hasEnded && isNotCancelledOrNoShow;
      }).length; // Only past sessions (completed + pending notes), excluding cancelled/no_show
      const noShows = appointmentsWithStatus.filter((apt: any) => apt.booking_status === 'no_show').length;
      const cancelled = appointmentsWithStatus.filter((apt: any) => apt.booking_status === 'cancelled').length;
      setClientStats({ bookings, sessionsCompleted, noShows, cancelled });

      // Update selectedClient with emergency contact, demographic data, and remarks from the most recent appointment
      if (data.appointments && data.appointments.length > 0) {
        const aptWithEmergency = data.appointments.find((apt: any) => apt.emergency_contact_name) || data.appointments[0];

        // Get invitee_question (remarks) from the most recent appointment that has it
        const aptWithRemarks = data.appointments.find((apt: any) => apt.invitee_question) || aptWithEmergency;

        setSelectedClient((prev: any) => ({
          ...prev,
          emergency_contact_name: aptWithEmergency.emergency_contact_name,
          emergency_contact_relation: aptWithEmergency.emergency_contact_relation,
          emergency_contact_number: aptWithEmergency.emergency_contact_number,
          invitee_age: aptWithEmergency.invitee_age,
          invitee_gender: aptWithEmergency.invitee_gender,
          invitee_occupation: aptWithEmergency.invitee_occupation,
          invitee_marital_status: aptWithEmergency.invitee_marital_status,
          clinical_profile: aptWithEmergency.clinical_profile,
          remarks: aptWithRemarks.invitee_question
        }));
      }
    } catch (error) {
      console.error('Error fetching client details:', error);
    } finally {
      setClientDetailsLoading(false);
    }
  };

  const closeClientDetails = () => {
    setSelectedClient(null);
    setClientAppointments([]);
    if (onBack) {
      onBack();
    }
  };

  const copyAppointmentDetails = (apt: Appointment) => {
    const details = `${apt.booking_resource_name}\n${apt.booking_invitee_time}\nTime zone: Asia/Kolkata\n${apt.booking_host_name ? 'Therapist: ' + apt.booking_host_name : ''}`;
    navigator.clipboard.writeText(details).then(() => {
      setToast({ message: 'Appointment details copied to clipboard!', type: 'success' });
    }).catch(() => {
      setToast({ message: 'Failed to copy details', type: 'error' });
    });
  };

  const isMeetingEnded = (apt: Appointment) => {
    if (apt.booking_start_at_raw) {
      return new Date(apt.booking_start_at_raw) < new Date();
    }
    return false;
  };

  const handleReminderClick = async (apt: Appointment) => {
    if (isMeetingEnded(apt)) {
      setToast({ message: 'Cannot send reminder after meeting has ended', type: 'error' });
      return;
    }

    setSelectedAppointmentForReminder(apt);
    setShowReminderModal(true);
  };

  const sendWhatsAppNotification = async () => {
    if (!selectedAppointmentForReminder || !selectedClient) return;

    const webhookData = {
      sessionTimings: selectedAppointmentForReminder.booking_invitee_time,
      sessionName: selectedAppointmentForReminder.booking_resource_name,
      clientName: selectedClient.invitee_name,
      phone: selectedClient.invitee_phone,
      email: selectedClient.invitee_email,
      therapistName: selectedAppointmentForReminder.booking_host_name || selectedTherapist?.name,
      mode: 'Online',
      meetingLink: '',
      checkinUrl: ''
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
      setToast({ message: 'Failed to send WhatsApp notification', type: 'error' });
    }
    setShowReminderModal(false);
    setSelectedAppointmentForReminder(null);
  };

  const handleClientMonthSelect = (month: string) => {
    setClientSelectedMonth(month);
    setIsClientDateDropdownOpen(false);
    setShowClientCustomCalendar(false);

    const [monthName, year] = month.split(' ');
    const monthMap: { [key: string]: number } = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    const monthNum = monthMap[monthName];
    const start = `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(parseInt(year), monthNum + 1, 0).getDate();
    const end = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    setClientDateFilter({ start, end });
  };

  const handleClientCustomDateApply = () => {
    if (clientStartDate && clientEndDate) {
      setClientDateFilter({ start: clientStartDate, end: clientEndDate });
      setClientSelectedMonth(`${clientStartDate} to ${clientEndDate}`);
      setShowClientCustomCalendar(false);
      setIsClientDateDropdownOpen(false);
    }
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
      therapistName: apt.booking_host_name || selectedTherapist?.name,
      clientName: selectedClient?.invitee_name,
      sessionName: apt.booking_resource_name,
      sessionTimings: apt.booking_invitee_time
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
      setToast({ message: 'Failed to send reminder', type: 'error' });
    }
  };

  const getClientStatus = (client: Client, appointmentsToCheck?: Appointment[]): 'active' | 'inactive' | 'drop-out' => {
    // Use clientAppointments if viewing a specific client, otherwise use all appointments
    const appointmentsData = appointmentsToCheck || appointments;

    // If no appointments data, return inactive
    if (!appointmentsData || appointmentsData.length === 0) {
      return 'inactive';
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all client appointments (excluding cancelled)
    const clientAppointments = appointmentsData.filter(apt => {
      const clientEmail = client.invitee_email?.toLowerCase().trim();
      const aptEmail = apt.invitee_email?.toLowerCase().trim();

      // Handle multiple phone numbers (comma-separated) or single phone
      const clientPhones = client.invitee_phone
        ? client.invitee_phone.split(',').map(p => p.trim().replace(/[\s\-\(\)\+]/g, ''))
        : [];
      const aptPhone = apt.invitee_phone?.replace(/[\s\-\(\)\+]/g, '');

      const emailMatch = clientEmail && aptEmail && clientEmail === aptEmail;
      const phoneMatch = aptPhone && clientPhones.some(phone => phone === aptPhone);
      const isNotCancelled = apt.booking_status !== 'cancelled' && apt.booking_status !== 'canceled';

      return (emailMatch || phoneMatch) && isNotCancelled;
    });

    if (clientAppointments.length === 0) {
      return 'inactive';
    }

    // Check if client has any appointments in the last 30 days
    const hasRecentAppointment = clientAppointments.some(apt => {
      const aptDate = apt.booking_start_at ? new Date(apt.booking_start_at) : new Date();
      return aptDate >= thirtyDaysAgo;
    });

    // Active: Has session in last 30 days
    if (hasRecentAppointment) {
      return 'active';
    }

    // Drop-out: Only 1 session and >30 days since that session
    if (clientAppointments.length === 1) {
      return 'drop-out';
    }

    // Inactive: More than 1 session but >30 days since last session
    return 'inactive';
  };

  // Handler for saving edited therapist
  const handleSaveTherapist = async (updatedTherapist: any, profilePicture: File | null) => {
    setShowConfirmModal(true);
  };

  const confirmSaveTherapist = async () => {
    setSaving(true);
    setShowConfirmModal(false);

    try {
      let profilePictureUrl = editedTherapist.profile_picture_url;

      // Upload profile picture if changed
      if (editProfilePicture) {
        const formData = new FormData();
        formData.append('file', editProfilePicture);
        formData.append('folder', 'profile-pictures');

        const uploadResponse = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload profile picture');
        }

        const uploadData = await uploadResponse.json();
        if (uploadData.success) {
          profilePictureUrl = uploadData.url;
        }
      }

      // Update therapist profile
      const response = await fetch('/api/therapist-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapist_id: selectedTherapist.therapist_id,
          name: editedTherapist.name,
          email: editedTherapist.email,
          phone: editedTherapist.phone_number,
          specializations: editedTherapist.specializations,
          profilePictureUrl
        })
      });

      const data = await response.json();

      if (data.success) {
        setToast({ message: 'Therapist profile updated successfully!', type: 'success' });

        // Update local state
        setSelectedTherapist({
          ...selectedTherapist,
          ...editedTherapist,
          profile_picture_url: profilePictureUrl,
          specialization: editedTherapist.specializations
        });

        // Refresh therapists list
        fetchTherapists();

        setShowEditMode(false);
        setEditProfilePicture(null);
      } else {
        setToast({ message: data.error || 'Failed to update profile', type: 'error' });
      }
    } catch (error) {
      console.error('Error:', error);
      setToast({ message: 'An error occurred while updating profile', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (selectedClient) {
    return (
      <>
      <div className="p-8 h-full overflow-auto">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={closeClientDetails}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{formatClientName(selectedClient.invitee_name)}</h1>
            <span
              className="px-3 py-1 rounded-full text-sm font-medium text-white"
              style={{
                backgroundColor:
                  getClientStatus(selectedClient, clientAppointments) === 'active' ? '#21615D' :
                    getClientStatus(selectedClient, clientAppointments) === 'drop-out' ? '#B91C1C' :
                      '#9CA3AF'
              }}
            >
              {getClientStatus(selectedClient, clientAppointments) === 'active' ? 'Active' :
                getClientStatus(selectedClient, clientAppointments) === 'drop-out' ? 'Drop-out' : 'Inactive'}
            </span>
            <button
              onClick={() => {
                if (isClientEditMode) {
                  setIsClientEditMode(false);
                } else {
                  setClientContactEdit({ name: selectedClient.invitee_name, phone: selectedClient.invitee_phone || '', email: selectedClient.invitee_email || '', saving: false });
                  setIsClientEditMode(true);
                }
              }}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isClientEditMode
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'text-teal-700 border border-teal-200 hover:bg-teal-50'
              }`}
            >
              <Pencil size={14} />
              {isClientEditMode ? 'Exit Edit Mode' : 'Edit Mode'}
            </button>
            {isClientEditMode && (
              <button
                onClick={async () => {
                  setClientContactEdit(prev => ({ ...prev, saving: true }));
                  try {
                    const res = await fetch('/api/clients/update-contact', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        old_phone: selectedClient.invitee_phone || undefined,
                        old_email: selectedClient.invitee_email || undefined,
                        new_name: clientContactEdit.name !== selectedClient.invitee_name ? clientContactEdit.name : undefined,
                        new_phone: clientContactEdit.phone !== selectedClient.invitee_phone ? clientContactEdit.phone : undefined,
                        new_email: clientContactEdit.email !== selectedClient.invitee_email ? clientContactEdit.email : undefined,
                        _audit_user: JSON.parse(localStorage.getItem('user') || '{}')
                      })
                    });
                    if (res.ok) {
                      setSelectedClient(prev => prev ? { ...prev, invitee_name: clientContactEdit.name, invitee_phone: clientContactEdit.phone, invitee_email: clientContactEdit.email } : prev);
                      setToast({ message: 'Client updated successfully', type: 'success' });
                      setIsClientEditMode(false);
                    } else {
                      setToast({ message: 'Failed to save', type: 'error' });
                    }
                  } catch {
                    setToast({ message: 'Network error', type: 'error' });
                  } finally {
                    setClientContactEdit(prev => ({ ...prev, saving: false }));
                  }
                }}
                disabled={clientContactEdit.saving}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50"
              >
                <Check size={14} />
                {clientContactEdit.saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>

        {/* Two Column Layout - Left side fixed, Right side with tabs */}
        <div className="grid grid-cols-12 gap-6">
          {/* Left Column - Client Information (Always Visible) */}
          <div className="col-span-4 space-y-6">
            {/* Contact Info */}
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Contact Info:</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                  {isClientEditMode ? (
                    <input type="tel" value={clientContactEdit.phone} onChange={e => setClientContactEdit(prev => ({ ...prev, phone: e.target.value }))} className="flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="Phone" />
                  ) : (
                    <span className="text-gray-700">{selectedClient.invitee_phone || 'N/A'}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Mail size={18} />
                  {isClientEditMode ? (
                    <input type="email" value={clientContactEdit.email} onChange={e => setClientContactEdit(prev => ({ ...prev, email: e.target.value }))} className="flex-1 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-teal-500" placeholder="Email" />
                  ) : (
                    <span className="text-gray-700">{selectedClient.invitee_email || 'N/A'}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Emergency Contact:</h3>
              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="mb-2">
                  <span className="font-medium text-sm">{selectedClient.emergency_contact_name || 'Not provided'}</span>
                </div>
                {selectedClient.emergency_contact_relation && (
                  <div className="text-sm text-gray-600 mb-1">({selectedClient.emergency_contact_relation})</div>
                )}
                {selectedClient.emergency_contact_number && (
                  <div className="text-sm text-gray-600">{selectedClient.emergency_contact_number}</div>
                )}
              </div>
            </div>

            {/* Case History / Pre-therapy Notes */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-gray-600">
                  {clientSessionType.hasPaidSessions ? 'Case History:' : 'Pre-therapy Notes:'}
                </h3>
                {clientSessionType.hasPaidSessions && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleCaseHistoryView}
                      className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                      title={isCaseHistoryVisible ? "Hide Case History" : "View Case History"}
                    >
                      {isCaseHistoryVisible ? (
                        <Eye size={16} className="text-gray-600" />
                      ) : (
                        <EyeOff size={16} className="text-gray-600" />
                      )}
                    </button>
                    <button
                      disabled={!isCaseHistoryVisible}
                      className={`p-1.5 rounded transition-colors ${isCaseHistoryVisible
                          ? 'hover:bg-gray-200 cursor-pointer'
                          : 'cursor-not-allowed opacity-40'
                        }`}
                      title={isCaseHistoryVisible ? "Edit Case History" : "View case history first to edit"}
                    >
                      <Edit size={16} className="text-gray-600" />
                    </button>
                  </div>
                )}
              </div>
              <div className="border rounded-lg p-4 bg-gray-50 min-h-[100px]">
                {clientSessionType.hasPaidSessions ? (
                  // Show case history for paid sessions
                  isCaseHistoryVisible ? (
                    caseHistoryData ? (
                      <div className="space-y-2 text-sm text-gray-700">
                        {caseHistoryData.age && <p><span className="font-medium">Age:</span> {caseHistoryData.age}</p>}
                        {caseHistoryData.gender_identity && <p><span className="font-medium">Gender:</span> {caseHistoryData.gender_identity}</p>}
                        {caseHistoryData.presenting_concerns && <p><span className="font-medium">Presenting Concerns:</span> {caseHistoryData.presenting_concerns}</p>}
                        {caseHistoryData.medical_history && <p><span className="font-medium">Medical History:</span> {caseHistoryData.medical_history}</p>}
                        {caseHistoryData.previous_mental_health && <p><span className="font-medium">Previous Mental Health:</span> {caseHistoryData.previous_mental_health}</p>}
                        {caseHistoryData.insight_level && <p><span className="font-medium">Insight Level:</span> {caseHistoryData.insight_level}</p>}
                        {!caseHistoryData.age && !caseHistoryData.presenting_concerns && (
                          <p className="text-gray-400 italic">Case history form not yet filled</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm italic">No case history found. Fill the session form to add.</p>
                    )
                  ) : (
                    <div className="flex items-center justify-center h-20">
                      <p className="text-gray-400 text-sm">Case history is hidden. Click the eye icon to view.</p>
                    </div>
                  )
                ) : (
                  // Show message for free consultation only
                  <div className="flex items-center justify-center h-20">
                    <p className="text-gray-400 text-sm">Pre-therapy notes will appear after consultation form is filled</p>
                  </div>
                )}
              </div>
            </div>

            {/* Client's Remarks */}
            <div>
              <h3 className="text-sm font-semibold text-gray-600 mb-3">Client's Remarks:</h3>
              <div className="border rounded-lg p-4 bg-gray-50 min-h-[100px]">
                {selectedClient.remarks ? (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedClient.remarks}</p>
                ) : (
                  <div className="flex items-center justify-center h-20">
                    <p className="text-gray-400 text-sm">No remarks available</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Tabbed Content */}
          <div className="col-span-8 space-y-6">
            {/* Navigation Tabs */}
            <div className="flex gap-8 border-b">
              {clientSessionType.hasPaidSessions ? (
                // Show all tabs for paid sessions (removed Case History tab)
                [
                  { id: 'overview' as const, label: 'Overview' },
                  { id: 'sessions' as const, label: 'Progress Notes' },
                  { id: 'documents' as const, label: 'Goal Tracking' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setClientViewTab(tab.id)}
                    className={`pb-3 font-medium text-sm ${clientViewTab === tab.id
                        ? 'text-teal-700 border-b-2 border-teal-700'
                        : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))
              ) : (
                // Show only Overview for free consultation only (removed Pre-therapy Notes tab)
                [
                  { id: 'overview' as const, label: 'Overview' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setClientViewTab(tab.id)}
                    className={`pb-3 font-medium text-sm ${clientViewTab === tab.id
                        ? 'text-teal-700 border-b-2 border-teal-700'
                        : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))
              )}
            </div>

            {/* Date Filter */}
            <div className="flex justify-end">
              <div className="relative" ref={clientDropdownRef}>
                <button
                  onClick={() => setIsClientDateDropdownOpen(!isClientDateDropdownOpen)}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-white text-sm font-medium"
                  style={{ backgroundColor: '#21615D', minWidth: 160 }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span style={{ flex: 1, textAlign: 'left' }}>{clientSelectedMonth}</span>
                  {isClientDateDropdownOpen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  )}
                </button>
                {isClientDateDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-10">
                    {!showClientCustomCalendar ? (
                      <>
                        <button
                          onClick={() => {
                            setClientSelectedMonth('All Time');
                            setClientDateFilter({ start: '', end: '' });
                            setIsClientDateDropdownOpen(false);
                          }}
                          className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100 border-b"
                        >
                          All Time
                        </button>
                        <button
                          onClick={() => setShowClientCustomCalendar(true)}
                          className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100 border-b"
                        >
                          Custom Dates
                        </button>
                        <div className="max-h-60 overflow-y-auto">
                          {(() => {
                            const months = [];
                            const startDate = new Date(2025, 9, 1);
                            const currentDate = new Date();
                            const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

                            for (let d = new Date(endDate); d >= startDate; d.setMonth(d.getMonth() - 1)) {
                              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                              months.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
                            }
                            return months;
                          })().map((month) => (
                            <button
                              key={month}
                              onClick={() => handleClientMonthSelect(month)}
                              className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100"
                            >
                              {month}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="p-4">
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                          <input
                            type="date"
                            value={clientStartDate}
                            onChange={(e) => setClientStartDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded text-sm"
                          />
                        </div>
                        <div className="mb-3">
                          <label className="block text-xs text-gray-600 mb-1">End Date</label>
                          <input
                            type="date"
                            value={clientEndDate}
                            onChange={(e) => setClientEndDate(e.target.value)}
                            className="w-full px-3 py-2 border rounded text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setShowClientCustomCalendar(false)}
                            className="flex-1 px-3 py-2 border rounded text-sm hover:bg-gray-100"
                          >
                            Back
                          </button>
                          <button
                            onClick={handleClientCustomDateApply}
                            className="flex-1 px-3 py-2 bg-teal-700 text-white rounded text-sm hover:bg-teal-800"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Tab Content - Overview */}
            {clientViewTab === 'overview' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Bookings</p>
                    <p className="text-3xl font-bold text-gray-900">{clientStats.bookings}</p>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Sessions Completed</p>
                    <p className="text-3xl font-bold text-gray-900">{clientStats.sessionsCompleted}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Next Session</p>
                    <p className="text-lg font-bold text-gray-900">
                      {(() => {
                        const upcoming = clientAppointments
                          .filter(apt => {
                            // Use same logic as Appointments component - only 'scheduled' sessions are upcoming
                            return apt.booking_status === 'scheduled';
                          })
                          .sort((a, b) => {
                            const dateA = a.booking_start_at_raw ? new Date(a.booking_start_at_raw) : new Date();
                            const dateB = b.booking_start_at_raw ? new Date(b.booking_start_at_raw) : new Date();
                            return dateA.getTime() - dateB.getTime();
                          })[0];

                        if (upcoming && upcoming.booking_start_at_raw) {
                          const date = new Date(upcoming.booking_start_at_raw);
                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                        return 'N/A';
                      })()}
                    </p>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Last Session</p>
                    <p className="text-lg font-bold text-gray-900">
                      {(() => {
                        const completed = clientAppointments
                          .filter(apt => {
                            // Include only completed and pending_notes, exclude cancelled and no_show
                            return apt.booking_status === 'completed' || apt.booking_status === 'pending_notes';
                          })
                          .sort((a, b) => {
                            const dateA = a.booking_start_at_raw ? new Date(a.booking_start_at_raw) : new Date();
                            const dateB = b.booking_start_at_raw ? new Date(b.booking_start_at_raw) : new Date();
                            return dateB.getTime() - dateA.getTime(); // Sort descending to get most recent
                          })[0];

                        if (completed && completed.booking_invitee_time) {
                          // Parse date from booking_invitee_time to match what's shown in the table
                          const timeMatch = completed.booking_invitee_time.match(/(\w+, \w+ \d+, \d+) at/);
                          if (timeMatch) {
                            const dateStr = timeMatch[1];
                            const date = new Date(dateStr);
                            if (!isNaN(date.getTime())) {
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            }
                          }
                        }
                        return 'N/A';
                      })()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">Cancellation</p>
                    <p className="text-3xl font-bold text-gray-900">{clientStats.cancelled}</p>
                  </div>
                  <div className="bg-white border rounded-lg p-4">
                    <p className="text-sm text-gray-600 mb-1">No Show</p>
                    <p className="text-3xl font-bold text-gray-900">{clientStats.noShows}</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <User size={20} className="text-gray-700" />
                    Bookings
                  </h3>

                  <div className="flex gap-6 mb-4">
                    {[
                      { id: 'all', label: 'Booking History' },
                    ].map((tab) => {
                      const count = clientAppointments.filter(apt => {
                        if (clientAppointmentSearchTerm && !apt.booking_resource_name?.toLowerCase().includes(clientAppointmentSearchTerm.toLowerCase())) {
                          return false;
                        }
                        if (clientDateFilter.start && clientDateFilter.end) {
                          const aptDate = apt.booking_start_at_raw ? new Date(apt.booking_start_at_raw) : new Date();
                          const startDate = new Date(clientDateFilter.start);
                          const endDate = new Date(clientDateFilter.end + 'T23:59:59');
                          if (aptDate < startDate || aptDate > endDate) return false;
                        }
                        if (tab.id === 'all') return true;
                        return apt.booking_status === tab.id;
                      }).length;

                      return (
                        <button
                          key={tab.id}
                          onClick={() => setClientAppointmentTab(tab.id)}
                          className={`pb-2 font-medium whitespace-nowrap ${clientAppointmentTab === tab.id
                              ? 'text-teal-700 border-b-2 border-teal-700'
                              : 'text-gray-400'
                            }`}
                        >
                          {tab.label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {clientDetailsLoading ? (
                    <div className="p-8 text-center"><Loader /></div>
                  ) : (
                    <div>
                      <div className="bg-white border rounded-lg overflow-hidden">
                        <table className="w-full" ref={appointmentActionsRef}>
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Session Type</th>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Date & Time</th>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Therapist</th>
                              <th className="px-4 py-2 text-left text-sm font-medium text-gray-600">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clientAppointments.filter(apt => {
                              if (clientAppointmentSearchTerm && !apt.booking_resource_name?.toLowerCase().includes(clientAppointmentSearchTerm.toLowerCase())) {
                                return false;
                              }
                              if (clientDateFilter.start && clientDateFilter.end) {
                                const aptDate = apt.booking_start_at_raw ? new Date(apt.booking_start_at_raw) : new Date();
                                const startDate = new Date(clientDateFilter.start);
                                const endDate = new Date(clientDateFilter.end + 'T23:59:59');
                                if (aptDate < startDate || aptDate > endDate) return false;
                              }
                              if (clientAppointmentTab === 'all') return true;
                              return apt.booking_status === clientAppointmentTab;
                            }).length === 0 ? (
                              <tr>
                                <td colSpan={4} className="text-center py-4 text-gray-400 text-sm">No bookings found</td>
                              </tr>
                            ) : (
                              clientAppointments.filter(apt => {
                                if (clientAppointmentSearchTerm && !apt.booking_resource_name?.toLowerCase().includes(clientAppointmentSearchTerm.toLowerCase())) {
                                  return false;
                                }
                                if (clientDateFilter.start && clientDateFilter.end) {
                                  const aptDate = apt.booking_start_at_raw ? new Date(apt.booking_start_at_raw) : new Date();
                                  const startDate = new Date(clientDateFilter.start);
                                  const endDate = new Date(clientDateFilter.end + 'T23:59:59');
                                  if (aptDate < startDate || aptDate > endDate) return false;
                                }
                                if (clientAppointmentTab === 'all') return true;
                                return apt.booking_status === clientAppointmentTab;
                              }).map((apt, index) => (
                                <React.Fragment key={index}>
                                  <tr
                                    className={`border-b cursor-pointer transition-colors ${selectedAppointmentIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                                      }`}
                                    onClick={() => setSelectedAppointmentIndex(selectedAppointmentIndex === index ? null : index)}
                                  >
                                    <td className="px-4 py-3 text-sm">{(() => { const n = apt.booking_resource_name || ''; return /^(in-person|online|offline)\s*\(/i.test(n.trim()) && apt.booking_subject ? apt.booking_subject.replace(/ with .+$/i, '').trim() : n.replace(/ with .+$/i, '').trim() || n; })()}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{apt.booking_invitee_time}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{apt.booking_host_name || selectedTherapist?.name || 'N/A'}</td>
                                    <td className="px-4 py-3 text-sm">
                                      <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${apt.booking_status === 'completed' ? 'bg-green-100 text-green-700' :
                                          apt.booking_status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                            apt.booking_status === 'no_show' ? 'bg-orange-100 text-orange-700' :
                                              apt.booking_status === 'pending_notes' ? 'bg-yellow-100 text-yellow-700' :
                                                'bg-blue-100 text-blue-700'
                                        }`}>
                                        {apt.booking_status === 'pending_notes' ? 'Pending Notes' :
                                          apt.booking_status === 'no_show' ? 'No Show' :
                                            apt.booking_status === 'scheduled' ? 'Scheduled' :
                                              apt.booking_status?.charAt(0).toUpperCase() + apt.booking_status?.slice(1)}
                                      </span>
                                    </td>
                                  </tr>
                                  {selectedAppointmentIndex === index && (
                                    <tr className="bg-gray-100">
                                      <td colSpan={4} className="px-4 py-4">
                                        <div className="flex gap-3 justify-center">
                                          <button
                                            onClick={() => copyAppointmentDetails(apt)}
                                            className="px-6 py-2 border border-gray-400 rounded-lg text-sm text-gray-700 hover:bg-white flex items-center gap-2"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            Copy to Clipboard
                                          </button>
                                          <button
                                            onClick={() => handleReminderClick(apt)}
                                            disabled={isMeetingEnded(apt) || apt.booking_status === 'cancelled'}
                                            className={`px-6 py-2 rounded-lg text-sm flex items-center gap-2 ${isMeetingEnded(apt) || apt.booking_status === 'cancelled'
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                                : 'border border-gray-400 text-gray-700 hover:bg-white'
                                              }`}
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                            Send Manual Reminder to Client
                                          </button>
                                          <button
                                            onClick={() => handleSessionNotesReminder(apt)}
                                            disabled={!isMeetingEnded(apt) || apt.has_session_notes || apt.booking_status === 'cancelled'}
                                            className={`px-6 py-2 rounded-lg text-sm flex items-center gap-2 ${!isMeetingEnded(apt) || apt.has_session_notes || apt.booking_status === 'cancelled'
                                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                                : 'bg-white text-blue-600 border border-blue-600 hover:bg-blue-50'
                                              }`}
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                            Send Session Note Reminder to Therapist
                                          </button>
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
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Sessions Tab */}
            {clientViewTab === 'sessions' && clientSessionType.hasPaidSessions && (
              selectedProgressNoteId ? (
                isFreeConsultationNote ? (
                  <FreeConsultationDetail
                    noteId={selectedProgressNoteId}
                    onBack={() => {
                      setSelectedProgressNoteId(null);
                      setIsFreeConsultationNote(false);
                    }}
                  />
                ) : (
                  <ProgressNoteDetail
                    noteId={selectedProgressNoteId}
                    onBack={() => {
                      setSelectedProgressNoteId(null);
                      setIsFreeConsultationNote(false);
                    }}
                  />
                )
              ) : (
                <ProgressNotesTab
                  clientId={selectedClient.invitee_phone}
                  onViewNote={(noteId, isFreeConsult = false) => {
                    setSelectedProgressNoteId(noteId);
                    setIsFreeConsultationNote(isFreeConsult);
                  }}
                  hasFreeConsultation={clientSessionType.hasFreeConsultation}
                />
              )
            )}

            {/* Case History / Pre-therapy Notes Tab */}
            {clientViewTab === 'caseHistory' && (
              clientSessionType.hasPaidSessions ? (
                <CaseHistoryTab clientId={selectedClient.invitee_phone} />
              ) : (
                // Show free consultation notes when only free consultation exists
                <div className="text-center py-12">
                  <p className="text-gray-500 text-lg mb-4">Free consultation session booked</p>
                  <p className="text-gray-400 text-sm">Pre-therapy notes will appear here after the therapist fills the consultation form</p>
                </div>
              )
            )}

            {/* Documents Tab */}
            {clientViewTab === 'documents' && clientSessionType.hasPaidSessions && (
              <GoalTrackingTab
                clientId={selectedClient.invitee_phone}
                clientName={selectedClient.invitee_name}
              />
            )}
          </div>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        {/* Case History Password Modal */}
        {showCaseHistoryPasswordModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Verify Password</h3>
              <p className="text-gray-600 mb-4">Please enter your password to view case history</p>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={caseHistoryPassword}
                  onChange={(e) => setCaseHistoryPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleCaseHistoryPasswordSubmit()}
                  placeholder="Enter your password"
                  className="w-full px-4 py-2 pr-10 border rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
              {caseHistoryPasswordError && (
                <p className="text-red-600 text-sm mb-4">{caseHistoryPasswordError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleCaseHistoryPasswordSubmit}
                  className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800"
                >
                  Verify
                </button>
                <button
                  onClick={() => {
                    setShowCaseHistoryPasswordModal(false);
                    setCaseHistoryPassword('');
                    setCaseHistoryPasswordError('');
                    setShowPassword(false);
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showReminderModal && selectedAppointmentForReminder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Sending Manual Reminder</h3>
              <p className="text-gray-600 mb-4">This will send a reminder message to {formatClientName(selectedClient?.invitee_name)} on Whatsapp</p>
              <div className="flex gap-3">
                <button
                  onClick={sendWhatsAppNotification}
                  className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800"
                >
                  Send
                </button>
                <button
                  onClick={() => {
                    setShowReminderModal(false);
                    setSelectedAppointmentForReminder(null);
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Booking Link Confirmation Modal */}
        {showBookingLinkConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold mb-4">Send Booking Link</h3>
              <p className="text-gray-600 mb-6">
                This will send a booking link reminder to{' '}
                <span className="font-semibold">{selectedClientForBookingLink?.invitee_name}</span>.
                Would you like to proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={confirmSendBookingLink}
                  className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
                  style={{ backgroundColor: '#21615D' }}
                >
                  Yes, Send
                </button>
                <button
                  onClick={() => {
                    setShowBookingLinkConfirmModal(false);
                    setSelectedClientForBookingLink(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Send Booking Link Confirmation Modal */}
        {showTherapistBulkConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold mb-4">Send Bulk Booking Links</h3>
              <p className="text-gray-600 mb-6">
                This will send booking link reminders to <span className="font-semibold">{selectedTherapistClients.size}</span> selected clients. Would you like to proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => confirmBulkSendFromTherapistView(clients)}
                  disabled={isTherapistBulkSending}
                  className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#21615D' }}
                >
                  {isTherapistBulkSending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sending...
                    </>
                  ) : (
                    'Yes, Send All'
                  )}
                </button>
                <button
                  onClick={() => setShowTherapistBulkConfirmModal(false)}
                  disabled={isTherapistBulkSending}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {isClientEditMode && false && editingClientContact && (
        <span />
      )}
      </>
    );
  }
  if (showEditMode && selectedTherapist) {
    return (
      <EditTherapistForm
        therapist={editedTherapist}
        onSave={(updated, picture) => {
          setEditedTherapist(updated);
          setEditProfilePicture(picture);
          handleSaveTherapist(updated, picture);
        }}
        onCancel={() => {
          setShowEditMode(false);
          setEditedTherapist(null);
          setEditProfilePicture(null);
        }}
        saving={saving}
      />
    );
  }

  if (selectedTherapist) {
    return (
      <div className="p-8 h-full flex flex-col">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={closeTherapistDetails}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center justify-between flex-1">
            <div className="flex items-center gap-3">
              <User size={24} className="text-teal-700" />
              <h1 className="text-3xl font-bold">{selectedTherapist.name}</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowViewModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                <Eye size={18} />
                <span className="font-medium">View</span>
              </button>
              <button
                onClick={() => {
                  setEditedTherapist({
                    ...selectedTherapist,
                    specializations: selectedTherapist.specialization
                  });
                  setShowEditMode(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition-colors"
              >
                <Edit size={18} />
                <span className="font-medium">Edit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Therapist Info */}
        <div className="mb-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Specializations</h3>
            <div className="flex flex-wrap gap-2">
              {selectedTherapist.specialization && selectedTherapist.specialization.split(',').map((spec: string, i: number) => (
                <span key={i} className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: '#2D757930', color: '#2D7579' }}>
                  {spec.trim()}
                </span>
              ))}
            </div>
          </div>

          {selectedTherapist.contact_info && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Mail size={16} />
              <span>{selectedTherapist.contact_info}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Total Sessions Lifetime</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>{selectedTherapist.total_sessions_lifetime}</p>
            </div>
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Total Revenue</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>₹{Number(selectedTherapist.total_revenue || 0).toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Active Clients</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>
                {clients.filter(client => getClientStatus(client) === 'active').length}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Sessions This Month</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>{selectedTherapist.sessions_this_month}</p>
            </div>
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Revenue This Month</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>₹{Number(selectedTherapist.revenue_this_month || 0).toLocaleString()}</p>
            </div>
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Inactive Clients</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>
                {clients.filter(client => getClientStatus(client) === 'inactive').length}
              </p>
            </div>
            <div className="bg-gray-100 p-5 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Drop-Outs</p>
              <p className="text-3xl font-bold" style={{ color: '#21615D' }}>
                {clients.filter(client => getClientStatus(client) === 'drop-out').length}
              </p>
            </div>
          </div>
        </div>

        {detailsLoading ? (
          <Loader />
        ) : (
          <div className="space-y-6">
            {/* Clients List */}
            <div>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Assigned Clients ({clients.length})</h3>
                  {selectedTherapistClients.size > 0 && (
                    <button
                      onClick={() => setShowTherapistBulkConfirmModal(true)}
                      className="flex items-center gap-2 px-3 py-2 text-white text-sm rounded-lg hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: '#21615D' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                      Send to Selected ({selectedTherapistClients.size})
                    </button>
                  )}
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Search clients..."
                    value={assignedClientSearch}
                    onChange={(e) => setAssignedClientSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Status Filter Pills */}
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-gray-600 mr-1">Filter:</span>
                  <button
                    onClick={() => {
                      setAssignedClientStatusFilter('all');
                      setClientsPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${assignedClientStatusFilter === 'all'
                        ? 'bg-gray-800 text-white ring-2 ring-gray-400'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => {
                      setAssignedClientStatusFilter('active');
                      setClientsPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${assignedClientStatusFilter === 'active' ? 'ring-2 ring-teal-800' : ''
                      }`}
                    style={{ backgroundColor: '#21615D' }}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => {
                      setAssignedClientStatusFilter('inactive');
                      setClientsPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${assignedClientStatusFilter === 'inactive' ? 'ring-2 ring-gray-500' : ''
                      }`}
                    style={{ backgroundColor: '#9CA3AF' }}
                  >
                    Inactive
                  </button>
                  <button
                    onClick={() => {
                      setAssignedClientStatusFilter('drop-out');
                      setClientsPage(1);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${assignedClientStatusFilter === 'drop-out' ? 'ring-2 ring-red-800' : ''
                      }`}
                    style={{ backgroundColor: '#B91C1C' }}
                  >
                    Drop-out
                  </button>
                </div>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden">
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      {(() => {
                        const fc = clients.filter(c =>
                          (c.invitee_name?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                            c.invitee_email?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                            c.invitee_phone?.toLowerCase().includes(assignedClientSearch.toLowerCase())) &&
                          (assignedClientStatusFilter === 'all' || getClientStatus(c) === assignedClientStatusFilter)
                        );
                        return (
                          <tr>
                            <th className="px-4 py-3 text-left">
                              <input
                                type="checkbox"
                                checked={fc.length > 0 && fc.every(c => selectedTherapistClients.has(getTherapistClientId(c)))}
                                onChange={() => toggleTherapistSelectAll(fc)}
                                className="w-4 h-4 rounded border-gray-300"
                                style={{ accentColor: '#21615D' }}
                              />
                            </th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Contact Info</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Session Name</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                          </tr>
                        );
                      })()}
                    </thead>
                    <tbody>
                      {(() => {
                        const filteredClients = clients.filter(client => {
                          // Search filter
                          const matchesSearch = client.invitee_name?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                            client.invitee_email?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                            client.invitee_phone?.toLowerCase().includes(assignedClientSearch.toLowerCase());

                          // Status filter
                          const clientStatus = getClientStatus(client);
                          const matchesStatus = assignedClientStatusFilter === 'all' || clientStatus === assignedClientStatusFilter;

                          return matchesSearch && matchesStatus;
                        });

                        if (filteredClients.length === 0) {
                          return (
                            <tr>
                              <td colSpan={6} className="text-center py-4 text-gray-400 text-sm">
                                {assignedClientSearch ? 'No clients found matching your search' : 'No clients found'}
                              </td>
                            </tr>
                          );
                        }

                        const startIndex = (clientsPage - 1) * clientsPerPage;
                        const endIndex = startIndex + clientsPerPage;
                        const paginatedClients = filteredClients.slice(startIndex, endIndex);

                        return paginatedClients.map((client, index) => {
                          const actualIndex = startIndex + index;
                          const phoneNumbers = client.invitee_phone ? client.invitee_phone.split(', ') : [];
                          const hasMultiplePhones = phoneNumbers.length > 1;

                          // Get session name from appointments
                          const clientAppointment = appointments.find(apt =>
                            apt.invitee_email === client.invitee_email ||
                            phoneNumbers.some(phone => apt.invitee_phone === phone)
                          );
                          const sessionName = clientAppointment?.booking_resource_name || 'N/A';
                          const mode = clientAppointment?.mode || 'Google Meet';

                          return (
                            <React.Fragment key={actualIndex}>
                              <tr
                                className={`border-b cursor-pointer transition-colors ${selectedClientForAction === actualIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                                  }`}
                                onClick={() => toggleClientActions(actualIndex)}
                              >
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={selectedTherapistClients.has(getTherapistClientId(client))}
                                    onChange={() => toggleTherapistClientSelection(getTherapistClientId(client))}
                                    className="w-4 h-4 rounded border-gray-300"
                                    style={{ accentColor: '#21615D' }}
                                  />
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  <div className="flex items-center gap-2">
                                    {hasMultiplePhones && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleClientRow(actualIndex);
                                        }}
                                        className="text-gray-500 hover:text-gray-700"
                                      >
                                        {expandedClientRows.has(actualIndex) ? '▼' : '▶'}
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openClientDetails(client);
                                      }}
                                      className="text-teal-700 hover:underline font-medium text-left"
                                    >
                                      {formatClientName(client.invitee_name)}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  <div>
                                    <div>{client.invitee_email || 'N/A'}</div>
                                    <div className="text-gray-500">{phoneNumbers[0]}</div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">{sessionName}</td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {(() => {
                                    let displayMode = mode;
                                    if (mode?.includes('_')) {
                                      displayMode = mode.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                                    }
                                    // Clean up "In-person (location details)" to just "In-person"
                                    if (displayMode?.startsWith('In-person')) {
                                      displayMode = 'In-person';
                                    }
                                    return displayMode;
                                  })()}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  {(() => {
                                    const status = getClientStatus(client);
                                    return (
                                      <span className={`px-3 py-1 rounded-full text-xs font-medium text-white`} style={{
                                        backgroundColor:
                                          status === 'active' ? '#21615D' :
                                            status === 'drop-out' ? '#B91C1C' :
                                              '#9CA3AF'
                                      }}>
                                        {status === 'active' ? 'Active' : status === 'drop-out' ? 'Drop-out' : 'Inactive'}
                                      </span>
                                    );
                                  })()}
                                </td>
                              </tr>
                              {selectedClientForAction === actualIndex && (
                                <tr className="bg-gray-50 border-b">
                                  <td colSpan={4} className="px-4 py-4">
                                    <div className="flex gap-3 justify-center">
                                      <button
                                        onClick={() => handleSendClientReminder(client)}
                                        className="px-6 py-2 border border-gray-400 rounded-lg text-sm text-gray-700 hover:bg-white flex items-center gap-2"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                        Send Booking Link
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {expandedClientRows.has(actualIndex) && hasMultiplePhones && (
                                phoneNumbers.slice(1).map((phone, pIndex) => (
                                  <tr key={`${actualIndex}-${pIndex}`} className="bg-gray-50 border-b">
                                    <td className="px-4 py-3 text-sm pl-12 text-gray-600">{formatClientName(client.invitee_name)}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                      <div>
                                        <div>{client.invitee_email || 'N/A'}</div>
                                        <div className="text-gray-500">{phone}</div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{sessionName}</td>
                                    <td className="px-4 py-3 text-sm">
                                      {(() => {
                                        const status = getClientStatus(client);
                                        return (
                                          <span className={`px-3 py-1 rounded-full text-xs font-medium text-white`} style={{
                                            backgroundColor:
                                              status === 'active' ? '#21615D' :
                                                status === 'drop-out' ? '#B91C1C' :
                                                  '#9CA3AF'
                                          }}>
                                            {status === 'active' ? 'Active' : status === 'drop-out' ? 'Drop-out' : 'Inactive'}
                                          </span>
                                        );
                                      })()}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </React.Fragment>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {(() => {
                  const filteredClients = clients.filter(client =>
                    client.invitee_name?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                    client.invitee_email?.toLowerCase().includes(assignedClientSearch.toLowerCase()) ||
                    client.invitee_phone?.toLowerCase().includes(assignedClientSearch.toLowerCase())
                  );

                  if (filteredClients.length <= clientsPerPage) return null;

                  return (
                    <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                      <div className="text-sm text-gray-600">
                        Showing {((clientsPage - 1) * clientsPerPage) + 1}-{Math.min(clientsPage * clientsPerPage, filteredClients.length)} of {filteredClients.length} results
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setClientsPage(prev => Math.max(1, prev - 1))}
                          disabled={clientsPage === 1}
                          className={`px-3 py-1 rounded ${clientsPage === 1
                              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border hover:bg-gray-50'
                            }`}
                        >
                          ←
                        </button>
                        <button
                          onClick={() => setClientsPage(prev => Math.min(Math.ceil(filteredClients.length / clientsPerPage), prev + 1))}
                          disabled={clientsPage >= Math.ceil(filteredClients.length / clientsPerPage)}
                          className={`px-3 py-1 rounded ${clientsPage >= Math.ceil(filteredClients.length / clientsPerPage)
                              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white border hover:bg-gray-50'
                            }`}
                        >
                          →
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Recent Bookings */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Recent Bookings</h3>
              <div className="mb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Search by client name or session type..."
                    value={appointmentSearchTerm}
                    onChange={(e) => {
                      setAppointmentSearchTerm(e.target.value);
                      setAppointmentsPage(1);
                    }}
                    className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden">
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Session Type</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filteredAppointments = appointments.filter(apt =>
                          appointmentSearchTerm === '' ||
                          apt.invitee_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                          apt.booking_resource_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase())
                        );
                        const totalPages = Math.ceil(filteredAppointments.length / appointmentsPerPage);
                        const startIndex = (appointmentsPage - 1) * appointmentsPerPage;
                        const paginatedAppointments = filteredAppointments.slice(startIndex, startIndex + appointmentsPerPage);

                        if (filteredAppointments.length === 0) {
                          return (
                            <tr>
                              <td colSpan={3} className="text-center py-4 text-gray-400 text-sm">No bookings found</td>
                            </tr>
                          );
                        }

                        return paginatedAppointments.map((apt, index) => (
                          <tr key={index} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">{formatClientName(apt.invitee_name)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{(() => { const n = apt.booking_resource_name || ''; return /^(in-person|online|offline)\s*\(/i.test(n.trim()) && apt.booking_subject ? apt.booking_subject.replace(/ with .+$/i, '').trim() : n.replace(/ with .+$/i, '').trim() || n; })()}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{apt.booking_invitee_time}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-4 border-t flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {(() => {
                      const filteredCount = appointments.filter(apt =>
                        appointmentSearchTerm === '' ||
                        apt.invitee_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                        apt.booking_resource_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase())
                      ).length;
                      const startIndex = (appointmentsPage - 1) * appointmentsPerPage;
                      const endIndex = Math.min(startIndex + appointmentsPerPage, filteredCount);
                      return `Showing ${filteredCount > 0 ? startIndex + 1 : 0}-${endIndex} of ${filteredCount} result${filteredCount !== 1 ? 's' : ''}`;
                    })()}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAppointmentsPage(p => Math.max(1, p - 1))}
                      disabled={appointmentsPage === 1}
                      className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => {
                        const filteredCount = appointments.filter(apt =>
                          appointmentSearchTerm === '' ||
                          apt.invitee_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                          apt.booking_resource_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase())
                        ).length;
                        const totalPages = Math.ceil(filteredCount / appointmentsPerPage);
                        setAppointmentsPage(p => Math.min(totalPages, p + 1));
                      }}
                      disabled={(() => {
                        const filteredCount = appointments.filter(apt =>
                          appointmentSearchTerm === '' ||
                          apt.invitee_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                          apt.booking_resource_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase())
                        ).length;
                        const totalPages = Math.ceil(filteredCount / appointmentsPerPage);
                        return appointmentsPage === totalPages;
                      })()}
                      className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Modal */}
        {showViewModal && (
          <ViewTherapistModal
            therapist={selectedTherapist}
            onClose={() => setShowViewModal(false)}
          />
        )}

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <ConfirmModal
            title="Confirm Changes"
            message="Do you want to save these changes to the therapist profile?"
            onConfirm={confirmSaveTherapist}
            onCancel={() => setShowConfirmModal(false)}
            confirmText="Save Changes"
            cancelText="Cancel"
          />
        )}

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

        {/* Booking Link Confirmation Modal */}
        {showBookingLinkConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold mb-4">Send Booking Link</h3>
              <p className="text-gray-600 mb-6">
                This will send a booking link reminder to{' '}
                <span className="font-semibold">{selectedClientForBookingLink?.invitee_name}</span>.
                Would you like to proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={confirmSendBookingLink}
                  className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
                  style={{ backgroundColor: '#21615D' }}
                >
                  Yes, Send
                </button>
                <button
                  onClick={() => {
                    setShowBookingLinkConfirmModal(false);
                    setSelectedClientForBookingLink(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
                >
                  No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Send Booking Link Confirmation Modal */}
        {showTherapistBulkConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
              <h3 className="text-xl font-bold mb-4">Send Bulk Booking Links</h3>
              <p className="text-gray-600 mb-6">
                This will send booking link reminders to{' '}
                <span className="font-semibold">{selectedTherapistClients.size}</span> selected clients. Would you like to proceed?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => confirmBulkSendFromTherapistView(clients)}
                  disabled={isTherapistBulkSending}
                  className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#21615D' }}
                >
                  {isTherapistBulkSending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sending...
                    </>
                  ) : (
                    'Yes, Send All'
                  )}
                </button>
                <button
                  onClick={() => setShowTherapistBulkConfirmModal(false)}
                  disabled={isTherapistBulkSending}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                >
                  No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden">
      {/* Header - Only title and subheading */}
      <div className="flex justify-between items-start mb-2 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold mb-1">All Therapists</h1>
          <p className="text-gray-600">View Therapists Details, Specialization and more...</p>
        </div>

        {/* Search bar for list view only */}
        {viewMode === 'list' && (
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search users by name or specialization..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        )}
      </div>

      {/* Toggle and Filters Container */}
      <div className="flex justify-between items-start mb-4 flex-shrink-0">
        <div className="w-1/2">
          {/* Toggle buttons */}
          <div className="flex bg-gray-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => { setViewMode('list'); setSelectedEditEvent(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'list'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <List size={16} />
              List View
            </button>
            <button
              onClick={() => { setViewMode('calendar'); setSelectedEditEvent(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'calendar'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <CalendarIcon size={16} />
              Calendar View
            </button>
            <button
              onClick={() => setViewMode('availabilities')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'availabilities'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              <Edit size={16} />
              Therapist's Availabilities
            </button>
          </div>
        </div>

        {/* Right half - Filters for calendar view only */}
        {viewMode === 'calendar' && (
          <div className="w-1/2 space-y-3">
            {/* Row 1: Session Mode Filters */}
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-700 mr-2">Session Mode:</h4>
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'All Sessions' },
                  { value: 'online', label: 'Online' },
                  { value: 'in-person', label: 'In-Person' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSelectedModeFilter(option.value as any)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selectedModeFilter === option.value
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
                      }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: Session Type Filters */}
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-700 mr-2">Session Type:</h4>
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'All Types' },
                  { value: 'individual', label: 'Individual' },
                  { value: 'couples', label: 'Couples' },
                  { value: 'free_consultation', label: 'Free Consultation' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSelectedSessionTypeFilter(option.value as any)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selectedSessionTypeFilter === option.value
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
                      }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 3: Therapist Filters */}
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-700 mr-2">Therapists:</h4>
              <div className="flex flex-wrap gap-2">
                {therapists.map((therapist) => {
                  const firstName = therapist.name ? therapist.name.split(' ')[0] : '';
                  const isSelected = selectedTherapistFilters.includes(firstName);
                  return (
                    <button
                      key={therapist.therapist_id}
                      onClick={() => toggleTherapistFilter(firstName)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${isSelected
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
                        }`}
                    >
                      {firstName}
                    </button>
                  );
                })}
                {selectedTherapistFilters.length > 0 && (
                  <button
                    onClick={() => setSelectedTherapistFilters([])}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-300 hover:bg-red-200"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'calendar' ? (
          <TherapistCalendar
            therapists={therapists}
            selectedTherapistFilters={selectedTherapistFilters}
            selectedModeFilter={selectedModeFilter}
            sessionTypeFilter={selectedSessionTypeFilter}
          />
        ) : viewMode === 'availabilities' ? (
          selectedEditEvent ? (
            <div className="h-full overflow-y-auto">
              <EditEvent
                event={selectedEditEvent}
                therapistId={therapists.find(t => t.name === selectedEditEvent.owner)?.therapist_id}
                services={dbServices
                  .filter((s: any) => s.therapist_name === selectedEditEvent.owner)
                  .map((s: any) => ({
                    ...s,
                    scheduleId: s.schedule_id,
                    detailedDescription: s.detailed_description,
                    editViewDescription: s.edit_view_description
                  }))}
                isAdminView={true}
                onBack={() => {
                  setSelectedEditEvent(null);
                }}
                onSave={(updated) => {
                  console.log('Event Saved:', updated);
                  setSelectedEditEvent(null);
                  setToast({ message: 'Availabilities updated successfully!', type: 'success' });
                }}
              />
            </div>
          ) : (
            <div className="p-6 h-full overflow-y-auto bg-gray-50 rounded-lg border">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {therapists.map((therapist) => {
                  const services = dbServices
                    .filter((s: any) => s.therapist_id === therapist.therapist_id || s.therapist_name === therapist.name)
                    .map((s: any) => ({
                      ...s,
                      scheduleId: s.schedule_id,
                      detailedDescription: s.detailed_description,
                      editViewDescription: s.edit_view_description
                    }));
                  const hasSchedule = !!therapist.scheduleId || !!therapist.therapist_id;
                  const canManage = true;

                  return (
                    <div
                      key={therapist.therapist_id}
                      className={`relative bg-white rounded-xl border p-6 flex flex-col items-center text-center transition-all ${canManage ? 'hover:shadow-md cursor-pointer hover:border-teal-500' : 'opacity-70 bg-gray-50'
                        }`}
                      onClick={() => {
                        const services = dbServices
                          .filter((s: any) => s.therapist_id === therapist.therapist_id || s.therapist_name === therapist.name)
                          .map((s: any) => ({
                            ...s,
                            scheduleId: s.schedule_id,
                            detailedDescription: s.detailed_description,
                            editViewDescription: s.edit_view_description
                          }));
                        const scheduleId = therapist.scheduleId || (services.length > 0 ? services[0].scheduleId : null) || therapist.therapist_id;

                        // We can open the edit event if we have either a scheduleId or services
                        if (scheduleId || services.length > 0) {
                          const baseService = services.length > 0 ? services[0] : {
                            slug: '/',
                            label: 'Session',
                            charges: 'TBD',
                            description: 'Therapy Session',
                            detailedDescription: '',
                            type: 'one_on_one' as const,
                            title: 'Individual Therapy',
                            scheduleId
                          };

                          setSelectedEditEvent({
                            ...baseService,
                            scheduleId: scheduleId,
                            owner: therapist.name,
                            initialTab: 'Schedule'
                          });
                        }
                      }}
                    >
                      {!canManage && (
                        <div className="absolute top-3 right-3 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-amber-200">
                          Coming Soon
                        </div>
                      )}
                      <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-xl font-bold mb-4">
                        {therapist.name.charAt(0)}
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">{therapist.name}</h3>
                      <p className="text-sm text-gray-500 mb-4 truncate w-full">{therapist.contact_info}</p>
                      <div className="mt-auto pt-4 border-t border-gray-100 w-full flex flex-col gap-3">
                        {canManage ? (
                          <>
                            <div className="flex items-center justify-center gap-2 text-teal-700 text-sm font-medium">
                              <CalendarIcon size={16} /> Manage Schedule
                            </div>

                            {/* Booking Links Dropdown */}
                            <div className="w-full relative booking-links-dropdown-container" onClick={e => e.stopPropagation()}>
                              <button
                                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 border border-teal-600 text-teal-700 rounded-lg hover:bg-teal-50 transition-colors text-xs font-semibold"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenBookingLinksId(openBookingLinksId === therapist.therapist_id ? null : therapist.therapist_id);
                                }}
                              >
                                <Link size={12} />
                                Booking Links
                                <ChevronDown size={12} />
                              </button>

                              {openBookingLinksId === therapist.therapist_id && (
                                <div
                                  className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden text-left"
                                >
                                  <div className="px-3 py-2 bg-gray-50 border-b">
                                    <p className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Public Booking Pages</p>
                                  </div>
                                  <div className="max-h-[200px] overflow-y-auto">
                                    {services.map((service: any, sIdx: number) => (
                                      <div key={sIdx} className="p-3 border-b last:border-0 hover:bg-gray-50 transition-colors">
                                        <p className="text-xs font-semibold text-gray-800 mb-1 truncate">{service.title}</p>
                                        <div className="flex gap-2">
                                          <button
                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 border rounded hover:bg-gray-100 text-gray-600"
                                            onMouseDown={e => e.stopPropagation()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigator.clipboard.writeText(`${window.location.origin}/book${service.slug}`);
                                              setToast({ message: 'Booking link copied!', type: 'success' });
                                            }}
                                          >
                                            <Copy size={10} /> Copy
                                          </button>
                                          <button
                                            className="flex-1 flex items-center justify-center gap-1 text-[10px] py-1 bg-teal-50 text-teal-700 border border-teal-100 rounded hover:bg-teal-100"
                                            onMouseDown={e => e.stopPropagation()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              window.open(`/book${service.slug}`, '_blank');
                                            }}
                                          >
                                            <ExternalLink size={10} /> Open
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400 text-sm font-medium flex items-center justify-center gap-2">
                            No setup yet
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : (
          /* Therapists Table */
          loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader />
            </div>
          ) : (
            <div className="bg-white rounded-lg border h-full flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Therapists Name</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Specialization</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Total sessions lifetime</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Sessions this month</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Live Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTherapists.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-gray-400 py-20">
                          No therapists found
                        </td>
                      </tr>
                    ) : (
                      filteredTherapists.map((therapist, index) => (
                        <tr key={index} className="border-b hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <button
                              onClick={() => openTherapistDetails(therapist)}
                              className="text-teal-700 hover:underline font-medium text-left"
                            >
                              {therapist.name}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-2">
                              {therapist.specialization && therapist.specialization.split(',').map((spec: string, i: number) => (
                                <span key={i} className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: '#2D757930', color: '#2D7579' }}>
                                  {spec.trim()}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-6 py-4">{therapist.total_sessions_lifetime}</td>
                          <td className="px-6 py-4">{therapist.sessions_this_month}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${therapist.isLive ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span className={`text-sm font-medium ${therapist.isLive ? 'text-green-700' : 'text-red-700'}`}>
                                {therapist.isLive ? 'In session' : 'Free'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 border-t flex justify-between items-center flex-shrink-0">
                <span className="text-sm text-gray-600">Showing {filteredTherapists.length} of {therapists.length} results</span>
                <div className="flex gap-2">
                  <button className="p-2 border rounded hover:bg-gray-50">←</button>
                  <button className="p-2 border rounded hover:bg-gray-50">→</button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};
