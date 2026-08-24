import React, { useState, useEffect, useMemo } from 'react';
import {
  X, AlertTriangle, ArrowRight, Check, CalendarClock, Wallet,
  Ban, Info, Loader2, CircleAlert, Users
} from 'lucide-react';
import { resolveMediaUrl } from '../lib/mediaUrl';

type Step = 'loading' | 'clients' | 'therapist' | 'sessions' | 'review' | 'confirm';
type ActionKind = 'keep' | 'move' | 'cancel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  therapistId: string;
  therapistName: string;
  onDeactivated: () => void;
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

export const DeactivateTherapistWizard: React.FC<Props> = ({
  isOpen, onClose, therapistId, therapistName, onDeactivated
}) => {
  const [step, setStep] = useState<Step>('loading');
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  
  const [therapists, setTherapists] = useState<any[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  
  const [previews, setPreviews] = useState<any[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  
  const [decisions, setDecisions] = useState<Record<string, { action: ActionKind; newStartMs?: number }>>({});
  const [reason, setReason] = useState('Therapist deactivated');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const resetBatch = () => {
    setSelectedClients(new Set());
    setSelectedTargetId('');
    setPreviews([]);
    setPreviewError(null);
    setDecisions({});
    setSubmitError(null);
    setIdempotencyKey(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dt-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
  };

  const fetchUpcomingClients = async () => {
    try {
      const res = await fetch(`/api/therapists/${encodeURIComponent(therapistId)}/clients`);
      if (!res.ok) throw new Error('Failed to fetch clients');
      const data = await res.json();
      const enriched = data.map((c: any, i: number) => ({ ...c, id: `client-${i}` }));
      setClients(enriched);
      
      if (enriched.length === 0) {
        setStep('confirm');
      } else {
        setStep('clients');
      }
    } catch (e) {
      console.error(e);
      setPreviewError('Could not load clients. Please try again later.');
      setStep('clients'); // fallback so the error is visible and not stuck loading
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setStep('loading');
    resetBatch();
    
    // Load target therapists
    fetch('/api/therapists')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setTherapists(Array.isArray(d) ? d : []))
      .catch(() => setTherapists([]));
      
    fetchUpcomingClients();
  }, [isOpen, therapistId]);

  const selectableTherapists = useMemo(
    () => therapists.filter(t => String(t.therapist_id) !== String(therapistId)),
    [therapists, therapistId]
  );

  const toggleClient = (id: string) => {
    const next = new Set(selectedClients);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClients(next);
  };

  const loadPreviews = async () => {
    setPreviewing(true);
    setPreviewError(null);
    setPreviews([]);
    
    const clientsToPreview = clients.filter(c => selectedClients.has(c.id));
    
    try {
      const results = await Promise.all(
        clientsToPreview.map(c => 
          fetch('/api/transfer-client/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientName: c.invitee_name,
              clientEmail: c.invitee_email,
              clientPhone: c.invitee_phone,
              fromTherapistName: therapistName,
              fromTherapistId: therapistId,
              toTherapistId: selectedTargetId,
            }),
          }).then(r => r.ok ? r.json() : Promise.reject(new Error('Preview failed')))
        )
      );
      
      // Inject client info into the preview data so we know who is who in the UI
      const enrichedResults = results.map((res, i) => ({
        ...res,
        client: clientsToPreview[i]
      }));
      
      setPreviews(enrichedResults);
      
      const seeded: Record<string, { action: ActionKind; newStartMs?: number }> = {};
      for (const res of enrichedResults) {
        for (const s of res.upcoming || []) {
          seeded[s.bookingId] = s.recommendedAction === 'move'
            ? { action: 'move', newStartMs: s.suggestedSlots[0] }
            : { action: (s.recommendedAction === 'blocked' ? 'keep' : s.recommendedAction) as ActionKind };
        }
      }
      setDecisions(seeded);
      setStep('sessions');
    } catch (e) {
      setPreviewError('Could not check transfers. Some data might be missing or conflicting.');
    } finally {
      setPreviewing(false);
    }
  };

  const executeTransfers = async () => {
    setSubmitting(true);
    setSubmitError(null);
    
    const clientsToTransfer = clients.filter(c => selectedClients.has(c.id));
    
    try {
      for (let i = 0; i < clientsToTransfer.length; i++) {
        const c = clientsToTransfer[i];
        const preview = previews[i];
        
        // Filter decisions for just this client's bookings
        const clientBookingIds = new Set(preview.upcoming.map((s: any) => s.bookingId));
        const clientDecisions = preview.upcoming.map((s: any) => ({
          bookingId: s.bookingId,
          action: decisions[s.bookingId]?.action || 'keep',
          newStartMs: decisions[s.bookingId]?.newStartMs,
        }));
        
        const r = await fetch('/api/transfer-client/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: `${idempotencyKey}-${i}`,
            toTherapistId: selectedTargetId,
            reason: reason,
            clientName: c.invitee_name,
            clientEmail: c.invitee_email,
            clientPhone: c.invitee_phone,
            fromTherapistName: therapistName,
            fromTherapistId: therapistId,
            decisions: clientDecisions,
          }),
        });
        
        if (!r.ok) {
          const data = await r.json();
          throw new Error(data.message || data.error || `Transfer failed for ${c.invitee_name}`);
        }
      }
      
      // All successful! Reset batch and fetch clients again to see who is left
      resetBatch();
      setStep('loading');
      await fetchUpcomingClients();
      
    } catch (e: any) {
      setSubmitError(e.message || 'Could not reach the server. Transfer halted.');
    } finally {
      setSubmitting(false);
    }
  };

  const executeDeactivation = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/therapists/${encodeURIComponent(therapistId)}/deactivate`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error('Failed to deactivate');
      onDeactivated();
    } catch (e: any) {
      setSubmitError(e.message || 'Failed to deactivate therapist');
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const combinedUpcoming = previews.flatMap(p => 
    (p.upcoming || []).map((s: any) => ({ ...s, client: p.client }))
  );
  
  const targetTherapist = therapists.find(t => String(t.therapist_id) === String(selectedTargetId));

  const decisionProblem = (s: any): string | null => {
    const d = decisions[s.bookingId];
    if (!d) return 'Choose what happens to this session.';
    if (d.action === 'cancel' && !s.money.cancellable) return s.money.detail;
    if (d.action === 'move' && !d.newStartMs) return 'Pick a new time for this session.';
    if ((d.action === 'keep' || d.action === 'move') && s.priceDifference > 0) {
      return `Cannot keep or move an upgrade session (+₹${s.priceDifference}). Please cancel and settle it instead.`;
    }
    if (d.action === 'keep' && s.conflict.kind !== 'none' && s.conflict.kind !== 'no_schedule') {
      return `Keeping this time would double-book ${targetTherapist?.name}: ${s.conflict.detail}`;
    }
    return null;
  };
  
  const problems = combinedUpcoming.map(s => decisionProblem(s)).filter(Boolean) as string[];

  const setAction = (bookingId: string, action: ActionKind, session: any) => {
    setDecisions(prev => ({
      ...prev,
      [bookingId]: action === 'move'
        ? { action, newStartMs: prev[bookingId]?.newStartMs ?? session.suggestedSlots[0] }
        : { action },
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden transition-all duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            Deactivate {therapistName}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 bg-white">
          
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
              <Loader2 className="animate-spin" size={24} />
              <span>Checking upcoming sessions...</span>
            </div>
          )}

          {step === 'clients' && (
            <div className="space-y-6">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 flex gap-3 shadow-sm">
                <AlertTriangle size={20} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-1">Cannot deactivate yet</p>
                  <p className="text-sm">
                    {therapistName} has {clients.length} assigned client{clients.length !== 1 ? 's' : ''}. 
                    You must transfer these clients before the therapist can be deactivated.
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Users size={16} />
                  1. Select clients to transfer as a group
                </h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 w-10">
                          <input 
                            type="checkbox" 
                            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                            checked={selectedClients.size === clients.length && clients.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedClients(new Set(clients.map(c => c.id)));
                              } else {
                                setSelectedClients(new Set());
                              }
                            }}
                          />
                        </th>
                        <th className="px-4 py-3 font-medium">Client</th>
                        <th className="px-4 py-3 font-medium text-right">Upcoming Sessions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {clients.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <input 
                              type="checkbox" 
                              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                              checked={selectedClients.has(c.id)}
                              onChange={() => toggleClient(c.id)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{c.invitee_name}</p>
                            <p className="text-xs text-gray-500">{c.invitee_email}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="inline-flex items-center justify-center bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-teal-100">
                              {c.upcoming_sessions}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-gray-800 mb-3">
                  2. Select target therapist for this group
                </h4>
                <select
                  value={selectedTargetId}
                  onChange={e => setSelectedTargetId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 shadow-sm"
                >
                  <option value="">Choose a therapist…</option>
                  {selectableTherapists.map(t => (
                    <option key={t.therapist_id} value={t.therapist_id}>
                      {t.full_name || t.name}
                      {t.specialization ? ` — ${t.specialization}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              {previewError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200 flex items-center gap-2">
                  <X size={16} /> {previewError}
                </div>
              )}
            </div>
          )}

          {step === 'sessions' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                  Transferring {selectedClients.size} client(s) to {targetTherapist?.name}
                </h4>
                <button 
                  onClick={() => setStep('clients')}
                  className="text-sm text-teal-600 hover:text-teal-800 font-medium px-3 py-1 bg-teal-50 rounded-full hover:bg-teal-100 transition-colors"
                >
                  Back to client list
                </button>
              </div>

              <div className="space-y-6">
                {combinedUpcoming.length === 0 ? (
                  <div className="p-8 text-center bg-gray-50 rounded-xl border border-gray-200">
                    <p className="text-gray-600 font-medium">These clients have no upcoming sessions.</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Click "Execute Transfers" to officially assign them to {targetTherapist?.name}. 
                      Their past session history will remain intact.
                    </p>
                  </div>
                ) : (
                  combinedUpcoming.map((s: any) => {
                    const d = decisions[s.bookingId];
                    const problem = decisionProblem(s);
                    const clash = s.conflict.kind !== 'none' && s.conflict.kind !== 'no_schedule';

                  return (
                    <div key={s.bookingId} className="border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                      {/* Session Header with Client info */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4 pb-3 border-b border-gray-100">
                        <div>
                          <p className="font-semibold text-gray-900">{s.sessionName}</p>
                          <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-1">
                            <span className="font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded text-xs">{s.client.invitee_name}</span>
                            {s.whenText}
                          </p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border ${
                            clash ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-teal-50 text-teal-700 border-teal-200'
                          }`}>
                          {CONFLICT_LABEL[s.conflict.kind] || s.conflict.kind}
                        </span>
                      </div>

                      {clash && <p className="text-sm text-amber-800 mb-4 bg-amber-50 p-2.5 rounded-lg border border-amber-100">{s.conflict.detail}</p>}

                      <div className="flex flex-wrap gap-2.5 mt-3">
                        <button
                          onClick={() => setAction(s.bookingId, 'keep', s)}
                          disabled={clash}
                          title={clash ? s.conflict.detail : undefined}
                          className={`px-4 py-2 rounded-lg text-sm border font-medium transition-colors ${
                            d?.action === 'keep'
                              ? 'bg-teal-700 text-white border-teal-700 shadow-sm'
                              : clash
                                ? 'text-gray-400 border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'text-gray-700 hover:bg-gray-50 border-gray-300'
                          }`}
                        >
                          <CalendarClock size={16} className="inline mr-2 -mt-0.5" />
                          Keep this time
                        </button>

                        <button
                          onClick={() => setAction(s.bookingId, 'move', s)}
                          disabled={s.suggestedSlots.length === 0}
                          className={`px-4 py-2 rounded-lg text-sm border font-medium transition-colors ${
                            d?.action === 'move'
                              ? 'bg-teal-700 text-white border-teal-700 shadow-sm'
                              : s.suggestedSlots.length === 0
                                ? 'text-gray-400 border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'text-gray-700 hover:bg-gray-50 border-gray-300'
                          }`}
                        >
                          Move to new time
                        </button>

                        <button
                          onClick={() => setAction(s.bookingId, 'cancel', s)}
                          disabled={!s.money.cancellable}
                          title={!s.money.cancellable ? s.money.detail : undefined}
                          className={`px-4 py-2 rounded-lg text-sm border font-medium transition-colors ${
                            d?.action === 'cancel'
                              ? 'bg-red-600 text-white border-red-600 shadow-sm'
                              : !s.money.cancellable
                                ? 'text-gray-400 border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'text-red-700 border-red-200 hover:bg-red-50 bg-white'
                          }`}
                        >
                          <Ban size={16} className="inline mr-2 -mt-0.5" />
                          Cancel & settle
                        </button>
                      </div>

                      {d?.action === 'move' && s.suggestedSlots.length > 0 && (
                        <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Select new time with {targetTherapist?.name}
                          </label>
                          <select
                            value={d.newStartMs ?? ''}
                            onChange={e => setDecisions(prev => ({
                              ...prev, [s.bookingId]: { action: 'move', newStartMs: Number(e.target.value) },
                            }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-600 shadow-sm bg-white"
                          >
                            {s.suggestedSlots.map((t: number) => (
                              <option key={t} value={t}>{istTime(t)}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="mt-4 pt-4 border-t border-gray-100 flex flex-col gap-2">
                        <div className="flex items-start gap-2 text-sm text-gray-600">
                          <Wallet size={16} className="shrink-0 mt-0.5 text-gray-400" />
                          <span>
                            <strong className="text-gray-800">If cancelled:</strong> {MONEY_LABEL[s.money.outcome]}
                            {s.money.amount > 0 && ` · ₹${s.money.amount.toLocaleString('en-IN')}`}
                            <br />
                            <span className="text-gray-500 text-xs mt-0.5 block">{s.money.detail}</span>
                          </span>
                        </div>
                        {s.priceMessage && (
                          <div className={`flex items-start gap-2 text-sm p-2.5 rounded-lg border ${s.priceDifference > 0 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-teal-50 text-teal-800 border-teal-200'}`}>
                            <CircleAlert size={16} className="shrink-0 mt-0.5" />
                            <span><strong className="font-semibold">Pricing:</strong> {s.priceMessage}</span>
                          </div>
                        )}
                      </div>

                      {problem && d?.action && (
                        <p className="mt-3 text-sm text-red-700 flex items-start gap-2 bg-red-50 p-2.5 rounded-lg border border-red-100">
                          <CircleAlert size={16} className="shrink-0 mt-0.5" />
                          {problem}
                        </p>
                      )}
                    </div>
                  );
                  })
                )}
              </div>
              
              {submitError && (
                <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200 flex items-center gap-2">
                  <X size={18} /> {submitError}
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-2">
                <Check size={32} className="text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Ready to Deactivate</h3>
              <p className="text-gray-600 max-w-md">
                All upcoming sessions have been resolved. {therapistName} can now be safely deactivated.
              </p>
              {submitError && <p className="text-red-600 mt-2">{submitError}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
          <button 
            onClick={onClose} 
            disabled={submitting}
            className="px-5 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
          >
            Cancel
          </button>
          
          {step === 'clients' && (
            <>
              {(() => {
                const totalUpcoming = clients.reduce((sum, c) => sum + parseInt(c.upcoming_sessions || '0', 10), 0);
                return (
                  <button
                    onClick={() => setStep('confirm')}
                    disabled={totalUpcoming > 0}
                    title={totalUpcoming > 0 ? "You must transfer all upcoming sessions first" : ""}
                    className="px-5 py-2 text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Proceed to Deactivate
                  </button>
                );
              })()}
              <button
                onClick={loadPreviews}
                disabled={selectedClients.size === 0 || !selectedTargetId || previewing}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
              >
                {previewing ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {previewing ? 'Checking...' : `Preview Transfers (${selectedClients.size})`}
              </button>
            </>
          )}

          {step === 'sessions' && (
            <button
              onClick={executeTransfers}
              disabled={submitting || problems.length > 0}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {submitting ? 'Transferring...' : 'Execute Transfers'}
            </button>
          )}

          {step === 'confirm' && (
            <button
              onClick={executeDeactivation}
              disabled={submitting}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Ban size={18} />}
              {submitting ? 'Deactivating...' : 'Confirm Deactivation'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
