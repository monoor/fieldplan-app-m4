// Field-of-view coverage that stops at walls. A camera's cone is cut by every wall in its way and wraps around corners
// (the standard "visibility polygon": cast rays at the cone edges and just either side of every wall corner, keep the
// nearest hit). Windows are see-through; doors and walls block. A device mounted inside a wall is not blocked by it.
import type { ProjectRecord } from './model.js';

/** The parts of a record the geometry needs (works for server records and the editor's local ones). */
export type SceneRecord = Pick<ProjectRecord, 'id' | 'kind' | 'data'> & { deleted?: boolean };

export interface Pt { x: number; y: number }
export interface Seg { a: Pt; b: Pt }
/** One solid piece of wall: its outline edges, and the quad used to tell whether a device sits inside it. */
export interface Obstacle { edges: Seg[]; quad: Pt[] }

const EPS = 1e-9;

/** Quad around segment a→b with the given total thickness (px). */
function quadOf(a: Pt, b: Pt, thick: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * (thick / 2), ny = (dx / len) * (thick / 2);
  return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
}
const edgesOf = (q: Pt[]): Seg[] => q.map((p, i) => ({ a: p, b: q[(i + 1) % q.length]! }));

function inQuad(p: Pt, q: Pt[]): boolean {
  let neg = false, pos = false;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!, b = q[(i + 1) % q.length]!, c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (c < 0) neg = true; else if (c > 0) pos = true;
    if (neg && pos) return false;
  }
  return true;
}

/**
 * Solid wall pieces for a sheet. `thick` on a wall is inches (v1 convention); `scale` is px per foot.
 * Window openings cut a see-through gap; door openings keep the wall solid.
 */
export function buildObstacles(records: readonly SceneRecord[], scale: number): Obstacle[] {
  const live = records.filter(r => !r.deleted);
  const windows = new Map<string, { seg: number; t: number; w: number }[]>();
  for (const r of live) {
    if (r.kind !== 'opening' || r.data.kind !== 'window') continue;
    const wallId = String(r.data.wallId), list = windows.get(wallId) ?? [];
    list.push({ seg: Number(r.data.segIndex), t: Number(r.data.t), w: Number(r.data.width) * scale }); windows.set(wallId, list);
  }
  const out: Obstacle[] = [];
  for (const r of live) {
    if (r.kind !== 'wall') continue;
    const pts = (r.data.points as Pt[] | undefined) ?? [], thick = ((Number(r.data.thick) || 4.5) / 12) * scale;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!, b = pts[i + 1]!, len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < EPS) continue;
      // Split this segment around any windows (as [t0,t1] fractions to keep solid).
      const gaps = (windows.get(r.id) ?? []).filter(w => w.seg === i).map(w => { const half = w.w / 2 / len; return [Math.max(0, w.t - half), Math.min(1, w.t + half)] as const; }).sort((p, q) => p[0] - q[0]);
      let t = 0; const solids: (readonly [number, number])[] = [];
      for (const [g0, g1] of gaps) { if (g0 > t) solids.push([t, g0]); t = Math.max(t, g1); }
      if (t < 1) solids.push([t, 1]);
      for (const [s0, s1] of solids) {
        if ((s1 - s0) * len < 0.5) continue;
        const pa = { x: a.x + (b.x - a.x) * s0, y: a.y + (b.y - a.y) * s0 }, pb = { x: a.x + (b.x - a.x) * s1, y: a.y + (b.y - a.y) * s1 };
        const quad = quadOf(pa, pb, thick); out.push({ edges: edgesOf(quad), quad });
      }
    }
  }
  return out;
}

/** Distance along the ray (origin o, unit direction d) to segment s, or Infinity. */
function hit(o: Pt, d: Pt, s: Seg): number {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y, den = d.x * ey - d.y * ex;
  if (Math.abs(den) < EPS) return Infinity;
  const ax = s.a.x - o.x, ay = s.a.y - o.y, t = (ax * ey - ay * ex) / den, u = (ax * d.y - ay * d.x) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

export interface ConeInput { x: number; y: number; rotationDeg: number; fovDeg: number; rangePx: number }

/**
 * Polygon of what the device can see. Rotation 0 faces up, clockwise (the v1 convention).
 * Returns points in order; the first is the device itself for cones under 360°.
 */
export function visibilityPolygon(c: ConeInput, obstacles: readonly Obstacle[]): Pt[] {
  const o = { x: c.x, y: c.y }, full = c.fovDeg >= 359.5;
  const rad = Math.PI / 180, mid = (c.rotationDeg - 90) * rad, half = (Math.min(c.fovDeg, 360) / 2) * rad;
  const a0 = full ? -Math.PI : mid - half, a1 = full ? Math.PI : mid + half;
  const edges: Seg[] = [];
  const R = c.rangePx;
  for (const ob of obstacles) {
    if (inQuad(o, ob.quad)) continue; // device mounted in this wall: the wall doesn't block its own view
    const xs = ob.quad.map(p => p.x), ys = ob.quad.map(p => p.y);
    if (Math.min(...xs) > o.x + R || Math.max(...xs) < o.x - R || Math.min(...ys) > o.y + R || Math.max(...ys) < o.y - R) continue;
    edges.push(...ob.edges);
  }

  const norm = (a: number) => { let x = a; while (x < a0) x += 2 * Math.PI; while (x >= a0 + 2 * Math.PI) x -= 2 * Math.PI; return x; };
  const angles = [a0, a1];
  for (const e of edges) for (const p of [e.a, e.b]) {
    const dist = Math.hypot(p.x - o.x, p.y - o.y); if (dist > c.rangePx + 1 || dist < EPS) continue;
    const ang = norm(Math.atan2(p.y - o.y, p.x - o.x));
    for (const d of [-1e-4, 0, 1e-4]) { const v = ang + d; if (v > a0 && v < a1) angles.push(v); }
  }
  // Extra rays so the curved far edge stays round.
  const arcSteps = Math.max(2, Math.ceil(((a1 - a0) / rad) / 4));
  for (let i = 1; i < arcSteps; i++) angles.push(a0 + ((a1 - a0) * i) / arcSteps);
  angles.sort((p, q) => p - q);

  const pts: Pt[] = full ? [] : [o];
  let last = -Infinity;
  for (const ang of angles) {
    if (ang - last < 1e-9) continue; last = ang;
    const d = { x: Math.cos(ang), y: Math.sin(ang) };
    let best = c.rangePx; for (const e of edges) { const t = hit(o, d, e); if (t < best) best = t; }
    pts.push({ x: o.x + d.x * best, y: o.y + d.y * best });
  }
  return pts;
}

/** SVG path data for a polygon. */
export const polyPath = (pts: readonly Pt[]): string => (pts.length ? 'M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L') + 'Z' : '');
