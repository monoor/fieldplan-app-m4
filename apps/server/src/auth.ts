// Accounts, sessions, roles and 2FA via Better Auth. Sign-up is closed: the first admin is created by the setup screen,
// everyone else by an admin. Better Auth stores its tables in the same SQLite file.
import { betterAuth } from 'better-auth';
import { admin, twoFactor } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';
import { getMigrations } from 'better-auth/db/migration';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import type Database from 'better-sqlite3';
import type { Config } from './config.js';
import type { Audit } from './audit.js';

const ac = createAccessControl(defaultStatements);
const roles = {
  admin: ac.newRole({ ...adminAc.statements }),
  designer: ac.newRole({ user: [], session: [] }),
  viewer: ac.newRole({ user: [], session: [] }),
};

/** Auth endpoints worth a line in the audit log. */
const AUDITED: Record<string, string> = {
  '/sign-in/email': 'auth.sign-in', '/sign-out': 'auth.sign-out', '/change-password': 'auth.change-password',
  '/two-factor/enable': 'auth.2fa-enable', '/two-factor/disable': 'auth.2fa-disable', '/two-factor/verify-totp': 'auth.2fa-verify',
  '/admin/create-user': 'user.create', '/admin/set-role': 'user.set-role', '/admin/ban-user': 'user.ban', '/admin/unban-user': 'user.unban',
  '/admin/remove-user': 'user.remove', '/admin/set-user-password': 'user.set-password', '/admin/revoke-user-sessions': 'user.revoke-sessions',
};

type Log = Record<'info' | 'warn' | 'error' | 'debug', (obj: object, msg?: string) => void>;
let migrating = true;

export function createAuth(sqlite: Database.Database, cfg: Config, audit: Audit, log: Log) {
  return betterAuth({
    logger: { log: (level, message, ...args) => {
      if (!cfg.publicUrl && message.includes('Base URL is not set')) return; // intended on a LAN: the origin comes from each request
      if (migrating && message.includes('schema mismatch')) return;           // printed just before we create the tables
      log[level]({ component: 'auth', ...(args.length ? { detail: args } : {}) }, message);
    } },
    appName: 'Fieldplan',
    database: sqlite,
    secret: cfg.authSecret,
    // No fixed base URL on a LAN: Better Auth then derives it from each request, so the origin check is same-origin.
    ...(cfg.publicUrl ? { baseURL: cfg.publicUrl } : {}),
    trustedOrigins: (request) => [...cfg.trustedOrigins, request ? new URL(request.url).origin : null],
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, maxPasswordLength: 256, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    user: { deleteUser: { enabled: false } },
    advanced: {
      cookiePrefix: 'fieldplan',
      disableOriginCheck: false, disableCSRFCheck: false, // explicit: Better Auth would otherwise skip these under test runners
      useSecureCookies: cfg.secureCookies,
      trustedProxyHeaders: !!cfg.trustProxy,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }, // set by us from Fastify's req.ip, never passed through from the client
    },
    rateLimit: {
      enabled: true, window: 60, max: 120, storage: 'memory',
      customRules: { '/sign-in/email': { window: 60, max: 8 }, '/two-factor/*': { window: 60, max: 8 }, '/change-password': { window: 60, max: 5 } },
    },
    plugins: [admin({ ac, roles, defaultRole: 'viewer', adminRoles: ['admin'] }), twoFactor({ issuer: 'Fieldplan' })],
    hooks: {
      after: createAuthMiddleware(async ctx => {
        const action = AUDITED[ctx.path]; if (!action) return;
        const ret = ctx.context.returned, failed = isAPIError(ret);
        const actor = (ctx.context.newSession ?? ctx.context.session)?.user as { id?: string; email?: string } | undefined;
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        audit.log({
          action: failed ? action + '.failed' : action,
          userId: actor?.id ?? null, userEmail: actor?.email ?? (typeof body.email === 'string' ? body.email : null),
          ip: ctx.request?.headers.get('x-forwarded-for') ?? null,
          detail: { ...(typeof body.userId === 'string' ? { target: body.userId } : {}), ...(typeof body.role === 'string' ? { role: body.role } : {}), ...(failed ? { error: (ret as { message?: string }).message } : {}) },
        });
      }),
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

/** Creates or updates Better Auth's tables. */
export async function migrateAuth(auth: Auth) { const { runMigrations } = await getMigrations(auth.options); await runMigrations(); migrating = false; }
