// Panel editor: service/feeder settings, breaker schedule with slot graphic, connected loads and the NEC 220 load calculation.
import { useState } from 'react';
import { BREAKER_PRESETS, BREAKER_TYPES, OCC_VA, PANEL_VOLTS, breakerAmps, defaultLoad, defaultPanel, loadCalc, nextSlot, panelSlots, svcFor, wireFor, newId, type Breaker, type LoadInputs, type PanelData } from '@fieldplan/shared';

export interface Dev { id: string; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
export const isPanelType = (typeId: string) => typeId === 'panel' || typeId === 'subpanel';
export const panelOf = (d: Dev): PanelData => ({ ...defaultPanel(d.data.typeId === 'panel' ? 'main' : 'sub'), ...(d.data.panel ?? {}) });
/** Devices fed from each breaker of a panel, with their combined load (W is treated as VA). */
export function breakerLoads(devs: Dev[], panelId: string) {
  const m = new Map<string, { devs: Dev[]; va: number }>();
  for (const d of devs) { const f = d.data.feed; if (f?.src === panelId && f.bkr) { const e = m.get(f.bkr) ?? { devs: [], va: 0 }; e.devs.push(d); e.va += Number(d.data.watts) || 0; m.set(f.bkr, e); } }
  return m;
}
const tone = (b: Breaker) => (b.type === 'MAIN' ? '#e0616b' : b.poles > 1 ? '#e8a33d' : b.type === 'STD' ? '#5f7a9a' : '#4fd1c5');

export function PanelDialog({ dev, devs, onChange, onClose, floorSqft }: { dev: Dev; devs: Dev[]; onChange: (p: PanelData) => void; onClose: () => void; floorSqft?: number }) {
  const p = panelOf(dev), s = panelSlots(p), isMain = p.kind === 'main', v = Number(p.volt.split('/').pop()!.split('-')[0]) || 240, loads = breakerLoads(devs, dev.id);
  const [preset, setPreset] = useState(0), [calcOpen, setCalcOpen] = useState(false);
  const set = (patch: Partial<PanelData>) => onChange({ ...p, ...patch });
  const num = (k: keyof PanelData, min: number, max: number, step = 1) => <input type="number" min={min} max={max} step={step} value={Number(p[k]) || 0} onChange={e => set({ [k]: Number(e.target.value) } as Partial<PanelData>)} />;
  const upd = (i: number, patch: Partial<Breaker>) => set({ bkrs: p.bkrs.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const add = (b?: Partial<Breaker>) => { const pr = BREAKER_PRESETS[preset]!, poles = b?.poles ?? pr.p; set({ bkrs: [...p.bkrs, { id: newId(), slot: nextSlot(p, poles), desc: pr.n, amps: pr.a, poles, type: pr.t, ...b }] }); };
  const L: LoadInputs = p.load ?? defaultLoad(floorSqft || 2000), calc = loadCalc(L, p.volt), setL = (patch: Partial<LoadInputs>) => set({ load: { ...L, ...patch } });
  const ln = (k: keyof LoadInputs, label: string, step = 1) => <label className="prop"><span>{label}</span><input type="number" min={0} step={step} value={Number(L[k]) || 0} onChange={e => setL({ [k]: Number(e.target.value) } as Partial<LoadInputs>)} /></label>;
  const rows = Math.ceil(p.spaces / 2), rh = 22, W = 360, colW = (W - 40) / 2, sv = svcFor(p.main || p.bus), wf = wireFor(p.feederA || 100);
  const maxLeg = Math.max(...s.legs.slice(0, s.phases));

  return (
    <div className="modal-back" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Panel">
        <div className="row"><h2 className="grow">{dev.data.tag ?? 'Panel'} · {isMain ? 'Main panel / service' : 'Subpanel'}</h2><button className="btn" onClick={onClose}>Done</button></div>
        <div className="modal-body">
          <div className="col">
            <fieldset className="box"><legend>Panel</legend>
              <div className="grid3c">
                <label className="prop"><span>System</span><select value={p.volt} onChange={e => set({ volt: e.target.value })}>{PANEL_VOLTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="prop"><span>Bus (A)</span>{num('bus', 30, 1600, 5)}</label>
                <label className="prop"><span>{isMain ? 'Main breaker (A)' : 'Main (0 = MLO)'}</span>{num('main', 0, 1600, 5)}</label>
                <label className="prop"><span>Spaces</span>{num('spaces', 2, 84, 2)}</label>
                <label className="prop"><span>AIC (kA)</span>{num('aic', 5, 200)}</label>
                {!isMain && <label className="prop"><span>Feeder OCPD (A)</span>{num('feederA', 15, 800, 5)}</label>}
              </div>
              {!isMain && <label className="prop"><span>Fed from (panel / breaker)</span><input value={p.feedFrom ?? ''} onChange={e => set({ feedFrom: e.target.value || undefined })} /></label>}
              <p className="small">{isMain
                ? <>Service <b>{p.main || p.bus} A</b>{p.volt === '120/240-1' && sv && <> · dwelling SE conductors (310.12): <b>{sv.w[0]}</b> / <b>{sv.w[1]}</b></>}{p.main > p.bus && <span className="bad"> — main exceeds bus rating</span>}</>
                : <>Feeder OCPD <b>{p.feederA} A</b>{wf && <> → min Cu <b>{wf.w[0]} AWG</b> (THHN/MC) or <b>{wf.w[1]} AWG</b> (NM/SER)</>}{p.feederA > p.bus && <span className="bad"> — feeder exceeds bus rating</span>}</>}</p>
              <p className="muted small">{isMain ? 'Needs grounding electrode system, main bonding jumper, emergency disconnect outdoors (230.85), surge protection (230.67), 30×36 in working space (110.26).' : '4-wire feeder (2 hots + neutral + EGC). Isolate neutrals: remove the bonding screw and add a separate ground bar.'}</p>
            </fieldset>

            <fieldset className="box"><legend>Slots</legend>
              <svg width={W} height={rows * rh + 6} style={{ background: 'var(--canvas)', borderRadius: 6, fontFamily: 'var(--mono)' }}>
                {Array.from({ length: rows }, (_, r) => [0, 1].map(side => {
                  const slot = r * 2 + side + 1, bi = s.map.get(slot), b = bi !== undefined ? p.bkrs[bi] : null, x = side === 0 ? 2 : W / 2 + 18, y = 3 + r * rh, first = b?.slot === slot;
                  return <g key={slot}><rect x={x} y={y} width={colW} height={rh - 2} rx={3} fill={b ? tone(b) : '#16283a'} opacity={b ? 0.9 : 1} stroke={bi !== undefined && s.conflicts.has(bi) ? '#e0616b' : 'none'} />
                    <text x={side === 0 ? W / 2 - 2 : W / 2 + 2} y={y + 14} fontSize={10} fill="#7d92a6" textAnchor={side === 0 ? 'end' : 'start'}>{slot}{'ABC'[s.legOf(slot)]}</text>
                    {b && <text x={x + 5} y={y + 14} fontSize={10.5} fontWeight={700} fill="#0b131c">{first ? `${b.amps}A ${b.desc}`.slice(0, 26) : '↑'}</text>}</g>;
                }))}
              </svg>
              <p className="small">Used <b>{s.map.size} / {p.spaces}</b> · connected breakers per leg: {s.legs.slice(0, s.phases).map((a, i) => 'ABC'[i] + ' ' + a + 'A').join(' · ')}{maxLeg > p.bus * 2 && <span className="warn"> (breaker sum ≫ bus; use the load calc)</span>}</p>
              {s.conflicts.size > 0 && <p className="bad small">Slot conflict or overflow on {s.conflicts.size} breaker(s): 2-pole breakers use slot n and n+2.</p>}
            </fieldset>
          </div>

          <div className="col">
            <fieldset className="box"><legend>Breakers</legend>
              <div className="row"><select className="grow" value={preset} onChange={e => setPreset(Number(e.target.value))}>{BREAKER_PRESETS.map((b, i) => <option key={i} value={i}>{b.n} — {b.a}A {b.p}P{b.t !== 'STD' ? ' ' + b.t : ''}</option>)}</select>
                <button className="btn" onClick={() => add()}>Add</button><button className="btn" onClick={() => add({ desc: 'Circuit', amps: 20, poles: 1, type: 'STD' })}>Custom</button></div>
              {!!p.bkrs.length && <div className="bk-grid head"><span>Slot</span><span>Circuit</span><span>Amps</span><span>Poles</span><span>Type</span><span /></div>}
              {p.bkrs.map((b, i) => { const ld = loads.get(b.id), w = wireFor(b.amps), amps = ld ? breakerAmps(ld.va, b.poles, p.volt) : 0;
                return <div key={b.id}>
                  <div className="bk-grid">
                    <input type="number" min={1} max={p.spaces} value={b.slot} className={s.conflicts.has(i) ? 'err' : ''} onChange={e => upd(i, { slot: Number(e.target.value) })} />
                    <input value={b.desc} title={w ? `min Cu ${w.w[0]} AWG / NM ${w.w[1]} AWG` : ''} onChange={e => upd(i, { desc: e.target.value })} />
                    <input type="number" min={10} max={1200} step={5} value={b.amps} onChange={e => upd(i, { amps: Number(e.target.value) })} />
                    <select value={b.poles} onChange={e => upd(i, { poles: Number(e.target.value) })}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}P</option>)}</select>
                    <select value={b.type} onChange={e => upd(i, { type: e.target.value })}>{BREAKER_TYPES.map(([k]) => <option key={k} value={k}>{k}</option>)}</select>
                    <span className="row"><button className="btn sm" title="Duplicate" onClick={() => add({ ...b, id: newId(), slot: nextSlot(p, b.poles) })}>+</button><button className="btn sm danger" title="Remove" onClick={() => set({ bkrs: p.bkrs.filter((_, j) => j !== i) })}>×</button></span>
                  </div>
                  {ld && <p className="muted small bk-note">→ {ld.devs.map(d => d.data.tag ?? d.data.typeId).join(', ')} · {Math.round(ld.va)} VA ≈ {amps.toFixed(1)} A{amps > b.amps * 0.8 && <span className="warn"> (over 80%)</span>}</p>}
                </div>; })}
              {!p.bkrs.length && <p className="muted small">No breakers yet. Add circuits above, then assign devices to them from each device's “Powered from” field.</p>}
            </fieldset>

            <fieldset className="box"><legend><button className="link" onClick={() => setCalcOpen(!calcOpen)}>{calcOpen ? '▾' : '▸'} Load calculation (NEC 220)</button></legend>
              {calcOpen && <>
                <div className="grid3c">
                  <label className="prop"><span>Method</span><select value={L.mode} onChange={e => setL({ mode: e.target.value as LoadInputs['mode'] })}><option value="dwelling">Dwelling — 220.82</option><option value="commercial">Non-dwelling — 220.42</option></select></label>
                  {ln('sqft', 'Floor area (sf)', 10)}
                  {L.mode === 'dwelling' ? <>{ln('sa', 'Small-appliance circuits')}{ln('laundry', 'Laundry circuits')}{ln('applVA', 'Fastened appliances VA', 100)}{ln('rangeKW', 'Range kW', 0.5)}{ln('dryerKW', 'Dryer kW', 0.5)}{ln('whVA', 'Water heater VA', 100)}{ln('evVA', 'EV charger VA', 100)}{ln('acVA', 'A/C VA', 100)}{ln('heatVA', 'Electric heat VA', 100)}{ln('otherVA', 'Other VA', 100)}</>
                    : <><label className="prop"><span>Occupancy</span><select value={L.occ} onChange={e => setL({ occ: e.target.value })}>{Object.entries(OCC_VA).map(([k, n]) => <option key={k} value={k}>{k} ({n} VA/sf)</option>)}</select></label>
                      {ln('recept', 'Receptacle outlets')}{ln('motorVA', 'Motor VA (sum)', 100)}{ln('acVA', 'A/C VA', 100)}{ln('heatVA', 'Heat VA', 100)}{ln('kitchenVA', 'Kitchen equipment VA', 100)}{ln('kitchenN', 'Kitchen units')}{ln('evVA', 'EV charger VA', 100)}{ln('otherVA', 'Other VA', 100)}</>}
                </div>
                <table className="table compact"><tbody>
                  {calc.lines.map(([n, va], i) => <tr key={i}><td>{n}</td><td className="num mono">{Math.round(va).toLocaleString()}</td></tr>)}
                  <tr><td><b>Calculated load</b></td><td className="num mono"><b>{Math.round(calc.total).toLocaleString()} VA</b></td></tr>
                  <tr><td><b>Current</b></td><td className="num mono"><b>{calc.amps.toFixed(1)} A</b></td></tr></tbody></table>
                <p className="small">Recommended service / feeder: <b>{calc.service} A</b>{p.main && calc.amps > p.main ? <span className="bad"> — exceeds {p.main} A main</span> : p.bus && calc.amps > p.bus * 0.8 ? <span className="warn"> — over 80% of bus</span> : <span style={{ color: 'var(--ok)' }}> — within {p.main || p.bus} A</span>}</p>
                <p className="muted small">{L.mode === 'dwelling' ? '220.82 applies to single dwellings with ≥100 A service; use the standard method (220.40) for multifamily.' : 'Lighting VA/sf per Table 220.12; the 2023 NEC lowers many of these (LED) — use your adopted edition.'} Planning aid only: verify with your NEC edition and the AHJ.</p>
              </>}
            </fieldset>
          </div>
        </div>
      </div>
    </div>
  );
}
