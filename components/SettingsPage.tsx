import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

/**
 * The old combined /admin/appSettings shell is gone. Its tabs were split into
 * two sidebar pages:
 *
 *   User Settings         → Therapists, Therapies, Pricing
 *   Organization Settings → General, Payment Settings, Audit Logs, Integrations
 *
 * These routes stay mounted purely so existing bookmarks, the Google OAuth
 * return URL, and any links still pointing at /admin/appSettings/* land on the
 * right new page instead of a 404.
 */
const SettingsPage: React.FC<{ onBack?: () => void; user?: any }> = () => (
  <Routes>
    <Route path="therapy-calendars" element={<Navigate to="/admin/userSettings/therapies" replace />} />
    <Route path="therapy-calendars/new" element={<Navigate to="/admin/userSettings/therapies/new" replace />} />
    {/* :id is preserved by RedirectCalendarDetail below rather than a static path. */}
    <Route path="therapy-calendars/:id" element={<RedirectCalendarDetail />} />
    <Route path="new-therapist" element={<Navigate to="/admin/userSettings/therapists/new" replace />} />
    <Route path="payments" element={<Navigate to="/admin/orgSettings/payments" replace />} />
    <Route path="audit" element={<Navigate to="/admin/orgSettings/audit" replace />} />
    <Route path="calendars" element={<Navigate to="/admin/orgSettings/integrations" replace />} />
    <Route path="*" element={<Navigate to="/admin/userSettings/therapists" replace />} />
  </Routes>
);

import { useParams } from 'react-router-dom';

const RedirectCalendarDetail: React.FC = () => {
  const { id } = useParams();
  return <Navigate to={`/admin/userSettings/therapies/${id}`} replace />;
};

export default SettingsPage;
