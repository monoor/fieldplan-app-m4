import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectRecord, ProjectSummary } from '@fieldplan/shared';
import { api, can, fileUrl, fmtDate } from '../api';
import { useMe } from '../App';
import { PlanView } from '../components/PlanView';
import { analyze } from '@fieldplan/shared';
import { ChecksView } from '../components/ChecksView';
import { PanelSchedule, panelsOf } from '../components/PanelSchedule';
import { ExportMenu } from '../editor/ExportMenu';
import { loadConeOptions } from '../editor/coneStyle';
import type { SceneRec } from '../editor/Scene';

interface Snapshot { project: ProjectSummary; seq: number; records: ProjectRecord[] }
interface Share { id: string; label: string | null; sheetId: string | null; expiresAt: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null; uses: number }

export function sheetsOf(records: ProjectRecord[]) {
  return records.filter(r => r.kind === 'sheet').map(r => ({ id: r.id, name: String(r.data.name ?? 'Sheet'), order: Number(r.data.order ?? 0) })).sort((a, b) => a.order - b.order);
}

export function ProjectView() {
  const { id = '' } = useParams(), me = useMe().data, qc = useQueryClient(), nav = useNavigate();
  const snap = useQuery({ queryKey: ['project', id], queryFn: () => api<Snapshot>('/api/projects/' + encodeURIComponent(id) + '/snapshot') });
  const [sheet, setSheet] = useState<string | null>(null), [tab, setTab] = useState<'plan' | 'devices' | 'panels' | 'checks' | 'share'>('plan');
  const [editing, setEditing] = useState(false), [form, setForm] = useState({ name: '', client: '' }), [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: () => api<ProjectSummary>('/api/projects/' + id, { method: 'PATCH', json: { name: form.name, client: form.client || null } }),
    onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: e => setErr(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api('/api/projects/' + id, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); nav('/'); },
    onError: e => setErr(e.message),
  });

  if (snap.isLoading) return <div className="page muted">Loading…</div>;
  if (snap.isError) return <div className="page"><div className="bad">{snap.error.message}</div></div>;
  const { project, records } = snap.data!;
  const meta = records.find(r => r.kind === 'meta')?.data ?? {}, scale = Number(meta.scale) || 20;
  const issueCount = analyze(records as never, () => scale).issues.filter(i => i.severity !== 'info').length;
  const sheets = sheetsOf(records), current = sheets.find(s => s.id === sheet) ?? sheets[0];

  return (
    <div className="page wide">
      <div className="page-head">
        {editing ? (
          <form className="row wrap grow" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={200} autoFocus />
            <input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="Client" maxLength={200} />
            <button className="btn primary" disabled={save.isPending}>Save</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (<>
          <div className="grow"><h1>{project.name}</h1><div className="muted small">{project.client ?? 'No client'} · {project.records} items · updated {fmtDate(project.updatedAt)}</div></div>
          {can(me, 'project:write') && <Link className="btn primary" to={'/p/' + id + '/edit'}>Edit plan</Link>}
          {can(me, 'project:write') && <button className="btn" onClick={() => { setForm({ name: project.name, client: project.client ?? '' }); setEditing(true); }}>Rename</button>}
          {current && <ExportMenu className="btn" recs={() => records.filter(r => r.sheetId === current.id && !r.deleted) as unknown as SceneRec[]} cones={loadConeOptions()} projectName={project.name} client={project.client} sheetName={current.name} scale={scale} />}
          <a className="btn" href={'/api/projects/' + encodeURIComponent(id) + '/export'} download>JSON</a>
          {can(me, 'project:delete') && <button className="btn danger" onClick={() => { if (confirm('Delete “' + project.name + '”? It disappears for everyone (the data stays in the database and can be recovered by an admin).')) remove.mutate(); }}>Delete</button>}
        </>)}
      </div>
      {err && <div className="bad">{err}</div>}

      <div className="tabs">
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Plan</button>
        <button className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}>Devices</button>
        <button className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>Checks{issueCount > 0 ? ' (' + issueCount + ')' : ''}</button>
        {panelsOf(records).length > 0 && <button className={tab === 'panels' ? 'on' : ''} onClick={() => setTab('panels')}>Panels</button>}
        {can(me, 'share:manage') && <button className={tab === 'share' ? 'on' : ''} onClick={() => setTab('share')}>Client links</button>}
        <span className="spacer" />
        {tab !== 'share' && tab !== 'panels' && tab !== 'checks' && sheets.length > 1 && (
          <select value={current?.id} onChange={e => setSheet(e.target.value)}>{sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        )}
      </div>

      {tab === 'plan' && (current ? <>
        <PlanView records={records} sheetId={current.id} fileUrl={fileUrl} scale={scale} />
      </> : <p className="muted">This project has no sheets.</p>)}
      {tab === 'devices' && current && <DeviceTable records={records} sheetId={current.id} />}
      {tab === 'checks' && <ChecksView records={records as never} scale={scale} projectName={project.name} />}
      {tab === 'panels' && <PanelSchedule records={records} projectName={project.name} />}
      {tab === 'share' && <Shares projectId={id} sheets={sheets} />}
    </div>
  );
}

export function DeviceTable({ records, sheetId }: { records: ProjectRecord[]; sheetId: string }) {
  const rows = records.filter(r => r.kind === 'device' && r.sheetId === sheetId).map(r => r.data as { tag?: string; typeId?: string; catKey?: string; label?: string; mount?: string; heightFt?: number })
    .sort((a, b) => (a.tag ?? '').localeCompare(b.tag ?? '', undefined, { numeric: true }));
  if (!rows.length) return <p className="muted">No devices on this sheet.</p>;
  return (
    <table className="table">
      <thead><tr><th>Tag</th><th>Category</th><th>Type</th><th>Label</th></tr></thead>
      <tbody>{rows.map((d, i) => <tr key={i}><td className="mono">{d.tag ?? '—'}</td><td><span className={'dot cat-' + (d.catKey ?? '')} />{d.catKey}</td><td className="mono small">{d.typeId}</td><td>{d.label ?? ''}</td></tr>)}</tbody>
    </table>
  );
}

function Shares({ projectId, sheets }: { projectId: string; sheets: { id: string; name: string }[] }) {
  const qc = useQueryClient(), key = ['shares', projectId];
  const list = useQuery({ queryKey: key, queryFn: () => api<Share[]>('/api/projects/' + projectId + '/shares') });
  const [f, setF] = useState({ label: '', sheetId: '', days: 14 }), [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null), [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => api<{ url: string; expiresAt: string }>('/api/projects/' + projectId + '/shares', { method: 'POST', json: { label: f.label || undefined, sheetId: f.sheetId || null, days: f.days } }),
    onSuccess: r => { setMade(r); setErr(''); qc.invalidateQueries({ queryKey: key }); }, onError: e => setErr(e.message),
  });
  const revoke = useMutation({ mutationFn: (sid: string) => api('/api/shares/' + sid, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: key }), onError: e => setErr(e.message) });
  const sheetName = (sid: string | null) => (sid ? sheets.find(s => s.id === sid)?.name ?? 'removed sheet' : 'All sheets');
  const state = (s: Share) => (s.revokedAt ? 'revoked' : s.expiresAt < new Date().toISOString() ? 'expired' : 'active');

  return (
    <div className="stack">
      <p className="muted small">A client link opens a read-only view of the plan without signing in. It leaves out prices, part numbers and device notes. Anyone with the link can open it until it expires or you revoke it.</p>
      <form className="card row wrap" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <input placeholder="Label (e.g. Smith — walkthrough)" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} maxLength={120} />
        <select value={f.sheetId} onChange={e => setF({ ...f, sheetId: e.target.value })}><option value="">All sheets</option>{sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <label className="inline">Expires in <input type="number" min={1} max={365} value={f.days} onChange={e => setF({ ...f, days: Math.max(1, Math.min(365, Number(e.target.value) || 14)) })} /> days</label>
        <button className="btn primary" disabled={create.isPending}>Create link</button>
      </form>
      {made && (
        <div className="card ok-box">
          <div className="small">Copy this link now — it is not shown again.</div>
          <div className="row"><input readOnly value={made.url} onFocus={e => e.target.select()} className="grow mono" /><button className="btn" onClick={() => void navigator.clipboard?.writeText(made.url)}>Copy</button></div>
          <div className="muted small">Expires {fmtDate(made.expiresAt)}</div>
        </div>
      )}
      {err && <div className="bad">{err}</div>}
      {!!list.data?.length && (
        <table className="table">
          <thead><tr><th>Label</th><th>Scope</th><th>Expires</th><th className="num">Opens</th><th>Last opened</th><th>Status</th><th /></tr></thead>
          <tbody>{list.data.map(s => (
            <tr key={s.id} className={state(s) !== 'active' ? 'dim' : ''}>
              <td>{s.label ?? '—'}</td><td>{sheetName(s.sheetId)}</td><td>{fmtDate(s.expiresAt)}</td><td className="num mono">{s.uses}</td><td>{fmtDate(s.lastUsedAt)}</td><td>{state(s)}</td>
              <td>{state(s) === 'active' && <button className="btn sm danger" onClick={() => revoke.mutate(s.id)}>Revoke</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
