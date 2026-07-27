import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, UserCog, Calendar, CreditCard, LogOut, PieChart, MessageCircle, ChevronUp, ChevronDown, FileText, Bell, Copy, Send, Plus, User, Eye, AlertCircle, X, RefreshCw, Settings, FileWarning, LifeBuoy, UserPlus, Headphones, Headset } from 'lucide-react';
import { Logo } from './Logo';
import { AllClients } from './AllClients';
import { AllTherapists } from './AllTherapists';
import { Appointments } from './Appointments';
import { RefundsCancellations } from './RefundsCancellations';
import { useSocket } from '../context/SocketContext';
import { CreateBooking } from './CreateBooking';
import { AuditLogs } from './AuditLogs';
import { Notifications } from './Notifications';
import { TicketsPage } from './TicketsPage';
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

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
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
    { title: 'Sessions Completed', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
    { title: 'Cancelled', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
    { title: 'Refunds', value: '0', lastMonth: '0', clickable: true, targetView: 'refunds', targetTab: 'Pending' },
    { title: 'No Show', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
    { title: 'Free Consultations', value: '0', lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'free_consultation' },
  ]);
  const [dashboardMetrics, setDashboardMetrics] = useState<any>(null);
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

  // Formats raw datetime string as "(Mon), 30/06/2026 - 4:30PM"
  const formatSessionTiming = (timing: string | undefined | null) => {
    if (!timing) return 'N/A';
    const regex = /^(\w+),\s+([a-zA-Z]+)\s+(\d+)(?:st|nd|rd|th)?,\s+(\d+)\s+at\s+(.+?)\s+-/;
    const match = timing.match(regex);
    if (!match) return timing;
    
    const [ , dayFull, monthStr, dayNum, year, startTime ] = match;
    const dayShort = dayFull.substring(0, 3);
    const monthMap: Record<string, string> = {
      'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
      'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };
    const month = monthMap[monthStr] || '01';
    const paddedDay = dayNum.padStart(2, '0');
    const formattedStartTime = startTime.replace(/^0/, '').replace(/\s+/, '');
    
    return `(${dayShort}), ${paddedDay}/${month}/${year} - ${formattedStartTime}`;
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
      const response = await fetch('/api/send-whatsapp-reminder', {
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
              setProfilePictureUrl(profileData.data.profile_picture_url.replace('s3.fluidjobs.ai:9002', 's3.srv1169280.hstgr.cloud:443').replace('s3.fluidjobs.ai', 's3.srv1169280.hstgr.cloud'));
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
        { title: 'Sessions Completed', value: (statsData.sessionsCompleted || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'completed_sessions' },
        { title: 'Cancelled', value: (statsData.cancelled || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'cancelled' },
        { title: 'Refunds', value: (statsData.refunds || 0).toString(), lastMonth: '0', clickable: true, targetView: 'refunds', targetTab: 'Pending' },
        { title: 'No Show', value: (statsData.noShows || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'no_show' },
        { title: 'Free Consultations', value: (statsData.freeConsultations || 0).toString(), lastMonth: '0', clickable: true, targetView: 'appointments', targetTab: 'free_consultation' },
      ]);
      setDashboardMetrics(statsData);

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
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 bg-gray-50 border cursor-default"
          >
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-gray-700 font-medium">Live Sessions: {liveSessionsCount}</span>
          </div>
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
            style={{ backgroundColor: activeView === 'appointments' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/appointments');
            }}
          >
            <Calendar size={20} className={activeView === 'appointments' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'appointments' ? 'text-black' : 'text-gray-700'}>Booking</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'therapists' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/therapists');
            }}
          >
            <Users size={20} className={activeView === 'therapists' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'therapists' ? 'text-black' : 'text-gray-700'}>Therapists</span>
          </div>
          <div
            className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
            style={{ backgroundColor: activeView === 'clients' ? '#F4A9365C' : 'transparent' }}
            onClick={() => {
              resetAllStates();
              navigate('/admin/clients');
            }}
          >
            <UserPlus size={20} className={activeView === 'clients' ? 'text-black' : 'text-gray-700'} />
            <span className={activeView === 'clients' ? 'text-black' : 'text-gray-700'}>Clients</span>
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
          
          {user?.username !== 'Test' && (
            <div
              className="rounded-lg px-4 py-3 mb-2 flex items-center gap-3 cursor-pointer hover:bg-gray-100"
              style={{ backgroundColor: activeView === 'appSettings' ? '#F4A9365C' : 'transparent' }}
              onClick={() => {
                resetAllStates();
                navigate('/admin/appSettings');
              }}
            >
              <Settings size={20} className={activeView === 'appSettings' ? 'text-teal-700' : 'text-gray-700'} />
              <span className={activeView === 'appSettings' ? 'text-teal-700' : 'text-gray-700'}>Settings</span>
            </div>
          )}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative bg-gray-50">
        
        {/* Global Header */}
        <header className="bg-white border-b px-8 py-4 flex items-center justify-between z-10 sticky top-0 shadow-sm">
          <div className="flex-1"></div>
          <div className="flex items-center gap-4">
            {user?.username !== 'Test' && (
              <button
                className="flex items-center gap-2 rounded-lg px-4 py-2 hover:opacity-90 transition-colors shadow-sm"
                style={{ backgroundColor: '#21615D' }}
                onClick={() => {
                  resetAllStates();
                  navigate('/admin/new-session');
                }}
              >
                <Plus size={18} className="text-white" />
                <span className="text-sm font-medium text-white">New Session</span>
              </button>
            )}
            
            <button
              onClick={() => navigate('/admin/tickets')}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors relative"
              title="Tickets"
            >
              <Headset size={24} />
            </button>
            
            <NotificationBell
              userId={user?.id}
              userRole="admin"
              onViewAll={() => { resetAllStates(); navigate('/admin/notifications'); }}
            />

            <div className="relative">
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-lg transition-colors border ml-2"
              >
                <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-sm">
                  {user?.full_name?.charAt(0) || user?.username?.charAt(0) || 'A'}
                </div>
                <span className="text-sm font-medium text-gray-700 hidden sm:block">
                  {user?.full_name || user?.username}
                </span>
                <ChevronDown size={16} className="text-gray-500" />
              </button>

              {showProfileDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white border rounded-xl shadow-lg py-1 z-50">
                  <div className="px-4 py-2 border-b">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {user?.full_name || user?.username}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileDropdown(false);
                      navigate('/admin/edit-profile');
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-teal-700 transition-colors flex items-center gap-2"
                  >
                    <User size={16} />
                    Edit Profile
                  </button>
                  <button
                    onClick={() => {
                      setShowProfileDropdown(false);
                      setShowLogoutConfirm(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto relative p-0 m-0">
        <Routes>
          <Route path="appSettings/*" element={<SettingsPage onBack={() => navigate('/admin/dashboard')} user={user} />} />
          <Route path="edit-profile" element={<AdminEditProfile user={user} onBack={() => navigate('/admin/dashboard')} />} />
          {/* One merged booking flow. Cash/QR books outright; "Send Payment Link" holds the
              slot until Razorpay confirms or the link expires. The old Create landing page
              and its two separate entries are gone — these paths redirect so existing links
              and bookmarks keep working. */}
          <Route path="new-session" element={<CreateBooking onBack={() => navigate('/admin/dashboard')} />} />
          <Route path="create" element={<Navigate to="/admin/new-session" replace />} />
          <Route path="createBooking" element={<Navigate to="/admin/new-session" replace />} />
          <Route path="createBookingDirect" element={<Navigate to="/admin/new-session" replace />} />
          {/* Add Therapist now lives in Settings; keep the old path working as a redirect */}
          <Route path="newTherapist" element={<Navigate to="/admin/appSettings/new-therapist" replace />} />
          <Route path="clients" element={
            <AllClients onClientClick={(client) => {
              const tabParam = client.tab === 'nri' ? '&tab=nri' : '';
              const typeParam = client.client_type ? '&client_type=' + encodeURIComponent(client.client_type) : '';
              navigate('/admin/therapists?clientId=' + encodeURIComponent(client.invitee_email || client.invitee_phone) + '&source=clients' + tabParam + typeParam);
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
          <Route path="tickets" element={<TicketsPage />} />
          
          <Route path="dashboard" element={
            loading ? <Loader /> : (
              <div className="p-8">
                {/* Header */}
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
                  </div>
                  <div className="flex items-center gap-4">
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

            {/* Stats Rows */}
            {dashboardMetrics && user?.username !== 'Test' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Collection Card */}
                <div className="bg-white rounded-2xl border-2 border-teal-700/20 shadow-sm p-8 flex flex-col">
                  <div className="mb-8">
                    <h3 className="text-lg text-gray-700 mb-2 font-medium">Collection</h3>
                    <div className="text-4xl font-extrabold text-black tracking-tight">
                      ₹{Number(dashboardMetrics.revenue || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-6 mt-auto">
                    <div>
                      <div className="text-xl font-bold text-gray-500 mb-1">
                        - ₹{Number(dashboardMetrics.refundedAmount || 0).toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">Refunds</div>
                    </div>
                    <div className="pt-4 border-t border-gray-100">
                      <div className="text-xl font-bold text-gray-700 mb-1">
                        = ₹{Number((dashboardMetrics.revenue || 0) - (dashboardMetrics.refundedAmount || 0)).toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-gray-700 font-medium uppercase tracking-wider">Net Revenue</div>
                    </div>
                  </div>
                </div>

                {/* Bookings Card */}
                <div className="bg-white rounded-2xl border-2 border-teal-700/20 shadow-sm p-8 flex flex-col">
                  <div className="mb-8">
                    <h3 className="text-lg text-gray-700 mb-2 font-medium">Bookings</h3>
                    <div className="text-4xl font-extrabold text-black tracking-tight">
                      {Number(dashboardMetrics.bookings || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 mt-auto">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                      <div className="text-sm text-gray-600 font-medium">Cancellation</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.cancelled || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                      <div className="text-sm text-gray-600 font-medium">No Show</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.noShows || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-1">
                      <div className="text-sm text-gray-600 font-medium">Session Completed</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.sessionsCompleted || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Session Completed Card */}
                <div className="bg-white rounded-2xl border-2 border-teal-700/20 shadow-sm p-8 flex flex-col">
                  <div className="mb-8">
                    <h3 className="text-lg text-gray-700 mb-2 font-medium">Session Completed</h3>
                    <div className="text-4xl font-extrabold text-black tracking-tight">
                      {Number(dashboardMetrics.sessionsCompleted || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 mt-auto">
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                      <div className="text-sm text-gray-600 font-medium">Individual Therapy</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.individualTherapyCompleted || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                      <div className="text-sm text-gray-600 font-medium">Adolescent Therapy</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.adolescentTherapyCompleted || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className={`flex justify-between items-center ${Number(dashboardMetrics.otherTherapyCompleted || 0) > 0 ? 'border-b border-gray-100 pb-3' : 'pt-1'}`}>
                      <div className="text-sm text-gray-600 font-medium">Couples Therapy</div>
                      <div className="text-base font-bold text-gray-700">
                        {Number(dashboardMetrics.couplesTherapyCompleted || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                    {Number(dashboardMetrics.otherTherapyCompleted || 0) > 0 && (
                      <div className="flex justify-between items-center pt-1">
                        <div className="text-sm text-gray-600 font-medium">Other Therapy</div>
                        <div className="text-base font-bold text-gray-700">
                          {Number(dashboardMetrics.otherTherapyCompleted || 0).toLocaleString('en-IN')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}


          </div>
            )
          } />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </div>
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
                        const data = await res.json().catch(() => ({}));
                        if (data?.calendar_warning) {
                          setToast({ message: `Rescheduled, but note: ${data.calendar_warning}`, type: 'error' });
                        } else {
                          setToast({ message: 'Booking rescheduled successfully!', type: 'success' });
                        }
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

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
              <LogOut className="text-red-600" size={24} />
            </div>
            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">Confirm Logout</h3>
            <p className="text-center text-gray-500 mb-6">Are you sure you want to log out of your account?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  onLogout();
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
};
