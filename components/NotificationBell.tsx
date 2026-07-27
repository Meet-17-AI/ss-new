import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';

interface Notification {
  notification_id: number;
  notification_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationBellProps {
  userId: string;
  userRole: string;
  onViewAll: () => void;
}

const formatTime = (timestamp: string) => {
  if (!timestamp) return '';
  const date = timestamp.includes('Z') || timestamp.includes('+')
    ? new Date(timestamp)
    : new Date(timestamp + 'Z');
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
};

export const NotificationBell: React.FC<NotificationBellProps> = ({ userId, userRole, onViewAll }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`/api/notifications?user_id=${userId}&user_role=${userRole}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (userId) fetchNotifications();
    const interval = setInterval(() => { if (userId) fetchNotifications(); }, 60000);
    return () => clearInterval(interval);
  }, [userId, userRole]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const latest = notifications.slice(0, 3);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors relative"
        title="Notifications"
      >
        <Bell size={24} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none shadow border-2 border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs text-teal-700 font-medium">{unreadCount} unread</span>
            )}
          </div>

          {latest.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y max-h-72 overflow-y-auto">
              {latest.map(n => (
                <div
                  key={n.notification_id}
                  className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${!n.is_read ? 'border-l-4 border-l-teal-600' : ''}`}
                  onClick={() => { setOpen(false); onViewAll(); }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium leading-snug ${!n.is_read ? 'text-gray-900' : 'text-gray-600'}`}>
                      {n.title}
                    </p>
                    <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">{formatTime(n.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-t">
            <button
              onClick={() => { setOpen(false); onViewAll(); }}
              className="w-full text-sm text-teal-700 hover:text-teal-800 font-medium text-center"
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
