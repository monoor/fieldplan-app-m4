import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authClient } from '../api';

export function Setup() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ setupRequired: boolean }>('/api/status') });
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [finished, setFinished] = useState(false);
  if (finished) return <Navigate to="/" replace />;
  if (status.data && !status.data.setupRequired) return <Navigate to="/login" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.confirm) return setErr('Passwords do not match');
    setBusy(true);
    try {
      await api('/api/setup', { method: 'POST', json: { name: f.name, email: f.email, password: f.password } });
      const r = await authClient.signIn.email({ email: f.email, password: f.password });
      if (r.error) throw new Error(r.error.message);
      await qc.invalidateQueries({ queryKey: ['me'] }); setFinished(true); qc.setQueryData(['status'], (s: object | undefined) => ({ ...s, setupRequired: false }));
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="auth-page">
      <form className="card auth" onSubmit={submit}>
        <div className="brand big"><span className="mark" />FIELDPLAN</div>
        <h2>Create the admin account</h2>
        <p className="muted small">This screen only appears on a new install. The account you create here manages users and settings.</p>
        <label>Name<input value={f.name} onChange={set('name')} required autoComplete="name" /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>Password (10+ characters)<input type="password" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /></label>
        <label>Confirm password<input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></label>
        {err && <div className="bad">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create admin and sign in'}</button>
      </form>
    </div>
  );
}
