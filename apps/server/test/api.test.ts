import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

const HOST = 'fp.test', ORIGIN = 'http://fp.test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let app: FastifyInstance, dir: string;
const jar: Record<string, string> = {};

type Opts = { method?: string; url: string; body?: unknown; as?: string; origin?: string | null; headers?: Record<string, string> };
async function call(o: Opts): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = { host: HOST, ...(o.headers ?? {}) };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.as && jar[o.as]) headers.cookie = jar[o.as]!;
  const res = await app.inject({ method: (o.method ?? 'GET') as 'GET', url: o.url, headers, ...(o.body !== undefined ? { payload: o.body as object } : {}) });
  return res;
}
async function signIn(who: string, email: string, password: string) {
  const res = await call({ method: 'POST', url: '/api/auth/sign-in/email', body: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  jar[who] = ([] as string[]).concat(res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-api-'));
  ({ app } = await buildApp(loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv), { logger: false }));
});
afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('first run and sign-in', () => {
  it('reports setup required', async () => { expect((await call({ url: '/api/status' })).json()).toMatchObject({ app: 'fieldplan', setupRequired: true }); });
  it('rejects weak setup input', async () => { expect((await call({ method: 'POST', url: '/api/setup', body: { name: 'M', email: 'm@x.io', password: 'short' } })).statusCode).toBe(400); });
  it('creates the admin once', async () => {
    expect((await call({ method: 'POST', url: '/api/setup', body: { name: 'Mo', email: 'Mo@Example.com', password: 'correct horse battery' } })).statusCode).toBe(201);
    expect((await call({ method: 'POST', url: '/api/setup', body: { name: 'X', email: 'x@example.com', password: 'another long password' } })).statusCode).toBe(409);
    expect((await call({ url: '/api/status' })).json().setupRequired).toBe(false);
  });
  it('signs in and reports the role', async () => {
    await signIn('admin', 'mo@example.com', 'correct horse battery');
    const me = (await call({ url: '/api/me', as: 'admin' })).json();
    expect(me).toMatchObject({ email: 'mo@example.com', role: 'admin' }); expect(me.permissions).toContain('user:manage');
  });
  it('refuses wrong passwords and signed-out access', async () => {
    expect((await call({ method: 'POST', url: '/api/auth/sign-in/email', body: { email: 'mo@example.com', password: 'nope nope nope' } })).statusCode).toBe(401);
    expect((await call({ url: '/api/projects' })).statusCode).toBe(401);
  });
  it('blocks cross-site sign-in and API writes', async () => {
    expect((await call({ method: 'POST', url: '/api/auth/sign-in/email', body: { email: 'mo@example.com', password: 'correct horse battery' }, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call({ method: 'POST', url: '/api/projects', body: { name: 'x' }, as: 'admin', origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await call({ method: 'POST', url: '/api/projects', body: { name: 'x' }, as: 'admin', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode).toBe(403);
  });
  it('sends security headers without forcing https on a LAN', async () => {
    const h = (await call({ url: '/api/status' })).headers;
    expect(String(h['content-security-policy'])).toContain("script-src 'self'");
    expect(String(h['content-security-policy'])).not.toContain('upgrade-insecure-requests');
    expect(h['x-content-type-options']).toBe('nosniff'); expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['strict-transport-security']).toBeUndefined();
  });
});

let projectId = '', sheetId = '', seqAfterCreate = 0;
describe('projects and sync', () => {
  it('creates a project with meta and a sheet', async () => {
    const res = await call({ method: 'POST', url: '/api/projects', body: { name: 'Front Royal plant', client: 'Ice cream co' }, as: 'admin' });
    expect(res.statusCode).toBe(201); projectId = res.json().id;
    const snap = (await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'admin' })).json();
    expect(snap.records.map((r: { kind: string }) => r.kind).sort()).toEqual(['meta', 'sheet']);
    sheetId = snap.records.find((r: { kind: string }) => r.kind === 'sheet').id; seqAfterCreate = snap.seq;
  });
  it('pushes records and pulls changes since a seq', async () => {
    const ops = [
      { op: 'put', id: 'd1', kind: 'device', sheetId, data: { catKey: 'camera', typeId: 'cam-dome', x: 10, y: 20, tag: 'CD-01' } },
      { op: 'put', id: 'd2', kind: 'device', sheetId, data: { catKey: 'network', typeId: 'poe-sw', x: 100, y: 20, tag: 'SW-01' } },
      { op: 'put', id: 'c1', kind: 'cable', sheetId, data: { cableType: 'cat6', from: 'd1', to: 'd2', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] } },
    ];
    const res = await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops }, as: 'admin' });
    expect(res.statusCode, res.body).toBe(200); expect(res.json()).toMatchObject({ applied: 3, conflicts: [], seq: seqAfterCreate + 3 });
    const pull = (await call({ url: '/api/projects/' + projectId + '/pull?since=' + seqAfterCreate, as: 'admin' })).json();
    expect(pull.records.map((r: { id: string }) => r.id)).toEqual(['d1', 'd2', 'c1']);
    expect((await call({ url: '/api/projects/' + projectId + '/pull?since=' + pull.seq, as: 'admin' })).json().records).toEqual([]);
  });
  it('reports conflicts and keeps the latest write', async () => {
    const res = await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'put', id: 'd1', kind: 'device', sheetId, baseSeq: seqAfterCreate, data: { catKey: 'camera', typeId: 'cam-dome', x: 11, y: 21 } }] }, as: 'admin' });
    expect(res.json().conflicts).toHaveLength(1);
    const snap = (await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'admin' })).json();
    expect(snap.records.find((r: { id: string }) => r.id === 'd1').data.x).toBe(11);
  });
  it('rejects invalid records and kind changes atomically', async () => {
    const before = (await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'admin' })).json().seq;
    expect((await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'put', id: 'bad', kind: 'wall', sheetId, data: { points: [{ x: 0, y: 0 }] } }] }, as: 'admin' })).statusCode).toBe(400);
    const kindSwap = await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'put', id: 'z9', kind: 'label', sheetId, data: { x: 0, y: 0, text: 'a' } }, { op: 'put', id: 'd2', kind: 'label', sheetId, data: { x: 0, y: 0, text: 'b' } }] }, as: 'admin' });
    expect(kindSwap.statusCode).toBe(409);
    const after = (await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'admin' })).json();
    expect(after.seq).toBe(before); expect(after.records.some((r: { id: string }) => r.id === 'z9')).toBe(false);
  });
  it('deleting a sheet removes what is on it', async () => {
    const res = await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'put', id: 's2', kind: 'sheet', data: { name: 'Roof', order: 1 } }, { op: 'put', id: 'r1', kind: 'label', sheetId: 's2', data: { x: 1, y: 1, text: 'RTU' } }] }, as: 'admin' });
    expect(res.statusCode).toBe(200);
    await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'del', id: 's2' }] }, as: 'admin' });
    const snap = (await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'admin' })).json();
    expect(snap.records.some((r: { id: string }) => r.id === 'r1' || r.id === 's2')).toBe(false);
    const tomb = (await call({ url: '/api/projects/' + projectId + '/pull?since=0', as: 'admin' })).json().records.find((r: { id: string }) => r.id === 'r1');
    expect(tomb.deleted).toBe(true);
  });
  it('renames through meta and lists projects', async () => {
    await call({ method: 'PATCH', url: '/api/projects/' + projectId, body: { name: 'Front Royal — line 2' }, as: 'admin' });
    const list = (await call({ url: '/api/projects', as: 'admin' })).json();
    expect(list[0]).toMatchObject({ id: projectId, name: 'Front Royal — line 2', client: 'Ice cream co' });
  });
});

describe('v1 import', () => {
  it('imports a v1 project with an underlay image', async () => {
    const v1 = { meta: { name: 'Old shop', scale: 20, gridFt: 1, parts: { 'cab:cat6': { pn: 'C6', price: 0.3 } } }, layers: { grid: true },
      sheets: [{ id: 'sA', name: 'Floor 1', walls: [{ id: 'w1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }], devices: [{ id: 'p', catKey: 'electrical', typeId: 'panel', x: 1, y: 1 }],
        underlay: { src: 'data:image/png;base64,' + PNG.toString('base64'), x: 0, y: 0, w: 200, h: 100, opacity: 0.5 } }] };
    const res = await call({ method: 'POST', url: '/api/projects/import-v1', body: v1, as: 'admin' });
    expect(res.statusCode, res.body).toBe(201);
    const { project, warnings } = res.json(); expect(warnings).toEqual([]);
    const snap = (await call({ url: '/api/projects/' + project.id + '/snapshot', as: 'admin' })).json();
    const u = snap.records.find((r: { kind: string }) => r.kind === 'underlay');
    expect(u.data.fileSha).toMatch(/^[a-f0-9]{64}$/);
    const img = await call({ url: '/api/files/' + u.data.fileSha, as: 'admin' });
    expect(img.statusCode).toBe(200); expect(img.headers['content-type']).toBe('image/png');
    expect((await call({ method: 'POST', url: '/api/projects/import-v1', body: { hello: 1 }, as: 'admin' })).statusCode).toBe(400);
  });
});

describe('roles', () => {
  it('admin creates a viewer and a designer', async () => {
    for (const [email, role] of [['viewer@example.com', 'viewer'], ['designer@example.com', 'designer']]) {
      const res = await call({ method: 'POST', url: '/api/auth/admin/create-user', body: { email, password: 'long enough password', name: role, role }, as: 'admin' });
      expect(res.statusCode, res.body).toBe(200);
    }
    await signIn('viewer', 'viewer@example.com', 'long enough password');
    await signIn('designer', 'designer@example.com', 'long enough password');
  });
  it('viewer can read but not write', async () => {
    expect((await call({ url: '/api/projects/' + projectId + '/snapshot', as: 'viewer' })).statusCode).toBe(200);
    expect((await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'del', id: 'd1' }] }, as: 'viewer' })).statusCode).toBe(403);
    expect((await call({ method: 'POST', url: '/api/projects', body: { name: 'nope' }, as: 'viewer' })).statusCode).toBe(403);
  });
  it('designer edits but cannot manage users, settings or delete projects', async () => {
    expect((await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [{ op: 'put', id: 'l9', kind: 'label', sheetId, data: { x: 1, y: 1, text: 'by designer' } }] }, as: 'designer' })).statusCode).toBe(200);
    expect((await call({ method: 'POST', url: '/api/auth/admin/create-user', body: { email: 'z@example.com', password: 'long enough password', name: 'z' }, as: 'designer' })).statusCode).toBe(403);
    expect((await call({ url: '/api/settings', as: 'designer' })).statusCode).toBe(403);
    expect((await call({ method: 'DELETE', url: '/api/projects/' + projectId, as: 'designer' })).statusCode).toBe(403);
    expect((await call({ url: '/api/audit', as: 'designer' })).statusCode).toBe(403);
  });
});

describe('share links', () => {
  let url = '';
  it('creates a link that shows the drawing without prices or notes', async () => {
    await call({ method: 'POST', url: '/api/projects/' + projectId + '/push', body: { ops: [
      { op: 'put', id: 'meta', kind: 'meta', data: { name: 'Front Royal — line 2', scale: 20, gridFt: 1, parts: { x: { price: 99 } } } },
      { op: 'put', id: 'd2', kind: 'device', sheetId, data: { catKey: 'network', typeId: 'poe-sw', x: 100, y: 20, notes: 'gate code 1234' } }] }, as: 'admin' });
    const res = await call({ method: 'POST', url: '/api/projects/' + projectId + '/shares', body: { label: 'Client review', days: 7 }, as: 'designer' });
    expect(res.statusCode).toBe(201); url = res.json().url; expect(url).toMatch(/^http:\/\/fp\.test\/s\/[A-Za-z0-9_-]{43}$/);
    const view = await call({ url: '/api/share/' + url.split('/s/')[1], origin: null });
    expect(view.statusCode).toBe(200);
    const recs = view.json().records;
    expect(recs.find((r: { kind: string }) => r.kind === 'meta').data.parts).toBeUndefined();
    expect(recs.find((r: { id: string }) => r.id === 'd2').data.notes).toBeUndefined();
  });
  it('stops working when revoked', async () => {
    const list = (await call({ url: '/api/projects/' + projectId + '/shares', as: 'admin' })).json();
    expect(list[0]).toMatchObject({ label: 'Client review', uses: 1 }); expect(list[0].tokenHash).toBeUndefined();
    expect((await call({ method: 'DELETE', url: '/api/shares/' + list[0].id, as: 'admin' })).statusCode).toBe(204);
    expect((await call({ url: '/api/share/' + url.split('/s/')[1], origin: null })).statusCode).toBe(404);
    expect((await call({ url: '/api/share/' + 'A'.repeat(43), origin: null })).statusCode).toBe(404);
  });
});

describe('files and catalog', () => {
  const form = (name: string, type: string, body: Buffer) => {
    const b = '----fp' + Date.now();
    return { payload: Buffer.concat([Buffer.from('--' + b + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + type + '\r\n\r\n'), body, Buffer.from('\r\n--' + b + '--\r\n')]), ct: 'multipart/form-data; boundary=' + b };
  };
  it('accepts images by their bytes and refuses HTML/SVG', async () => {
    const ok = form('photo.png', 'text/html', PNG);
    const r1 = await app.inject({ method: 'POST', url: '/api/files', headers: { host: HOST, origin: ORIGIN, cookie: jar.designer!, 'content-type': ok.ct }, payload: ok.payload });
    expect(r1.statusCode, r1.body).toBe(201); expect(r1.json().mime).toBe('image/png');
    const bad = form('evil.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'));
    const r2 = await app.inject({ method: 'POST', url: '/api/files', headers: { host: HOST, origin: ORIGIN, cookie: jar.designer!, 'content-type': bad.ct }, payload: bad.payload });
    expect(r2.statusCode).toBe(415);
  });
  it('stores catalog items with several prices and refuses duplicates', async () => {
    const item = { vendor: 'UniFi', model: 'G6 Turret', category: 'camera', typeKey: 'cam-dome', specs: { hfovDeg: 110, maxPowerW: 12.5 }, prices: [{ source: 'ADI', price: 199 }, { source: 'UI Store', price: 179 }] };
    const r = await call({ method: 'POST', url: '/api/catalog', body: item, as: 'designer' });
    expect(r.statusCode, r.body).toBe(201); expect(r.json().prices).toHaveLength(2);
    expect((await call({ method: 'POST', url: '/api/catalog', body: item, as: 'designer' })).statusCode).toBe(409);
    expect((await call({ url: '/api/catalog?q=turret', as: 'viewer' })).json()).toHaveLength(1);
    expect((await call({ method: 'POST', url: '/api/catalog', body: item, as: 'viewer' })).statusCode).toBe(403);
  });
});

describe('import and settings', () => {
  it('reports Claude as not configured and refuses datasheet extraction', async () => {
    expect((await call({ url: '/api/import/status', as: 'viewer' })).json().claude).toMatchObject({ configured: false, enabled: false });
    const sha = 'a'.repeat(64);
    expect((await call({ method: 'POST', url: '/api/import/datasheet', body: { sha256: sha }, as: 'designer' })).statusCode).toBe(404);
  });
  it('refuses private, local and non-http import targets', async () => {
    for (const url of ['http://127.0.0.1/x', 'http://10.0.0.5/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://localhost:8080/', 'file:///etc/passwd', 'http://printer.local/', 'https://example.com:8443/', 'http://user:pw@example.com/'])
      expect((await call({ method: 'POST', url: '/api/import/page', body: { url }, as: 'designer' })).statusCode, url).toBe(400);
  });
  it('lets admins change import settings but never shows a key', async () => {
    const r = await call({ method: 'PUT', url: '/api/settings', body: { claudeDailyLimit: 50, importAllowedDomains: ['ui.com', 'Reolink.com'] }, as: 'admin' });
    expect(r.json()).toMatchObject({ claudeDailyLimit: 50, importAllowedDomains: ['ui.com', 'reolink.com'], claudeConfigured: false });
    expect(JSON.stringify((await call({ url: '/api/settings', as: 'admin' })).json())).not.toMatch(/sk-ant/);
    expect((await call({ method: 'POST', url: '/api/import/page', body: { url: 'https://example.com/' }, as: 'designer' })).json().error).toMatch(/not in the allowed import domains/);
    expect((await call({ method: 'PUT', url: '/api/settings', body: { claudeModel: 'Bad Model!' }, as: 'admin' })).statusCode).toBe(400);
  });
});

describe('audit log', () => {
  it('records sign-ins, failures, user admin and edits', async () => {
    const log = (await call({ url: '/api/audit?limit=500', as: 'admin' })).json() as { action: string }[];
    const actions = new Set(log.map(e => e.action));
    for (const a of ['setup.admin-created', 'auth.sign-in', 'auth.sign-in.failed', 'user.create', 'project.create', 'records.push', 'project.import-v1', 'share.create', 'share.view', 'share.revoke', 'catalog.create', 'file.upload', 'settings.update'])
      expect(actions, a).toContain(a);
  });
});
