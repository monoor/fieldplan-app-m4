// Left rail: drawing tools and the device picker (built-in types and the catalog).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEVICE_CATEGORIES, DEVICE_TYPES, DOOR_TYPES, SURFACE_MATS, WALL_MATS, WINDOW_TYPES, defaultPorts, deviceType, type CatalogItem, type PortGroup } from '@fieldplan/shared';
import { api } from '../api';
import { CABLE_TYPES, TOOLS, type Mode, type Tool } from './tools';
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

export interface Picks { wall: string; door: string; window: string; surface: string; cable: string }

const Swatch = ({ color, dash }: { color: string; dash?: boolean }) => <i className="sw" style={{ background: dash ? 'transparent' : color, borderColor: color, borderStyle: dash ? 'dashed' : 'solid' }} />;

export function Palette({ mode, setMode, tool, setTool, placement, setPlacement, picks, setPick }: {
  mode: Mode; setMode: (m: Mode) => void; tool: Tool; setTool: (t: Tool) => void; placement: Placement; setPlacement: (p: Placement) => void;
  picks: Picks; setPick: (k: keyof Picks, v: string) => void;
}) {
  const [q, setQ] = useState(''), [cat, setCat] = useState('camera'), [src, setSrc] = useState<'builtin' | 'catalog'>('builtin');
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/api/catalog'), enabled: mode === 'systems' && src === 'catalog' });
  const types = useMemo(() => DEVICE_TYPES.filter(t => (q ? (t.label + ' ' + t.id).toLowerCase().includes(q.toLowerCase()) : t.cat === cat)), [q, cat]);
  const items = useMemo(() => (catalog.data ?? []).filter(i => !q || (i.vendor + ' ' + i.model + ' ' + i.name).toLowerCase().includes(q.toLowerCase())), [catalog.data, q]);
  const pick = (p: Placement) => { setPlacement(p); setTool('device'); };
  const tools = TOOLS.filter(t => t.modes.includes(mode));
  const groups = [...new Set(SURFACE_MATS.map(m => m.group))];
  const list = (rows: { id: string; label: string; sub?: string; swatch?: React.ReactNode }[], value: string, set: (v: string) => void) =>
    <div className="opt-list">{rows.map(r => <button key={r.id} className={'opt' + (value === r.id ? ' on' : '')} onClick={() => set(r.id)}>{r.swatch}<span>{r.label}</span>{r.sub && <small>{r.sub}</small>}</button>)}</div>;
  return (
    <div className="palette">
      <div className="seg mode"><button className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>Draw building</button><button className={mode === 'systems' ? 'on' : ''} onClick={() => setMode('systems')}>Systems</button></div>
      <div className="tools">{tools.map(t => <button key={t.id} className={'tool' + (tool === t.id ? ' on' : '')} onClick={() => setTool(t.id)} title={t.hint + ' (' + t.key + ')'}>{t.label}</button>)}</div>

      {mode === 'build' && <div className="opts">
        {(tool === 'wall' || tool === 'select' || tool === 'label' || tool === 'dim') && <><h4>Walls</h4>{list(WALL_MATS.map(m => ({ id: m.id, label: m.label, sub: m.thick + '″', swatch: <Swatch color={m.color} dash={!!m.dash} /> })), tool === 'wall' ? picks.wall : '', v => { setPick('wall', v); setTool('wall'); })}</>}
        {tool === 'door' && <><h4>Door style</h4>{list(DOOR_TYPES.map(([id, label]) => ({ id, label })), picks.door, v => setPick('door', v))}</>}
        {tool === 'window' && <><h4>Window style</h4>{list(WINDOW_TYPES.map(([id, label]) => ({ id, label })), picks.window, v => setPick('window', v))}</>}
        {(tool === 'surface' || tool === 'select' || tool === 'label' || tool === 'dim') && groups.map(g => <div key={g}><h4>{g === 'Interior' ? 'Floors' : g}</h4>
          {list(SURFACE_MATS.filter(m => m.group === g && !m.hidden).map(m => ({ id: m.id, label: m.label, swatch: <Swatch color={m.color} /> })), tool === 'surface' ? picks.surface : '', v => { setPick('surface', v); setTool('surface'); })}</div>)}
        {tool === 'select' || tool === 'label' || tool === 'dim' ? null : null}
      </div>}

      {mode === 'systems' && (tool === 'cable'
        ? <div className="opts"><h4>Cable type</h4>{list(CABLE_TYPES.map(c => ({ id: c.id, label: c.label, sub: c.category })), picks.cable, v => setPick('cable', v))}</div>
        : tool === 'bundle' ? <p className="muted small">Click along the route of a conduit or bundle. Cables can be tagged to it later.</p>
        : <div className="devices">
          <div className="seg"><button className={src === 'builtin' ? 'on' : ''} onClick={() => setSrc('builtin')}>Devices</button><button className={src === 'catalog' ? 'on' : ''} onClick={() => setSrc('catalog')}>My catalog</button></div>
          <div className="row"><input className="grow" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
            {src === 'builtin' && !q && <select value={cat} onChange={e => setCat(e.target.value)}>{Object.entries(DEVICE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</div>
          <div className="dev-list">
            {src === 'builtin' ? types.map(t => <button key={t.id} className={'dev' + (tool === 'device' && placement.typeId === t.id && !placement.over ? ' on' : '')} onClick={() => pick({ typeId: t.id })}><b>{t.tag}</b>{t.label}</button>)
              : catalog.isLoading ? <p className="muted small">Loading…</p> : !items.length ? <p className="muted small">{catalog.data?.length ? 'No matches.' : 'The catalog is empty — add or import items on the Catalog page.'}</p>
              : items.map(i => <button key={i.id} className="dev" onClick={() => pick(itemPlacement(i))}><b>{i.category.slice(0, 3)}</b><span>{i.vendor} {i.model}<small>{i.name}</small></span></button>)}
          </div>
        </div>)}
    </div>
  );
}
