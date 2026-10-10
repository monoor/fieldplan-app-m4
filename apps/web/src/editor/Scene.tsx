// Draws one sheet: underlay, floors/areas (patterned), wall-clipped coverage cones, walls, doors/windows, cables, devices, labels, dims.
// Every selectable element carries data-id / data-kind so the editor can hit-test through the DOM.
// Fully self-styled (no CSS classes) so the same component renders the on-screen plan and the exported SVG/PNG/PDF.
import { memo, useMemo } from 'react';
import { FOV_DEFAULTS, SURFACE_MATS, buildObstacles, deviceType, polyPath, surfaceMat, visibilityPolygon, wallMat, type Pt, type RecordKind } from '@fieldplan/shared';
import { CATEGORY_COLORS, coneColor, type ConeOptions } from './coneStyle';

export interface SceneRec { id: string; kind: RecordKind; data: Record<string, any>; rev?: number } // eslint-disable-line @typescript-eslint/no-explicit-any
const pts = (ps: Pt[]) => ps.map(p => p.x + ',' + p.y).join(' ');
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', SANS = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/** Resolved coverage settings for a device, or null if it has none. */
export function coverageOf(d: SceneRec['data']): { fov: number; range: number } | null {
  const def = FOV_DEFAULTS[d.typeId] ?? (() => { const t = deviceType(d.typeId); return t?.fov && t.range ? [t.fov, t.range] as const : undefined; })();
  const fov = Number(d.fov) || def?.[0], range = Number(d.range) || def?.[1];
  return fov && range ? { fov, range } : null;
}

export function patternInner(m: { color: string; pat: string; room?: boolean }, light: boolean): string {
  const hi = light ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.14)', lo = light ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.28)';
  let s = `<rect width="16" height="16" fill="${m.color}" fill-opacity="${m.room ? 0.16 : light ? 0.55 : 0.8}"/>`;
  switch (m.pat) {
    case 'grass': s += `<path d="M2 10 l2 -5 M7 12 l2 -5 M12 9 l2 -5 M4 3 l1 -2 M10 4 l1 -2" stroke="${hi}" stroke-width="1" fill="none"/>`; break;
    case 'speck': s += `<circle cx="3" cy="4" r=".8" fill="${hi}"/><circle cx="10" cy="9" r=".8" fill="${hi}"/><circle cx="7" cy="13" r=".7" fill="${lo}"/>`; break;
    case 'joints': s += `<path d="M0 0H16M0 0V16" stroke="${lo}" stroke-width="1"/>`; break;
    case 'brick': s += `<path d="M0 8H16M0 16H16M8 0V8M0 8V16M16 8V16" stroke="${lo}" stroke-width="1"/>`; break;
    case 'dots': s += `<circle cx="4" cy="4" r="1.3" fill="${lo}"/><circle cx="12" cy="11" r="1.3" fill="${lo}"/><circle cx="9" cy="3" r=".8" fill="${hi}"/>`; break;
    case 'waves': s += `<path d="M0 6q4 -4 8 0t8 0M0 13q4 -4 8 0t8 0" stroke="${hi}" stroke-width="1" fill="none"/>`; break;
    case 'planks': s += `<path d="M0 5H16M0 11H16" stroke="${lo}" stroke-width="1"/><path d="M6 5V11M13 11V16M13 0V5" stroke="${lo}" stroke-width=".8"/>`; break;
    case 'hatch': s += `<path d="M-2 2L2 -2M0 16L16 0M14 18L18 14" stroke="${lo}" stroke-width="1.2"/>`; break;
    case 'grid': s += `<path d="M0 0H16M0 0V16M0 8H16M8 0V16" stroke="${lo}" stroke-width=".8"/>`; break;
  }
  return s;
}
export const patId = (id: string) => 'fp-pat-' + id;

const polyArea = (p: Pt[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]!; a += p[i]!.x * q.y - q.x * p[i]!.y; } return Math.abs(a) / 2; };
const centroid = (p: Pt[]) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });

export interface SceneProps {
  recs: SceneRec[]; scale: number; fileUrl: (sha: string) => string; cones: ConeOptions; selected?: ReadonlySet<string>; hot?: string | null;
  /** Print-style colours for export. */ light?: boolean;
  /** Export: world units per output pixel. When set, strokes are sized in world units instead of screen pixels. */ unit?: number;
}

function SceneImpl({ recs, scale, fileUrl, cones, selected, hot, light = false, unit }: SceneProps) {
  const by = (k: string) => recs.filter(r => r.kind === k);
  const walls = by('wall'), openings = by('opening'), devices = by('device'), cables = by('cable');
  const wallById = new Map(walls.map(w => [w.id, w]));
  const obstacleKey = [...walls, ...openings].map(r => r.id + '@' + (r.rev ?? 0)).join('|') + '#' + scale;
  const obstacles = useMemo(() => buildObstacles([...walls, ...openings], scale), [obstacleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = (id: string) => !!selected?.has(id);
  /** Stroke width in screen pixels (editor) or output pixels (export). */
  const sw = (n: number) => (unit ? { strokeWidth: n * unit } : { strokeWidth: n, vectorEffect: 'non-scaling-stroke' as const });
  const u = unit ?? 1; // text/size helper for export
  void u;
  const C = light
    ? { bg: '#ffffff', text: '#1b2733', halo: '#ffffff', muted: '#5a6b7a', core: '#1b2733', dim: '#1769aa', glyph: '#ffffff', devStroke: '#1b2733', cone: 1 }
    : { bg: '#0d1a26', text: '#e6edf3', halo: '#0b131c', muted: '#8da2b5', core: '#0b131c', dim: '#5fb8ff', glyph: '#0b131c', devStroke: '#0b131c', cone: 1 };
  const text = (size: number, fill = C.text, extra: Record<string, unknown> = {}) => ({ fontSize: size, fontFamily: MONO, fill, textAnchor: 'middle' as const, stroke: C.halo, strokeWidth: 3, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const, pointerEvents: 'none' as const, ...extra });

  const camIndex = new Map(devices.filter(d => coverageOf(d.data)).sort((a, b) => String(a.data.tag ?? a.id).localeCompare(String(b.data.tag ?? b.id), undefined, { numeric: true })).map((d, i) => [d.id, i]));
  const soloId = cones.solo ? [...(selected ?? [])].find(id => camIndex.has(id)) ?? null : null;
  const coneList = cones.show ? devices.flatMap(d => {
    const cov = coverageOf(d.data); if (!cov) return [];
    if (cones.solo && soloId && d.id !== soloId) return [];
    const x = Number(d.data.x), y = Number(d.data.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const color = coneColor(cones, { typeId: d.data.typeId, catKey: d.data.catKey, color: d.data.color, fov: cov.fov }, camIndex.get(d.id) ?? 0);
    const rangePx = cov.range * scale, poly = visibilityPolygon({ x, y, rotationDeg: Number(d.data.rotation) || 0, fovDeg: cov.fov, rangePx }, cones.clip ? obstacles : []);
    return [{ d, cov, color, x, y, rangePx, path: polyPath(poly) }];
  }) : [];

  const usedMats = [...new Set(by('surface').map(s => s.data.matId as string))].map(id => surfaceMat(id));
  const defsMats = usedMats.length ? usedMats : SURFACE_MATS.slice(0, 0);

  return (
    <g>
      <defs>
        {defsMats.map(m => <pattern key={m.id} id={patId(m.id)} width={16} height={16} patternUnits="userSpaceOnUse" dangerouslySetInnerHTML={{ __html: patternInner(m, light) }} />)}
        {coneList.map(c => <radialGradient key={c.d.id} id={'fp-cg-' + c.d.id} gradientUnits="userSpaceOnUse" cx={c.x} cy={c.y} r={c.rangePx}>
          <stop offset="0" stopColor={c.color} stopOpacity={Math.min(0.85, cones.opacity * 1.5)} /><stop offset="1" stopColor={c.color} stopOpacity={cones.opacity * 0.22} />
        </radialGradient>)}
      </defs>

      {by('underlay').map(un => un.data.fileSha && <image key={un.id} data-id={un.id} data-kind="underlay" href={fileUrl(un.data.fileSha)} x={un.data.x} y={un.data.y} width={un.data.w} height={un.data.h} opacity={un.data.opacity ?? 0.5} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />)}

      {cones.surfaces && by('surface').map(s => {
        const m = surfaceMat(s.data.matId), c = centroid(s.data.points), sf = polyArea(s.data.points) / (scale * scale), on = sel(s.id);
        return <g key={s.id} data-id={s.id} data-kind="surface">
          <polygon points={pts(s.data.points)} fill={`url(#${patId(m.id)})`} stroke={on ? '#5fb8ff' : m.room ? m.color : 'none'} {...sw(on ? 2 : 1.2)} strokeDasharray={m.room && !on ? '5 3' : undefined} />
          {(cones.surfaceLabels || on) && (m.room
            ? <><text x={c.x} y={c.y - 2} {...text(13, C.text, { fontFamily: SANS, fontWeight: 600 })}>{s.data.label || m.label}</text><text x={c.x} y={c.y + 12} {...text(10, C.muted)}>{Math.round(sf)} sf</text></>
            : <text x={c.x} y={c.y + 4} {...text(10, C.muted)}>{(s.data.label || m.label) + ' · ' + Math.round(sf) + ' sf'}</text>)}
        </g>;
      })}

      <g style={{ pointerEvents: 'none' }}>
        {coneList.map(({ d, color, path }) => {
          const on = sel(d.id) || hot === d.id, dim = hot && hot !== d.id && !sel(d.id) ? 0.5 : 1;
          return <path key={d.id} d={path} fill={`url(#fp-cg-${d.id})`} fillOpacity={dim * (on ? 1 : 0.9)} stroke={color} strokeOpacity={(on ? 0.95 : 0.5) * dim} {...sw(on ? 1.8 : 1)} strokeLinejoin="round" />;
        })}
      </g>

      {cones.walls && walls.map(w => {
        const m = wallMat(w.data.mat), t = Math.max(3, ((w.data.thick ?? m.thick) / 12) * scale), on = sel(w.id);
        const col = light ? shade(m.color) : m.color;
        return <g key={w.id} data-id={w.id} data-kind="wall">
          <polyline points={pts(w.data.points)} fill="none" stroke="transparent" strokeWidth={Math.max(14, t + 8)} strokeLinejoin="round" />
          <polyline points={pts(w.data.points)} fill="none" stroke={on ? '#5fb8ff' : col} strokeWidth={t} strokeDasharray={m.dash} strokeLinejoin="round" strokeLinecap="butt" />
          {!m.dash && <polyline points={pts(w.data.points)} fill="none" stroke={C.core} strokeOpacity={0.55} strokeWidth={Math.max(1, t * 0.16)} strokeLinejoin="round" pointerEvents="none" />}
        </g>;
      })}

      {cones.walls && openings.map(o => {
        const w = wallById.get(o.data.wallId), a = w?.data.points[o.data.segIndex], b = w?.data.points[o.data.segIndex + 1]; if (!a || !b) return null;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
        const cx = a.x + (b.x - a.x) * o.data.t, cy = a.y + (b.y - a.y) * o.data.t, half = (o.data.width * scale) / 2, W = half * 2;
        const e1 = { x: cx - ux * half, y: cy - uy * half }, e2 = { x: cx + ux * half, y: cy + uy * half };
        const tw = Math.max(3, ((w?.data.thick ?? wallMat(w?.data.mat).thick) / 12) * scale), on = sel(o.id);
        const line = on ? '#ffd166' : light ? '#1b2733' : '#d7e0e8', leaf = on ? '#ffd166' : '#ff9f43', side = o.data.swingSide === 'out' ? -1 : 1;
        const els: React.ReactNode[] = [];
        const L = (k: string, p: Pt, q: Pt, col = line, w2 = 1.2, dash?: string) => els.push(<line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={col} {...sw(w2)} strokeDasharray={dash} />);
        const jamb = (k: string, p: Pt) => L(k, { x: p.x - nx * tw * 0.6, y: p.y - ny * tw * 0.6 }, { x: p.x + nx * tw * 0.6, y: p.y + ny * tw * 0.6 });
        if (o.data.kind === 'window') {
          for (const k of [-0.22, 0, 0.22]) L('w' + k, { x: e1.x + nx * tw * k, y: e1.y + ny * tw * k }, { x: e2.x + nx * tw * k, y: e2.y + ny * tw * k }, light ? '#1769aa' : '#7cc2e8', 1.2);
          jamb('j1', e1); jamb('j2', e2);
        } else {
          jamb('j1', e1); jamb('j2', e2);
          const type = o.data.doorType ?? 'single';
          const swing = (k: string, hinge: Pt, dir: number, l: number) => {
            const tip = { x: hinge.x + nx * side * l, y: hinge.y + ny * side * l }; L(k, hinge, tip, leaf, 1.6);
            const a0 = Math.atan2(tip.y - hinge.y, tip.x - hinge.x), a1 = Math.atan2(uy * dir, ux * dir); let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            const arc = Array.from({ length: 13 }, (_, i) => { const ang = a0 + (da * i) / 12; return (hinge.x + Math.cos(ang) * l) + ',' + (hinge.y + Math.sin(ang) * l); }).join(' ');
            els.push(<polyline key={k + 'a'} points={arc} fill="none" stroke={leaf} strokeOpacity={0.7} {...sw(1)} strokeDasharray="3 2" />);
          };
          if (type === 'single') { if (o.data.hinge === 'right') swing('s', e2, -1, W); else swing('s', e1, 1, W); }
          else if (type === 'double') { swing('d1', e1, 1, W / 2); swing('d2', e2, -1, W / 2); }
          else if (type === 'sliding' || type === 'pocket') { L('p1', { x: e1.x + nx * 1.5, y: e1.y + ny * 1.5 }, { x: cx + nx * 1.5, y: cy + ny * 1.5 }, leaf, 1.6); L('p2', { x: cx - nx * 1.5, y: cy - ny * 1.5 }, { x: e2.x - nx * 1.5, y: e2.y - ny * 1.5 }, leaf, 1.6); }
          else if (type === 'overhead') L('o', { x: e1.x + nx * side * 8, y: e1.y + ny * side * 8 }, { x: e2.x + nx * side * 8, y: e2.y + ny * side * 8 }, leaf, 1.2, '6 3');
        }
        return <g key={o.id} data-id={o.id} data-kind="opening">
          <line x1={e1.x} y1={e1.y} x2={e2.x} y2={e2.y} stroke={C.bg} strokeWidth={tw + 1.5} />
          {els}
          <line x1={e1.x} y1={e1.y} x2={e2.x} y2={e2.y} stroke="transparent" strokeWidth={Math.max(14, tw + 8)} />
        </g>;
      })}

      {by('bundle').map(b => <polyline key={b.id} data-id={b.id} data-kind="bundle" points={pts(b.data.points)} fill="none" stroke={sel(b.id) ? '#5fb8ff' : '#9aa7b4'} strokeWidth={6} opacity={0.4} strokeLinejoin="round" />)}
      {cones.cables && cables.map(c => {
        const col = sel(c.id) ? (light ? '#000' : '#fff') : (CATEGORY_COLORS[c.data.category ?? ''] ?? '#9aa7b4'), mid = c.data.points[Math.floor(c.data.points.length / 2)] as Pt | undefined;
        return <g key={c.id} data-id={c.id} data-kind="cable">
          <polyline points={pts(c.data.points)} fill="none" stroke="transparent" strokeWidth={12} strokeLinejoin="round" />
          <polyline points={pts(c.data.points)} fill="none" stroke={col} strokeOpacity={light ? 0.9 : 0.8} {...sw(sel(c.id) ? 2.5 : 1.4)} strokeLinejoin="round"><title>{c.data.tag}</title></polyline>
          {(cones.cableLabels || sel(c.id)) && mid && <text x={mid.x} y={mid.y - 5} {...text(9, C.muted)}>{c.data.tag}{c.data.label ? ' · ' + c.data.label : ''}</text>}
        </g>;
      })}

      {cones.devices && devices.map(d => {
        const t = deviceType(d.data.typeId), color = d.data.color ?? CATEGORY_COLORS[d.data.catKey] ?? '#9aa7b4', on = sel(d.id), cov = coverageOf(d.data);
        return <g key={d.id} data-id={d.id} data-kind="device" transform={`translate(${d.data.x} ${d.data.y})`}>
          <circle r={14} fill="transparent" />
          {on && <circle r={14} fill="none" stroke={light ? '#000' : '#fff'} {...sw(1.5)} />}
          {cov && <path d="M0 -9 L4 -14 L-4 -14 Z" transform={`rotate(${d.data.rotation ?? 0})`} fill={C.devStroke} opacity={0.9} />}
          <circle r={9} fill={color} stroke={C.devStroke} strokeWidth={1.5}><title>{(d.data.tag ?? '') + ' ' + (d.data.label || t?.label || d.data.typeId)}</title></circle>
          <text y={2.4} {...text(6.5, C.glyph, { stroke: 'none', fontWeight: 600 })}>{(t?.tag ?? '').slice(0, 3)}</text>
          {cones.tags && d.data.tag && <text y={23} {...text(10)}>{d.data.tag}</text>}
          {cones.labels && cov && <text y={34} {...text(9, C.muted)}>{cov.fov >= 359 ? '360°' : Math.round(cov.fov) + '°'} · {Math.round(cov.range)}ft</text>}
        </g>;
      })}
      {by('label').map(l => <text key={l.id} data-id={l.id} data-kind="label" x={l.data.x} y={l.data.y} {...text(13, sel(l.id) ? '#5fb8ff' : C.text, { fontFamily: SANS, pointerEvents: 'auto' })}>{l.data.text}</text>)}
      {by('dim').map(m => { const [a, b] = m.data.points as Pt[]; if (!a || !b) return null;
        return <g key={m.id} data-id={m.id} data-kind="dim"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel(m.id) ? C.text : C.dim} {...sw(1)} />
          <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} {...text(11, C.dim)}>{formatFt(Math.hypot(b.x - a.x, b.y - a.y) / scale)}</text></g>; })}
    </g>
  );
}
export const Scene = memo(SceneImpl);

/** Darken a wall colour so pale walls stay visible on white paper. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16), f = 0.55; return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v * f).toString(16).padStart(2, '0')).join('');
}

export function formatFt(ft: number) { const f = Math.floor(ft), i = Math.round((ft - f) * 12); return i === 12 ? f + 1 + "'" : f + "'" + (i ? ' ' + i + '"' : ''); }
