// Settings come from environment variables (the Unraid template / compose file). Invalid values stop startup with a clear message.
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const bool = z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', '']).transform(v => ['true', '1', 'yes', 'on'].includes(v));
const optStr = z.string().optional().transform(v => (v && v.trim() ? v.trim() : undefined));
const list = z.string().optional().transform(v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []));

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('/data'),
  WEB_DIR: optStr,
  /** The URL people use to reach the app, e.g. https://fieldplan.example.com. Optional on a LAN. */
  PUBLIC_URL: optStr.pipe(z.url({ protocol: /^https?$/ }).optional()),
  /** Extra origins allowed to send requests (rare; e.g. a second hostname). */
  TRUSTED_ORIGINS: list,
  /** Behind a reverse proxy / Cloudflare tunnel: how many proxy hops to trust for X-Forwarded-* (true = all, avoid). */
  TRUST_PROXY: z.union([z.coerce.number().int().min(0).max(10), bool]).default(false).transform(v => (v === 0 ? false : v)),
  AUTH_SECRET: optStr.pipe(z.string().min(32, 'AUTH_SECRET must be at least 32 characters').optional()),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(50),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FIELDPLAN_VERSION: z.string().default('dev'),
  // ---- optional: Claude-powered import (datasheets / product pages → specs) ----
  ANTHROPIC_API_KEY: optStr,
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),
  CLAUDE_DAILY_LIMIT: z.coerce.number().int().min(0).max(100000).default(200),
  /** Restrict web import to these domains (and their subdomains). Empty = any public site. */
  IMPORT_ALLOWED_DOMAINS: list,
});

export interface Config {
  port: number; host: string; dataDir: string; webDir: string | null;
  publicUrl: string | null; trustedOrigins: string[]; trustProxy: boolean | number; secureCookies: boolean;
  authSecret: string; maxUploadBytes: number; logLevel: string; version: string;
  claude: { apiKey: string | null; model: string; dailyLimit: number };
  importAllowedDomains: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  // Unraid passes every template variable, including empty ones: treat blank as "not set" so defaults apply.
  const clean = Object.fromEntries(Object.keys(Env.shape).map(k => [k, env[k]?.trim() || undefined]));
  // Values saved from the Settings page live in the data volume and win over the container's variables, so a
  // template reset on the host can't wipe them.
  const early = path.resolve(overrides.dataDir ?? clean.DATA_DIR ?? '/data');
  for (const [k, v] of Object.entries(readRuntime(early))) if (v) clean[k] = v;
  const r = Env.safeParse(clean);
  if (!r.success) throw new Error('Invalid settings: ' + r.error.issues.map(i => i.path.join('.') + ' — ' + i.message).join('; '));
  const e = r.data;
  const dataDir = path.resolve(overrides.dataDir ?? e.DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  const cfg: Config = {
    port: e.PORT, host: e.HOST, dataDir, webDir: e.WEB_DIR ? path.resolve(e.WEB_DIR) : null,
    publicUrl: e.PUBLIC_URL ? new URL(e.PUBLIC_URL).origin : null,
    trustedOrigins: e.TRUSTED_ORIGINS, trustProxy: e.TRUST_PROXY,
    secureCookies: !!e.PUBLIC_URL && e.PUBLIC_URL.startsWith('https://'),
    authSecret: e.AUTH_SECRET ?? secretFromFile(dataDir),
    maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024, logLevel: e.LOG_LEVEL, version: e.FIELDPLAN_VERSION,
    claude: { apiKey: e.ANTHROPIC_API_KEY ?? null, model: e.CLAUDE_MODEL, dailyLimit: e.CLAUDE_DAILY_LIMIT },
    importAllowedDomains: e.IMPORT_ALLOWED_DOMAINS.map(d => d.toLowerCase().replace(/^\*\./, '')),
  };
  return { ...cfg, ...overrides, dataDir };
}

export const RUNTIME_KEYS = ['PUBLIC_URL', 'TRUST_PROXY', 'ANTHROPIC_API_KEY'] as const;
export type RuntimeKey = typeof RUNTIME_KEYS[number];
const runtimeFile = (dataDir: string) => path.join(dataDir, 'runtime-config.json');
export function readRuntime(dataDir: string): Partial<Record<RuntimeKey, string>> {
  try { const j = JSON.parse(fs.readFileSync(runtimeFile(dataDir), 'utf8')) as Record<string, unknown>; return Object.fromEntries(RUNTIME_KEYS.filter(k => typeof j[k] === 'string').map(k => [k, j[k] as string])); } catch { return {}; }
}
/** Merge into the saved file; an empty string removes the key (the container variable applies again). */
export function writeRuntime(dataDir: string, patch: Partial<Record<RuntimeKey, string>>) {
  const cur: Record<string, string> = { ...readRuntime(dataDir) };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; if (v.trim()) cur[k] = v.trim(); else delete cur[k]; }
  fs.writeFileSync(runtimeFile(dataDir), JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
}

/** Generated once and kept in the data volume (mode 600) so sessions survive restarts. */
function secretFromFile(dataDir: string): string {
  const f = path.join(dataDir, 'auth-secret');
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s.length >= 32) return s; } catch { /* first start */ }
  const s = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(f, s + '\n', { mode: 0o600 });
  return s;
}
