import { describe, expect, it } from 'vitest';
import { mergeLocal, type LocalState } from '../src/editor/offline';
import type { ProjectRecord } from '@fieldplan/shared';

const srv = (id: string, seq: number, data: Record<string, unknown> = {}, deleted = false) => ({ id, kind: 'device', sheetId: 's1', data, seq, deleted }) as unknown as ProjectRecord;
const loc = (records: LocalState['records'], dirty: string[]): LocalState => ({ projectId: 'p', seq: 5, records, dirty, savedAt: 0 });

describe('mergeLocal (offline outbox replay)', () => {
  it('is just the server data when nothing is waiting', () => {
    const m = mergeLocal([srv('a', 3, { x: 1 }), srv('gone', 4, {}, true)], loc([{ id: 'a', kind: 'device', sheetId: 's1', data: { x: 99 }, seq: 2 }], []));
    expect(m.records.map(r => r.id)).toEqual(['a']); expect(m.records[0]!.data.x).toBe(1); expect(m.dirty).toEqual([]);
  });
  it('keeps this device\'s unsent edits over the server, with the seq the device last saw', () => {
    const m = mergeLocal([srv('a', 9, { x: 1 })], loc([{ id: 'a', kind: 'device', sheetId: 's1', data: { x: 42 }, seq: 5 }], ['a']));
    expect(m.records[0]).toMatchObject({ id: 'a', seq: 5, data: { x: 42 } }); expect(m.dirty).toEqual(['a']);
  });
  it('adds records created offline and drops ones deleted offline', () => {
    const m = mergeLocal([srv('keep', 1), srv('del', 2)], loc([{ id: 'keep', kind: 'device', sheetId: 's1', data: {}, seq: 1 }, { id: 'new', kind: 'device', sheetId: 's1', data: { n: 1 }, seq: 0 }], ['new', 'del']));
    expect(m.records.map(r => r.id).sort()).toEqual(['keep', 'new']); expect(m.dirty.sort()).toEqual(['del', 'new']);
  });
  it('works with no server data (opened offline)', () => {
    const m = mergeLocal([], loc([{ id: 'a', kind: 'device', sheetId: 's1', data: {}, seq: 1 }], []));
    expect(m.records).toEqual([]); // the caller uses the device copy directly in that case
  });
});
