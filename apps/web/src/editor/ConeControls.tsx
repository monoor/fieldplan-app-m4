import { useEffect, useState } from 'react';
import { saveConeOptions, loadConeOptions, styleColor, styleName, type ColorBy, type ConeOptions } from './coneStyle';

export function useConeOptions(): [ConeOptions, (p: Partial<ConeOptions>) => void] {
  const [o, setO] = useState(loadConeOptions);
  useEffect(() => saveConeOptions(o), [o]);
  return [o, p => setO(prev => ({ ...prev, ...p }))];
}

const MODES: [ColorBy, string][] = [['style', 'By style'], ['camera', 'Each camera'], ['category', 'By category'], ['single', 'One colour']];
const LAYERS: ['surfaces' | 'walls' | 'devices' | 'cables' | 'tags' | 'cableLabels' | 'surfaceLabels', string][] = [['surfaces', 'Floors'], ['walls', 'Walls & doors'], ['devices', 'Devices'], ['cables', 'Cables'], ['tags', 'Device tags'], ['cableLabels', 'Cable labels'], ['surfaceLabels', 'Room labels']];
const LEGEND = ['cam-fixed', 'cam-bullet', 'cam-dome', 'cam-ptz', 'cam-lpr', 'cam-fisheye', 'cam-pano', 'cam-multi', 'doorbell', 's-motion'];

/** Coverage cone display options (show, colour-by, opacity, wall clipping). */
export function ConeControls({ opts, set }: { opts: ConeOptions; set: (p: Partial<ConeOptions>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cone-ctl">
      <button className={'btn sm' + (opts.show ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open}>View ▾</button>
      {open && (
        <div className="popover" onPointerDown={e => e.stopPropagation()}>
          <div className="layers">{LAYERS.map(([k, l]) => <label key={k} className="inline"><input type="checkbox" checked={opts[k]} onChange={e => set({ [k]: e.target.checked })} />{l}</label>)}</div>
          <label className="inline"><input type="checkbox" checked={opts.show} onChange={e => set({ show: e.target.checked })} /> Coverage cones</label>
          <div className="seg">{MODES.map(([k, l]) => <button key={k} className={opts.colorBy === k ? 'on' : ''} onClick={() => set({ colorBy: k })}>{l}</button>)}</div>
          {opts.colorBy === 'style' && <div className="legend">{LEGEND.map(t => <span key={t}><i style={{ background: styleColor(t) }} />{styleName(t)}</span>)}</div>}
          <label>Cone strength {Math.round(opts.opacity * 100)}%<input type="range" min={5} max={70} value={Math.round(opts.opacity * 100)} onChange={e => set({ opacity: Number(e.target.value) / 100 })} /></label>
          <label className="inline"><input type="checkbox" checked={opts.clip} onChange={e => set({ clip: e.target.checked })} /> Stop at walls (windows are see-through)</label>
          <label className="inline"><input type="checkbox" checked={opts.solo} onChange={e => set({ solo: e.target.checked })} /> Only show the selected camera</label>
          <label className="inline"><input type="checkbox" checked={opts.dori} onChange={e => set({ dori: e.target.checked })} /> DORI bands (Identify / Recognize / Observe)</label>
          <label className="inline"><input type="checkbox" checked={opts.labels} onChange={e => set({ labels: e.target.checked })} /> Angle / range labels</label>
          <button className="btn sm" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
