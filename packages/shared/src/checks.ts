// Low-voltage and cabling checks computed from a project's records: cable schedule, PoE budgets, NVR channels, voltage drop.
import { deviceType } from './devicetypes.js';
import { poePortWatts, portCount } from './ports.js';
import type { PortGroup } from './ports.js';

export interface Rec { id: string; kind: string; sheetId?: string | null; data: Record<string, any>; deleted?: boolean } // eslint-disable-line @typescript-eslint/no-explicit-any
export type Severity = 'error' | 'warn' | 'info';
export interface Issue { severity: Severity; where: string; message: string; id?: string }

export const AWG_CM: Record<string, number> = { '24': 404, '22': 640, '20': 1020, '18': 1620, '16': 2580, '14': 4110, '12': 6530, '10': 10380, '8': 16510, '6': 26240, '4': 41740, '3': 52620, '2': 66360, '1': 83690, '1/0': 105600, '2/0': 133100, '3/0': 167800, '4/0': 211600 };
export const K_CU = 12.9; // ohm-cmil/ft, copper at about 75 °C
/** Conductor size for cable types that carry power (used for voltage drop). */
export const CABLE_AWG: Record<string, string> = { nm142: '14', nm122: '12', nm103: '10', nm63: '6', 'lv-18-2': '18', 'sec-18-4': '18', 'spk-16-2': '16', ser2: '2', ser6: '6' };
export const COPPER_LIMIT_FT = 328; // 100 m channel limit for twisted-pair Ethernet
const COPPER = /^cat/;

export const pathLength = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : 0), 0);

export function voltageDrop(lenFt: number, amps: number, volts: number, awg: string, threePhase = false) {
  const cm = AWG_CM[awg]; if (!cm || !amps || !volts) return null;
  const vd = (threePhase ? 1.732 : 2) * lenFt * amps * K_CU / cm; return { vd, pct: (vd / volts) * 100 };
}
/** Longest run (ft) that stays under `pct` percent drop. */
export const maxRunFt = (pct: number, amps: number, volts: number, awg: string) => { const cm = AWG_CM[awg]; return cm && amps ? ((volts * pct) / 100) * cm / (2 * amps * K_CU) : null; };

export interface CableRow { id: string; tag: string; type: string; category: string; from: string; fromPort: string; to: string; toPort: string; lengthFt: number; sheetId: string | null; label: string }

export function analyze(records: Rec[], scaleOf: (sheetId: string | null) => number) {
  const live = records.filter(r => !r.deleted), devices = live.filter(r => r.kind === 'device'), cables = live.filter(r => r.kind === 'cable');
  const dev = new Map(devices.map(d => [d.id, d])), tagOf = (id?: string | null) => (id ? dev.get(id)?.data.tag ?? deviceType(dev.get(id)?.data.typeId)?.label ?? '?' : '—');
  const portName = (d: Rec | undefined, ref?: string) => { if (!ref || !d) return ''; const [gid, n] = ref.split(':'), g = (d.data.ports as PortGroup[] | undefined)?.find(x => x.id === gid); return g ? `${g.name} ${n}` : ''; };
  const issues: Issue[] = [];

  const schedule: CableRow[] = cables.map(c => {
    const scale = scaleOf(c.sheetId ?? null) || 20, lengthFt = pathLength(c.data.points) / scale, f = dev.get(c.data.from), t = dev.get(c.data.to);
    return { id: c.id, tag: c.data.tag ?? '', type: c.data.cableType, category: c.data.category ?? '', from: tagOf(c.data.from), fromPort: portName(f, c.data.fromPort), to: tagOf(c.data.to), toPort: portName(t, c.data.toPort), lengthFt, sheetId: c.sheetId ?? null, label: c.data.label ?? '' };
  });
  for (const r of schedule) {
    if (COPPER.test(r.type) && r.lengthFt > COPPER_LIMIT_FT) issues.push({ severity: 'error', where: r.tag || r.type, id: r.id, message: `${Math.round(r.lengthFt)} ft of ${r.type} exceeds the ${COPPER_LIMIT_FT} ft (100 m) Ethernet limit — use fiber or an extender.` });
    if (r.from === '—' || r.to === '—') issues.push({ severity: 'info', where: r.tag || r.type, id: r.id, message: 'Cable is not connected to a device at both ends.' });
  }

  // adjacency over cables
  const adj = new Map<string, { cable: Rec; other: string }[]>();
  for (const c of cables) { const a = c.data.from, b = c.data.to; if (!a || !b) continue; (adj.get(a) ?? adj.set(a, []).get(a)!).push({ cable: c, other: b }); (adj.get(b) ?? adj.set(b, []).get(b)!).push({ cable: c, other: a }); }

  // PoE budgets: every device with PoE ports, loads = devices on a cable plugged into it
  const poe = devices.flatMap(sw => {
    const ports = (sw.data.ports as PortGroup[] | undefined) ?? [], potential = poePortWatts(ports); if (!potential) return [];
    const budget = Number(sw.data.poeBudget) || potential, loads = (adj.get(sw.id) ?? []).map(e => ({ d: dev.get(e.other)!, cable: e.cable })).filter(x => x.d && Number(x.d.data.watts) > 0 && x.cable.data.category !== 'electrical');
    const used = loads.reduce((s, l) => s + Number(l.d.data.watts), 0), poePorts = ports.filter(g => g.poe).reduce((s, g) => s + g.count, 0);
    const row = { id: sw.id, tag: tagOf(sw.id), budget, used, poePorts, portsUsed: (adj.get(sw.id) ?? []).length, loads: loads.map(l => ({ tag: tagOf(l.d.id), watts: Number(l.d.data.watts) })) };
    if (used > budget) issues.push({ severity: 'error', where: row.tag, id: sw.id, message: `PoE load ${Math.round(used)} W exceeds the ${Math.round(budget)} W budget.` });
    else if (used > budget * 0.8) issues.push({ severity: 'warn', where: row.tag, id: sw.id, message: `PoE load ${Math.round(used)} W is over 80% of the ${Math.round(budget)} W budget.` });
    if (row.portsUsed > poePorts && poePorts) issues.push({ severity: 'warn', where: row.tag, id: sw.id, message: `${row.portsUsed} cables connected but only ${poePorts} PoE ports.` });
    return [row];
  });
  // total ports
  for (const sw of devices) { const total = portCount((sw.data.ports as PortGroup[] | undefined) ?? []); const n = (adj.get(sw.id) ?? []).length; if (total && n > total) issues.push({ severity: 'error', where: tagOf(sw.id), id: sw.id, message: `${n} cables connected but only ${total} ports.` }); }

  // NVR channels: cameras reachable through network gear
  const isCam = (d: Rec) => deviceType(d.data.typeId)?.cat === 'camera' && !!(deviceType(d.data.typeId)?.fov || d.data.fov);
  const nvrs = devices.filter(d => d.data.typeId === 'nvr' || /nvr/.test(String(d.data.typeId))).map(n => {
    const seen = new Set<string>([n.id]), q = [n.id], cams = new Set<string>();
    while (q.length) { const cur = q.shift()!; for (const e of adj.get(cur) ?? []) { if (e.cable.data.category === 'electrical' || seen.has(e.other)) continue; seen.add(e.other); const o = dev.get(e.other)!; if (!o) continue; if (isCam(o)) cams.add(o.id); else q.push(e.other); } }
    const channels = Number(n.data.channels) || 8, row = { id: n.id, tag: tagOf(n.id), channels, cameras: cams.size, names: [...cams].map(tagOf) };
    if (row.cameras > channels) issues.push({ severity: 'error', where: row.tag, id: n.id, message: `${row.cameras} cameras reach this NVR but it has ${channels} channels.` });
    return row;
  });

  // Electrical cable voltage drop: load = watts of the device at the far end
  const drops = cables.filter(c => CABLE_AWG[c.data.cableType]).flatMap(c => {
    const to = dev.get(c.data.to), watts = Number(to?.data.watts) || 0; if (!watts) return [];
    const volts = Number(to?.data.volts) || (/^lv|sec|spk/.test(c.data.cableType) ? 12 : 120), amps = watts / volts, r = schedule.find(x => x.id === c.id)!, awg = CABLE_AWG[c.data.cableType]!, vd = voltageDrop(r.lengthFt, amps, volts, awg);
    if (!vd) return [];
    const row = { id: c.id, tag: r.tag, to: r.to, awg, lengthFt: r.lengthFt, amps, volts, pct: vd.pct, maxFt: maxRunFt(3, amps, volts, awg) };
    if (vd.pct > 5) issues.push({ severity: 'error', where: r.tag || r.type, id: c.id, message: `${vd.pct.toFixed(1)}% voltage drop at ${amps.toFixed(1)} A over ${Math.round(r.lengthFt)} ft of ${awg} AWG.` });
    else if (vd.pct > 3) issues.push({ severity: 'warn', where: r.tag || r.type, id: c.id, message: `${vd.pct.toFixed(1)}% voltage drop (over the 3% branch-circuit recommendation).` });
    return [row];
  });
  return { schedule, poe, nvrs, drops, issues };
}
