import type { Bounds } from './useViewport';
import type { SceneRec } from './Scene';
import type { Canvas } from './canvas';

/** Area the drawing occupies (a default work area when the sheet is empty). */
export function bounds(recs: readonly SceneRec[], scale: number, canvas?: Canvas | null): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  for (const r of recs) {
    const d = r.data;
    if (Array.isArray(d.points)) for (const p of d.points) add(p.x, p.y);
    else if (r.kind === 'underlay') { add(d.x, d.y); add(d.x + d.w, d.y + d.h); }
    else if (typeof d.x === 'number') add(d.x, d.y);
  }
  if (canvas) { // the defined canvas, grown to include anything drawn outside it
    const f = Number.isFinite(x0);
    return { x0: f ? Math.min(0, x0) : 0, y0: f ? Math.min(0, y0) : 0, x1: Math.max(canvas.w * scale, f ? x1 : 0), y1: Math.max(canvas.h * scale, f ? y1 : 0) };
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: scale * 40, y1: scale * 28 };
  const pad = scale * 3; return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}
