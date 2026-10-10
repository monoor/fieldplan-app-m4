import { DEVICE_TYPES, deviceType, defaultPorts, newId, type RecordKind } from '@fieldplan/shared';
import type { EditorStore, Rec } from './store';
import { nearOnLine, type P } from './geometry';

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'surface' | 'device' | 'cable' | 'bundle' | 'label' | 'dim';
export type Mode = 'build' | 'systems';
export const TOOLS: { id: Tool; label: string; key: string; hint: string; modes: Mode[] }[] = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Click to select · drag to move · drag empty space to pan', modes: ['build', 'systems'] },
  { id: 'wall', label: 'Wall', key: 'W', hint: 'Click points · double-click or Enter to finish · Shift = straight lines', modes: ['build'] },
  { id: 'door', label: 'Door', key: 'D', hint: 'Click a wall to place a door', modes: ['build'] },
  { id: 'window', label: 'Window', key: 'N', hint: 'Click a wall to place a window (cameras see through windows)', modes: ['build'] },
  { id: 'surface', label: 'Floor', key: 'A', hint: 'Click corners · double-click or Enter to close', modes: ['build'] },
  { id: 'device', label: 'Device', key: 'P', hint: 'Pick a device on the left, then click to place · cameras snap to walls', modes: ['systems'] },
  { id: 'cable', label: 'Cable', key: 'C', hint: 'Click points · end on a device to connect it · double-click or Enter to finish', modes: ['systems'] },
  { id: 'bundle', label: 'Bundle', key: 'B', hint: 'Click points for a cable bundle / conduit run', modes: ['systems'] },
  { id: 'label', label: 'Label', key: 'T', hint: 'Click to place text', modes: ['build', 'systems'] },
  { id: 'dim', label: 'Measure', key: 'M', hint: 'Click two points', modes: ['build', 'systems'] },
];
export const modeOf = (t: Tool): Mode | null => { const m = TOOLS.find(x => x.id === t)?.modes; return m && m.length === 1 ? m[0]! : null; };

export const CABLE_TYPES = [
  { id: 'cat6', label: 'Cat6', category: 'network' }, { id: 'cat6a', label: 'Cat6A', category: 'network' }, { id: 'cat5e', label: 'Cat5e', category: 'network' },
  { id: 'fiber', label: 'Fiber', category: 'network' }, { id: 'coax', label: 'Coax / RG6', category: 'camera' }, { id: 'sec-18-4', label: '18/4 security', category: 'access' },
  { id: 'spk-16-2', label: '16/2 speaker', category: 'av' }, { id: 'nm142', label: '14/2 NM-B', category: 'electrical' }, { id: 'nm122', label: '12/2 NM-B', category: 'electrical' },
  { id: 'nm103', label: '10/3 NM-B', category: 'electrical' }, { id: 'lv-18-2', label: '18/2 low-voltage', category: 'smart' },
];
export const cableInfo = (id: string) => CABLE_TYPES.find(c => c.id === id) ?? { id, label: id, category: 'network' };


/** Next free tag for a device type: "CD-1", "CD-2" … */
export function nextTag(store: EditorStore, prefix: string): string {
  let max = 0; const re = new RegExp('^' + prefix.replace(/[^A-Za-z0-9]/g, '') + '-(\\d+)$');
  for (const r of store.all()) if (r.kind === 'device') { const m = re.exec(String(r.data.tag ?? '')); if (m) max = Math.max(max, Number(m[1])); }
  return prefix + '-' + (max + 1);
}

/** New device record data for a built-in type. */
export function newDeviceData(store: EditorStore, typeId: string, at: P, over: Record<string, unknown> = {}): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = deviceType(typeId) ?? DEVICE_TYPES.find(x => x.id === 'generic')!;
  const ports = defaultPorts(typeId);
  return { catKey: t.cat === 'other' ? 'network' : t.cat, typeId, x: at.x, y: at.y, rotation: 0, tag: nextTag(store, t.tag || 'DEV'), ...(ports ? { ports } : {}), ...over };
}

/** If `p` is close to a wall, the spot just off its nearer face and the direction facing away from the wall. */
export function wallMount(recs: readonly Rec[], p: P, scale: number, reach: number): { x: number; y: number; rotation: number } | null {
  let best: { d: number; pt: P; nx: number; ny: number; half: number } | null = null;
  for (const w of recs) {
    if (w.kind !== 'wall') continue; const near = nearOnLine(p, w.data.points); if (!near) continue;
    const half = (((w.data.thick as number | undefined) ?? 4.5) / 12) * scale / 2;
    if (near.d > half + reach || (best && near.d >= best.d)) continue;
    const a = w.data.points[near.seg] as P, b = w.data.points[near.seg + 1] as P, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len; if ((p.x - near.pt.x) * nx + (p.y - near.pt.y) * ny < 0) { nx = -nx; ny = -ny; }
    best = { d: near.d, pt: near.pt, nx, ny, half };
  }
  if (!best) return null;
  return { x: best.pt.x + best.nx * (best.half + 1), y: best.pt.y + best.ny * (best.half + 1), rotation: (Math.round((Math.atan2(best.nx, -best.ny) * 180) / Math.PI) + 360) % 360 };
}

export const newRecId = (_kind: RecordKind) => newId();
