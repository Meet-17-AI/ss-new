import React, { useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Activity, List, LogOut, Menu, X, Ticket } from 'lucide-react';
import { Logo } from './Logo';
import { AutomationLogsDashboard } from './AutomationLogsDashboard';
import { AutomationLogsList } from './AutomationLogsList';
import { TicketsPage } from './TicketsPage';

interface FluidAdminLayoutProps {
  onLogout: () => void;
  user: any;
}

export const FluidAdminLayout: React.FC<FluidAdminLayoutProps> = ({ onLogout, user }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const menuItems = [
    { icon: Activity, label: 'Dashboard', path: '/automation-logs' },
    { icon: List, label: 'All Logs', path: '/automation-logs/list' },
    { icon: Ticket, label: 'Tickets', path: '/automation-logs/tickets' },
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <div 
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#1E293B] text-white transition-transform duration-300 ease-in-out transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:relative lg:translate-x-0 flex flex-col shadow-2xl`}
      >
        <div className="flex items-center justify-between p-6 bg-[#0F172A]">
          <Logo />
          <button onClick={toggleSidebar} className="lg:hidden text-gray-300 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4">
          <div className="mb-8 px-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">System</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                FA
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Fluid Admin</h2>
                <p className="text-xs text-teal-400">Master Access</p>
              </div>
            </div>
          </div>

          <nav className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || (item.path !== '/automation-logs' && location.pathname.startsWith(item.path));
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center w-full px-4 py-3 rounded-xl transition-all duration-200 ${
                    isActive 
                      ? 'bg-teal-600 text-white shadow-md' 
                      : 'text-gray-300 hover:bg-[#334155] hover:text-white'
                  }`}
                >
                  <Icon size={20} className={`mr-3 ${isActive ? 'text-teal-200' : 'text-gray-400'}`} />
                  <span className="font-medium text-sm">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 bg-[#0F172A] border-t border-gray-800">
          <button
            onClick={onLogout}
            className="flex items-center w-full px-4 py-3 text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-xl transition-colors text-sm font-medium"
          >
            <LogOut size={20} className="mr-3" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200 z-10 sticky top-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center">
              <button onClick={toggleSidebar} className="mr-4 lg:hidden text-gray-500 hover:text-gray-700">
                <Menu size={24} />
              </button>
              <h1 className="text-2xl font-bold text-gray-800">Automation System</h1>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-6 md:p-8">
          <Routes>
            <Route index element={<AutomationLogsDashboard />} />
            <Route path="list" element={<AutomationLogsList />} />
            {/* fluidadmin counts as a ticket manager server-side, so this view can
                see every ticket and change status. */}
            <Route path="tickets" element={<TicketsPage userRole={user?.role} user={user} />} />
            <Route path="*" element={<Navigate to="/automation-logs" replace />} />
          </Routes>
        </main>
      </div>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}
    </div>
  );
};
