// Expiring, read-only client links. The token is shown once; only its SHA-256 is stored. Shared views leave out
// pricing/part numbers and internal device notes.
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, nowIso } from '../db/index.js';
import { HttpError, parse, requirePerm, selfOrigin } from '../http.js';
import { toRecord } from './projects.js';
import type { Ctx } from '../context.js';

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const Create = z.object({ label: z.string().trim().max(120).optional(), sheetId: z.string().max(64).nullable().optional(), days: z.number().int().min(1).max(365).default(14) });
const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/) });

export default async function shareRoutes(app: FastifyInstance, { store: { db }, auth, audit, cfg, files }: Ctx) {
  const project = (id: string) => db.select().from(schema.projects).where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt))).get();

  app.get('/api/projects/:id/shares', { preHandler: requirePerm(auth, 'share:manage') }, async req => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    return db.select({ id: schema.shares.id, label: schema.shares.label, sheetId: schema.shares.sheetId, expiresAt: schema.shares.expiresAt, createdAt: schema.shares.createdAt, revokedAt: schema.shares.revokedAt, lastUsedAt: schema.shares.lastUsedAt, uses: schema.shares.uses })
      .from(schema.shares).where(eq(schema.shares.projectId, id)).orderBy(desc(schema.shares.createdAt)).all();
  });

  app.post('/api/projects/:id/shares', { preHandler: requirePerm(auth, 'share:manage') }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params), b = parse(Create, req.body);
    if (!project(id)) throw new HttpError(404, 'Project not found');
    const token = crypto.randomBytes(32).toString('base64url'), shareId = crypto.randomUUID(), expiresAt = new Date(Date.now() + b.days * 86_400_000).toISOString();
    db.insert(schema.shares).values({ id: shareId, projectId: id, tokenHash: hash(token), label: b.label ?? null, sheetId: b.sheetId ?? null, expiresAt, createdBy: req.user!.id, createdAt: nowIso() }).run();
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'share.create', projectId: id, detail: { share: shareId, days: b.days, sheet: b.sheetId ?? null } });
    return reply.code(201).send({ id: shareId, url: (cfg.publicUrl ?? selfOrigin(req)) + '/s/' + token, expiresAt });
  });

  app.delete('/api/shares/:shareId', { preHandler: requirePerm(auth, 'share:manage') }, async (req, reply) => {
    const { shareId } = parse(z.object({ shareId: z.uuid() }), req.params);
    const s = db.select().from(schema.shares).where(eq(schema.shares.id, shareId)).get(); if (!s) throw new HttpError(404, 'Share not found');
    db.update(schema.shares).set({ revokedAt: nowIso() }).where(eq(schema.shares.id, shareId)).run();
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'share.revoke', projectId: s.projectId, detail: { share: shareId } });
    return reply.code(204).send();
  });

  /** Resolves a token to a usable share or a 404 (same answer for unknown, expired and revoked). */
  function resolve(token: string) {
    const s = db.select().from(schema.shares).where(eq(schema.shares.tokenHash, hash(token))).get();
    if (!s || s.revokedAt || s.expiresAt < nowIso() || !project(s.projectId)) throw new HttpError(404, 'This link is invalid or has expired');
    return s;
  }
  function visible(s: typeof schema.shares.$inferSelect) {
    return db.select().from(schema.records).where(and(eq(schema.records.projectId, s.projectId), eq(schema.records.deleted, false))).all().map(toRecord)
      .filter(r => !s.sheetId || r.kind === 'meta' || (r.kind === 'sheet' ? r.id === s.sheetId : r.sheetId === s.sheetId))
      .map(r => {
        if (r.kind === 'meta') { const { parts: _p, typeDefaults: _t, customTypes: _c, ...rest } = r.data; return { ...r, data: rest }; }
        if (r.kind === 'device') { const { notes: _n, ...rest } = r.data; return { ...r, data: rest }; }
        return r;
      });
  }

  const shareLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  app.get('/api/share/:token', { config: shareLimit }, async req => {
    const { token } = parse(Token, req.params), s = resolve(token), p = project(s.projectId)!;
    const first = !s.lastUsedAt || Date.now() - Date.parse(s.lastUsedAt) > 3_600_000;
    db.update(schema.shares).set({ uses: s.uses + 1, lastUsedAt: nowIso() }).where(eq(schema.shares.id, s.id)).run();
    if (first) audit.log({ ip: req.ip, action: 'share.view', projectId: s.projectId, detail: { share: s.id } });
    return { project: { name: p.name, client: p.client }, label: s.label, sheetId: s.sheetId, expiresAt: s.expiresAt, records: visible(s) };
  });

  // Underlay images of a shared project only
  app.get('/api/share/:token/files/:sha', { config: shareLimit }, async (req, reply) => {
    const { token, sha } = parse(Token.extend({ sha: z.string().regex(/^[a-f0-9]{64}$/) }), req.params), s = resolve(token);
    if (!visible(s).some(r => r.kind === 'underlay' && r.data.fileSha === sha)) throw new HttpError(404, 'Not found');
    const f = files.get(sha); if (!f) throw new HttpError(404, 'Not found');
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(files.pathOf(sha)));
  });
}
