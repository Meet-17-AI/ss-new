import React, { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Eye, Globe, Code, ArrowRight } from 'lucide-react';
import { AutomationLogDetailModal } from './AutomationLogDetailModal';

export const AutomationLogsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'webhooks' | 'apis'>('campaigns');
  const [campaignStats, setCampaignStats] = useState({ total_ran: 0, total_success: 0, total_failed: 0 });
  const [webhookApiStats, setWebhookApiStats] = useState({
    total_ran: 0,
    total_webhooks: 0,
    webhook_success: 0,
    webhook_failed: 0,
    total_apis: 0,
    api_success: 0,
    api_failed: 0
  });
  
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  // Fetch stats and logs when tab or page changes
  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    setPage(1); // Reset page to 1 on tab change
    fetchLogs(activeTab, 1);
  }, [activeTab]);

  useEffect(() => {
    fetchLogs(activeTab, page);
  }, [page]);

  const fetchStats = async () => {
    try {
      // Fetch Automation Campaign Stats
      const resCamp = await fetch('/api/automation-logs/stats');
      const dataCamp = await resCamp.json();
      if (dataCamp.success) {
        setCampaignStats(dataCamp.data);
      }

      // Fetch Webhook and API Stats
      const resWeb = await fetch('/api/webhook-api-logs/stats');
      const dataWeb = await resWeb.json();
      if (dataWeb.success) {
        setWebhookApiStats(dataWeb.data);
      }
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    }
  };

  const fetchLogs = async (tab: 'campaigns' | 'webhooks' | 'apis', pageNum: number) => {
    setIsLoading(true);
    try {
      let endpoint = '';
      if (tab === 'campaigns') {
        endpoint = `/api/automation-logs?page=${pageNum}&limit=10`;
      } else if (tab === 'webhooks') {
        endpoint = `/api/webhook-api-logs?type=webhook&page=${pageNum}&limit=10`;
      } else if (tab === 'apis') {
        endpoint = `/api/webhook-api-logs?type=api&page=${pageNum}&limit=10`;
      }

      const res = await fetch(endpoint);
      const data = await res.json();
      if (data.success) {
        setRecentLogs(data.data);
        setTotalPages(data.pagination?.totalPages || 1);
      } else {
        setRecentLogs([]);
        setTotalPages(1);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
      setRecentLogs([]);
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

  // Get dynamic stats based on selected tab
  const getActiveStats = () => {
    if (activeTab === 'campaigns') {
      return {
        labelTotal: 'Total Campaigns Ran',
        labelSuccess: 'Successful Runs',
        labelFailed: 'Failed Runs',
        total: campaignStats.total_ran,
        success: campaignStats.total_success,
        failed: campaignStats.total_failed,
      };
    } else if (activeTab === 'webhooks') {
      return {
        labelTotal: 'Total Webhooks Received/Sent',
        labelSuccess: 'Successful Webhooks',
        labelFailed: 'Failed Webhooks',
        total: webhookApiStats.total_webhooks,
        success: webhookApiStats.webhook_success,
        failed: webhookApiStats.webhook_failed,
      };
    } else {
      return {
        labelTotal: 'Total API Requests',
        labelSuccess: 'Successful API Calls',
        labelFailed: 'Failed API Calls',
        total: webhookApiStats.total_apis,
        success: webhookApiStats.api_success,
        failed: webhookApiStats.api_failed,
      };
    }
  };

  const currentStats = getActiveStats();

  return (
    <div className="space-y-6">
      {/* Tab Selector Bar */}
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
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'campaigns' ? 'bg-teal-700/60 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {campaignStats.total_ran}
          </span>
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
          <span>Webhook Logs</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'webhooks' ? 'bg-teal-700/60 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {webhookApiStats.total_webhooks}
          </span>
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
          <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === 'apis' ? 'bg-teal-700/60 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {webhookApiStats.total_apis}
          </span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mr-4">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{currentStats.labelTotal}</p>
            <h3 className="text-2xl font-bold text-gray-900">{currentStats.total}</h3>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mr-4">
            <CheckCircle size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{currentStats.labelSuccess}</p>
            <h3 className="text-2xl font-bold text-emerald-600">{currentStats.success}</h3>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex items-center">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mr-4">
            <XCircle size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{currentStats.labelFailed}</p>
            <h3 className="text-2xl font-bold text-red-600">{currentStats.failed}</h3>
          </div>
        </div>
      </div>

      {/* Recent Logs Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-lg font-bold text-gray-800">
            Recent {activeTab === 'campaigns' ? 'Campaign Logs' : activeTab === 'webhooks' ? 'Webhook Logs' : 'API Logs'}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
              {activeTab === 'campaigns' ? (
                <tr>
                  <th className="px-6 py-4 font-semibold">Date Triggered</th>
                  <th className="px-6 py-4 font-semibold">Campaign Type</th>
                  <th className="px-6 py-4 font-semibold">Recipient / Target</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-6 py-4 font-semibold">Date Triggered</th>
                  <th className="px-6 py-4 font-semibold">Integration Name</th>
                  <th className="px-6 py-4 font-semibold">Endpoint / Target</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    <div className="flex justify-center items-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600"></div>
                      <span className="ml-2">Loading logs...</span>
                    </div>
                  </td>
                </tr>
              ) : recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No logs found.
                  </td>
                </tr>
              ) : (
                recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      <div className="flex items-center">
                        <Clock size={14} className="mr-2 text-gray-400" />
                        {formatDate(log.created_at)}
                      </div>
                    </td>
                    
                    {activeTab === 'campaigns' ? (
                      <>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                            {log.automation_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600 truncate max-w-[200px]" title={log.recipient}>
                          {log.recipient || '-'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-gray-900 font-semibold">
                          {log.name || 'API Trigger'}
                        </td>
                        <td className="px-6 py-4 text-gray-600 truncate max-w-[300px]" title={log.endpoint}>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 border mr-2 uppercase">
                            {log.method || 'POST'}
                          </span>
                          <span className="font-mono text-xs">{log.endpoint}</span>
                        </td>
                      </>
                    )}

                    <td className="px-6 py-4">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                          Failed
                        </span>
                      )}
                    </td>
                    
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-teal-600 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 p-2 rounded-lg transition-colors inline-flex items-center"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          <span className="text-sm text-gray-500">
            Page <span className="font-medium text-gray-900">{page}</span> of <span className="font-medium text-gray-900">{totalPages}</span>
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isLoading}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
