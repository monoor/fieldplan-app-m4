import { describe, expect, it } from 'vitest';
import { breakerAmps, defaultLoad, defaultPanel, loadCalc, nextSlot, panelSlots, svcFor, wireFor } from '../src/electrical.js';

const bk = (id: string, slot: number, poles = 1, amps = 20) => ({ id, slot, desc: id, amps, poles, type: 'STD' });
describe('panel slots', () => {
  it('two-pole breakers take slots n and n+2 and sit on different legs', () => {
    const p = { ...defaultPanel('main'), bkrs: [bk('a', 1, 2, 30)] }, s = panelSlots(p);
    expect([...s.map.keys()].sort()).toEqual([1, 3]); expect(s.legs.slice(0, 2)).toEqual([30, 30]);
  });
  it('flags overlaps and overflow', () => {
    const p = { ...defaultPanel('sub'), spaces: 4, bkrs: [bk('a', 1), bk('b', 1), bk('c', 4, 2)] };
    expect([...panelSlots(p).conflicts].sort()).toEqual([1, 2]);
  });
  it('finds the next free slot for a 2-pole breaker', () => {
    const p = { ...defaultPanel('main'), bkrs: [bk('a', 1), bk('b', 2), bk('c', 3)] };
    expect(nextSlot(p, 1)).toBe(4); expect(nextSlot(p, 2)).toBe(4);
  });
  it('three-phase legs rotate A B C every row', () => {
    const p = { ...defaultPanel('main'), volt: '120/208-3', bkrs: [bk('a', 1, 3, 20)] }, s = panelSlots(p);
    expect(s.legs).toEqual([20, 20, 20]);
  });
});
describe('wire and service tables', () => {
  it('picks conductors by OCPD', () => { expect(wireFor(20)?.w[0]).toBe('12'); expect(wireFor(45)?.amps).toBe(45); expect(wireFor(33)?.amps).toBe(35); expect(wireFor(9999)).toBeNull(); });
  it('dwelling service conductors (310.12)', () => { expect(svcFor(200)?.w).toEqual(['2/0 Cu', '4/0 Al']); });
});
describe('NEC 220.82 dwelling load', () => {
  it('2000 sf house with range, dryer, water heater', () => {
    const r = loadCalc({ ...defaultLoad(2000), acVA: 6000 }, '120/240-1');
    // general = 6000 + 3000 + 1500 + 12000 + 5000 + 4500 = 32000 → 10000 + 0.4*22000 = 18800; + 6000 hvac
    expect(r.total).toBeCloseTo(24800, 0); expect(r.amps).toBeCloseTo(103.3, 1); expect(r.service).toBe(125);
  });
  it('heat counts 65 %', () => { const r = loadCalc({ ...defaultLoad(1000), rangeKW: 0, dryerKW: 0, whVA: 0, heatVA: 10000 }, '120/240-1'); expect(r.lines.at(-1)![1]).toBe(6500); });
});
describe('commercial load', () => {
  it('lighting at occupancy VA/sf × 125 % plus receptacles with 50 % over 10 kVA', () => {
    const r = loadCalc({ ...defaultLoad(10000), mode: 'commercial', occ: 'warehouse', recept: 100 }, '120/208-3');
    expect(r.lines[0]![1]).toBeCloseTo(10000 * 0.25 * 1.25); expect(r.lines[1]![1]).toBe(14000);
    expect(r.amps).toBeCloseTo(r.total / (1.732 * 208), 3);
  });
});
describe('breaker current', () => {
  it('1-pole on 120/240 = 120 V, 2-pole = 240 V', () => { expect(breakerAmps(2400, 1, '120/240-1')).toBeCloseTo(20); expect(breakerAmps(4800, 2, '120/240-1')).toBeCloseTo(20); });
});
