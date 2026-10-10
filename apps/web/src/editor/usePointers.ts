// Drag-to-pan and two-finger pinch for read-only views (the editor has its own handlers on top of the same helpers).
import { useRef } from 'react';
import type { useViewport } from './useViewport';

type VP = ReturnType<typeof useViewport>;

export function usePanZoomPointers(vp: VP) {
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const pinch = () => {
    const [a, b] = [...pts.current.values()]; if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    return { d, cx, cy };
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { if ((e.target as Element).closest('.plan-tools')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); last.current = pinch() ?? null; },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = pts.current.get(e.pointerId); if (!p) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (pts.current.size === 1) { vp.panBy(e.clientX - p.x, e.clientY - p.y); }
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 2) { const n = pinch(), l = last.current; if (n && l) { vp.panBy(n.cx - l.cx, n.cy - l.cy); vp.zoomAt(n.cx - r.left, n.cy - r.top, n.d / (l.d || 1)); } last.current = n ?? null; }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => { pts.current.delete(e.pointerId); last.current = pinch() ?? null; },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => { pts.current.delete(e.pointerId); last.current = null; },
  };
  return { handlers };
}
