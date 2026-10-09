// Append-only record of who did what. Written synchronously in the same SQLite file; read by admins in Settings → Audit log.
import { and, desc, eq, lt } from 'drizzle-orm';
import { schema, nowIso, type DB } from './db/index.js';

export interface AuditEntry { action: string; userId?: string | null; userEmail?: string | null; ip?: string | null; projectId?: string | null; detail?: Record<string, unknown> | null }

export function createAudit(db: DB) {
  return {
    log(e: AuditEntry) {
      const detail = e.detail && Object.keys(e.detail).length ? JSON.stringify(e.detail).slice(0, 8000) : null;
      db.insert(schema.auditLog).values({ at: nowIso(), action: e.action, userId: e.userId ?? null, userEmail: e.userEmail ?? null, ip: e.ip ?? null, projectId: e.projectId ?? null, detail }).run();
    },
    list(opts: { projectId?: string; before?: number; limit?: number }) {
      const where = and(opts.projectId ? eq(schema.auditLog.projectId, opts.projectId) : undefined, opts.before ? lt(schema.auditLog.id, opts.before) : undefined);
      return db.select().from(schema.auditLog).where(where).orderBy(desc(schema.auditLog.id)).limit(Math.min(500, opts.limit ?? 100)).all()
        .map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) as unknown : null }));
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;
