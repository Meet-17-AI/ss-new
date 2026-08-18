import React from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { TherapistProfileGrid } from './TherapistProfileGrid';
import { TherapyCalendars } from './TherapyCalendars';
import { TherapyCalendarDetails } from './TherapyCalendarDetails';
import { PricingSettings } from './PricingSettings';
import { NewTherapist } from './NewTherapist';
import { RolesAccessTab } from './RolesAccessTab';
import { useAuth } from '../context/AuthContext';

const BASE = '/admin/userSettings';

const tabs = [
  { id: 'therapists', label: 'Therapists' },
  { id: 'therapies', label: 'Therapies' },
  { id: 'pricing', label: 'Pricing' },
  // Only the AI team sees this. Hiding it is presentation — both the list and the
  // save are refused server-side for everyone else.
  { id: 'roles', label: 'Roles', accessAdminOnly: true },
];

export const UserSettingsPage: React.FC<{ user?: any }> = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { canManageAccess } = useAuth();
  const visibleTabs = tabs.filter((t) => !t.accessAdminOnly || canManageAccess);

  // Match the tab by the first path segment after the base, so nested routes
  // (therapists/new, therapies/:id) keep their parent tab highlighted instead of
  // falling through to a hardcoded default.
  const settingsPath = location.pathname.split(`${BASE}/`)[1] || '';
  const activeTab = settingsPath.split('/')[0];

  return (
    <div className="p-8 h-full flex flex-col bg-gray-50">
      <h1 className="text-3xl font-bold mb-8">User Settings</h1>

      <div className="flex gap-4 mb-6 border-b">
        {visibleTabs.map((tab) => (
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
            <Route path="therapists" element={<TherapistProfileGrid />} />
            <Route
              path="therapists/new"
              element={<NewTherapist onBack={() => navigate(`${BASE}/therapists`)} />}
            />
            <Route path="therapies" element={<TherapyCalendars />} />
            <Route path="therapies/new" element={<TherapyCalendarDetails />} />
            <Route path="therapies/:id" element={<TherapyCalendarDetails />} />
            <Route path="pricing" element={<PricingSettings />} />
            {/* Routed unconditionally: the component itself explains the refusal,
                which beats a bare redirect if someone follows a shared link. */}
            <Route path="roles" element={<RolesAccessTab />} />
            {/* Unknown sub-path (including the bare base): land on the first tab
                instead of a blank panel. */}
            <Route path="*" element={<Navigate to={`${BASE}/therapists`} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
};

export default UserSettingsPage;
