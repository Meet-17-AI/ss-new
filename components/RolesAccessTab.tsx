import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, Search, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { SCOPE_LABEL, SCOPE_COLUMN_ORDER, type Scope } from '../lib/permissions';

interface AccessUser {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
  /** What the role comes with. Always held, never removable. */
  baseScopes: Scope[];
  scopes: Scope[];
  /** What this account is eligible to hold at all — see the note on the checkbox. */
  grantable: Scope[];
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  superadmin: 'Super admin',
  therapist: 'Therapist',
  sales: 'Sales',
};

/** Colour the tier so the ladder is readable at a glance, not just sorted. */
const ROLE_STYLE: Record<string, string> = {
  therapist: 'bg-sky-50 text-sky-700 ring-sky-200',
  sales: 'bg-violet-50 text-violet-700 ring-violet-200',
  admin: 'bg-amber-50 text-amber-700 ring-amber-200',
  superadmin: 'bg-teal-50 text-teal-800 ring-teal-300',
};

/**
 * Who can open which dashboard.
 *
 * Visible only to the AI team. That is enforced on the server for both reading
 * and writing — this component hiding itself only decides whether the tab is
 * worth rendering, exactly as with the calendar disconnect control.
 */
export const RolesAccessTab: React.FC = () => {
  const { canManageAccess, refreshAccess, user: me } = useAuth();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/access-grants');
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? 'This account cannot manage dashboard access.'
            : `Could not load users (HTTP ${res.status})`
        );
      }
      const data = await res.json();
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (target: AccessUser, scope: Scope, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...target.scopes, scope]))
      : target.scopes.filter((s) => s !== scope);

    const previous = users;
    // Optimistic, then reconciled from the server's answer — the server is the
    // one that decides what was actually stored.
    setUsers((list) => list.map((u) => (u.id === target.id ? { ...u, scopes: next } : u)));
    setSavingId(target.id);

    try {
      const res = await fetch(`/api/admin/access-grants/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Could not save (HTTP ${res.status})`);

      setUsers((list) =>
        list.map((u) => (u.id === target.id ? { ...u, scopes: data.scopes ?? next } : u))
      );
      toast.success(
        `${SCOPE_LABEL[scope]} ${checked ? 'granted to' : 'removed from'} ${target.name}`
      );

      // If the AI team member changed their OWN access, their switcher and route
      // guards are now stale until this is re-read.
      if (String(target.id) === String(me?.id)) refreshAccess();
    } catch (e: any) {
      setUsers(previous);
      toast.error(e?.message || 'Could not save the change.');
    } finally {
      setSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.name, u.username, u.email, u.role].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [users, query]);

  if (!canManageAccess) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-sm">
          <ShieldCheck size={28} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">
            Dashboard access is managed by the AI team.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <Loader2 size={24} className="animate-spin text-teal-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-sm">
          <AlertTriangle size={26} className="mx-auto mb-3 text-rose-500" />
          <p className="text-sm text-gray-600">{error}</p>
          <button onClick={load}
            className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Dashboard access</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Tick a dashboard to let someone open it. Whatever comes with their role is always
            on and cannot be removed. <span className="font-medium text-gray-600">Superadmin</span> opens
            the clinic configuration past the payments page — user settings, organisation
            settings, pricing and the therapist roster. Changes apply the next time they load
            a page — no re-login needed.
          </p>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or role"
            className="w-64 rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm
                       focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              {SCOPE_COLUMN_ORDER.map((scope) => (
                <th key={scope} className="px-4 py-3 text-center font-semibold">
                  {SCOPE_LABEL[scope]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((u) => (
              <tr key={u.id} className={`hover:bg-gray-50 ${u.isActive ? '' : 'opacity-60'}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.email || u.username}</div>
                  {!u.isActive && (
                    <span className="mt-1 inline-block rounded bg-gray-200 px-1.5 py-0.5 text-[10px]
                                     font-semibold uppercase text-gray-600">
                      Disabled
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold
                                    ring-1 ring-inset ${ROLE_STYLE[String(u.role).toLowerCase()]
                                      || 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
                    {ROLE_LABEL[String(u.role).toLowerCase()] || u.role}
                  </span>
                </td>

                {SCOPE_COLUMN_ORDER.map((scope) => {
                  const held = u.scopes.includes(scope);
                  const isBase = u.baseScopes.includes(scope);
                  // Not eligible at all — an admin has no therapist profile, so a
                  // therapist dashboard would have nothing to scope to. Shown as a
                  // dash rather than a disabled box, which would read as "off".
                  const eligible = u.grantable.includes(scope);

                  if (!eligible && !isBase) {
                    return (
                      <td key={scope} className="px-4 py-3 text-center text-gray-300"
                        title={
                          scope === 'superadmin'
                            // Not a tidiness rule. Super admin carries every client's
                            // clinical record along with the clinic configuration, so
                            // it is not something a checkbox hands to a clinician.
                            ? 'Super admin is only available to administrator accounts'
                            : `Not available for a ${ROLE_LABEL[String(u.role).toLowerCase()] || u.role}`
                        }>
                        —
                      </td>
                    );
                  }

                  return (
                    <td key={scope} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={held}
                        // What the role comes with is locked on. Allowing it off
                        // would let a save leave someone with nowhere to land, or
                        // strip a superadmin of the tab they are standing in.
                        disabled={isBase || savingId === u.id}
                        onChange={(e) => save(u, scope, e.target.checked)}
                        title={isBase ? 'Comes with the role — always on' : undefined}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-teal-600
                                   accent-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={2 + SCOPE_COLUMN_ORDER.length} className="px-4 py-10 text-center text-gray-500">
                  No users match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RolesAccessTab;
