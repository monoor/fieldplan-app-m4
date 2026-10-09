// Read-only plan drawing for one sheet: underlay, surfaces, walls, openings, cables, devices (with camera cones), labels, dims.
// Wheel zooms around the cursor, drag pans. The full editor replaces this in a later milestone.
import { useMemo, useRef, useState } from 'react';
import { FOV_DEFAULTS, type ProjectRecord } from '@fieldplan/shared';

const CAT: Record<string, string> = { mech: '#ff9f43', electrical: '#e8a33d', smart: '#7ee08a', network: '#4fd1c5', camera: '#c496ff', access: '#ff7a90', av: '#ffd166', building: '#d7e0e8' };
type P = { x: number; y: number };
const pts = (ps: P[]) => ps.map(p => p.x + ',' + p.y).join(' ');

export function PlanView({ records, sheetId, fileUrl, scale }: { records: ProjectRecord[]; sheetId: string; fileUrl: (sha: string) => string; scale: number }) {
  const on = useMemo(() => records.filter(r => r.sheetId === sheetId && !r.deleted), [records, sheetId]);
  const of = <T,>(k: string) => on.filter(r => r.kind === k).map(r => ({ id: r.id, ...(r.data as T) }));
  const walls = of<{ points: P[]; thick?: number }>('wall'), surfaces = of<{ points: P[]; label?: string }>('surface');
  const devices = of<{ x: number; y: number; catKey: string; typeId: string; tag?: string; label?: string; rotation?: number; fov?: number; range?: number }>('device');
  const cables = of<{ points: P[]; category?: string; tag?: string }>('cable'), labels = of<{ x: number; y: number; text: string }>('label');
  const dims = of<{ points: P[] }>('dim'), bundles = of<{ points: P[] }>('bundle'), underlays = of<{ fileSha?: string; x: number; y: number; w: number; h: number; opacity?: number }>('underlay');
  const openings = of<{ wallId: string; segIndex: number; t: number; width: number; kind: string }>('opening');

  const bounds = useMemo(() => {
    const xs: number[] = [], ys: number[] = [];
    const add = (p: P) => { xs.push(p.x); ys.push(p.y); };
    walls.forEach(w => w.points.forEach(add)); surfaces.forEach(s => s.points.forEach(add)); cables.forEach(c => c.points.forEach(add)); devices.forEach(add); labels.forEach(add);
    underlays.forEach(u => { add(u); add({ x: u.x + u.w, y: u.y + u.h }); });
    if (!xs.length) return { x: -50, y: -50, w: 1000, h: 700 };
    const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys), pad = 60;
    return { x: x0 - pad, y: y0 - pad, w: Math.max(200, x1 - x0 + 2 * pad), h: Math.max(150, y1 - y0 + 2 * pad) };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const [vb, setVb] = useState<typeof bounds | null>(null);
  const view = vb ?? bounds;
  const svg = useRef<SVGSVGElement>(null), drag = useRef<{ x: number; y: number; vb: typeof bounds } | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }) => { const r = svg.current!.getBoundingClientRect(); return { x: view.x + (e.clientX - r.left) / r.width * view.w, y: view.y + (e.clientY - r.top) / r.height * view.h }; };
  const onWheel = (e: React.WheelEvent) => { const p = toWorld(e), f = e.deltaY < 0 ? 0.87 : 1.15; setVb({ x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f, w: view.w * f, h: view.h * f }); };
  const onDown = (e: React.PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vb: view }; };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const r = svg.current!.getBoundingClientRect(); setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.x) / r.width * d.vb.w, y: d.vb.y - (e.clientY - d.y) / r.height * d.vb.h }); };
  const wallById = new Map(walls.map(w => [w.id, w]));

  return (
    <div className="plan">
      <div className="plan-tools"><button className="btn sm" onClick={() => setVb(null)}>Fit</button></div>
      <svg ref={svg} viewBox={view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} preserveAspectRatio="xMidYMid meet">
        {underlays.map(u => u.fileSha && <image key={u.id} href={fileUrl(u.fileSha)} x={u.x} y={u.y} width={u.w} height={u.h} opacity={u.opacity ?? 0.5} preserveAspectRatio="none" />)}
        {surfaces.map(s => <polygon key={s.id} points={pts(s.points)} fill="#2f6b3b33" stroke="#3f9a4a66" strokeWidth={1} />)}
        {walls.map(w => <polyline key={w.id} points={pts(w.points)} fill="none" stroke="#d7e0e8" strokeWidth={Math.max(2, ((w.thick ?? 4.5) / 12) * scale)} strokeLinejoin="round" strokeLinecap="square" />)}
        {openings.map(o => { const w = wallById.get(o.wallId), a = w?.points[o.segIndex], b = w?.points[o.segIndex + 1]; if (!a || !b) return null;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, cx = a.x + (b.x - a.x) * o.t, cy = a.y + (b.y - a.y) * o.t, half = (o.width * scale) / 2;
          return <line key={o.id} x1={cx - ux * half} y1={cy - uy * half} x2={cx + ux * half} y2={cy + uy * half} stroke={o.kind === 'door' ? '#0d1a26' : '#5fb8ff'} strokeWidth={o.kind === 'door' ? 8 : 3} />; })}
        {bundles.map(b => <polyline key={b.id} points={pts(b.points)} fill="none" stroke="#9aa7b4" strokeWidth={6} opacity={0.35} />)}
        {cables.map(c => <polyline key={c.id} points={pts(c.points)} fill="none" stroke={CAT[c.category ?? ''] ?? '#9aa7b4'} strokeWidth={2} opacity={0.9}><title>{c.tag}</title></polyline>)}
        {devices.map(d => { const def = FOV_DEFAULTS[d.typeId], fov = d.fov || def?.[0], range = d.range || def?.[1]; if (!fov || !range) return null;
          const half = (fov / 2) * Math.PI / 180, r = range * scale, rot = ((d.rotation ?? 0) - 90) * Math.PI / 180, fill = CAT[d.catKey] ?? CAT.camera;
          if (fov >= 360) return <circle key={'f' + d.id} cx={d.x} cy={d.y} r={r} fill={fill} opacity={0.12} />;
          const p1 = { x: d.x + r * Math.cos(rot - half), y: d.y + r * Math.sin(rot - half) }, p2 = { x: d.x + r * Math.cos(rot + half), y: d.y + r * Math.sin(rot + half) };
          return <path key={'f' + d.id} d={'M' + d.x + ' ' + d.y + ' L' + p1.x + ' ' + p1.y + ' A' + r + ' ' + r + ' 0 ' + (fov > 180 ? 1 : 0) + ' 1 ' + p2.x + ' ' + p2.y + ' Z'} fill={fill} opacity={0.12} stroke={fill} strokeOpacity={0.35} strokeWidth={1} />; })}
        {devices.map(d => <g key={d.id}><circle cx={d.x} cy={d.y} r={9} fill={CAT[d.catKey] ?? '#9aa7b4'} stroke="#0b131c" strokeWidth={1.5}><title>{(d.tag ?? '') + ' ' + (d.label || d.typeId)}</title></circle>
          {d.tag && <text x={d.x} y={d.y + 22} className="plan-tag">{d.tag}</text>}</g>)}
        {labels.map(l => <text key={l.id} x={l.x} y={l.y} className="plan-label">{l.text}</text>)}
        {dims.map(m => { const [a, b] = m.points; if (!a || !b) return null; return <g key={m.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5fb8ff" strokeWidth={1} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} className="plan-label dim">{(Math.hypot(b.x - a.x, b.y - a.y) / scale).toFixed(1)}'</text></g>; })}
      </svg>
    </div>
  );
}
