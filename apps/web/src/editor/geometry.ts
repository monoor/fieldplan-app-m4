export interface P { x: number; y: number }
export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
export const snapTo = (v: number, step: number) => Math.round(v / step) * step;

/** Closest point on segment a→b to p: distance, position t (0..1) and the point. */
export function nearOnSeg(p: P, a: P, b: P): { d: number; t: number; pt: P } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const pt = { x: a.x + dx * t, y: a.y + dy * t };
  return { d: dist(p, pt), t, pt };
}
/** Closest point on a polyline: also which segment it is on. */
export function nearOnLine(p: P, pts: readonly P[]): { d: number; seg: number; t: number; pt: P } | null {
  let best: { d: number; seg: number; t: number; pt: P } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) { const r = nearOnSeg(p, pts[i]!, pts[i + 1]!); if (!best || r.d < best.d) best = { ...r, seg: i }; }
  return best;
}
export function inPoly(p: P, pts: readonly P[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
export const bbox = (pts: readonly P[]) => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
/** Keep a segment horizontal/vertical/45° from `from` (hold Shift while drawing). */
export function ortho(from: P, to: P): P {
  const dx = to.x - from.x, dy = to.y - from.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}
