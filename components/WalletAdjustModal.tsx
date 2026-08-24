import React, { useState } from 'react';

/**
 * Manual wallet credit or payout.
 *
 * ONE form for two jobs, because they are the same ledger movement with a
 * different sign:
 *
 *   - Add money      (CREDIT / MANUAL_ADJUSTMENT) — a correction upward, or
 *                     credit granted as a goodwill gesture.
 *   - Encash         (DEBIT  / REFUND_OUT)        — credit handed back to the
 *                     client as cash or a transfer, outside the app.
 *   - Reduce balance (DEBIT  / MANUAL_ADJUSTMENT) — a correction downward.
 *
 * REFUND_OUT and MANUAL_ADJUSTMENT are the only two reasons the server accepts
 * manually; CANCELLATION_CREDIT, BOOKING_SETTLEMENT and TRANSFER_ADJUSTMENT are
 * written by their own flows and always carry the booking that caused them.
 *
 * This lives in its own file because it is reached from two places — the admin
 * Payments page and a client's Wallet tab. A second copy of a form that moves
 * money is exactly the kind of duplication that drifts, and money is the worst
 * place for two implementations to disagree.
 */

export interface WalletClient {
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  balance?: number | string | null;
}

export type WalletAdjustMode = 'CREDIT' | 'REFUND_OUT' | 'DEBIT';

const formatMoney = (v: number | string | null | undefined): string =>
  `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MODE_COPY: Record<WalletAdjustMode, { title: string; verb: string; placeholder: string }> = {
  CREDIT: {
    title: 'Add money to wallet',
    verb: 'Add to wallet',
    placeholder: 'e.g. Goodwill credit agreed with the client on 12 Aug',
  },
  REFUND_OUT: {
    title: 'Encash / offline refund',
    verb: 'Record payout',
    placeholder: 'e.g. Paid back ₹1,200 in cash at the office on 12 Aug',
  },
  DEBIT: {
    title: 'Reduce wallet balance',
    verb: 'Reduce balance',
    placeholder: 'e.g. Correcting a credit added twice on 10 Aug',
  },
};

export const WalletAdjustModal: React.FC<{
  client: WalletClient;
  /** Which job the button that opened this was for. */
  initialMode?: WalletAdjustMode;
  onClose: () => void;
  /** Called after a successful movement, so the caller can reload the ledger. */
  onDone: () => void;
}> = ({ client, initialMode = 'REFUND_OUT', onClose, onDone }) => {
  const balance = Number(client.balance || 0);
  const [mode, setMode] = useState<WalletAdjustMode>(initialMode);
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const direction = mode === 'CREDIT' ? 'CREDIT' : 'DEBIT';
  const reason = mode === 'REFUND_OUT' ? 'REFUND_OUT' : 'MANUAL_ADJUSTMENT';
  const numericAmount = Number(amount) || 0;
  // Only outgoing movements are capped — a correction upward has no ceiling.
  const exceedsBalance = direction === 'DEBIT' && numericAmount > balance;
  const copy = MODE_COPY[mode];

  const submit = async () => {
    setError(null);
    if (!(numericAmount > 0)) { setError('Enter an amount greater than zero.'); return; }
    if (exceedsBalance) { setError(`Cannot take more than the ${formatMoney(balance)} available.`); return; }
    // Required, not optional. A manual money movement with no explanation is
    // unauditable six months later, which is when someone always asks.
    if (!notes.trim()) { setError('A short note is required so the ledger stays auditable.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/wallet/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: client.client_phone,
          email: client.client_email,
          name: client.client_name,
          direction,
          amount: numericAmount,
          reason,
          notes: notes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to adjust wallet.');
        return;
      }
      onDone();
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full relative p-8" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-2xl font-bold"
          aria-label="Close"
        >
          &times;
        </button>

        <h2 className="text-xl font-bold mb-1 text-teal-800">{copy.title}</h2>
        <p className="text-sm text-gray-600 mb-1">{client.client_name || 'Unknown client'}</p>
        <p className="text-xs text-gray-500 mb-6">Current balance {formatMoney(balance)}</p>

        <label className="block text-sm font-medium mb-2">What happened?</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as WalletAdjustMode)}
          className="w-full px-4 py-3 border rounded-lg mb-4 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="CREDIT">Add money to the wallet</option>
          <option value="REFUND_OUT">Paid back to the client (cash/transfer)</option>
          <option value="DEBIT">Correction — reduce balance</option>
        </select>

        <label className="block text-sm font-medium mb-2">Amount</label>
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={direction === 'DEBIT' ? `Up to ${formatMoney(balance)}` : 'Amount to add'}
          className="w-full px-4 py-3 border rounded-lg mb-1 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {direction === 'DEBIT' && (
          <p className={`text-xs mb-3 ${exceedsBalance ? 'text-red-600' : 'text-gray-500'}`}>
            {formatMoney(balance)} available
            {exceedsBalance ? ' — the amount above exceeds it.' : ''}
          </p>
        )}
        {direction === 'CREDIT' && <div className="mb-3" />}

        <label className="block text-sm font-medium mb-2">
          Note<span className="text-red-500">*</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={copy.placeholder}
          className="w-full px-4 py-3 border rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-5 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={`px-5 py-2 text-white font-medium rounded-lg disabled:opacity-50 ${
              direction === 'CREDIT' ? 'bg-teal-700 hover:bg-teal-800' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {saving ? 'Saving…' : copy.verb}
          </button>
        </div>
      </div>
    </div>
  );
};
