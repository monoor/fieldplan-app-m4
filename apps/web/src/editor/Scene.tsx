// Draws one sheet: underlay, surfaces, wall-clipped coverage cones, walls, openings, cables, devices, labels, dims.
// Every selectable element carries data-id / data-kind so the editor can hit-test through the DOM.
import { memo, useMemo } from 'react';
import { FOV_DEFAULTS, buildObstacles, deviceType, polyPath, visibilityPolygon, type Pt, type RecordKind } from '@fieldplan/shared';
import { CATEGORY_COLORS, coneColor, type ConeOptions } from './coneStyle';

export interface SceneRec { id: string; kind: RecordKind; data: Record<string, any>; rev?: number } // eslint-disable-line @typescript-eslint/no-explicit-any
const pts = (ps: Pt[]) => ps.map(p => p.x + ',' + p.y).join(' ');

export interface ConeInfo { id: string; color: string; fov: number; range: number }

/** Resolved coverage settings for a device, or null if it has none. */
export function coverageOf(d: SceneRec['data']): { fov: number; range: number } | null {
  const def = FOV_DEFAULTS[d.typeId] ?? (() => { const t = deviceType(d.typeId); return t?.fov && t.range ? [t.fov, t.range] as const : undefined; })();
  const fov = Number(d.fov) || def?.[0], range = Number(d.range) || def?.[1];
  return fov && range ? { fov, range } : null;
}

function SceneImpl({ recs, scale, fileUrl, cones, selected, hot }: { recs: SceneRec[]; scale: number; fileUrl: (sha: string) => string; cones: ConeOptions; selected?: ReadonlySet<string>; hot?: string | null }) {
  const by = (k: string) => recs.filter(r => r.kind === k);
  const walls = by('wall'), openings = by('opening'), devices = by('device'), cables = by('cable');
  const wallById = new Map(walls.map(w => [w.id, w]));
  const obstacleKey = [...walls, ...openings].map(r => r.id + '@' + (r.rev ?? 0)).join('|') + '#' + scale;
  const obstacles = useMemo(() => buildObstacles([...walls, ...openings], scale), [obstacleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const camIndex = new Map(devices.filter(d => coverageOf(d.data)).sort((a, b) => String(a.data.tag ?? a.id).localeCompare(String(b.data.tag ?? b.id), undefined, { numeric: true })).map((d, i) => [d.id, i]));
  const soloId = cones.solo ? [...(selected ?? [])].find(id => camIndex.has(id)) ?? null : null;
  const coneList = cones.show ? devices.flatMap(d => {
    const cov = coverageOf(d.data); if (!cov) return [];
    if (cones.solo && soloId && d.id !== soloId) return [];
    const x = Number(d.data.x), y = Number(d.data.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ d, cov, color: coneColor(cones, { typeId: d.data.typeId, catKey: d.data.catKey, color: d.data.color, fov: cov.fov }, camIndex.get(d.id) ?? 0), x, y }];
  }) : [];

  return (
    <g>
      {by('underlay').map(u => u.data.fileSha && <image key={u.id} data-id={u.id} data-kind="underlay" href={fileUrl(u.data.fileSha)} x={u.data.x} y={u.data.y} width={u.data.w} height={u.data.h} opacity={u.data.opacity ?? 0.5} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />)}
      {by('surface').map(s => <polygon key={s.id} data-id={s.id} data-kind="surface" points={pts(s.data.points)} fill="#2f6b3b33" stroke="#3f9a4a66" strokeWidth={1} vectorEffect="non-scaling-stroke" className={selected?.has(s.id) ? 'sel' : ''} />)}

      <g style={{ mixBlendMode: 'screen', pointerEvents: 'none' }}>
        {coneList.map(({ d, cov, color, x, y }) => {
          const rangePx = cov.range * scale, rot = Number(d.data.rotation) || 0;
          const poly = visibilityPolygon({ x, y, rotationDeg: rot, fovDeg: cov.fov, rangePx }, cones.clip ? obstacles : []);
          const dim = hot && hot !== d.id && !selected?.has(d.id) ? 0.55 : 1, on = selected?.has(d.id) || hot === d.id;
          return <path key={d.id} d={polyPath(poly)} fill={color} fillOpacity={cones.opacity * dim * (on ? 1.5 : 1)} stroke={color} strokeOpacity={(on ? 1 : 0.8) * dim} strokeWidth={on ? 2 : 1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
        })}
      </g>

      {walls.map(w => <g key={w.id} data-id={w.id} data-kind="wall" className={selected?.has(w.id) ? 'sel' : ''}>
        <polyline points={pts(w.data.points)} fill="none" stroke="transparent" strokeWidth={Math.max(14, ((w.data.thick ?? 4.5) / 12) * scale + 8)} strokeLinejoin="round" />
        <polyline points={pts(w.data.points)} fill="none" stroke={selected?.has(w.id) ? '#5fb8ff' : '#d7e0e8'} strokeWidth={Math.max(2, ((w.data.thick ?? 4.5) / 12) * scale)} strokeLinejoin="round" strokeLinecap="square" />
      </g>)}
      {openings.map(o => { const w = wallById.get(o.data.wallId), a = w?.data.points[o.data.segIndex], b = w?.data.points[o.data.segIndex + 1]; if (!a || !b) return null;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, cx = a.x + (b.x - a.x) * o.data.t, cy = a.y + (b.y - a.y) * o.data.t, half = (o.data.width * scale) / 2, door = o.data.kind === 'door';
        const th = Math.max(4, (((w?.data.thick ?? 4.5) / 12) * scale)) ;
        return <line key={o.id} data-id={o.id} data-kind="opening" x1={cx - ux * half} y1={cy - uy * half} x2={cx + ux * half} y2={cy + uy * half} stroke={selected?.has(o.id) ? '#ffd166' : door ? '#0d1a26' : '#5fb8ff'} strokeWidth={door ? th + 1 : Math.max(3, th * 0.6)} />; })}
      {by('bundle').map(b => <polyline key={b.id} data-id={b.id} data-kind="bundle" points={pts(b.data.points)} fill="none" stroke={selected?.has(b.id) ? '#5fb8ff' : '#9aa7b4'} strokeWidth={6} opacity={0.4} strokeLinejoin="round" />)}
      {cables.map(c => <g key={c.id} data-id={c.id} data-kind="cable">
        <polyline points={pts(c.data.points)} fill="none" stroke="transparent" strokeWidth={12} strokeLinejoin="round" />
        <polyline points={pts(c.data.points)} fill="none" stroke={selected?.has(c.id) ? '#fff' : (CATEGORY_COLORS[c.data.category ?? ''] ?? '#9aa7b4')} strokeWidth={selected?.has(c.id) ? 3 : 2} vectorEffect="non-scaling-stroke" opacity={0.95} strokeLinejoin="round"><title>{c.data.tag}</title></polyline>
      </g>)}
      {devices.map(d => { const t = deviceType(d.data.typeId), color = d.data.color ?? CATEGORY_COLORS[d.data.catKey] ?? '#9aa7b4', sel = selected?.has(d.id), cov = coverageOf(d.data);
        return <g key={d.id} data-id={d.id} data-kind="device" transform={`translate(${d.data.x} ${d.data.y})`}>
          <circle r={14} fill="transparent" />
          {sel && <circle r={14} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          {cov && <path d="M0 -9 L4 -14 L-4 -14 Z" transform={`rotate(${d.data.rotation ?? 0})`} fill="#0b131c" opacity={0.9} />}
          <circle r={9} fill={color} stroke="#0b131c" strokeWidth={1.5}><title>{(d.data.tag ?? '') + ' ' + (d.data.label || t?.label || d.data.typeId)}</title></circle>
          <text y={2.6} className="plan-glyph">{(t?.tag ?? '').slice(0, 3)}</text>
          {d.data.tag && <text y={23} className="plan-tag">{d.data.tag}</text>}
          {cones.labels && cov && <text y={34} className="plan-tag dim">{cov.fov >= 359 ? '360°' : Math.round(cov.fov) + '°'} · {Math.round(cov.range)}ft</text>}
        </g>; })}
      {by('label').map(l => <text key={l.id} data-id={l.id} data-kind="label" x={l.data.x} y={l.data.y} className={'plan-label' + (selected?.has(l.id) ? ' sel' : '')}>{l.data.text}</text>)}
      {by('dim').map(m => { const [a, b] = m.data.points as Pt[]; if (!a || !b) return null;
        return <g key={m.id} data-id={m.id} data-kind="dim"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selected?.has(m.id) ? '#fff' : '#5fb8ff'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} className="plan-label dim">{formatFt(Math.hypot(b.x - a.x, b.y - a.y) / scale)}</text></g>; })}
    </g>
  );
}
export const Scene = memo(SceneImpl);

export function formatFt(ft: number) { const f = Math.floor(ft), i = Math.round((ft - f) * 12); return i === 12 ? f + 1 + "'" : f + "'" + (i ? ' ' + i + '"' : ''); }
