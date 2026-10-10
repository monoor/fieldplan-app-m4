// Pan/zoom for a plan canvas. The view is {x, y, k}: screen = world * k + (x, y), so the point under the cursor stays
// put exactly (no viewBox aspect-ratio drift). Zoom is limited and the drawing can't be panned out of reach, and the wheel
// is captured with a non-passive listener so the page never scrolls while zooming over the plan.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { P } from './geometry';

export interface View { x: number; y: number; k: number }
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export function useViewport(el: React.RefObject<HTMLElement | null>, content: Bounds) {
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view), sizeRef = useRef(size), contentRef = useRef(content);
  viewRef.current = view; sizeRef.current = size; contentRef.current = content;
  const fitted = useRef(false);

  const fitView = useCallback((): View => {
    const { w, h } = sizeRef.current, c = contentRef.current, bw = Math.max(50, c.x1 - c.x0), bh = Math.max(50, c.y1 - c.y0);
    const k = Math.min(w / bw, h / bh) * 0.9;
    return { k, x: w / 2 - ((c.x0 + c.x1) / 2) * k, y: h / 2 - ((c.y0 + c.y1) / 2) * k };
  }, []);

  const clamp = useCallback((v: View): View => {
    const { w, h } = sizeRef.current, c = contentRef.current, fit = fitView();
    const k = Math.max(fit.k * 0.35, Math.min(12, v.k));
    // Keep the middle of the screen inside the drawing area plus a working margin.
    const mx = Math.max(300, (c.x1 - c.x0) * 0.5), my = Math.max(300, (c.y1 - c.y0) * 0.5);
    const cx = Math.max(c.x0 - mx, Math.min(c.x1 + mx, (w / 2 - v.x) / k)), cy = Math.max(c.y0 - my, Math.min(c.y1 + my, (h / 2 - v.y) / k));
    return { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
  }, [fitView]);

  const setView = useCallback((v: View | ((p: View) => View)) => setViewState(p => clamp(typeof v === 'function' ? v(p) : v)), [clamp]);
  const fit = useCallback(() => setViewState(clamp(fitView())), [clamp, fitView]);
  const zoomAt = useCallback((sx: number, sy: number, f: number) => setView(p => { const k = p.k * f, wx = (sx - p.x) / p.k, wy = (sy - p.y) / p.k; return { k, x: sx - wx * k, y: sy - wy * k }; }), [setView]);
  const panBy = useCallback((dx: number, dy: number) => setView(p => ({ ...p, x: p.x + dx, y: p.y + dy })), [setView]);

  // Track the element size; fit once when it first has one.
  useLayoutEffect(() => {
    const node = el.current; if (!node) return;
    const measure = () => { const r = node.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { sizeRef.current = { w: r.width, h: r.height }; setSize({ w: r.width, h: r.height }); if (!fitted.current) { fitted.current = true; setViewState(clamp(fitView())); } else setViewState(p => clamp(p)); } };
    measure(); const ro = new ResizeObserver(measure); ro.observe(node); return () => ro.disconnect();
  }, [el, clamp, fitView]);

  // Wheel / trackpad pinch: native, non-passive, so preventDefault really stops page scrolling.
  useEffect(() => {
    const node = el.current; if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const r = node.getBoundingClientRect(), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [el, zoomAt]);

  const toWorld = useCallback((clientX: number, clientY: number): P => {
    const r = el.current!.getBoundingClientRect(), v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  }, [el]);

  return { view, size, setView, fit, zoomAt, panBy, toWorld, viewRef };
}
