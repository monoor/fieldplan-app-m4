// Uploads (underlays, photos) and downloads from the file store.
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { HttpError, parse, requirePerm, loadUser } from '../http.js';
import { can } from '@fieldplan/shared';
import type { Ctx } from '../context.js';

export default async function fileRoutes(app: FastifyInstance, { auth, files, audit, cfg }: Ctx) {
  app.post('/api/files', { preHandler: requirePerm(auth, 'file:upload') }, async (req, reply) => {
    const part = await req.file({ limits: { fileSize: cfg.maxUploadBytes, files: 1 } });
    if (!part) throw new HttpError(400, 'No file in the upload');
    const buf = await part.toBuffer().catch((e: { code?: string }) => { throw e.code === 'FST_REQ_FILE_TOO_LARGE' ? new HttpError(413, 'File is too large') : e; });
    const stored = files.put(buf, { name: part.filename, createdBy: req.user!.id });
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'file.upload', detail: { sha256: stored.sha256, mime: stored.mime, size: stored.size } });
    return reply.code(201).send(stored);
  });

  app.get('/api/files/:sha', async (req, reply) => {
    const u = await loadUser(auth, req);
    if (!u) throw new HttpError(401, 'Sign in required');
    if (!can(u.role, 'project:read') && !can(u.role, 'catalog:read')) throw new HttpError(403, 'Not allowed');
    const { sha } = parse(z.object({ sha: z.string().regex(/^[a-f0-9]{64}$/) }), req.params);
    const f = files.get(sha); if (!f) throw new HttpError(404, 'File not found');
    const name = (f.name ?? sha.slice(0, 12)).replace(/[^A-Za-z0-9._ -]+/g, '_');
    reply.header('content-type', f.mime).header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition', (f.mime === 'application/pdf' || f.mime.startsWith('image/') ? 'inline' : 'attachment') + '; filename="' + name + '"');
    // Browsers' built-in PDF viewers need to embed the file itself; nothing else is allowed to load.
    if (f.mime === 'application/pdf') reply.header('content-security-policy', "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'");
    return reply.send(fs.createReadStream(files.pathOf(sha)));
  });
}
