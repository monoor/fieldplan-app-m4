import { describe, expect, it } from 'vitest';
import { analyze, maxRunFt, voltageDrop, type Rec } from '../src/checks.js';

const dev = (id: string, typeId: string, extra: Record<string, unknown> = {}): Rec => ({ id, kind: 'device', sheetId: 's', data: { typeId, catKey: 'network', x: 0, y: 0, tag: id.toUpperCase(), ...extra } });
const cable = (id: string, from: string, to: string, ft: number, cableType = 'cat6', category = 'network'): Rec => ({ id, kind: 'cable', sheetId: 's', data: { points: [{ x: 0, y: 0 }, { x: ft * 20, y: 0 }], cableType, category, from, to, tag: id } });
const scale = () => 20;

describe('voltage drop', () => {
  it('12 AWG, 20 A, 100 ft at 120 V ≈ 6.6 %', () => { expect(voltageDrop(100, 20, 120, '12')!.pct).toBeCloseTo(6.58, 1); });
  it('max run for 3 % is shorter at higher current', () => { expect(maxRunFt(3, 10, 120, '12')!).toBeGreaterThan(maxRunFt(3, 20, 120, '12')!); });
});
describe('analyze', () => {
  it('flags Ethernet over 328 ft and builds the schedule with lengths', () => {
    const r = analyze([dev('sw', 'generic-sw'), dev('c1', 'cam-dome', { watts: 6 }), cable('k1', 'sw', 'c1', 400)], scale);
    expect(r.schedule[0]!.lengthFt).toBeCloseTo(400); expect(r.issues.some(i => /328/.test(i.message))).toBe(true);
  });
  it('PoE budget: overload is an error', () => {
    const sw = dev('sw', 'generic-sw', { poeBudget: 30, ports: [{ id: 'g1', name: 'PoE', kind: 'rj45', count: 8, poe: true, watts: 30 }] });
    const recs = [sw, ...[1, 2, 3].map(i => dev('c' + i, 'cam-dome', { watts: 15 })), ...[1, 2, 3].map(i => cable('k' + i, 'sw', 'c' + i, 50))];
    const r = analyze(recs, scale); expect(r.poe[0]).toMatchObject({ budget: 30, used: 45 }); expect(r.issues.some(i => i.severity === 'error' && /PoE/.test(i.message))).toBe(true);
  });
  it('NVR channels count cameras through a switch', () => {
    const recs = [dev('nvr', 'nvr', { channels: 2 }), dev('sw', 'generic-sw'), ...[1, 2, 3].map(i => dev('c' + i, 'cam-dome')), cable('a', 'nvr', 'sw', 20), ...[1, 2, 3].map(i => cable('k' + i, 'sw', 'c' + i, 40))];
    const r = analyze(recs, scale); expect(r.nvrs[0]).toMatchObject({ channels: 2, cameras: 3 }); expect(r.issues.some(i => /channels/.test(i.message))).toBe(true);
  });
  it('electrical cable voltage drop uses the far-end load', () => {
    const recs = [dev('p', 'panel'), dev('l', 'light', { watts: 2400, catKey: 'electrical' }), cable('w', 'p', 'l', 100, 'nm122', 'electrical')];
    const r = analyze(recs, scale); expect(r.drops[0]!.pct).toBeCloseTo(6.58, 1); expect(r.issues.some(i => /voltage drop/.test(i.message))).toBe(true);
  });
  it('ignores deleted records', () => { const k = cable('k', 'a', 'b', 500); k.deleted = true; expect(analyze([k], scale).schedule).toHaveLength(0); });
});
