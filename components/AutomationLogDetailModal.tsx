import React from 'react';
import { X, Calendar, User, FileText, AlertTriangle, CheckCircle, Tag, Code, Globe, Settings } from 'lucide-react';

interface AutomationLogDetailModalProps {
  log: any;
  onClose: () => void;
}

export const AutomationLogDetailModal: React.FC<AutomationLogDetailModalProps> = ({ log, onClose }) => {
  if (!log) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    });
  };

  const isFailed = log.status === 'failed';
  const isWebhookApi = 'log_type' in log;

  // Format JSON payload safely
  const renderJSON = (data: any) => {
    try {
      if (!data) return 'No data';
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        return JSON.stringify(parsed, null, 2);
      }
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data || 'No data');
    }
  };

  const getLogTypeBadgeLabel = (type: string) => {
    switch (type) {
      case 'webhook_incoming': return 'Incoming Webhook';
      case 'webhook_outgoing': return 'Outgoing Webhook';
      case 'api_outgoing': return 'Outgoing API';
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isFailed ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex items-center gap-3">
            {isFailed ? (
              <AlertTriangle className="text-red-600" size={24} />
            ) : (
              <CheckCircle className="text-emerald-600" size={24} />
            )}
            <h2 className={`text-xl font-bold ${isFailed ? 'text-red-900' : 'text-emerald-900'}`}>
              {isWebhookApi ? 'Integration Log Details' : 'Automation Details'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center text-gray-500 mb-1">
                <Calendar size={14} className="mr-2" />
                <span className="text-xs font-semibold uppercase tracking-wider">Triggered At</span>
              </div>
              <p className="text-sm font-medium text-gray-900">{formatDate(log.created_at)}</p>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <div className="flex items-center text-gray-500 mb-1">
                <Tag size={14} className="mr-2" />
                <span className="text-xs font-semibold uppercase tracking-wider">Log Type</span>
              </div>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border mt-1 ${isWebhookApi ? getLogTypeBadgeClass(log.log_type) : 'bg-purple-50 text-purple-700 border-purple-100'}`}>
                {isWebhookApi ? getLogTypeBadgeLabel(log.log_type) : (log.automation_type || 'Unknown')}
              </span>
            </div>

            {isWebhookApi ? (
              <>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center text-gray-500 mb-1">
                    <Settings size={14} className="mr-2" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Integration Name</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{log.name || 'N/A'}</p>
                </div>

                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center text-gray-500 mb-1">
                    <Globe size={14} className="mr-2" />
                    <span className="text-xs font-semibold uppercase tracking-wider">HTTP Method / Endpoint</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-700 border mr-2 uppercase">
                      {log.method || 'POST'}
                    </span>
                    <span className="font-mono text-xs">{log.endpoint || '/'}</span>
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center text-gray-500 mb-1">
                    <User size={14} className="mr-2" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Recipient / Target</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{log.recipient || 'N/A'}</p>
                </div>

                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                  <div className="flex items-center text-gray-500 mb-1">
                    <FileText size={14} className="mr-2" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Booking ID</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{log.booking_id || 'N/A'}</p>
                </div>
              </>
            )}
          </div>

          {/* Error Message */}
          {isFailed && log.error_message && (
            <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2 border-b border-red-200 bg-red-100/50 flex items-center">
                <AlertTriangle size={16} className="text-red-700 mr-2" />
                <h3 className="text-sm font-bold text-red-900">Failure Reason</h3>
              </div>
              <div className="p-4">
                <p className="text-sm text-red-800 font-mono whitespace-pre-wrap">{log.error_message}</p>
              </div>
            </div>
          )}

          {/* Request Payload Data (Webhook/API only) */}
          {isWebhookApi && log.request_payload && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center gap-1.5">
                <Code size={16} className="text-gray-500" />
                <h3 className="text-sm font-bold text-gray-700">Request Payload</h3>
              </div>
              <pre className="text-xs text-gray-800 font-mono p-4 overflow-x-auto bg-[#f8fafc] m-0 max-h-[200px] overflow-y-auto">
                {renderJSON(log.request_payload)}
              </pre>
            </div>
          )}

          {/* Response/Payload Data */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center gap-1.5">
              <Code size={16} className="text-gray-500" />
              <h3 className="text-sm font-bold text-gray-700">Response / Body Data</h3>
            </div>
            <pre className="text-xs text-gray-800 font-mono p-4 overflow-x-auto bg-[#f8fafc] m-0 max-h-[250px] overflow-y-auto">
              {renderJSON(log.response_data)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
