// Admin-editable settings kept in the database. Secrets (the Claude API key) stay in environment variables only.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, nowIso, type DB } from './db/index.js';
import type { Config } from './config.js';

export const SettingsPatch = z.object({
  claudeEnabled: z.boolean().optional(),
  claudeModel: z.string().regex(/^[a-z0-9.-]{3,80}$/, 'model ids are lowercase letters, digits, dots and dashes').optional(),
  claudeDailyLimit: z.number().int().min(0).max(100000).optional(),
  importAllowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).max(200).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export function createSettings(db: DB, cfg: Config) {
  const read = (key: string): unknown => { const r = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get(); return r ? JSON.parse(r.value) as unknown : undefined; };
  return {
    effective() {
      const enabled = read('claudeEnabled'), model = read('claudeModel'), limit = read('claudeDailyLimit'), domains = read('importAllowedDomains');
      return {
        claudeConfigured: !!cfg.claude.apiKey,
        claudeEnabled: !!cfg.claude.apiKey && enabled !== false,
        claudeModel: typeof model === 'string' ? model : cfg.claude.model,
        claudeDailyLimit: typeof limit === 'number' ? limit : cfg.claude.dailyLimit,
        importAllowedDomains: Array.isArray(domains) ? (domains as string[]) : cfg.importAllowedDomains,
      };
    },
    update(patch: SettingsPatch) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const v = JSON.stringify(key === 'importAllowedDomains' ? (value as string[]).map(d => d.toLowerCase()) : value);
        db.insert(schema.settings).values({ key, value: v, updatedAt: nowIso() }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v, updatedAt: nowIso() } }).run();
      }
    },
  };
}
export type Settings = ReturnType<typeof createSettings>;
