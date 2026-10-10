// Project data model. A project is a set of records; each record is one thing on a plan (a wall, a device, a cable …),
// a sheet, or the project meta. Records sync individually, so an offline tablet only exchanges what changed.
// Entity shapes follow Fieldplan v1 so existing projects import as-is; unknown extra fields are kept.
import { z } from 'zod';
import { PortGroup } from './ports.js';

export const RECORD_KINDS = ['meta', 'sheet', 'wall', 'opening', 'surface', 'device', 'cable', 'bundle', 'label', 'dim', 'underlay'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
/** Kinds that live on a sheet (everything except meta and the sheets themselves). */
export const SHEET_KINDS = ['wall', 'opening', 'surface', 'device', 'cable', 'bundle', 'label', 'dim', 'underlay'] as const satisfies readonly RecordKind[];
export const SCHEMA_VERSION = 1;

/** Largest JSON size of one record's data, in bytes. Images and PDFs go to the file store, not into records. */
export const MAX_RECORD_BYTES = 256 * 1024;
export const MAX_OPS_PER_PUSH = 5000;

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_:.-]+$/, 'ids are letters, digits and _ : . -');
const finite = z.number().finite();
export const Point = z.object({ x: finite, y: finite });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const MetaData = z.looseObject({
  name: z.string().max(200),
  scale: finite.positive().default(20),
  gridFt: finite.positive().default(1),
  client: z.string().max(200).optional(),
  drawnBy: z.string().max(200).optional(),
  layers: z.record(z.string(), z.boolean()).optional(),
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
});
export const SheetData = z.looseObject({ name: z.string().max(120), order: z.number().int().default(0) });
export const WallData = z.looseObject({ points: z.array(Point).min(2), mat: z.string().optional(), thick: finite.optional(), label: z.string().optional() });
export const OpeningData = z.looseObject({ kind: z.enum(['door', 'window']), wallId: id, segIndex: z.number().int().min(0), t: finite, width: finite.positive() });
export const SurfaceData = z.looseObject({ points: z.array(Point).min(3), matId: z.string(), label: z.string().optional() });
export const DeviceData = z.looseObject({
  catKey: z.string().min(1), typeId: z.string().min(1), x: finite, y: finite,
  rotation: finite.optional(), tag: z.string().max(40).optional(), label: z.string().max(200).optional(), notes: z.string().max(5000).optional(),
  /** Camera / sensor coverage: field of view in degrees and range in feet (type defaults apply when missing). */
  fov: finite.min(1).max(360).optional(), range: finite.min(1).max(1000).optional(),
  /** Custom inputs / outputs. Generic devices and switches are edited here. */
  ports: z.array(PortGroup).max(40).optional(),
  watts: finite.min(0).optional(), poeBudget: finite.min(0).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export const CableData = z.looseObject({
  points: z.array(Point).min(2), cableType: z.string().min(1), category: z.string().optional(),
  tag: z.string().max(40).optional(), label: z.string().max(200).optional(),
  from: id.nullable().optional(), to: id.nullable().optional(), fromPort: z.string().max(80).optional(), toPort: z.string().max(80).optional(),
});
export const BundleData = z.looseObject({ points: z.array(Point).min(2), label: z.string().optional(), contents: z.string().optional() });
export const LabelData = z.looseObject({ x: finite, y: finite, text: z.string().max(2000) });
export const DimData = z.looseObject({ points: z.array(Point).length(2) });
export const UnderlayData = z.looseObject({
  fileSha: sha256.optional(), x: finite, y: finite, w: finite.positive(), h: finite.positive(),
  opacity: finite.min(0).max(1).optional(), locked: z.boolean().optional(), name: z.string().optional(),
});

export const DATA_SCHEMAS = {
  meta: MetaData, sheet: SheetData, wall: WallData, opening: OpeningData, surface: SurfaceData, device: DeviceData,
  cable: CableData, bundle: BundleData, label: LabelData, dim: DimData, underlay: UnderlayData,
} satisfies Record<RecordKind, z.ZodType>;

export type MetaData = z.infer<typeof MetaData>;
export type DeviceData = z.infer<typeof DeviceData>;
export type CableData = z.infer<typeof CableData>;

export interface ProjectRecord {
  id: string;
  kind: RecordKind;
  sheetId: string | null;
  data: Record<string, unknown>;
  /** Project change number when this record last changed. */
  seq: number;
  deleted: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export const PutOp = z.object({ op: z.literal('put'), id, kind: z.enum(RECORD_KINDS), sheetId: id.nullable().default(null), data: z.record(z.string(), z.unknown()), baseSeq: z.number().int().min(0).optional() });
export const DelOp = z.object({ op: z.literal('del'), id, baseSeq: z.number().int().min(0).optional() });
export const SyncOp = z.discriminatedUnion('op', [PutOp, DelOp]);
export type SyncOp = z.infer<typeof SyncOp>;
export const PushRequest = z.object({ clientId: z.string().max(64).optional(), ops: z.array(SyncOp).min(1).max(MAX_OPS_PER_PUSH) });
export type PushRequest = z.infer<typeof PushRequest>;
export interface PushResponse { seq: number; applied: number; conflicts: { id: string; serverSeq: number }[] }
export interface PullResponse { seq: number; records: ProjectRecord[] }

export interface ProjectSummary { id: string; name: string; client: string | null; seq: number; createdAt: string; updatedAt: string; records: number }

/** Validates a put op's data for its kind and checks size/sheet rules. Returns an error message or null. */
export function checkPut(op: z.infer<typeof PutOp>): string | null {
  const schema = DATA_SCHEMAS[op.kind];
  const r = schema.safeParse(op.data);
  if (!r.success) return op.kind + ' ' + op.id + ': ' + r.error.issues.map(i => (i.path.join('.') || 'data') + ' ' + i.message).join('; ');
  if ((SHEET_KINDS as readonly string[]).includes(op.kind) && !op.sheetId) return op.kind + ' ' + op.id + ': needs a sheetId';
  if (!(SHEET_KINDS as readonly string[]).includes(op.kind) && op.sheetId) return op.kind + ' ' + op.id + ': must not have a sheetId';
  const bytes = new TextEncoder().encode(JSON.stringify(op.data)).length;
  if (bytes > MAX_RECORD_BYTES) return op.kind + ' ' + op.id + ': ' + Math.round(bytes / 1024) + ' KB is over the ' + MAX_RECORD_BYTES / 1024 + ' KB record limit (images and PDFs go in the file store)';
  return null;
}
