import React, { useState, useEffect, useMemo } from 'react';
import {
  X, AlertTriangle, ArrowRight, Check, CalendarClock, Wallet,
  Ban, Info, Loader2, CircleAlert,
} from 'lucide-react';

/**
 * Moving a client to a different therapist.
 *
 * WHY A WIZARD AND NOT A DIALOG: a transfer is not one decision. Each of the
 * client's upcoming sessions may or may not clash with the new therapist, and
 * what happens to a session's MONEY differs per session — cash is credited to
 * the wallet, a card payment is refunded through the gateway, and a card payment
 * inside 24 hours returns nothing at all. A single confirm box would have to
 * either hide that or lie about it.
 *
 * The server is the authority throughout. This screen never decides whether a
 * slot is free or whether money can be returned; it renders the preview's
 * answers and sends back choices, which the server re-validates before acting.
 * Anything else would let a stale screen act on a world that has moved on.
 */

type Step = 'therapist' | 'sessions' | 'review' | 'confirm' | 'done';
type ActionKind = 'keep' | 'move' | 'cancel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  client: { invitee_name: string; invitee_email: string; invitee_phone: string } | null;
  currentTherapistName: string | null;
  currentTherapistId?: string | null;
  onTransferred: () => void;
}

const istTime = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

const CONFLICT_LABEL: Record<string, string> = {
  none: 'Available',
  booked: 'Already booked',
  calendar_busy: 'Calendar busy',
  outside_hours: 'Outside working hours',
  day_excluded: 'Not a working day',
  no_schedule: 'Availability unknown',
};

const MONEY_LABEL: Record<string, string> = {
  wallet_credit: 'Credited to wallet',
  gateway_refund: 'Gateway refund',
  forfeit: 'Nothing returned',
  nothing: 'No payment taken',
};

export const TransferClientWizard: React.FC<Props> = ({
  isOpen, onClose, client, currentTherapistName, currentTherapistId, onTransferred,
}) => {
  const [step, setStep] = useState<Step>('therapist');
  const [therapists, setTherapists] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { action: ActionKind; newStartMs?: number }>>({});
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // Generated once per opening. This is what makes a double-clicked confirm or a
  // retried request safe: the server refuses to run the same transfer twice, and
  // a transfer cannot be rolled back once it has touched Google Calendar.
  const [idempotencyKey, setIdempotencyKey] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setStep('therapist');
    setSelectedId('');
    setPreview(null);
    setPreviewError(null);
    setDecisions({});
    setReason('');
    setConfirmText('');
    setResult(null);
    setSubmitError(null);
    setIdempotencyKey(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );

    fetch('/api/therapists')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setTherapists(Array.isArray(d) ? d : []))
      .catch(() => setTherapists([]));
  }, [isOpen]);

  const selectable = useMemo(
    () => therapists.filter(t => {
      if (currentTherapistId) return String(t.therapist_id) !== String(currentTherapistId);
      return (t.full_name || t.name) !== currentTherapistName;
    }),
    [therapists, currentTherapistId, currentTherapistName]
  );

  const loadPreview = async (therapistId: string) => {
    if (!client) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const r = await fetch('/api/transfer-client/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: client.invitee_name,
          clientEmail: client.invitee_email,
          clientPhone: client.invitee_phone,
          fromTherapistName: currentTherapistName,
          fromTherapistId: currentTherapistId ?? null,
          toTherapistId: therapistId,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setPreviewError(data.error || 'Could not check this transfer.'); return; }

      setPreview(data);
      // Preselect what the server recommends, so the common case is one click.
      const seeded: Record<string, { action: ActionKind; newStartMs?: number }> = {};
      for (const s of data.upcoming) {
        seeded[s.bookingId] = s.recommendedAction === 'move'
          ? { action: 'move', newStartMs: s.suggestedSlots[0] }
          : { action: (s.recommendedAction === 'blocked' ? 'keep' : s.recommendedAction) as ActionKind };
      }
      setDecisions(seeded);
    } catch {
      setPreviewError('Could not reach the server to check this transfer.');
    } finally {
      setPreviewing(false);
    }
  };

  const chooseTherapist = (id: string) => {
    setSelectedId(id);
    if (id) loadPreview(id);
  };

  const setAction = (bookingId: string, action: ActionKind, session: any) => {
    setDecisions(prev => ({
      ...prev,
      [bookingId]: action === 'move'
        ? { action, newStartMs: prev[bookingId]?.newStartMs ?? session.suggestedSlots[0] }
        : { action },
    }));
  };

  /** A choice the server would refuse — surfaced here so the admin never hits a wall at the end. */
  const decisionProblem = (s: any): string | null => {
    const d = decisions[s.bookingId];
    if (!d) return 'Choose what happens to this session.';
    if (d.action === 'cancel' && !s.money.cancellable) return s.money.detail;
    if (d.action === 'move' && !d.newStartMs) return 'Pick a new time for this session.';
    // Only a session that was actually PAID for is blocked by an upgrade — the
    // server decides that (`blockedByPrice`), because it depends on whether
    // money really arrived, not merely on the price on the booking. An unpaid
    // session is simply re-quoted at the new therapist's rate.
    if ((d.action === 'keep' || d.action === 'move') && s.blockedByPrice) {
      return s.priceMessage
        || `This session is already paid for and the new therapist charges more. Cancel and settle it instead.`;
    }
    if (d.action === 'keep' && s.conflict.kind !== 'none' && s.conflict.kind !== 'no_schedule') {
      return `Keeping this time would double-book ${preview?.toTherapist?.name}: ${s.conflict.detail}`;
    }
    return null;
  };

  const problems = useMemo(
    () => (preview?.upcoming || []).map((s: any) => decisionProblem(s)).filter(Boolean) as string[],
    [preview, decisions]
  );

  const submit = async () => {
    if (!client || !preview) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch('/api/transfer-client/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          toTherapistId: selectedId,
          reason,
          clientName: client.invitee_name,
          clientEmail: client.invitee_email,
          clientPhone: client.invitee_phone,
          fromTherapistName: preview.fromTherapist?.name ?? currentTherapistName,
          fromTherapistId: preview.fromTherapist?.id ?? currentTherapistId ?? null,
          decisions: preview.upcoming.map((s: any) => ({
            bookingId: s.bookingId,
            action: decisions[s.bookingId]?.action || 'keep',
            newStartMs: decisions[s.bookingId]?.newStartMs,
          })),
        }),
      });
      const data = await r.json();

      if (!r.ok) {
        // A 409 means the world changed under the wizard. Say what happened and
        // send the admin back to re-decide rather than retrying blindly.
        setSubmitError(data.message || data.error || 'The transfer could not be completed.');
        if (data.error === 'conflict' || data.error === 'stale') {
          setStep('sessions');
          loadPreview(selectedId);
        }
        return;
      }

      setResult(data);
      setStep('done');
      onTransferred();
    } catch {
      setSubmitError('Could not reach the server. The transfer was not made.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !client) return null;

  const upcoming = preview?.upcoming || [];
  const hasSessions = upcoming.length > 0;

  const stepOrder: Step[] = hasSessions
    ? ['therapist', 'sessions', 'review', 'confirm']
    : ['therapist', 'review', 'confirm'];

  const goNext = () => {
    const i = stepOrder.indexOf(step);
    if (i >= 0 && i < stepOrder.length - 1) setStep(stepOrder[i + 1]);
  };
  const goBack = () => {
    const i = stepOrder.indexOf(step);
    if (i > 0) setStep(stepOrder[i - 1]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ArrowRight size={18} className="text-teal-700" />
            Transfer {client.invitee_name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {step !== 'done' && (
          <div className="flex gap-1 px-6 pt-4">
            {stepOrder.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${
                  stepOrder.indexOf(step) >= i ? 'bg-teal-700' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        <div className="px-6 py-5 overflow-y-auto flex-1">

          {/* ── 1. Which therapist ─────────────────────────────────────── */}
          {step === 'therapist' && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Currently with <strong>{currentTherapistName || 'no therapist'}</strong>.
                Their past sessions and the notes attached to them stay where they are.
              </p>

              <label className="block text-sm font-medium text-gray-700 mb-2">Transfer to</label>
              <select
                value={selectedId}
                onChange={e => chooseTherapist(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                <option value="">Choose a therapist…</option>
                {selectable.map(t => (
                  <option key={t.therapist_id} value={t.therapist_id}>
                    {t.full_name || t.name}
                    {t.specialization ? ` — ${t.specialization}` : ''}
                  </option>
                ))}
              </select>

              {previewing && (
                <p className="mt-4 text-sm text-gray-500 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Checking their availability…
                </p>
              )}

              {previewError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  {previewError}
                </div>
              )}

              {preview && !previewing && (
                <div className="mt-4 space-y-2">
                  <div className="p-3 bg-gray-50 border rounded text-sm text-gray-700">
                    <strong>{preview.upcoming.length}</strong> upcoming session
                    {preview.upcoming.length === 1 ? '' : 's'} to decide about.{' '}
                    <strong>{preview.pastCount}</strong> past session
                    {preview.pastCount === 1 ? '' : 's'} stay with {preview.fromTherapist.name || 'the current therapist'}.
                  </div>
                  {preview.warnings.map((w: string, i: number) => (
                    <div key={i} className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 flex gap-2">
                      <Info size={15} className="shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── 2. What happens to each session ────────────────────────── */}
          {step === 'sessions' && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Decide each session separately — {preview.toTherapist.name} may be free for some and not others.
              </p>

              <div className="space-y-4">
                {upcoming.map((s: any) => {
                  const d = decisions[s.bookingId];
                  const problem = decisionProblem(s);
                  const clash = s.conflict.kind !== 'none' && s.conflict.kind !== 'no_schedule';

                  return (
                    <div key={s.bookingId} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{s.sessionName}</p>
                          <p className="text-sm text-gray-500">{s.whenText}</p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap border ${
                            clash
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-teal-50 text-teal-700 border-teal-200'
                          }`}
                        >
                          {CONFLICT_LABEL[s.conflict.kind] || s.conflict.kind}
                        </span>
                      </div>

                      {clash && <p className="text-xs text-amber-800 mb-3">{s.conflict.detail}</p>}

                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          onClick={() => setAction(s.bookingId, 'keep', s)}
                          disabled={clash}
                          title={clash ? s.conflict.detail : undefined}
                          className={`px-3 py-1.5 rounded-lg text-sm border ${
                            d?.action === 'keep'
                              ? 'bg-teal-700 text-white border-teal-700'
                              : clash
                                ? 'text-gray-300 border-gray-200 cursor-not-allowed'
                                : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <CalendarClock size={14} className="inline mr-1.5 -mt-0.5" />
                          Keep this time
                        </button>

                        <button
                          onClick={() => setAction(s.bookingId, 'move', s)}
                          disabled={s.suggestedSlots.length === 0}
                          className={`px-3 py-1.5 rounded-lg text-sm border ${
                            d?.action === 'move'
                              ? 'bg-teal-700 text-white border-teal-700'
                              : s.suggestedSlots.length === 0
                                ? 'text-gray-300 border-gray-200 cursor-not-allowed'
                                : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Reschedule
                        </button>

                        <button
                          onClick={() => setAction(s.bookingId, 'cancel', s)}
                          disabled={!s.money.cancellable}
                          title={!s.money.cancellable ? s.money.detail : undefined}
                          className={`px-3 py-1.5 rounded-lg text-sm border ${
                            d?.action === 'cancel'
                              ? 'bg-red-600 text-white border-red-600'
                              : !s.money.cancellable
                                ? 'text-gray-300 border-gray-200 cursor-not-allowed'
                                : 'text-red-700 border-red-200 hover:bg-red-50'
                          }`}
                        >
                          <Ban size={14} className="inline mr-1.5 -mt-0.5" />
                          Cancel &amp; settle
                        </button>
                      </div>

                      {d?.action === 'move' && s.suggestedSlots.length > 0 && (
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">
                            New time with {preview.toTherapist.name}
                            {s.suggestionsAreLaterDays && ' (nothing free on the original day)'}
                          </label>
                          <select
                            value={d.newStartMs ?? ''}
                            onChange={e =>
                              setDecisions(prev => ({
                                ...prev,
                                [s.bookingId]: { action: 'move', newStartMs: Number(e.target.value) },
                              }))
                            }
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                          >
                            {s.suggestedSlots.map((t: number) => (
                              <option key={t} value={t}>{istTime(t)}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* What happens to the money, stated before anything is committed. */}
                      <div className="mt-3 pt-3 border-t flex flex-col gap-2">
                        <div className="flex items-start gap-2 text-xs text-gray-600">
                          <Wallet size={14} className="shrink-0 mt-0.5 text-gray-400" />
                          <span>
                            <strong>If cancelled:</strong> {MONEY_LABEL[s.money.outcome]}
                            {s.money.amount > 0 && ` · ₹${s.money.amount.toLocaleString('en-IN')}`}
                            <br />
                            <span className="text-gray-500">{s.money.detail}</span>
                          </span>
                        </div>
                        {s.priceMessage && (
                          <div className={`flex items-start gap-2 text-xs ${s.priceDifference > 0 ? 'text-amber-700' : 'text-teal-700'}`}>
                            <CircleAlert size={14} className="shrink-0 mt-0.5" />
                            <span><strong>Pricing:</strong> {s.priceMessage}</span>
                          </div>
                        )}
                      </div>

                      {problem && d?.action && (
                        <p className="mt-2 text-xs text-red-700 flex items-start gap-1.5">
                          <CircleAlert size={13} className="shrink-0 mt-0.5" />
                          {problem}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── 3. Review ──────────────────────────────────────────────── */}
          {step === 'review' && (
            <>
              <div className="border rounded-lg divide-y">
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">Client</span>
                  <span className="text-sm font-medium">{client.invitee_name}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">From</span>
                  <span className="text-sm font-medium">{preview.fromTherapist.name || '—'}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">To</span>
                  <span className="text-sm font-medium text-teal-700">{preview.toTherapist.name}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-500">Past sessions</span>
                  <span className="text-sm">{preview.pastCount} — staying with {preview.fromTherapist.name || 'the current therapist'}</span>
                </div>
              </div>

              {hasSessions && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                    Upcoming sessions
                  </p>
                  <div className="border rounded-lg divide-y">
                    {upcoming.map((s: any) => {
                      const d = decisions[s.bookingId];
                      return (
                        <div key={s.bookingId} className="p-3 text-sm">
                          <p className="font-medium text-gray-900">{s.sessionName}</p>
                          <p className="text-gray-500 text-xs">{s.whenText}</p>
                          <p className="mt-1 text-xs">
                            {d?.action === 'keep' && (
                              <span className="text-teal-700">Moves to {preview.toTherapist.name}, same time</span>
                            )}
                            {d?.action === 'move' && (
                              <span className="text-teal-700">
                                Moves to {preview.toTherapist.name} — rescheduled to {istTime(d.newStartMs!)}
                              </span>
                            )}
                            {d?.action === 'cancel' && (
                              <span className="text-red-700">
                                Cancelled · {MONEY_LABEL[s.money.outcome]}
                                {s.money.outcome === 'wallet_credit' && ` (₹${s.money.amount.toLocaleString('en-IN')})`}
                              </span>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {preview.toTherapist.hasCalendar ? (
                <p className="mt-4 text-xs text-gray-500">
                  Each moved session gets a new Google Calendar event and a new meeting link.
                  The client will be emailed the new details.
                </p>
              ) : (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                  {preview.toTherapist.name} has no connected Google Calendar, so moved sessions will
                  not appear on one and will have no meeting link.
                </div>
              )}

              <label className="block text-sm font-medium text-gray-700 mt-4 mb-2">
                Reason <span className="font-normal text-gray-400">(optional, kept in the audit log)</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                placeholder="Why is this client moving?"
              />
            </>
          )}

          {/* ── 4. Confirm ─────────────────────────────────────────────── */}
          {step === 'confirm' && (
            <>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
                <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <p className="font-medium mb-1">This cannot be undone automatically.</p>
                  <p>
                    {upcoming.filter((s: any) => decisions[s.bookingId]?.action !== 'cancel').length} session
                    {upcoming.filter((s: any) => decisions[s.bookingId]?.action !== 'cancel').length === 1 ? '' : 's'} will
                    move to {preview.toTherapist.name}
                    {upcoming.some((s: any) => decisions[s.bookingId]?.action === 'cancel') &&
                      `, and ${upcoming.filter((s: any) => decisions[s.bookingId]?.action === 'cancel').length} will be cancelled`}
                    . Calendar events are re-created, so meeting links change.
                  </p>
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700 mt-5 mb-2">
                Type <span className="font-mono font-semibold">TRANSFER</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="TRANSFER"
              />

              {submitError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  {submitError}
                </div>
              )}
            </>
          )}

          {/* ── 5. What actually happened ──────────────────────────────── */}
          {step === 'done' && result && (
            <>
              <div className="text-center py-2">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
                    result.calendarStatus === 'partial' ? 'bg-amber-100' : 'bg-teal-50'
                  }`}
                >
                  {result.calendarStatus === 'partial'
                    ? <AlertTriangle size={22} className="text-amber-700" />
                    : <Check size={22} className="text-teal-700" />}
                </div>
                <h4 className="text-lg font-semibold text-gray-900">
                  {client.invitee_name} is now with {result.toTherapistName}
                </h4>
                <p className="text-sm text-gray-500 mt-1">
                  {result.bookingsMoved} session{result.bookingsMoved === 1 ? '' : 's'} moved
                  {result.sessionsCancelled > 0 && `, ${result.sessionsCancelled} cancelled`}
                  {result.walletCredited > 0 && ` · ₹${result.walletCredited.toLocaleString('en-IN')} credited`}
                </p>
              </div>

              {/* Deliberately itemised. Calendar and email are best-effort and
                  cannot be rolled back, so a blanket "success" would hide a
                  session that never reached the new therapist's calendar. */}
              {result.outcomes?.length > 0 && (
                <div className="mt-4 border rounded-lg divide-y">
                  {result.outcomes.map((o: any) => (
                    <div key={o.bookingId} className="p-3 text-sm flex items-start gap-2">
                      {o.calendar === 'failed' || o.error
                        ? <CircleAlert size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        : <Check size={15} className="text-teal-600 shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium text-gray-900">{o.sessionName}</p>
                        <p className="text-xs text-gray-500">
                          {o.action === 'cancel' ? 'Cancelled' : 'Moved'}
                          {o.walletCredited ? ` · ₹${o.walletCredited.toLocaleString('en-IN')} to wallet` : ''}
                          {o.calendar === 'skipped' ? ' · no calendar event' : ''}
                          {o.calendar === 'moved' || o.calendar === 'created' ? ' · calendar updated' : ''}
                        </p>
                        {(o.calendarDetail || o.error) && (
                          <p className="text-xs text-amber-800 mt-1">{o.error || o.calendarDetail}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.calendarStatus === 'partial' && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                  At least one calendar event could not be created. Those sessions have moved in the
                  panel but are not on {result.toTherapistName}'s calendar yet — add them manually.
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
          {step === 'done' ? (
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={step === 'therapist' ? onClose : goBack}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {step === 'therapist' ? 'Cancel' : 'Back'}
              </button>

              {step === 'confirm' ? (
                <button
                  onClick={submit}
                  disabled={confirmText !== 'TRANSFER' || submitting}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    confirmText === 'TRANSFER' && !submitting
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {submitting ? 'Transferring…' : 'Transfer client'}
                </button>
              ) : (
                <button
                  onClick={goNext}
                  disabled={
                    !preview || previewing ||
                    (step === 'sessions' && problems.length > 0)
                  }
                  title={step === 'sessions' && problems.length > 0 ? problems[0] : undefined}
                  className={`px-4 py-2 rounded-lg text-sm font-medium ${
                    preview && !previewing && !(step === 'sessions' && problems.length > 0)
                      ? 'bg-teal-700 text-white hover:bg-teal-800'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Continue
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
