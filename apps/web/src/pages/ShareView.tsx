import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProjectRecord } from '@fieldplan/shared';
import { api, fmtDate } from '../api';
import { PlanView } from '../components/PlanView';
import { DeviceTable, sheetsOf } from './ProjectView';

interface Shared { project: { name: string; client: string | null }; label: string | null; sheetId: string | null; expiresAt: string; records: ProjectRecord[] }

/** Public, read-only client view. No account, no pricing. */
export function ShareView() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['share', token], queryFn: () => api<Shared>('/api/share/' + encodeURIComponent(token)), retry: false });
  const [sheet, setSheet] = useState<string | null>(null), [tab, setTab] = useState<'plan' | 'devices'>('plan');
  if (q.isLoading) return <div className="center muted">Loading…</div>;
  if (q.isError) return <div className="auth-page"><div className="card auth"><div className="brand big"><span className="mark" />FIELDPLAN</div><p>{q.error.message}</p><p className="muted small">Ask whoever sent you the link for a new one.</p></div></div>;
  const s = q.data!, meta = s.records.find(r => r.kind === 'meta')?.data ?? {}, scale = Number(meta.scale) || 20;
  const sheets = sheetsOf(s.records), current = sheets.find(x => x.id === sheet) ?? sheets[0];
  const file = (sha: string) => '/api/share/' + encodeURIComponent(token) + '/files/' + sha;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="mark" />FIELDPLAN</div>
        <span className="spacer" />
        <span className="muted small">Shared view · expires {fmtDate(s.expiresAt)}</span>
      </header>
      <main className="page wide">
        <div className="page-head"><div className="grow"><h1>{s.project.name}</h1><div className="muted small">{[s.project.client, s.label].filter(Boolean).join(' · ')}</div></div></div>
        <div className="tabs">
          <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>Plan</button>
          <button className={tab === 'devices' ? 'on' : ''} onClick={() => setTab('devices')}>Devices</button>
          <span className="spacer" />
          {sheets.length > 1 && <select value={current?.id} onChange={e => setSheet(e.target.value)}>{sheets.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        </div>
        {!current ? <p className="muted">Nothing to show.</p> : tab === 'plan' ? <PlanView records={s.records} sheetId={current.id} fileUrl={file} scale={scale} /> : <DeviceTable records={s.records} sheetId={current.id} />}
      </main>
    </div>
  );
}
