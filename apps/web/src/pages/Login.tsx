import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authClient } from '../api';

export function Login() {
  const nav = useNavigate(), qc = useQueryClient(), [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') && !params.get('next')?.startsWith('//') ? params.get('next')! : '/';
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ setupRequired: boolean }>('/api/status') });
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'totp' | 'backup'>('password');
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  if (status.data?.setupRequired) return <Navigate to="/setup" replace />;

  const done = async () => { await qc.invalidateQueries({ queryKey: ['me'] }); nav(next, { replace: true }); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (step === 'password') {
        const r = await authClient.signIn.email({ email, password });
        if (r.error) throw new Error(r.error.status === 429 ? 'Too many attempts — wait a minute' : 'Wrong email or password');
        if ((r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) { setStep('totp'); return; }
        return await done();
      }
      const r = step === 'totp' ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, '') }) : await authClient.twoFactor.verifyBackupCode({ code: code.trim() });
      if (r.error) throw new Error(r.error.status === 429 ? 'Too many attempts — wait a minute' : 'That code did not work');
      await done();
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-page">
      <form className="card auth" onSubmit={submit}>
        <div className="brand big"><span className="mark" />FIELDPLAN</div>
        {step === 'password' ? (<>
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" autoFocus /></label>
          <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        </>) : (<>
          <p className="small">{step === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.'}</p>
          <label>{step === 'totp' ? 'Code' : 'Backup code'}<input value={code} onChange={e => setCode(e.target.value)} required autoComplete="one-time-code" inputMode={step === 'totp' ? 'numeric' : 'text'} autoFocus /></label>
          <button type="button" className="link" onClick={() => { setCode(''); setStep(step === 'totp' ? 'backup' : 'totp'); }}>{step === 'totp' ? 'Use a backup code instead' : 'Use the authenticator app'}</button>
        </>)}
        {err && <div className="bad">{err}</div>}
        {step === 'password' && <details className="small muted"><summary>Forgot password?</summary>
          <p>There's no email reset (this runs on your own server). Ask an admin: Settings → Users → Reset password. If you're the only admin, run this on the server:</p>
          <code className="block">docker exec -it fieldplan-app node apps/server/dist/cli/reset-password.js you@example.com</code>
          <p>It prints a new password (add <code>--no-2fa</code> if you lost your authenticator too).</p></details>}
        <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : step === 'password' ? 'Sign in' : 'Verify'}</button>
      </form>
    </div>
  );
}
