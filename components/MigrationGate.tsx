import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';

/**
 * TEMPORARY — holds staff out of the panel while the production migration runs.
 *
 * ============================================================================
 *  HOW TO REMOVE, once the migration is done
 *
 *    Quickest:  set MIGRATION_ACTIVE to false below and redeploy.
 *    Properly:  delete this file, then remove the two lines in App.tsx that
 *               import <MigrationGate> and wrap <Routes> in it.
 *
 *  Nothing else in the codebase refers to this, by design.
 * ============================================================================
 *
 * WHAT IT DOES NOT DO. This is a notice, not a lock. It runs in the browser, so
 * anyone determined enough to open dev tools is not stopped by it — and the API
 * behind it stays fully open. It exists so that staff who log in during the
 * migration see an explanation instead of half-migrated data. If the API itself
 * has to be closed, that belongs in the backend, not here.
 */
export const MIGRATION_ACTIVE = true;

/**
 * Who still gets in. Matched against BOTH username and email, case-insensitively,
 * because the same person is identified by either depending on the screen.
 */
const ALLOWED_IDENTITIES = ['aiteam', 'aiteam@fluid.live'];

/**
 * Client-facing routes, which are deliberately NOT gated.
 *
 * A client following a booking or confirmation link has no idea the clinic is
 * mid-migration and would only be confused by a staff notice. Mirrors the list
 * App.tsx uses for its desktop-only check — if that one gains a route, this
 * should too.
 *
 * Worth a decision rather than an assumption: leaving these open means clients
 * can still create bookings while the database is being migrated. Add '/book'
 * and '/free-consultation' to the gate if you would rather they could not.
 */
const PUBLIC_PREFIXES = [
  '/book',
  '/free-consultation',
  '/booking-confirmation',
  '/pay',
  '/session-notes',
  '/sos-view',
];

const isAllowed = (user: any): boolean =>
  [user?.username, user?.email].some(
    (id) => id && ALLOWED_IDENTITIES.includes(String(id).trim().toLowerCase())
  );

const MaintenanceNotice: React.FC<{ user: any; onSignOut: () => void }> = ({ user, onSignOut }) => (
  <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100 p-6">
    <div className="bg-white rounded-2xl shadow-2xl px-10 py-12 max-w-lg w-full text-center">
      <div className="flex justify-center mb-8">
        <Logo showTagline={false} />
      </div>

      <h1 className="text-2xl font-bold text-gray-800 mb-3">
        The panel is under maintenance
      </h1>

      <p className="text-gray-600 mb-2">
        We are upgrading the platform right now. It will be back shortly, and you
        will get an email as soon as it is ready to use.
      </p>
      <p className="text-gray-600">
        Please do not create or edit bookings until then.
      </p>

      <div className="mt-8 pt-6 border-t border-gray-100">
        <p className="text-sm text-gray-400 mb-3">
          Signed in as{' '}
          <span className="font-medium text-gray-600">
            {user?.full_name || user?.username || 'this account'}
          </span>
        </p>
        {/* Present so the migration account can take over a browser where a
            colleague is already signed in, without clearing site data by hand. */}
        <button
          onClick={onSignOut}
          className="text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
                     focus-visible:ring-offset-2 rounded px-2 py-1"
        >
          Sign out
        </button>
      </div>
    </div>
  </div>
);

export const MigrationGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoggedIn, logout } = useAuth();
  const location = useLocation();

  if (!MIGRATION_ACTIVE) return <>{children}</>;

  // Clients keep their own routes.
  if (PUBLIC_PREFIXES.some((p) => location.pathname.startsWith(p))) return <>{children}</>;

  // Signed out: the login page itself has to render, or nobody can reach the
  // notice by signing in — including the one account that is allowed through.
  if (!isLoggedIn || !user) return <>{children}</>;

  if (isAllowed(user)) return <>{children}</>;

  return <MaintenanceNotice user={user} onSignOut={logout} />;
};

export default MigrationGate;
