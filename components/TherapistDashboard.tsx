import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Calendar, LogOut, PieChart, ChevronUp, ChevronDown, ChevronRight, Copy, Send, Search, FileText, Bell, X, User, CalendarIcon, ArrowLeft, Mail, Eye, EyeOff, Edit, Download, MessageCircle } from 'lucide-react';
import { Logo } from './Logo';
import { Notifications } from './Notifications';
import { Toast } from './Toast';
import { Loader } from './Loader';
import { EditClientContactModal } from './EditClientContactModal';
import { TherapistCalendar } from './TherapistCalendar';
import { EditProfile } from './EditProfile';
import { ChangePassword } from './ChangePassword';
import { CaseHistoryTab } from './CaseHistoryTab';
import { CountUpNumber } from './CountUpNumber';
import { ProgressNotesTab } from './ProgressNotesTab';
import { ProgressNoteDetail } from './ProgressNoteDetail';
import { GoalTrackingTab } from './GoalTrackingTab';
import { FreeConsultationDetail } from './FreeConsultationDetail';
import { CompleteProfileModal } from './CompleteProfileModal';
import { ProfileUnderReviewBanner } from './ProfileUnderReviewBanner';
import { EmptyStateCard } from './EmptyStateCard';
import { SendBookingModal } from './SendBookingModal';
import { useUrlState } from '../hooks/useUrlState';
import Resources from './Resources';
import { therapistData } from '../lib/sessionData';
import EditEvent from './EditEvent';
import { BookingPage } from './BookingPage';
import { NotificationBell } from './NotificationBell';

import { Routes, Route, useNavigate, useLocation, Navigate, useSearchParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { SOSDocumentationView } from './SOSDocumentationView';

interface TherapistDashboardProps {
  onLogout: () => void;
  user: any;
}

export function TherapistDashboard({ onLogout, user }: TherapistDashboardProps) {
  const { login } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = location.pathname.split('/')[2] || 'dashboard';
  const setActiveView = (view: string) => navigate(`/therapist/${view}`);
  const [activeTab, setActiveTab] = useState<'all' | 'nri'>('all');
  
  // Use state instead of useUrlState
  const [activeAppointmentTab, setActiveAppointmentTab] = useState<string>('all');
  const [showCalendarPopup, setShowCalendarPopup] = useState(() => !user.google_calendar_connected);
  const [showPostConnectLightbox, setShowPostConnectLightbox] = useState(false);

  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('All Time');
  const [showCustomCalendar, setShowCustomCalendar] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [editingClient, setEditingClient] = useState<any>(null);

  const generateMonthOptions = () => {
    const months = [];
    const startDate = new Date(2025, 9, 1); // Oct 2025
    const currentDate = new Date();
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1); // +1 month ahead

    for (let d = new Date(endDate); d >= startDate; d.setMonth(d.getMonth() - 1)) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      months.push(`${monthNames[d.getMonth()]} ${d.getFullYear()}`);
    }
    return months;
  };

  const monthOptions = generateMonthOptions();

  const [stats, setStats] = useState([
    { title: 'Bookings', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
    { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
    { title: 'No-shows', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
    { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
    { title: 'Pending Session Notes', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
    { title: 'Avg Rating', value: '—', lastMonth: '0', clickable: false, targetView: '', targetTab: '' },
  ]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState<'all' | 'active' | 'inactive' | 'drop-out'>('all');
  const [appointmentSearchTerm, setAppointmentSearchTerm] = useState('');
  const [selectedAppointmentIndex, setSelectedAppointmentIndex] = useState<number | null>(null);
  const [selectedBookingIndex, setSelectedBookingIndex] = useState<number | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [appointmentCurrentPage, setAppointmentCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const appointmentsPerPage = 10;
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [sosConfirmText, setSosConfirmText] = useState('');
  const [selectedSOSBooking, setSelectedSOSBooking] = useState<any>(null);

  // SOS Risk Assessment Form State
  const [sosRiskSeverity, setSosRiskSeverity] = useState<number>(0);
  const [sosRiskIndicators, setSosRiskIndicators] = useState<{ [key: string]: 'Y' | 'N' | 'U' | '' }>({
    emotionalDysregulation: '',
    physicalHarmIdeas: '',
    drugAlcoholAbuse: '',
    suicidalAttempt: '',
    selfHarm: '',
    delusionsHallucinations: '',
    impulsiveness: '',
    severeStress: '',
    socialIsolation: '',
    concernByOthers: '',
    other: ''
  });
  const [sosOtherDetails, setSosOtherDetails] = useState('');
  const [sosRiskSummary, setSosRiskSummary] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [sessionNotesData, setSessionNotesData] = useState<any>(null);
  const [sessionNotesLoading, setSessionNotesLoading] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedReminderAppointment, setSelectedReminderAppointment] = useState<any>(null);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [clientStats, setClientStats] = useState({ bookings: 0, sessionsCompleted: 0, noShows: 0, cancelled: 0 });
  const [clientAppointments, setClientAppointments] = useState<any[]>([]);
  const [clientDateRange, setClientDateRange] = useState({ start: '', end: '' });
  const [clientSelectedMonth, setClientSelectedMonth] = useState('All Time');
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedClientForBooking, setSelectedClientForBooking] = useState<any>(null);

  useEffect(() => {
    const clientId = searchParams.get('clientId');
    if (clientId && clients.length > 0 && !selectedClient) {
      const client = clients.find(c => c.invitee_email === clientId || c.invitee_phone === clientId);
      if (client) {
        setSelectedClient(client);
      }
    }
  }, [searchParams, clients, selectedClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAuth = params.get('googleAuth');
    
    if (googleAuth) {
      if (googleAuth === 'success') {
        login({ ...user, google_calendar_connected: true });
        setShowPostConnectLightbox(true);
        setToast({ message: 'Google Calendar connected successfully!', type: 'success' });
      } else if (googleAuth === 'error') {
        const reason = params.get('reason');
        if (reason === 'already_linked') {
          setToast({ message: 'This Google Calendar is already connected to another therapist.', type: 'error' });
        } else {
          setToast({ message: 'Failed to connect Google Calendar.', type: 'error' });
        }
      }

      // Clean up URL without triggering react-router re-renders
      const newUrl = window.location.pathname + window.location.search
        .replace(/[?&]googleAuth=[^&]*/, '')
        .replace(/[?&]reason=[^&]*/, '')
        .replace(/^&/, '?');
        
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const [isClientDateDropdownOpen, setIsClientDateDropdownOpen] = useState(false);
  const [showClientCustomCalendar, setShowClientCustomCalendar] = useState(false);
  const [clientStartDate, setClientStartDate] = useState('');
  const [clientEndDate, setClientEndDate] = useState('');
  const [clientViewTab, setClientViewTab] = useState<'overview' | 'sessions' | 'documents' | 'caseHistory' | 'progressNotes' | 'goalTracking'>('overview');
  const [isCaseHistoryVisible, setIsCaseHistoryVisible] = useState(false);
  const [caseHistoryData, setCaseHistoryData] = useState<any>(null);
  const [showCaseHistoryPasswordModal, setShowCaseHistoryPasswordModal] = useState(false);

  // Bulk action states
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [showBulkSendModal, setShowBulkSendModal] = useState(false);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [caseHistoryPassword, setCaseHistoryPassword] = useState('');
  const [caseHistoryPasswordError, setCaseHistoryPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [selectedProgressNoteId, setSelectedProgressNoteId] = useState<number | null>(null);
  const [isFreeConsultationNote, setIsFreeConsultationNote] = useState(false);
  const [clientSessionType, setClientSessionType] = useState<{ hasPaidSessions: boolean; hasFreeConsultation: boolean }>({ hasPaidSessions: false, hasFreeConsultation: false });

  // Profile completion states
  const [showCompleteProfileModal, setShowCompleteProfileModal] = useState(false);
  const [selectedEditEvent, setSelectedEditEvent] = useState<any>(null);
  const [selectedBookingSession, setSelectedBookingSession] = useState<any>(null);

  // Feedback state
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<any>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);

  const [dbServices, setDbServices] = useState<any[]>([]);

  useEffect(() => {
    if (activeView === 'resources' && !selectedEditEvent) {
      const therapistName = user.full_name;
      const therapistServices = dbServices.length > 0 ? dbServices : (therapistData[therapistName]?.services || []);
      
      // If we don't have dbServices yet and there is no fallback data, wait for it
      if (!therapistServices || therapistServices.length === 0) return;

      const primaryService = therapistServices[0];

      // If we already have scheduleId in session, use it directly
      if (user.scheduleId) {
        setSelectedEditEvent({
          ...primaryService,
          scheduleId: user.scheduleId,
          owner: therapistName,
          initialTab: 'Schedule'
        });
        return;
      }

      // Otherwise, fetch it directly from therapist_resources via API
      fetch(`/api/therapist-schedule?therapist_id=${user.therapist_id}`)
        .then(res => res.json())
        .then((data: any) => {
          const resolvedScheduleId = data.scheduleId ?? null;
          console.log(`[TherapistDashboard] Resolved scheduleId from therapist_resources: ${resolvedScheduleId}`);
          setSelectedEditEvent({
            ...primaryService,
            scheduleId: resolvedScheduleId,
            owner: therapistName,
            initialTab: 'Schedule'
          });
        })
        .catch(err => {
          console.error('[TherapistDashboard] Failed to fetch scheduleId:', err);
          // Fallback: open without scheduleId
          setSelectedEditEvent({
            ...primaryService,
            owner: therapistName,
            initialTab: 'Schedule'
          });
        });
    }
  }, [activeView, selectedEditEvent, user.full_name, dbServices]);

  // Check if profile is under review (submitted but not approved yet)
  const isProfileUnderReview = user.profileStatus === 'pending_review' ||
    (user.needsProfileCompletion === false && !user.therapist_id);

  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const clientDropdownRef = React.useRef<HTMLDivElement>(null);
  const bookingActionsRef = React.useRef<HTMLTableElement>(null);
  const appointmentActionsRef = React.useRef<HTMLTableElement>(null);
  const profileMenuRef = React.useRef<HTMLDivElement>(null);

  // Utility functions to mask contact information
  const maskPhone = (phone: string): string => {
    if (!phone || phone === 'N/A') return phone;
    // Show first 5 characters (e.g., "+91 98"), mask the rest
    if (phone.length > 5) {
      return phone.substring(0, 5) + '*** *****';
    }
    return phone;
  };

  const maskEmail = (email: string): string => {
    if (!email || email === 'N/A') return email;
    const [localPart, domain] = email.split('@');
    if (!domain) return email;
    // Show first 2 characters of local part, mask middle, show domain
    if (localPart.length > 2) {
      return localPart.substring(0, 2) + '***@' + domain;
    }
    return email;
  };

  const formatClientName = (name: string): string => {
    if (!name) return name;
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const formatMode = (mode: string | undefined): string => {
    if (!mode) return 'N/A';
    const m = mode.toLowerCase().trim();
    // Map all variants to two standard labels
    if (m.includes('person') || m.includes('office') || m.includes('clinic')) return 'In-Person';
    if (m.includes('google') || m.includes('meet') || m.includes('online') || m.includes('video')) return 'Google Meet';
    if (m === 'offline') return 'In-Person'; // offline = no internet = in-person
    return 'Google Meet'; // safe default for unknown values
  };

  const getClientStatus = (client: any): 'active' | 'inactive' | 'drop-out' => {
    // If no appointments data, return inactive
    if (!appointments || appointments.length === 0) {
      return 'inactive';
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all client appointments (excluding cancelled)
    const clientAppointments = appointments.filter(apt => {
      const clientEmail = client.client_email?.toLowerCase().trim();
      const aptEmail = apt.invitee_email?.toLowerCase().trim();
      const clientPhone = client.client_phone?.replace(/[\s\-\(\)\+]/g, '');
      const aptPhone = apt.invitee_phone?.replace(/[\s\-\(\)\+]/g, '');

      const emailMatch = clientEmail && aptEmail && clientEmail === aptEmail;
      const phoneMatch = clientPhone && aptPhone && clientPhone === aptPhone;
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

  const [clientAppointmentSearchTerm, setClientAppointmentSearchTerm] = useState('');

  // Calendar view state for upcoming bookings
  const [showCalendarView, setShowCalendarView] = useState(false);
  const [calendarModeFilter, setCalendarModeFilter] = useState<'all' | 'online' | 'in-person'>('all');
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<'all' | 'upcoming' | 'cancelled' | 'completed'>('upcoming');
  const [selectedTherapistFilters, setSelectedTherapistFilters] = useState<string[]>([]);

  // Profile picture state
  const [profilePictureUrl, setProfilePictureUrl] = useState<string>('');

  const resetAllStates = () => {
    setSelectedClient(null);
    setSelectedAppointmentIndex(null);
    setSelectedBookingIndex(null);
    setExpandedRows(new Set());
    setShowSOSModal(false);
    setShowReminderModal(false);
    setIsDateDropdownOpen(false);
    setShowCustomCalendar(false);
    setIsClientDateDropdownOpen(false);
    setShowClientCustomCalendar(false);
    setShowCalendarView(false);
    setIsCaseHistoryVisible(false);
    setCaseHistoryData(null);
    setShowCaseHistoryPasswordModal(false);
    setCaseHistoryPassword('');
    setCaseHistoryPasswordError('');
    setShowPassword(false);
    setSelectedEditEvent(null);
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
      // Verify password by attempting to authenticate
      const response = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
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
          const chRes = await fetch(`/api/case-history?client_id=${encodeURIComponent(selectedClient.client_phone)}`);
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

  const toggleTherapistFilter = (therapistName: string) => {
    setSelectedTherapistFilters(prev =>
      prev.includes(therapistName)
        ? prev.filter(name => name !== therapistName)
        : [...prev, therapistName]
    );
  };

  const appointmentTabs = [
    { id: 'scheduled', label: 'Upcoming' },
    { id: 'all', label: 'All Bookings' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'no_show', label: 'No Show' },
  ];

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

    setClientDateRange({ start, end });
  };

  const handleClientCustomDateApply = () => {
    if (clientStartDate && clientEndDate) {
      setClientDateRange({ start: clientStartDate, end: clientEndDate });
      setClientSelectedMonth(`${clientStartDate} to ${clientEndDate}`);
      setShowClientCustomCalendar(false);
      setIsClientDateDropdownOpen(false);
    }
  };

  useEffect(() => {
    if (selectedClient) {
      fetchClientDetails(selectedClient);
    }
  }, [clientDateRange]);

  // Socket.io Real-time Updates
  useEffect(() => {
    if (!socket) return;

    const handleBookingUpdate = () => {
      console.log('[Socket] Booking updated, refreshing therapist dashboard data...');
      if (activeView === 'clients') {
        fetchClientsData();
      } else if (activeView === 'appointments') {
        fetchAppointmentsData();
      } else if (activeView === 'dashboard') {
        fetchClientsData();
        fetchAppointmentsData();
      }
      if (selectedClient) {
        fetchClientDetails(selectedClient);
      }
    };

    socket.on('booking_updated', handleBookingUpdate);

    return () => {
      socket.off('booking_updated', handleBookingUpdate);
    };
  }, [socket, activeView, selectedClient, user.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDateDropdownOpen(false);
        setShowCustomCalendar(false);
      }
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(event.target as Node)) {
        setIsClientDateDropdownOpen(false);
        setShowClientCustomCalendar(false);
      }
      if (bookingActionsRef.current && !bookingActionsRef.current.contains(event.target as Node)) {
        setSelectedBookingIndex(null);
      }
      if (appointmentActionsRef.current && !appointmentActionsRef.current.contains(event.target as Node)) {
        setSelectedAppointmentIndex(null);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
      // Close expanded rows when clicking outside the table
      if (expandedRows.size > 0 && bookingActionsRef.current && !bookingActionsRef.current.contains(event.target as Node)) {
        setExpandedRows(new Set());
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMonthSelect = (month: string) => {
    setSelectedMonth(month);
    setIsDateDropdownOpen(false);
    setShowCustomCalendar(false);

    const [monthName, year] = month.split(' ');
    const monthMap: { [key: string]: number } = {
      'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
      'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };
    const monthNum = monthMap[monthName];
    const start = `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(parseInt(year), monthNum + 1, 0).getDate();
    const end = `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    setDateRange({ start, end });
  };

  const handleCustomDateApply = () => {
    if (startDate && endDate) {
      setDateRange({ start: startDate, end: endDate });
      setSelectedMonth(`${startDate} to ${endDate}`);
      setShowCustomCalendar(false);
      setIsDateDropdownOpen(false);
    }
  };

  useEffect(() => {
    fetchTherapistData();
  }, [dateRange, user.id]);

  // Check if profile needs completion on mount
  useEffect(() => {
    const checkProfileStatus = async () => {
      if (user.needsProfileCompletion) {
        // Check if profile has already been submitted
        try {
          const response = await fetch(`/api/check-therapist-details?email=${user.email}`);
          const data = await response.json();

          if (data.exists) {
            // Profile already submitted, don't show modal
            return;
          }

          // Profile not submitted yet, show modal
          setShowCompleteProfileModal(true);
        } catch (error) {
          console.error('Error checking profile status:', error);
          // On error, show modal to be safe
          setShowCompleteProfileModal(true);
        }
      }
    };

    checkProfileStatus();
  }, [user.needsProfileCompletion, user.email]);

  useEffect(() => {
    if (activeView === 'clients') {
      fetchClientsData();
    } else if (activeView === 'appointments') {
      fetchAppointmentsData();
    } else if (activeView === 'dashboard') {
      // Fetch clients for Active/Inactive stats on dashboard
      fetchClientsData();
    }
  }, [activeView]);



  const fetchAppointmentsData = async () => {
    // Skip API calls if profile is under review
    if (isProfileUnderReview) {
      setAppointments([]);
      setAppointmentsLoading(false);
      return;
    }

    try {
      setAppointmentsLoading(true);
      const response = await fetch(`/api/therapist-appointments?therapist_id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setAppointments(data.appointments || []);
      }
    } catch (error) {
      console.error('Error fetching appointments data:', error);
      setAppointments([]);
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const fetchClientsData = async () => {
    // Skip API calls if profile is under review
    if (isProfileUnderReview) {
      setClients([]);
      setClientsLoading(false);
      return;
    }

    try {
      setClientsLoading(true);
      const response = await fetch(`/api/therapist-clients?therapist_id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setClients(data.clients || []);
      }
    } catch (error) {
      console.error('Error fetching clients data:', error);
      setClients([]);
    } finally {
      setClientsLoading(false);
    }
  };

  const fetchClientDetails = async (client: any) => {
    try {
      setClientDetailLoading(true);

      // Fetch client session type
      try {
        const normalizedClient = client;
        const sessionTypeParams = new URLSearchParams();
        if (normalizedClient.invitee_email && normalizedClient.invitee_email !== 'undefined' && normalizedClient.invitee_email !== 'null') {
          sessionTypeParams.append('email', normalizedClient.invitee_email.trim());
        }
        if (normalizedClient.invitee_phone && normalizedClient.invitee_phone !== 'undefined' && normalizedClient.invitee_phone !== 'null') {
          const phones = normalizedClient.invitee_phone.split(', ');
          phones.forEach((phone: string) => {
            if (phone.trim()) sessionTypeParams.append('phone', phone.trim());
          });
        }
        if (!sessionTypeParams.has('email') && !sessionTypeParams.has('phone')) {
          sessionTypeParams.append('client_id', normalizedClient.invitee_phone || normalizedClient.invitee_email || '');
        }
        const apiUrl = `/api/client-session-type?${sessionTypeParams.toString()}`;
        const sessionTypeRes = await fetch(apiUrl);
        if (sessionTypeRes.ok) {
          const sessionTypeData = await sessionTypeRes.json();
          if (sessionTypeData.success) {
            setClientSessionType(sessionTypeData.data);
          } else {
            console.error('❌ [TherapistDashboard] Session type API returned success: false');
            // Default to showing paid session UI if API fails
            setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
          }
        } else {
          console.error('❌ [TherapistDashboard] Session type API failed:', sessionTypeRes.status);
          // Default to showing paid session UI if API fails
          setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
        }
      } catch (sessionTypeError) {
        console.error('❌ [TherapistDashboard] Session type API error:', sessionTypeError);
        // Default to showing paid session UI if API call throws error
        setClientSessionType({ hasPaidSessions: true, hasFreeConsultation: false });
      }

      const response = await fetch(`/api/client-appointments?client_phone=${encodeURIComponent(client.client_phone)}&therapist_id=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        let filteredAppointments = data.appointments || [];

        if (clientDateRange.start && clientDateRange.end) {
          filteredAppointments = filteredAppointments.filter((apt: any) => {
            const aptDate = new Date(apt.booking_date);
            const startDate = new Date(clientDateRange.start);
            const endDate = new Date(clientDateRange.end + 'T23:59:59');
            return aptDate >= startDate && aptDate <= endDate;
          });
        }

        setClientAppointments(filteredAppointments);
        const bookings = filteredAppointments.length; // Total appointments
        const sessionsCompleted = filteredAppointments.filter((a: any) => {
          const sessionDate = a.booking_date ? new Date(a.booking_date) : new Date();
          const isPast = sessionDate < new Date();
          const isNotCancelledOrNoShow = a.booking_status !== 'cancelled' &&
            a.booking_status !== 'canceled' &&
            a.booking_status !== 'no_show' &&
            a.booking_status !== 'no show';
          return isPast && isNotCancelledOrNoShow;
        }).length; // Only past sessions (completed + pending notes), excluding cancelled/no_show
        const noShows = filteredAppointments.filter((a: any) => a.booking_status === 'no_show' || a.booking_status === 'no show').length;
        const cancelled = filteredAppointments.filter((a: any) => a.booking_status === 'cancelled' || a.booking_status === 'canceled').length;
        setClientStats({ bookings, sessionsCompleted, noShows, cancelled });

        // Update selectedClient with emergency contact and demographic data from the most recent appointment
        if (data.appointments && data.appointments.length > 0) {
          // Find the first appointment that has emergency contact info
          const aptWithEmergency = data.appointments.find((apt: any) => apt.emergency_contact_name) || data.appointments[0];

          setSelectedClient((prev: any) => ({
            ...prev,
            emergency_contact_name: aptWithEmergency.emergency_contact_name,
            emergency_contact_relation: aptWithEmergency.emergency_contact_relation,
            emergency_contact_number: aptWithEmergency.emergency_contact_number,
            invitee_age: aptWithEmergency.invitee_age,
            invitee_gender: aptWithEmergency.invitee_gender,
            invitee_occupation: aptWithEmergency.invitee_occupation,
            invitee_marital_status: aptWithEmergency.invitee_marital_status,
            clinical_profile: aptWithEmergency.clinical_profile
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching client details:', error);
    } finally {
      setClientDetailLoading(false);
    }
  };

  const fetchTherapistData = async () => {
    // Skip API calls if profile is under review
    if (isProfileUnderReview) {
      setStats([
        { title: 'Bookings', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
        { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
        { title: 'No-shows', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
        { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
        { title: 'Pending Session Notes', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
      ]);
      setBookings([]);
      setDashboardLoading(false);
      return;
    }

    try {
      setDashboardLoading(true);

      // Fetch therapist profile picture
      try {
        const profileRes = await fetch(`/api/therapist-profile?therapist_id=${user.therapist_id}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.success && profileData.data.profile_picture_url) {
            setProfilePictureUrl(profileData.data.profile_picture_url);
          }
        }
      } catch (error) {
        console.error('Error fetching profile picture:', error);
      }

      // Fetch therapist-specific stats and bookings
      const statsUrl = dateRange.start && dateRange.end
        ? `/api/therapist-stats?therapist_id=${user.id}&start=${dateRange.start}&end=${dateRange.end}`
        : `/api/therapist-stats?therapist_id=${user.id}`;

      const [response, servicesResponse] = await Promise.all([
        fetch(statsUrl),
        fetch('/api/services')
      ]);

      if (servicesResponse.ok) {
        const allServices = await servicesResponse.json();
        const myServices = allServices.filter((s: any) => s.therapist_id === user.therapist_id || String(s.therapist_id) === String(user.therapist_id));
        setDbServices(myServices);
      }

      if (response.ok) {
        const data = await response.json();

        setStats([
          { title: 'Bookings', value: (data.stats.bookings || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
          { title: 'Sessions Completed', value: (data.stats.sessionsCompleted || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
          { title: 'No-shows', value: (data.stats.noShows || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
          { title: 'Cancelled', value: (data.stats.cancelled || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
          { title: 'Pending Session Notes', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
        ]);

        setBookings(data.upcomingBookings || []);

        const notificationsRes = await fetch(`/api/notifications?user_id=${user.id}&user_role=therapist`);
        if (notificationsRes.ok) {
          const notificationsData = await notificationsRes.json();
          setNotifications(notificationsData.slice(0, 2));
        }

        // Fetch all appointments to get pending notes
        const appointmentsRes = await fetch(`/api/therapist-appointments?therapist_id=${user.id}`);
        if (appointmentsRes.ok) {
          const appointmentsData = await appointmentsRes.json();
          setAppointments(appointmentsData.appointments || []);

          // Count pending notes
          const pendingNotesCount = appointmentsData.appointments.filter((apt: any) => {
            if (apt.booking_status === 'cancelled' || apt.booking_status === 'canceled') return false;
            if (apt.booking_status === 'no_show' || apt.booking_status === 'no show') return false;
            if (apt.has_session_notes) return false;
            if (apt.session_timings) {
              const timeMatch = apt.session_timings.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
              if (timeMatch) {
                const [, dateStr, , endTimeStr] = timeMatch;
                const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
                return endDateTime < new Date();
              }
            }
            return false;
          }).length;

          setStats([
            { title: 'Bookings', value: (data.stats.bookings || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
            { title: 'Sessions Completed', value: (data.stats.sessionsCompleted || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
            { title: 'No-shows', value: (data.stats.noShows || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
            { title: 'Cancelled', value: (data.stats.cancelled || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
            { title: 'Pending Session Notes', value: pendingNotesCount.toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
            { title: 'Avg Rating', value: data.stats.avgRating ? `⭐ ${data.stats.avgRating}/5` : '—', lastMonth: '0', clickable: false, targetView: '', targetTab: '' },
          ]);
        }
      } else {
        // Fallback to empty data
        setStats([
          { title: 'Bookings', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
          { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
          { title: 'No-shows', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
          { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
          { title: 'Pending Session Notes', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
        ]);
        setBookings([]);
      }
    } catch (error) {
      console.error('Error fetching therapist data:', error);
      // Fallback to empty data
      setStats([
        { title: 'Bookings', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
        { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
        { title: 'No-shows', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
        { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
        { title: 'Pending Session Notes', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
      ]);
      setBookings([]);
    } finally {
      setDashboardLoading(false);
    }
  };

  const toggleRow = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };



  const copyAppointmentDetails = async (apt: any) => {
    const details = `${apt.session_name || apt.therapy_type}\n${apt.session_timings}\nClient: ${formatClientName(apt.client_name)}\nContact: ${apt.contact_info || 'N/A'}\nMode: ${formatMode(apt.mode)}`;
    navigator.clipboard.writeText(details).then(async () => {
      await fetch('/api/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapist_id: user.therapist_id,
          therapist_name: user.username,
          action_type: 'copy_appointment',
          action_description: `${user.username} copied appointment details`,
          client_name: apt.client_name
        })
      });
      setToast({ message: 'Appointment details copied to clipboard!', type: 'success' });
      setSelectedAppointmentIndex(null);
    }).catch(err => {
      console.error('Failed to copy:', err);
      setToast({ message: 'Failed to copy details', type: 'error' });
    });
  };

  // Normalize a phone number for fuzzy comparison (strip spaces/symbols/leading zeros)
  const normalizePhone = (p?: string) => (p || '').replace(/[\s\-()+]/g, '').replace(/^0+/, '');

  // Robustly match a client from the loaded clients list by phone, email, or name.
  const findClientMatch = (clientsList: any[], opts: { phone?: string; email?: string; name?: string }) => {
    const phone = normalizePhone(opts.phone);
    const email = (opts.email || '').toLowerCase().trim();
    const name = (opts.name || '').toLowerCase().trim();
    return clientsList.find((c: any) => {
      const cPhones = (c.client_phone || '').split(',').map((x: string) => normalizePhone(x)).filter(Boolean);
      const cEmail = (c.client_email || '').toLowerCase().trim();
      const cName = (c.client_name || '').toLowerCase().trim();
      if (phone && cPhones.some((cp: string) => cp === phone || cp.endsWith(phone) || phone.endsWith(cp))) return true;
      if (email && cEmail && cEmail === email) return true;
      if (name && cName && cName === name) return true;
      return false;
    });
  };

  // Ensure the clients list is loaded, returning it.
  const ensureClientsLoaded = async () => {
    let clientsList = clients;
    if (clients.length === 0) {
      try {
        const response = await fetch(`/api/therapist-clients?therapist_id=${user.id}`);
        if (response.ok) {
          const data = await response.json();
          clientsList = data.clients || [];
          setClients(clientsList);
        }
      } catch (error) {
        console.error('Error fetching clients:', error);
      }
    }
    return clientsList;
  };

  const openClientProfile = async (client: any) => {
    setActiveView('clients');
    setSelectedClient(client);
    await fetchClientDetails(client);
  };

  const handleViewClientFromAppointment = async (appointment: any) => {
    const clientsList = await ensureClientsLoaded();
    const client = findClientMatch(clientsList, {
      phone: appointment.contact_info || appointment.invitee_phone,
      email: appointment.invitee_email,
      name: appointment.client_name,
    }) || {
      // Fallback so the profile still opens even when the list has no exact row
      client_name: appointment.client_name,
      client_phone: appointment.contact_info || appointment.invitee_phone || '',
      client_email: appointment.invitee_email || '',
    };
    await openClientProfile(client);
  };

  const handleViewClientFromBooking = async (booking: any) => {
    const clientsList = await ensureClientsLoaded();
    const client = findClientMatch(clientsList, {
      phone: booking.client_phone || booking.contact_info || booking.invitee_phone,
      email: booking.client_email || booking.invitee_email,
      name: booking.client_name,
    }) || {
      client_name: booking.client_name,
      client_phone: booking.client_phone || booking.contact_info || booking.invitee_phone || '',
      client_email: booking.client_email || booking.invitee_email || '',
    };
    await openClientProfile(client);
  };

  const isMeetingStarted = (apt: any) => {
    const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
    if (timeMatch) {
      const [, dateStr, startTimeStr] = timeMatch;
      const startDateTime = new Date(`${dateStr} ${startTimeStr}`);
      if (!isNaN(startDateTime.getTime())) return new Date() >= startDateTime;
    }
    // Fallback: if session is in the past based on booking_date
    if (apt.booking_date) return new Date() >= new Date(apt.booking_date);
    return false;
  };

  const isMeetingEnded = (apt: any) => {
    const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
    if (timeMatch) {
      const [, dateStr, , endTimeStr] = timeMatch;
      const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
      if (!isNaN(endDateTime.getTime())) return new Date() > endDateTime;
    }
    if (apt.booking_date) return new Date() > new Date(apt.booking_date);
    return false;
  };

  const handleReminderClick = (apt: any) => {
    setSelectedReminderAppointment(apt);
    setShowReminderModal(true);
    setSelectedAppointmentIndex(null);
  };

  const sendWhatsAppNotification = async () => {
    if (!selectedReminderAppointment) return;

    await fetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        therapist_id: user.therapist_id,
        therapist_name: user.username,
        action_type: 'send_whatsapp',
        action_description: `${user.username} sent WhatsApp notification`,
        client_name: selectedReminderAppointment.client_name
      })
    });

    setToast({ message: 'WhatsApp notification sent successfully!', type: 'success' });
    setShowReminderModal(false);
    setSelectedReminderAppointment(null);
  };

  const handleSOSClick = (booking: any) => {
    // Time validation ENABLED - 24-hour window after session ends
    const timeMatch = booking.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M) IST/);
    if (timeMatch) {
      const [, dateStr, startTimeStr, endTimeStr] = timeMatch;
      const startDateTime = new Date(`${dateStr} ${startTimeStr}`);
      const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
      const now = new Date();
      const hoursSinceStart = (now.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
      const hoursSinceEnd = (now.getTime() - endDateTime.getTime()) / (1000 * 60 * 60);

      // Check if session has started
      if (hoursSinceStart < 0) {
        setToast({ message: 'SOS ticket can only be raised during or after the session', type: 'error' });
        setSelectedAppointmentIndex(null);
        return;
      }

      // Check if within 24-hour window
      if (hoursSinceEnd > 24) {
        setToast({ message: 'SOS ticket can only be raised within 24 hours of session end', type: 'error' });
        setSelectedAppointmentIndex(null);
        return;
      }
    }

    setSelectedSOSBooking(booking);
    setShowSOSModal(true);
    setSelectedAppointmentIndex(null);
  };

  const handleSOSClickFromClient = (apt: any) => {
    // Time validation ENABLED - 24-hour window after session ends
    const booking = {
      ...apt,
      client_name: selectedClient?.client_name,
      session_name: 'Individual Therapy Session',
      contact_info: selectedClient?.client_phone,
      session_timings: apt.session_timings
    };

    const timeMatch = booking.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M) IST/);
    if (timeMatch) {
      const [, dateStr, startTimeStr, endTimeStr] = timeMatch;
      const startDateTime = new Date(`${dateStr} ${startTimeStr}`);
      const endDateTime = new Date(`${dateStr} ${endTimeStr}`);
      const now = new Date();
      const hoursSinceStart = (now.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
      const hoursSinceEnd = (now.getTime() - endDateTime.getTime()) / (1000 * 60 * 60);

      // Check if session has started
      if (hoursSinceStart < 0) {
        setToast({ message: 'SOS ticket can only be raised during or after the session', type: 'error' });
        return;
      }

      // Check if within 24-hour window
      if (hoursSinceEnd > 24) {
        setToast({ message: 'SOS ticket can only be raised within 24 hours of session end', type: 'error' });
        return;
      }
    }

    setSelectedSOSBooking(booking);
    setShowSOSModal(true);
    setSelectedAppointmentIndex(null);
  };

  const handleSOSConfirm = async () => {
    try {
      // Validate all required fields are completed
      if (sosRiskSeverity === 0 ||
        Object.values(sosRiskIndicators).some(val => val === '') ||
        sosRiskSummary.trim() === '' ||
        (sosRiskIndicators.other === 'Y' && sosOtherDetails.trim() === '')) {
        setToast({ message: 'Please complete all required fields', type: 'error' });
        return;
      }

      const riskAssessmentData = {
        severity_level: sosRiskSeverity,
        severity_description: sosRiskSeverity === 1 ? 'None - no evidence of risk present'
          : sosRiskSeverity === 2 ? 'Low - low or minor evidence of risk of harm to self or others'
            : sosRiskSeverity === 3 ? 'Medium - moderate risk present'
              : sosRiskSeverity === 4 ? 'High - high or major risk of harm/injury to self or others'
                : 'Severe/catastrophic - immediate attention needed',
        risk_indicators: sosRiskIndicators,
        other_details: sosOtherDetails,
        risk_summary: sosRiskSummary
      };

      // 1. Save to database first - this is the critical step
      const dbResponse = await fetch('/api/sos-assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: selectedSOSBooking?.booking_id,
          therapist_id: user?.therapist_id,
          therapist_name: user?.username,
          client_name: selectedSOSBooking?.client_name,
          session_name: selectedSOSBooking?.session_name || selectedSOSBooking?.therapy_type,
          session_timings: selectedSOSBooking?.session_timings,
          contact_info: selectedSOSBooking?.contact_info,
          mode: selectedSOSBooking?.mode,
          risk_assessment: riskAssessmentData
        })
      });

      let assessmentId = null;
      if (!dbResponse.ok) {
        const errorData = await dbResponse.json();
        console.error('Database save failed:', errorData);
        setToast({ message: 'Failed to save SOS assessment to database', type: 'error' });
        return;
      }

      const dbResult = await dbResponse.json();
      assessmentId = dbResult.assessment_id;

      // Generate secure access token for documentation link

      // Fetch full booking details from database to get email and phone
      let clientEmail = '';
      let clientPhone = '';

      try {
        const bookingResponse = await fetch(`/api/bookings?booking_id=${selectedSOSBooking?.booking_id}`);
        if (bookingResponse.ok) {
          const bookingData = await bookingResponse.json();
          if (bookingData && bookingData.length > 0) {
            const booking = bookingData[0];
            clientEmail = booking.invitee_email || '';
            clientPhone = booking.invitee_phone || '';
          }
        }
      } catch (error) {
        console.error('Error fetching booking details:', error);
      }

      // Fallback: try to extract from selectedSOSBooking
      if (!clientEmail && selectedSOSBooking?.invitee_email) {
        clientEmail = selectedSOSBooking.invitee_email;
      }
      if (!clientPhone && selectedSOSBooking?.invitee_phone) {
        clientPhone = selectedSOSBooking.invitee_phone;
      }

      // Fallback: try to get from contact_info field
      if ((!clientEmail || !clientPhone) && selectedSOSBooking?.contact_info) {
        const parts = selectedSOSBooking.contact_info.split(',');
        if (!clientPhone) clientPhone = parts[0]?.trim() || '';
        if (!clientEmail) clientEmail = parts[1]?.trim() || '';
      }

      const tokenResponse = await fetch('/api/generate-sos-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sos_assessment_id: assessmentId,
          client_email: clientEmail,
          client_phone: clientPhone,
          client_name: selectedSOSBooking?.client_name,
          expires_in_days: 7
        })
      });

      let documentationLink = '';
      if (tokenResponse.ok) {
        const tokenResult = await tokenResponse.json();
        documentationLink = `${window.location.origin}/sos-view/${tokenResult.token}`;
      } else {
        const errorData = await tokenResponse.json();
        console.error('❌ Token generation failed:', errorData);
      }

      // 2. Send to webhook with database ID and documentation link (non-critical - don't fail if this fails)
      try {
        const webhookData = {
          database_id: assessmentId,
          documentation_link: documentationLink,
          therapist_id: user?.therapist_id,
          therapist_name: user?.username,
          client_name: selectedSOSBooking?.client_name,
          client_email: clientEmail,
          client_phone: clientPhone,
          session_name: selectedSOSBooking?.session_name || selectedSOSBooking?.therapy_type,
          session_timings: selectedSOSBooking?.session_timings,
          mode: selectedSOSBooking?.mode,
          booking_id: selectedSOSBooking?.booking_id,
          timestamp: new Date().toISOString(),
          risk_assessment: riskAssessmentData
        };
        // 2. Trigger direct Whatsapp/Email alert via backend
        const webhookResponse = await fetch('/api/send-sos-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookData)
        });

        // 3. Update database with webhook status
        if (assessmentId) {
          await fetch(`/api/sos-assessments?id=${assessmentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              webhook_sent: webhookResponse.ok,
              webhook_response: webhookResponse.ok ? 'Success' : `Failed: ${webhookResponse.status}`
            })
          });
        }
      } catch (webhookError) {
        console.error('⚠️ Webhook failed (non-critical):', webhookError);
        // Update database to record webhook failure
        if (assessmentId) {
          try {
            await fetch(`/api/sos-assessments?id=${assessmentId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                webhook_sent: false,
                webhook_response: `Error: ${webhookError.message}`
              })
            });
          } catch (updateError) {
            console.error('Failed to update webhook status:', updateError);
          }
        }
      }

      // 4. Create audit log (non-critical)
      try {
        await fetch('/api/audit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            therapist_id: user?.therapist_id,
            therapist_name: user?.username,
            action_type: 'raise_sos',
            action_description: `${user?.username} raised SOS ticket with risk assessment (Severity: ${sosRiskSeverity})`,
            client_name: selectedSOSBooking?.client_name
          })
        });
      } catch (auditError) {
        console.error('⚠️ Audit log failed (non-critical):', auditError);
      }

      // 5. Notify all admins (non-critical)
      try {
        await fetch('/api/notifications/create-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notification_type: 'sos_ticket',
            title: 'SOS Risk Assessment Submitted',
            message: `${user?.username} submitted SOS risk assessment for client ${formatClientName(selectedSOSBooking?.client_name)} (Severity Level: ${sosRiskSeverity})`,
            related_id: selectedSOSBooking?.booking_id
          })
        });
      } catch (notificationError) {
        console.error('⚠️ Admin notification failed (non-critical):', notificationError);
      }

      // Success! Show success message and reset form
      setToast({ message: 'SOS Risk Assessment submitted successfully!', type: 'success' });
      setShowSOSModal(false);
      setSosConfirmText('');
      setSelectedSOSBooking(null);
      // Reset form
      setSosRiskSeverity(0);
      setSosRiskIndicators({
        emotionalDysregulation: '',
        physicalHarmIdeas: '',
        drugAlcoholAbuse: '',
        suicidalAttempt: '',
        selfHarm: '',
        delusionsHallucinations: '',
        impulsiveness: '',
        severeStress: '',
        socialIsolation: '',
        concernByOthers: '',
        other: ''
      });
      setSosOtherDetails('');
      setSosRiskSummary('');

    } catch (error) {
      console.error('❌ Critical SOS assessment error:', error);
      setToast({ message: 'Failed to submit SOS assessment. Please try again.', type: 'error' });
    }
  };

  const handleFillSessionNotes = async (appointment: any) => {
    setSelectedAppointmentIndex(null);
    const link = `${window.location.origin}/session-notes/${appointment.booking_id}`;
    window.open(link, '_blank');
  };

  const handleViewSessionNotes = async (appointment: any) => {
    setSessionNotesLoading(true);
    setSelectedAppointmentIndex(null);

    // If we're viewing from client details, we already have the selected client
    if (selectedClient) {
      // Just switch to progress notes tab
      setClientViewTab('sessions');
      setSessionNotesLoading(false);
      return;
    }

    // Fetch clients if not already loaded
    const clientsList = await ensureClientsLoaded();

    // Find client robustly by phone/email/name, with a fallback built from the appointment
    const client = findClientMatch(clientsList, {
      phone: appointment.contact_info || appointment.invitee_phone,
      email: appointment.invitee_email,
      name: appointment.client_name,
    }) || {
      client_name: appointment.client_name,
      client_phone: appointment.contact_info || appointment.invitee_phone || '',
      client_email: appointment.invitee_email || '',
    };

    // Switch to clients view, select client, load details, open Sessions tab
    setActiveView('clients');
    setSelectedClient(client);
    await fetchClientDetails(client);
    setClientViewTab('sessions');

    setSessionNotesLoading(false);
  };

  // Shared logic for client filtering and formatting
  const formatLastSessionDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const filteredClientsList = clients.filter(client => {
    // Search filter
    const matchesSearch = searchTerm === '' ||
      (client.client_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.client_email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.client_phone || '').includes(searchTerm);

    // Tab filter
    if (activeTab === 'nri' && client.client_type !== 'NRI') {
      return false;
    }

    // Status filter
    const clientStatus = getClientStatus(client);
    const matchesStatus = clientStatusFilter === 'all' || clientStatus === clientStatusFilter;

    return matchesSearch && matchesStatus;
  });

  const renderMyClients = () => {
    if (isProfileUnderReview) {
      return (
        <div className="p-8">
          <EmptyStateCard
            icon=""
            title="No Clients Yet"
            message="You'll start seeing your clients here once your profile is approved and you receive your first booking."
            subMessage="Expected approval: 5-10 days"
          />
        </div>
      );
    }


    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedClients = filteredClientsList.slice(startIndex, startIndex + itemsPerPage);
    const totalPages = Math.ceil(filteredClientsList.length / itemsPerPage);

    return (
      <div className="p-8">
        {clientsLoading ? (
          <Loader />
        ) : (
          <>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h1 className="text-3xl font-bold mb-1">My Clients</h1>
                <p className="text-gray-600">View Client Details, Sessions and more...</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 mb-6 border-b">
              <button
                onClick={() => {
                  setActiveTab('all');
                  setCurrentPage(1);
                }}
                className={`pb-2 font-medium text-sm transition-colors ${
                  activeTab === 'all' ? 'text-teal-700 border-b-2 border-teal-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All Clients
              </button>
              <button
                onClick={() => {
                  setActiveTab('nri');
                  setCurrentPage(1);
                }}
                className={`pb-2 font-medium text-sm transition-colors ${
                  activeTab === 'nri' ? 'text-teal-700 border-b-2 border-teal-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                NRI Clients
              </button>
            </div>

            {/* Search Bar, Export and Bulk Actions */}
            <div className="relative mb-6 flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search users by name, phone no or email id..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Export Button */}
              <button
                onClick={handleExportCSV}
                className="bg-teal-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-800 whitespace-nowrap text-sm"
              >
                <Download size={16} />
                Export Excel
              </button>

              {selectedClients.size > 0 && (
                <button
                  onClick={() => setShowBulkSendModal(true)}
                  className="text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap text-sm ml-auto"
                  style={{ backgroundColor: '#21615D' }}
                >
                  <Send size={16} />
                  Send to Selected ({selectedClients.size})
                </button>
              )}
            </div>

            {/* Status Filter Pills */}
            <div className="mb-4 flex gap-2 items-center">
              <span className="text-sm text-gray-600 mr-1">Filter:</span>
              <button
                onClick={() => {
                  setClientStatusFilter('all');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${clientStatusFilter === 'all'
                  ? 'bg-gray-800 text-white ring-2 ring-gray-400'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => {
                  setClientStatusFilter('active');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${clientStatusFilter === 'active' ? 'ring-2 ring-teal-800' : ''
                  }`}
                style={{ backgroundColor: '#21615D' }}
              >
                Active
              </button>
              <button
                onClick={() => {
                  setClientStatusFilter('inactive');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${clientStatusFilter === 'inactive' ? 'ring-2 ring-gray-500' : ''
                  }`}
                style={{ backgroundColor: '#9CA3AF' }}
              >
                Inactive
              </button>
              <button
                onClick={() => {
                  setClientStatusFilter('drop-out');
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${clientStatusFilter === 'drop-out' ? 'ring-2 ring-red-800' : ''
                  }`}
                style={{ backgroundColor: '#B91C1C' }}
              >
                Drop-out
              </button>
            </div>

            <div className="bg-white rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full" ref={bookingActionsRef}>
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left w-12">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 focus:ring-[#21615D] cursor-pointer"
                          style={{ accentColor: '#21615D' }}
                          checked={paginatedClients.length > 0 && paginatedClients.every(c => selectedClients.has(c.client_name))}
                          onChange={(e) => handleSelectAllClients(e, paginatedClients)}
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Name</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">No. of Bookings</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Last Session Booked</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientsLoading ? (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-8">
                          Loading...
                        </td>
                      </tr>
                    ) : paginatedClients.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-8">
                          No clients found
                        </td>
                      </tr>
                    ) : (
                      paginatedClients.map((client, index) => {
                        const status = getClientStatus(client);
                        const isExpanded = expandedRows.has(index);
                        return (
                          <React.Fragment key={index}>
                            <tr
                              className={`border-b hover:bg-gray-50 transition-colors cursor-pointer ${selectedClients.has(client.client_name) ? 'bg-teal-50/50' : ''
                                }`}
                              onClick={() => toggleRow(index)}
                            >
                              <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded border-gray-300 focus:ring-[#21615D] cursor-pointer"
                                  style={{ accentColor: '#21615D' }}
                                  checked={selectedClients.has(client.client_name)}
                                  onChange={(e) => handleSelectClient(e, client.client_name)}
                                />
                              </td>
                              <td className="px-6 py-4 text-sm">
                                  <span
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveAppointmentTab('all');
                                      fetchClientDetails(client);
                                      setSelectedClient(client);
                                    }}
                                    className="text-teal-700 hover:underline cursor-pointer"
                                  >
                                    {formatClientName(client.client_name)}
                                  </span>
                                  {client.client_type === 'NRI' && (
                                    <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded border border-purple-200 ml-2">
                                      NRI
                                    </span>
                                  )}
                              </td>
                              <td className="px-6 py-4 text-sm">{client.booking_resource_name || 'N/A'}</td>
                              <td className="px-6 py-4 text-sm">{formatMode(client.booking_mode)}</td>
                              <td className="px-6 py-4 text-sm">{client.total_sessions}</td>
                              <td className="px-6 py-4 text-sm">{formatLastSessionDate(client.last_session_date)}</td>
                              <td className="px-6 py-4 text-sm">
                                <span
                                  className="px-3 py-1 rounded-full text-xs font-medium text-white whitespace-nowrap"
                                  style={{
                                    backgroundColor:
                                      status === 'active' ? '#21615D' :
                                        status === 'drop-out' ? '#B91C1C' :
                                          '#9CA3AF'
                                  }}
                                >
                                  {status === 'active' ? 'Active' : status === 'drop-out' ? 'Drop-out' : 'Inactive'}
                                </span>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-gray-50 border-b">
                                <td colSpan={7} className="px-6 py-4">
                                  <div className="flex justify-center">
                                    <button
                                      onClick={() => {
                                        setSelectedClientForBooking({
                                          name: client.client_name,
                                          phone: client.client_phone || '',
                                          email: client.client_email || ''
                                        });
                                        setShowBookingModal(true);
                                      }}
                                      className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                                    >
                                      <Send size={16} />
                                      Send Booking Link
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4 border-t flex justify-between items-center">
                <span className="text-sm text-gray-600">Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredClientsList.length)} of {filteredClientsList.length} client{filteredClientsList.length !== 1 ? 's' : ''}</span>
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
          </>
        )}
      </div>
    );
  };

  // Inline component for Free Consultation Notes List
  const FreeConsultationNotesList = ({ clientId, onViewNote }: { clientId: string; onViewNote: (id: number) => void }) => {
    const [notes, setNotes] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [hasBooking, setHasBooking] = React.useState(false);

    React.useEffect(() => {
      const fetchNotes = async () => {
        try {
          const response = await fetch(`/api/free-consultation-notes?client_id=${clientId}`);
          const data = await response.json();
          if (data.success) {
            setNotes(data.data);
          }

          // Check if client has free consultation booking
          if (data.data.length === 0) {
            // Check bookings to see if there's a free consultation scheduled
            setHasBooking(clientSessionType.hasFreeConsultation);
          }
        } catch (error) {
          console.error('Error fetching free consultation notes:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchNotes();
    }, [clientId]);

    if (loading) {
      return <div className="flex items-center justify-center py-12"><div className="text-gray-500">Loading...</div></div>;
    }

    if (notes.length === 0) {
      return (
        <div className="text-center py-12">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          {hasBooking ? (
            <>
              <p className="text-gray-500 text-lg mb-4">Free consultation session booked</p>
              <p className="text-gray-400 text-sm">Pre-therapy notes will appear here after the therapist fills the consultation form</p>
            </>
          ) : (
            <>
              <p className="text-gray-500 text-lg mb-4">No pre-therapy consultation notes yet</p>
              <p className="text-gray-400 text-sm">Notes will appear after the free consultation session</p>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold mb-4">Pre-therapy Consultation Notes</h2>
        {notes.map((note) => (
          <div
            key={note.id}
            className="bg-purple-50 rounded-lg border-2 border-purple-200 hover:border-purple-400 transition-colors cursor-pointer p-6"
            onClick={() => onViewNote(note.id)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="px-3 py-1 bg-purple-600 text-white text-sm font-medium rounded-full">
                    FREE CONSULTATION
                  </span>
                  <span className="text-sm text-gray-600">
                    {new Date(note.session_date).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-3">
                  <span>Mode: {note.session_mode || 'N/A'}</span>
                  <span>•</span>
                  <span>Duration: {note.session_duration || 'N/A'}</span>
                  <span>•</span>
                  <span>Therapist: {note.therapist_name || 'N/A'}</span>
                </div>
              </div>
              <ChevronRight size={20} className="text-purple-400" />
            </div>
            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium text-purple-700">Presenting Concerns:</span>
                <p className="text-sm text-gray-700 mt-1 line-clamp-3">
                  {note.presenting_concerns || 'No concerns recorded'}
                </p>
              </div>
              {note.assigned_therapist_name && (
                <div>
                  <span className="text-xs font-medium text-purple-700">Assigned Therapist:</span>
                  <p className="text-sm text-gray-700 mt-1">{note.assigned_therapist_name}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const getAppointmentStatus = (apt: any) => {
    if (apt.booking_status === 'cancelled') return 'cancelled';
    if (apt.booking_status === 'no_show' || apt.booking_status === 'no show') return 'no_show';
    if (apt.has_session_notes) return 'completed';

    // Parse session_timings to check if session ended - handle both IST and GMT formats
    if (apt.session_timings) {
      // Match format: "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM (GMT+01:00)" or "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM IST"
      const timeMatch = apt.session_timings.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M) - (\d+:\d+ [AP]M)/);
      if (timeMatch) {
        const [, dateStr, , endTimeStr] = timeMatch;

        // Create date string in a format that works across browsers
        const endDateTime = new Date(`${dateStr} ${endTimeStr}`);

        // Check if the date is valid and if session has ended
        if (!isNaN(endDateTime.getTime())) {
          const now = new Date();
          if (endDateTime < now && !apt.has_session_notes) {
            return 'pending_notes';
          }
        }
      }
    }

    return 'scheduled';
  };

  // Add this useEffect to log pending notes count when appointments change
  useEffect(() => {
  }, [appointments]);

  // Reset appointment page when tab or search term changes
  useEffect(() => {
    setAppointmentCurrentPage(1);
  }, [activeAppointmentTab, appointmentSearchTerm]);

  // Bulk Booking Handlers
  const handleSelectAllClients = (e: React.ChangeEvent<HTMLInputElement>, currentClients: any[]) => {
    if (e.target.checked) {
      const newSelected = new Set(selectedClients);
      currentClients.forEach(client => {
        if (client.client_name) newSelected.add(client.client_name);
      });
      setSelectedClients(newSelected);
    } else {
      const newSelected = new Set(selectedClients);
      currentClients.forEach(client => {
        if (client.client_name) newSelected.delete(client.client_name);
      });
      setSelectedClients(newSelected);
    }
  };

  const handleSelectClient = (e: React.ChangeEvent<HTMLInputElement>, clientId: string) => {
    e.stopPropagation();
    const newSelected = new Set(selectedClients);
    if (e.target.checked) {
      newSelected.add(clientId);
    } else {
      newSelected.delete(clientId);
    }
    setSelectedClients(newSelected);
  };

  const confirmBulkSendBookingLink = async () => {
    if (selectedClients.size === 0) return;
    setIsBulkSending(true);

    const selectedClientNames = Array.from(selectedClients);
    const selectedClientObjects = clients.filter(c => selectedClientNames.includes(c.client_name));

    let successCount = 0;
    let errorCount = 0;

    // Helper to send a single link
    const sendLink = async (client: any) => {
      try {
        let therapyType = 'Individual Therapy';
        const typeRes = await fetch(`/api/client-therapy-type?email=${encodeURIComponent(client.client_email || '')}&phone=${encodeURIComponent(client.client_phone || '')}`);
        if (typeRes.ok) {
          const data = await typeRes.json();
          therapyType = data.therapy_type || 'Individual Therapy';
        }

        const cleanTherapyType = (therapy: string) => {
          let cleaned = therapy.replace(/\s+with\s+[A-Za-z\s]+$/i, '').trim();
          cleaned = cleaned.replace(/\s+Session$/i, '').trim();
          return cleaned;
        };

        const isFreeConsultation = therapyType.toLowerCase().includes('free consultation');
        const webhookData = {
          clientName: client.client_name,
          email: client.client_email || '',
          phone: client.client_phone || '',
          therapistName: isFreeConsultation ? 'Safestories' : (user.full_name || user.username || 'Unknown'),
          therapy: isFreeConsultation ? 'Free Consultation' : cleanTherapyType(therapyType)
        };

        const response = await fetch('/api/send-booking-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookData)
        });

        if (response.ok) successCount++;
        else errorCount++;
      } catch (err) {
        console.error('Error sending bulk link:', err);
        errorCount++;
      }
    };

    // Send all links in parallel
    await Promise.all(selectedClientObjects.map(client => sendLink(client)));

    setToast({
      message: `Finished: ${successCount} sent successfully. ${errorCount > 0 ? `${errorCount} failed.` : ''}`,
      type: errorCount === 0 ? 'success' : 'error'
    });

    setIsBulkSending(false);
    setShowBulkSendModal(false);
    setSelectedClients(new Set());
  };

  const handleExportCSV = () => {
    if (clients.length === 0) {
      setToast({ message: 'No clients available to export', type: 'error' });
      return;
    }

    const headers = ['Client Name', 'Email', 'Phone', 'Session Name', 'Mode', 'No. of Bookings', 'Last Session Booked', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredClientsList.map(client => {
        return [
          `"${formatClientName(client.client_name).replace(/"/g, '""')}"`,
          `"${(client.client_email || '').replace(/"/g, '""')}"`,
          `"${(client.client_phone || '').replace(/"/g, '""')}"`,
          `"${(client.booking_resource_name || 'N/A').replace(/"/g, '""')}"`,
          `"${formatMode(client.booking_mode).replace(/"/g, '""')}"`,
          `"${client.total_sessions}"`,
          `"${formatLastSessionDate(client.last_session_date)}"`,
          `"${getClientStatus(client)}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `my_clients_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  function renderMyAppointments() {
    if (isProfileUnderReview) {
      return (
        <div className="p-8">
          <EmptyStateCard
            icon=""
            title="No Bookings Yet"
            message="Your booking calendar will be available once your profile is approved by our team."
            subMessage="Expected approval: 5-10 days"
          />
        </div>
      );
    }

    return (
      <div className="p-8">
        {appointmentsLoading ? (
          <Loader />
        ) : (
          <>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h1 className="text-3xl font-bold mb-1">My Bookings</h1>
                <p className="text-gray-600">View Recently Book Session, Send invite and more...</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 mb-6">
              {appointmentTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveAppointmentTab(tab.id)}
                  className={`pb-2 font-medium ${activeAppointmentTab === tab.id
                    ? 'text-teal-700 border-b-2 border-teal-700'
                    : 'text-gray-400'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Bar + Month Filter */}
            <div className="mb-6 flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  placeholder="Search bookings by session, client or therapist name..."
                  value={appointmentSearchTerm}
                  onChange={(e) => setAppointmentSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsDateDropdownOpen(prev => !prev)}
                  className="flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm whitespace-nowrap"
                  style={{ backgroundColor: '#21615D' }}
                >
                  <Calendar size={16} className="text-white" />
                  {selectedMonth}
                  <span className="text-gray-400">▾</span>
                </button>
                {isDateDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-50 min-w-[160px] max-h-64 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedMonth('All Time'); setDateRange({ start: '', end: '' }); setIsDateDropdownOpen(false); setAppointmentCurrentPage(1); }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${selectedMonth === 'All Time' ? 'text-teal-700 font-medium' : 'text-gray-700'}`}
                    >
                      All Time
                    </button>
                    {monthOptions.map((m: string) => (
                      <button
                        key={m}
                        onClick={() => { handleMonthSelect(m); setAppointmentCurrentPage(1); }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${selectedMonth === m ? 'text-teal-700 font-medium' : 'text-gray-700'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full" ref={appointmentActionsRef}>
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Timings</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Name</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointmentsLoading ? (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-8">
                          Loading...
                        </td>
                      </tr>
                    ) : appointments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-8">
                          No bookings found
                        </td>
                      </tr>
                    ) : (() => {
                      // Filter appointments first
                      const filteredAppointments = appointments.filter(appointment => {
                        const matchesSearch = appointmentSearchTerm === '' ||
                          (appointment.session_name || '').toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                          (appointment.client_name || '').toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                          (user.full_name || user.username || '').toLowerCase().includes(appointmentSearchTerm.toLowerCase());

                        if (!matchesSearch) return false;

                        // Month filter
                        if (dateRange.start && dateRange.end) {
                          const aptDate = appointment.booking_date ? new Date(appointment.booking_date) : null;
                          if (!aptDate) return false;
                          const start = new Date(dateRange.start);
                          const end = new Date(dateRange.end);
                          end.setHours(23, 59, 59, 999);
                          if (aptDate < start || aptDate > end) return false;
                        }

                        if (activeAppointmentTab === 'all') return true;
                        
                        const status = getAppointmentStatus(appointment);
                        if (activeAppointmentTab === 'completed') {
                          return status === 'completed' || status === 'pending_notes';
                        }
                        return status === activeAppointmentTab;
                      }).sort((a, b) => {
                        // Sort appointments by date - for upcoming appointments, show soonest first
                        const getAppointmentDate = (apt: any) => {
                          if (apt.booking_date) {
                            return new Date(apt.booking_date);
                          }
                          // Parse from session_timings format like "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM IST"
                          const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M)/);
                          if (timeMatch) {
                            const [, dateStr, timeStr] = timeMatch;
                            return new Date(`${dateStr} ${timeStr}`);
                          }
                          return new Date(0); // fallback to epoch if can't parse
                        };

                        const dateA = getAppointmentDate(a);
                        const dateB = getAppointmentDate(b);

                        // For upcoming appointments (scheduled), sort ascending (soonest first)
                        if (activeAppointmentTab === 'scheduled') {
                          return dateA.getTime() - dateB.getTime();
                        }
                        
                        // For other tabs, sort descending (most recent first)
                        return dateB.getTime() - dateA.getTime();
                      });

                      // Calculate pagination
                      const totalFiltered = filteredAppointments.length;
                      const startIndex = (appointmentCurrentPage - 1) * appointmentsPerPage;
                      const endIndex = startIndex + appointmentsPerPage;
                      const paginatedAppointments = filteredAppointments.slice(startIndex, endIndex);

                      return paginatedAppointments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center text-gray-400 py-8">
                            No bookings found
                          </td>
                        </tr>
                      ) : paginatedAppointments.map((appointment, index) => (
                        <React.Fragment key={index}>
                          <tr
                            className={`border-b cursor-pointer transition-colors ${selectedAppointmentIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                              }`}
                            onClick={() => setSelectedAppointmentIndex(selectedAppointmentIndex === index ? null : index)}
                          >
                            <td className="px-6 py-4 text-sm">{appointment.session_timings}</td>
                            <td className="px-6 py-4 text-sm">{appointment.session_name}</td>
                            <td className="px-6 py-4 text-sm">
                              <span
                                className="text-teal-700 hover:underline cursor-pointer"
                                onClick={() => handleViewClientFromAppointment(appointment)}
                              >
                                {formatClientName(appointment.client_name)}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {(() => {
                                return formatMode(appointment.mode);
                              })()}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getAppointmentStatus(appointment) === 'completed' ? 'bg-green-100 text-green-700' :
                                getAppointmentStatus(appointment) === 'cancelled' ? 'bg-red-100 text-red-700' :
                                  getAppointmentStatus(appointment) === 'no_show' ? 'bg-orange-100 text-orange-700' :
                                    getAppointmentStatus(appointment) === 'pending_notes' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-blue-100 text-blue-700'
                                }`}>
                                {getAppointmentStatus(appointment) === 'pending_notes' ? 'Pending Notes' :
                                  getAppointmentStatus(appointment) === 'no_show' ? 'No Show' :
                                    getAppointmentStatus(appointment).charAt(0).toUpperCase() + getAppointmentStatus(appointment).slice(1)}
                              </span>
                            </td>
                          </tr>
                          {selectedAppointmentIndex === index && (
                            <tr className="bg-gray-100">
                              <td colSpan={5} className="px-6 py-4">
                                <div className="flex gap-1.5 justify-center">
                                  <button
                                    onClick={() => copyAppointmentDetails(appointment)}
                                    className="px-3 py-1.5 border border-gray-400 rounded-lg text-xs text-gray-700 hover:bg-white flex items-center gap-1.5"
                                  >
                                    <Copy size={13} />
                                    Copy Details
                                  </button>
                                  <button
                                    onClick={() => handleReminderClick(appointment)}
                                    disabled={isMeetingEnded(appointment) || appointment.booking_status === 'cancelled'}
                                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${isMeetingEnded(appointment) || appointment.booking_status === 'cancelled'
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                      : 'border border-gray-400 text-gray-700 hover:bg-white'
                                      }`}
                                  >
                                    <Send size={13} />
                                    Send Reminder
                                  </button>
                                  <button
                                    onClick={() => handleSOSClick(appointment)}
                                    disabled={appointment.booking_status === 'cancelled'}
                                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${appointment.booking_status === 'cancelled'
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                      : 'border border-red-600 text-red-600 hover:bg-white'
                                      }`}
                                  >
                                    <span className="font-bold">SOS</span>
                                    Raise Ticket
                                  </button>
                                  <button
                                    onClick={() => handleViewSessionNotes(appointment)}
                                    disabled={!appointment.has_session_notes || appointment.booking_status === 'cancelled'}
                                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${!appointment.has_session_notes || appointment.booking_status === 'cancelled'
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                      : 'border border-blue-600 text-blue-600 hover:bg-white'
                                      }`}
                                  >
                                    <FileText size={13} />
                                    View Session Notes
                                  </button>
                                  <button
                                    onClick={() => handleFillSessionNotes(appointment)}
                                    disabled={appointment.has_session_notes || appointment.booking_status === 'cancelled' || !isMeetingStarted(appointment)}
                                    className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${appointment.has_session_notes || appointment.booking_status === 'cancelled' || !isMeetingStarted(appointment)
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                      : 'border border-teal-600 text-teal-600 hover:bg-white'
                                      }`}
                                  >
                                    <FileText size={13} />
                                    Fill Session Notes
                                  </button>
                                  {(getAppointmentStatus(appointment) === 'completed' || getAppointmentStatus(appointment) === 'pending_notes') && (
                                    appointment.client_rating ? (
                                      <span className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 bg-yellow-50 border border-yellow-200 text-yellow-700 whitespace-nowrap">
                                        ⭐ {appointment.client_rating}/5
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          setFeedbackTarget(appointment);
                                          setShowFeedbackModal(true);
                                        }}
                                        className="px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 border border-teal-600 text-teal-600 hover:bg-white"
                                      >
                                        ⭐ Request Feedback
                                      </button>
                                    )
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-4 border-t flex justify-between items-center">
                {(() => {
                  const filteredAppointments = appointments.filter(appointment => {
                    const matchesSearch = appointmentSearchTerm === '' ||
                      appointment.session_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                      appointment.client_name.toLowerCase().includes(appointmentSearchTerm.toLowerCase()) ||
                      (user.full_name || user.username).toLowerCase().includes(appointmentSearchTerm.toLowerCase());
                    if (!matchesSearch) return false;

                    // Month filter
                    if (dateRange.start && dateRange.end) {
                      const aptDate = appointment.booking_date ? new Date(appointment.booking_date) : null;
                      if (!aptDate) return false;
                      const start = new Date(dateRange.start);
                      const end = new Date(dateRange.end);
                      end.setHours(23, 59, 59, 999);
                      if (aptDate < start || aptDate > end) return false;
                    }

                    if (activeAppointmentTab === 'all') return true;
                    
                    const status = getAppointmentStatus(appointment);
                    if (activeAppointmentTab === 'completed') {
                      return status === 'completed' || status === 'pending_notes';
                    }
                    return status === activeAppointmentTab;
                  }).sort((a, b) => {
                    // Sort appointments by date - for upcoming appointments, show soonest first
                    const getAppointmentDate = (apt: any) => {
                      if (apt.booking_date) {
                        return new Date(apt.booking_date);
                      }
                      // Parse from session_timings format like "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM IST"
                      const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M)/);
                      if (timeMatch) {
                        const [, dateStr, timeStr] = timeMatch;
                        return new Date(`${dateStr} ${timeStr}`);
                      }
                      return new Date(0); // fallback to epoch if can't parse
                    };

                    const dateA = getAppointmentDate(a);
                    const dateB = getAppointmentDate(b);

                    // For upcoming appointments (scheduled), sort ascending (soonest first)
                    if (activeAppointmentTab === 'scheduled') {
                      return dateA.getTime() - dateB.getTime();
                    }
                    
                    // For other tabs, sort descending (most recent first)
                    return dateB.getTime() - dateA.getTime();
                  });

                  const totalFiltered = filteredAppointments.length;
                  const startIndex = (appointmentCurrentPage - 1) * appointmentsPerPage;
                  const endIndex = Math.min(startIndex + appointmentsPerPage, totalFiltered);
                  const totalPages = Math.ceil(totalFiltered / appointmentsPerPage);

                  return (
                    <>
                      <span className="text-sm text-gray-600">
                        Showing {totalFiltered === 0 ? 0 : startIndex + 1}-{endIndex} of {totalFiltered} booking{totalFiltered !== 1 ? 's' : ''}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAppointmentCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={appointmentCurrentPage === 1}
                          className={`p-2 border rounded ${appointmentCurrentPage === 1 ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                        >
                          ←
                        </button>
                        <button
                          onClick={() => setAppointmentCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={appointmentCurrentPage >= totalPages}
                          className={`p-2 border rounded ${appointmentCurrentPage >= totalPages ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                        >
                          →
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r flex flex-col">
        <div className="p-6 flex justify-center">
          <Logo size="small" />
        </div>

        <nav className="flex-1 px-4">
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer"
            style={{ backgroundColor: activeView === 'dashboard' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              setActiveView('dashboard');
            }}
          >
            <LayoutDashboard size={20} className={activeView === 'dashboard' ? 'text-teal-700' : 'text-gray-700'} />
            <span className={activeView === 'dashboard' ? 'text-teal-700' : 'text-gray-700'}>Dashboard</span>
          </div>

          <div
            className={`rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100`}
            style={{ backgroundColor: activeView === 'resources' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              setActiveView('resources');
              const therapistServices = dbServices.length > 0 ? dbServices : (therapistData[user.full_name]?.services || []);
              if (!therapistServices || therapistServices.length === 0) return;
              const primaryService = therapistServices[0];
              // Use session scheduleId if available, otherwise fetch from therapist_resources
              if (user.scheduleId) {
                setSelectedEditEvent({
                  ...primaryService,
                  scheduleId: user.scheduleId,
                  owner: user.full_name,
                  initialTab: 'Schedule'
                });
              } else {
                fetch(`/api/therapist-schedule?therapist_id=${user.therapist_id}`)
                  .then(res => res.json())
                  .then((data: any) => {
                    setSelectedEditEvent({
                      ...primaryService,
                      scheduleId: data.scheduleId ?? null,
                      owner: user.full_name,
                      initialTab: 'Schedule'
                    });
                  })
                  .catch(() => {
                    setSelectedEditEvent({ ...primaryService, owner: user.full_name, initialTab: 'Schedule' });
                  });
              }
            }}
            title="View Availability"
          >
            <FileText size={20} className={activeView === 'resources' ? 'text-teal-700' : 'text-gray-700'} />
            <span className={activeView === 'resources' ? 'text-teal-700' : 'text-gray-700'}>My Availability</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'clients' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              setActiveView('clients');
            }}
          >
            <Users size={20} className={activeView === 'clients' ? 'text-teal-700' : 'text-gray-700'} />
            <span className={activeView === 'clients' ? 'text-teal-700' : 'text-gray-700'}>My Clients</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'appointments' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              setActiveView('appointments');
            }}
          >
            <Calendar size={20} className={activeView === 'appointments' ? 'text-teal-700' : 'text-gray-700'} />
            <span className={activeView === 'appointments' ? 'text-teal-700' : 'text-gray-700'}>My Bookings</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'notifications' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              setActiveView('notifications');
            }}
          >
            <Bell size={20} className={activeView === 'notifications' ? 'text-teal-700' : 'text-gray-700'} />
            <span className={activeView === 'notifications' ? 'text-teal-700' : 'text-gray-700'}>Notifications</span>
          </div>

        </nav>

        <div className="p-4 border-t relative" ref={profileMenuRef}>
          {/* Profile Dropdown Menu */}
          {showProfileMenu && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border rounded-lg shadow-lg z-50">
              <button
                onClick={() => {
                  if (!isProfileUnderReview) {
                    setShowProfileMenu(false);
                    setActiveView('settings');
                  }
                }}
                disabled={isProfileUnderReview}
                className={`w-full px-4 py-3 text-left flex items-center gap-3 border-b ${isProfileUnderReview
                  ? 'bg-gray-100 cursor-not-allowed opacity-60'
                  : 'hover:bg-gray-50 cursor-pointer'
                  }`}
              >
                <Edit size={18} className="text-gray-600" />
                <span className="text-sm font-medium">Edit Profile</span>
                {isProfileUnderReview && (
                  <span className="ml-auto text-xs text-gray-500">(Disabled)</span>
                )}
              </button>
              <button
                onClick={() => {
                  if (!isProfileUnderReview) {
                    setShowProfileMenu(false);
                    setActiveView('changePassword');
                  }
                }}
                disabled={isProfileUnderReview}
                className={`w-full px-4 py-3 text-left flex items-center gap-3 ${isProfileUnderReview
                  ? 'bg-gray-100 cursor-not-allowed opacity-60'
                  : 'hover:bg-gray-50 cursor-pointer'
                  }`}
              >
                <Eye size={18} className="text-gray-600" />
                <span className="text-sm font-medium">Change/Forgot Password</span>
                {isProfileUnderReview && (
                  <span className="ml-auto text-xs text-gray-500">(Disabled)</span>
                )}
              </button>
            </div>
          )}

          {/* Profile Box */}
          <div
            className="flex items-center gap-3 rounded-lg p-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: '#2D757930' }}
            onClick={() => setShowProfileMenu(!showProfileMenu)}
          >
            {profilePictureUrl ? (
              <img
                src={profilePictureUrl}
                alt="Profile"
                className="w-10 h-10 rounded-lg object-cover"
              />
            ) : (
              <div className="w-10 h-10 bg-orange-400 rounded-lg flex items-center justify-center">
                <Users size={20} className="text-white" />
              </div>
            )}
            <div className="flex-1">
              <div className="font-semibold text-sm">{user.full_name || user.username}</div>
              <div className="text-xs text-gray-600">Role: {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Therapist'}</div>
            </div>
            <LogOut size={18} className="text-red-500 cursor-pointer" onClick={async (e) => {
              e.stopPropagation();
              await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user })
              });
              onLogout();
            }} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto relative">
        {selectedClient ? (
          <div className="p-8 h-full overflow-auto">
            {/* Header with Back Button */}
            <div className="flex items-center gap-4 mb-6">
              <button 
                onClick={() => {
                  setSelectedClient(null);
                  searchParams.delete('clientId');
                  setSearchParams(searchParams);
                }} 
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={24} />
              </button>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">{formatClientName(selectedClient.client_name)}</h1>
                {selectedClient.client_type === 'NRI' && (
                  <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded border border-purple-200">
                    NRI
                  </span>
                )}
                <span
                  className="px-3 py-1 rounded-full text-sm font-medium text-white"
                  style={{
                    backgroundColor: getClientStatus(selectedClient) === 'active' ? '#21615D' : '#B91C1C'
                  }}
                >
                  {getClientStatus(selectedClient) === 'active' ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => setEditingClient(selectedClient)}
                  className="p-1.5 hover:bg-gray-200 rounded transition-colors text-gray-500 ml-auto"
                  title="Edit Client"
                >
                  <Edit size={18} />
                </button>
              </div>
            </div>

            {/* Two Column Layout - Left side fixed, Right side with tabs */}
            <div className="grid grid-cols-12 gap-6">
              {/* Left Column - Client Information (Always Visible) */}
              <div className="col-span-4 space-y-6">
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
                  {clientSessionType.hasPaidSessions ? (
                    // Show case history for paid sessions
                    isCaseHistoryVisible ? (
                      <CaseHistoryTab clientId={selectedClient.client_phone} />
                    ) : (
                      <div className="border rounded-lg p-4 bg-gray-50 min-h-[100px] flex items-center justify-center">
                        <p className="text-gray-400 text-sm">Case history is hidden. Click the eye icon to view.</p>
                      </div>
                    )
                  ) : (
                    // Show message for free consultation only
                    <div className="border rounded-lg p-4 bg-gray-50 min-h-[100px] flex items-center justify-center">
                      <p className="text-gray-400 text-sm">Pre-therapy notes will appear after consultation form is filled</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Tabbed Content */}
              <div className="col-span-8 space-y-6">
                {/* Navigation Tabs */}
                <div className="flex gap-8 border-b">
                  {(() => {
                    return clientSessionType.hasPaidSessions ? (
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
                    );
                  })()}
                </div>

                {/* Date Filter */}
                <div className="flex justify-end">
                  <div className="relative" ref={clientDropdownRef}>
                    <button
                      onClick={() => setIsClientDateDropdownOpen(!isClientDateDropdownOpen)}
                      className="flex items-center gap-2 rounded-lg px-4 py-2 text-white text-sm font-medium"
                      style={{ backgroundColor: '#21615D', minWidth: 160 }}
                    >
                      <PieChart size={16} />
                      <span style={{ flex: 1, textAlign: 'left' }}>{clientSelectedMonth}</span>
                      {isClientDateDropdownOpen ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>
                    {isClientDateDropdownOpen && (
                      <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-10">
                        {!showClientCustomCalendar ? (
                          <>
                            <button
                              onClick={() => {
                                setClientSelectedMonth('All Time');
                                setClientDateRange({ start: '', end: '' });
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
                            {monthOptions.map((month) => (
                              <button
                                key={month}
                                onClick={() => handleClientMonthSelect(month)}
                                className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100"
                              >
                                {month}
                              </button>
                            ))}
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
                    {/* Stats Cards */}
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

                    {/* Additional Stats Row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white border rounded-lg p-4">
                        <p className="text-sm text-gray-600 mb-1">Next Session</p>
                        <p className="text-lg font-bold text-gray-900">
                          {(() => {
                            const upcoming = clientAppointments
                              .filter(apt => {
                                // Use getAppointmentStatus to properly check if session is upcoming
                                return getAppointmentStatus(apt) === 'scheduled';
                              })
                              .sort((a, b) => {
                                const dateA = a.booking_date ? new Date(a.booking_date) : new Date();
                                const dateB = b.booking_date ? new Date(b.booking_date) : new Date();
                                return dateA.getTime() - dateB.getTime();
                              })[0];

                            if (upcoming && upcoming.booking_date) {
                              const date = new Date(upcoming.booking_date);
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
                                const status = getAppointmentStatus(apt);
                                // Include completed and pending_notes, exclude cancelled and no_show
                                return status === 'completed' || status === 'pending_notes';
                              })
                              .sort((a, b) => {
                                const dateA = a.booking_date ? new Date(a.booking_date) : new Date();
                                const dateB = b.booking_date ? new Date(b.booking_date) : new Date();
                                return dateB.getTime() - dateA.getTime(); // Sort descending to get most recent
                              })[0];

                            if (completed && completed.session_timings) {
                              // Parse date from session_timings to match what's shown in the table
                              const timeMatch = completed.session_timings.match(/(\w+, \w+ \d+, \d+) at/);
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

                    {/* Third Stats Row */}
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

                    {/* Appointments Section */}
                    <div>
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <User size={20} className="text-gray-700" />
                        Bookings
                      </h3>

                      {/* Tabs */}
                      <div className="flex gap-6 mb-4">
                        {[
                          { id: 'all', label: 'Booking History' },
                        ].map((tab) => {
                          const count = clientAppointments.filter(apt => {
                            if (clientAppointmentSearchTerm && !apt.booking_resource_name?.toLowerCase().includes(clientAppointmentSearchTerm.toLowerCase())) {
                              return false;
                            }
                            if (tab.id === 'all') return true;
                            if (tab.id === 'upcoming') {
                              // Use getAppointmentStatus to properly check if session is upcoming
                              const status = getAppointmentStatus(apt);
                              return status === 'scheduled';
                            }
                            return getAppointmentStatus(apt) === tab.id;
                          }).length;

                          return (
                            <button
                              key={tab.id}
                              onClick={() => setActiveAppointmentTab(tab.id)}
                              className={`pb-2 font-medium ${activeAppointmentTab === tab.id
                                ? 'text-teal-700 border-b-2 border-teal-700'
                                : 'text-gray-400'
                                }`}
                            >
                              {tab.label} ({count})
                            </button>
                          );
                        })}
                      </div>

                      {clientDetailLoading ? (
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
                                  if (activeAppointmentTab === 'all') return true;
                                  
                                  const status = getAppointmentStatus(apt);
                                  if (activeAppointmentTab === 'completed') {
                                    return status === 'completed' || status === 'pending_notes';
                                  }
                                  return status === activeAppointmentTab;
                                }).sort((a, b) => {
                                  // Sort appointments by date - for upcoming appointments, show soonest first
                                  const getAppointmentDate = (apt: any) => {
                                    if (apt.booking_date) {
                                      return new Date(apt.booking_date);
                                    }
                                    // Parse from session_timings format like "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM IST"
                                    const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M)/);
                                    if (timeMatch) {
                                      const [, dateStr, timeStr] = timeMatch;
                                      return new Date(`${dateStr} ${timeStr}`);
                                    }
                                    return new Date(0); // fallback to epoch if can't parse
                                  };

                                  const dateA = getAppointmentDate(a);
                                  const dateB = getAppointmentDate(b);

                                  // For upcoming appointments (scheduled), sort ascending (soonest first)
                                  if (activeAppointmentTab === 'scheduled') {
                                    return dateA.getTime() - dateB.getTime();
                                  }
                                  
                                  // For other tabs, sort descending (most recent first)
                                  return dateB.getTime() - dateA.getTime();
                                }).length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="text-center py-4 text-gray-400 text-sm">No bookings found</td>
                                  </tr>
                                ) : (
                                  clientAppointments.filter(apt => {
                                    if (clientAppointmentSearchTerm && !apt.booking_resource_name?.toLowerCase().includes(clientAppointmentSearchTerm.toLowerCase())) {
                                      return false;
                                    }
                                    if (activeAppointmentTab === 'all') return true;
                                    
                                    const status = getAppointmentStatus(apt);
                                    if (activeAppointmentTab === 'completed') {
                                      return status === 'completed' || status === 'pending_notes';
                                    }
                                    return status === activeAppointmentTab;
                                  }).sort((a, b) => {
                                    // Sort appointments by date - for upcoming appointments, show soonest first
                                    const getAppointmentDate = (apt: any) => {
                                      if (apt.booking_date) {
                                        return new Date(apt.booking_date);
                                      }
                                      // Parse from session_timings format like "Wednesday, Feb 18, 2026 at 12:00 PM - 12:50 PM IST"
                                      const timeMatch = apt.session_timings?.match(/(\w+, \w+ \d+, \d+) at (\d+:\d+ [AP]M)/);
                                      if (timeMatch) {
                                        const [, dateStr, timeStr] = timeMatch;
                                        return new Date(`${dateStr} ${timeStr}`);
                                      }
                                      return new Date(0); // fallback to epoch if can't parse
                                    };

                                    const dateA = getAppointmentDate(a);
                                    const dateB = getAppointmentDate(b);

                                    // For upcoming appointments (scheduled), sort ascending (soonest first)
                                    if (activeAppointmentTab === 'scheduled') {
                                      return dateA.getTime() - dateB.getTime();
                                    }
                                    
                                    // For other tabs, sort descending (most recent first)
                                    return dateB.getTime() - dateA.getTime();
                                  }).map((apt, index) => (
                                    <React.Fragment key={index}>
                                      <tr
                                        className={`border-b cursor-pointer transition-colors ${selectedAppointmentIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                                          }`}
                                        onClick={() => setSelectedAppointmentIndex(selectedAppointmentIndex === index ? null : index)}
                                      >
                                        <td className="px-4 py-3 text-sm">Individual Therapy Session</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{apt.session_timings}</td>
                                        <td className="px-4 py-3 text-sm text-gray-600">{user.full_name || user.username}</td>
                                        <td className="px-4 py-3 text-sm">
                                          <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${getAppointmentStatus(apt) === 'completed' ? 'bg-green-100 text-green-700' :
                                            getAppointmentStatus(apt) === 'cancelled' ? 'bg-red-100 text-red-700' :
                                              getAppointmentStatus(apt) === 'no_show' ? 'bg-orange-100 text-orange-700' :
                                                getAppointmentStatus(apt) === 'pending_notes' ? 'bg-yellow-100 text-yellow-700' :
                                                  'bg-blue-100 text-blue-700'
                                            }`}>
                                            {getAppointmentStatus(apt) === 'pending_notes' ? 'Pending Notes' :
                                              getAppointmentStatus(apt) === 'no_show' ? 'No Show' :
                                                getAppointmentStatus(apt) === 'scheduled' ? 'Scheduled' :
                                                  getAppointmentStatus(apt).charAt(0).toUpperCase() + getAppointmentStatus(apt).slice(1)}
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
                                                <Copy size={16} />
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
                                                <Send size={16} />
                                                Send Manual Reminder to Client
                                              </button>
                                              <button
                                                onClick={() => handleSOSClickFromClient(apt)}
                                                disabled={apt.booking_status === 'cancelled'}
                                                className={`px-6 py-2 rounded-lg text-sm flex items-center gap-2 ${apt.booking_status === 'cancelled'
                                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                                  : 'border border-red-600 text-red-600 hover:bg-white'
                                                  }`}
                                              >
                                                <span className="font-bold">SOS</span>
                                                Raise Ticket
                                              </button>
                                              <button
                                                onClick={() => handleViewSessionNotes(apt)}
                                                disabled={!apt.has_session_notes || apt.booking_status === 'cancelled'}
                                                className={`px-6 py-2 rounded-lg text-sm flex items-center gap-2 ${!apt.has_session_notes || apt.booking_status === 'cancelled'
                                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                                  : 'border border-blue-600 text-blue-600 hover:bg-white'
                                                  }`}
                                              >
                                                <FileText size={16} />
                                                View Session Notes
                                              </button>
                                              <button
                                                onClick={() => handleFillSessionNotes(apt)}
                                                disabled={apt.has_session_notes || apt.booking_status === 'cancelled' || !isMeetingStarted(apt)}
                                                className={`px-6 py-2 rounded-lg text-sm flex items-center gap-2 ${apt.has_session_notes || apt.booking_status === 'cancelled' || !isMeetingStarted(apt)
                                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                                  : 'border border-teal-600 text-teal-600 hover:bg-white'
                                                  }`}
                                              >
                                                <FileText size={16} />
                                                Fill Session Notes
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
                {clientViewTab === 'sessions' && (
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
                      clientId={selectedClient.client_phone}
                      onViewNote={(noteId, isFreeConsult = false) => {
                        setSelectedProgressNoteId(noteId);
                        setIsFreeConsultationNote(isFreeConsult);
                      }}
                      hasFreeConsultation={clientSessionType.hasFreeConsultation}
                    />
                  )
                )}

                {/* Case History Tab */}
                {clientViewTab === 'caseHistory' && (
                  clientSessionType.hasPaidSessions ? (
                    <CaseHistoryTab clientId={selectedClient.client_phone} />
                  ) : (
                    // Show free consultation notes when only free consultation exists
                    selectedProgressNoteId ? (
                      <FreeConsultationDetail
                        noteId={selectedProgressNoteId}
                        onBack={() => setSelectedProgressNoteId(null)}
                      />
                    ) : (
                      <div>
                        {/* Free Consultation Notes List */}
                        <FreeConsultationNotesList
                          clientId={selectedClient.client_phone}
                          onViewNote={(noteId) => setSelectedProgressNoteId(noteId)}
                        />
                      </div>
                    )
                  )
                )}

                {/* Documents Tab */}
                {clientViewTab === 'documents' && clientSessionType.hasPaidSessions && (
                  <GoalTrackingTab
                    clientId={selectedClient.client_phone}
                    clientName={selectedClient.client_name}
                  />
                )}
              </div>
            </div>
          </div>
        ) : activeView === 'clients' ? (
          renderMyClients()
        ) : activeView === 'appointments' ? (
          renderMyAppointments()
        ) : activeView === 'booking' && selectedBookingSession ? (
          <BookingPage
            session={selectedBookingSession}
            onBack={() => {
              setSelectedBookingSession(null);
              setActiveView('resources');
            }}
          />
        ) : activeView === 'resources' ? (
          <div className="flex flex-col h-full overflow-hidden relative">
            <div className="flex justify-between items-center p-4 bg-teal-50 border-b border-teal-100 flex-shrink-0">
              <div>
                <h3 className="font-bold text-teal-800">Google Calendar Connection</h3>
                <p className="text-sm text-teal-700">
                  {user.google_calendar_connected 
                    ? 'Your Google Calendar is connected. Availabilities will be synced.' 
                    : 'Your Google Calendar is not connected. Please connect to sync availabilities.'}
                </p>
              </div>
              <a
                href={user.google_calendar_connected ? undefined : `/api/auth/google?therapistId=${user.therapist_id}`}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  user.google_calendar_connected 
                    ? 'bg-gray-100 text-gray-500 cursor-default' 
                    : 'bg-teal-600 text-white hover:bg-teal-700'
                }`}
              >
                {user.google_calendar_connected ? 'Connected' : 'Connect Calendar'}
              </a>
            </div>
            <div className="flex-1 overflow-auto">
              {selectedEditEvent ? (
                <EditEvent
                  event={selectedEditEvent}
                  therapistId={user.therapist_id}
                  services={dbServices.length > 0 ? dbServices : (therapistData[user.full_name]?.services || [])}
                  onBack={() => {
                    setSelectedEditEvent(null);
                    setActiveView('dashboard');
                  }}
                  onSave={(updated) => {
                    console.log('Event Saved:', updated);
                    setSelectedEditEvent(null);
                    setActiveView('dashboard');
                    setToast({ message: 'Event settings updated successfully!', type: 'success' });
                  }}
                />
              ) : (
                <div className="p-8 text-center text-gray-500">No availability configured for this account.</div>
              )}
            </div>
          </div>
        ) : activeView === 'notifications' ? (
          <Notifications userRole="therapist" userId={user.id} />
        ) : activeView === 'settings' ? (
          <EditProfile user={user} onBack={() => setActiveView('dashboard')} />
        ) : activeView === 'changePassword' ? (
          <ChangePassword user={user} onBack={() => setActiveView('dashboard')} />
        ) : showCalendarView ? (
          <div className="p-8">
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={() => setShowCalendarView(false)}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
              >
                <span className="text-2xl">←</span>
              </button>
              <h1 className="text-3xl font-bold">My Calendar</h1>
            </div>

            <div className="mb-6 space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-gray-700 mr-4">Session Mode:</h4>
                <div className="flex gap-2">
                  {[
                    { value: 'all', label: 'All Sessions' },
                    { value: 'online', label: 'Online' },
                    { value: 'in-person', label: 'In-Person' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setCalendarModeFilter(option.value as any)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${calendarModeFilter === option.value
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
                        }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-gray-700 mr-4">Status:</h4>
                <div className="flex gap-2">
                  {[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'upcoming', label: 'Upcoming' },
                    { value: 'cancelled', label: 'Cancelled' },
                    { value: 'completed', label: 'Completed' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setCalendarStatusFilter(option.value as any)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${calendarStatusFilter === option.value
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
                        }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ height: 'calc(100vh - 200px)' }}>
              <TherapistCalendar
                therapists={[{ name: user.full_name || user.username, therapist_id: user.id }]}
                selectedTherapistFilters={[user.full_name?.split(' ')[0] || user.username]}
                selectedModeFilter={calendarModeFilter}
                statusFilter={calendarStatusFilter}
                therapistId={user.id}
              />
            </div>
          </div>
        ) : (
          <div className="p-8">
            {dashboardLoading ? (
              <Loader />
            ) : (
              <>
                {/* Header */}
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-4">
                    <div>
                      <h1 className="text-3xl font-bold mb-1">Therapist Dashboard</h1>
                      <p className="text-gray-600">Welcome Back, {user.name || user.full_name || user.username}!</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <NotificationBell
                      userId={user?.id}
                      userRole="therapist"
                      onViewAll={() => setActiveView('notifications')}
                    />
                    <button
                      onClick={() => setShowCalendarView(!showCalendarView)}
                      className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                    >
                      <CalendarIcon size={16} />
                      My Calendar
                    </button>
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-white text-sm font-medium"
                        style={{ backgroundColor: '#21615D', minWidth: 160 }}
                      >
                        <PieChart size={16} />
                        <span style={{ flex: 1, textAlign: 'left' }}>{selectedMonth}</span>
                        {isDateDropdownOpen ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>
                      {isDateDropdownOpen && (
                        <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-10">
                          {!showCustomCalendar ? (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedMonth('All Time');
                                  setDateRange({ start: '', end: '' });
                                  setIsDateDropdownOpen(false);
                                }}
                                className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100 border-b"
                              >
                                All Time
                              </button>
                              <button
                                onClick={() => setShowCustomCalendar(true)}
                                className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100 border-b"
                              >
                                Custom Dates
                              </button>
                              {monthOptions.map((month) => (
                                <button
                                  key={month}
                                  onClick={() => handleMonthSelect(month)}
                                  className="w-full px-4 py-2 text-center text-sm hover:bg-gray-100"
                                >
                                  {month}
                                </button>
                              ))}
                            </>
                          ) : (
                            <div className="p-4">
                              <div className="mb-3">
                                <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                                <input
                                  type="date"
                                  value={startDate}
                                  onChange={(e) => setStartDate(e.target.value)}
                                  className="w-full px-3 py-2 border rounded text-sm"
                                />
                              </div>
                              <div className="mb-3">
                                <label className="block text-xs text-gray-600 mb-1">End Date</label>
                                <input
                                  type="date"
                                  value={endDate}
                                  onChange={(e) => setEndDate(e.target.value)}
                                  className="w-full px-3 py-2 border rounded text-sm"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setShowCustomCalendar(false)}
                                  className="flex-1 px-3 py-2 border rounded text-sm hover:bg-gray-100"
                                >
                                  Back
                                </button>
                                <button
                                  onClick={handleCustomDateApply}
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
                </div>

                {/* Stats Grid - Row 1 */}
                {isProfileUnderReview && <ProfileUnderReviewBanner />}

                <div className="grid grid-cols-4 gap-4 mb-4">
                  {stats.slice(0, 4).map((stat, index) => (
                    <div
                      key={index}
                      className={`bg-white rounded-lg p-6 border ${stat.clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                        }`}
                      onClick={() => {
                        if (stat.clickable) {
                          resetAllStates();
                          setActiveView(stat.targetView);
                          if (stat.targetTab) {
                            setActiveAppointmentTab(stat.targetTab);
                          }
                        }
                      }}
                    >
                      <div className="text-sm text-gray-600 mb-2">{stat.title}</div>
                      <CountUpNumber value={stat.value} className="text-3xl font-bold" />
                    </div>
                  ))}
                </div>

                {/* Stats Grid - Row 2 */}
                <div className="grid grid-cols-4 gap-4 mb-8">
                  {stats.slice(4).map((stat, index) => (
                    <div
                      key={index + 4}
                      className={`bg-white rounded-lg p-6 border ${stat.clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                        }`}
                      onClick={() => {
                        if (stat.clickable) {
                          resetAllStates();
                          setActiveView(stat.targetView);
                          if (stat.targetTab) {
                            setActiveAppointmentTab(stat.targetTab);
                          }
                        }
                      }}
                    >
                      <div className="text-sm text-gray-600 mb-2">{stat.title}</div>
                      <CountUpNumber value={stat.value} className="text-3xl font-bold" />
                    </div>
                  ))}
                  <div
                    className="bg-white rounded-lg p-6 border cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      resetAllStates();
                      setClientStatusFilter('active');
                      setActiveView('clients');
                    }}
                  >
                    <div className="text-sm text-gray-600 mb-2">Active Clients</div>
                    <CountUpNumber
                      value={clients.filter(client => getClientStatus(client) === 'active').length}
                      className="text-3xl font-bold"
                    />
                  </div>
                  <div
                    className="bg-white rounded-lg p-6 border cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      resetAllStates();
                      setClientStatusFilter('inactive');
                      setActiveView('clients');
                    }}
                  >
                    <div className="text-sm text-gray-600 mb-2">Inactive Clients</div>
                    <CountUpNumber
                      value={clients.filter(client => getClientStatus(client) === 'inactive').length}
                      className="text-3xl font-bold"
                    />
                  </div>
                  <div
                    className="bg-white rounded-lg p-6 border cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      resetAllStates();
                      setClientStatusFilter('drop-out');
                      setActiveView('clients');
                    }}
                  >
                    <div className="text-sm text-gray-600 mb-2">Drop-Outs</div>
                    <CountUpNumber
                      value={clients.filter(client => getClientStatus(client) === 'drop-out').length}
                      className="text-3xl font-bold"
                    />
                  </div>
                </div>

                {/* Upcoming Sessions */}
                <div className="bg-white rounded-lg border">
                  <div className="p-6 border-b">
                    <h2 className="text-xl font-bold">Upcoming Sessions</h2>
                  </div>

                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full" ref={bookingActionsRef}>
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Therapy Type</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Timings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookings.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-6 py-20 text-center text-gray-400">
                              No upcoming sessions
                            </td>
                          </tr>
                        ) : (
                          bookings.map((booking, index) => (
                            <React.Fragment key={index}>
                              <tr
                                className={`border-b cursor-pointer transition-colors ${selectedBookingIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                                  }`}
                                onClick={() => setSelectedBookingIndex(selectedBookingIndex === index ? null : index)}
                              >
                                <td className="px-6 py-4">
                                  <span
                                    className="text-teal-700 hover:underline cursor-pointer"
                                    onClick={() => handleViewClientFromBooking(booking)}
                                  >
                                    {formatClientName(booking.client_name)}
                                  </span>
                                </td>
                                <td className="px-6 py-4">{booking.therapy_type}</td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span>{formatMode(booking.mode)}</span>
                                    {(booking.mode === 'Online' || booking.mode === 'Online Video Call' || booking.mode?.toLowerCase().includes('google') || booking.mode?.toLowerCase().includes('meet')) && booking.booking_joining_link && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.open(booking.booking_joining_link, '_blank');
                                        }}
                                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center gap-1"
                                        title="Open Google Meet Link"
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                        Join Now
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4">{booking.session_timings}</td>
                              </tr>
                              {selectedBookingIndex === index && (
                                <tr className="bg-gray-100">
                                  <td colSpan={4} className="px-6 py-4">
                                    <div className="flex gap-3 justify-center">
                                      <button
                                        onClick={() => {
                                          handleReminderClick(booking);
                                          setSelectedBookingIndex(null);
                                        }}
                                        className="px-6 py-2 border border-gray-400 rounded-lg text-sm text-gray-700 hover:bg-white flex items-center gap-2"
                                      >
                                        <Send size={16} />
                                        Send Manual Reminder
                                      </button>
                                      <button
                                        onClick={() => {
                                          handleSOSClick(booking);
                                          setSelectedBookingIndex(null);
                                        }}
                                        className="px-6 py-2 border border-red-600 rounded-lg text-sm text-red-600 hover:bg-white flex items-center gap-2"
                                      >
                                        <span className="font-bold">SOS</span>
                                        Raise Ticket
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
                  <div className="px-6 py-4 border-t flex justify-between items-center">
                    <span className="text-sm text-gray-600">Showing {Math.min(10, bookings.length)} of {bookings.length} results</span>
                    <div className="flex gap-2">
                      <button className="p-2 border rounded hover:bg-gray-50">←</button>
                      <button className="p-2 border rounded hover:bg-gray-50">→</button>
                    </div>
                  </div>
                </div>

                {/* Pending Session Notes */}
                <div className="bg-white rounded-lg border mt-8">
                  <div className="p-6 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold">Pending Session Notes</h2>
                    {appointments.filter(apt => getAppointmentStatus(apt) === 'pending_notes').length > 3 && (
                      <button
                        onClick={() => {
                          setActiveView('appointments');
                          setActiveAppointmentTab('completed_sessions');
                        }}
                        className="text-sm text-teal-700 hover:text-teal-800 font-medium"
                      >
                        View More →
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full" ref={appointmentActionsRef}>
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client Name</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Therapy Type</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Timings</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                          <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appointments.filter(apt => getAppointmentStatus(apt) === 'pending_notes').length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-20 text-center text-gray-400">
                              No pending session notes
                            </td>
                          </tr>
                        ) : (
                          appointments
                            .filter(apt => getAppointmentStatus(apt) === 'pending_notes')
                            .slice(0, 3)
                            .map((appointment, index) => (
                              <React.Fragment key={index}>
                                <tr
                                  className={`border-b cursor-pointer transition-colors ${selectedAppointmentIndex === index ? 'bg-gray-100' : 'hover:bg-gray-50'
                                    }`}
                                  onClick={() => setSelectedAppointmentIndex(selectedAppointmentIndex === index ? null : index)}
                                >
                                  <td className="px-6 py-4">
                                    <span
                                      className="text-teal-700 hover:underline cursor-pointer"
                                      onClick={() => handleViewClientFromAppointment(appointment)}
                                    >
                                      {formatClientName(appointment.client_name)}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">{appointment.session_name}</td>
                                  <td className="px-6 py-4 text-sm">{appointment.session_timings}</td>
                                  <td className="px-6 py-4">
                                    {formatMode(appointment.mode)}
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-yellow-100 text-yellow-700">
                                      Pending Notes
                                    </span>
                                  </td>
                                </tr>
                                {selectedAppointmentIndex === index && (
                                  <tr className="bg-gray-100">
                                    <td colSpan={5} className="px-6 py-4">
                                      <div className="flex flex-wrap gap-2 justify-center">
                                        <button
                                          onClick={() => copyAppointmentDetails(appointment)}
                                          className="px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 border border-gray-400 text-gray-700 hover:bg-white"
                                        >
                                          <Copy size={13} />
                                          Copy to Clipboard
                                        </button>
                                        <button
                                          onClick={() => handleReminderClick(appointment)}
                                          disabled={isMeetingEnded(appointment) || appointment.booking_status === 'cancelled'}
                                          className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${isMeetingEnded(appointment) || appointment.booking_status === 'cancelled'
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                            : 'border border-gray-400 text-gray-700 hover:bg-white'
                                            }`}
                                        >
                                          <Send size={13} />
                                          Send Reminder
                                        </button>
                                        <button
                                          onClick={() => handleSOSClick(appointment)}
                                          disabled={appointment.booking_status === 'cancelled'}
                                          className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${appointment.booking_status === 'cancelled'
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                            : 'border border-red-600 text-red-600 hover:bg-white'
                                            }`}
                                        >
                                          <span className="font-bold">SOS</span>
                                          Raise Ticket
                                        </button>
                                        <button
                                          onClick={() => handleViewSessionNotes(appointment)}
                                          disabled={!appointment.has_session_notes || appointment.booking_status === 'cancelled'}
                                          className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${!appointment.has_session_notes || appointment.booking_status === 'cancelled'
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                            : 'border border-blue-600 text-blue-600 hover:bg-white'
                                            }`}
                                        >
                                          <FileText size={13} />
                                          View Session Notes
                                        </button>
                                        <button
                                          onClick={() => handleFillSessionNotes(appointment)}
                                          disabled={appointment.has_session_notes || appointment.booking_status === 'cancelled' || !isMeetingStarted(appointment)}
                                          className={`px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 ${appointment.has_session_notes || appointment.booking_status === 'cancelled' || !isMeetingStarted(appointment)
                                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed border border-gray-400'
                                            : 'border border-teal-600 text-teal-600 hover:bg-white'
                                            }`}
                                        >
                                          <FileText size={13} />
                                          Fill Session Notes
                                        </button>
                                        {appointment.client_rating ? (
                                          <span className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 bg-yellow-50 border border-yellow-200 text-yellow-700 whitespace-nowrap">
                                            ⭐ {appointment.client_rating}/5
                                          </span>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setFeedbackTarget(appointment);
                                              setShowFeedbackModal(true);
                                            }}
                                            className="px-3 py-1.5 rounded-lg text-xs flex items-center whitespace-nowrap gap-1.5 border border-teal-600 text-teal-600 hover:bg-white"
                                          >
                                            ⭐ Request Feedback
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
                </div>

              </>
            )}
          </div>
        )
        }
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

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

        {showSOSModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
              {/* Sticky Header */}
              <div className="p-6 border-b bg-white rounded-t-lg flex-shrink-0">
                <h3 className="text-2xl font-bold text-red-600 mb-2">SOS Risk Assessment</h3>
                <p className="text-gray-600 mb-4">You're raising an SOS for client safety. Please answer the following so we can support you and the client appropriately:</p>

                {selectedSOSBooking && (
                  <div className="bg-gray-50 p-3 rounded text-sm">
                    <p><strong>Client:</strong> {formatClientName(selectedSOSBooking.client_name)}</p>
                    <p><strong>Session:</strong> {selectedSOSBooking.session_name || selectedSOSBooking.therapy_type}</p>
                  </div>
                )}
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">

                {/* Section 1: Risk Severity */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-800">1. Risk Severity</h4>

                  {/* Progress Bar */}
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <button
                          key={level}
                          onClick={() => setSosRiskSeverity(level)}
                          className={`flex-1 h-8 rounded-lg border-2 transition-all ${sosRiskSeverity >= level
                            ? level === 1 ? 'bg-green-500 border-green-500'
                              : level === 2 ? 'bg-yellow-400 border-yellow-400'
                                : level === 3 ? 'bg-orange-400 border-orange-400'
                                  : level === 4 ? 'bg-red-500 border-red-500'
                                    : 'bg-red-700 border-red-700'
                            : 'bg-gray-100 border-gray-300 hover:border-gray-400'
                            }`}
                        >
                          <span className={`text-sm font-medium ${sosRiskSeverity >= level ? 'text-white' : 'text-gray-600'
                            }`}>
                            {level}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Level Labels */}
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>None</span>
                      <span>Low</span>
                      <span>Medium</span>
                      <span>High</span>
                      <span>Severe</span>
                    </div>

                    {/* Selected Level Description */}
                    {sosRiskSeverity > 0 && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm font-medium text-blue-800">
                          Level {sosRiskSeverity}: {
                            sosRiskSeverity === 1 ? 'None - no evidence of risk present'
                              : sosRiskSeverity === 2 ? 'Low - low or minor evidence of risk of harm to self or others'
                                : sosRiskSeverity === 3 ? 'Medium - moderate risk present'
                                  : sosRiskSeverity === 4 ? 'High - high or major risk of harm/injury to self or others'
                                    : 'Severe/catastrophic - immediate attention needed'
                          }
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 2: Current Risk Indicators */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-800">2. Current Risk Indicators</h4>
                  <div className="text-sm text-gray-600 mb-4 space-y-1">
                    <div><span className="font-bold">Y</span> - Yes, Risk Present</div>
                    <div><span className="font-bold">N</span> - No Risk Present</div>
                    <div><span className="font-bold">U</span> - Unknown</div>
                  </div>

                  <div className="space-y-4">
                    {[
                      { key: 'emotionalDysregulation', label: 'Severe emotional dysregulation' },
                      { key: 'physicalHarmIdeas', label: 'Physical harm to others or ideas of harming others' },
                      { key: 'drugAlcoholAbuse', label: 'Drug/Alcohol Abuse' },
                      { key: 'suicidalAttempt', label: 'Suicidal Attempt or plan to commit Suicide' },
                      { key: 'selfHarm', label: 'Deliberate Self Harm or ideas of self harm / suicidal ideation' },
                      { key: 'delusionsHallucinations', label: 'Delusions or hallucinations' },
                      { key: 'impulsiveness', label: 'Impulsiveness' },
                      { key: 'severeStress', label: 'Recent severe stress/life event' },
                      { key: 'socialIsolation', label: 'Social Isolation' },
                      { key: 'concernByOthers', label: 'Concern expressed by others (relatives, carers)' },
                      { key: 'other', label: 'Other (please specify)' }
                    ].map((item) => {
                      const selectedValue = sosRiskIndicators[item.key];
                      const bgColor = selectedValue === 'Y' ? 'bg-red-50' :
                        selectedValue === 'N' ? 'bg-green-50' :
                          selectedValue === 'U' ? 'bg-gray-100' : 'bg-gray-50';

                      return (
                        <div key={item.key} className={`border rounded-lg p-4 ${bgColor} transition-colors duration-200`}>
                          <div className="flex items-start justify-between">
                            <label className="text-sm font-medium text-gray-700 flex-1 mr-4">
                              {item.label}
                            </label>
                            <div className="flex space-x-4">
                              {['Y', 'N', 'U'].map((option) => (
                                <label key={option} className={`flex items-center space-x-1 ${item.key === 'other' && option === 'U' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                                  }`}>
                                  <input
                                    type="radio"
                                    name={item.key}
                                    value={option}
                                    checked={sosRiskIndicators[item.key] === option}
                                    disabled={item.key === 'other' && option === 'U'}
                                    onChange={(e) => setSosRiskIndicators(prev => ({
                                      ...prev,
                                      [item.key]: e.target.value as 'Y' | 'N' | 'U'
                                    }))}
                                    className="text-red-600 focus:ring-red-500"
                                  />
                                  <span className="text-sm font-medium text-gray-700">{option}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Other details input */}
                          {item.key === 'other' && sosRiskIndicators.other === 'Y' && (
                            <div className="mt-3">
                              <input
                                type="text"
                                value={sosOtherDetails}
                                onChange={(e) => setSosOtherDetails(e.target.value)}
                                placeholder="Please specify other risk factors..."
                                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 3: Risk Summary */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-800">3. Risk Summary</h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Give brief details of risks identified and any protective factors and what risk remains:
                    </label>
                    <textarea
                      value={sosRiskSummary}
                      onChange={(e) => setSosRiskSummary(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-1 focus:ring-red-300 focus:border-red-300"
                      placeholder="Provide detailed risk assessment summary..."
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Sticky Footer */}
              <div className="p-6 border-t bg-white rounded-b-lg flex-shrink-0">
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowSOSModal(false);
                      setSosConfirmText('');
                      setSelectedSOSBooking(null);
                      // Reset form
                      setSosRiskSeverity(0);
                      setSosRiskIndicators({
                        emotionalDysregulation: '',
                        physicalHarmIdeas: '',
                        drugAlcoholAbuse: '',
                        suicidalAttempt: '',
                        selfHarm: '',
                        delusionsHallucinations: '',
                        impulsiveness: '',
                        severeStress: '',
                        socialIsolation: '',
                        concernByOthers: '',
                        other: ''
                      });
                      setSosOtherDetails('');
                      setSosRiskSummary('');
                    }}
                    className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSOSConfirm}
                    disabled={
                      sosRiskSeverity === 0 ||
                      Object.values(sosRiskIndicators).some(val => val === '') ||
                      sosRiskSummary.trim() === '' ||
                      (sosRiskIndicators.other === 'Y' && sosOtherDetails.trim() === '')
                    }
                    className={`flex-1 px-4 py-2 rounded-lg ${sosRiskSeverity > 0 &&
                      Object.values(sosRiskIndicators).every(val => val !== '') &&
                      sosRiskSummary.trim() !== '' &&
                      (sosRiskIndicators.other !== 'Y' || sosOtherDetails.trim() !== '')
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                  >
                    Submit SOS Assessment
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Give Feedback Confirmation Modal */}
      {showFeedbackModal && feedbackTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-xl font-bold mb-4">Request Feedback</h3>
            <p className="text-gray-600 mb-6 font-medium">
              This will send a feedback reminder to <span className="text-teal-700">{formatClientName(feedbackTarget.client_name)}</span> asking them to rate their session. Would you like to proceed?
            </p>
            <div className="flex gap-3">
              <button 
                onClick={async () => {
                  setIsSendingFeedback(true);
                  try {
                    const webhookData = {
                      bookingId: feedbackTarget.booking_id,
                      clientName: feedbackTarget.client_name,
                      clientEmail: feedbackTarget.client_email || feedbackTarget.invitee_email,
                      clientPhone: feedbackTarget.client_phone || feedbackTarget.invitee_phone,
                      therapistName: user.full_name || user.username,
                      sessionName: feedbackTarget.session_name || feedbackTarget.therapy_type,
                      sessionDate: feedbackTarget.session_timings || feedbackTarget.booking_start_at
                    };
                    
                    const response = await fetch('/api/request-feedback', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(webhookData)
                    });

                    if (response.ok) {
                      setToast({ message: `Feedback request sent to ${formatClientName(feedbackTarget.client_name)} successfully!`, type: 'success' });
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

        {showReminderModal && selectedReminderAppointment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Sending Manual Reminder</h3>
              <p className="text-gray-600 mb-4">This will send a reminder message to {formatClientName(selectedReminderAppointment.client_name)} on Whatsapp</p>
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
                    setSelectedReminderAppointment(null);
                  }}
                  className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

      {showCalendarPopup && !user.google_calendar_connected && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-xl w-full max-w-md p-6 text-center shadow-2xl relative">
            <button 
              onClick={() => setShowCalendarPopup(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4 text-teal-700">
              <Calendar size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Connect Google Calendar</h3>
            <p className="text-gray-600 mb-6">
              Please connect your Google Calendar to sync your availability and manage sessions seamlessly.
            </p>
            <div className="flex flex-col gap-3">
              <a
                href={`/api/auth/google?therapistId=${user.therapist_id}`}
                className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
              >
                Connect Calendar Now
              </a>
              <button
                onClick={() => setShowCalendarPopup(false)}
                className="w-full py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Remind Me Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Google Calendar Connection Lightbox */}
      {showPostConnectLightbox && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-xl w-full max-w-md p-8 text-center shadow-2xl">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Calendar Connected! 🎉</h2>
            <p className="text-gray-600 mb-8">
              Your Google Calendar is now connected. Next, set your availability so clients can book sessions with you.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowPostConnectLightbox(false);
                  setActiveView('availability');
                }}
                className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Set Availability Now
              </button>
              <button
                onClick={() => setShowPostConnectLightbox(false)}
                className="w-full py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                I'll do this later
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-6">
              💡 Tip: Set your availability to start receiving client bookings
            </p>
          </div>
        </div>
      )}

        {/* Complete Profile Modal */}
        {showCompleteProfileModal && user.needsProfileCompletion && (
          <CompleteProfileModal
            onClose={() => {
              // User wants to logout instead of completing profile
              onLogout();
            }}
            onComplete={() => {
              setShowCompleteProfileModal(false);
              // Reload to update user state
              window.location.reload();
            }}
            prefilledData={user.profileData}
          />
        )}

        {/* Send Booking Link Modal */}
        <SendBookingModal
          isOpen={showBookingModal}
          onClose={() => {
            setShowBookingModal(false);
            setSelectedClientForBooking(null);
            setExpandedRows(new Set());
          }}
          prefilledClient={selectedClientForBooking}
        />

        {/* Bulk Send Booking Link Modal */}
        {showBulkSendModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold mb-4">Send Booking Links</h2>
              <p className="text-gray-600 mb-6">
                Are you sure you want to send session booking links to {selectedClients.size} selected client{selectedClients.size !== 1 ? 's' : ''}?
              </p>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={confirmBulkSendBookingLink}
                  disabled={isBulkSending}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isBulkSending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Sending...
                    </>
                  ) : (
                    'Confirm Send'
                  )}
                </button>
                <button
                  onClick={() => setShowBulkSendModal(false)}
                  disabled={isBulkSending}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {editingClient && (
        <EditClientContactModal
          isOpen={!!editingClient}
          client={{ name: editingClient.client_name, phone: editingClient.client_phone || '', email: editingClient.client_email || '', client_type: editingClient.client_type || 'Indian' }}
          onClose={() => setEditingClient(null)}
          onSaved={(updated) => {
            const updatedClient = {
              ...editingClient,
              client_name: updated.name,
              client_phone: updated.phone,
              client_email: updated.email,
              client_type: updated.client_type
            };
            setClients(prev => prev.map(c =>
              c.client_phone === editingClient.client_phone && c.client_email === editingClient.client_email
                ? updatedClient
                : c
            ));
            if (selectedClient && selectedClient.client_phone === editingClient.client_phone) {
              setSelectedClient(updatedClient);
            }
            setEditingClient(null);
          }}
          adminUser={user}
        />
      )}
    </div>
  );
};
