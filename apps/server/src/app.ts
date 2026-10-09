import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { openStore } from './db/index.js';
import { createAuth, migrateAuth } from './auth.js';
import { createAudit } from './audit.js';
import { createFileStore } from './files.js';
import { createSettings } from './settings.js';
import { createClaude } from './import/claude.js';
import { HttpError, authHeaders, selfOrigin } from './http.js';
import type { Ctx } from './context.js';
import projectRoutes from './routes/projects.js';
import shareRoutes from './routes/shares.js';
import fileRoutes from './routes/files.js';
import catalogRoutes from './routes/catalog.js';
import importRoutes from './routes/importer.js';
import systemRoutes from './routes/system.js';

export async function buildApp(cfg: Config, opts: { logger?: boolean } = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
    // A hop count (TRUST_PROXY=1) only believes the address the nearest proxy saw, so clients can't spoof their IP.
    trustProxy: typeof cfg.trustProxy === 'number' ? (_addr: string, hop: number) => hop < (cfg.trustProxy as number) : cfg.trustProxy, bodyLimit: 2 * 1024 * 1024,
  });
  const store = openStore(cfg.dataDir);
  const audit = createAudit(store.db);
  const auth = createAuth(store.sqlite, cfg, audit, app.log);
  await migrateAuth(auth);
  const settings = createSettings(store.db, cfg);
  const ctx: Ctx = { cfg, store, auth, audit, files: createFileStore(store.db, cfg.dataDir), settings, claude: createClaude(store.db, cfg, settings) };
  app.addHook('onClose', async () => { store.sqlite.close(); });

  app.decorateRequest('user', null);
  app.decorateRequest('userLoaded', false);

  // set before any plugin so every route inherits it (Fastify scopes error handlers per plugin)
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...err.extra });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  const https = cfg.secureCookies;
  await app.register(helmet, {
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'], manifestSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
      upgradeInsecureRequests: https ? [] : null, // plain-http LAN must not be told to upgrade
    } },
    hsts: https ? { maxAge: 15_552_000 } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' }, // keeps share-link tokens out of Referer headers
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', keyGenerator: req => req.ip });
  await app.register(multipart, { limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 10 } });

  // Unsafe API calls must come from this site (cookies are SameSite=Lax as well). Better Auth checks its own routes.
  app.addHook('onRequest', async req => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request blocked');
    const origin = req.headers.origin;
    if (origin && ![selfOrigin(req), cfg.publicUrl, ...cfg.trustedOrigins].includes(origin)) throw new HttpError(403, 'Request origin not allowed');
  });

  app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler: async (req, reply) => {
    const init: RequestInit = { method: req.method, headers: authHeaders(req) };
    if (req.method === 'POST' && req.body !== undefined) init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const res = await ctx.auth.handler(new Request(new URL(req.url, selfOrigin(req)), init));
    reply.status(res.status);
    res.headers.forEach((v, k) => { if (k !== 'set-cookie' && k !== 'content-length' && k !== 'content-encoding') reply.header(k, v); });
    const cookies = res.headers.getSetCookie(); if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(res.body ? Buffer.from(await res.arrayBuffer()) : null);
  } });

  for (const r of [systemRoutes, projectRoutes, shareRoutes, fileRoutes, catalogRoutes, importRoutes]) await app.register(r, ctx);


  // The built web app, with client-side routing falling back to index.html
  const webDir = cfg.webDir ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false, setHeaders: (res, p) => res.header('cache-control', p.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache') });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept ?? '').includes('text/html')) return reply.header('cache-control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  } else app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));

  return { app, ctx };
}
