import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutGrid, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  SCOPE_LABEL, SCOPE_PATH, sortScopes, isExternalScope, handoffToCrm, type Scope,
} from '../lib/permissions';

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
 *
 * Presented for the foot of the sidebar — full width, opening upward. It used to
 * sit in the top-right header beside the account menu, where it read as one more
 * account control rather than as navigation. Switching dashboards is navigation,
 * so it belongs with the nav.
 */
export const DashboardSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { scopes } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Declared up here with the others, NOT beside the handler that uses it.
  //
  // Everything below returns early when the user holds a single dashboard, and a
  // hook after that point is only reached on some renders. Granting or revoking a
  // dashboard changes the scope count live, so the very next render called a
  // different number of hooks than the last and React threw #300, taking the
  // whole page down with it. Hooks are positional: all of them run before any
  // conditional return, or none of this is safe.
  const [leaving, setLeaving] = useState(false);
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

  const go = async (scope: Scope) => {
    setOpen(false);
    if (scope === current) return;

    // The CRM is a different application on a different origin. It cannot read
    // this one's token, so the session is carried across by a one-time ticket
    // rather than by navigating and hoping.
    if (isExternalScope(scope)) {
      setLeaving(true);
      try {
        await handoffToCrm();
        // Deliberately no setLeaving(false): the page is navigating away, and
        // clearing it would flash the button back for a moment first.
      } catch (e: any) {
        setLeaving(false);
        toast.error(e?.message || 'Could not open the CRM.');
      }
      return;
    }

    navigate(SCOPE_PATH[scope]);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={leaving}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5
                   text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50
                   disabled:cursor-wait disabled:opacity-60"
      >
        <LayoutGrid size={16} className="shrink-0 text-teal-700" />
        <span className="flex-1 truncate text-left">
          {leaving ? 'Opening CRM…' : current ? SCOPE_LABEL[current] : 'Switch dashboard'}
        </span>
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>

      {open && (
        // Opens UPWARD: this sits at the bottom of the sidebar, so a downward
        // menu would render off-screen.
        <div role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[13rem] rounded-xl border
                     bg-white py-1 shadow-lg">
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
