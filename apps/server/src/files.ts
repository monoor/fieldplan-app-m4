// Content-addressed file store for underlays, datasheets and product photos: /data/files/ab/<sha256>.
// The type is decided from the file's own bytes, never from a client's or website's Content-Type; SVG and HTML are refused.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema, nowIso, type DB } from './db/index.js';
import { HttpError } from './http.js';

export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const;
export type FileMime = (typeof ALLOWED_MIME)[number];

export function sniffMime(b: Uint8Array): FileMime | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

export interface StoredFile { sha256: string; mime: FileMime; size: number }

export function createFileStore(db: DB, dataDir: string) {
  const root = path.join(dataDir, 'files');
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const fileOf = (sha: string) => path.join(root, sha.slice(0, 2), sha);
  return {
    put(buf: Uint8Array, meta: { name?: string | null; sourceUrl?: string | null; createdBy?: string | null } = {}): StoredFile {
      const mime = sniffMime(buf);
      if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF, WebP images and PDF files can be stored');
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const dest = fileOf(sha256);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = path.join(root, 'tmp', sha256 + '.' + process.pid + '.' + Date.now());
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest); // same filesystem → atomic
      }
      db.insert(schema.files).values({ sha256, mime, size: buf.length, name: meta.name?.slice(0, 200) ?? null, sourceUrl: meta.sourceUrl?.slice(0, 2000) ?? null, createdAt: nowIso(), createdBy: meta.createdBy ?? null })
        .onConflictDoNothing().run();
      return { sha256, mime, size: buf.length };
    },
    get(sha: string) { return /^[a-f0-9]{64}$/.test(sha) ? db.select().from(schema.files).where(eq(schema.files.sha256, sha)).get() ?? null : null; },
    pathOf: fileOf,
  };
}
export type FileStore = ReturnType<typeof createFileStore>;

/** data:image/png;base64,… → bytes (used for v1 underlays). */
export function decodeDataUrl(src: string): Uint8Array | null {
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(src); return m ? Buffer.from(m[1]!, 'base64') : null;
}
