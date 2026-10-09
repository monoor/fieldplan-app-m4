// Converts a Fieldplan v1 project (the single-file HTML app's JSON: Export JSON, or /data/projects/*.json from the v1
// container) into v2 records. Pure: underlay images come back as data URLs for the server to move into the file store.
import { newId } from './ids.js';
import { DATA_SCHEMAS, SHEET_KINDS, SCHEMA_VERSION, type RecordKind } from './model.js';

export interface ImportedRecord { id: string; kind: RecordKind; sheetId: string | null; data: Record<string, unknown> }
export interface LegacyImport {
  name: string;
  records: ImportedRecord[];
  /** Underlay records whose image still needs storing: record id → data URL. */
  underlayImages: Map<string, string>;
  warnings: string[];
}

const V1_COLLECTIONS: Record<string, RecordKind> = {
  walls: 'wall', openings: 'opening', surfaces: 'surface', devices: 'device', cables: 'cable',
  bundles: 'bundle', labels: 'label', dims: 'dim',
};
const ID_OK = /^[A-Za-z0-9_:.-]{1,64}$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isLegacyProject(v: unknown): boolean {
  return isObj(v) && isObj(v.meta) && (Array.isArray(v.sheets) || Array.isArray(v.devices) || Array.isArray(v.walls));
}

export function importLegacyProject(raw: unknown): LegacyImport {
  if (!isLegacyProject(raw)) throw new Error('Not a Fieldplan v1 project (expected meta and sheets)');
  const v1 = raw as Obj, meta = v1.meta as Obj, warnings: string[] = [];
  const records: ImportedRecord[] = [], underlayImages = new Map<string, string>(), used = new Set<string>(['meta']);
  const take = (want: unknown): string => { let id = typeof want === 'string' && ID_OK.test(want) && !used.has(want) ? want : newId(); while (used.has(id)) id = newId(); used.add(id); return id; };

  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 200) : 'Imported project';
  const metaData: Obj = { ...meta, name, schemaVersion: SCHEMA_VERSION, importedFrom: 'fieldplan-v1' };
  if (isObj(v1.layers)) metaData.layers = Object.fromEntries(Object.entries(v1.layers).filter(([, b]) => typeof b === 'boolean'));
  records.push({ id: 'meta', kind: 'meta', sheetId: null, data: metaData });

  // oldest v1 files kept the entity arrays at the top level instead of in sheets
  const sheets: Obj[] = Array.isArray(v1.sheets) ? (v1.sheets as unknown[]).filter(isObj) : [{ ...v1, name: 'Floor 1' }];
  sheets.forEach((sh, order) => {
    const sheetId = take(sh.id), map = new Map<string, string>(); // v1 ids repeat across duplicated sheets → remap per sheet
    records.push({ id: sheetId, kind: 'sheet', sheetId: null, data: { name: typeof sh.name === 'string' ? sh.name : 'Sheet ' + (order + 1), order } });
    const pending: ImportedRecord[] = [];
    for (const [coll, kind] of Object.entries(V1_COLLECTIONS)) {
      const list = sh[coll]; if (!Array.isArray(list)) continue;
      for (const ent of list) { if (!isObj(ent)) continue;
        const { id: oldId, ...data } = ent; const id = take(oldId); if (typeof oldId === 'string') map.set(oldId, id);
        pending.push({ id, kind, sheetId, data }); }
    }
    const ref = (v: unknown) => (typeof v === 'string' && map.has(v) ? map.get(v)! : v);
    for (const r of pending) {
      const d = r.data;
      if (r.kind === 'opening') d.wallId = ref(d.wallId);
      if (r.kind === 'cable') { d.from = d.from ? ref(d.from) : null; d.to = d.to ? ref(d.to) : null; }
      if (r.kind === 'device') { if (isObj(d.feed) && d.feed.src) d.feed = { ...d.feed, src: ref(d.feed.src) }; if (d.poeFrom) d.poeFrom = ref(d.poeFrom); }
      const check = DATA_SCHEMAS[r.kind].safeParse(d);
      if (!check.success) { warnings.push('Skipped ' + r.kind + ' ' + r.id + ' on "' + (sh.name ?? '') + '": ' + check.error.issues[0]?.message); continue; }
      records.push(r);
    }
    const u = sh.underlay;
    if (isObj(u) && typeof u.src === 'string') {
      const { src, ...rest } = u; const uid = take(undefined);
      if (/^data:image\/(png|jpe?g|webp);base64,/.test(src)) { underlayImages.set(uid, src); records.push({ id: uid, kind: 'underlay', sheetId, data: rest }); }
      else warnings.push('Underlay on "' + (sh.name ?? '') + '" was not an embedded PNG/JPEG/WebP and was skipped');
    }
  });
  if (records.filter(r => (SHEET_KINDS as readonly string[]).includes(r.kind)).length === 0) warnings.push('The project has no drawn items');
  return { name, records, underlayImages, warnings };
}
