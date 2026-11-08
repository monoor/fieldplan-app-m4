// Local copy of one project's records with undo/redo and background sync to the server.
// Edits apply instantly; changed records are pushed in batches (last write wins, conflicts are counted). A pull after each
// push refreshes change numbers and brings in edits from other devices without touching records that are still unsaved.
import { useSyncExternalStore } from 'react';
import type { ProjectRecord, RecordKind, SyncOp } from '@fieldplan/shared';
import { api } from '../api';
import { saveLocal, type LocalRec } from './offline';

export interface Rec { id: string; kind: RecordKind; sheetId: string | null; data: Record<string, any>; seq: number; rev: number } // eslint-disable-line @typescript-eslint/no-explicit-any
type Change = { id: string; before: Rec | null; after: Rec | null };
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
interface PullBody { seq: number; records: ProjectRecord[] }
interface PushBody { seq: number; applied: number; conflicts: { id: string }[] }

export interface Tx {
  put(rec: { id: string; kind: RecordKind; sheetId: string | null; data: Record<string, any> }): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Merge fields into an existing record (undefined removes a field). */
  patch(id: string, fields: Record<string, unknown>): void;
  del(id: string): void;
}

const clone = <T,>(v: T): T => structuredClone(v);
let revCounter = 0;

export class EditorStore {
  recs = new Map<string, Rec>();
  version = 0;
  saveState: SaveState = 'saved';
  lastError = '';
  conflicts = 0;
  private dirty = new Map<string, number>(); // id → token of the latest local change
  private token = 0;
  private undoStack: Change[][] = [];
  private redoStack: Change[][] = [];
  private lastKey = ''; private lastAt = 0;
  private listeners = new Set<() => void>();
  private since = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private retry = 0;
  readonly clientId = Math.random().toString(36).slice(2, 10);

  /** Edits replayed from this device's outbox when the editor opened. */
  restored = 0;
  /** Project summary (name, client) kept with the device copy so the editor can open offline. */
  project: unknown = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  /** `dirty` = ids from this device's outbox that still have to reach the server (their records are already in `snapshot`). */
  constructor(readonly projectId: string, snapshot: { seq: number; records: (ProjectRecord | LocalRec)[] }, dirty: string[] = []) {
    for (const r of snapshot.records) if (!('deleted' in r) || !r.deleted) this.recs.set(r.id, { id: r.id, kind: r.kind, sheetId: r.sheetId, data: r.data, seq: r.seq, rev: ++revCounter });
    this.since = snapshot.seq;
    for (const id of dirty) this.dirty.set(id, ++this.token);
    this.restored = dirty.length;
    if (dirty.length) { this.saveState = 'dirty'; this.timer = setTimeout(() => void this.flush(), 300); }
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
  }
  private onOnline = () => { this.retry = 0; if (this.dirty.size) void this.flush(); else void this.refresh(); };
  get offline() { return typeof navigator !== 'undefined' && navigator.onLine === false; }
  get pending() { return this.dirty.size; }

  /** Keep the device copy current (debounced): all records and the outbox. */
  private persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => { void this.persistNow(); }, 250);
  }
  async persistNow() {
    clearTimeout(this.persistTimer);
    const records: LocalRec[] = [...this.recs.values()].map(r => ({ id: r.id, kind: r.kind, sheetId: r.sheetId, data: r.data, seq: r.seq }));
    try { await saveLocal({ projectId: this.projectId, project: this.project, seq: this.since, records, dirty: [...this.dirty.keys()], savedAt: Date.now() }); } catch { /* private mode / quota: still works online */ }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get(id: string) { return this.recs.get(id); }
  all(): Rec[] { return [...this.recs.values()]; }
  ofSheet(sheetId: string): Rec[] { return this.all().filter(r => r.sheetId === sheetId); }
  sheets(): Rec[] { return this.all().filter(r => r.kind === 'sheet').sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0)); }
  meta(): Rec | undefined { return this.recs.get('meta'); }

  /** Run edits as one undo step. Edits with the same `key` within a second merge into one step (sliders, dragging). */
  edit(fn: (tx: Tx) => void, key = '') {
    const changes = new Map<string, Change>();
    const touch = (id: string) => { let c = changes.get(id); if (!c) { const cur = this.recs.get(id); c = { id, before: cur ? clone(cur) : null, after: null }; changes.set(id, c); } return c; };
    const tx: Tx = {
      put: r => { touch(r.id); this.recs.set(r.id, { ...r, data: clone(r.data), seq: this.recs.get(r.id)?.seq ?? 0, rev: ++revCounter }); },
      patch: (id, fields) => {
        const cur = this.recs.get(id); if (!cur) return; touch(id);
        const data = { ...cur.data }; for (const [k, v] of Object.entries(fields)) { if (v === undefined) delete data[k]; else data[k] = v; }
        this.recs.set(id, { ...cur, data, rev: ++revCounter });
      },
      del: id => {
        const cur = this.recs.get(id); if (!cur) return;
        const kill = (rid: string) => { const r = this.recs.get(rid); if (!r) return; touch(rid); this.recs.delete(rid); };
        kill(id);
        if (cur.kind === 'sheet') for (const r of this.all()) if (r.sheetId === id) kill(r.id);
        if (cur.kind === 'wall') for (const r of this.all()) if (r.kind === 'opening' && r.data.wallId === id) kill(r.id);
        if (cur.kind === 'device') for (const r of this.all()) if (r.kind === 'cable' && (r.data.from === id || r.data.to === id)) {
          touch(r.id); const d = { ...r.data }; if (d.from === id) { d.from = null; delete d.fromPort; } if (d.to === id) { d.to = null; delete d.toPort; } this.recs.set(r.id, { ...r, data: d, rev: ++revCounter });
        }
      },
    };
    fn(tx);
    const list: Change[] = [];
    for (const c of changes.values()) { c.after = this.recs.get(c.id) ? clone(this.recs.get(c.id)!) : null; if (JSON.stringify(c.before?.data) !== JSON.stringify(c.after?.data) || !!c.before !== !!c.after || c.before?.sheetId !== c.after?.sheetId) list.push(c); }
    if (!list.length) return;
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastAt < 1000 && this.undoStack.length) {
      const top = this.undoStack[this.undoStack.length - 1]!;
      for (const c of list) { const prev = top.find(t => t.id === c.id); if (prev) prev.after = c.after; else top.push(c); }
    } else this.undoStack.push(list);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.lastKey = key; this.lastAt = now; this.redoStack = [];
    for (const c of list) this.markDirty(c.id);
    this.emit();
  }

  undo() { const s = this.undoStack.pop(); if (!s) return; this.apply(s, 'before'); this.redoStack.push(s); this.lastKey = ''; }
  redo() { const s = this.redoStack.pop(); if (!s) return; this.apply(s, 'after'); this.undoStack.push(s); this.lastKey = ''; }
  private apply(changes: Change[], side: 'before' | 'after') {
    for (const c of changes) {
      const target = c[side]; const cur = this.recs.get(c.id);
      if (target) this.recs.set(c.id, { ...clone(target), seq: cur?.seq ?? target.seq, rev: ++revCounter }); else this.recs.delete(c.id);
      this.markDirty(c.id);
    }
    this.emit();
  }

  // ---- sync ----
  private markDirty(id: string) { this.dirty.set(id, ++this.token); this.persist(); this.setState('dirty'); clearTimeout(this.timer); this.timer = setTimeout(() => void this.flush(), 700 * Math.min(8, 1 + this.retry)); }
  private setState(s: SaveState, err = '') { this.saveState = s; this.lastError = err; }
  get unsaved() { return this.dirty.size > 0; }

  async flush(): Promise<void> {
    if (this.flushing) return; if (!this.dirty.size) { this.setState('saved'); this.emit(); return; }
    this.flushing = true; clearTimeout(this.timer);
    const sent = new Map(this.dirty), ops: SyncOp[] = [];
    for (const id of sent.keys()) {
      const r = this.recs.get(id);
      if (r) ops.push({ op: 'put', id, kind: r.kind, sheetId: r.sheetId, data: r.data, ...(r.seq > 0 ? { baseSeq: r.seq } : {}) });
      else ops.push({ op: 'del', id });
    }
    this.setState('saving'); this.emit();
    try {
      for (let i = 0; i < ops.length; i += 2000) {
        const res = await api<PushBody>('/api/projects/' + this.projectId + '/push', { method: 'POST', json: { clientId: this.clientId, ops: ops.slice(i, i + 2000) } });
        this.conflicts += res.conflicts.length;
      }
      for (const [id, tok] of sent) if (this.dirty.get(id) === tok) this.dirty.delete(id);
      this.retry = 0; this.persist(); await this.pull();
      this.setState(this.dirty.size ? 'dirty' : 'saved');
    } catch (e) {
      const status = (e as { status?: number }).status;
      this.retry++; this.setState('error', status === 400 ? 'The server rejected an edit: ' + (e as Error).message : (e as Error).message || 'Offline');
      if (status !== 400 && status !== 401 && status !== 403) this.timer = setTimeout(() => void this.flush(), 4000 * Math.min(8, this.retry));
    } finally { this.flushing = false; this.emit(); if (this.dirty.size && this.saveState !== 'error') this.timer = setTimeout(() => void this.flush(), 300); }
  }

  /** Bring in changes made elsewhere (and fresh change numbers for our own saved records). */
  async pull() {
    const res = await api<PullBody>('/api/projects/' + this.projectId + '/pull?since=' + this.since);
    let changed = false;
    for (const r of res.records) {
      if (this.dirty.has(r.id)) continue;
      const cur = this.recs.get(r.id);
      if (r.deleted) { if (cur) { this.recs.delete(r.id); changed = true; } continue; }
      if (cur && cur.seq === r.seq) continue;
      const same = cur && JSON.stringify(cur.data) === JSON.stringify(r.data) && cur.sheetId === r.sheetId;
      this.recs.set(r.id, same ? { ...cur, seq: r.seq } : { id: r.id, kind: r.kind, sheetId: r.sheetId, data: r.data, seq: r.seq, rev: ++revCounter });
      if (!same) changed = true;
    }
    this.since = res.seq; this.persist(); if (changed) this.emit();
  }
  /** Poll for other devices' edits while nothing local is waiting. */
  async refresh() { if (!this.dirty.size && !this.flushing) { try { await this.pull(); } catch { /* offline: try again later */ } } }
  dispose() { clearTimeout(this.timer); if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline); void this.persistNow(); }
}

export function useStoreVersion(store: EditorStore) { return useSyncExternalStore(store.subscribe, store.getVersion); }
