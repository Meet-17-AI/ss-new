import React, { useEffect, useState } from 'react';
import { Wallet, Ban, Undo2, ShieldCheck, RefreshCw } from 'lucide-react';

export type CancellationAction = 'no_refund' | 'wallet_credit' | 'offline_refund';

/** What the parent dialog must send with the cancellation. */
export interface CancellationChoice {
  action: CancellationAction | null;
  otpId: string | null;
  otp: string | null;
  /** False while a required step (choosing, or confirming the OTP) is outstanding. */
  ready: boolean;
}

interface Props {
  bookingId: string;
  /** Cleared and re-fetched whenever the dialog opens for a different booking. */
  onChange: (choice: CancellationChoice) => void;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * The money decision for cancelling a Cash/QR booking.
 *
 * Renders nothing at all unless the booking actually qualifies — a card payment
 * goes back through the gateway, and a free session has nothing to decide — so
 * the existing cancel dialog is untouched for every other booking.
 */
export const CancellationActionPicker: React.FC<Props> = ({ bookingId, onChange }) => {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<any>(null);
  const [action, setAction] = useState<CancellationAction | null>(null);

  const [otpId, setOtpId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAction(null);
    setOtpId(null);
    setOtp('');
    setOtpError(null);

    fetch(`/api/bookings/${encodeURIComponent(bookingId)}/cancellation-options`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setInfo(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setInfo(null); setLoading(false); } });

    return () => { cancelled = true; };
  }, [bookingId]);

  // Report upward on every change. An offline refund is only "ready" once a
  // code has been requested AND typed — the server verifies it regardless, so
  // this is about not letting the admin submit a doomed request.
  useEffect(() => {
    const ready =
      !info?.eligible ? true
      : action === null ? false
      : action === 'offline_refund' ? Boolean(otpId && otp.trim().length === 6)
      : true;

    onChange({
      action: info?.eligible ? action : null,
      otpId: action === 'offline_refund' ? otpId : null,
      otp: action === 'offline_refund' ? otp.trim() : null,
      ready,
    });
    // onChange is recreated each render by most parents; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, action, otpId, otp]);

  const requestOtp = async () => {
    setSendingOtp(true);
    setOtpError(null);
    try {
      const res = await fetch('/api/otp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: `Offline refund of ${rupees(info.amount)} for booking ${bookingId}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.otpId) throw new Error(data.error || 'Could not send the code.');
      setOtpId(data.otpId);
      setOtpSentTo('your admin email');
    } catch (err: any) {
      setOtpError(err.message || 'Could not send the code.');
    } finally {
      setSendingOtp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <RefreshCw size={14} className="animate-spin" /> Checking payment details…
      </div>
    );
  }

  /**
   * Not a Cash/QR paid booking, so there is no decision to make — but there is
   * still an outcome, and the admin is about to take an irreversible action.
   * Rendering nothing here left them cancelling with no statement of what
   * happens to the money on ~94% of bookings, which reads as "nothing happens"
   * rather than "the gateway handles it". Say it instead.
   */
  if (!info?.eligible) {
    const paid = String(info?.paymentStatus || '').toLowerCase() === 'paid';
    const gateway = String(info?.paymentGateway || '').trim();
    const amount = Number(info?.amount) || 0;

    const outcome =
      amount <= 0
        ? 'No payment was recorded for this session, so there is nothing to refund.'
        : paid
        ? `${rupees(amount)} was paid through ${gateway || 'the payment gateway'}. Cancelling refunds it the same way — it is not handled here.`
        : `${rupees(amount)} was never collected, so there is nothing to refund. The amount leaves net revenue on cancellation.`;

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Wallet size={16} className="mt-0.5 shrink-0 text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-800">What happens to the money</p>
            <p className="text-xs text-gray-600 mt-0.5">{outcome}</p>
          </div>
        </div>
      </div>
    );
  }

  const options: { value: CancellationAction; label: string; hint: string; icon: React.ReactNode }[] = [
    {
      value: 'no_refund',
      label: 'No refund',
      hint: `The ${rupees(info.amount)} is kept. Nothing goes back to the client and no wallet credit is created, so it stays in net revenue.`,
      icon: <Ban size={16} className="text-gray-500" />,
    },
    {
      value: 'wallet_credit',
      label: `Add to ${info.clientName}'s wallet`,
      hint: `${rupees(info.amount)} becomes credit against a future session. It leaves net revenue now and returns when the credit is used.`,
      icon: <Wallet size={16} className="text-amber-600" />,
    },
    {
      value: 'offline_refund',
      label: 'Offline refund',
      hint: `${rupees(info.amount)} is handed back outside the panel. Needs an emailed code to confirm, and leaves net revenue.`,
      icon: <Undo2 size={16} className="text-red-500" />,
    },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <label className="block text-sm font-semibold text-gray-900 mb-1">
        Action <span className="text-red-500">*</span>
      </label>
      <p className="text-xs text-gray-500 mb-3">
        This booking was collected by {String(info.paymentGateway || '').toUpperCase()} ({rupees(info.amount)}),
        so there is no gateway payment to reverse. Choose what happens to the money.
      </p>

      <div className="space-y-2">
        {options.map(opt => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              action === opt.value ? 'border-teal-500 bg-white ring-1 ring-teal-500' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="cancellation-action"
              className="mt-1 w-4 h-4"
              checked={action === opt.value}
              onChange={() => { setAction(opt.value); setOtpError(null); }}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                {opt.icon}{opt.label}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {action === 'offline_refund' && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800 mb-2">
            <ShieldCheck size={15} /> Confirm the refund
          </div>

          {!otpId ? (
            <>
              <p className="text-xs text-red-700 mb-2">
                Handing cash back can't be undone from here, so it needs a code.
              </p>
              <button
                type="button"
                onClick={requestOtp}
                disabled={sendingOtp}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {sendingOtp ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-red-700 mb-2">
                Enter the 6-digit code sent to {otpSentTo}.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setOtpError(null); }}
                  placeholder="______"
                  className="w-32 px-3 py-2 border rounded-lg text-center tracking-[0.3em] text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                <button
                  type="button"
                  onClick={requestOtp}
                  disabled={sendingOtp}
                  className="text-xs text-red-700 underline disabled:opacity-50"
                >
                  {sendingOtp ? 'Sending…' : 'Resend'}
                </button>
              </div>
            </>
          )}

          {otpError && <p className="text-xs text-red-700 mt-2">{otpError}</p>}
        </div>
      )}
    </div>
  );
};
