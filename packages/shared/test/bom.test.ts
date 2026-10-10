import { describe, expect, it } from 'vitest';
import { DEFAULT_BOM, buildBom } from '../src/bom.js';
import type { Rec } from '../src/checks.js';

const dev = (id: string, typeId: string, extra = {}): Rec => ({ id, kind: 'device', sheetId: 's', data: { typeId, x: 0, y: 0, ...extra } });
const cab = (id: string, ft: number, cableType = 'cat6'): Rec => ({ id, kind: 'cable', sheetId: 's', data: { cableType, points: [{ x: 0, y: 0 }, { x: ft * 20, y: 0 }] } });
describe('bom', () => {
  it('groups devices by type and adds slack to cable', () => {
    const b = buildBom([dev('a', 'cam-dome'), dev('b', 'cam-dome'), cab('c1', 100), cab('c2', 50)], () => 20, DEFAULT_BOM);
    expect(b.lines.find(l => l.key === 'type:cam-dome')!.qty).toBe(2); expect(b.lines.find(l => l.key === 'cable:cat6')!.qty).toBe(165);
  });
  it('prefers a user price over the catalog and totals with markup and labor', () => {
    const cat = new Map([['x', { id: 'x', vendor: 'UniFi', model: 'G5', name: 'Dome', prices: [{ price: 180 }, { price: 150 }] }]]);
    const recs = [dev('a', 'cam-dome', { catalogId: 'x' }), dev('b', 'cam-dome', { catalogId: 'x' })];
    expect(buildBom(recs, () => 20, DEFAULT_BOM, cat).lines[0]).toMatchObject({ unitPrice: 150, priceFromCatalog: true, ext: 300 });
    const b = buildBom(recs, () => 20, { ...DEFAULT_BOM, prices: { 'cat:x': 100 }, markupPct: 10, laborHours: 4, laborRate: 100 }, cat);
    expect(b.materials).toBe(200); expect(b.total).toBeCloseTo(200 + 20 + 400); expect(b.unpriced).toBe(0);
  });
  it('counts unpriced lines and skips deleted records', () => {
    const d = dev('a', 'cam-dome'); const x = dev('b', 'cam-dome'); x.deleted = true;
    const b = buildBom([d, x], () => 20, DEFAULT_BOM); expect(b.lines[0]!.qty).toBe(1); expect(b.unpriced).toBe(1);
  });
});
