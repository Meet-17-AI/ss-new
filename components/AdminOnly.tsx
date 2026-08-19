import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { isBaseAdmin } from '../lib/permissions';

/**
 * Wraps clinic-configuration screens so a granted therapist gets an explanation
 * rather than a broken one.
 *
 * Hiding the sidebar entries is not enough on its own: the URLs still resolve,
 * and someone following a bookmark or a shared link would otherwise land on a
 * page whose every request comes back 403 — empty tables, silent failures, and
 * no clue why. Saying so plainly is kinder and shorter to debug.
 *
 * This decides what is worth RENDERING. requireBaseAdmin on the backend decides
 * what is allowed, and it is the control.
 */
export const AdminOnly: React.FC<{ user?: any; children: React.ReactNode }> = ({ user, children }) => {
  if (isBaseAdmin(user)) return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-10 text-center">
      <div className="max-w-sm">
        <ShieldCheck size={28} className="mx-auto mb-3 text-gray-300" />
        <h2 className="text-base font-semibold text-gray-900">Restricted to administrators</h2>
        <p className="mt-2 text-sm text-gray-500">
          These settings configure the whole organisation, so they stay with admin accounts
          even when you have access to this dashboard.
        </p>
      </div>
    </div>
  );
};

export default AdminOnly;
