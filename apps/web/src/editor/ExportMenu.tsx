import { useState } from 'react';
import { fileUrl } from '../api';
import { PAPERS, exportSheet, type ExportFormat } from './exportPlan';
import type { ConeOptions } from './coneStyle';
import type { SceneRec } from './Scene';

/** "Export ▾" popover: SVG / PNG / PDF of the current sheet with title block and legend. */
export function ExportMenu({ recs, cones, projectName, client, sheetName, scale, className = 'btn sm' }: { recs: () => SceneRec[]; cones: ConeOptions; projectName: string; client?: string | null; sheetName: string; scale: number; className?: string }) {
  const [open, setOpen] = useState(false), [fmt, setFmt] = useState<ExportFormat>('pdf'), [paper, setPaper] = useState<keyof typeof PAPERS>('tabloid');
  const [legend, setLegend] = useState(true), [withCones, setWithCones] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await exportSheet(recs(), { fmt, paper, legend, cones: { ...cones, show: withCones && cones.show, solo: false }, projectName, client, sheetName, scale }, fileUrl); setOpen(false); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="cone-ctl">
      <button className={className} onClick={() => setOpen(!open)} aria-expanded={open}>Export ▾</button>
      {open && <div className="popover left" onPointerDown={e => e.stopPropagation()}>
        <div className="seg">{(['pdf', 'png', 'svg'] as const).map(f => <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>{f.toUpperCase()}</button>)}</div>
        <label>Paper<select value={paper} onChange={e => setPaper(e.target.value as keyof typeof PAPERS)}>{Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} /> Legend</label>
        <label className="inline"><input type="checkbox" checked={withCones} onChange={e => setWithCones(e.target.checked)} /> Coverage cones</label>
        <p className="muted small">Exports the current sheet ({sheetName}) with print colours and a title block.</p>
        {err && <div className="bad small">{err}</div>}
        <button className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Exporting…' : 'Download ' + fmt.toUpperCase()}</button>
      </div>}
    </div>
  );
}
