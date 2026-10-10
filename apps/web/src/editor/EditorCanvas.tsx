// The interactive plan: drawing tools, selection, dragging, snapping and the pan/zoom viewport.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { Scene, formatFt, coverageOf, type SceneRec } from './Scene';
import { ConeControls } from './ConeControls';
import type { ConeOptions } from './coneStyle';
import { useViewport } from './useViewport';
import { bounds } from './bounds';
import { dist, nearOnLine, ortho, snapTo, type P } from './geometry';
import { cableInfo, newDeviceData, newRecId, TOOLS, wallMount, type Tool } from './tools';
import { useStoreVersion, type EditorStore, type Rec } from './store';

export interface Placement { typeId: string; over?: Record<string, unknown> }
interface Props {
  store: EditorStore; sheetId: string; scale: number; gridFt: number; tool: Tool; setTool: (t: Tool) => void; placement: Placement;
  cableType: string; matId: string; sel: ReadonlySet<string>; setSel: (s: ReadonlySet<string>) => void; cones: ConeOptions; setCones: (p: Partial<ConeOptions>) => void; snapOn: boolean;
}
type Draft = { tool: Tool; points: P[] };
type Gesture =
  | { mode: 'pan'; x: number; y: number; moved: boolean; click: boolean }
  | { mode: 'move'; id: string; start: P; orig: Rec; moved: boolean }
  | { mode: 'handle'; id: string; index: number; moved: boolean }
  | { mode: 'underlay'; id: string; start: P; orig: Rec; moved: boolean };

const POINT_KINDS = new Set(['wall', 'surface', 'cable', 'bundle', 'dim']);
const DRAW_TOOLS = new Set<Tool>(['wall', 'surface', 'cable', 'bundle', 'dim']);
const MIN_POINTS: Partial<Record<Tool, number>> = { wall: 2, surface: 3, cable: 2, bundle: 2, dim: 2 };

export function EditorCanvas(props: Props) {
  const { store, sheetId, scale, gridFt, tool, setTool, placement, cableType, matId, sel, setSel, cones, setCones, snapOn } = props;
  const version = useStoreVersion(store);
  const box = useRef<HTMLDivElement>(null);
  const recs = useMemo(() => store.ofSheet(sheetId) as SceneRec[], [store, version, sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  const vp = useViewport(box, useMemo(() => bounds(recs, scale), [recs, scale]));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState<P | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchLast = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const space = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  /** Double click / double tap (pointer events don't carry a click count). */
  const isDouble = (e: { clientX: number; clientY: number }) => {
    const n = performance.now(), l = lastTap.current, dbl = n - l.t < 450 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 10;
    lastTap.current = dbl ? { t: 0, x: 0, y: 0 } : { t: n, x: e.clientX, y: e.clientY }; return dbl;
  };
  const k = vp.view.k, step = gridFt * scale;

  // Reset the in-progress drawing when the tool or sheet changes.
  useEffect(() => { setDraft(null); }, [tool, sheetId]);

  /** Snap a world point: to existing corners first, then the grid; Shift keeps lines straight, Alt turns snapping off. */
  const snap = useCallback((w: P, o: { shift?: boolean; alt?: boolean; from?: P | null } = {}): P => {
    let p = w;
    if (o.shift && o.from) p = ortho(o.from, p);
    if (!o.alt) {
      let best: P | null = null, bd = 10 / k;
      for (const r of store.ofSheet(sheetId)) { const ps: P[] = r.data.points ?? (r.kind === 'device' ? [{ x: r.data.x, y: r.data.y }] : []); for (const q of ps) { const d = dist(q, w); if (d < bd) { bd = d; best = q; } } }
      if (best) return best;
      if (snapOn) p = { x: snapTo(p.x, step), y: snapTo(p.y, step) };
    }
    return p;
  }, [store, sheetId, k, snapOn, step]);

  const finish = useCallback((d: Draft | null = draft) => {
    if (!d) return; setDraft(null);
    const need = MIN_POINTS[d.tool] ?? 2; let points = d.points.filter((p, i, a) => i === 0 || dist(p, a[i - 1]!) > 0.5);
    if (points.length < need) return;
    if (d.tool === 'dim') points = points.slice(0, 2);
    const id = newRecId('wall');
    store.edit(tx => {
      if (d.tool === 'wall') tx.put({ id, kind: 'wall', sheetId, data: { points, thick: 4.5, mat: 'default' } });
      else if (d.tool === 'surface') tx.put({ id, kind: 'surface', sheetId, data: { points, matId } });
      else if (d.tool === 'bundle') tx.put({ id, kind: 'bundle', sheetId, data: { points } });
      else if (d.tool === 'dim') tx.put({ id, kind: 'dim', sheetId, data: { points } });
      else if (d.tool === 'cable') {
        const at = (p: P) => store.ofSheet(sheetId).find(r => r.kind === 'device' && dist({ x: r.data.x, y: r.data.y }, p) < 16)?.id ?? null;
        const ct = cableInfo(cableType), from = at(points[0]!), to = at(points[points.length - 1]!);
        let tagN = 1; for (const r of store.all()) if (r.kind === 'cable') tagN = Math.max(tagN, (Number(/(\d+)$/.exec(r.data.tag ?? '')?.[1]) || 0) + 1);
        tx.put({ id, kind: 'cable', sheetId, data: { points, cableType: ct.id, category: ct.category, tag: ct.category.slice(0, 1).toUpperCase() + '-' + tagN, label: '', from, to } });
      }
    });
    setSel(new Set([id]));
  }, [draft, store, sheetId, matId, cableType, setSel]);

  const deleteSelection = useCallback(() => { if (!sel.size) return; store.edit(tx => { for (const id of sel) tx.del(id); }); setSel(new Set()); }, [sel, store, setSel]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t.closest('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === ' ') { space.current = e.type === 'keydown'; if (e.type === 'keydown') e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (mod) return;
      if (e.key === 'Escape') { if (draft) setDraft(null); else if (sel.size) setSel(new Set()); else setTool('select'); return; }
      if (e.key === 'Enter') { finish(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (draft) setDraft({ ...draft, points: draft.points.slice(0, -1) }); else deleteSelection(); return; }
      const tl = TOOLS.find(x => x.key === e.key.toUpperCase()); if (tl) setTool(tl.id);
    };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, [store, draft, sel, finish, deleteSelection, setSel, setTool]);

  // ---- clicks with a drawing tool ----
  const click = (w: P, e: React.PointerEvent) => {
    const dbl = isDouble(e);
    if (DRAW_TOOLS.has(tool)) {
      const from = draft?.points[draft.points.length - 1] ?? null;
      if (draft && dbl) { finish(); return; } // the first click of a double-click already added this point
      let p = snap(w, { shift: e.shiftKey, alt: e.altKey, from });
      if (tool === 'cable') { const dev = recs.find(r => r.kind === 'device' && dist({ x: r.data.x, y: r.data.y }, p) < 16); if (dev) p = { x: dev.data.x, y: dev.data.y }; }
      const next = { tool, points: [...(draft?.points ?? []), p] };
      if (tool === 'dim' && next.points.length === 2) finish(next); else setDraft(next);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      let best: { d: number; wall: SceneRec; seg: number; t: number } | null = null;
      for (const r of recs) { if (r.kind !== 'wall') continue; const n = nearOnLine(w, r.data.points); if (!n) continue; const lim = ((r.data.thick ?? 4.5) / 12) * scale / 2 + 10 / k; if (n.d <= lim && (!best || n.d < best.d)) best = { d: n.d, wall: r, seg: n.seg, t: n.t }; }
      if (!best) return; const id = newRecId('opening'), b = best;
      store.edit(tx => tx.put({ id, kind: 'opening', sheetId, data: { kind: tool, wallId: b.wall.id, segIndex: b.seg, t: Math.max(0.02, Math.min(0.98, b.t)), width: tool === 'door' ? 3 : 4 } }));
      setSel(new Set([id])); return;
    }
    if (tool === 'device') {
      const raw = snap(w, { alt: e.altKey }), cov = coverageOf({ typeId: placement.typeId, ...(placement.over ?? {}) });
      const mount = cov ? wallMount(recs as Rec[], w, scale, 14 / k + 6) : null, at = mount ?? raw, id = newRecId('device');
      store.edit(tx => tx.put({ id, kind: 'device', sheetId, data: newDeviceData(store, placement.typeId, at, { ...(mount ? { rotation: mount.rotation } : {}), ...(placement.over ?? {}) }) }));
      setSel(new Set([id])); return;
    }
    if (tool === 'label') {
      const p = snap(w, { alt: e.altKey }), id = newRecId('label');
      store.edit(tx => tx.put({ id, kind: 'label', sheetId, data: { x: p.x, y: p.y, text: 'Label' } }));
      setSel(new Set([id])); setTool('select');
    }
  };

  // ---- pointer handling ----
  const selOne = sel.size === 1 ? store.get([...sel][0]!) : undefined;
  const handlesFor = selOne && POINT_KINDS.has(selOne.kind) ? (selOne.data.points as P[]) : null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.plan-tools,.draft-bar,.zoomctl')) return;
    box.current!.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) { gesture.current = null; pinchLast.current = pinch(); return; }
    const w = vp.toWorld(e.clientX, e.clientY), t = e.target as Element;
    if (e.button === 1 || space.current) { gesture.current = { mode: 'pan', x: e.clientX, y: e.clientY, moved: true, click: false }; return; }
    const hm = t.closest('[data-handle]') as HTMLElement | null, mid = t.closest('[data-mid]') as HTMLElement | null;
    if (selOne && handlesFor && (hm || mid)) {
      if (hm) {
        const i = Number(hm.dataset.handle), min = selOne.kind === 'surface' ? 3 : 2;
        if (isDouble(e) && handlesFor.length > min) { store.edit(tx => tx.patch(selOne.id, { points: handlesFor.filter((_, j) => j !== i) })); return; }
        gesture.current = { mode: 'handle', id: selOne.id, index: i, moved: false };
      } else {
        const i = Number(mid!.dataset.mid), a = handlesFor[i]!, b = handlesFor[(i + 1) % handlesFor.length]!, np = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        store.edit(tx => tx.patch(selOne.id, { points: [...handlesFor.slice(0, i + 1), np, ...handlesFor.slice(i + 1)] }), 'vtx');
        gesture.current = { mode: 'handle', id: selOne.id, index: i + 1, moved: true };
      }
      return;
    }
    if (tool === 'select') {
      const el = t.closest('[data-id]') as SVGElement | null;
      if (el) {
        const id = el.dataset.id!; const next = e.shiftKey ? new Set(sel) : new Set<string>(); if (e.shiftKey && sel.has(id)) next.delete(id); else next.add(id);
        setSel(sel.has(id) && !e.shiftKey ? sel : next);
        const orig = store.get(id); if (orig && orig.kind !== 'underlay') gesture.current = { mode: 'move', id, start: w, orig: structuredClone(orig), moved: false };
        return;
      }
      const ul = selOne?.kind === 'underlay' && !selOne.data.locked && w.x >= selOne.data.x && w.x <= selOne.data.x + selOne.data.w && w.y >= selOne.data.y && w.y <= selOne.data.y + selOne.data.h ? selOne : null;
      if (ul) { gesture.current = { mode: 'underlay', id: ul.id, start: w, orig: structuredClone(ul), moved: false }; return; }
    }
    gesture.current = { mode: 'pan', x: e.clientX, y: e.clientY, moved: false, click: true };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) { const n = pinch(), l = pinchLast.current; if (n && l) { const r = box.current!.getBoundingClientRect(); vp.panBy(n.cx - l.cx, n.cy - l.cy); vp.zoomAt(n.cx - r.left, n.cy - r.top, n.d / (l.d || 1)); } pinchLast.current = n; return; }
    const w = vp.toWorld(e.clientX, e.clientY);
    const from = draft?.points[draft.points.length - 1] ?? null;
    if (!gesture.current) {
      setCursor(DRAW_TOOLS.has(tool) ? snap(w, { shift: e.shiftKey, alt: e.altKey, from }) : w);
      const el = (e.target as Element).closest('[data-kind="device"]') as SVGElement | null; setHot(el?.dataset.id ?? null);
      return;
    }
    const g = gesture.current;
    if (g.mode === 'pan') {
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) return;
      g.moved = true; vp.panBy(e.clientX - g.x, e.clientY - g.y); g.x = e.clientX; g.y = e.clientY;
    } else if (g.mode === 'move') {
      if (!g.moved && Math.hypot(w.x - g.start.x, w.y - g.start.y) * k < 4) return;
      g.moved = true; moveEntity(store, g.orig, g.start, w, e.altKey ? 0 : snapOn ? step : 0, scale);
    } else if (g.mode === 'handle') {
      g.moved = true; const rec = store.get(g.id); if (!rec) return;
      const pts = [...(rec.data.points as P[])], prevPt = pts[g.index - 1] ?? pts[g.index + 1] ?? null; pts[g.index] = snap(w, { shift: e.shiftKey, alt: e.altKey, from: prevPt });
      store.edit(tx => tx.patch(g.id, { points: pts }), 'vtx:' + g.id);
    } else if (g.mode === 'underlay') {
      g.moved = true; store.edit(tx => tx.patch(g.id, { x: g.orig.data.x + (w.x - g.start.x), y: g.orig.data.y + (w.y - g.start.y) }), 'ul:' + g.id);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId); pinchLast.current = pinch();
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.mode === 'pan' && !g.moved && g.click) {
      if (tool === 'select') { if (!e.shiftKey) setSel(new Set()); } else click(vp.toWorld(e.clientX, e.clientY), e);
    }
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); gesture.current = null; pinchLast.current = null; };
  function pinch() {
    const [a, b] = [...pointers.current.values()]; if (!a || !b) return null;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  // ---- overlay drawing ----
  const rubber = draft && cursor ? [...draft.points, cursor] : draft?.points ?? [];
  const ptsAttr = (ps: P[]) => ps.map(p => p.x + ',' + p.y).join(' ');
  const last = draft?.points[draft.points.length - 1];
  const ghost = cursor && (tool === 'device' || tool === 'door' || tool === 'window' || tool === 'label') ? cursor : null;
  const tooltip = TOOLS.find(t => t.id === tool)?.hint ?? '';
  const cls = 'plan editor-canvas tool-' + tool + (hot && tool === 'select' ? ' hot' : '');

  const gridPx = step * k, major = gridPx * 5;
  return (
    <div className={cls} ref={box} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onPointerLeave={() => { setCursor(null); setHot(null); }} onContextMenu={e => e.preventDefault()} tabIndex={0}>
      <svg width={vp.size.w} height={vp.size.h}>
        {gridPx >= 7 && <>
          <defs>
            <pattern id="g-minor" width={gridPx} height={gridPx} patternUnits="userSpaceOnUse" x={vp.view.x} y={vp.view.y}><path d={`M${gridPx} 0H0V${gridPx}`} fill="none" stroke="#14263a" strokeWidth={1} /></pattern>
            <pattern id="g-major" width={major} height={major} patternUnits="userSpaceOnUse" x={vp.view.x} y={vp.view.y}><path d={`M${major} 0H0V${major}`} fill="none" stroke="#1d3550" strokeWidth={1} /></pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#g-minor)" /><rect width="100%" height="100%" fill="url(#g-major)" />
        </>}
        <g transform={`translate(${vp.view.x} ${vp.view.y}) scale(${k})`}>
          <Scene recs={recs} scale={scale} fileUrl={fileUrl} cones={cones} selected={sel} hot={hot} />
          {handlesFor && selOne && <g className="handles">
            {selOne.kind !== 'dim' && handlesFor.map((p, i) => { const q = handlesFor[(i + 1) % handlesFor.length]!; if (i + 1 >= handlesFor.length && selOne.kind !== 'surface') return null; return <circle key={'m' + i} data-mid={i} cx={(p.x + q.x) / 2} cy={(p.y + q.y) / 2} r={4 / k} className="vtx mid" />; })}
            {handlesFor.map((p, i) => <circle key={i} data-handle={i} cx={p.x} cy={p.y} r={6 / k} className="vtx" />)}
          </g>}
          {draft && <g pointerEvents="none">
            <polyline points={ptsAttr(rubber)} fill={draft.tool === 'surface' ? '#3f9a4a33' : 'none'} stroke={draft.tool === 'wall' ? '#d7e0e8' : '#5fb8ff'} strokeWidth={draft.tool === 'wall' ? Math.max(2, (4.5 / 12) * scale) : 2} strokeDasharray={draft.tool === 'wall' ? undefined : '6 4'} opacity={0.75} vectorEffect={draft.tool === 'wall' ? undefined : 'non-scaling-stroke'} />
            {draft.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 / k} fill="#5fb8ff" />)}
            {last && cursor && <text x={(last.x + cursor.x) / 2} y={(last.y + cursor.y) / 2 - 8 / k} className="plan-label dim" style={{ fontSize: 12 / k }}>{formatFt(dist(last, cursor) / scale)}</text>}
          </g>}
          {ghost && <g pointerEvents="none" opacity={0.7}>{tool === 'device' ? <circle cx={ghost.x} cy={ghost.y} r={9} fill="#5fb8ff" /> : <circle cx={ghost.x} cy={ghost.y} r={5 / k} fill="none" stroke="#ffd166" strokeWidth={1.5 / k} />}</g>}
          {cursor && DRAW_TOOLS.has(tool) && <circle cx={cursor.x} cy={cursor.y} r={5 / k} fill="none" stroke="#ffd166" strokeWidth={1.5 / k} pointerEvents="none" />}
        </g>
      </svg>

      <div className="plan-tools" onPointerDown={e => e.stopPropagation()}>
        <ConeControls opts={cones} set={setCones} />
        <button className="btn sm" onClick={() => vp.zoomAt(vp.size.w / 2, vp.size.h / 2, 1.4)} aria-label="Zoom in">+</button>
        <button className="btn sm" onClick={() => vp.zoomAt(vp.size.w / 2, vp.size.h / 2, 1 / 1.4)} aria-label="Zoom out">−</button>
        <button className="btn sm" onClick={vp.fit}>Fit</button>
      </div>
      <div className="canvas-status mono small">
        <span>{tooltip}</span>
        {cursor && <span>{(cursor.x / scale).toFixed(1)}′, {(cursor.y / scale).toFixed(1)}′</span>}
        <span>{Math.round((k / (scale / 20)) * 100)}%</span>
      </div>
      {draft && (
        <div className="draft-bar" onPointerDown={e => e.stopPropagation()}>
          <button className="btn sm primary" onClick={() => finish()} disabled={draft.points.length < (MIN_POINTS[draft.tool] ?? 2)}>Finish ⏎</button>
          <button className="btn sm" onClick={() => setDraft(draft.points.length > 1 ? { ...draft, points: draft.points.slice(0, -1) } : null)}>Undo point</button>
          <button className="btn sm" onClick={() => setDraft(null)}>Cancel ⎋</button>
        </div>
      )}
    </div>
  );
}

/** Drag an entity: translate points/positions from the state at drag start. Devices snap to the grid; attached cables follow. */
function moveEntity(store: EditorStore, orig: Rec, start: P, now: P, grid: number, scale: number) {
  const dx0 = now.x - start.x, dy0 = now.y - start.y, key = 'mv:' + orig.id;
  const d = orig.data;
  if (orig.kind === 'opening') {
    const w = store.get(d.wallId); const n = w && nearOnLine(now, w.data.points); if (!n) return;
    store.edit(tx => tx.patch(orig.id, { segIndex: n.seg, t: Math.max(0.02, Math.min(0.98, n.t)) }), key); return;
  }
  if (orig.kind === 'device' || orig.kind === 'label') {
    const x = grid ? snapTo(d.x + dx0, grid) : d.x + dx0, y = grid ? snapTo(d.y + dy0, grid) : d.y + dy0;
    store.edit(tx => {
      tx.patch(orig.id, { x, y });
      if (orig.kind === 'device') for (const c of store.all()) if (c.kind === 'cable') {
        const pts = [...(c.data.points as P[])]; let ch = false;
        if (c.data.from === orig.id) { pts[0] = { x, y }; ch = true; } if (c.data.to === orig.id) { pts[pts.length - 1] = { x, y }; ch = true; }
        if (ch) tx.patch(c.id, { points: pts });
      }
    }, key); return;
  }
  if (Array.isArray(d.points)) {
    const dx = grid ? snapTo(dx0, grid) : dx0, dy = grid ? snapTo(dy0, grid) : dy0;
    store.edit(tx => tx.patch(orig.id, { points: (d.points as P[]).map(p => ({ x: p.x + dx, y: p.y + dy })) }), key);
  }
  void scale;
}
