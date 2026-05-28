import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Loader } from './Loader';

interface AuditLog {
  log_id: number;
  therapist_name: string;
  action_type: string;
  action_description: string;
  client_name: string | null;
  timestamp: string;
}

export const AuditLogs: React.FC<{ hideHeader?: boolean }> = ({ hideHeader }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/audit-logs');
      const data = await response.json();
      setLogs(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching logs:', error);
      setLogs([]);
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const query = searchQuery.toLowerCase();
    return (
      log.therapist_name?.toLowerCase().includes(query) ||
      log.action_type?.toLowerCase().includes(query) ||
      log.action_description?.toLowerCase().includes(query) ||
      log.client_name?.toLowerCase().includes(query)
    );
  });

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + itemsPerPage);

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return 'Invalid Date';
    
    // If already in IST format, return as-is
    if (timestamp.includes('IST')) {
      return timestamp;
    }
    
    // Parse PostgreSQL timestamp
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Invalid Date';
    
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) + ' IST';
  };

  const getActionColor = (actionType: string) => {
    if (actionType.includes('login')) return 'text-green-600';
    if (actionType.includes('logout')) return 'text-gray-600';
    if (actionType.includes('cancel')) return 'text-red-600';
    if (actionType.includes('reschedule')) return 'text-orange-600';
    if (actionType.includes('sos')) return 'text-red-600';
    if (actionType.includes('transfer')) return 'text-orange-600';
    return 'text-blue-600';
  };

  const formatActionType = (actionType: string) => {
    const actionMap: { [key: string]: string } = {
      'copy_appointment': 'Appointment details copied',
      'send_whatsapp': 'Whatsapp reminder',
      'raise_sos': 'SOS raised',
      'client_transfer': 'Client Transferred',
      'login': 'Login',
      'logout': 'Logout',
      'cancel': 'Booking Canceled',
      'reschedule': 'Booking Rescheduled',
      'cancel_booking': 'Booking Canceled',
      'reschedule_booking': 'Booking Rescheduled'
    };
    
    return actionMap[actionType] || actionType.replace(/_/g, ' ');
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {!hideHeader && (
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1">Audit Logs</h1>
            <p className="text-gray-600">Track all therapist activities</p>
          </div>
        </div>
      )}

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search by therapist, action, or client..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border flex-1 flex items-center justify-center">
          <Loader />
        </div>
      ) : (
      <div className="bg-white rounded-lg border flex-1 flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Timestamp</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Therapist</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Action</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Description</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Client</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    Loading...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    No logs found
                  </td>
                </tr>
              ) : (
                paginatedLogs.map((log) => (
                  <tr key={log.log_id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                    <td className="px-6 py-4 text-sm">{log.therapist_name}</td>
                    <td className={`px-6 py-4 text-sm font-medium ${getActionColor(log.action_type)}`}>
                      {formatActionType(log.action_type)}
                    </td>
                    <td className="px-6 py-4 text-sm">{log.action_description}</td>
                    <td className="px-6 py-4 text-sm">{log.client_name || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t flex justify-between items-center">
          <span className="text-sm text-gray-600">
            Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredLogs.length)} of {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
          </span>
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


    </div>
  );
};
