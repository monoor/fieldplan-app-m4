// Read-only panel schedules for the project page: every panel with its breakers, wire sizes and the devices on each circuit. CSV export.
import type { ProjectRecord } from '@fieldplan/shared';
import { breakerAmps, panelSlots, wireFor } from '@fieldplan/shared';
import { breakerLoads, isPanelType, panelOf, type Dev } from '../editor/PanelDialog';

const csvCell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
export const panelsOf = (records: ProjectRecord[]): Dev[] => records.filter(r => r.kind === 'device' && !r.deleted && isPanelType(String(r.data.typeId))).map(r => ({ id: r.id, data: r.data as Dev['data'] }));

export function PanelSchedule({ records, projectName }: { records: ProjectRecord[]; projectName: string }) {
  const devs: Dev[] = records.filter(r => r.kind === 'device' && !r.deleted).map(r => ({ id: r.id, data: r.data as Dev['data'] })), panels = panelsOf(records);
  if (!panels.length) return <p className="muted">No panels yet. In the editor, switch to Systems, place a Main Panel or Subpanel (Electrical), and open it to add breakers.</p>;
  const csv = () => {
    const out = ['Panel,Slot,Circuit,Amps,Poles,Type,Min Cu AWG,Min NM AWG,Devices,Load VA'];
    for (const pd of panels) { const p = panelOf(pd), ld = breakerLoads(devs, pd.id); for (const b of [...p.bkrs].sort((a, c) => a.slot - c.slot)) { const w = wireFor(b.amps), l = ld.get(b.id); out.push([pd.data.tag ?? 'Panel', b.slot, b.desc, b.amps, b.poles, b.type, w?.w[0] ?? '', w?.w[1] ?? '', l?.devs.map(d => d.data.tag ?? d.data.typeId).join(' '), l ? Math.round(l.va) : ''].map(csvCell).join(',')); } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' })); a.download = projectName.replace(/[^\w\- ]+/g, '') + ' panel schedule.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  return (
    <div className="stack">
      <div className="row"><span className="muted small grow">{panels.length} panel{panels.length > 1 ? 's' : ''}. Edit breakers in the plan editor (select a panel → Open panel).</span><button className="btn sm" onClick={csv}>Download CSV</button></div>
      {panels.map(pd => { const p = panelOf(pd), s = panelSlots(p), ld = breakerLoads(devs, pd.id), sorted = [...p.bkrs].sort((a, b) => a.slot - b.slot);
        return <div className="card" key={pd.id}>
          <div className="row wrap"><h3 className="grow">{pd.data.tag ?? 'Panel'} <span className="muted small">{pd.data.label ?? ''}</span></h3>
            <span className="mono small">{p.volt.replace('-1', ' 1Ø').replace('-3', ' 3Ø')} · {p.bus} A bus · {p.main ? p.main + ' A main' : 'MLO'} · {s.map.size}/{p.spaces} spaces · {s.legs.slice(0, s.phases).map((a, i) => 'ABC'[i] + ' ' + a + 'A').join(' ')}</span></div>
          {sorted.length ? <table className="table compact"><thead><tr><th>Slot</th><th>Circuit</th><th className="num">Amps</th><th>Poles</th><th>Type</th><th>Min wire</th><th>Devices</th><th className="num">Load</th></tr></thead>
            <tbody>{sorted.map(b => { const w = wireFor(b.amps), l = ld.get(b.id), a = l ? breakerAmps(l.va, b.poles, p.volt) : 0;
              return <tr key={b.id}><td className="mono">{b.slot}{b.poles > 1 ? '–' + (b.slot + 2 * (b.poles - 1)) : ''}</td><td>{b.desc}</td><td className="num mono">{b.amps}</td><td>{b.poles}P</td><td>{b.type}</td><td className="mono small">{w ? w.w[0] + ' Cu / ' + w.w[1] + ' NM' : '—'}</td>
                <td className="small">{l?.devs.map(d => d.data.tag ?? d.data.typeId).join(', ') ?? ''}</td><td className="num mono">{l ? Math.round(l.va) + ' VA · ' + a.toFixed(1) + ' A' : ''}{l && a > b.amps * 0.8 && <span className="warn"> !</span>}</td></tr>; })}</tbody></table>
            : <p className="muted small">No breakers.</p>}
        </div>; })}
    </div>
  );
}
