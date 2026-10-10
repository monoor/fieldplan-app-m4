import { useState } from 'react';
import { fileUrl } from '../api';
import { PAPERS, exportSheet, exportSheetSet, type ExportFormat, type SheetInput } from './exportPlan';
import type { ConeOptions } from './coneStyle';
import type { SceneRec } from './Scene';

/** "Export ▾" popover: SVG / PNG / PDF of the current sheet with title block and legend. */
export function ExportMenu({ recs, allSheets, cones, projectName, client, sheetName, scale, className = 'btn sm' }: { recs: () => SceneRec[]; allSheets?: () => SheetInput[]; cones: ConeOptions; projectName: string; client?: string | null; sheetName: string; scale: number; className?: string }) {
  const [open, setOpen] = useState(false), [fmt, setFmt] = useState<ExportFormat>('pdf'), [paper, setPaper] = useState<keyof typeof PAPERS>('tabloid');
  const [scope, setScope] = useState<'sheet' | 'set'>('sheet'), [schedules, setSchedules] = useState(true), [legend, setLegend] = useState(true), [withCones, setWithCones] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { if (fmt === 'pdf' && scope === 'set' && allSheets) await exportSheetSet(allSheets(), { paper, legend, cones: { ...cones, show: withCones && cones.show, solo: false }, projectName, client, scale, schedules }, fileUrl); else await exportSheet(recs(), { fmt, paper, legend, cones: { ...cones, show: withCones && cones.show, solo: false }, projectName, client, sheetName, scale }, fileUrl); setOpen(false); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="cone-ctl">
      <button className={className} onClick={() => setOpen(!open)} aria-expanded={open}>Export ▾</button>
      {open && <div className="popover left" onPointerDown={e => e.stopPropagation()}>
        <div className="seg">{(['pdf', 'png', 'svg'] as const).map(f => <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>{f.toUpperCase()}</button>)}</div>
        {fmt === 'pdf' && allSheets && <div className="seg"><button className={scope === 'sheet' ? 'on' : ''} onClick={() => setScope('sheet')}>This sheet</button><button className={scope === 'set' ? 'on' : ''} onClick={() => setScope('set')}>Sheet set</button></div>}
        {fmt === 'pdf' && scope === 'set' && allSheets && <label className="inline"><input type="checkbox" checked={schedules} onChange={e => setSchedules(e.target.checked)} /> Add panel, cable and quantity schedules</label>}
        <label>Paper<select value={paper} onChange={e => setPaper(e.target.value as keyof typeof PAPERS)}>{Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></label>
        <label className="inline"><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} /> Legend</label>
        <label className="inline"><input type="checkbox" checked={withCones} onChange={e => setWithCones(e.target.checked)} /> Coverage cones</label>
        <p className="muted small">{fmt === 'pdf' && scope === 'set' ? 'One page per sheet' : 'Exports ' + sheetName}, with print colours and a title block.</p>
        {err && <div className="bad small">{err}</div>}
        <button className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Exporting…' : 'Download ' + fmt.toUpperCase()}</button>
      </div>}
    </div>
  );
}
