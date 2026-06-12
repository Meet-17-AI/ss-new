import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, UserCog, Calendar, CreditCard, LogOut, PieChart, MessageCircle, ChevronUp, ChevronDown, FileText, Bell, Copy, Send, Plus, User, Eye, AlertCircle, X, RefreshCw, Settings, FileWarning } from 'lucide-react';
import { Logo } from './Logo';
import { AllClients } from './AllClients';
import { AllTherapists } from './AllTherapists';
import { Appointments } from './Appointments';
import { RefundsCancellations } from './RefundsCancellations';
import { useSocket } from '../context/SocketContext';
import { SendBookingModal } from './SendBookingModal';
import { CreateBooking } from './CreateBooking';
import { CreatePage } from './CreatePage';
import { NewTherapist } from './NewTherapist';
import { AuditLogs } from './AuditLogs';
import { Notifications } from './Notifications';
import { Loader } from './Loader';
import { Toast } from './Toast';
import { ChangePassword } from './ChangePassword';
import { AdminEditProfile } from './AdminEditProfile';
import { CountUpNumber } from './CountUpNumber';
import { ReportIssuePage } from './ReportIssuePage';
import SettingsPage from './SettingsPage';
import { TherapyCalendars } from './TherapyCalendars';
import { TherapyCalendarDetails } from './TherapyCalendarDetails';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';

interface DashboardProps {
  onLogout: () => void;
  user: any;
}

export const Dashboard: React.FC<DashboardProps> = ({ onLogout, user }) => {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const sourceParam = searchParams.get('source');
  const clientIdParam = searchParams.get('clientId');
  let activeView = location.pathname.split('/')[2] || 'dashboard';
  if (sourceParam && ['clients', 'appointments'].includes(sourceParam)) {
    activeView = sourceParam;
  }
  // A client profile is rendered through the /admin/therapists route (with a clientId
  // query param). While viewing a client, always highlight the "All Clients" sidebar item
  // regardless of where the navigation originated.
  if (clientIdParam) {
    activeView = 'clients';
  }
  
  // Keep tab states as local state since they were URL params but are now handled by component state or we can just use state
  const [appointmentTab, setAppointmentTab] = useState<string>('scheduled');
  const [refundTab, setRefundTab] = useState<string>('all_payments');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('googleAuth') === 'success') {
      const newUrl = window.location.pathname + window.location.search.replace(/[?&]googleAuth=success/, '').replace(/^&/, '?');
      window.history.replaceState({}, '', newUrl);
      navigate('/admin/appSettings/calendars');
      alert('Google Calendar connected successfully!');
    } else if (params.get('googleAuth') === 'error') {
      const reason = params.get('reason');
      const newUrl = window.location.pathname + window.location.search.replace(/[?&]googleAuth=error/, '').replace(/[?&]reason=[^&]*/, '').replace(/^&/, '?');
      window.history.replaceState({}, '', newUrl);
      navigate('/admin/appSettings/calendars');
      if (reason === 'already_linked') {
        alert('This email or calendar is connected to another therapist. Please connect a different Google Calendar.');
      } else {
        alert('Google Calendar connection failed.');
      }
    }
  }, [navigate]);

  // Local client view state removed in favor of URL params

  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('All Time');
  const [showCustomCalendar, setShowCustomCalendar] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [loading, setLoading] = useState(true);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

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
    { title: 'Revenue', value: '₹0', lastMonth: '₹0', clickable: false },
    { title: 'Refunded', value: '₹0', lastMonth: '₹0', clickable: false },
    { title: 'Bookings', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
    { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed' },
    { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
    { title: 'Refunds', value: '0', lastMonth: '0', clickable: true, targetView: 'refunds', targetTab: 'Pending' },
    { title: 'No Show', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
  ]);
  const [bookings, setBookings] = useState<any[]>([]);

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

  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalBookings, setTotalBookings] = useState(0);
  const bookingsPerPage = 3;
  const [notifications, setNotifications] = useState<any[]>([]);
  const [selectedBookingIndex, setSelectedBookingIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [liveSessionsCount, setLiveSessionsCount] = useState(0);
  const bookingActionsRef = React.useRef<HTMLTableElement>(null);
  const profileMenuRef = React.useRef<HTMLDivElement>(null);

  // Reschedule state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<any>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');
  const [rescheduleDuration, setRescheduleDuration] = useState(50);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleNotify, setRescheduleNotify] = useState(true);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // Cancel state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNotify, setCancelNotify] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);

  const resetAllStates = () => {
    setIsModalOpen(false);
    setIsDateDropdownOpen(false);
    setShowCustomCalendar(false);
    setSelectedBookingIndex(null);
  };

  const handleNextPage = () => {
    const totalPages = Math.ceil(totalBookings / bookingsPerPage);
    if (currentPage < totalPages) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      const startIndex = (nextPage - 1) * bookingsPerPage;
      const endIndex = startIndex + bookingsPerPage;
      setBookings(allBookings.slice(startIndex, endIndex));
      setSelectedBookingIndex(null);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prevPage = currentPage - 1;
      setCurrentPage(prevPage);
      const startIndex = (prevPage - 1) * bookingsPerPage;
      const endIndex = startIndex + bookingsPerPage;
      setBookings(allBookings.slice(startIndex, endIndex));
      setSelectedBookingIndex(null);
    }
  };

  const copyBookingDetails = (booking: any) => {
    const details = `${booking.therapy_type}\n${booking.booking_start_at}\nTime zone: Asia/Kolkata\n${formatMode(booking.mode)} joining info${booking.booking_joining_link ? `\nVideo call link: ${booking.booking_joining_link}` : ''}`;
    navigator.clipboard.writeText(details).then(() => {
      setToast({ message: 'Booking details copied to clipboard!', type: 'success' });
    }).catch(() => {
      setToast({ message: 'Failed to copy details', type: 'error' });
    });
  };

  const handleReminderClick = (booking: any) => {
    setSelectedBooking(booking);
    setShowReminderModal(true);
  };

  const sendWhatsAppNotification = async () => {
    if (!selectedBooking) return;
    const webhookData = {
      sessionTimings: selectedBooking.booking_start_at,
      sessionName: selectedBooking.therapy_type,
      clientName: selectedBooking.client_name,
      phone: selectedBooking.client_phone,
      email: selectedBooking.client_email,
      therapistName: selectedBooking.therapist_name,
      mode: selectedBooking.mode,
      meetingLink: selectedBooking.booking_joining_link || '',
      checkinUrl: selectedBooking.booking_checkin_url || ''
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
    setSelectedBooking(null);
  };

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
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  useEffect(() => {
    const fetchLiveCount = async () => {
      try {
        const response = await fetch('/api/live-sessions-count');
        if (response.ok) {
          const data = await response.json();
          setLiveSessionsCount(data.liveCount);
        }
      } catch (error) {
        console.error('Error fetching live sessions count:', error);
      }
    };

    fetchLiveCount();
  }, []);

  // Socket.io Real-time Updates
  useEffect(() => {
    if (!socket) return;

    const handleBookingUpdate = () => {
      console.log('[Socket] Booking updated, refreshing dashboard data...');
      fetchDashboardData();
    };

    socket.on('booking_updated', handleBookingUpdate);

    return () => {
      socket.off('booking_updated', handleBookingUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDateDropdownOpen(false);
        setShowCustomCalendar(false);
      }
      if (bookingActionsRef.current && !bookingActionsRef.current.contains(event.target as Node)) {
        setSelectedBookingIndex(null);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Fetch admin profile picture
      try {
        const profileRes = await fetch(`/api/admin-profile?user_id=${user.id}`);
        if (profileRes.ok) {
          const contentType = profileRes.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const profileData = await profileRes.json();
            if (profileData.success && profileData.data.profile_picture_url) {
              setProfilePictureUrl(profileData.data.profile_picture_url);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching profile picture:', error);
      }

      const statsUrl = dateRange.start && dateRange.end
        ? `/api/dashboard/stats?start=${dateRange.start}&end=${dateRange.end}`
        : '/api/dashboard/stats';
      const statsRes = await fetch(statsUrl);
      if (!statsRes.ok) throw new Error('Failed to fetch stats');
      const statsData = await statsRes.json();

      setStats([
        { title: 'Revenue', value: `₹${Number(statsData.revenue || 0).toLocaleString('en-IN')}`, lastMonth: '₹0', clickable: false },
        { title: 'Refunded', value: `₹${Number(statsData.refundedAmount || 0).toLocaleString('en-IN')}`, lastMonth: '₹0', clickable: false },
        { title: 'Bookings', value: (statsData.bookings || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'all' },
        { title: 'Sessions Completed', value: (statsData.sessionsCompleted || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed' },
        { title: 'Cancelled', value: (statsData.cancelled || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
        { title: 'Refunds', value: (statsData.refunds || 0).toString(), lastMonth: '0', clickable: true, targetView: 'refunds', targetTab: 'Pending' },
        { title: 'No Show', value: (statsData.noShows || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
      ]);

      // Fetch all bookings (with a high limit to get total count)
      const bookingsRes = await fetch(`/api/dashboard/bookings?limit=1000`);
      if (!bookingsRes.ok) throw new Error('Failed to fetch bookings');
      const bookingsData = await bookingsRes.json();
      setAllBookings(bookingsData);
      setTotalBookings(bookingsData.length);

      // Set initial page bookings
      setCurrentPage(1);
      setBookings(bookingsData.slice(0, bookingsPerPage));

      const notificationsRes = await fetch(`/api/notifications?user_id=${user?.id}&user_role=admin`);
      if (notificationsRes.ok) {
        const notificationsData = await notificationsRes.json();
        setNotifications(notificationsData.slice(0, 2));
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r flex flex-col">
        <div className="p-6 flex justify-center">
          <Logo size="small" />
        </div>

        <nav className="flex-1 px-4">
          {user?.username !== 'Test' && (
            <div
              className="rounded-xl px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:opacity-90"
              style={{ backgroundColor: '#21615D' }}
              onClick={() => {
                resetAllStates();
                navigate('/admin/create');
              }}
            >
              <Plus size={20} className="text-white" />
              <span className="text-white">Create</span>
            </div>
          )}
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer"
            style={{ backgroundColor: activeView === 'dashboard' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/dashboard');
            }}
          >
            <LayoutDashboard size={20} className={activeView === 'dashboard' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'dashboard' ? 'text-black' : 'text-gray-700'}>Dashboard</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'clients' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/clients');
            }}
          >
            <Users size={20} className={activeView === 'clients' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'clients' ? 'text-black' : 'text-gray-700'}>All Clients</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'therapists' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/therapists');
            }}
          >
            <UserCog size={20} className={activeView === 'therapists' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'therapists' ? 'text-black' : 'text-gray-700'}>All Therapists</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'appointments' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/appointments');
            }}
          >
            <Calendar size={20} className={activeView === 'appointments' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'appointments' ? 'text-black' : 'text-gray-700'}>Bookings</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'refunds' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/refunds');
            }}
          >
            <CreditCard size={20} className={activeView === 'refunds' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'refunds' ? 'text-black' : 'text-gray-700'}>Payments</span>
          </div>

          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'therapy-calendars' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/therapy-calendars');
            }}
          >
            <Calendar size={20} className={activeView === 'therapy-calendars' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'therapy-calendars' ? 'text-black' : 'text-gray-700'}>Therapy Calendars</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'notifications' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/notifications');
            }}
          >
            <Bell size={20} className={activeView === 'notifications' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'notifications' ? 'text-black' : 'text-gray-700'}>Notifications</span>
          </div>

        </nav>

        {user?.username !== 'Test' && (
          <div className="px-4 mb-4 pt-4 border-t">
            <div
              className="rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
              style={{ backgroundColor: activeView === 'appSettings' ? '#F4A9365C' : 'transparent' }}
              onClick={() => {
                resetAllStates();
                navigate('/admin/appSettings');
              }}
            >
              <Settings size={20} className={activeView === 'appSettings' ? 'text-teal-700' : 'text-gray-700'} />
              <span className={activeView === 'appSettings' ? 'text-teal-700' : 'text-gray-700'}>Settings</span>
            </div>
          </div>
        )}

        <div className="p-4 border-t relative" ref={profileMenuRef}>
          {/* Profile Dropdown Menu */}
          {showProfileMenu && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border rounded-lg shadow-lg z-50">
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  navigate('/admin/settings');
                }}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 border-b"
              >
                <User size={18} className="text-gray-600" />
                <span className="text-sm font-medium">Edit Profile</span>
              </button>
              <button
                onClick={() => {
                  setShowProfileMenu(false);
                  navigate('/admin/changePassword');
                }}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3"
              >
                <Eye size={18} className="text-gray-600" />
                <span className="text-sm font-medium">Change/Forgot Password</span>
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
              <div className="font-semibold text-sm">{user?.full_name || user?.username}</div>
              <div className="text-xs text-gray-600">Role: {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Admin'}</div>
            </div>
            <LogOut size={18} className="text-red-500 cursor-pointer" onClick={(e) => {
              e.stopPropagation();
              onLogout();
            }} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto relative">
        <Routes>
          <Route path="appSettings/*" element={<SettingsPage onBack={() => navigate('/admin/dashboard')} user={user} />} />
          <Route path="settings" element={<AdminEditProfile user={user} onBack={() => navigate('/admin/dashboard')} />} />
          <Route path="changePassword" element={<ChangePassword user={user} onBack={() => navigate('/admin/dashboard')} />} />
          <Route path="create" element={
            <CreatePage
              onCreateBooking={() => navigate('/admin/createBooking')}
              onCreateDirectBooking={() => navigate('/admin/createBookingDirect')}
              onSendBookingLink={() => setIsModalOpen(true)}
              onAddNewTherapist={() => navigate('/admin/newTherapist')}
            />
          } />
          <Route path="createBooking" element={<CreateBooking onBack={() => navigate('/admin/create')} />} />
          <Route path="createBookingDirect" element={<CreateBooking onBack={() => navigate('/admin/create')} isDirectBooking={true} />} />
          <Route path="newTherapist" element={<NewTherapist onBack={() => navigate('/admin/create')} />} />
          <Route path="clients" element={
            <AllClients onClientClick={(client) => {
              navigate('/admin/therapists?clientId=' + encodeURIComponent(client.invitee_email || client.invitee_phone) + '&source=clients');
            }} onCreateBooking={() => navigate('/admin/createBooking')} />
          } />
          <Route path="therapists" element={
            <AllTherapists />
          } />
          <Route path="appointments" element={
            <Appointments
              initialTab={appointmentTab}
              onClientClick={(client) => {
                navigate('/admin/therapists?clientId=' + encodeURIComponent(client.invitee_email || client.invitee_phone) + '&source=appointments');
              }}
              onCreateBooking={() => navigate('/admin/createBooking')}
            />
          } />
          <Route path="refunds" element={<RefundsCancellations initialTab={refundTab} />} />
          <Route path="therapy-calendars" element={<TherapyCalendars />} />
          <Route path="therapy-calendars/new" element={<TherapyCalendarDetails />} />
          <Route path="therapy-calendars/:id" element={<TherapyCalendarDetails />} />
          <Route path="notifications" element={<Notifications userRole="admin" userId={user?.id} />} />
          
          <Route path="dashboard" element={
            loading ? <Loader /> : (
              <div className="p-8">
                {/* Header */}
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
                    <p className="text-gray-600">Welcome Back, {user?.full_name || user?.username}!</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <NotificationBell
                      userId={user?.id}
                      userRole="admin"
                      onViewAll={() => { resetAllStates(); navigate('/admin/notifications'); }}
                    />
                    <button className="flex items-center gap-2 border rounded-lg px-4 py-2 bg-white hover:bg-gray-50">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="text-sm font-medium">Live Sessions: {liveSessionsCount}</span>
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
                          <div className="max-h-60 overflow-y-auto">
                            {monthOptions.map((month) => (
                              <button
                                key={month}
                                onClick={() => handleMonthSelect(month)}
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

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              {stats.filter(stat => !(user?.username === 'Test' && (stat.title === 'Revenue' || stat.title === 'Refunded'))).map((stat, index) => (
                <div
                  key={index}
                  className={`bg-white rounded-lg p-6 border ${stat.clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''
                    }`}
                  onClick={() => {
                    if (stat.clickable) {
                      resetAllStates();
                      navigate(`/admin/${stat.targetView}`);
                      if (stat.targetView === 'appointments' && stat.targetTab) {
                        setAppointmentTab(stat.targetTab);
                      } else if (stat.targetView === 'refunds' && stat.targetTab) {
                        setRefundTab(stat.targetTab);
                      }
                    }
                  }}
                >
                  <div className="text-sm text-gray-600 mb-2">{stat.title}</div>
                  <CountUpNumber
                    value={stat.value}
                    prefix={(stat.title.includes('Revenue') || stat.title.includes('Refunded')) ? '₹' : ''}
                    className="text-3xl font-bold"
                  />
                </div>
              ))}
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
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Assigned Therapist</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Timings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-20 text-center text-gray-400">
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
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/admin/therapists?clientId=' + encodeURIComponent(booking.client_email || booking.client_phone) + '&source=dashboard');
                                }}
                                className="text-teal-700 hover:underline font-medium"
                              >
                                {formatClientName(booking.client_name)}
                              </button>
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
                            <td className="px-6 py-4">{booking.therapist_name}</td>
                            <td className="px-6 py-4">{booking.booking_start_at}</td>
                          </tr>
                          {selectedBookingIndex === index && user?.username !== 'Test' && (
                            <tr className="bg-gray-100">
                              <td colSpan={5} className="px-6 py-4">
                                <div className="flex gap-2 justify-center items-center">
                                  <button
                                    onClick={() => copyBookingDetails(booking)}
                                    className="px-3 py-1.5 border border-gray-400 rounded-lg text-xs text-gray-700 hover:bg-white flex items-center gap-1.5 whitespace-nowrap"
                                  >
                                    <Copy size={13} />
                                    Copy Details
                                  </button>
                                  <button
                                    onClick={() => handleReminderClick(booking)}
                                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-gray-400 text-gray-700 hover:bg-white whitespace-nowrap"
                                  >
                                    <Send size={13} />
                                    Send Reminder
                                  </button>
                                  <button
                                    onClick={() => {
                                      setRescheduleTarget(booking);
                                      setRescheduleDateTime('');
                                      setRescheduleDuration(booking.duration || 50);
                                      setRescheduleReason('');
                                      setRescheduleNotify(true);
                                      setShowRescheduleModal(true);
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-teal-600 text-teal-700 bg-white hover:bg-teal-50 whitespace-nowrap"
                                  >
                                    <RefreshCw size={13} />
                                    Reschedule
                                  </button>
                                  <button
                                    onClick={() => {
                                      setCancelTarget(booking);
                                      setCancelReason('');
                                      setCancelNotify(true);
                                      setShowCancelModal(true);
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 border border-red-500 text-red-600 bg-white hover:bg-red-50 whitespace-nowrap"
                                  >
                                    <X size={13} />
                                    Cancel Booking
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
                <span className="text-sm text-gray-600">
                  Showing {((currentPage - 1) * bookingsPerPage) + 1}-{Math.min(currentPage * bookingsPerPage, totalBookings)} of {totalBookings} result{totalBookings !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={currentPage === 1}
                    className={`p-2 border rounded ${currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                  >
                    ←
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={currentPage >= Math.ceil(totalBookings / bookingsPerPage)}
                    className={`p-2 border rounded ${currentPage >= Math.ceil(totalBookings / bookingsPerPage) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
                  >
                    →
                  </button>
                </div>
              </div>
            </div>

          </div>
            )
          } />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </div>
      {isModalOpen && <SendBookingModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {showReminderModal && selectedBooking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Sending Manual Reminder</h3>
            <p className="text-gray-600 mb-4">This will send a reminder message to {formatClientName(selectedBooking.client_name)} on Whatsapp</p>
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
                  setSelectedBooking(null);
                }}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reschedule Booking Modal ──────────────────────────────────────────── */}
      {showRescheduleModal && rescheduleTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[9999]" onClick={() => setShowRescheduleModal(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start p-6 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Reschedule Booking</h3>
                <p className="text-sm text-gray-500 mt-1">You can reschedule the booking to a new date &amp; time.</p>
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
                  onClick={async () => {
                    if (!rescheduleDateTime || !rescheduleReason.trim()) {
                      setToast({ message: 'Please fill in all required fields', type: 'error' });
                      return;
                    }
                    setIsRescheduling(true);
                    try {
                      const res = await fetch('/api/reschedule-booking', {
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
                      if (res.ok) {
                        setToast({ message: 'Booking rescheduled successfully!', type: 'success' });
                        setShowRescheduleModal(false);
                        setRescheduleTarget(null);
                        setSelectedBookingIndex(null);
                        fetchDashboardData();
                      } else {
                        setToast({ message: 'Failed to reschedule booking', type: 'error' });
                      }
                    } catch {
                      setToast({ message: 'Failed to reschedule booking', type: 'error' });
                    }
                    setIsRescheduling(false);
                  }}
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
            <div className="flex justify-between items-start p-6 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Cancel Booking</h3>
                <p className="text-sm text-gray-500 mt-1">
                  You can enable or disable the cancellation policy to allow invitees to cancel their bookings if they can't attend.
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
                  onClick={async () => {
                    if (!cancelReason.trim()) {
                      setToast({ message: 'Please enter a reason for cancellation', type: 'error' });
                      return;
                    }
                    setIsCancelling(true);
                    try {
                      const res = await fetch('/api/cancel-booking', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          booking_id: cancelTarget.booking_id,
                          reason: cancelReason,
                          notify: cancelNotify
                        })
                      });
                      if (res.ok) {
                        setToast({ message: 'Booking cancelled successfully!', type: 'success' });
                        setShowCancelModal(false);
                        setCancelTarget(null);
                        setSelectedBookingIndex(null);
                        fetchDashboardData();
                      } else {
                        setToast({ message: 'Failed to cancel booking', type: 'error' });
                      }
                    } catch {
                      setToast({ message: 'Failed to cancel booking', type: 'error' });
                    }
                    setIsCancelling(false);
                  }}
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
