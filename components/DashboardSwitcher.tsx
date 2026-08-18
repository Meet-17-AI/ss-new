import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SCOPE_LABEL, SCOPE_PATH, sortScopes, type Scope } from '../lib/permissions';

/**
 * Moves between the dashboards a user holds.
 *
 * It navigates, and that is ALL it does — no API call, no token exchange, no
 * "active role" written anywhere. The session is the same session on either side
 * of a switch; only the screen changes. An endpoint that swapped the caller's
 * role for a token saying something else would be a privilege-escalation route
 * guarded by nothing but itself, and it would make the audit log credit actions
 * to a role instead of a person.
 *
 * Renders nothing for the ordinary case of a single dashboard, so the three
 * shells can mount it unconditionally.
 */
export const DashboardSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { scopes } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const held = sortScopes(scopes);
  if (held.length < 2) return null;

  const current = held.find((s) => location.pathname.startsWith(SCOPE_PATH[s]));

  const go = (scope: Scope) => {
    setOpen(false);
    if (scope !== current) navigate(SCOPE_PATH[scope]);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2
                   text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <LayoutGrid size={16} className="text-teal-700" />
        <span className="hidden sm:inline">{current ? SCOPE_LABEL[current] : 'Switch dashboard'}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {open && (
        <div role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border bg-white py-1 shadow-lg">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Switch to
          </p>
          {held.map((scope) => (
            <button
              key={scope}
              role="menuitem"
              onClick={() => go(scope)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm
                          transition-colors hover:bg-teal-50 hover:text-teal-700 ${
                            scope === current ? 'font-semibold text-teal-700' : 'text-gray-700'
                          }`}
            >
              {SCOPE_LABEL[scope]}
              {scope === current && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardSwitcher;
