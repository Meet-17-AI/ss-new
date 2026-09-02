import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Logo } from './Logo';

/**
 * Set a password from a personalised invitation link.
 *
 * Reached at /reset-password/:token by someone who cannot sign in, so every
 * request it makes is on the public allowlist.
 *
 * WHAT THE LINK DOES. It identifies WHO is resetting, and fills the email in so
 * nobody has to remember which address their account uses — a real cause of
 * failed resets here, since the addresses live on a profile the therapist never
 * sees. It grants nothing on its own: the code still goes to that address, and
 * the reset still requires it. A link that leaks is not a password reset.
 *
 * The email is shown but not editable. Letting it be changed would turn one
 * person's link into a way to aim a reset at another account.
 */

type Stage = 'loading' | 'dead' | 'request' | 'code' | 'password' | 'done';

/**
 * Card the page sits in.
 *
 * Declared HERE, at module scope, and it has to stay here. It was originally
 * defined inside ResetPasswordPage, which made a NEW component type on every
 * render: React compares types by identity, saw a different one each keystroke,
 * and threw away the whole subtree to mount it again. The focused input was
 * destroyed mid-typing, focus fell back to the autoFocus field above, and the
 * next character landed in "New password" instead of "Confirm new password".
 *
 * A component defined during render is never the same component twice.
 */
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100 p-6">
    <div className="w-full max-w-md rounded-2xl bg-white px-8 py-10 shadow-2xl">
      <div className="mb-7 flex justify-center"><Logo showTagline={false} /></div>
      {children}
    </div>
  </div>
);

const RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', ok: (p) => p.length >= 8 },
  { label: 'One uppercase letter', ok: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', ok: (p) => /[a-z]/.test(p) },
  { label: 'One number', ok: (p) => /[0-9]/.test(p) },
];

export const ResetPasswordPage: React.FC = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('loading');
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  const [deadReason, setDeadReason] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // Who is this link for?
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/public/reset-invite/${encodeURIComponent(String(token))}`);
        const d = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && d.success) {
          setWho({ name: d.name, email: d.email });
          setStage('request');
        } else {
          setDeadReason(d.error || 'This reset link is not valid.');
          setStage('dead');
        }
      } catch {
        if (!cancelled) { setDeadReason('Could not reach the server. Please try again.'); setStage('dead'); }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Resend cooldown, so the 3-per-hour server limit is not spent by impatience.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const post = async (path: string, body: any) => {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };

  const sendCode = async () => {
    if (!who) return;
    setBusy(true); setError('');
    const { data } = await post('/api/forgot-password/send-otp', { email: who.email });
    setBusy(false);
    if (data.success) { setStage('code'); setResendIn(60); }
    else setError(data.error || 'Could not send the code. Please try again.');
  };

  const verify = async () => {
    if (!who) return;
    setBusy(true); setError('');
    const { data } = await post('/api/forgot-password/verify-otp', { email: who.email, otp });
    setBusy(false);
    if (data.success) setStage('password');
    else setError(data.error || 'That code was not right.');
  };

  const submit = async () => {
    if (!who) return;
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    const { data } = await post('/api/forgot-password/reset', { email: who.email, otp, newPassword: password });
    setBusy(false);
    if (data.success) setStage('done');
    else setError(data.error || 'Could not set the password.');
  };

  const allRulesPass = RULES.every((r) => r.ok(password));

  if (stage === 'loading') {
    return <Shell><div className="flex justify-center py-6">
      <Loader2 size={26} className="animate-spin text-teal-600" /></div></Shell>;
  }

  if (stage === 'dead') {
    return <Shell>
      <div className="text-center">
        <AlertTriangle size={26} className="mx-auto mb-3 text-amber-500" />
        <h1 className="text-lg font-semibold text-gray-900">This link cannot be used</h1>
        <p className="mt-2 text-sm text-gray-600">{deadReason}</p>
        <button onClick={() => navigate('/login')}
          className="mt-6 text-sm font-medium text-teal-700 hover:underline">Go to sign in</button>
      </div>
    </Shell>;
  }

  if (stage === 'done') {
    return <Shell>
      <div className="text-center">
        <CheckCircle2 size={28} className="mx-auto mb-3 text-teal-600" />
        <h1 className="text-lg font-semibold text-gray-900">Your password is set</h1>
        <p className="mt-2 text-sm text-gray-600">
          You can now sign in as <span className="font-medium">{who?.email}</span>.
        </p>
        <button onClick={() => navigate('/login')}
          className="mt-6 w-full rounded-lg bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">
          Sign in
        </button>
      </div>
    </Shell>;
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold text-gray-900">Set your password</h1>
      <p className="mt-1 text-sm text-gray-500">
        {who?.name ? <>Hello {who.name.split(' ')[0]} — this link is for your account.</> : 'This link is for your account.'}
      </p>

      {/* Fixed, not editable: an editable field would let one person's link aim
          a reset at somebody else's account. */}
      <div className="mt-5 rounded-lg bg-gray-50 px-3 py-2.5 ring-1 ring-inset ring-gray-200">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Your email</div>
        <div className="text-sm font-medium text-gray-800 break-all">{who?.email}</div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {error}
        </div>
      )}

      {stage === 'request' && (
        <>
          <p className="mt-5 text-sm text-gray-600">
            We will email a 6-digit code to this address to confirm it is you.
          </p>
          <button onClick={sendCode} disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-2.5
                       text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" />} Email me a code
          </button>
        </>
      )}

      {stage === 'code' && (
        <>
          <label className="mt-5 block text-sm font-medium text-gray-700">Enter the 6-digit code</label>
          <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoFocus placeholder="000000"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg
                       tracking-[0.4em] focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" />
          <button onClick={verify} disabled={busy || otp.length !== 6}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-2.5
                       text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" />} Verify code
          </button>
          <button onClick={sendCode} disabled={busy || resendIn > 0}
            className="mt-3 w-full text-xs text-gray-500 hover:text-teal-700 disabled:opacity-60">
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send another code'}
          </button>
        </>
      )}

      {stage === 'password' && (
        <>
          <label className="mt-5 block text-sm font-medium text-gray-700">New password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                       focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" />

          <ul className="mt-3 space-y-1">
            {RULES.map((r) => (
              <li key={r.label} className={`flex items-center gap-2 text-xs ${
                r.ok(password) ? 'text-teal-700' : 'text-gray-400'}`}>
                <ShieldCheck size={13} /> {r.label}
              </li>
            ))}
          </ul>

          <label className="mt-4 block text-sm font-medium text-gray-700">Confirm new password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm
                       focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500" />

          <button onClick={submit} disabled={busy || !allRulesPass || !confirm}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 py-2.5
                       text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" />} Set password
          </button>
        </>
      )}
    </Shell>
  );
};

export default ResetPasswordPage;
