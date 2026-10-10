// Read-only plan for a sheet (project page and client share links): pan, zoom, coverage options.
import { useMemo, useRef } from 'react';
import type { ProjectRecord } from '@fieldplan/shared';
import { Scene } from '../editor/Scene';
import { ConeControls, useConeOptions } from '../editor/ConeControls';
import { useViewport } from '../editor/useViewport';
import { bounds } from '../editor/bounds';
import { usePanZoomPointers } from '../editor/usePointers';

export function PlanView({ records, sheetId, fileUrl, scale }: { records: ProjectRecord[]; sheetId: string; fileUrl: (sha: string) => string; scale: number }) {
  const recs = useMemo(() => records.filter(r => r.sheetId === sheetId && !r.deleted), [records, sheetId]);
  const box = useRef<HTMLDivElement>(null);
  const [cones, setCones] = useConeOptions();
  const vp = useViewport(box, useMemo(() => bounds(recs, scale), [recs, scale]));
  const ptr = usePanZoomPointers(vp);
  return (
    <div className="plan" ref={box} {...ptr.handlers}>
      <svg width={vp.size.w} height={vp.size.h}>
        <g transform={`translate(${vp.view.x} ${vp.view.y}) scale(${vp.view.k})`}><Scene recs={recs} scale={scale} fileUrl={fileUrl} cones={cones} /></g>
      </svg>
      <div className="plan-tools" onPointerDown={e => e.stopPropagation()}>
        <ConeControls opts={cones} set={setCones} />
        <button className="btn sm" onClick={() => vp.zoomAt(vp.size.w / 2, vp.size.h / 2, 1.4)} aria-label="Zoom in">+</button>
        <button className="btn sm" onClick={() => vp.zoomAt(vp.size.w / 2, vp.size.h / 2, 1 / 1.4)} aria-label="Zoom out">−</button>
        <button className="btn sm" onClick={vp.fit}>Fit</button>
      </div>
    </div>
  );
}
