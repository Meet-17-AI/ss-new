import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { LoginForm } from './components/LoginForm';
import { HeroPanel } from './components/HeroPanel';
import { Logo } from './components/Logo';
import { Footer } from './components/Footer';
import { Dashboard } from './components/Dashboard';
import { TherapistDashboard } from './components/TherapistDashboard';
import { PaymentCheckoutPage } from './components/PaymentCheckoutPage';
import { MaintenancePage } from './components/MaintenancePage';
import { ResetPasswordPage } from './components/ResetPasswordPage';
import { SOSDocumentationView } from './components/SOSDocumentationView';
import { PublicBookingContainer } from './components/PublicBookingContainer';
import { BookingConfirmation } from './components/BookingConfirmation';
import { SessionNotesPage } from './components/SessionNotesPage';
import { PublicDirectory } from './components/PublicDirectory';
import { PublicBooking } from './components/PublicBooking';
import { FreeConsultation } from './components/FreeConsultation';
import { FluidAdminLayout } from './components/FluidAdminLayout';
import { CrmRedirect } from './components/CrmRedirect';
import { Monitor } from 'lucide-react';

if (window.location.hostname.includes('safestories-dashboard.vercel.app')) {
  window.location.replace('https://panel.safestories.in' + window.location.pathname + window.location.search + window.location.hash);
}

import { useAuth } from './context/AuthContext';
import { ProtectedRoute } from './context/ProtectedRoute';
import { defaultPathForScopes, SCOPE_PATH } from './lib/permissions';

const LoginPage = () => {
  const { login, isLoggedIn, user, scopes, scopesLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Wait for the access answer before choosing a destination. Redirecting on
    // the role alone would send a therapist with admin access to /therapist,
    // which is the one place the grant was meant to stop being the default.
    if (isLoggedIn && user && !scopesLoading) {
      const dest = (location.state as any)?.from?.pathname || defaultPathForScopes(scopes, user.role);
      navigate(dest, { replace: true });
    }
  }, [isLoggedIn, user, scopes, scopesLoading, navigate, location]);

  const handleLogin = (userData: any, token?: string) => {
    login(userData, token);
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white overflow-hidden">
      <div className="w-full md:w-1/2 flex flex-col justify-between p-8 md:p-12 lg:p-16 relative">
        <div className="flex-none">
          <Logo />
        </div>
        <div className="flex-grow flex items-center justify-center py-10">
          <div className="w-full max-w-md">
            <LoginForm onLogin={handleLogin} />
          </div>
        </div>
        <div className="flex-none flex justify-center">
          <Footer />
        </div>
      </div>
      <div className="hidden md:flex md:w-1/2 p-4 h-screen">
        <HeroPanel />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (import.meta.env.VITE_VERCEL === '1') return <MaintenancePage />;

  // Public, customer-facing routes must work on mobile. Only the authenticated internal
  // dashboards (admin/therapist/crm/automation-logs) require desktop.
  const publicPrefixes = ['/book', '/free-consultation', '/booking-confirmation', '/pay', '/session-notes', '/sos-view', '/reset-password'];
  const isPublicRoute = publicPrefixes.some(p => location.pathname.startsWith(p));

  if (isMobile && !isPublicRoute) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100 p-6">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="w-20 h-20 bg-teal-100 rounded-full flex items-center justify-center">
              <Monitor size={40} className="text-teal-700" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Desktop View Required</h1>
          <p className="text-gray-600 mb-2">Mobile view is not available yet.</p>
          <p className="text-gray-600">Please view this application on a desktop or laptop for the best experience.</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      {/* Personalised password-reset link. Public: it exists for people who
          cannot sign in, and it grants nothing without the emailed code. */}
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      {/* Dynamic Route wrappers for public pages since react-router passes params differently */}
      <Route path="/sos-view/*" element={<SOSRouterWrapper />} />
      <Route path="/book/*" element={<BookRouterWrapper />} />
      {/* Its own link, not a step inside /book: a free introductory call is a
          different decision from choosing and paying for therapy. */}
      <Route path="/free-consultation" element={<FreeConsultation />} />
      <Route path="/pay/:bookingId" element={<PaymentCheckoutPage />} />
      <Route path="/booking-confirmation/*" element={<ConfirmationRouterWrapper />} />
      <Route path="/session-notes/*" element={<NotesRouterWrapper />} />

      {/* Protected Routes */}
      {/* Gated on the dashboard held, not the role. A therapist granted admin
          access reaches /admin while still being a therapist everywhere else —
          which is the point, and why no token is ever re-issued to switch. */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute requiredScope="admin_dashboard">
            <Dashboard onLogout={logout} user={user} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/therapist/*"
        element={
          <ProtectedRoute requiredScope="therapist_dashboard">
            <TherapistDashboard onLogout={logout} user={user} />
          </ProtectedRoute>
        }
      />
      {/* The CRM is a separate application now. This route no longer renders one
          — it hands the session over to the real CRM and leaves. Kept rather than
          deleted because /crm is a sales account's default destination, and
          without it they would bounce between here and "/" forever. */}
      <Route
        path="/crm/*"
        element={
          <ProtectedRoute requiredScope="crm">
            <CrmRedirect />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/automation-logs/*" 
        element={
          <ProtectedRoute allowedRoles={['fluidadmin']}>
            <FluidAdminLayout user={user} onLogout={logout} />
          </ProtectedRoute>
        } 
      />

      {/* Root Redirect */}
      <Route 
        path="/" 
        element={
          <ProtectedRoute>
            <RootRedirect />
          </ProtectedRoute>
        } 
      />
      
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const RootRedirect = () => {
  const { user, scopes, handoffScope } = useAuth();
  // A handoff names the dashboard that was actually asked for. The default is
  // "first scope you hold", which sends anyone with admin access to /admin — so
  // choosing "Therapist dashboard" in the CRM used to land on the wrong one.
  const dest = handoffScope ? SCOPE_PATH[handoffScope] : defaultPathForScopes(scopes, user?.role);
  return <Navigate to={dest} replace />;
};

// Wrappers to extract wildcards and pass them as props for backward compatibility
import { useParams } from 'react-router-dom';

const SOSRouterWrapper = () => {
  const params = useParams();
  const token = params['*'] || '';
  return <SOSDocumentationView token={token} />;
};

const BookRouterWrapper = () => {
  const params = useParams();
  const slug = params['*'] || '';
  if (!slug) {
    // /book is now the single public link: it identifies the client, resolves
    // which service they are booking, and redirects to /book/<slug> below.
    // PublicDirectory is no longer reachable — kept only so the old plain list
    // can be restored quickly if this flow needs backing out.
    return <PublicBooking />;
  }
  return <PublicBookingContainer slug={slug} />;
};

const ConfirmationRouterWrapper = () => {
  const params = useParams();
  const bookingId = params['*'] || '';
  return <BookingConfirmation bookingId={bookingId} />;
};

const NotesRouterWrapper = () => {
  const params = useParams();
  const bookingId = params['*'] || '';
  return <SessionNotesPage bookingId={bookingId} />;
};

export default App;
