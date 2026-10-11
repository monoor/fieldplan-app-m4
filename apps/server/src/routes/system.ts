// Health, first-run setup, the signed-in user, admin settings and the audit log.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { permissionsOf } from '@fieldplan/shared';
import { HttpError, loadUser, parse, requirePerm } from '../http.js';
import { readRuntime, writeRuntime } from '../config.js';
import { SettingsPatch } from '../settings.js';
import type { Ctx } from '../context.js';

const Setup = z.object({ name: z.string().trim().min(1).max(100), email: z.email().max(200), password: z.string().min(10).max(256) });

export default async function systemRoutes(app: FastifyInstance, { store: { sqlite }, auth, audit, cfg, settings, claude }: Ctx) {
  const userCount = () => (sqlite.prepare('select count(*) as n from "user"').get() as { n: number }).n;

  app.get('/healthz', { logLevel: 'warn' }, async (_req, reply) => { sqlite.prepare('select 1').get(); return reply.type('text/plain').send('ok\n'); });

  app.get('/api/status', async () => ({ app: 'fieldplan', version: cfg.version, setupRequired: userCount() === 0 }));

  // First run only: creates the admin account. Locked as soon as any user exists.
  let settingUp = false;
  app.post('/api/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(Setup, req.body);
    if (settingUp || userCount() > 0) throw new HttpError(409, 'Setup is already complete — sign in instead');
    settingUp = true;
    try {
      await auth.api.createUser({ body: { email: b.email.toLowerCase(), password: b.password, name: b.name, role: 'admin' } });
      audit.log({ action: 'setup.admin-created', userEmail: b.email.toLowerCase(), ip: req.ip });
    } finally { settingUp = false; }
    return reply.code(201).send({ ok: true });
  });

  app.get('/api/me', async req => {
    const u = await loadUser(auth, req); if (!u) throw new HttpError(401, 'Sign in required');
    return { id: u.id, name: u.name, email: u.email, role: u.role, twoFactorEnabled: !!u.twoFactorEnabled, permissions: permissionsOf(u.role) };
  });

  app.get('/api/settings', { preHandler: requirePerm(auth, 'settings:manage') }, async () => ({ ...settings.effective(), claude: claude.status(), version: cfg.version, publicUrl: cfg.publicUrl, trustProxy: cfg.trustProxy, saved: { publicUrl: readRuntime(cfg.dataDir).PUBLIC_URL ?? '', trustProxy: readRuntime(cfg.dataDir).TRUST_PROXY ?? '', hasKey: !!readRuntime(cfg.dataDir).ANTHROPIC_API_KEY } }));
  /** Connection settings stored in /data: they survive container template resets. Public URL and trust proxy apply after a restart. */
  app.put('/api/settings/connection', { preHandler: requirePerm(auth, 'settings:manage') }, async req => {
    const b = parse(z.object({
      publicUrl: z.string().max(300).refine(v => !v || /^https?:\/\/[^\s/]+$/.test(v.trim().replace(/\/$/, '')), 'Use a URL like https://plans.example.com (no path)').optional(),
      trustProxy: z.string().regex(/^(|\d|10|true|false)$/, 'Use a number of proxies (usually 1), or leave empty').optional(),
      anthropicApiKey: z.string().max(300).regex(/^(|sk-ant-[A-Za-z0-9_-]{10,})$/, 'That does not look like an Anthropic API key (sk-ant-…)').optional(),
    }), req.body);
    writeRuntime(cfg.dataDir, { ...(b.publicUrl !== undefined ? { PUBLIC_URL: b.publicUrl.trim().replace(/\/$/, '') } : {}), ...(b.trustProxy !== undefined ? { TRUST_PROXY: b.trustProxy } : {}), ...(b.anthropicApiKey !== undefined ? { ANTHROPIC_API_KEY: b.anthropicApiKey } : {}) });
    if (b.anthropicApiKey !== undefined) cfg.claude.apiKey = readRuntime(cfg.dataDir).ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY?.trim() ?? null;
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'settings.connection', detail: { publicUrl: b.publicUrl, trustProxy: b.trustProxy, anthropicApiKey: b.anthropicApiKey === undefined ? undefined : b.anthropicApiKey ? 'set' : 'cleared' } });
    return { saved: readRuntime(cfg.dataDir).PUBLIC_URL ?? null, restartNeeded: b.publicUrl !== undefined || b.trustProxy !== undefined };
  });
  app.put('/api/settings', { preHandler: requirePerm(auth, 'settings:manage') }, async req => {
    const patch = parse(SettingsPatch, req.body); settings.update(patch);
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'settings.update', detail: patch });
    return settings.effective();
  });

  app.get('/api/audit', { preHandler: requirePerm(auth, 'audit:read') }, async req => {
    const q = parse(z.object({ projectId: z.string().max(64).optional(), before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }), req.query);
    return audit.list(q);
  });

}
