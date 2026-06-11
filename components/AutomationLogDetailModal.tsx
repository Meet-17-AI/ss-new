import React from 'react';
import { X, Calendar, User, FileText, AlertTriangle, CheckCircle, Tag } from 'lucide-react';

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

  // Format JSON payload safely
  const renderPayload = (payload: any) => {
    try {
      if (typeof payload === 'string') {
        // Try parsing stringified JSON
        const parsed = JSON.parse(payload);
        return JSON.stringify(parsed, null, 2);
      }
      return JSON.stringify(payload, null, 2);
    } catch (e) {
      return String(payload || 'No data provided');
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
              Automation Details
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
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
                <span className="text-xs font-semibold uppercase tracking-wider">Automation Type</span>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100 mt-1">
                {log.automation_type || 'Unknown'}
              </span>
            </div>

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
          </div>

          {/* Error Message */}
          {isFailed && log.error_message && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-red-200 bg-red-100/50 flex items-center">
                <AlertTriangle size={16} className="text-red-700 mr-2" />
                <h3 className="text-sm font-bold text-red-900">Failure Reason</h3>
              </div>
              <div className="p-4">
                <p className="text-sm text-red-800 font-mono whitespace-pre-wrap">{log.error_message}</p>
              </div>
            </div>
          )}

          {/* Response/Payload Data */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Raw Response / Data</h3>
              <span className="text-xs text-gray-500">JSON</span>
            </div>
            <div className="p-0">
              <pre className="text-xs text-gray-800 font-mono p-4 overflow-x-auto bg-[#f8fafc] m-0 max-h-[300px] overflow-y-auto">
                {renderPayload(log.response_data)}
              </pre>
            </div>
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
