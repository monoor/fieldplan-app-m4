// Request helpers: errors, validation, sessions and permission checks.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import { can, type Permission } from '@fieldplan/shared';
import type { Auth } from './auth.js';

export class HttpError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.slice(0, 5).map(i => (i.path.join('.') || 'body') + ': ' + i.message).join('; '));
  return r.data;
}

export interface SessionUser { id: string; email: string; name: string; role: string; twoFactorEnabled?: boolean | null }
declare module 'fastify' {
  interface FastifyRequest { user: SessionUser | null; userLoaded: boolean }
}

/** Headers for Better Auth, with the client IP as Fastify sees it (proxy-aware only when TRUST_PROXY is on). */
export function authHeaders(req: FastifyRequest): Headers {
  const h = fromNodeHeaders(req.headers); h.set('x-forwarded-for', req.ip); return h;
}

export async function loadUser(auth: Auth, req: FastifyRequest): Promise<SessionUser | null> {
  if (req.userLoaded) return req.user;
  const s = await auth.api.getSession({ headers: authHeaders(req) }).catch(() => null);
  req.user = s && !(s.user as { banned?: boolean }).banned ? (s.user as unknown as SessionUser) : null;
  req.userLoaded = true;
  return req.user;
}

/** preHandler: signed in and allowed. 401 when signed out, 403 when the role lacks the permission. */
export function requirePerm(auth: Auth, perm: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const u = await loadUser(auth, req);
    if (!u) throw new HttpError(401, 'Sign in required');
    if (!can(u.role, perm)) throw new HttpError(403, 'Your role (' + u.role + ') cannot do this');
  };
}

/** The origin this request was made to, as the browser sees it. */
export function selfOrigin(req: FastifyRequest): string { try { return new URL(req.protocol + '://' + req.host).origin; } catch { return 'null'; } }
