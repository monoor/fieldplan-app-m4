import { describe, expect, it } from 'vitest';
import { buildObstacles, visibilityPolygon, type Pt, type ProjectRecord } from '../src/index.js';

const rec = (id: string, kind: ProjectRecord['kind'], data: Record<string, unknown>): ProjectRecord => ({ id, kind, sheetId: 's', data, seq: 1, deleted: false, updatedAt: '', updatedBy: null });
const wall = (id: string, pts: Pt[], thick = 6) => rec(id, 'wall', { points: pts, thick });
const reach = (poly: Pt[], o: Pt) => Math.max(...poly.map(p => Math.hypot(p.x - o.x, p.y - o.y)));
const cone = (x: number, y: number, rot: number, fov: number, r: number) => ({ x, y, rotationDeg: rot, fovDeg: fov, rangePx: r });

describe('visibility polygon', () => {
  it('open space gives the full wedge', () => {
    const p = visibilityPolygon(cone(0, 0, 90, 90, 100), []);
    expect(reach(p, { x: 0, y: 0 })).toBeCloseTo(100, 3);
    expect(p.every(q => q.x >= -1e-6)).toBe(true); // facing right (+x)
  });
  it('stops at a wall in front', () => {
    const ob = buildObstacles([wall('w', [{ x: 50, y: -200 }, { x: 50, y: 200 }])], 20);
    const p = visibilityPolygon(cone(0, 0, 90, 60, 150), ob);
    expect(Math.max(...p.map(q => q.x))).toBeLessThan(50); // nothing beyond the wall's near face
    expect(Math.max(...p.map(q => q.x))).toBeGreaterThan(44.9);
  });
  it('wraps around a wall end instead of passing through', () => {
    const ob = buildObstacles([wall('w', [{ x: 50, y: -100 }, { x: 50, y: 0 }])], 20);
    const p = visibilityPolygon(cone(0, 0, 90, 80, 200), ob);
    const beyond = p.filter(q => q.x > 60); // light past the wall exists only below its end (y > 0)
    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond.every(q => q.y > -1)).toBe(true);
  });
  it('windows let the cone through, doors do not', () => {
    const w = wall('w', [{ x: 50, y: -100 }, { x: 50, y: 100 }]);
    const win = rec('o', 'opening', { kind: 'window', wallId: 'w', segIndex: 0, t: 0.5, width: 4 });
    const door = rec('o', 'opening', { kind: 'door', wallId: 'w', segIndex: 0, t: 0.5, width: 4 });
    const thru = visibilityPolygon(cone(0, 0, 90, 20, 200), buildObstacles([w, win], 20));
    const shut = visibilityPolygon(cone(0, 0, 90, 20, 200), buildObstacles([w, door], 20));
    expect(Math.max(...thru.map(q => q.x))).toBeGreaterThan(150);
    expect(Math.max(...shut.map(q => q.x))).toBeLessThan(50);
  });
  it('a device mounted inside its own wall still sees out', () => {
    const ob = buildObstacles([wall('w', [{ x: -100, y: 0 }, { x: 100, y: 0 }], 12)], 20);
    const p = visibilityPolygon(cone(0, 0, 0, 90, 120), ob); // inside the wall, facing up
    expect(reach(p, { x: 0, y: 0 })).toBeGreaterThan(100);
  });
  it('360° fisheye is closed and wall-clipped on one side', () => {
    const ob = buildObstacles([wall('w', [{ x: 40, y: -300 }, { x: 40, y: 300 }])], 20);
    const p = visibilityPolygon(cone(0, 0, 0, 360, 100), ob);
    expect(Math.max(...p.map(q => q.x))).toBeLessThan(40);
    expect(Math.min(...p.map(q => q.x))).toBeLessThan(-95);
  });
  it('ignores deleted walls', () => {
    const w = { ...wall('w', [{ x: 50, y: -200 }, { x: 50, y: 200 }]), deleted: true };
    expect(buildObstacles([w], 20)).toHaveLength(0);
  });
});
