import { describe, expect, it } from 'vitest';
import { importLegacyProject, isLegacyProject, checkPut, PushRequest, can, newId, CatalogItemInput } from '../src/index.js';

const P = (a: [number, number], b: [number, number]) => [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }];
const sheet = (id: string, name: string) => ({
  id, name,
  walls: [{ id: 'w1', points: P([0, 0], [200, 0]), mat: 'stud' }, { id: 'wbad', points: [{ x: 0, y: 0 }] }],
  openings: [{ id: 'o1', kind: 'door', wallId: 'w1', segIndex: 0, t: 0.5, width: 3 }],
  devices: [
    { id: 'P1', catKey: 'electrical', typeId: 'panel', x: 10, y: 10, tag: 'P-01', panel: { kind: 'main', bkrs: [{ id: 'b1', slot: 1, amps: 20, poles: 1 }] } },
    { id: 'O1', catKey: 'electrical', typeId: 'outlet', x: 50, y: 10, tag: 'O-01', feed: { src: 'P1', bkr: 'b1' } },
  ],
  cables: [{ id: 'k1', cableType: 'nm122', category: 'electrical', tag: 'NM122-01', from: 'O1', to: 'P1', toPort: 'B:b1', points: P([50, 10], [10, 10]) }],
  surfaces: [], bundles: [], labels: [{ id: 'l1', x: 1, y: 2, text: 'Hi' }], dims: [],
  underlay: null as unknown,
});

describe('legacy import', () => {
  const s1 = sheet('s1', 'Floor 1');
  const s2 = { ...sheet('s2', 'Floor 1 copy'), underlay: { src: 'data:image/png;base64,iVBORw0KGgo=', x: 0, y: 0, w: 100, h: 50, opacity: 0.5, natW: 10, natH: 5 } };
  const v1 = { meta: { name: 'Shop', scale: 20, gridFt: 1, parts: { 'cab:nm122': { pn: 'X', price: 1 } } }, layers: { grid: true, fov: false }, sheets: [s1, s2], active: 0 };
  const out = importLegacyProject(v1);

  it('recognises v1 files', () => { expect(isLegacyProject(v1)).toBe(true); expect(isLegacyProject({ hello: 1 })).toBe(false); });
  it('keeps meta and layers', () => {
    const meta = out.records.find(r => r.kind === 'meta')!;
    expect(meta.data).toMatchObject({ name: 'Shop', scale: 20, layers: { grid: true, fov: false }, importedFrom: 'fieldplan-v1' });
    expect(out.name).toBe('Shop');
  });
  it('gives every record a unique id even when sheets were duplicated', () => {
    const ids = out.records.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.records.filter(r => r.kind === 'sheet')).toHaveLength(2);
  });
  it('remaps references within each sheet', () => {
    for (const sh of out.records.filter(r => r.kind === 'sheet')) {
      const on = out.records.filter(r => r.sheetId === sh.id);
      const dev = (tag: string) => on.find(r => r.kind === 'device' && r.data.tag === tag)!;
      const cable = on.find(r => r.kind === 'cable')!, door = on.find(r => r.kind === 'opening')!, wall = on.find(r => r.kind === 'wall')!;
      expect(cable.data.from).toBe(dev('O-01').id);
      expect(cable.data.to).toBe(dev('P-01').id);
      expect(cable.data.toPort).toBe('B:b1'); // landing ids are device-internal and stay
      expect(door.data.wallId).toBe(wall.id);
      expect((dev('O-01').data.feed as { src: string }).src).toBe(dev('P-01').id);
    }
  });
  it('skips invalid entities with a warning', () => {
    expect(out.records.some(r => r.data.points && (r.data.points as unknown[]).length === 1)).toBe(false);
    expect(out.warnings.some(w => /Skipped wall/.test(w))).toBe(true);
  });
  it('hands underlay images to the caller', () => {
    expect(out.underlayImages.size).toBe(1);
    const [uid, src] = [...out.underlayImages][0]!;
    expect(src).toMatch(/^data:image\/png/);
    const rec = out.records.find(r => r.id === uid)!;
    expect(rec.kind).toBe('underlay'); expect(rec.data).not.toHaveProperty('src'); expect(rec.data.w).toBe(100);
  });
  it('reads the oldest top-level format', () => {
    const old = importLegacyProject({ meta: { name: 'Old' }, devices: [{ id: 'a', catKey: 'network', typeId: 'ap', x: 1, y: 1 }] });
    expect(old.records.filter(r => r.kind === 'sheet')).toHaveLength(1);
    expect(old.records.filter(r => r.kind === 'device')).toHaveLength(1);
  });
  it('rejects non-projects', () => { expect(() => importLegacyProject([])).toThrow(); });
});

describe('sync ops', () => {
  it('validates data per kind', () => {
    const ok = PushRequest.parse({ ops: [{ op: 'put', id: 'd1', kind: 'device', sheetId: 's1', data: { catKey: 'camera', typeId: 'cam-dome', x: 1, y: 2 } }] });
    expect(checkPut(ok.ops[0] as never)).toBeNull();
    const bad = PushRequest.parse({ ops: [{ op: 'put', id: 'd1', kind: 'device', sheetId: 's1', data: { catKey: 'camera', x: 'no' } }] });
    expect(checkPut(bad.ops[0] as never)).toMatch(/device d1/);
  });
  it('enforces sheet placement and size', () => {
    const noSheet = PushRequest.parse({ ops: [{ op: 'put', id: 'l1', kind: 'label', data: { x: 0, y: 0, text: 'a' } }] });
    expect(checkPut(noSheet.ops[0] as never)).toMatch(/needs a sheetId/);
    const huge = PushRequest.parse({ ops: [{ op: 'put', id: 'l1', kind: 'label', sheetId: 's', data: { x: 0, y: 0, text: 'a', blob: 'x'.repeat(300 * 1024) } }] });
    expect(checkPut(huge.ops[0] as never)).toMatch(/record limit/);
  });
  it('rejects unsafe ids', () => {
    expect(PushRequest.safeParse({ ops: [{ op: 'del', id: '../etc' }] }).success).toBe(false);
  });
});

describe('roles', () => {
  it('grants by role', () => {
    expect(can('viewer', 'project:read')).toBe(true);
    expect(can('viewer', 'project:write')).toBe(false);
    expect(can('designer', 'import:run')).toBe(true);
    expect(can('designer', 'user:manage')).toBe(false);
    expect(can('admin', 'audit:read')).toBe(true);
    expect(can('superuser', 'project:read')).toBe(false);
    expect(can(undefined, 'project:read')).toBe(false);
  });
});

describe('ids and catalog', () => {
  it('makes distinct url-safe ids', () => { const a = new Set(Array.from({ length: 1000 }, newId)); expect(a.size).toBe(1000); for (const x of a) expect(x).toMatch(/^[a-z0-9]{13}$/); });
  it('accepts several prices per item and rejects non-http sources', () => {
    const item = CatalogItemInput.parse({ vendor: 'UniFi', model: 'G6 Turret', category: 'camera', specs: { hfovDeg: 110, maxPowerW: 12.5 }, prices: [{ source: 'ADI', price: 199 }, { source: 'UI Store', price: 179 }] });
    expect(item.prices).toHaveLength(2); expect(item.prices[0]!.currency).toBe('USD');
    expect(CatalogItemInput.safeParse({ vendor: 'x', model: 'y', category: 'camera', sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
  });
});
