// Bill of materials with editable unit prices, slack, markup and labor. Settings are saved on the project's meta record.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_BOM, buildBom, type BomSettings, type CatalogRef, type ProjectRecord, type Rec } from '@fieldplan/shared';
import { api } from '../api';

export const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const csvCell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export function useBom(records: ProjectRecord[], scale: number) {
  const meta = records.find(r => r.kind === 'meta'), saved = { ...DEFAULT_BOM, ...((meta?.data.bom as Partial<BomSettings> | undefined) ?? {}) };
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<(CatalogRef & { prices: { price: number }[] })[]>('/api/catalog'), retry: false, staleTime: 60_000 });
  const cmap = useMemo(() => new Map((catalog.data ?? []).map(c => [c.id, c])), [catalog.data]);
  return { meta, saved, cmap, build: (s: BomSettings) => buildBom(records as unknown as Rec[], () => scale, s, cmap) };
}

export function BomView({ projectId, records, scale, projectName, canEdit }: { projectId: string; records: ProjectRecord[]; scale: number; projectName: string; canEdit: boolean }) {
  const { meta, saved, build } = useBom(records, scale), qc = useQueryClient();
  const [s, setS] = useState<BomSettings>(saved), [dirty, setDirty] = useState(false), [err, setErr] = useState('');
  const upd = (p: Partial<BomSettings>) => { setS({ ...s, ...p }); setDirty(true); };
  const bom = build(s);
  const save = useMutation({
    mutationFn: () => api('/api/projects/' + projectId + '/push', { method: 'POST', json: { clientId: 'bom', ops: [{ op: 'put', id: meta!.id, kind: 'meta', sheetId: null, data: { ...meta!.data, bom: s }, baseSeq: meta!.seq }] } }),
    onSuccess: () => { setDirty(false); setErr(''); void qc.invalidateQueries({ queryKey: ['project', projectId] }); }, onError: e => setErr((e as Error).message),
  });
  const csv = () => { const rows = ['Section,Item,Detail,Qty,Unit,Unit price,Extended', ...bom.lines.map(l => [l.section, l.description, l.detail, l.qty, l.unit, l.unitPrice ?? '', l.ext.toFixed(2)].map(csvCell).join(',')),
    `"","Materials","","","","",${bom.materials.toFixed(2)}`, `"","Markup ${s.markupPct}%","","","","",${bom.markup.toFixed(2)}`, `"","Labor ${s.laborHours} h × ${s.laborRate}","","","","",${bom.labor.toFixed(2)}`, `"","Total","","","","",${bom.total.toFixed(2)}`];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = projectName.replace(/[^\w\- ]+/g, '') + ' BOM.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  const n = (k: keyof Omit<BomSettings, 'prices'>, label: string, step = 1) => <label className="prop"><span>{label}</span><input type="number" min={0} step={step} value={s[k]} disabled={!canEdit} onChange={e => upd({ [k]: Number(e.target.value) || 0 })} /></label>;
  return (
    <div className="stack">
      <div className="card"><div className="grid4c">{n('slackPct', 'Cable slack %')}{n('markupPct', 'Markup %')}{n('laborHours', 'Labor hours')}{n('laborRate', 'Labor rate $/h', 5)}</div>
        <div className="row"><span className="muted small grow">Prices come from the cheapest catalog price for devices placed from your catalog. Type a price to override; clear it to go back to the catalog.</span>
          <button className="btn sm" onClick={csv} disabled={!bom.lines.length}>Download CSV</button><a className="btn sm" href={'/p/' + projectId + '/proposal'}>Client proposal</a>
          {canEdit && <button className="btn sm primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>}</div>{err && <div className="bad small">{err}</div>}</div>
      {bom.unpriced > 0 && <p className="warn small">{bom.unpriced} line{bom.unpriced > 1 ? 's have' : ' has'} no price yet.</p>}
      {bom.lines.length ? <table className="table compact"><thead><tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th><th className="num">Extended</th></tr></thead><tbody>
        {['Devices', 'Cable', 'Openings'].map(sec => { const rows = bom.lines.filter(l => l.section === sec); return rows.length ? [<tr key={sec} className="sec"><td colSpan={5}>{sec}</td></tr>, ...rows.map(l => <tr key={l.key}><td>{l.description}{l.detail && <span className="muted small"> · {l.detail}</span>}</td><td className="num mono">{l.qty}</td><td>{l.unit}</td>
          <td className="num"><input className="price" type="number" min={0} step={0.01} disabled={!canEdit} value={s.prices[l.key] ?? ''} placeholder={l.priceFromCatalog && l.unitPrice !== null ? l.unitPrice.toFixed(2) : '—'} onChange={e => { const p = { ...s.prices }; if (e.target.value === '') delete p[l.key]; else p[l.key] = Number(e.target.value); upd({ prices: p }); }} /></td><td className="num mono">{l.unitPrice !== null ? money(l.ext) : ''}</td></tr>)] : null; })}
        <tr className="tot"><td colSpan={4}>Materials</td><td className="num mono">{money(bom.materials)}</td></tr>
        {s.markupPct > 0 && <tr className="tot"><td colSpan={4}>Markup {s.markupPct}%</td><td className="num mono">{money(bom.markup)}</td></tr>}
        {bom.labor > 0 && <tr className="tot"><td colSpan={4}>Labor {s.laborHours} h × {money(s.laborRate)}</td><td className="num mono">{money(bom.labor)}</td></tr>}
        <tr className="tot grand"><td colSpan={4}>Total</td><td className="num mono">{money(bom.total)}</td></tr></tbody></table>
        : <p className="muted">Nothing to list yet — place devices and cables in the editor.</p>}
    </div>
  );
}
