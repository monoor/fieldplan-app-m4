// Device copy of each project the editor has opened: all records plus the list of edits not yet on the server (the outbox).
// Lives in IndexedDB, so edits survive a closed tab, a reload with no signal or a dead battery. On the next open the
// outbox is replayed over the server's data; if both sides changed a record, the newest edit (this device's) is kept.
import type { ProjectRecord } from '@fieldplan/shared';

export interface LocalRec { id: string; kind: ProjectRecord['kind']; sheetId: string | null; data: Record<string, any>; seq: number } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface LocalState { projectId: string; project?: unknown; seq: number; records: LocalRec[]; dirty: string[]; savedAt: number }

const DB = 'fieldplan-offline', STORE = 'projects';
const open = (): Promise<IDBDatabase> => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'projectId' }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  try { return await new Promise<T>((res, rej) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
  finally { db.close(); }
};

export const saveLocal = (s: LocalState): Promise<void> => tx('readwrite', st => st.put(s)).then(() => undefined);
export async function loadLocal(projectId: string): Promise<LocalState | null> {
  try { return ((await tx('readonly', st => st.get(projectId))) as LocalState | undefined) ?? null; } catch { return null; }
}
export const pendingProjects = async (): Promise<LocalState[]> => { try { return ((await tx('readonly', st => st.getAll())) as LocalState[]).filter(s => s.dirty.length > 0); } catch { return []; } };
/** Forget everything stored on this device (sign-out on a shared tablet). */
export async function clearOffline() {
  try { await tx('readwrite', st => st.clear()); } catch { /* nothing stored */ }
  try { (await navigator.serviceWorker?.ready)?.active?.postMessage('clear'); } catch { /* no service worker (plain http) */ }
}

/**
 * Server snapshot + this device's unsent edits → the records to start from, and which ids are still to be pushed.
 * Records the device changed (or deleted) win; their `seq` is the one the device last saw, so the server counts a conflict
 * if someone else changed them meanwhile and keeps the device's version (last write wins).
 */
export function mergeLocal(server: ProjectRecord[], local: LocalState | null): { records: LocalRec[]; dirty: string[] } {
  const byId = new Map<string, LocalRec>();
  for (const r of server) if (!r.deleted) byId.set(r.id, { id: r.id, kind: r.kind, sheetId: r.sheetId, data: r.data, seq: r.seq });
  const dirty: string[] = [];
  if (local) {
    const mine = new Map(local.records.map(r => [r.id, r]));
    for (const id of local.dirty) {
      const r = mine.get(id);
      if (r) byId.set(id, { ...r }); else byId.delete(id);
      dirty.push(id);
    }
  }
  return { records: [...byId.values()], dirty };
}
