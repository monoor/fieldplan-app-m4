import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ROLES } from '@fieldplan/shared';
import { api, authClient, can, fmtDate } from '../api';
import { useMe } from '../App';

export function Settings() {
  const me = useMe().data;
  const admin = can(me, 'user:manage');
  return (
    <div className="page">
      <div className="page-head"><h1>{admin ? 'Settings' : 'Account'}</h1></div>
      {admin && (
        <div className="tabs">
          <NavLink to="/settings" end>Account</NavLink>
          <NavLink to="/settings/users">Users</NavLink>
          <NavLink to="/settings/import">Import &amp; Claude</NavLink>
          <NavLink to="/settings/audit">Audit log</NavLink>
        </div>
      )}
      <Routes>
        <Route index element={<Account />} />
        {admin && <Route path="users" element={<Users />} />}
        {can(me, 'settings:manage') && <Route path="import" element={<ImportSettings />} />}
        {can(me, 'audit:read') && <Route path="audit" element={<AuditLog />} />}
      </Routes>
    </div>
  );
}

const authErr = (e: { message?: string; status?: number } | null | undefined, fallback: string) => (e?.status === 429 ? 'Too many attempts — wait a minute' : e?.message || fallback);

function Account() {
  const me = useMe().data!, qc = useQueryClient();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' }), [pwMsg, setPwMsg] = useState<{ ok?: string; bad?: string }>({});
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault(); setPwMsg({});
    if (pw.next !== pw.confirm) return setPwMsg({ bad: 'New passwords do not match' });
    const r = await authClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: true });
    if (r.error) return setPwMsg({ bad: authErr(r.error, 'Could not change the password') });
    setPw({ current: '', next: '', confirm: '' }); setPwMsg({ ok: 'Password changed. Other devices were signed out.' });
  };

  // Two-factor: password → QR + backup codes → confirm with a code
  const [tf, setTf] = useState<{ step: 'idle' | 'password' | 'scan' | 'done' | 'disable'; password: string; qr?: string; secret?: string; codes?: string[]; code: string; bad?: string }>({ step: 'idle', password: '', code: '' });
  const startEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await authClient.twoFactor.enable({ password: tf.password });
    if (r.error || !r.data) return setTf({ ...tf, bad: authErr(r.error, 'Wrong password') });
    if (r.data.method !== 'totp') return setTf({ ...tf, bad: 'The server did not return an authenticator setup' });
    const uri = r.data.totpURI, qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    setTf({ step: 'scan', password: '', qr, secret: new URL(uri).searchParams.get('secret') ?? '', codes: r.data.backupCodes, code: '' });
  };
  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await authClient.twoFactor.verifyTotp({ code: tf.code.replace(/\s/g, '') });
    if (r.error) return setTf({ ...tf, bad: authErr(r.error, 'That code did not work — check the time on your phone') });
    setTf({ ...tf, step: 'done', bad: undefined }); await qc.invalidateQueries({ queryKey: ['me'] });
  };
  const disable = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await authClient.twoFactor.disable({ password: tf.password });
    if (r.error) return setTf({ ...tf, bad: authErr(r.error, 'Wrong password') });
    setTf({ step: 'idle', password: '', code: '' }); await qc.invalidateQueries({ queryKey: ['me'] });
  };

  return (
    <div className="stack">
      <div className="card">
        <h3>{me.name}</h3>
        <div className="muted small">{me.email} · role {me.role}</div>
      </div>

      <form className="card form narrow" onSubmit={changePw}>
        <h3>Change password</h3>
        <label>Current password<input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></label>
        <label>New password (10+ characters)<input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} required minLength={10} autoComplete="new-password" /></label>
        <label>Confirm new password<input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" /></label>
        {pwMsg.bad && <div className="bad">{pwMsg.bad}</div>}{pwMsg.ok && <div className="ok">{pwMsg.ok}</div>}
        <button className="btn primary">Change password</button>
      </form>

      <div className="card form narrow">
        <h3>Two-factor sign-in</h3>
        {tf.step === 'done' ? (<>
          <div className="ok">Two-factor sign-in is on.</div>
          <p className="small">Save these backup codes somewhere safe. Each one works once if you lose your phone. They are not shown again.</p>
          <pre className="codes">{tf.codes?.join('\n')}</pre>
          <button className="btn" onClick={() => setTf({ step: 'idle', password: '', code: '' })}>Done</button>
        </>) : tf.step === 'scan' ? (
          <form onSubmit={confirmEnable} className="form">
            <p className="small">Scan this with an authenticator app (1Password, Google Authenticator, Authy…), then enter the 6-digit code to finish.</p>
            {tf.qr && <img className="qr" src={tf.qr} alt="Authenticator QR code" width={220} height={220} />}
            <div className="muted small mono">Key: {tf.secret}</div>
            <label>Code<input value={tf.code} onChange={e => setTf({ ...tf, code: e.target.value })} inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label>
            {tf.bad && <div className="bad">{tf.bad}</div>}
            <button className="btn primary">Turn on</button>
          </form>
        ) : me.twoFactorEnabled ? (tf.step === 'disable' ? (
          <form onSubmit={disable} className="form">
            <label>Password<input type="password" value={tf.password} onChange={e => setTf({ ...tf, password: e.target.value })} required autoComplete="current-password" autoFocus /></label>
            {tf.bad && <div className="bad">{tf.bad}</div>}
            <div className="row"><button className="btn danger">Turn off two-factor</button><button type="button" className="btn" onClick={() => setTf({ step: 'idle', password: '', code: '' })}>Cancel</button></div>
          </form>
        ) : (<>
          <div className="ok">On — sign-in asks for a code from your authenticator app.</div>
          <button className="btn" onClick={() => setTf({ step: 'disable', password: '', code: '' })}>Turn off…</button>
        </>)) : tf.step === 'password' ? (
          <form onSubmit={startEnable} className="form">
            <label>Confirm your password<input type="password" value={tf.password} onChange={e => setTf({ ...tf, password: e.target.value })} required autoComplete="current-password" autoFocus /></label>
            {tf.bad && <div className="bad">{tf.bad}</div>}
            <div className="row"><button className="btn primary">Continue</button><button type="button" className="btn" onClick={() => setTf({ step: 'idle', password: '', code: '' })}>Cancel</button></div>
          </form>
        ) : (<>
          <p className="small muted">Off. Recommended for admin accounts, and required if Fieldplan is reachable from the internet.</p>
          <button className="btn primary" onClick={() => setTf({ step: 'password', password: '', code: '' })}>Set up two-factor…</button>
        </>)}
      </div>
    </div>
  );
}

interface UserRow { id: string; name: string; email: string; role?: string | null; banned?: boolean | null; twoFactorEnabled?: boolean | null; createdAt: Date | string }
const ROLE_HELP: Record<string, string> = { admin: 'Everything, including users, settings and the audit log', designer: 'Create and edit projects, catalog, imports and client links', viewer: 'Read projects and the catalog' };

function Users() {
  const me = useMe().data!, qc = useQueryClient();
  const list = useQuery({ queryKey: ['users'], queryFn: async () => {
    const r = await authClient.admin.listUsers({ query: { limit: 200, sortBy: 'createdAt', sortDirection: 'asc' } });
    if (r.error) throw new Error(authErr(r.error, 'Could not load users'));
    return r.data.users as unknown as UserRow[];
  } });
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'designer' }), [msg, setMsg] = useState<{ ok?: string; bad?: string }>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const act = async (label: string, fn: () => Promise<{ error: { message?: string; status?: number } | null }>) => {
    setMsg({}); const r = await fn();
    if (r.error) setMsg({ bad: authErr(r.error, 'Failed') }); else { setMsg({ ok: label }); await refresh(); }
  };
  type AdminRole = 'admin';
  const create = (e: React.FormEvent) => { e.preventDefault(); void act('Account created for ' + f.email, () => authClient.admin.createUser({ name: f.name, email: f.email.toLowerCase(), password: f.password, role: f.role as AdminRole })).then(() => setF({ name: '', email: '', password: '', role: f.role })); };

  return (
    <div className="stack">
      <form className="card row wrap" onSubmit={create}>
        <input placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required maxLength={100} />
        <input type="email" placeholder="Email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required autoComplete="off" />
        <input type="password" placeholder="Temporary password (10+)" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete="new-password" />
        <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
        <button className="btn primary">Add user</button>
        <div className="muted small full">{ROLES.map(r => r + ': ' + ROLE_HELP[r]).join(' · ')}</div>
      </form>
      {msg.bad && <div className="bad">{msg.bad}</div>}{msg.ok && <div className="ok">{msg.ok}</div>}
      {list.isError ? <div className="bad">{list.error.message}</div> : (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Created</th><th /></tr></thead>
          <tbody>{(list.data ?? []).map(u => {
            const self = u.id === me.id;
            return (
              <tr key={u.id} className={u.banned ? 'dim' : ''}>
                <td>{u.name}{self && <span className="muted"> (you)</span>}</td><td>{u.email}</td>
                <td><select value={u.role ?? 'viewer'} disabled={self} onChange={e => void act('Role updated', () => authClient.admin.setRole({ userId: u.id, role: e.target.value as AdminRole }))}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></td>
                <td>{u.twoFactorEnabled ? 'on' : '—'}</td><td className="muted small">{fmtDate(String(u.createdAt))}</td>
                <td className="row-actions">{!self && (<>
                  <button className="btn sm" onClick={() => { const p = prompt('New password for ' + u.email + ' (10+ characters)'); if (p) void act('Password reset', () => authClient.admin.setUserPassword({ userId: u.id, newPassword: p })); }}>Reset password</button>
                  <button className="btn sm" onClick={() => void act('Signed out everywhere', () => authClient.admin.revokeUserSessions({ userId: u.id }))}>Sign out</button>
                  {u.banned ? <button className="btn sm" onClick={() => void act('Re-enabled', () => authClient.admin.unbanUser({ userId: u.id }))}>Enable</button>
                    : <button className="btn sm" onClick={() => void act('Disabled', () => authClient.admin.banUser({ userId: u.id, banReason: 'Disabled by admin' }))}>Disable</button>}
                  <button className="btn sm danger" onClick={() => { if (confirm('Delete ' + u.email + '? Their projects stay.')) void act('Deleted', () => authClient.admin.removeUser({ userId: u.id })); }}>Delete</button>
                </>)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

interface SettingsData {
  claudeConfigured: boolean; claudeEnabled: boolean; claudeModel: string; claudeDailyLimit: number; importAllowedDomains: string[];
  claude: { configured: boolean; enabled: boolean; model: string; usedToday: number; dailyLimit: number }; version: string; publicUrl: string | null; trustProxy: boolean | string | number;
}
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];

function ImportSettings() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/api/settings') });
  const [f, setF] = useState<{ enabled: boolean; model: string; limit: string; domains: string } | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; bad?: string }>({}), [test, setTest] = useState<{ ok?: string; bad?: string; busy?: boolean }>({});
  useEffect(() => { if (s.data && !f) setF({ enabled: s.data.claudeEnabled, model: s.data.claudeModel, limit: String(s.data.claudeDailyLimit), domains: s.data.importAllowedDomains.join('\n') }); }, [s.data, f]);
  const save = useMutation({
    mutationFn: () => api<Omit<SettingsData, 'claude' | 'version' | 'publicUrl' | 'trustProxy'>>('/api/settings', { method: 'PUT', json: {
      ...(s.data?.claudeConfigured ? { claudeEnabled: f!.enabled } : {}), claudeModel: f!.model.trim(), claudeDailyLimit: Math.max(0, Math.floor(Number(f!.limit) || 0)),
      importAllowedDomains: f!.domains.split(/[\s,]+/).map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean),
    } }),
    onSuccess: r => { setMsg({ ok: 'Saved.' }); setF({ enabled: r.claudeEnabled, model: r.claudeModel, limit: String(r.claudeDailyLimit), domains: r.importAllowedDomains.join('\n') }); void qc.invalidateQueries({ queryKey: ['settings'] }); void qc.invalidateQueries({ queryKey: ['import-status'] }); },
    onError: e => setMsg({ bad: e.message }),
  });
  const runTest = async () => {
    setTest({ busy: true });
    try { const r = await api<{ ok: true; model: string }>('/api/import/test', { method: 'POST', json: {} }); setTest({ ok: 'Connected — ' + r.model + ' answered.' }); void qc.invalidateQueries({ queryKey: ['settings'] }); }
    catch (e) { setTest({ bad: (e as Error).message }); }
  };
  if (s.isError) return <div className="bad">{s.error.message}</div>;
  if (!s.data || !f) return <p className="muted">Loading…</p>;
  const d = s.data;
  return (
    <div className="stack">
      <form className="card form narrow" onSubmit={e => { e.preventDefault(); setMsg({}); save.mutate(); }}>
        <h3>Claude import (optional)</h3>
        {d.claudeConfigured ? (
          <p className="small">An Anthropic API key is set on the server. Claude reads product pages and datasheet PDFs and fills in the catalog form; you review every field before saving. Each import uses one API call.</p>
        ) : (
          <div className="small">
            <p>No API key is set, so imports only read published product data. To turn this on, add the variable <code>ANTHROPIC_API_KEY</code> to the container (Unraid: edit the container, fill in “Anthropic API key”, Apply). The key is never stored in the database or shown here.</p>
          </div>
        )}
        <label className="inline"><input type="checkbox" checked={f.enabled} disabled={!d.claudeConfigured} onChange={e => setF({ ...f, enabled: e.target.checked })} /> Use Claude for imports</label>
        <label>Model<input list="models" value={f.model} onChange={e => setF({ ...f, model: e.target.value })} required pattern="[a-z0-9.\-]{3,80}" /></label>
        <datalist id="models">{MODELS.map(m => <option key={m} value={m} />)}</datalist>
        <label>Daily call limit<input type="number" min={0} max={100000} value={f.limit} onChange={e => setF({ ...f, limit: e.target.value })} /></label>
        <div className="muted small">Used today: {d.claude.usedToday} of {d.claude.dailyLimit}. 0 blocks all Claude calls.</div>
        <h3>Allowed import sites</h3>
        <label>One domain per line. Empty = any public website.<textarea rows={4} value={f.domains} onChange={e => setF({ ...f, domains: e.target.value })} placeholder={'ui.com\nreolink.com\nse.com'} /></label>
        <div className="muted small">Imports never reach private or local addresses (your LAN, the server itself), whatever is listed here.</div>
        {msg.bad && <div className="bad">{msg.bad}</div>}{msg.ok && <div className="ok">{msg.ok}</div>}
        <div className="row"><button className="btn primary" disabled={save.isPending}>Save</button>
          {d.claudeConfigured && <button type="button" className="btn" onClick={() => void runTest()} disabled={test.busy}>{test.busy ? 'Testing…' : 'Test connection'}</button>}</div>
        {test.ok && <div className="ok">{test.ok}</div>}{test.bad && <div className="bad">{test.bad}</div>}
      </form>
      <div className="card small muted">Server: version {d.version} · public URL {d.publicUrl ?? 'not set (LAN)'} · trust proxy {String(d.trustProxy)}</div>
    </div>
  );
}

interface AuditRow { id: number; at: string; action: string; userEmail: string | null; ip: string | null; projectId: string | null; detail: unknown }

function AuditLog() {
  const q = useInfiniteQuery({
    queryKey: ['audit'], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<AuditRow[]>('/api/audit?limit=100' + (pageParam ? '&before=' + pageParam : '')),
    getNextPageParam: last => (last.length === 100 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  if (q.isError) return <div className="bad">{q.error.message}</div>;
  return (
    <div className="stack">
      <table className="table small">
        <thead><tr><th>When</th><th>Action</th><th>Who</th><th>IP</th><th>Detail</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.id} className={r.action.endsWith('.failed') ? 'warn-row' : ''}>
            <td className="nowrap">{fmtDate(r.at)}</td><td className="mono">{r.action}</td><td>{r.userEmail ?? (r.action.startsWith('share.') ? 'client link' : '—')}</td>
            <td className="mono">{r.ip ?? ''}</td><td className="mono detail">{r.detail ? JSON.stringify(r.detail) : ''}{r.projectId ? ' · project ' + r.projectId : ''}</td>
          </tr>
        ))}</tbody>
      </table>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load older</button>}
    </div>
  );
}
