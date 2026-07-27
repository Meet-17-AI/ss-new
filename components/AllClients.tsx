import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Search, Download, ChevronDown, ChevronRight, ArrowRightLeft, Plus, Send, Pencil, Check } from 'lucide-react';
import * as XLSX from 'xlsx'
import { SendBookingModal } from './SendBookingModal';
import { TransferClientModal } from './TransferClientModal';
import { EditClientContactModal } from './EditClientContactModal';
import { Loader } from './Loader';
import { Toast } from './Toast';

interface Therapist {
  invitee_name: string;
  invitee_phone: string;
  booking_host_name: string;
  session_count: number;
}

interface Client {
  invitee_name: string;
  invitee_phone: string;
  invitee_email: string;
  booking_host_name: string;
  booking_resource_name?: string;
  booking_mode?: string;
  session_count: number;
  therapists: Therapist[];
  client_type?: string;
  latest_booking_date?: string;
  booking_link_sent_at?: string;
  last_session_date?: string;
}

export const AllClients: React.FC<{ onClientClick?: (client: any) => void; onCreateBooking?: () => void }> = ({ onClientClick, onCreateBooking }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [prefilledClientData, setPrefilledClientData] = useState<{ name: string; phone: string; email: string } | undefined>(undefined);
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Restore the tab from the URL so returning from a client profile
  // lands back on the tab (All / NRI) the user navigated from.
  const [urlParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'all' | 'nri'>(urlParams.get('tab') === 'nri' ? 'nri' : 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'drop-out'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showBookingLinkConfirmModal, setShowBookingLinkConfirmModal] = useState(false);
  const [selectedClientForBookingLink, setSelectedClientForBookingLink] = useState<Client | null>(null);
  const itemsPerPage = 10;
  const tableRef = useRef<HTMLDivElement>(null);
  const [adminUser] = useState(() => {
    const savedUser = localStorage.getItem('user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [showBulkBookingConfirmModal, setShowBulkBookingConfirmModal] = useState(false);
  const [isBulkSending, setIsBulkSending] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [rowEdits, setRowEdits] = useState<Record<string, { name: string; phone: string; email: string; saving: boolean }>>({});

  const formatClientName = (name: string): string => {
    if (!name) return name;
    return name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const formatSessionName = (sessionName: string | undefined, therapistName: string | undefined): string => {
    if (!sessionName) return 'N/A';

    // If session name already includes "Session with", return as is
    if (sessionName.toLowerCase().includes('session with')) {
      return sessionName;
    }

    // If we have a therapist name, append it
    if (therapistName) {
      const standardizedTherapist = standardizeTherapistName(therapistName);
      return `${sessionName} Session with ${standardizedTherapist}`;
    }

    return sessionName;
  };

  const standardizeTherapistName = (name: string | undefined): string => {
    if (!name) return '';

    // Standardize Ishika to Ishika Mahajan
    if (name.toLowerCase().trim() === 'ishika') {
      return 'Ishika Mahajan';
    }

    return name;
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

  const getClientStatus = (client: Client): 'active' | 'inactive' | 'drop-out' => {
    // If no appointments data, return inactive
    if (!appointments || appointments.length === 0) {
      return 'inactive';
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all client appointments (excluding cancelled)
    const clientAppointments = appointments.filter(apt => {
      const clientEmail = client.invitee_email?.toLowerCase().trim();
      const aptEmail = apt.invitee_email?.toLowerCase().trim();
      const clientPhone = client.invitee_phone?.replace(/[\s\-\(\)\+]/g, '');
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
      // Use booking_start_at_raw for date comparison (raw timestamp)
      const aptDate = apt.booking_start_at_raw ? new Date(apt.booking_start_at_raw) : new Date(apt.booking_start_at);
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

  useEffect(() => {
    Promise.all([
      fetch('/api/clients').then(res => res.json()),
      fetch('/api/appointments').then(res => res.json())
    ])
      .then(([clientsData, appointmentsData]) => {
        setClients(Array.isArray(clientsData) ? clientsData : []);
        setAppointments(Array.isArray(appointmentsData) ? appointmentsData : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('[AllClients] Error fetching data:', err);
        setLoading(false);
      });
  }, []);

  // Click outside to close expanded rows
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(event.target as Node)) {
        setExpandedRows(new Set());
      }
    };

    if (expandedRows.size > 0) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expandedRows]);

  const toggleRow = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const getUniqueIdentifier = (client: Client) => {
    return `${client.invitee_email || ''}-${client.invitee_phone || ''}`;
  };

  const getFilteredIdentifiers = () => {
    return new Set(filteredClients.map(c => getUniqueIdentifier(c)));
  };

  const toggleClientSelection = (identifier: string) => {
    const newSelected = new Set(selectedClients);
    if (newSelected.has(identifier)) {
      newSelected.delete(identifier);
    } else {
      newSelected.add(identifier);
    }
    setSelectedClients(newSelected);
  };

  const toggleSelectAll = () => {
    const allIdentifiers = getFilteredIdentifiers();
    if (selectedClients.size >= allIdentifiers.size && Array.from(allIdentifiers).every(id => selectedClients.has(id))) {
      setSelectedClients(new Set());
    } else {
      setSelectedClients(allIdentifiers);
    }
  };

  const formatBookingLinkDate = (dateString: string | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const formatPreTherapyDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    // Use UTC methods to avoid timezone differences between local and Vercel
    const day = date.getUTCDate();
    const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const year = date.getUTCFullYear();
    return `${day} ${month} ${year}`;
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A';

    // Handle the format: "Monday, Feb 9, 2026 at 1:00 PM - 1:50 PM (GMT+01:00)"
    // Extract just the date part before "at"
    const datePart = dateString.split(' at ')[0];

    // Parse the date
    const date = new Date(datePart);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'N/A';
    }

    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const filteredClients = clients.filter(client => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      (client.invitee_name || '').toLowerCase().includes(query) ||
      (client.invitee_phone || '').toLowerCase().includes(query) ||
      (client.invitee_email || '').toLowerCase().includes(query) ||
      (client.booking_host_name || '').toLowerCase().includes(query)
    );
    if (!matchesSearch) return false;

    if (activeTab === 'nri' && client.client_type !== 'NRI') {
      return false;
    }

    if (statusFilter !== 'all') {
      if (client.session_count === 0) return false;
      return getClientStatus(client) === statusFilter;
    }

    return true;
  });

  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedClients = filteredClients.slice(startIndex, startIndex + itemsPerPage);

  const exportToCSV = () => {
    const headers = ['Client Name', 'Phone No.', 'Email ID', 'No. of Bookings', 'Session Name', 'Assigned Therapist', 'Last Session Booked', 'Status'];
    const rows = filteredClients.map(client => {
      const isLead = client.session_count === 0;
      return [
        formatClientName(client.invitee_name),
        client.invitee_phone,
        client.invitee_email,
        client.session_count,
        formatSessionName(client.booking_resource_name, client.booking_host_name),
        standardizeTherapistName(client.booking_host_name),
        isLead ? formatBookingLinkDate(client.booking_link_sent_at) : formatDate(client.last_session_date),
        getClientStatus(client)
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clients')
    XLSX.writeFile(wb, `clients_export_${new Date().toISOString().split('T')[0]}.xlsx`)
  };

  const handleTransferClick = (client: Client) => {
    if (isTransferDisabled(client)) {
      return;
    }

    const actualTherapist = client.therapists && client.therapists.length > 0
      ? client.therapists[0].booking_host_name
      : client.booking_host_name;
    setSelectedClient({ ...client, booking_host_name: actualTherapist });
    setIsTransferModalOpen(true);
  };

  const isTransferDisabled = (client: Client) => {
    if (client.latest_booking_date) {
      return new Date(client.latest_booking_date) > new Date();
    }
    return false;
  };

  const handleSendBookingLink = async (client: Client) => {
    // Show confirmation modal instead of sending directly
    setSelectedClientForBookingLink(client);
    setShowBookingLinkConfirmModal(true);
  };

  const confirmSendBookingLink = async () => {
    if (!selectedClientForBookingLink) return;

    const client = selectedClientForBookingLink;

    try {
      // Get the most recent therapy type for this client
      let therapyType = 'Individual Therapy';
      try {
        const response = await fetch(`/api/client-therapy-type?email=${encodeURIComponent(client.invitee_email)}&phone=${encodeURIComponent(client.invitee_phone)}`);
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
        therapistName: isFreeConsultation ? 'Safestories' : (client.booking_host_name || 'Unknown'),
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

    // Close modal
    setShowBookingLinkConfirmModal(false);
    setSelectedClientForBookingLink(null);
  };

  const confirmBulkSendBookingLink = async () => {
    if (selectedClients.size === 0) return;
    setIsBulkSending(true);

    const selectedIdentifiers = Array.from(selectedClients);
    const selectedClientObjects = clients.filter(c => selectedIdentifiers.includes(getUniqueIdentifier(c)));

    let successCount = 0;
    let errorCount = 0;

    // Helper to send a single link
    const sendLink = async (client: Client) => {
      try {
        let therapyType = 'Individual Therapy';
        const typeRes = await fetch(`/api/client-therapy-type?email=${encodeURIComponent(client.invitee_email)}&phone=${encodeURIComponent(client.invitee_phone)}`);
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
          clientName: client.invitee_name,
          email: client.invitee_email,
          phone: client.invitee_phone,
          therapistName: isFreeConsultation ? 'Safestories' : (client.booking_host_name || 'Unknown'),
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
    setShowBulkBookingConfirmModal(false);
    setSelectedClients(new Set());
  };

  const handleTransferSuccess = () => {
    fetch('/api/clients')
      .then(res => res.json())
      .then(data => {
        setClients(data);
      });
  };

  const handleAssignTherapist = (client: Client) => {
    setPrefilledClientData({
      name: client.invitee_name,
      phone: client.invitee_phone,
      email: client.invitee_email
    });
    setIsModalOpen(true);
  };

  const getClientKey = (c: Client) => `${c.invitee_phone}||${c.invitee_email}`;

  const toggleEditMode = () => {
    if (isEditMode) {
      setRowEdits({});
    } else {
      const edits: Record<string, { name: string; phone: string; email: string; saving: boolean }> = {};
      clients.forEach(c => {
        edits[getClientKey(c)] = { name: c.invitee_name, phone: c.invitee_phone, email: c.invitee_email, saving: false };
      });
      setRowEdits(edits);
    }
    setIsEditMode(prev => !prev);
  };

  const saveRow = async (client: Client) => {
    const key = getClientKey(client);
    const edit = rowEdits[key];
    if (!edit) return;
    setRowEdits(prev => ({ ...prev, [key]: { ...prev[key], saving: true } }));
    try {
      const res = await fetch('/api/clients/update-contact', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_phone: client.invitee_phone || undefined,
          old_email: client.invitee_email || undefined,
          new_name: edit.name !== client.invitee_name ? edit.name : undefined,
          new_phone: edit.phone !== client.invitee_phone ? edit.phone : undefined,
          new_email: edit.email !== client.invitee_email ? edit.email : undefined,
          _audit_user: { id: adminUser?.id, name: adminUser?.full_name || adminUser?.username || 'Admin' }
        })
      });
      if (res.ok) {
        const refreshed = await fetch('/api/clients').then(r => r.json());
        if (Array.isArray(refreshed)) setClients(refreshed);
        setToast({ message: 'Client info updated successfully!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save', type: 'error' });
      }
    } catch {
      setToast({ message: 'Network error', type: 'error' });
    } finally {
      setRowEdits(prev => ({ ...prev, [key]: { ...prev[key], saving: false } }));
    }
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">All Clients</h1>
        </div>
        <button
          onClick={toggleEditMode}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            isEditMode ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-teal-700 text-white hover:bg-teal-800'
          }`}
        >
          <Pencil size={16} />
          {isEditMode ? 'Exit Edit Mode' : 'Edit Mode'}
        </button>
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

      {/* Search Bar */}
      <div className="relative mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search users by name, phone no, email id or therapist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          onClick={exportToCSV}
          className="bg-teal-700 text-white px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-teal-800 whitespace-nowrap text-sm"
        >
          <Download size={16} />
          Export Excel
        </button>
        {selectedClients.size > 0 && (
          <button
            onClick={() => setShowBulkBookingConfirmModal(true)}
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
              setStatusFilter('all');
              setCurrentPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${statusFilter === 'all'
                ? 'bg-gray-800 text-white ring-2 ring-gray-400'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
          >
            All
          </button>
          <button
            onClick={() => {
              setStatusFilter('active');
              setCurrentPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${statusFilter === 'active' ? 'ring-2 ring-teal-800' : ''
              }`}
            style={{ backgroundColor: '#21615D' }}
          >
            Active
          </button>
          <button
            onClick={() => {
              setStatusFilter('inactive');
              setCurrentPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${statusFilter === 'inactive' ? 'ring-2 ring-gray-500' : ''
              }`}
            style={{ backgroundColor: '#9CA3AF' }}
          >
            Inactive
          </button>
          <button
            onClick={() => {
              setStatusFilter('drop-out');
              setCurrentPage(1);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium text-white transition-all ${statusFilter === 'drop-out' ? 'ring-2 ring-red-800' : ''
              }`}
            style={{ backgroundColor: '#B91C1C' }}
          >
            Drop-out
          </button>
        </div>

      {/* Clients Table */}
      {loading ? (
        <Loader />
      ) : (
        <div className="bg-white rounded-lg border flex-1 flex flex-col" ref={tableRef}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={filteredClients.length > 0 && Array.from(getFilteredIdentifiers()).every(id => selectedClients.has(id))}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-gray-300 focus:ring-[#21615D]"
                      style={{ accentColor: '#21615D' }}
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600" style={isEditMode ? { minWidth: 160 } : {}}>Client Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600" style={isEditMode ? { minWidth: 220 } : {}}>Contact Info</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">No. of Bookings</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Session Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Mode</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Assigned Therapist</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Last Session Booked</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center text-gray-400 py-8">Loading...</td>
                  </tr>
                ) : filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-gray-400 py-8">No clients found</td>
                  </tr>
                ) : (
                  paginatedClients.map((client, index) => {
                    const isLead = client.session_count === 0;
                    return (
                      <React.Fragment key={index}>
                        <tr
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleRow(index)}
                        >
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedClients.has(getUniqueIdentifier(client))}
                                onChange={() => toggleClientSelection(getUniqueIdentifier(client))}
                                className="w-4 h-4 rounded border-gray-300 focus:ring-[#21615D]"
                                style={{ accentColor: '#21615D' }}
                              />
                          </td>
                          <td className={`px-6 py-4 text-sm ${isEditMode ? '' : 'whitespace-nowrap'}`} style={isEditMode ? { minWidth: 160 } : {}}>
                            {isEditMode ? (
                              <input
                                type="text"
                                value={rowEdits[getClientKey(client)]?.name ?? client.invitee_name}
                                onChange={e => setRowEdits(prev => ({ ...prev, [getClientKey(client)]: { ...prev[getClientKey(client)], name: e.target.value } }))}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                onClick={e => e.stopPropagation()}
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (onClientClick) {
                                        onClientClick({
                                          invitee_name: client.invitee_name,
                                          invitee_email: client.invitee_email,
                                          invitee_phone: client.invitee_phone,
                                          client_type: client.client_type,
                                          tab: activeTab
                                        });
                                      }
                                    }}
                                    className="text-teal-700 hover:underline font-medium"
                                  >
                                    {formatClientName(client.invitee_name)}
                                  </button>
                                </span>
                                {client.client_type === 'NRI' ? (
                                  <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded border border-purple-200">
                                    NRI
                                  </span>
                                ) : (
                                  <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded border border-blue-200">
                                    Indian
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm" style={isEditMode ? { minWidth: 220 } : {}}>
                            {isEditMode ? (
                              <div className="flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                                <input
                                  type="tel"
                                  value={rowEdits[getClientKey(client)]?.phone ?? client.invitee_phone}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [getClientKey(client)]: { ...prev[getClientKey(client)], phone: e.target.value } }))}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                  placeholder="Phone"
                                />
                                <input
                                  type="email"
                                  value={rowEdits[getClientKey(client)]?.email ?? client.invitee_email}
                                  onChange={e => setRowEdits(prev => ({ ...prev, [getClientKey(client)]: { ...prev[getClientKey(client)], email: e.target.value } }))}
                                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                  placeholder="Email"
                                />
                                <button
                                  onClick={e => { e.stopPropagation(); saveRow(client); }}
                                  disabled={rowEdits[getClientKey(client)]?.saving}
                                  className="flex items-center gap-1 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg hover:bg-teal-100 disabled:opacity-50 w-fit"
                                >
                                  <Check size={13} />
                                  {rowEdits[getClientKey(client)]?.saving ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            ) : (
                              <>
                                <div>{client.invitee_phone}</div>
                                <div className="text-gray-500 text-xs">{client.invitee_email}</div>
                              </>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm">{client.session_count}</td>
                              <td className="px-6 py-4 text-sm">{formatSessionName(client.booking_resource_name, client.booking_host_name)}</td>
                              <td className="px-6 py-4 text-sm">
                                {isLead ? 'N/A' : formatMode(client.booking_mode)}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                {standardizeTherapistName(client.booking_host_name)}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {isLead ? formatBookingLinkDate(client.booking_link_sent_at) : (client.last_session_date ? formatDate(client.last_session_date) : 'N/A')}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                  {(() => {
                                    const status = getClientStatus(client);
                                    return (
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
                                    );
                                  })()}
                              </td>
                        </tr>

                        {/* Expanded Actions Row */}
                        {expandedRows.has(index) && (
                          <tr className="bg-gray-50 border-b">
                            <td colSpan={9} className="px-6 py-4">
                              <div className="flex gap-4 justify-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendBookingLink(client);
                                  }}
                                  className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                  <Send size={16} />
                                  Send Booking Link
                                </button>
                                {!isLead && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleTransferClick(client);
                                    }}
                                    disabled={isTransferDisabled(client)}
                                    className={`flex items-center gap-1 text-sm font-medium ${isTransferDisabled(client)
                                        ? 'text-gray-400 cursor-not-allowed'
                                        : 'text-orange-600 hover:text-orange-700'
                                      }`}
                                  >
                                    <ArrowRightLeft size={16} />
                                    Transfer
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Multi-therapist rows */}
                        {expandedRows.has(index) && client.therapists && client.therapists.length > 1 && (
                          client.therapists.map((therapist, tIndex) => (
                            <tr key={`${index}-${tIndex}`} className="bg-gray-50 border-b">
                              <td></td>
                              <td className="px-6 py-4 text-sm pl-16 text-gray-600">{therapist.invitee_name}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                <div>{therapist.invitee_phone}</div>
                                <div className="text-gray-400 text-xs">{client.invitee_email}</div>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">{therapist.session_count}</td>
                                  <td className="px-6 py-4 text-sm text-gray-600">{therapist.booking_host_name}</td>
                                  <td></td>
                                  <td></td>
                                  <td></td>
                                  <td></td>
                            </tr>
                          ))
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t flex justify-between items-center">
            <span className="text-sm text-gray-600">Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredClients.length)} of {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}</span>
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
      <SendBookingModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setPrefilledClientData(undefined);
        }}
        prefilledClient={prefilledClientData}
      />
      <TransferClientModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        client={selectedClient}
        onTransferSuccess={handleTransferSuccess}
        adminUser={adminUser}
      />
      {editingClient && (
        <EditClientContactModal
          isOpen={!!editingClient}
          client={{ name: editingClient.invitee_name, phone: editingClient.invitee_phone, email: editingClient.invitee_email, client_type: editingClient.client_type || 'Indian' }}
          onClose={() => setEditingClient(null)}
          onSaved={(updated) => {
            setClients(prev => prev.map(c =>
              c.invitee_phone === editingClient.invitee_phone && c.invitee_email === editingClient.invitee_email
                ? { ...c, invitee_name: updated.name, invitee_phone: updated.phone, invitee_email: updated.email, client_type: updated.client_type }
                : c
            ));
            setEditingClient(null);
          }}
          adminUser={adminUser}
        />
      )}      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Booking Link Confirmation Modal */}
      {showBookingLinkConfirmModal && selectedClientForBookingLink && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Send Booking Link</h3>
            <p className="text-gray-600 mb-6">
              This will send a booking link reminder to <span className="font-semibold">{formatClientName(selectedClientForBookingLink.invitee_name)}</span>. Would you like to proceed?
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmSendBookingLink}
                className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 font-medium"
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

      {/* Bulk Booking Link Confirmation Modal */}
      {showBulkBookingConfirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Send Bulk Booking Links</h3>
            <p className="text-gray-600 mb-6">
              This will send booking link reminders to <span className="font-semibold">{selectedClients.size}</span> selected clients. Would you like to proceed?
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmBulkSendBookingLink}
                disabled={isBulkSending}
                className="flex-1 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#21615D' }}
              >
                {isBulkSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Sending...
                  </>
                ) : (
                  'Yes, Send All'
                )}
              </button>
              <button
                onClick={() => setShowBulkBookingConfirmModal(false)}
                disabled={isBulkSending}
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
};
