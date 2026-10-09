// App tables (Drizzle). Better Auth creates and migrates its own tables (user, session, account, verification, twoFactor).
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  client: text('client'),
  /** Last change number handed out in this project; every record write takes the next one. */
  seq: integer('seq').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by'),
  deletedAt: text('deleted_at'),
});

export const records = sqliteTable('records', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  kind: text('kind').notNull(),
  sheetId: text('sheet_id'),
  data: text('data').notNull(),
  seq: integer('seq').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
}, t => [primaryKey({ columns: [t.projectId, t.id] }), index('records_project_seq').on(t.projectId, t.seq)]);

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  userId: text('user_id'),
  userEmail: text('user_email'),
  ip: text('ip'),
  action: text('action').notNull(),
  projectId: text('project_id'),
  detail: text('detail'),
}, t => [index('audit_at').on(t.at), index('audit_project').on(t.projectId, t.at)]);

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  /** SHA-256 of the link token; the token itself is shown once and never stored. */
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label'),
  sheetId: text('sheet_id'),
  expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
  lastUsedAt: text('last_used_at'),
  uses: integer('uses').notNull().default(0),
});

export const files = sqliteTable('files', {
  sha256: text('sha256').primaryKey(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  name: text('name'),
  sourceUrl: text('source_url'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
});

export const catalogItems = sqliteTable('catalog_items', {
  id: text('id').primaryKey(),
  vendor: text('vendor').notNull(),
  model: text('model').notNull(),
  category: text('category').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  createdBy: text('created_by'),
}, t => [uniqueIndex('catalog_vendor_model').on(t.vendor, t.model)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const importUsage = sqliteTable('import_usage', {
  day: text('day').primaryKey(),
  claudeCalls: integer('claude_calls').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
});
