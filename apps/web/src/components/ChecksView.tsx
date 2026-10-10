// Cable schedule, PoE budgets, NVR channels, voltage drop and the list of problems found. Used on the project page and inside the editor.
import { useMemo } from 'react';
import { analyze, type Issue, type Rec } from '@fieldplan/shared';

const csvCell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const download = (name: string, text: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
const ICON: Record<Issue['severity'], string> = { error: '●', warn: '▲', info: '○' };

export function useChecks(records: Rec[], scale: number) { return useMemo(() => analyze(records, () => scale), [records, scale]); }

export function ChecksView({ records, scale, projectName, onPick }: { records: Rec[]; scale: number; projectName: string; onPick?: (id: string) => void }) {
  const r = useChecks(records, scale), sorted = [...r.issues].sort((a, b) => ['error', 'warn', 'info'].indexOf(a.severity) - ['error', 'warn', 'info'].indexOf(b.severity));
  const csv = () => download(projectName.replace(/[^\w\- ]+/g, '') + ' cable schedule.csv', ['Tag,Type,Category,From,From port,To,To port,Length ft,Label', ...r.schedule.map(c => [c.tag, c.type, c.category, c.from, c.fromPort, c.to, c.toPort, Math.round(c.lengthFt), c.label].map(csvCell).join(','))].join('\n'));
  const total = Math.round(r.schedule.reduce((s, c) => s + c.lengthFt, 0));
  return (
    <div className="stack">
      <section className="card">
        <h3>Problems {sorted.length ? <span className="muted small">({sorted.length})</span> : null}</h3>
        {!sorted.length ? <p className="small" style={{ color: 'var(--ok)' }}>No problems found: cable lengths, PoE budgets, ports, NVR channels and voltage drop are all within limits.</p>
          : <ul className="issues">{sorted.map((i, n) => <li key={n} className={i.severity}><span>{ICON[i.severity]}</span><b>{i.where}</b><span className="grow">{i.message}</span>{onPick && i.id && <button className="btn sm" onClick={() => onPick(i.id!)}>Show</button>}</li>)}</ul>}
      </section>
      {!!r.poe.length && <section className="card"><h3>PoE budgets</h3><table className="table compact"><thead><tr><th>Switch</th><th className="num">Budget</th><th className="num">Load</th><th>Used</th><th>Loads</th></tr></thead><tbody>
        {r.poe.map(p => { const pct = p.budget ? (p.used / p.budget) * 100 : 0; return <tr key={p.id}><td className="mono">{p.tag}</td><td className="num mono">{Math.round(p.budget)} W</td><td className="num mono">{Math.round(p.used)} W</td>
          <td><span className="bar"><i style={{ width: Math.min(100, pct) + '%', background: pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warn)' : 'var(--ok)' }} /></span> <span className="small mono">{Math.round(pct)}%</span></td><td className="small">{p.loads.map(l => `${l.tag} ${l.watts}W`).join(', ')}</td></tr>; })}</tbody></table></section>}
      {!!r.nvrs.length && <section className="card"><h3>NVR channels</h3><table className="table compact"><thead><tr><th>NVR</th><th className="num">Channels</th><th className="num">Cameras</th><th>Cameras on it</th></tr></thead><tbody>
        {r.nvrs.map(n => <tr key={n.id} className={n.cameras > n.channels ? 'warn-row' : ''}><td className="mono">{n.tag}</td><td className="num mono">{n.channels}</td><td className="num mono">{n.cameras}</td><td className="small">{n.names.join(', ')}</td></tr>)}</tbody></table></section>}
      {!!r.drops.length && <section className="card"><h3>Voltage drop (electrical &amp; low-voltage power runs)</h3><table className="table compact"><thead><tr><th>Cable</th><th>To</th><th>Wire</th><th className="num">Length</th><th className="num">Load</th><th className="num">Drop</th><th className="num">Max run @3%</th></tr></thead><tbody>
        {r.drops.map(d => <tr key={d.id} className={d.pct > 3 ? 'warn-row' : ''}><td className="mono">{d.tag}</td><td>{d.to}</td><td className="mono">{d.awg} AWG</td><td className="num mono">{Math.round(d.lengthFt)}′</td><td className="num mono">{d.amps.toFixed(1)} A @ {d.volts} V</td><td className="num mono">{d.pct.toFixed(1)}%</td><td className="num mono">{d.maxFt ? Math.round(d.maxFt) + '′' : ''}</td></tr>)}</tbody></table>
        <p className="muted small">Copper at ~75 °C, single-phase round trip. Load = the far-end device's power draw. Recommendation: 3% on branch circuits, 5% total.</p></section>}
      <section className="card"><div className="row"><h3 className="grow">Cable schedule <span className="muted small">{r.schedule.length} cables · {total.toLocaleString()} ft</span></h3><button className="btn sm" disabled={!r.schedule.length} onClick={csv}>Download CSV</button></div>
        {r.schedule.length ? <table className="table compact"><thead><tr><th>Tag</th><th>Type</th><th>From</th><th>To</th><th className="num">Length</th><th>Label</th></tr></thead><tbody>
          {[...r.schedule].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })).map(c => <tr key={c.id}><td className="mono">{c.tag}</td><td>{c.type}</td><td>{c.from}{c.fromPort && <span className="muted small"> · {c.fromPort}</span>}</td><td>{c.to}{c.toPort && <span className="muted small"> · {c.toPort}</span>}</td><td className="num mono">{Math.round(c.lengthFt)}′</td><td className="small">{c.label}</td></tr>)}</tbody></table>
          : <p className="muted small">No cables drawn yet.</p>}</section>
    </div>
  );
}
