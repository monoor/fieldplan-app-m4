import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, writeRuntime } from '../src/config.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fp-cfg-'));

describe('config', () => {
  it('treats blank variables (as Unraid passes them) as unset', () => {
    const c = loadConfig({ DATA_DIR: dir(), PORT: '', PUBLIC_URL: '', TRUST_PROXY: '', MAX_UPLOAD_MB: ' ', CLAUDE_MODEL: '', CLAUDE_DAILY_LIMIT: '', ANTHROPIC_API_KEY: '', IMPORT_ALLOWED_DOMAINS: '', LOG_LEVEL: '' });
    expect(c.port).toBe(8080); expect(c.publicUrl).toBeNull(); expect(c.trustProxy).toBe(false); expect(c.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(c.claude).toEqual({ apiKey: null, model: 'claude-sonnet-5-5', dailyLimit: 200 }); expect(c.importAllowedDomains).toEqual([]);
  });
  it('reads proxy hops, https cookies and domain lists', () => {
    expect(loadConfig({ DATA_DIR: dir(), TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ DATA_DIR: dir(), TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ DATA_DIR: dir(), TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    const c = loadConfig({ DATA_DIR: dir(), PUBLIC_URL: 'https://plans.example.com/', IMPORT_ALLOWED_DOMAINS: 'UI.com, *.reolink.com' });
    expect(c.publicUrl).toBe('https://plans.example.com'); expect(c.secureCookies).toBe(true); expect(c.importAllowedDomains).toEqual(['ui.com', 'reolink.com']);
  });
  it('keeps one generated auth secret per data dir and rejects bad values', () => {
    const d = dir(); const a = loadConfig({ DATA_DIR: d }).authSecret; expect(a.length).toBeGreaterThanOrEqual(32);
    expect(loadConfig({ DATA_DIR: d }).authSecret).toBe(a);
    expect((fs.statSync(path.join(d, 'auth-secret')).mode & 0o777).toString(8)).toBe('600');
    expect(() => loadConfig({ DATA_DIR: d, PUBLIC_URL: 'ftp://x' })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ DATA_DIR: d, TRUST_PROXY: 'maybe' })).toThrow(/TRUST_PROXY/);
  });
});

describe('client IP behind a proxy', () => {
  it('TRUST_PROXY=1 believes only the nearest proxy', async () => {
    const { buildApp } = await import('../src/app.js');
    const ipOf = async (trust: string) => {
      const { app } = await buildApp(loadConfig({ DATA_DIR: dir(), TRUST_PROXY: trust, LOG_LEVEL: 'silent' }), { logger: false });
      app.get('/__ip', async req => req.ip);
      const r = await app.inject({ url: '/__ip', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } }); await app.close(); return r.body;
    };
    expect(await ipOf('1')).toBe('203.0.113.9');
    expect(await ipOf('')).toBe('127.0.0.1');
  });

  it('saved runtime settings in /data win over blank container variables', () => {
    const d = dir(); writeRuntime(d, { PUBLIC_URL: 'https://plans.example.com/', TRUST_PROXY: '1', ANTHROPIC_API_KEY: 'sk-ant-abcdefghij' });
    const c = loadConfig({ DATA_DIR: d, PUBLIC_URL: '', TRUST_PROXY: '', ANTHROPIC_API_KEY: '' });
    expect(c.publicUrl).toBe('https://plans.example.com'); expect(c.trustProxy).toBe(1); expect(c.claude.apiKey).toBe('sk-ant-abcdefghij');
    writeRuntime(d, { PUBLIC_URL: '', ANTHROPIC_API_KEY: '' });
    expect(loadConfig({ DATA_DIR: d }).publicUrl).toBeNull();
  });
});
