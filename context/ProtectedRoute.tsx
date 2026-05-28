import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Monitor } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, isLoggedIn, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-teal-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!isLoggedIn || !user) {
    // Redirect to login page but save the location they were trying to access
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role?.toLowerCase() || '')) {
    // Role not authorized, redirect to their default dashboard
    let defaultDest = '/';
    if (user.role === 'sales') defaultDest = '/crm';
    if (user.role === 'therapist') defaultDest = '/therapist';
    if (user.role === 'admin') defaultDest = '/admin';
    return <Navigate to={defaultDest} replace />;
  }

  return <>{children}</>;
};
