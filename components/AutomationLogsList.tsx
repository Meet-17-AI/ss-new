import React, { useState, useEffect } from 'react';
import { Clock, Eye, Activity, Globe, Code } from 'lucide-react';
import { AutomationLogDetailModal } from './AutomationLogDetailModal';

export const AutomationLogsList: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'webhooks' | 'apis'>('campaigns');
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  useEffect(() => {
    setPage(1); // Reset to page 1 on tab change
    fetchLogs(activeTab, 1);
  }, [activeTab]);

  useEffect(() => {
    fetchLogs(activeTab, page);
  }, [page]);

  const fetchLogs = async (tab: 'campaigns' | 'webhooks' | 'apis', pageNum: number) => {
    setIsLoading(true);
    try {
      let endpoint = '';
      if (tab === 'campaigns') {
        endpoint = `/api/automation-logs?page=${pageNum}&limit=20`;
      } else if (tab === 'webhooks') {
        endpoint = `/api/webhook-api-logs?type=webhook&page=${pageNum}&limit=20`;
      } else if (tab === 'apis') {
        endpoint = `/api/webhook-api-logs?type=api&page=${pageNum}&limit=20`;
      }

      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        setLogs([]);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      setLogs([]);
      setTotalPages(1);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  };

  const getLogTypeBadgeLabel = (type: string) => {
    switch (type) {
      case 'webhook_incoming': return 'Incoming';
      case 'webhook_outgoing': return 'Outgoing';
      case 'api_outgoing': return 'API Outgoing';
      default: return type || 'System';
    }
  };

  const getLogTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'webhook_incoming': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'webhook_outgoing': return 'bg-cyan-50 text-cyan-700 border-cyan-100';
      case 'api_outgoing': return 'bg-purple-50 text-purple-700 border-purple-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">All System Logs</h1>
          <p className="text-sm text-gray-500 mt-1">View, inspect and debug system triggers, webhooks and API integrations.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white p-2 rounded-2xl shadow-sm gap-2">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
            activeTab === 'campaigns'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <Activity size={18} />
          <span>Automation Campaigns</span>
        </button>

        <button
          onClick={() => setActiveTab('webhooks')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
            activeTab === 'webhooks'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <Globe size={18} />
          <span>Webhooks Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('apis')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
            activeTab === 'apis'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <Code size={18} />
          <span>API Logs</span>
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto min-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/80 border-b">
              {activeTab === 'campaigns' ? (
                <tr>
                  <th className="px-6 py-4 font-semibold">Date Triggered</th>
                  <th className="px-6 py-4 font-semibold">Booking ID</th>
                  <th className="px-6 py-4 font-semibold">Type</th>
                  <th className="px-6 py-4 font-semibold">Recipient / Target</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-6 py-4 font-semibold">Date Triggered</th>
                  <th className="px-6 py-4 font-semibold">ID</th>
                  <th className="px-6 py-4 font-semibold">Direction / Type</th>
                  <th className="px-6 py-4 font-semibold">Endpoint / Target</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col justify-center items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mb-3"></div>
                      <span>Loading logs...</span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    <div className="bg-gray-50 rounded-xl p-8 max-w-sm mx-auto border border-dashed border-gray-200">
                      <Clock className="mx-auto h-8 w-8 text-gray-400 mb-3" />
                      <p className="font-medium text-gray-900 mb-1">No Logs Found</p>
                      <p className="text-xs text-gray-500">There are no records in the selected category yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-teal-50/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700 font-medium">
                      {formatDate(log.created_at)}
                    </td>
                    
                    {activeTab === 'campaigns' ? (
                      <>
                        <td className="px-6 py-4 font-mono text-xs text-gray-500">
                          {log.booking_id || '-'}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                            {log.automation_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          <div className="max-w-[200px] truncate" title={log.recipient}>
                            {log.recipient || '-'}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 font-mono text-xs text-gray-500">
                          {log.id}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getLogTypeBadgeClass(log.log_type)}`}>
                            {getLogTypeBadgeLabel(log.log_type)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                          <div className="max-w-[300px] truncate font-mono text-xs" title={log.endpoint}>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 border mr-1.5 uppercase">
                              {log.method || 'POST'}
                            </span>
                            {log.endpoint}
                          </div>
                        </td>
                      </>
                    )}

                    <td className="px-6 py-4">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full mr-1.5"></span>
                          Failed
                        </span>
                      )}
                    </td>
                    
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-teal-600 hover:text-white bg-teal-50 hover:bg-teal-600 px-3 py-1.5 rounded-lg transition-all inline-flex items-center shadow-sm"
                        title="View Details"
                      >
                        <Eye size={16} className="mr-1.5" />
                        <span className="text-xs font-medium">View</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-white">
          <span className="text-sm text-gray-600">
            Showing Page <span className="font-semibold text-gray-900">{page}</span> of <span className="font-semibold text-gray-900">{totalPages}</span>
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isLoading}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <AutomationLogDetailModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
};
