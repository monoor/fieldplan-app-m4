// Printable client proposal: cover, scope, plan sheets, pricing and acceptance block. Use the browser's Print → Save as PDF.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ProjectRecord, ProjectSummary } from '@fieldplan/shared';
import { api, fileUrl } from '../api';
import { sheetsOf } from './ProjectView';
import { useBom, money } from '../components/BomView';
import { buildSheetSvg } from '../editor/exportPlan';
import { loadConeOptions } from '../editor/coneStyle';
import type { SceneRec } from '../editor/Scene';

interface Snapshot { project: ProjectSummary; seq: number; records: ProjectRecord[] }

export function Proposal() {
  const { id = '' } = useParams();
  const snap = useQuery({ queryKey: ['project', id], queryFn: () => api<Snapshot>('/api/projects/' + encodeURIComponent(id) + '/snapshot') });
  const records = snap.data?.records ?? [], meta = records.find(r => r.kind === 'meta')?.data ?? {}, scale = Number(meta.scale) || 20;
  const { saved, build } = useBom(records, scale);
  const [lines, setLines] = useState(false), [imgs, setImgs] = useState<{ id: string; name: string; src: string }[]>([]), [intro, setIntro] = useState('');
  useEffect(() => {
    if (!snap.data) return; let dead = false;
    void (async () => {
      const out = [];
      for (const sh of sheetsOf(records)) {
        const recs = records.filter(r => r.sheetId === sh.id && !r.deleted) as unknown as SceneRec[]; if (!recs.some(r => r.kind !== 'underlay')) continue;
        const { svg } = await buildSheetSvg(recs, { fmt: 'svg', paper: 'letter', legend: false, cones: { ...loadConeOptions(), show: false }, projectName: String(meta.name ?? ''), client: snap.data!.project.client, sheetName: sh.name, scale }, fileUrl);
        out.push({ id: sh.id, name: sh.name, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) });
      }
      if (!dead) setImgs(out);
    })().catch(() => undefined);
    return () => { dead = true; };
  }, [snap.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (snap.isLoading) return <div className="page muted">Loading…</div>;
  if (snap.isError) return <div className="page"><div className="bad">{snap.error.message}</div></div>;
  const { project } = snap.data!, bom = build(saved), count = (t: string) => bom.lines.filter(l => l.section === t).reduce((s, l) => s + (l.unit === 'ft' ? 0 : l.qty), 0);
  const cableFt = bom.lines.filter(l => l.section === 'Cable').reduce((s, l) => s + l.qty, 0), sections = ['Devices', 'Cable', 'Openings'].filter(sec => bom.lines.some(l => l.section === sec));
  const sub = (sec: string) => bom.lines.filter(l => l.section === sec).reduce((s, l) => s + l.ext, 0) * (1 + saved.markupPct / 100);
  return (
    <div className="proposal">
      <div className="no-print row wrap"><Link className="btn sm" to={'/p/' + id}>← Back</Link><label className="inline small"><input type="checkbox" checked={lines} onChange={e => setLines(e.target.checked)} /> Show line-item prices</label>
        <input className="grow" placeholder="Intro / scope notes (shown on the proposal)" value={intro} onChange={e => setIntro(e.target.value)} /><button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button></div>
      <section className="sheet cover"><p className="eyebrow">Proposal</p><h1>{project.name}</h1><p className="lead">{project.client ? 'Prepared for ' + project.client : ''}</p><p className="muted">{new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
        {intro && <p className="intro">{intro}</p>}
        <div className="kpis"><div><b>{count('Devices')}</b><span>devices</span></div><div><b>{Math.round(cableFt).toLocaleString()} ft</b><span>cable</span></div><div><b>{count('Openings')}</b><span>doors &amp; windows</span></div></div></section>
      {imgs.map(i => <section className="sheet plan-page" key={i.id}><h2>{i.name}</h2><img src={i.src} alt={i.name} /></section>)}
      <section className="sheet"><h2>Investment</h2>
        {lines ? <table className="ptable"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th></tr></thead><tbody>{bom.lines.filter(l => l.unitPrice !== null).map(l => <tr key={l.key}><td>{l.description}</td><td className="num">{l.qty} {l.unit}</td><td className="num">{money(l.ext * (1 + saved.markupPct / 100))}</td></tr>)}</tbody></table>
          : <table className="ptable"><tbody>{sections.map(sec => <tr key={sec}><td>{sec === 'Devices' ? 'Equipment' : sec === 'Cable' ? 'Cabling & materials' : 'Doors & windows'}</td><td className="num">{money(sub(sec))}</td></tr>)}</tbody></table>}
        {bom.labor > 0 && <table className="ptable"><tbody><tr><td>Installation labor</td><td className="num">{money(bom.labor)}</td></tr></tbody></table>}
        <table className="ptable total"><tbody><tr><td>Total</td><td className="num">{money(bom.total)}</td></tr></tbody></table>
        {bom.unpriced > 0 && <p className="warn small no-print">{bom.unpriced} line(s) have no price, so the total is understated. Add prices on the BOM tab.</p>}
        <p className="small muted">Prices are estimates and valid for 30 days. Final quantities are confirmed on site.</p>
        <div className="sign"><div><span>Accepted by</span></div><div><span>Date</span></div></div></section>
    </div>
  );
}
