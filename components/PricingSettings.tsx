import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  IndianRupee, RefreshCw, Calendar, Clock, Users, X, Search,
  AlertTriangle, Ban, Pencil, Tag, ChevronRight, ChevronLeft, Check,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

interface TherapyPriceRow {
  service_id: number;
  title: string;
  therapist_name: string | null;
  is_active: boolean;
  is_payment_enabled: boolean;
  current_amount: string | null;
  current_since: string | null;
  next_id: number | null;
  next_amount: string | null;
  next_effective_from: string | null;
  next_grandfathers: boolean | null;
  locked_clients: number;
  override_count: number;
}

interface ClientRow {
  email: string;
  phone_digits: string | null;
  name: string | null;
  bookings: number;
  last_therapist: string | null;
}

/** One therapy this client actually books, priced for THEM. */
interface ClientTherapyContext {
  service_id: number;
  title: string;
  therapist_name: string | null;
  bookings: number;
  amount: number;
  list_amount: number;
  price_source: string;
  is_existing_client: boolean;
  existing_override: { id: number; amount: string; reason: string | null } | null;
}

interface ClientContext {
  is_existing_client: boolean;
  total_bookings: number;
  therapies: ClientTherapyContext[];
}

interface OverrideRow {
  id: number;
  client_email: string | null;
  client_name: string | null;
  service_id: number | null;
  service_title: string | null;
  therapist_name: string | null;
  amount: string;
  reason: string | null;
  effective_until: string | null;
  created_by: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const rupees = (v: string | number | null | undefined): string =>
  `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * YYYY-MM-DD from a Date's LOCAL parts.
 *
 * Not toISOString().slice(0,10) — that converts to UTC first, so for the 5.5
 * hours after IST midnight it reports the previous day. "Tomorrow" would come
 * back as today, and a change meant to be scheduled would take effect at once.
 */
const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Parse YYYY-MM-DD as a LOCAL date. Bare `new Date('2026-08-07')` parses as UTC. */
const fromISODate = (s: string): Date => {
  const [y, m, d] = (s || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : new Date();
};

/** Tomorrow — the default for a scheduled change, so it never lands mid-day. */
const defaultEffectiveDate = (): string =>
  toISODate(new Date(Date.now() + 24 * 60 * 60 * 1000));

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* ================================================================== *
 * DateField
 *
 * Replaces <input type="date">. The native picker is browser chrome rendered
 * outside the React tree: when the modal behind it unmounts (a click on the
 * backdrop while the picker is open), Chromium leaves the picker orphaned on
 * screen with no anchor left to dismiss it. This popover lives inside the
 * dialog, so it closes with it and answers to Escape and outside clicks.
 *
 * Past dates are allowed on purpose — backdating a change that has already
 * happened is legitimate, and the resolver handles it (see the created_at
 * comparison in pricing.ts).
 * ================================================================== */

const DateField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = fromISODate(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Capture phase, and stop propagation: Escape should close the calendar
      // first, not the dialog underneath it.
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const selected = value ? fromISODate(value) : null;
  const today = new Date();
  const todayISO = toISODate(today);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shiftMonth = (by: number) => setViewMonth(new Date(year, month + by, 1));

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-left flex items-center justify-between gap-2 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected
            ? selected.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
            : 'Select a date'}
        </span>
        <Calendar size={15} className="text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-[17rem] bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-gray-800">{MONTH_NAMES[month]} {year}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i} className="text-[10px] font-bold text-gray-400 text-center py-1">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} />;
              const iso = toISODate(new Date(year, month, day));
              const isSelected = iso === value;
              const isToday = iso === todayISO;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => { onChange(iso); setOpen(false); }}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-teal-600 text-white'
                      : isToday
                        ? 'text-teal-700 font-bold hover:bg-teal-50'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { onChange(todayISO); setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setOpen(false); }}
              className="text-xs font-semibold text-teal-700 hover:underline"
            >
              Today
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ================================================================== *
 * Change-price modal
 * ================================================================== */

const ChangePriceModal: React.FC<{
  therapy: TherapyPriceRow;
  onClose: () => void;
  onSaved: () => void;
}> = ({ therapy, onClose, onSaved }) => {
  const [amount, setAmount] = useState(String(Number(therapy.current_amount ?? 0)));
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveDate());
  const [grandfather, setGrandfather] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Escape closes the dialog. DateField registers its own Escape handler in the
  // capture phase and stops propagation, so while the calendar is open Escape
  // closes the calendar and leaves the dialog standing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const newAmount = Number(amount);
  const current = Number(therapy.current_amount ?? 0);
  const isRise = Number.isFinite(newAmount) && newAmount > current;

  const save = async () => {
    setError('');
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      setError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: therapy.service_id,
          amount: newAmount,
          effective_from: effectiveFrom,
          grandfather_existing: grandfather,
          note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save price change');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save price change');
    } finally {
      setSaving(false);
    }
  };

  return (
    // Dismiss on mousedown ON THE BACKDROP ITSELF. Using onClick meant a drag
    // that began inside the dialog (selecting text in a field) and released
    // over the backdrop counted as an outside click and closed the dialog,
    // losing whatever had been typed.
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">Change price</h2>
            <p className="text-sm text-gray-500 mt-0.5 truncate">{therapy.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">Current</span>
            <span className="font-semibold text-gray-800">{rupees(therapy.current_amount)}</span>
            <ChevronRight size={16} className="text-gray-300" />
            <span className={`font-bold ${isRise ? 'text-amber-600' : 'text-teal-600'}`}>
              {Number.isFinite(newAmount) ? rupees(newAmount) : '—'}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">New price (₹)</label>
            <input
              type="number" min="0" value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Effective from</label>
            <DateField value={effectiveFrom} onChange={setEffectiveFrom} />
            <p className="text-xs text-gray-400 mt-1">
              Takes effect at 12:00 AM IST on this date. A future date is saved as a scheduled change you can cancel.
            </p>
          </div>

          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox" checked={grandfather}
              onChange={e => setGrandfather(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-teal-600"
            />
            <span className="text-sm">
              <span className="font-medium text-gray-800">Keep existing clients on their current price</span>
              <span className="block text-gray-500 mt-0.5">
                {grandfather
                  ? `${therapy.locked_clients} existing client${therapy.locked_clients === 1 ? '' : 's'} stay at their current rate. Only new clients pay ${Number.isFinite(newAmount) ? rupees(newAmount) : 'the new price'}.`
                  : `Everyone pays the new price, including all ${therapy.locked_clients} existing client${therapy.locked_clients === 1 ? '' : 's'}.`}
              </span>
            </span>
          </label>

          {!grandfather && therapy.locked_clients > 0 && (
            <div className="flex gap-2.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                This releases the protected rate for {therapy.locked_clients} client
                {therapy.locked_clients === 1 ? '' : 's'}. It cannot be undone by cancelling the change afterwards.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Note (optional)</label>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Annual revision 2026"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 bg-white rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={save} disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
            Save price change
          </button>
        </div>
      </div>
    </div>
  );
};

/* ================================================================== *
 * Client-pricing modal
 * ================================================================== */

const ClientPricingModal: React.FC<{
  therapies: TherapyPriceRow[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ therapies, onClose, onSaved }) => {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ClientRow[]>([]);
  const [selected, setSelected] = useState<ClientRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [serviceId, setServiceId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // What each selected client currently books and pays. Fetched once per
  // client; the ref stops the effect re-firing on its own state update.
  const [contexts, setContexts] = useState<Record<string, ClientContext>>({});
  const [loadingContext, setLoadingContext] = useState(false);
  const fetched = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/pricing/clients?search=${encodeURIComponent(search)}`);
        if (res.ok) setResults(await res.json());
      } catch (err) {
        console.error('Client search failed:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Pull each newly selected client's therapies and current prices.
  useEffect(() => {
    const missing = selected.filter(c => !fetched.current.has(c.email));
    if (missing.length === 0) return;
    missing.forEach(c => fetched.current.add(c.email));

    let cancelled = false;
    (async () => {
      setLoadingContext(true);
      const next: Record<string, ClientContext> = {};
      for (const c of missing) {
        try {
          const params = new URLSearchParams({ email: c.email, phone: c.phone_digits || '' });
          const res = await fetch(`/api/admin/pricing/client-context?${params.toString()}`);
          if (res.ok) next[c.email] = await res.json();
        } catch (err) {
          console.error('Client context failed:', err);
        }
      }
      if (!cancelled) {
        setContexts(prev => ({ ...prev, ...next }));
        setLoadingContext(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Auto-select the therapy when every selected client shares exactly one, and
  // seed the amount with what they pay for it today. Both only fill a blank
  // field — a value the admin has already typed is never overwritten.
  useEffect(() => {
    if (selected.length === 0) return;
    const idLists = selected.map(c => (contexts[c.email]?.therapies || []).map(t => t.service_id));
    if (idLists.length === 0 || idLists.some(l => l.length === 0)) return;

    const shared = idLists.reduce((a, b) => a.filter(x => b.includes(x)));
    if (shared.length !== 1) return;

    setServiceId(prev => prev || String(shared[0]));
  }, [contexts, selected]);

  useEffect(() => {
    if (!serviceId || selected.length === 0) return;
    const t = contexts[selected[0].email]?.therapies.find(x => String(x.service_id) === serviceId);
    if (t) setAmount(prev => prev || String(t.amount));
  }, [serviceId, contexts, selected]);

  const toggle = (c: ClientRow) => {
    setSelected(prev =>
      prev.some(p => p.email === c.email) ? prev.filter(p => p.email !== c.email) : [...prev, c]
    );
  };

  // A price above list is almost always a mistake — warn, but let the admin
  // proceed, since a genuine premium rate is theirs to set.
  const chosenTherapy = therapies.find(t => String(t.service_id) === serviceId);
  const listAmount = chosenTherapy ? Number(chosenTherapy.current_amount ?? 0) : null;
  const aboveList = listAmount !== null && Number(amount) > listAmount;

  const save = async () => {
    setError('');
    if (selected.length === 0) return setError('Select at least one client.');
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) return setError('Enter a valid amount.');

    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clients: selected.map(c => ({ email: c.email, phone_digits: c.phone_digits, name: c.name })),
          service_id: serviceId ? Number(serviceId) : null,
          amount: Number(amount),
          reason: reason || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    // Same mousedown-on-backdrop rule as ChangePriceModal — see the comment there.
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Set a price for specific clients</h2>
            <p className="text-sm text-gray-500 mt-0.5">This overrides both the list price and any protected rate.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Clients {selected.length > 0 && <span className="text-teal-600">· {selected.length} selected</span>}
            </label>

            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selected.map(c => (
                  <span key={c.email} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-teal-50 text-teal-700 border border-teal-100">
                    {c.name || c.email}
                    <button onClick={() => toggle(c)} className="hover:text-teal-900"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email or phone..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="mt-2 border border-gray-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-gray-100">
              {searching ? (
                <p className="p-4 text-sm text-gray-400 text-center">Searching...</p>
              ) : results.length === 0 ? (
                <p className="p-4 text-sm text-gray-400 text-center">No clients found.</p>
              ) : (
                results.map(c => {
                  const on = selected.some(p => p.email === c.email);
                  return (
                    <button
                      key={c.email} onClick={() => toggle(c)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 ${on ? 'bg-teal-50/60' : ''}`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-teal-600 border-teal-600' : 'border-gray-300'}`}>
                        {on && <Check size={11} className="text-white" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-800 truncate">{c.name || 'Unnamed'}</span>
                        <span className="block text-xs text-gray-500 truncate">{c.email}</span>
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">{c.bookings} bookings</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* What the selected clients book and pay today, so the admin is not
              setting a price blind. */}
          {selected.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Current pricing for {selected.length === 1 ? 'this client' : 'these clients'}
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {selected.map(c => {
                  const ctx = contexts[c.email];
                  return (
                    <div key={c.email} className="p-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-sm font-medium text-gray-800 truncate">{c.name || c.email}</span>
                        {ctx && (
                          ctx.is_existing_client ? (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-100">
                              Existing · {ctx.total_bookings} booking{ctx.total_bookings === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
                              New client
                            </span>
                          )
                        )}
                      </div>

                      {!ctx ? (
                        <p className="text-xs text-gray-400">{loadingContext ? 'Loading...' : 'Could not load.'}</p>
                      ) : ctx.therapies.length === 0 ? (
                        <p className="text-xs text-gray-400">
                          No active therapies booked. Choose one below and they will pay the price you set.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {ctx.therapies.map(t => (
                            <div key={t.service_id} className="flex items-start justify-between gap-3 text-xs">
                              <span className="min-w-0 flex-1">
                                <span className="text-gray-700 truncate block">{t.title}</span>
                                <span className="text-gray-400">
                                  {t.bookings} booking{t.bookings === 1 ? '' : 's'}
                                  {t.is_existing_client && ' · on existing-client rate'}
                                </span>
                                {/* Only rendered when a custom price is actually
                                    in force for this client on this therapy. */}
                                {t.existing_override && (
                                  <span className="block mt-0.5 text-purple-700 font-medium">
                                    Custom price already set: {rupees(t.existing_override.amount)}
                                    {t.existing_override.reason && ` · ${t.existing_override.reason}`}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="font-bold text-gray-800">{rupees(t.amount)}</span>
                                {t.amount !== t.list_amount && (
                                  <span className="block text-gray-400 line-through">{rupees(t.list_amount)}</span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Applies to</label>
              <select
                value={serviceId} onChange={e => setServiceId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">All therapies</option>
                {therapies.filter(t => t.is_payment_enabled !== false).map(t => (
                  <option key={t.service_id} value={t.service_id}>{t.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Price (₹){listAmount !== null && <span className="text-gray-400 font-normal normal-case tracking-normal"> · list {rupees(listAmount)}</span>}
              </label>
              <input
                type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {aboveList && (
            <div className="flex gap-2.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>This is above the list price of {rupees(listAmount)}. These clients will be charged more than the advertised rate.</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Reason</label>
            <input
              type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="e.g. Financial concession, staff rate"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 bg-white rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={save} disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
            Apply to {selected.length || 0} client{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ================================================================== *
 * Main tab
 * ================================================================== */

export const PricingSettings: React.FC = () => {
  const [therapies, setTherapies] = useState<TherapyPriceRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<TherapyPriceRow | null>(null);
  const [addingClientPrice, setAddingClientPrice] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [tRes, oRes] = await Promise.all([
        fetch('/api/admin/pricing/therapies'),
        fetch('/api/admin/pricing/overrides'),
      ]);
      if (!tRes.ok) throw new Error(`HTTP ${tRes.status}`);
      setTherapies(await tRes.json());
      setOverrides(oRes.ok ? await oRes.json() : []);
    } catch (err) {
      console.error('Error loading pricing:', err);
      setError('Failed to load pricing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revokeSchedule = async (id: number) => {
    if (!window.confirm('Cancel this scheduled price change?')) return;
    await fetch(`/api/admin/pricing/schedule/${id}/revoke`, { method: 'POST' });
    load();
  };

  const revokeOverride = async (id: number) => {
    if (!window.confirm('Remove this client price? They will go back to their normal rate.')) return;
    await fetch(`/api/admin/pricing/overrides/${id}/revoke`, { method: 'POST' });
    load();
  };

  // Free consultations have no price to manage and would only add noise.
  // Deactivated therapies and therapists are already excluded server-side —
  // neither can be booked, so a price for them is not actionable.
  const priced = therapies.filter(t => t.is_payment_enabled !== false);
  const grouped = Object.entries(
    priced.reduce((acc: Record<string, TherapyPriceRow[]>, t) => {
      const key = t.therapist_name || 'Unassigned';
      (acc[key] ||= []).push(t);
      return acc;
    }, {})
  ).sort(([a], [b]) => a.localeCompare(b));

  const totalGrandfathered = priced.reduce((n, t) => n + (t.locked_clients || 0), 0);

  return (
    <div className="p-6 flex flex-col h-full bg-white overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Pricing</h2>
          <p className="text-sm text-gray-500 mt-1">
            Set therapy prices from a chosen date, and give specific clients their own rate.
            {totalGrandfathered > 0 && (
              <span className="text-gray-400"> · {totalGrandfathered} client rates protected.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={() => setAddingClientPrice(true)}
            className="px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 font-medium text-sm rounded-lg flex items-center gap-2 whitespace-nowrap"
          >
            <Pencil size={17} /> Specific Client Price
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <RefreshCw className="animate-spin text-teal-600" size={30} />
          <span className="text-gray-500 font-medium">Loading pricing...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-red-600 font-medium">{error}</p>
          <button onClick={load} className="px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">Retry</button>
        </div>
      ) : (
        <div className="flex-1 space-y-8">
          {/* ---- Therapy prices ---- */}
          <div className="space-y-6">
            {grouped.map(([therapist, rows]) => (
              <div key={therapist}>
                <h3 className="text-sm font-bold text-gray-700 mb-2.5">{therapist}</h3>
                <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {rows.map(t => (
                    <div key={t.service_id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-gray-50/60">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-800 truncate">{t.title}</p>
                        <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock size={12} /> since {shortDate(t.current_since)}
                          </span>
                          {t.locked_clients > 0 && (
                            <span className="flex items-center gap-1 text-teal-700">
                              <Users size={12} /> {t.locked_clients} protected
                            </span>
                          )}
                          {t.override_count > 0 && (
                            <span className="flex items-center gap-1 text-purple-700">
                              <Tag size={12} /> {t.override_count} custom
                            </span>
                          )}
                          {!t.is_active && <span className="text-red-500">therapy deactivated</span>}
                        </div>

                        {t.next_id && (
                          <div className="mt-2 flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2.5 py-1.5 w-fit">
                            <Calendar size={12} className="shrink-0" />
                            <span>
                              Scheduled: {rupees(t.next_amount)} from {shortDate(t.next_effective_from)}
                              {t.next_grandfathers === false && ' · applies to everyone'}
                            </span>
                            <button
                              onClick={() => revokeSchedule(t.next_id!)}
                              className="ml-1 font-semibold hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <span className="text-lg font-bold text-gray-800">{rupees(t.current_amount)}</span>
                        <button
                          onClick={() => setEditing(t)}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm font-medium hover:bg-white hover:border-teal-300"
                        >
                          Change price
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ---- Client-specific pricing ---- */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-1">Client-specific pricing</h3>
            <p className="text-xs text-gray-500 mb-2.5">
              These take priority over the list price and over any protected rate.
            </p>

            {overrides.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
                <Tag size={26} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No client-specific prices set.</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {overrides.map(o => (
                  <div key={o.id} className="p-4 flex items-center gap-3 hover:bg-gray-50/60">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-800 truncate">{o.client_name || o.client_email}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {o.service_title || 'All therapies'}
                        {o.reason && ` · ${o.reason}`}
                        {o.created_by && ` · set by ${o.created_by}`}
                      </p>
                    </div>
                    <span className="text-base font-bold text-purple-700 shrink-0">{rupees(o.amount)}</span>
                    <button
                      onClick={() => revokeOverride(o.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                      title="Remove"
                    >
                      <Ban size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---- How it works ---- */}
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4 leading-relaxed">
            <p className="font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
              <IndianRupee size={13} /> How a client's price is decided
            </p>
            <p>
              A client-specific price wins first. Otherwise, anyone who has already booked that therapy keeps
              the rate they were on when the price changed. Everyone else — including every brand-new client —
              pays the current list price. The amount is always resolved on the server at checkout, so what
              Razorpay charges is exactly what is shown here.
            </p>
          </div>
        </div>
      )}

      {editing && (
        <ChangePriceModal therapy={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
      {addingClientPrice && (
        <ClientPricingModal therapies={priced} onClose={() => setAddingClientPrice(false)} onSaved={load} />
      )}
    </div>
  );
};

export default PricingSettings;
