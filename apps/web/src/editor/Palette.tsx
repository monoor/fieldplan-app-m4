// Left rail: drawing tools and the device picker (built-in types and the catalog).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEVICE_CATEGORIES, DEVICE_TYPES, defaultPorts, deviceType, type CatalogItem, type PortGroup } from '@fieldplan/shared';
import { api } from '../api';
import { CABLE_TYPES, MATERIALS, TOOLS, type Tool } from './tools';
import type { Placement } from './EditorCanvas';

const itemPlacement = (i: CatalogItem): Placement => {
  const typeId = i.typeKey && deviceType(i.typeKey) ? i.typeKey : i.category === 'camera' ? 'cam-fixed' : 'generic';
  const s = i.specs, ports: PortGroup[] = [];
  const gid = (n: string) => 'g' + n + Math.random().toString(36).slice(2, 5);
  if (s.ports) ports.push({ id: gid('l'), name: s.poePorts ? 'PoE LAN' : 'LAN', kind: 'rj45', count: s.ports, ...(s.poePorts ? { poe: true, watts: 30 } : {}) });
  if (s.sfpPorts) ports.push({ id: gid('s'), name: 'SFP', kind: 'sfp', count: s.sfpPorts });
  const base = defaultPorts(typeId);
  return { typeId, over: {
    catKey: i.category === 'other' ? 'network' : i.category, label: i.vendor + ' ' + i.model,
    ...(s.hfovDeg ? { fov: s.hfovDeg } : {}), ...(s.irRangeFt ? { range: s.irRangeFt } : {}), ...(s.maxPowerW ? { watts: s.maxPowerW } : {}),
    ...(ports.length ? { ports } : base ? { ports: base } : {}), ...(s.poeBudgetW ? { poeBudget: s.poeBudgetW } : {}),
  } };
};

export function Palette({ tool, setTool, placement, setPlacement, cableType, setCableType, matId, setMatId }: {
  tool: Tool; setTool: (t: Tool) => void; placement: Placement; setPlacement: (p: Placement) => void; cableType: string; setCableType: (c: string) => void; matId: string; setMatId: (m: string) => void;
}) {
  const [q, setQ] = useState(''), [cat, setCat] = useState('camera'), [src, setSrc] = useState<'builtin' | 'catalog'>('builtin');
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/api/catalog'), enabled: src === 'catalog' });
  const types = useMemo(() => DEVICE_TYPES.filter(t => (q ? (t.label + ' ' + t.id).toLowerCase().includes(q.toLowerCase()) : t.cat === cat)), [q, cat]);
  const items = useMemo(() => (catalog.data ?? []).filter(i => !q || (i.vendor + ' ' + i.model + ' ' + i.name).toLowerCase().includes(q.toLowerCase())), [catalog.data, q]);
  const pick = (p: Placement) => { setPlacement(p); setTool('device'); };
  return (
    <div className="palette">
      <div className="tools">{TOOLS.map(t => <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={t.hint}><span>{t.label}</span><kbd>{t.key}</kbd></button>)}</div>
      {tool === 'cable' && <label className="prop"><span>Cable type</span><select value={cableType} onChange={e => setCableType(e.target.value)}>{CABLE_TYPES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
      {tool === 'surface' && <label className="prop"><span>Surface</span><select value={matId} onChange={e => setMatId(e.target.value)}>{MATERIALS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
      <div className="devices">
        <div className="seg"><button className={src === 'builtin' ? 'on' : ''} onClick={() => setSrc('builtin')}>Devices</button><button className={src === 'catalog' ? 'on' : ''} onClick={() => setSrc('catalog')}>My catalog</button></div>
        <input placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        {src === 'builtin' && !q && <select value={cat} onChange={e => setCat(e.target.value)}>{Object.entries(DEVICE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <div className="dev-list">
          {src === 'builtin' ? types.map(t => <button key={t.id} className={'dev' + (tool === 'device' && placement.typeId === t.id && !placement.over ? ' on' : '')} onClick={() => pick({ typeId: t.id })}><b>{t.tag}</b>{t.label}</button>)
            : catalog.isLoading ? <p className="muted small">Loading…</p> : !items.length ? <p className="muted small">{catalog.data?.length ? 'No matches.' : 'The catalog is empty — add or import items on the Catalog page.'}</p>
            : items.map(i => <button key={i.id} className="dev" onClick={() => pick(itemPlacement(i))}><b>{i.category.slice(0, 3)}</b><span>{i.vendor} {i.model}<small>{i.name}</small></span></button>)}
        </div>
      </div>
    </div>
  );
}
