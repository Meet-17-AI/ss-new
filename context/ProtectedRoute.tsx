import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { defaultPathForScopes, type Scope } from '../lib/permissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Dashboard this route belongs to. Gates on what the user HOLDS, not on their
   * role, so a therapist granted admin access reaches /admin without their token
   * ever having to claim to be an admin.
   */
  requiredScope?: Scope;
  /**
   * Retained for the one route that is genuinely about identity rather than a
   * dashboard: /automation-logs belongs to the Fluid admin account, and no grant
   * is meant to open it.
   */
  allowedRoles?: string[];
}

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent"></div>
  </div>
);

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredScope, allowedRoles }) => {
  const { user, isLoggedIn, loading, scopes, scopesLoading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;

  if (!isLoggedIn || !user) {
    // Redirect to login page but save the location they were trying to access
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wait for the server's answer rather than deciding from the role in the
  // meantime — guessing would flash the wrong dashboard, and on a slow network
  // the redirect would land before the correction arrived.
  if (scopesLoading) return <Spinner />;

  if (allowedRoles && !allowedRoles.includes(String(user.role || '').toLowerCase())) {
    return <Navigate to={defaultPathForScopes(scopes, user.role)} replace />;
  }

  if (requiredScope && !scopes.includes(requiredScope)) {
    const dest = defaultPathForScopes(scopes, user.role);
    // Nothing at all: the session is valid but grants nothing this app renders.
    // Bouncing to a dashboard would loop, so send them to login.
    if (dest === location.pathname) return <Navigate to="/login" replace />;
    return <Navigate to={dest} replace />;
  }

  return <>{children}</>;
};
