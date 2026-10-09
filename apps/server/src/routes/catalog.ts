// The device catalog: vendor models with specs, datasheets, photos and per-source prices.
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { asc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { CatalogItemInput, type CatalogItem } from '@fieldplan/shared';
import { schema, nowIso } from '../db/index.js';
import { HttpError, parse, requirePerm } from '../http.js';
import type { Ctx } from '../context.js';

type Row = typeof schema.catalogItems.$inferSelect;
const toItem = (r: Row): CatalogItem => ({ ...(JSON.parse(r.data) as CatalogItemInput), id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt });

export default async function catalogRoutes(app: FastifyInstance, { store: { db }, auth, audit, files }: Ctx) {
  const Id = z.object({ id: z.uuid() });
  const checkFiles = (i: CatalogItemInput) => { for (const sha of [i.datasheetSha, i.imageSha]) if (sha && !files.get(sha)) throw new HttpError(400, 'Unknown file ' + sha.slice(0, 12)); };
  const dupe = (e: unknown, i: CatalogItemInput) => { if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, i.vendor + ' ' + i.model + ' is already in the catalog'); throw e; };

  app.get('/api/catalog', { preHandler: requirePerm(auth, 'catalog:read') }, async req => {
    const { q } = parse(z.object({ q: z.string().max(100).optional() }), req.query);
    const where = q ? or(like(schema.catalogItems.vendor, '%' + q + '%'), like(schema.catalogItems.model, '%' + q + '%'), like(schema.catalogItems.data, '%' + q + '%')) : undefined;
    return db.select().from(schema.catalogItems).where(where).orderBy(asc(schema.catalogItems.vendor), asc(schema.catalogItems.model)).limit(1000).all().map(toItem);
  });

  app.post('/api/catalog', { preHandler: requirePerm(auth, 'catalog:write') }, async (req, reply) => {
    const i = parse(CatalogItemInput, req.body); checkFiles(i);
    const id = crypto.randomUUID(), at = nowIso();
    try { db.insert(schema.catalogItems).values({ id, vendor: i.vendor, model: i.model, category: i.category, data: JSON.stringify(i), createdAt: at, updatedAt: at, createdBy: req.user!.id }).run(); } catch (e) { dupe(e, i); }
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'catalog.create', detail: { id, vendor: i.vendor, model: i.model } });
    return reply.code(201).send(toItem(db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id)).get()!));
  });

  app.put('/api/catalog/:id', { preHandler: requirePerm(auth, 'catalog:write') }, async req => {
    const { id } = parse(Id, req.params), i = parse(CatalogItemInput, req.body); checkFiles(i);
    try { const r = db.update(schema.catalogItems).set({ vendor: i.vendor, model: i.model, category: i.category, data: JSON.stringify(i), updatedAt: nowIso() }).where(eq(schema.catalogItems.id, id)).run();
      if (!r.changes) throw new HttpError(404, 'Catalog item not found'); } catch (e) { if (e instanceof HttpError) throw e; dupe(e, i); }
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'catalog.update', detail: { id, vendor: i.vendor, model: i.model } });
    return toItem(db.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id)).get()!);
  });

  app.delete('/api/catalog/:id', { preHandler: requirePerm(auth, 'catalog:write') }, async (req, reply) => {
    const { id } = parse(Id, req.params);
    const r = db.delete(schema.catalogItems).where(eq(schema.catalogItems.id, id)).run(); if (!r.changes) throw new HttpError(404, 'Catalog item not found');
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'catalog.delete', detail: { id } });
    return reply.code(204).send();
  });
}
