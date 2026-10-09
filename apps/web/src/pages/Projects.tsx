import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectSummary } from '@fieldplan/shared';
import { api, can, fmtDate } from '../api';
import { useMe } from '../App';

export function Projects() {
  const me = useMe().data, qc = useQueryClient(), nav = useNavigate();
  const list = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectSummary[]>('/api/projects') });
  const [q, setQ] = useState(''), [name, setName] = useState(''), [client, setClient] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; bad?: string; warnings?: string[] }>({});
  const fileIn = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: () => api<ProjectSummary>('/api/projects', { method: 'POST', json: { name, client: client || undefined } }),
    onSuccess: p => { qc.invalidateQueries({ queryKey: ['projects'] }); nav('/p/' + p.id); },
    onError: e => setMsg({ bad: e.message }),
  });
  const importV1 = async (f: File) => {
    setMsg({});
    try {
      if (f.size > 200 * 1024 * 1024) throw new Error('That file is larger than 200 MB');
      const text = await f.text(); let json: unknown;
      try { json = JSON.parse(text); } catch { throw new Error('That file is not JSON — use Export JSON in the old app'); }
      const r = await api<{ project: ProjectSummary; warnings: string[] }>('/api/projects/import-v1', { method: 'POST', json });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      setMsg({ ok: 'Imported “' + r.project.name + '” (' + r.project.records + ' items).', warnings: r.warnings });
    } catch (e) { setMsg({ bad: (e as Error).message }); }
  };

  const rows = (list.data ?? []).filter(p => !q || (p.name + ' ' + (p.client ?? '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <input className="search" placeholder="Search projects" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {can(me, 'project:create') && (
        <div className="card row wrap">
          <form className="row wrap grow" onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <input placeholder="New project name" value={name} onChange={e => setName(e.target.value)} maxLength={200} required />
            <input placeholder="Client (optional)" value={client} onChange={e => setClient(e.target.value)} maxLength={200} />
            <button className="btn primary" disabled={create.isPending}>Create</button>
          </form>
          <button className="btn" onClick={() => fileIn.current?.click()} title="Bring in a project saved from the current Fieldplan (Export JSON)">Import from Fieldplan v1…</button>
          <input ref={fileIn} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importV1(f); }} />
        </div>
      )}
      {msg.bad && <div className="bad">{msg.bad}</div>}
      {msg.ok && <div className="ok">{msg.ok}</div>}
      {!!msg.warnings?.length && <details className="small muted"><summary>{msg.warnings.length} import note(s)</summary><ul>{msg.warnings.slice(0, 100).map((w, i) => <li key={i}>{w}</li>)}</ul></details>}

      {list.isLoading ? <p className="muted">Loading…</p> : list.isError ? <div className="bad">{list.error.message}</div> : !rows.length ? (
        <p className="muted">{q ? 'No projects match.' : 'No projects yet. Create one, or import a project from Fieldplan v1.'}</p>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Client</th><th className="num">Items</th><th>Updated</th></tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.id}><td><Link to={'/p/' + p.id}>{p.name}</Link></td><td>{p.client ?? '—'}</td><td className="num mono">{p.records}</td><td className="muted">{fmtDate(p.updatedAt)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
