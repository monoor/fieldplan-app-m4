// Projects and record sync. Every write takes the project's next change number (seq); clients pull "everything since N",
// which is what lets an offline tablet catch up. Conflicting edits resolve last-write-wins per record and are reported.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, eq, gt, isNull, sql, count } from 'drizzle-orm';
import { z } from 'zod';
import { PushRequest, checkPut, importLegacyProject, newId, SCHEMA_VERSION, type ProjectRecord, type ProjectSummary, type PushResponse, type RecordKind } from '@fieldplan/shared';
import { schema, nowIso } from '../db/index.js';
import { HttpError, parse, requirePerm } from '../http.js';
import { decodeDataUrl } from '../files.js';
import type { Ctx } from '../context.js';

const Id = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });
const Create = z.object({ name: z.string().trim().min(1).max(200), client: z.string().trim().max(200).optional() });
const Patch = z.object({ name: z.string().trim().min(1).max(200).optional(), client: z.string().trim().max(200).nullable().optional() });

type Row = typeof schema.records.$inferSelect;
export const toRecord = (r: Row): ProjectRecord => ({ id: r.id, kind: r.kind as RecordKind, sheetId: r.sheetId, data: JSON.parse(r.data) as Record<string, unknown>, seq: r.seq, deleted: r.deleted, updatedAt: r.updatedAt, updatedBy: r.updatedBy });

export default async function projectRoutes(app: FastifyInstance, { store: { db }, auth, audit, files }: Ctx) {
  const who = (req: FastifyRequest) => ({ userId: req.user?.id ?? null, userEmail: req.user?.email ?? null, ip: req.ip });
  const live = (id: string) => {
    const p = db.select().from(schema.projects).where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt))).get();
    if (!p) throw new HttpError(404, 'Project not found'); return p;
  };
  const summary = (p: typeof schema.projects.$inferSelect): ProjectSummary => ({ id: p.id, name: p.name, client: p.client, seq: p.seq, createdAt: p.createdAt, updatedAt: p.updatedAt,
    records: db.select({ n: count() }).from(schema.records).where(and(eq(schema.records.projectId, p.id), eq(schema.records.deleted, false))).get()?.n ?? 0 });

  /** Inserts records for a new project inside an open transaction; returns the last seq used. */
  function seed(tx: typeof db, projectId: string, recs: { id: string; kind: RecordKind; sheetId: string | null; data: Record<string, unknown> }[], userId: string | null) {
    const at = nowIso(); let seq = 0;
    for (const r of recs) tx.insert(schema.records).values({ projectId, id: r.id, kind: r.kind, sheetId: r.sheetId, data: JSON.stringify(r.data), seq: ++seq, deleted: false, updatedAt: at, updatedBy: userId }).run();
    return seq;
  }

  app.get('/api/projects', { preHandler: requirePerm(auth, 'project:read') }, async () =>
    db.select().from(schema.projects).where(isNull(schema.projects.deletedAt)).orderBy(sql`${schema.projects.updatedAt} desc`).all().map(summary));

  app.post('/api/projects', { preHandler: requirePerm(auth, 'project:create') }, async (req, reply) => {
    const b = parse(Create, req.body), id = newId(), at = nowIso(), sheetId = newId();
    db.transaction(tx => {
      tx.insert(schema.projects).values({ id, name: b.name, client: b.client ?? null, seq: 0, createdAt: at, updatedAt: at, createdBy: req.user!.id }).run();
      const seq = seed(tx, id, [
        { id: 'meta', kind: 'meta', sheetId: null, data: { name: b.name, client: b.client, scale: 20, gridFt: 1, canvasW: 100, canvasH: 70, schemaVersion: SCHEMA_VERSION } },
        { id: sheetId, kind: 'sheet', sheetId: null, data: { name: 'Floor 1', order: 0 } },
      ], req.user!.id);
      tx.update(schema.projects).set({ seq }).where(eq(schema.projects.id, id)).run();
    });
    audit.log({ ...who(req), action: 'project.create', projectId: id, detail: { name: b.name } });
    return reply.code(201).send(summary(live(id)));
  });

  app.patch('/api/projects/:id', { preHandler: requirePerm(auth, 'project:write') }, async req => {
    const { id } = parse(Id, req.params), b = parse(Patch, req.body); const p = live(id), at = nowIso();
    db.transaction(tx => {
      const meta = tx.select().from(schema.records).where(and(eq(schema.records.projectId, id), eq(schema.records.id, 'meta'))).get();
      const data = { ...(meta ? JSON.parse(meta.data) as object : {}), ...(b.name !== undefined ? { name: b.name } : {}), ...(b.client !== undefined ? { client: b.client ?? undefined } : {}) };
      const seq = p.seq + 1;
      tx.insert(schema.records).values({ projectId: id, id: 'meta', kind: 'meta', sheetId: null, data: JSON.stringify(data), seq, deleted: false, updatedAt: at, updatedBy: req.user!.id })
        .onConflictDoUpdate({ target: [schema.records.projectId, schema.records.id], set: { data: JSON.stringify(data), seq, updatedAt: at, updatedBy: req.user!.id } }).run();
      tx.update(schema.projects).set({ ...(b.name !== undefined ? { name: b.name } : {}), ...(b.client !== undefined ? { client: b.client } : {}), seq, updatedAt: at }).where(eq(schema.projects.id, id)).run();
    });
    audit.log({ ...who(req), action: 'project.update', projectId: id, detail: b });
    return summary(live(id));
  });

  app.delete('/api/projects/:id', { preHandler: requirePerm(auth, 'project:delete') }, async (req, reply) => {
    const { id } = parse(Id, req.params); const p = live(id);
    db.update(schema.projects).set({ deletedAt: nowIso() }).where(eq(schema.projects.id, id)).run();
    audit.log({ ...who(req), action: 'project.delete', projectId: id, detail: { name: p.name } });
    return reply.code(204).send();
  });

  app.get('/api/projects/:id/snapshot', { preHandler: requirePerm(auth, 'project:read') }, async req => {
    const { id } = parse(Id, req.params); const p = live(id);
    const records = db.select().from(schema.records).where(and(eq(schema.records.projectId, id), eq(schema.records.deleted, false))).orderBy(asc(schema.records.seq)).all().map(toRecord);
    return { project: summary(p), seq: p.seq, records };
  });

  app.get('/api/projects/:id/pull', { preHandler: requirePerm(auth, 'project:read') }, async req => {
    const { id } = parse(Id, req.params), { since } = parse(z.object({ since: z.coerce.number().int().min(0).default(0) }), req.query); const p = live(id);
    const records = db.select().from(schema.records).where(and(eq(schema.records.projectId, id), gt(schema.records.seq, since))).orderBy(asc(schema.records.seq)).all().map(toRecord);
    return { seq: p.seq, records };
  });

  app.post('/api/projects/:id/push', { preHandler: requirePerm(auth, 'project:write'), bodyLimit: 32 * 1024 * 1024 }, async req => {
    const { id } = parse(Id, req.params), body = parse(PushRequest, req.body); live(id);
    const errors = body.ops.flatMap(op => (op.op === 'put' ? [checkPut(op)].filter((e): e is string => !!e) : []));
    if (errors.length) throw new HttpError(400, errors.slice(0, 20).join(' | '), { errors: errors.length });
    const userId = req.user!.id, at = nowIso(), kinds: Record<string, number> = {};
    const out: PushResponse = db.transaction(tx => {
      let seq = tx.select({ seq: schema.projects.seq }).from(schema.projects).where(eq(schema.projects.id, id)).get()!.seq;
      const conflicts: PushResponse['conflicts'] = []; let applied = 0;
      const get = (rid: string) => tx.select().from(schema.records).where(and(eq(schema.records.projectId, id), eq(schema.records.id, rid))).get();
      const tombstone = (rid: string) => tx.update(schema.records).set({ deleted: true, seq: ++seq, updatedAt: at, updatedBy: userId }).where(and(eq(schema.records.projectId, id), eq(schema.records.id, rid))).run();
      for (const op of body.ops) {
        const cur = get(op.id);
        if (cur && op.baseSeq !== undefined && cur.seq > op.baseSeq) conflicts.push({ id: op.id, serverSeq: cur.seq });
        if (op.op === 'put') {
          if (cur && !cur.deleted && cur.kind !== op.kind) throw new HttpError(409, 'Record ' + op.id + ' is a ' + cur.kind + ', not a ' + op.kind);
          const data = JSON.stringify(op.data); seq++;
          tx.insert(schema.records).values({ projectId: id, id: op.id, kind: op.kind, sheetId: op.sheetId, data, seq, deleted: false, updatedAt: at, updatedBy: userId })
            .onConflictDoUpdate({ target: [schema.records.projectId, schema.records.id], set: { kind: op.kind, sheetId: op.sheetId, data, seq, deleted: false, updatedAt: at, updatedBy: userId } }).run();
          if (op.kind === 'meta') { const m = op.data as { name?: unknown; client?: unknown };
            tx.update(schema.projects).set({ ...(typeof m.name === 'string' && m.name.trim() ? { name: m.name.trim().slice(0, 200) } : {}), client: typeof m.client === 'string' ? m.client.slice(0, 200) : null }).where(eq(schema.projects.id, id)).run(); }
          kinds['put ' + op.kind] = (kinds['put ' + op.kind] ?? 0) + 1; applied++;
        } else if (cur && !cur.deleted) {
          if (cur.kind === 'meta') throw new HttpError(400, 'The project meta record cannot be deleted');
          tombstone(op.id); applied++; kinds['del ' + cur.kind] = (kinds['del ' + cur.kind] ?? 0) + 1;
          if (cur.kind === 'sheet') for (const child of tx.select({ id: schema.records.id }).from(schema.records).where(and(eq(schema.records.projectId, id), eq(schema.records.sheetId, op.id), eq(schema.records.deleted, false))).all()) tombstone(child.id);
        }
      }
      tx.update(schema.projects).set({ seq, updatedAt: at }).where(eq(schema.projects.id, id)).run();
      return { seq, applied, conflicts };
    });
    audit.log({ ...who(req), action: 'records.push', projectId: id, detail: { ...kinds, ...(out.conflicts.length ? { conflicts: out.conflicts.length } : {}), ...(body.clientId ? { client: body.clientId } : {}) } });
    return out;
  });

  app.get('/api/projects/:id/export', { preHandler: requirePerm(auth, 'project:read') }, async (req, reply) => {
    const { id } = parse(Id, req.params); const p = live(id);
    const records = db.select().from(schema.records).where(and(eq(schema.records.projectId, id), eq(schema.records.deleted, false))).orderBy(asc(schema.records.seq)).all().map(toRecord);
    reply.header('content-disposition', 'attachment; filename="' + p.name.replace(/[^A-Za-z0-9 _-]+/g, '_').slice(0, 80) + '.fieldplan.json"');
    return { format: 'fieldplan-v2', exportedAt: nowIso(), project: { name: p.name, client: p.client }, records: records.map(({ id, kind, sheetId, data }) => ({ id, kind, sheetId, data })) };
  });

  // v1 project JSON (Export JSON from the old app, or a file from its /data/projects) → new project
  app.post('/api/projects/import-v1', { preHandler: requirePerm(auth, 'project:create'), bodyLimit: 200 * 1024 * 1024 }, async (req, reply) => {
    let imp; try { imp = importLegacyProject(req.body); } catch (e) { throw new HttpError(400, (e as Error).message); }
    const warnings = [...imp.warnings], userId = req.user!.id;
    for (const [rid, src] of imp.underlayImages) {
      const rec = imp.records.find(r => r.id === rid)!, bytes = decodeDataUrl(src);
      try { if (!bytes) throw new Error('bad image'); rec.data.fileSha = files.put(bytes, { name: String(rec.data.name ?? 'underlay'), createdBy: userId }).sha256; }
      catch { warnings.push('An underlay image could not be stored'); imp.records = imp.records.filter(r => r.id !== rid); }
    }
    const valid = imp.records.filter(r => { const err = checkPut({ op: 'put', ...r }); if (err) warnings.push('Skipped ' + err); return !err; });
    const id = newId(), at = nowIso(), meta = valid.find(r => r.kind === 'meta')!.data;
    db.transaction(tx => {
      tx.insert(schema.projects).values({ id, name: imp.name, client: typeof meta.client === 'string' ? meta.client : null, seq: 0, createdAt: at, updatedAt: at, createdBy: userId }).run();
      const seq = seed(tx, id, valid, userId);
      tx.update(schema.projects).set({ seq }).where(eq(schema.projects.id, id)).run();
    });
    audit.log({ ...who(req), action: 'project.import-v1', projectId: id, detail: { name: imp.name, records: valid.length, warnings: warnings.length } });
    return reply.code(201).send({ project: summary(live(id)), warnings });
  });
}
