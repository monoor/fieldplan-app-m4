// Panel schedules and NEC 220 load calculations (ported from Fieldplan v1). Pure functions: used by the editor, schedules and tests.
// Planning aid only — verify against the adopted NEC edition and the AHJ.
import { z } from 'zod';

export const BREAKER_TYPES: [string, string][] = [['STD', 'Standard'], ['GFCI', 'GFCI'], ['AFCI', 'AFCI'], ['DF', 'Dual-function (AFCI+GFCI)'], ['EPD', 'GFPE (30 mA)'], ['MAIN', 'Main / feeder']];
export const PANEL_VOLTS: [string, string][] = [['120/240-1', '120/240 V 1Ø (split-phase)'], ['120/208-3', '120/208 V 3Ø wye'], ['277/480-3', '277/480 V 3Ø wye'], ['240-3', '240 V 3Ø delta']];

export const Breaker = z.object({ id: z.string(), slot: z.number().int().min(1).max(200), desc: z.string().max(120), amps: z.number().min(5).max(1200), poles: z.number().int().min(1).max(3), type: z.string().max(8) });
export type Breaker = z.infer<typeof Breaker>;

export interface LoadInputs {
  mode: 'dwelling' | 'commercial'; sqft: number; sa: number; laundry: number; applVA: number; rangeKW: number; dryerKW: number; whVA: number; evVA: number; acVA: number; heatVA: number; otherVA: number;
  occ: string; recept: number; motorVA: number; kitchenVA: number; kitchenN: number;
}
export interface PanelData {
  kind: 'main' | 'sub'; volt: string; bus: number; main: number; spaces: number; aic: number; feederA: number; feedFrom?: string; bkrs: Breaker[]; load?: LoadInputs;
}
export const defaultPanel = (kind: 'main' | 'sub'): PanelData => ({ kind, volt: '120/240-1', bus: kind === 'main' ? 200 : 100, main: kind === 'main' ? 200 : 0, spaces: kind === 'main' ? 40 : 20, aic: 10, feederA: 100, bkrs: [] });
export const defaultLoad = (sqft = 2000): LoadInputs => ({ mode: 'dwelling', sqft, sa: 2, laundry: 1, applVA: 0, rangeKW: 12, dryerKW: 5, whVA: 4500, evVA: 0, acVA: 0, heatVA: 0, otherVA: 0, occ: 'office', recept: 0, motorVA: 0, kitchenVA: 0, kitchenN: 0 });

export interface BreakerPreset { n: string; a: number; p: number; t: string }
export const BREAKER_PRESETS: BreakerPreset[] = [
  { n: 'Lighting', a: 15, p: 1, t: 'AFCI' }, { n: 'Bedroom receptacles', a: 15, p: 1, t: 'AFCI' }, { n: 'General receptacles', a: 20, p: 1, t: 'AFCI' },
  { n: 'Kitchen SABC', a: 20, p: 1, t: 'DF' }, { n: 'Bathroom receptacles', a: 20, p: 1, t: 'GFCI' }, { n: 'Garage / exterior', a: 20, p: 1, t: 'GFCI' },
  { n: 'Dishwasher', a: 15, p: 1, t: 'DF' }, { n: 'Disposal', a: 15, p: 1, t: 'STD' }, { n: 'Microwave', a: 20, p: 1, t: 'STD' }, { n: 'Refrigerator', a: 20, p: 1, t: 'STD' },
  { n: 'Washer', a: 20, p: 1, t: 'GFCI' }, { n: 'Furnace / AHU', a: 15, p: 1, t: 'STD' }, { n: 'Sump / well pump', a: 20, p: 1, t: 'GFCI' },
  { n: 'LV transformer / rack UPS', a: 20, p: 1, t: 'STD' }, { n: 'Network rack (dedicated)', a: 20, p: 1, t: 'STD' }, { n: 'Security / access PSU', a: 15, p: 1, t: 'STD' },
  { n: 'Water heater', a: 30, p: 2, t: 'STD' }, { n: 'Dryer', a: 30, p: 2, t: 'STD' }, { n: 'Range', a: 40, p: 2, t: 'STD' }, { n: 'Range / oven 50A', a: 50, p: 2, t: 'STD' },
  { n: 'EV charger', a: 50, p: 2, t: 'GFCI' }, { n: 'Heat pump / AC condenser', a: 30, p: 2, t: 'STD' }, { n: 'Mini-split', a: 20, p: 2, t: 'STD' }, { n: 'Baseboard heat', a: 20, p: 2, t: 'STD' },
  { n: 'Hot tub', a: 50, p: 2, t: 'GFCI' }, { n: 'Subpanel feeder 60A', a: 60, p: 2, t: 'STD' }, { n: 'Subpanel feeder 100A', a: 100, p: 2, t: 'STD' },
  { n: '3Ø motor / compressor', a: 30, p: 3, t: 'STD' }, { n: '3Ø RTU', a: 60, p: 3, t: 'STD' }, { n: '3Ø subpanel feeder', a: 100, p: 3, t: 'STD' },
];

/** OCPD amps → [min copper THHN/MC 75 °C, min NM-B 60 °C] (NEC 310.16, 240.4). */
export const OCPD_WIRE: Record<number, [string, string]> = { 15: ['14', '14'], 20: ['12', '12'], 25: ['10', '10'], 30: ['10', '10'], 35: ['8', '8'], 40: ['8', '8'], 45: ['8', '6'], 50: ['8', '6'], 60: ['6', '4'], 70: ['4', '4'], 80: ['4', '3'], 90: ['3', '2'], 100: ['3', '1'], 110: ['2', '1'], 125: ['1', '1/0'], 150: ['1/0', '2/0'], 175: ['2/0', '3/0'], 200: ['3/0', '4/0'], 225: ['4/0', '250 kcmil'], 250: ['250 kcmil', '300 kcmil'], 400: ['500 kcmil', '—'] };
/** Dwelling service/feeder (NEC 310.12, 83 %): amps → [Cu, Al]. */
export const SVC_WIRE: Record<number, [string, string]> = { 100: ['4 Cu', '2 Al'], 110: ['3 Cu', '1 Al'], 125: ['2 Cu', '1/0 Al'], 150: ['1 Cu', '2/0 Al'], 175: ['1/0 Cu', '3/0 Al'], 200: ['2/0 Cu', '4/0 Al'], 225: ['3/0 Cu', '250 Al'], 250: ['4/0 Cu', '300 Al'], 300: ['250 Cu', '350 Al'], 350: ['350 Cu', '500 Al'], 400: ['400 Cu', '600 Al'] };
const pickKey = <T,>(tbl: Record<number, T>, amps: number) => { const k = Object.keys(tbl).map(Number).sort((a, b) => a - b).find(x => amps <= x); return k === undefined ? null : { amps: k, w: tbl[k]! }; };
export const wireFor = (amps: number) => pickKey(OCPD_WIRE, amps);
export const svcFor = (amps: number) => pickKey(SVC_WIRE, amps);

export const phasesOf = (volt: string) => (/-3/.test(volt) ? 3 : 2);
export const lineVolts = (volt: string) => Number(volt.split('/').pop()!.split('-')[0]) || 240;

/** Slot map for a panel: slot → breaker index. Two- and three-pole breakers take slots n, n+2, n+4 on the same side. */
export function panelSlots(p: PanelData) {
  const phases = phasesOf(p.volt), map = new Map<number, number>(), conflicts = new Set<number>(), legs = [0, 0, 0];
  const legOf = (slot: number) => (Math.ceil(slot / 2) - 1) % phases;
  p.bkrs.forEach((b, i) => { for (let k = 0; k < b.poles; k++) { const sl = b.slot + 2 * k; if (sl > p.spaces || map.has(sl)) conflicts.add(i); map.set(sl, i); if (b.type !== 'MAIN') legs[legOf(sl)]! += b.amps; } });
  return { map, conflicts, legs, phases, legOf };
}
/** First slot where a breaker with this many poles fits (spaces + 1 when full). */
export function nextSlot(p: PanelData, poles: number): number {
  const { map } = panelSlots(p);
  for (let s = 1; s <= p.spaces; s++) { let ok = true; for (let k = 0; k < poles; k++) if (map.has(s + 2 * k) || s + 2 * k > p.spaces) ok = false; if (ok) return s; }
  return p.spaces + 1;
}

export const OCC_VA: Record<string, number> = { dwelling: 3, office: 3.5, retail: 3, warehouse: 0.25, school: 3, restaurant: 2, hotel: 2, industrial: 2, church: 1, hospital: 2, garage: 0.5 };
export const SERVICE_SIZES = [100, 125, 150, 200, 225, 250, 300, 400, 600, 800];

export function loadCalc(L: LoadInputs, volt: string) {
  const lines: [string, number][] = []; let total = 0;
  if (L.mode === 'dwelling') { // NEC 220.82 optional method
    const gen = 3 * L.sqft + 1500 * L.sa + 1500 * L.laundry + L.applVA + L.rangeKW * 1000 + L.dryerKW * 1000 + L.whVA + L.evVA * 1.25 + L.otherVA;
    const genDem = Math.min(gen, 10000) + Math.max(0, gen - 10000) * 0.4, hvac = Math.max(L.acVA, L.heatVA * 0.65);
    lines.push([`General lighting 3 VA/sf × ${L.sqft}`, 3 * L.sqft], ['Small appliance + laundry', 1500 * L.sa + 1500 * L.laundry], ['Fastened appliances (nameplate)', L.applVA], ['Range / oven', L.rangeKW * 1000], ['Dryer', L.dryerKW * 1000], ['Water heater', L.whVA], ['EV charger × 125%', L.evVA * 1.25], ['Other', L.otherVA], ['Subtotal', gen], ['Demand: 100% first 10 kVA + 40% rest', genDem], ['Larger of A/C (100%) or heat (65%)', hvac]);
    total = genDem + hvac;
  } else { // 220.42-style, non-dwelling
    const vasf = OCC_VA[L.occ] ?? 3, light = L.sqft * vasf * 1.25, recRaw = L.recept * 180, rec = Math.min(recRaw, 10000) + Math.max(0, recRaw - 10000) * 0.5;
    const motors = L.motorVA * 1.25, hvac = Math.max(L.acVA, L.heatVA), kitchen = L.kitchenVA * (L.kitchenN >= 6 ? 0.65 : L.kitchenN >= 3 ? 0.8 : 1), other = L.otherVA + L.evVA * 1.25;
    lines.push([`Lighting ${vasf} VA/sf × ${L.sqft} × 125% cont.`, light], [`Receptacles ${L.recept} × 180 VA (50% over 10 kVA)`, rec], ['Largest motor 125% + others', motors], ['HVAC (larger of heat/cool)', hvac], ['Kitchen equipment (220.56 demand)', kitchen], ['Other + EV × 125%', other]);
    total = light + rec + motors + hvac + kitchen + other;
  }
  const v = lineVolts(volt), threePh = phasesOf(volt) === 3, amps = threePh ? total / (1.732 * v) : total / v;
  const service = SERVICE_SIZES.find(a => a >= amps) ?? Math.ceil(amps / 100) * 100;
  return { lines, total, amps, service };
}

/** Current drawn by `va` through a breaker of this pole count on this system. */
export function breakerAmps(va: number, poles: number, volt: string) {
  const v = lineVolts(volt), perPole = poles >= 2 ? v : phasesOf(volt) === 3 ? v / 1.732 : v / 2;
  return va / (perPole * (poles === 3 ? 1.732 : 1));
}
