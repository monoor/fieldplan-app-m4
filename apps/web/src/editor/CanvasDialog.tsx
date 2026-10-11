// "Canvas & scale": how big the drawing area is (feet), how many screen pixels make a foot, grid size, and calibration from a measured line.
import { useState } from 'react';
import { CANVAS_PRESETS, DEFAULT_CANVAS, GRID_CHOICES, SCALE_CHOICES, type Canvas } from './canvas';
import type { Rec } from './store';

export interface CanvasSettings { canvasW: number; canvasH: number; scale: number; gridFt: number }

export function CanvasDialog({ initial, dims, onApply, onClose }: { initial: { canvas: Canvas | null; scale: number; gridFt: number }; dims: Rec[]; onApply: (s: CanvasSettings) => void; onClose: () => void }) {
  const [w, setW] = useState(String((initial.canvas ?? DEFAULT_CANVAS).w)), [h, setH] = useState(String((initial.canvas ?? DEFAULT_CANVAS).h));
  const [scale, setScale] = useState(String(initial.scale)), [grid, setGrid] = useState(String(initial.gridFt));
  const [cal, setCal] = useState<Record<string, string>>({});
  const n = (v: string) => Number(v), ok = n(w) >= 5 && n(w) <= 5000 && n(h) >= 5 && n(h) <= 5000 && n(scale) >= 2 && n(scale) <= 200 && n(grid) > 0;
  const len = (d: Rec) => { const p = d.data.points as { x: number; y: number }[]; return Math.hypot(p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y); };
  const calibrate = (d: Rec) => { const real = n(cal[d.id] ?? ''); if (real > 0) setScale(String(+(len(d) / real).toFixed(3))); };
  const px = n(scale) || 0;
  return (
    <div className="modal-back" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(560px,100%)' }}>
        <h2>Canvas &amp; scale</h2>
        <div className="col">
          <label>Preset<select value="" onChange={e => { const p = CANVAS_PRESETS[Number(e.target.value)]; if (p) { setW(String(p.w)); setH(String(p.h)); } }}><option value="">Choose a size…</option>{CANVAS_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}</select></label>
          <div className="row">
            <label className="grow">Canvas width (ft)<input type="number" min={5} max={5000} value={w} onChange={e => setW(e.target.value)} /></label>
            <label className="grow">Canvas height (ft)<input type="number" min={5} max={5000} value={h} onChange={e => setH(e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="grow">Scale<select value={SCALE_CHOICES.some(c => c.px === px) ? String(px) : 'custom'} onChange={e => { if (e.target.value !== 'custom') setScale(e.target.value); }}>
              {SCALE_CHOICES.map(c => <option key={c.px} value={c.px}>{c.label}</option>)}<option value="custom">Custom ({px} px/ft)</option></select></label>
            <label className="grow">Px per foot<input type="number" min={2} max={200} step="any" value={scale} onChange={e => setScale(e.target.value)} /></label>
            <label className="grow">Grid<select value={grid} onChange={e => setGrid(e.target.value)}>{GRID_CHOICES.map(g => <option key={g} value={g}>{g} ft</option>)}</select></label>
          </div>
          <p className="muted small">The canvas is {Math.round(n(w) * px)} × {Math.round(n(h) * px)} px at this scale. Positions on existing drawings are kept in pixels, so changing the scale of a finished plan changes its real-world size — use it to set up a new design, or to correct a plan using a known measurement below.</p>
          {dims.length > 0 && <div>
            <h4>Calibrate from a measured line</h4>
            {dims.map((d, i) => <div className="row" key={d.id}>
              <span className="grow small">Measure {i + 1}: {len(d).toFixed(0)} px = {(len(d) / (px || 1)).toFixed(1)}′ now</span>
              <input style={{ width: 90 }} type="number" min={0} step="any" placeholder="real ft" value={cal[d.id] ?? ''} onChange={e => setCal(c => ({ ...c, [d.id]: e.target.value }))} />
              <button className="btn sm" disabled={!(n(cal[d.id] ?? '') > 0)} onClick={() => calibrate(d)}>Use</button>
            </div>)}
          </div>}
          {!dims.length && <p className="muted small">To calibrate against a known distance (a door width, a wall you measured), draw a Measure line across it, then come back here.</p>}
        </div>
        <div className="row"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => { onApply({ canvasW: n(w), canvasH: n(h), scale: n(scale), gridFt: n(grid) }); onClose(); }}>Apply</button></div>
      </div>
    </div>
  );
}
