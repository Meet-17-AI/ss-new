import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, X, Globe, Shield, Stethoscope, Zap, Code, AlertTriangle } from 'lucide-react';

/**
 * Superadmin activity log viewer.
 *
 * Five sources, three backing tables: request-level activity (activity_logs,
 * split by category), automation (automation_logs) and API/webhook traffic
 * (webhook_api_logs). The backend keeps them separate rather than merging, so
 * each keeps its own detail.
 */

type TabKey = 'public_booking' | 'admin' | 'therapist' | 'automation' | 'api';

const TABS: { key: TabKey; label: string; icon: React.ElementType; source: string }[] = [
  { key: 'public_booking', label: 'Public Bookings', icon: Globe, source: 'activity' },
  { key: 'admin', label: 'Admin', icon: Shield, source: 'activity' },
  { key: 'therapist', label: 'Therapist', icon: Stethoscope, source: 'activity' },
  { key: 'automation', label: 'Automation', icon: Zap, source: 'automation' },
  { key: 'api', label: 'API & Webhooks', icon: Code, source: 'api' },
];

const PAGE_SIZE = 50;

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }) : '—';

/** Colour by outcome, so failures are findable at a glance. */
const statusClass = (code: number | null, status?: string) => {
  if (status) return status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700';
  if (code == null) return 'bg-gray-100 text-gray-600';
  if (code >= 500) return 'bg-red-100 text-red-700';
  if (code >= 400) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-700';
};

export const ActivityLogsPage: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('admin');
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [selected, setSelected] = useState<any | null>(null);

  // Debounce so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const meta = TABS.find(t => t.key === tab)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        source: meta.source,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (meta.source === 'activity') params.set('category', tab);
      if (debounced) params.set('search', debounced);

      const res = await fetch(`/api/activity-logs?${params}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Failed to load logs', e);
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [tab, page, debounced, meta.source]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/activity-logs/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, [tab]);

  const switchTab = (k: TabKey) => { setTab(k); setPage(0); setSearch(''); };

  const countFor = (k: TabKey): number | null => {
    if (!stats) return null;
    if (k === 'automation') return stats.automation?.total ?? null;
    if (k === 'api') return stats.api?.total ?? null;
    return stats.categories?.[k]?.total ?? 0;
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isActivity = meta.source === 'activity';

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Activity Logs</h1>
          <p className="text-gray-600 text-sm mt-1">
            Every action across the panel — who did what, and when.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 border rounded-lg px-4 py-2 bg-white hover:bg-gray-50 text-sm"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Header cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Actions today</div>
            <div className="text-2xl font-bold text-gray-800">
              {Object.values(stats.categories || {}).reduce((a: number, c: any) => a + (c.today || 0), 0)}
            </div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Failures (24h)</div>
            <div className={`text-2xl font-bold ${stats.failures24h > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {stats.failures24h}
            </div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Automation failed</div>
            <div className={`text-2xl font-bold ${stats.automation?.failed > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {stats.automation?.failed ?? 0}
            </div>
          </div>
          <div className="bg-white border rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">API failed</div>
            <div className={`text-2xl font-bold ${stats.api?.failed > 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {stats.api?.failed ?? 0}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const n = countFor(t.key);
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                tab === t.key
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={15} />
              {t.label}
              {n !== null && (
                <span className={`text-xs ${tab === t.key ? 'text-teal-100' : 'text-gray-400'}`}>
                  ({n})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={isActivity ? 'Search by user, action or path…' : 'Search…'}
          className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-500 text-sm">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-500 text-sm">
            No {meta.label.toLowerCase()} activity recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold whitespace-nowrap">When</th>
                  {isActivity && <th className="px-4 py-3 font-semibold">Who</th>}
                  <th className="px-4 py-3 font-semibold">Action</th>
                  {!isActivity && <th className="px-4 py-3 font-semibold">Target</th>}
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {isActivity && <th className="px-4 py-3 font-semibold whitespace-nowrap">Time</th>}
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr
                    key={l.id}
                    onClick={() => setSelected(l)}
                    className="border-t hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(l.created_at)}</td>
                    {isActivity && (
                      <td className="px-4 py-3">
                        {l.actor_name ? (
                          <>
                            <span className="text-gray-800 font-medium">{l.actor_name}</span>
                            <span className="text-gray-400 text-xs"> · {l.actor_role}</span>
                          </>
                        ) : (
                          <span className="text-gray-400 italic">anonymous</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-800 font-mono text-xs">{l.action}</td>
                    {!isActivity && (
                      <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-xs">
                        {l.recipient || l.endpoint || '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusClass(l.status_code, l.status)}`}>
                        {l.status ?? l.status_code ?? '—'}
                      </span>
                    </td>
                    {isActivity && (
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {l.duration_ms != null ? `${l.duration_ms} ms` : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border rounded-lg bg-white disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="px-3 py-1.5 text-gray-500">Page {page + 1} of {totalPages}</span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border rounded-lg bg-white disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div
            className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-start p-5 border-b sticky top-0 bg-white">
              <div>
                <div className="text-xs text-gray-400 mb-1">Log #{selected.id}</div>
                <h2 className="text-base font-semibold text-gray-800 font-mono">{selected.action}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="When" value={fmt(selected.created_at)} />
                <Field label="Status" value={String(selected.status ?? selected.status_code ?? '—')} />
                {selected.actor_name && <Field label="Actor" value={`${selected.actor_name} (${selected.actor_role})`} />}
                {selected.duration_ms != null && <Field label="Duration" value={`${selected.duration_ms} ms`} />}
                {selected.ip_address && <Field label="IP" value={selected.ip_address} />}
                {selected.method && <Field label="Method" value={selected.method} />}
                {selected.entity_type && <Field label="Entity" value={`${selected.entity_type}${selected.entity_id ? ` #${selected.entity_id}` : ''}`} />}
                {selected.recipient && <Field label="Recipient" value={selected.recipient} />}
              </div>

              {selected.path && (
                <div>
                  <div className="text-gray-400 text-xs mb-1">Path</div>
                  <div className="font-mono text-xs bg-gray-50 border rounded p-2 break-all">{selected.path}</div>
                </div>
              )}
              {selected.endpoint && (
                <div>
                  <div className="text-gray-400 text-xs mb-1">Endpoint</div>
                  <div className="font-mono text-xs bg-gray-50 border rounded p-2 break-all">{selected.endpoint}</div>
                </div>
              )}
              {selected.error_message && (
                <div>
                  <div className="text-red-500 text-xs mb-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> Error
                  </div>
                  <div className="text-xs bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
                    {selected.error_message}
                  </div>
                </div>
              )}
              {selected.metadata && (
                <div>
                  <div className="text-gray-400 text-xs mb-1">Metadata</div>
                  <pre className="text-xs bg-gray-50 border rounded p-2 overflow-x-auto">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                    Request bodies are never stored. Only identifiers, statuses and the
                    number of fields changed are recorded, so clinical and personal data
                    stays out of the logs.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-gray-400 text-xs">{label}</div>
    <div className="text-gray-800 break-words">{value}</div>
  </div>
);

export default ActivityLogsPage;
