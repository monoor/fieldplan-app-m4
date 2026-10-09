import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema>;
export interface Store { sqlite: Database.Database; db: DB }

/** Opens (or creates) /data/fieldplan.db in WAL mode and applies pending app migrations. */
export function openStore(dataDir: string): Store {
  const sqlite = new Database(path.join(dataDir, 'fieldplan.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations') });
  return { sqlite, db };
}

export const nowIso = () => new Date().toISOString();
export { schema };
