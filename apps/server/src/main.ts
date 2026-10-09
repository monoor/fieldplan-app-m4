import { loadConfig } from './config.js';
import { buildApp } from './app.js';

let cfg;
try { cfg = loadConfig(); } catch (e) { console.error('[fieldplan] ' + (e as Error).message); process.exit(1); }
const { app, ctx } = await buildApp(cfg);
app.log.info({ version: cfg.version, dataDir: cfg.dataDir, publicUrl: cfg.publicUrl, trustProxy: cfg.trustProxy, claudeImport: ctx.claude.status().configured ? 'configured' : 'off' }, 'starting Fieldplan');
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => { app.log.info(sig + ': shutting down'); app.close().then(() => process.exit(0), () => process.exit(1)); });
await app.listen({ port: cfg.port, host: cfg.host });
