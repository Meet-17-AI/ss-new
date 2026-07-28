import React, { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, ExternalLink, Plus } from 'lucide-react';
import { ReportIssuePage } from './ReportIssuePage';

interface Attachment {
  url: string;
  name: string | null;
}

interface Ticket {
  id: number;
  subject: string;
  component: string;
  description: string;
  screenshot_url: string | null;
  attachments?: Attachment[];
  reported_by: string;
  user_role: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
}

/** Old tickets predate the attachments table and only have screenshot_url. */
const ticketAttachments = (t: Ticket): Attachment[] => {
  if (t.attachments && t.attachments.length > 0) return t.attachments;
  return t.screenshot_url ? [{ url: t.screenshot_url, name: null }] : [];
};

const STATUSES: { key: string; label: string; cls: string }[] = [
  { key: 'open', label: 'Open', cls: 'bg-blue-100 text-blue-700' },
  { key: 'in_progress', label: 'Working On It', cls: 'bg-amber-100 text-amber-800' },
  { key: 'resolved', label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700' },
  { key: 'closed', label: 'Closed', cls: 'bg-gray-200 text-gray-600' },
];
const statusMeta = (k: string) => STATUSES.find(s => s.key === k) || { key: k, label: k, cls: 'bg-gray-100 text-gray-600' };
const fmt = (d: string | null) => d ? new Date(d).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const TicketsPage: React.FC<{ userRole?: string; user?: any }> = ({ userRole = 'admin', user }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState('');
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  // Authoritative — the server decides this from the token. Never infer it from a prop.
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // No reported_by param: ownership scoping is applied server-side from the
      // auth token. Sending it here would have been advisory at best.
      const res = await fetch(`/api/report-issues?status=${filter}`);
      const data = await res.json();
      setTickets(data.tickets || []);
      setCounts(data.counts || {});
      setCanManage(Boolean(data.canManage));
    } catch (e) {
      console.error('Failed to load tickets', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const patchTicket = async (id: number, body: any) => {
    const res = await fetch(`/api/report-issues/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setTickets(prev => prev.map(t => (t.id === id ? data.ticket : t)));
      setSelected(prev => (prev && prev.id === id ? data.ticket : prev));
      // status change can move a ticket in/out of the current filter → refresh counts
      load();
      return data.ticket as Ticket;
    }
    return null;
  };

  const changeStatus = (t: Ticket, status: string) => patchTicket(t.id, { status });

  const openDetail = (t: Ticket) => { setSelected(t); setDraftNotes(t.notes || ''); };

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Support Tickets</h1>
          <p className="text-gray-600">Issues reported from the panel — track and resolve them here.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-2 border rounded-lg px-4 py-2 bg-white hover:bg-gray-50 text-sm">
            <RefreshCw size={16} /> Refresh
          </button>
          <button 
            onClick={() => setIsCreatingTicket(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 bg-teal-700 text-white hover:bg-teal-800 text-sm font-medium"
          >
            <Plus size={16} /> Create Ticket
          </button>
        </div>
      </div>

      {isCreatingTicket ? (
        <div className="bg-white rounded-xl border shadow-sm flex-1 flex flex-col overflow-hidden h-[calc(100vh-200px)]">
          <div className="flex-1 overflow-auto relative">
            <ReportIssuePage 
              onBack={() => { setIsCreatingTicket(false); load(); }} 
              userInfo={{
                // Display only — the server takes the real identity from the token.
                // The role picks which component list the dropdown shows, so it must
                // be the actual role, not a manage/can't-manage split.
                username: user?.username || user?.full_name || 'Admin',
                role: user?.role || userRole
              }}
              hideHeader={false}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-full text-sm font-medium border ${filter === 'all' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600'}`}>
          All ({totalCount})
        </button>
        {STATUSES.map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)} className={`px-3 py-1.5 rounded-full text-sm font-medium border ${filter === s.key ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-600'}`}>
            {s.label} ({counts[s.key] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 py-12 text-center">Loading tickets…</div>
      ) : tickets.length === 0 ? (
        <div className="text-gray-500 py-12 text-center border rounded-lg bg-gray-50">No tickets{filter !== 'all' ? ` with status "${statusMeta(filter).label}"` : ''}.</div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-4 py-3 font-semibold">Component</th>
                <th className="px-4 py-3 font-semibold">Reported by</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Raised</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(t)}>
                  <td className="px-4 py-3 text-gray-500">{t.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{t.subject}</td>
                  <td className="px-4 py-3 text-gray-600">{t.component}</td>
                  <td className="px-4 py-3 text-gray-600">{t.reported_by}<span className="text-gray-400"> · {t.user_role}</span></td>
                  <td className="px-4 py-3"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusMeta(t.status).cls}`}>{statusMeta(t.status).label}</span></td>
                  <td className="px-4 py-3 text-gray-500">{fmt(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start p-5 border-b sticky top-0 bg-white">
              <div>
                <div className="text-xs text-gray-400 mb-1">Ticket #{selected.id}</div>
                <h2 className="text-lg font-semibold text-gray-800">{selected.subject}</h2>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-gray-400 text-xs">Component</div><div className="text-gray-800">{selected.component}</div></div>
                <div><div className="text-gray-400 text-xs">Reported by</div><div className="text-gray-800">{selected.reported_by} ({selected.user_role})</div></div>
                <div><div className="text-gray-400 text-xs">Raised</div><div className="text-gray-800">{fmt(selected.created_at)}</div></div>
                <div><div className="text-gray-400 text-xs">Last updated</div><div className="text-gray-800">{fmt(selected.updated_at)}</div></div>
                {selected.resolved_at && <div><div className="text-gray-400 text-xs">Resolved</div><div className="text-gray-800">{fmt(selected.resolved_at)}</div></div>}
              </div>

              <div>
                <div className="text-gray-400 text-xs mb-1">Description</div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border">{selected.description}</div>
              </div>

              {ticketAttachments(selected).length > 0 && (
                <div>
                  <div className="text-gray-400 text-xs mb-2">
                    Screenshots ({ticketAttachments(selected).length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ticketAttachments(selected).map((a, i) => (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative block border rounded-lg overflow-hidden hover:border-teal-500"
                        title={a.name || `Screenshot ${i + 1}`}
                      >
                        <img src={a.url} alt={a.name || `Screenshot ${i + 1}`} className="w-full h-24 object-cover" />
                        <span className="absolute bottom-1 right-1 bg-white/90 rounded px-1.5 py-0.5 text-[10px] text-teal-700 inline-flex items-center gap-1">
                          <ExternalLink size={10} /> Open
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-gray-400 text-xs mb-2">Status</div>
                <div className="flex gap-2 flex-wrap">
                  {STATUSES.map(s => (
                    <button key={s.key} 
                      onClick={() => canManage && changeStatus(selected, s.key)}
                      disabled={!canManage}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${selected.status === s.key ? s.cls + ' ring-2 ring-offset-1 ring-teal-500' : 'bg-white text-gray-500'} ${!canManage && selected.status !== s.key ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-gray-400 text-xs mb-1">Internal notes</div>
                <textarea value={draftNotes} onChange={e => setDraftNotes(e.target.value)} rows={4}
                  disabled={!canManage}
                  className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100 disabled:text-gray-500"
                  placeholder={!canManage ? "Internal notes are read-only" : "Add resolution notes, root cause, who's handling it…"} />
                {canManage && (
                  <button
                    disabled={savingNotes}
                    onClick={async () => { setSavingNotes(true); await patchTicket(selected.id, { notes: draftNotes }); setSavingNotes(false); }}
                    className="mt-2 bg-teal-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-teal-800 disabled:opacity-60">
                    {savingNotes ? 'Saving…' : 'Save notes'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default TicketsPage;
