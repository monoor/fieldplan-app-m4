/** Short random ids (base36, ~62 bits) — unique within a project, URL- and filename-safe. */
export function newId(): string {
  const b = new Uint8Array(8); globalThis.crypto.getRandomValues(b);
  let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
  return n.toString(36).padStart(13, '0');
}
