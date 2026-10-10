// Properties of the current selection. Devices get their coverage, power and an editable list of inputs/ports.
import { useState } from 'react';
import { DEVICE_CATEGORIES, DOOR_TYPES, SURFACE_MATS, WALL_MATS, WINDOW_TYPES, surfaceMat, wallMat, DEVICE_TYPES, PORT_KINDS, PORT_KIND_LABELS, defaultPorts, deviceType, poePortWatts, portCount, portSummary, newId, type PortGroup, type PortKind } from '@fieldplan/shared';
import { api, fileUrl } from '../api';
import { coverageOf, formatFt } from './Scene';
import { CABLE_TYPES, cableInfo, nextTag } from './tools';
import { dist, type P } from './geometry';
import { styleName } from './coneStyle';
import type { EditorStore, Rec } from './store';
import { isPanelType, panelOf } from './PanelDialog';

type Set = (fields: Record<string, unknown>, key?: string) => void;

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function Inspector({ store, sel, scale, onSelect, onOpenPanel }: { store: EditorStore; sel: ReadonlySet<string>; scale: number; onSelect: (ids: string[]) => void; onOpenPanel: (id: string) => void }) {
  const recs = [...sel].map(id => store.get(id)).filter((r): r is Rec => !!r);
  if (!recs.length) return null;
  if (recs.length > 1) return (
    <div className="inspector"><h3>{recs.length} items selected</h3>
      <button className="btn danger" onClick={() => { store.edit(tx => recs.forEach(r => tx.del(r.id))); onSelect([]); }}>Delete {recs.length} items</button></div>
  );
  const r = recs[0]!;
  const set: Set = (fields, key) => store.edit(tx => tx.patch(r.id, fields), key ?? r.id + ':' + Object.keys(fields).join(','));
  const remove = () => { store.edit(tx => tx.del(r.id)); onSelect([]); };
  const title = ({ device: 'Device', wall: 'Wall', opening: String(r.data.kind === 'window' ? 'Window' : 'Door'), surface: 'Area', cable: 'Cable', bundle: 'Bundle', label: 'Label', dim: 'Measurement', underlay: 'Underlay' } as Record<string, string>)[r.kind] ?? r.kind;
  return (
    <div className="inspector">
      <div className="row"><h3 className="grow">{title}</h3><button className="btn sm danger" onClick={remove}>Delete</button></div>
      {r.kind === 'device' && <DeviceProps store={store} r={r} set={set} scale={scale} onSelect={onSelect} onOpenPanel={onOpenPanel} />}
      {r.kind === 'wall' && <>
        <L t="Wall style"><select value={wallMat(r.data.mat).id} onChange={e => set({ mat: e.target.value, thick: wallMat(e.target.value).thick })}>{WALL_MATS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></L>
        <L t="Thickness (in)"><input type="number" min={1} max={60} step={0.5} value={r.data.thick ?? 4.5} onChange={e => set({ thick: num(e.target.value) ?? 4.5 })} /></L>
        <L t="Label"><input value={r.data.label ?? ''} maxLength={100} onChange={e => set({ label: e.target.value || undefined })} /></L>
        <p className="muted small">Length {formatFt(pathLen(r.data.points) / scale)}</p></>}
      {r.kind === 'opening' && <>
        <L t="Type"><select value={r.data.kind} onChange={e => set({ kind: e.target.value })}><option value="door">Door (blocks cameras)</option><option value="window">Window (cameras see through)</option></select></L>
        {r.data.kind === 'door' ? <>
          <L t="Door style"><select value={r.data.doorType ?? 'single'} onChange={e => set({ doorType: e.target.value })}>{DOOR_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></L>
          <div className="grid2c"><L t="Hinge"><select value={r.data.hinge ?? 'left'} onChange={e => set({ hinge: e.target.value })}><option value="left">Left</option><option value="right">Right</option></select></L>
            <L t="Swings"><select value={r.data.swingSide ?? 'in'} onChange={e => set({ swingSide: e.target.value })}><option value="in">One side</option><option value="out">Other side</option></select></L></div></>
          : <L t="Window style"><select value={r.data.winType ?? 'fixed'} onChange={e => set({ winType: e.target.value })}>{WINDOW_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></L>}
        <L t="Width (ft)"><input type="number" min={1} max={30} step={0.25} value={r.data.width} onChange={e => set({ width: num(e.target.value) ?? 3 })} /></L>
        <L t={'Position ' + Math.round(r.data.t * 100) + '%'}><input type="range" min={2} max={98} value={Math.round(r.data.t * 100)} onChange={e => set({ t: Number(e.target.value) / 100 })} /></L></>}
      {r.kind === 'surface' && <>
        <L t="Floor / area"><select value={surfaceMat(r.data.matId).id} onChange={e => set({ matId: e.target.value })}>{[...new Set(SURFACE_MATS.map(m => m.group))].map(g => <optgroup key={g} label={g}>{SURFACE_MATS.filter(m => m.group === g && !m.hidden).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>)}{surfaceMat(r.data.matId).hidden && <option value="floor">Floor</option>}</select></L>
        <L t="Label"><input value={r.data.label ?? ''} maxLength={100} onChange={e => set({ label: e.target.value || undefined })} /></L></>}
      {r.kind === 'label' && <L t="Text"><textarea rows={3} maxLength={2000} value={r.data.text} onChange={e => set({ text: e.target.value })} /></L>}
      {r.kind === 'dim' && <p className="mono">{formatFt(dist(r.data.points[0], r.data.points[1]) / scale)}</p>}
      {r.kind === 'bundle' && <><L t="Label"><input value={r.data.label ?? ''} onChange={e => set({ label: e.target.value || undefined })} /></L><L t="Contents"><input value={r.data.contents ?? ''} onChange={e => set({ contents: e.target.value || undefined })} /></L></>}
      {r.kind === 'cable' && <CableProps store={store} r={r} set={set} scale={scale} />}
      {r.kind === 'underlay' && <UnderlayProps r={r} set={set} scale={scale} />}
    </div>
  );
}

const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="prop"><span>{t}</span>{children}</label>;
const pathLen = (pts: P[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1]!, p) : 0), 0);

function DeviceProps({ store, r, set, scale, onSelect, onOpenPanel }: { store: EditorStore; r: Rec; set: Set; scale: number; onSelect: (ids: string[]) => void; onOpenPanel: (id: string) => void }) {
  const d = r.data, t = deviceType(d.typeId), cov = coverageOf(d);
  const changeType = (typeId: string) => {
    const nt = deviceType(typeId); if (!nt) return;
    const ports = d.ports ?? defaultPorts(typeId);
    set({ typeId, catKey: nt.cat === 'other' ? d.catKey : nt.cat, ...(ports && !d.ports ? { ports } : {}), fov: undefined, range: undefined }, r.id + ':type');
  };
  const dup = () => { const id = newId(); store.edit(tx => tx.put({ id, kind: 'device', sheetId: r.sheetId, data: { ...structuredClone(d), x: d.x + 20, y: d.y + 20, tag: nextTag(store, (t?.tag ?? 'DEV')) } })); onSelect([id]); };
  const label = t?.label ?? d.typeId;
  return (<>
    <p className="muted small">{label}{cov && <> · {styleName(d.typeId, cov.fov)}</>}</p>
    <div className="grid2c">
      <L t="Tag"><input value={d.tag ?? ''} maxLength={40} onChange={e => set({ tag: e.target.value || undefined })} /></L>
      <L t="Type"><select value={t ? d.typeId : ''} onChange={e => changeType(e.target.value)}>
        {!t && <option value="">{d.typeId}</option>}
        {Object.entries(DEVICE_CATEGORIES).map(([ck, cl]) => <optgroup key={ck} label={cl}>{DEVICE_TYPES.filter(x => x.cat === ck).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>)}
      </select></L>
    </div>
    <L t="Label"><input value={d.label ?? ''} maxLength={200} placeholder={label} onChange={e => set({ label: e.target.value || undefined })} /></L>
    <L t={'Facing ' + Math.round(d.rotation ?? 0) + '°'}><input type="range" min={0} max={359} value={d.rotation ?? 0} onChange={e => set({ rotation: Number(e.target.value) })} /></L>
    {cov && <fieldset className="box"><legend>Coverage</legend>
      <L t={'Field of view ' + Math.round(cov.fov) + '°'}><input type="range" min={10} max={360} value={cov.fov} onChange={e => set({ fov: Number(e.target.value) })} /></L>
      <L t={'Range ' + Math.round(cov.range) + ' ft'}><input type="range" min={3} max={200} value={cov.range} onChange={e => set({ range: Number(e.target.value) })} /></L>
      {(d.fov !== undefined || d.range !== undefined) && <button className="btn sm" onClick={() => set({ fov: undefined, range: undefined }, r.id + ':covreset')}>Reset to type default</button>}
    </fieldset>}
    {!cov && (t?.cat === 'camera' || d.catKey === 'camera') && <button className="btn sm" onClick={() => set({ fov: 90, range: 30 })}>Add coverage cone</button>}
    <div className="grid2c">
      <L t="Power draw (W)"><input type="number" min={0} step={0.5} value={d.watts ?? ''} onChange={e => set({ watts: num(e.target.value) })} /></L>
      <L t="Colour"><span className="row"><input type="color" value={d.color ?? '#5fb8ff'} onChange={e => set({ color: e.target.value })} />{d.color && <button className="btn sm" onClick={() => set({ color: undefined })}>Auto</button>}</span></L>
    </div>
    {isPanelType(d.typeId) && (() => { const pn = panelOf(r); return <button className="btn primary" onClick={() => onOpenPanel(r.id)}>Open panel · {pn.bkrs.length} breakers · {pn.bus} A</button>; })()}
    <PoweredFrom store={store} r={r} set={set} />
    <PortsEditor typeId={d.typeId} ports={d.ports} poeBudget={d.poeBudget} onChange={(ports, extra) => set({ ports, ...extra }, r.id + ':ports')} generic={d.typeId === 'generic' || d.typeId === 'generic-sw'} />
    <L t="Notes (internal)"><textarea rows={3} maxLength={5000} value={d.notes ?? ''} onChange={e => set({ notes: e.target.value || undefined })} /></L>
    <div className="row"><button className="btn sm" onClick={dup}>Duplicate</button><span className="muted small">{(d.x / scale).toFixed(1)}′, {(d.y / scale).toFixed(1)}′</span></div>
  </>);
}

/** Editable inputs/outputs: each group is a named run of ports of one kind (24× PoE RJ45, 2× SFP, 12 V in …). */
export function PortsEditor({ typeId, ports, poeBudget, onChange, generic }: { typeId: string; ports?: PortGroup[]; poeBudget?: number; onChange: (p: PortGroup[], extra?: Record<string, unknown>) => void; generic: boolean }) {
  const [open, setOpen] = useState(generic || !!ports?.length);
  const list = ports ?? [], defaults = defaultPorts(typeId);
  const upd = (i: number, patch: Partial<PortGroup>) => onChange(list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const poe = poePortWatts(list);
  return (
    <fieldset className="box">
      <legend><button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Inputs / ports</button></legend>
      {!open ? <p className="muted small">{portSummary(list) || 'None — click to add'}</p> : <>
        {list.map((g, i) => (
          <div className="port-row" key={g.id}>
            <input value={g.name} maxLength={60} onChange={e => upd(i, { name: e.target.value })} aria-label="Name" />
            <input type="number" min={0} max={512} value={g.count} onChange={e => upd(i, { count: Math.max(0, Math.min(512, Math.floor(Number(e.target.value) || 0))) })} aria-label="Count" className="cnt" />
            <select value={g.kind} onChange={e => upd(i, { kind: e.target.value as PortKind, ...(e.target.value !== 'rj45' ? { poe: undefined } : {}) })} aria-label="Kind">{PORT_KINDS.map(k => <option key={k} value={k}>{PORT_KIND_LABELS[k]}</option>)}</select>
            {g.kind === 'rj45' && <label className="inline small"><input type="checkbox" checked={!!g.poe} onChange={e => upd(i, { poe: e.target.checked || undefined, watts: e.target.checked ? g.watts ?? 30 : g.watts })} />PoE</label>}
            {(g.poe || g.kind === 'dc-out' || g.kind === 'dc-in' || g.kind === 'power-in' || g.kind === 'power-out') && <input type="number" min={0} step={0.5} value={g.watts ?? ''} placeholder="W" onChange={e => upd(i, { watts: num(e.target.value) })} aria-label="Watts" className="cnt" title={g.poe ? 'Watts per PoE port' : 'Rated watts'} />}
            {(g.kind === 'dc-in' || g.kind === 'dc-out') && <input type="number" min={0} step={0.5} value={g.volts ?? ''} placeholder="V" onChange={e => upd(i, { volts: num(e.target.value) })} aria-label="Volts" className="cnt" />}
            {(g.kind === 'rj45' || g.kind === 'sfp' || g.kind === 'fiber') && <input value={g.speed ?? ''} placeholder="Speed" maxLength={20} onChange={e => upd(i, { speed: e.target.value || undefined })} aria-label="Speed" className="spd" />}
            <button className="btn sm" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
          </div>
        ))}
        <div className="row wrap">
          <button className="btn sm" onClick={() => onChange([...list, { id: 'g' + Math.random().toString(36).slice(2, 7), name: 'Port', kind: 'rj45', count: 1 }])}>+ Add input</button>
          <button className="btn sm" onClick={() => onChange([...list, { id: 'g' + Math.random().toString(36).slice(2, 7), name: 'DC in', kind: 'dc-in', count: 1, volts: 12 }])}>+ Power in</button>
          {defaults && <button className="btn sm" onClick={() => onChange(defaults.map(g => ({ ...g })))}>Reset</button>}
        </div>
        {!!list.length && <p className="muted small">{portCount(list)} total · {portSummary(list)}</p>}
        {poe > 0 && <L t={'PoE budget (W) — ports could draw ' + poe + ' W'}><input type="number" min={0} value={poeBudget ?? ''} placeholder={String(poe)} onChange={e => onChange(list, { poeBudget: num(e.target.value) })} /></L>}
      </>}
    </fieldset>
  );
}

function CableProps({ store, r, set, scale }: { store: EditorStore; r: Rec; set: Set; scale: number }) {
  const d = r.data, from = d.from ? store.get(d.from) : undefined, to = d.to ? store.get(d.to) : undefined;
  const opts = (dev?: Rec) => (dev?.data.ports as PortGroup[] | undefined)?.flatMap(g => Array.from({ length: Math.min(g.count, 96) }, (_, i) => ({ v: g.id + ':' + (i + 1), l: g.name + ' ' + (i + 1) }))) ?? [];
  const end = (name: 'from' | 'to', dev: Rec | undefined) => (
    <L t={name === 'from' ? 'From' : 'To'}>
      <span className="row"><span className="grow small">{dev ? (dev.data.tag ?? dev.data.typeId) : 'not connected'}</span>
        {dev && opts(dev).length > 0 && <select value={d[name + 'Port'] ?? ''} onChange={e => set({ [name + 'Port']: e.target.value || undefined })}><option value="">port…</option>{opts(dev).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>}</span>
    </L>);
  return (<>
    <L t="Cable type"><select value={d.cableType} onChange={e => { const c = cableInfo(e.target.value); set({ cableType: c.id, category: c.category }); }}>{CABLE_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}{!CABLE_TYPES.some(c => c.id === d.cableType) && <option value={d.cableType}>{d.cableType}</option>}</select></L>
    <div className="grid2c"><L t="Tag"><input value={d.tag ?? ''} maxLength={40} onChange={e => set({ tag: e.target.value || undefined })} /></L><L t="Label"><input value={d.label ?? ''} maxLength={200} onChange={e => set({ label: e.target.value || undefined })} /></L></div>
    {end('from', from)}{end('to', to)}
    <p className="muted small">Run length {formatFt(pathLen(d.points) / scale)}</p>
  </>);
}

function UnderlayProps({ r, set, scale }: { r: Rec; set: Set; scale: number }) {
  const d = r.data, wFt = d.w / scale;
  return (<>
    {d.fileSha && <img className="thumb-img" src={fileUrl(d.fileSha)} alt="" />}
    <L t={'Opacity ' + Math.round((d.opacity ?? 0.5) * 100) + '%'}><input type="range" min={5} max={100} value={Math.round((d.opacity ?? 0.5) * 100)} onChange={e => set({ opacity: Number(e.target.value) / 100 })} /></L>
    <L t="Width (ft) — set to a known dimension to calibrate"><input type="number" min={1} step={0.5} value={Math.round(wFt * 100) / 100} onChange={e => { const w = num(e.target.value); if (w && w > 0) set({ w: w * scale, h: (w * scale * d.h) / d.w }); }} /></L>
    <label className="inline small"><input type="checkbox" checked={!!d.locked} onChange={e => set({ locked: e.target.checked })} /> Locked (can't be dragged)</label>
    <p className="muted small">With the Select tool, drag the image to move it.</p>
  </>);
}

/** Helper used by the page to add an underlay from an uploaded file. */
export async function uploadUnderlay(file: File): Promise<{ sha256: string; mime: string }> {
  const fd = new FormData(); fd.append('file', file);
  return api<{ sha256: string; mime: string; size: number }>('/api/files', { method: 'POST', body: fd });
}

/** "Powered from": which panel and breaker feeds this device. */
function PoweredFrom({ store, r, set }: { store: EditorStore; r: Rec; set: Set }) {
  const panels = store.all().filter(x => x.kind === 'device' && isPanelType(x.data.typeId) && x.id !== r.id);
  if (!panels.length) return null;
  const feed = r.data.feed as { src?: string; bkr?: string } | undefined, src = panels.find(x => x.id === feed?.src), bk = src ? panelOf(src).bkrs : [];
  return (
    <div className="grid2c">
      <L t="Powered from"><select value={feed?.src ?? ''} onChange={e => set({ feed: e.target.value ? { src: e.target.value } : undefined }, r.id + ':feed')}><option value="">—</option>{panels.map(x => <option key={x.id} value={x.id}>{x.data.tag ?? x.data.typeId}</option>)}</select></L>
      <L t="Breaker"><select value={feed?.bkr ?? ''} disabled={!src} onChange={e => set({ feed: { src: feed!.src, bkr: e.target.value || undefined } }, r.id + ':feed')}><option value="">—</option>{bk.map(b => <option key={b.id} value={b.id}>{b.slot} · {b.amps}A {b.desc}</option>)}</select></L>
    </div>
  );
}
