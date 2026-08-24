import React, { useState, useEffect, useCallback } from 'react';
import { Loader, Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight, Plus, HandCoins } from 'lucide-react';
import { WalletAdjustModal, WalletAdjustMode } from './WalletAdjustModal';

/**
 * Wallet tab on the client profile.
 *
 * Shows what the client currently holds and, for every movement, WHICH booking
 * put it there or took it away — a cancelled Cash/QR session that credited the
 * wallet, or a later booking that spent it. The booking context is what makes
 * this answerable when a client asks "where did my credit come from".
 */

interface ClientWalletTabProps {
  clientPhone?: string | null;
  clientEmail?: string | null;
  clientName?: string | null;
}

interface WalletTxn {
  txn_id: number;
  direction: 'CREDIT' | 'DEBIT';
  reason: string;
  amount: number | string;
  balance_after: number | string;
  source_booking_id?: string | null;
  source_payment_mode?: string | null;
  notes?: string | null;
  created_by_name?: string | null;
  created_at: string;
  booking_session_name?: string | null;
  booking_session_time?: string | null;
  booking_start_at?: string | null;
  booking_status?: string | null;
  booking_therapist_name?: string | null;
}

const REASON_LABELS: Record<string, string> = {
  CANCELLATION_CREDIT: 'Added from cancelled session',
  BOOKING_SETTLEMENT: 'Redeemed on booking',
  REFUND_OUT: 'Encashed — paid back to client',
  MANUAL_ADJUSTMENT: 'Manual adjustment',
  // Written when a client is transferred to a therapist who charges less.
  TRANSFER_ADJUSTMENT: 'Price difference on transfer',
};

const formatMoney = (v: number | string | null | undefined): string =>
  `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Timestamps are stored as IST wall-clock in a timestamp column, so they arrive
// as a UTC-looking string. Formatting in UTC prints the stored value as-is
// instead of letting the browser add another +5:30. Same approach as the
// payments screens.
const formatDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'UTC',
  });
};

// Strip the trailing " with <therapist>" so the session reads as its type.
const cleanSessionName = (raw?: string | null): string => {
  if (!raw) return 'Session';
  return raw.split(/\s+with\s+/i)[0].trim() || 'Session';
};

export const ClientWalletTab: React.FC<ClientWalletTabProps> = ({ clientPhone, clientEmail, clientName }) => {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTxn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState<WalletAdjustMode | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  /**
   * Reading the ledger. Pulled out of the effect so an adjustment can re-run it:
   * the balance and the activity list are both derived from these rows, so
   * re-fetching is what keeps the header, the totals and the list in agreement
   * after a movement.
   */
  const load = useCallback(async () => {
    if (!clientPhone && !clientEmail) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (clientPhone) params.set('phone', clientPhone);
      if (clientEmail) params.set('email', clientEmail);
      params.set('limit', '100');

      const res = await fetch(`/api/wallet/transactions?${params.toString()}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setBalance(Number(data?.balance) || 0);
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch (err) {
      setError('Could not load wallet details.');
      console.error('[ClientWalletTab] Error loading wallet:', err);
    } finally {
      setLoading(false);
    }
  }, [clientPhone, clientEmail]);

  useEffect(() => {
    let cancelled = false;
    // Guards against a stale response from a previously-selected client
    // overwriting the current one.
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [load]);

  const totalCredited = transactions
    .filter(t => t.direction === 'CREDIT')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalRedeemed = transactions
    .filter(t => t.direction === 'DEBIT')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="animate-spin text-teal-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg p-5 text-white" style={{ backgroundColor: '#21615D' }}>
          <div className="flex items-center gap-2 mb-1">
            <WalletIcon size={16} />
            <p className="text-xs uppercase tracking-wider opacity-80">Wallet Balance</p>
          </div>
          <p className="text-3xl font-bold">{formatMoney(balance)}</p>
          <p className="text-xs opacity-80 mt-1">Available on the next booking</p>
        </div>

        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Total Added</p>
          <p className="text-2xl font-bold text-green-700">{formatMoney(totalCredited)}</p>
          {/* Deliberately not "from cancelled sessions" any more — credit can
              now also be added by hand, so naming one source would be wrong. */}
          <p className="text-xs text-gray-500 mt-1">Everything ever credited</p>
        </div>

        <div className="bg-white rounded-lg border p-5">
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">Total Taken Out</p>
          <p className="text-2xl font-bold text-gray-800">{formatMoney(totalRedeemed)}</p>
          <p className="text-xs text-gray-500 mt-1">Spent on bookings or paid back</p>
        </div>
      </div>

      {/* Actions. Encash is disabled at a zero balance rather than hidden, so it
          is clear the action exists and simply has nothing to pay out. */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setAdjustMode('CREDIT')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                     bg-teal-700 text-white hover:bg-teal-800 transition-colors"
        >
          <Plus size={16} />
          Add money to wallet
        </button>

        <button
          onClick={() => setAdjustMode('REFUND_OUT')}
          disabled={balance <= 0}
          title={balance <= 0 ? 'There is no balance to pay back.' : undefined}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border
                     border-red-300 text-red-700 hover:bg-red-50 transition-colors
                     disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent"
        >
          <HandCoins size={16} />
          Encash / offline refund
        </button>
      </div>

      {flash && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          {flash}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* Movement list */}
      <div className="bg-white rounded-lg border">
        <div className="px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-900">Wallet Activity</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Cash/QR sessions cancelled from the dashboard are not refunded — the amount is held here
            and applied to {clientName ? `${clientName}'s` : 'the client’s'} next booking.
          </p>
        </div>

        {transactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-1">No wallet activity</p>
            <p className="text-gray-400 text-sm">
              Credit appears here when a Cash or QR booking is cancelled.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {transactions.map(t => {
              const isCredit = t.direction === 'CREDIT';
              return (
                <li key={t.txn_id} className="px-5 py-4 flex items-start gap-4">
                  <div
                    className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      isCredit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {isCredit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">
                      {REASON_LABELS[t.reason] || t.reason}
                    </p>

                    {/* Which booking this movement relates to — the whole point
                        of the list. */}
                    {t.source_booking_id && (
                      <p className="text-sm text-gray-600 mt-0.5">
                        {cleanSessionName(t.booking_session_name)}
                        {t.booking_therapist_name ? ` with ${t.booking_therapist_name}` : ''}
                        {t.booking_session_time
                          ? ` · ${t.booking_session_time}`
                          : t.booking_start_at ? ` · ${formatDateTime(t.booking_start_at)}` : ''}
                      </p>
                    )}

                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateTime(t.created_at)}
                      {t.source_booking_id ? ` · Booking ${t.source_booking_id}` : ''}
                      {t.source_payment_mode ? ` · Paid by ${t.source_payment_mode}` : ''}
                      {t.created_by_name ? ` · by ${t.created_by_name}` : ''}
                    </p>

                    {t.notes && (
                      <p className="text-xs text-gray-500 italic mt-1">{t.notes}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className={`font-semibold ${isCredit ? 'text-green-700' : 'text-gray-800'}`}>
                      {isCredit ? '+' : '−'}{formatMoney(t.amount)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Bal {formatMoney(t.balance_after)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {adjustMode && (
        <WalletAdjustModal
          client={{
            client_name: clientName,
            client_phone: clientPhone,
            client_email: clientEmail,
            balance,
          }}
          initialMode={adjustMode}
          onClose={() => setAdjustMode(null)}
          onDone={() => {
            const done = adjustMode === 'CREDIT'
              ? 'Money added to the wallet.'
              : adjustMode === 'REFUND_OUT'
                ? 'Payout recorded. The balance has been reduced.'
                : 'Balance adjusted.';
            setAdjustMode(null);
            setFlash(done);
            // Re-read the ledger rather than patching state locally: the server
            // is the source of truth for the balance, and the new movement has
            // to appear in the activity list below with its running balance.
            load();
            setTimeout(() => setFlash(null), 5000);
          }}
        />
      )}
    </div>
  );
};
