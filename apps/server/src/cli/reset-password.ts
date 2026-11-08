// Lock-out recovery, run on the server:  docker exec -it fieldplan-app-m4 node apps/server/dist/cli/reset-password.js you@example.com [new-password] [--no-2fa]
// Without a password one is generated and printed. All of the user's sessions are signed out. --no-2fa also turns off two-factor for them.
import crypto from 'node:crypto';
import { loadConfig } from '../config.js';
import { openStore } from '../db/index.js';
import { createAudit } from '../audit.js';
import { createAuth, migrateAuth } from '../auth.js';

const args = process.argv.slice(2), no2fa = args.includes('--no-2fa'), rest = args.filter(a => !a.startsWith('--'));
const email = rest[0]?.toLowerCase();
if (!email) { console.error('Usage: reset-password.js <email> [new-password] [--no-2fa]'); process.exit(2); }
const cfg = loadConfig(), store = openStore(cfg.dataDir), audit = createAudit(store.db);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const auth = createAuth(store.sqlite, cfg, audit, quiet);
await migrateAuth(auth);
const user = store.sqlite.prepare('select id from user where lower(email)=?').get(email) as { id: string } | undefined;
if (!user) { console.error('No user with email ' + email); process.exit(1); }
const pw = rest[1] ?? crypto.randomBytes(12).toString('base64url');
if (pw.length < 10) { console.error('Password must be at least 10 characters'); process.exit(2); }
const ctx = await auth.$context, hash = await ctx.password.hash(pw);
const acc = store.sqlite.prepare("update account set password=?, updatedAt=? where userId=? and providerId='credential'").run(hash, new Date().toISOString(), user.id);
if (!acc.changes) { console.error('That user has no password sign-in to reset'); process.exit(1); }
store.sqlite.prepare('delete from session where userId=?').run(user.id);
if (no2fa) { store.sqlite.prepare('delete from twoFactor where userId=?').run(user.id); store.sqlite.prepare('update user set twoFactorEnabled=0 where id=?').run(user.id); }
audit.log({ action: 'user.password-reset-cli', userId: user.id, userEmail: email, detail: no2fa ? { twoFactorDisabled: true } : null });
console.log('Password for ' + email + (rest[1] ? ' updated.' : ' reset to: ' + pw) + (no2fa ? ' Two-factor turned off.' : '') + ' Sign in, then change it under Settings.');
store.sqlite.close();
