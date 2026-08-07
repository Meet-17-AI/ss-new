import React from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { OrgGeneralSettings } from './OrgGeneralSettings';
import { PaymentSettings } from './PaymentSettings';
import { AuditLogs } from './AuditLogs';
import { CalendarConnectionsAdmin } from './CalendarConnectionsAdmin';

const BASE = '/admin/orgSettings';

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'payments', label: 'Payment Settings' },
  { id: 'audit', label: 'Audit Logs' },
  { id: 'integrations', label: 'Integrations' },
];

export const OrgSettingsPage: React.FC<{ user?: any }> = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const settingsPath = location.pathname.split(`${BASE}/`)[1] || '';
  const activeTab = settingsPath.split('/')[0];

  return (
    <div className="p-8 h-full flex flex-col bg-gray-50">
      <h1 className="text-3xl font-bold mb-8">Organization Settings</h1>

      <div className="flex gap-4 mb-6 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigate(`${BASE}/${tab.id}`)}
            className={`pb-3 px-4 font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-teal-700 border-b-2 border-teal-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border shadow-sm flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto relative">
          <Routes>
            <Route path="general" element={<OrgGeneralSettings />} />
            <Route path="payments" element={<PaymentSettings />} />
            <Route path="audit" element={<AuditLogs hideHeader={true} />} />
            <Route path="integrations" element={<CalendarConnectionsAdmin />} />
            <Route path="*" element={<Navigate to={`${BASE}/general`} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
};

export default OrgSettingsPage;
