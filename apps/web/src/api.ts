import { createAuthClient } from 'better-auth/react';
import { adminClient, twoFactorClient } from 'better-auth/client/plugins';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** JSON API call on this origin; throws ApiError with the server's message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export const authClient = createAuthClient({ plugins: [adminClient(), twoFactorClient()] });

export interface Me { id: string; name: string; email: string; role: string; twoFactorEnabled: boolean; permissions: string[] }
export const can = (me: Me | undefined, p: string) => !!me?.permissions.includes(p);
export const fileUrl = (sha: string) => '/api/files/' + sha;
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
