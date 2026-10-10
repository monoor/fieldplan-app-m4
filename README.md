# Fieldplan (v2)

Site CAD for low-voltage, electrical, security and smart-home installs. TypeScript rewrite of the single-file v1 app: a Fastify + SQLite server, a React web app, user accounts, client share links, an audit log, and a device catalog that can import products from vendor pages.

**Status:** M1 — the plan editor works: draw walls, doors, windows, areas, devices, cables, labels and measurements; coverage cones stop at walls; devices have editable inputs/ports; autosave with undo/redo. See [ROADMAP.md](ROADMAP.md).

## Install on Unraid
1. Make the package public once: GitHub → your profile → Packages → `fieldplan-app` → Package settings → Change visibility → Public.
2. Copy `unraid/fieldplan-app.xml` to `/boot/config/plugins/dockerMan/templates-user/` on the server, then Docker → Add Container → choose **fieldplan-app**.
3. Defaults: port 6300 (v1 stays on 8095), data in `/mnt/user/appdata/fieldplan-app`. Open the Web UI and create the admin account.
4. Updates: Docker tab → check for updates → Apply.

Back up the data folder (`fieldplan.db`, `files/`, `auth-secret`).

## Settings (environment variables)
| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | `https://…` when behind a reverse proxy (turns on Secure cookies/HSTS) |
| `TRUST_PROXY` | Number of proxy hops in front (usually `1`) |
| `ANTHROPIC_API_KEY` | Optional: Claude reads product pages and datasheets during import |
| `CLAUDE_MODEL`, `CLAUDE_DAILY_LIMIT` | Model and daily call cap (also editable in Settings) |
| `IMPORT_ALLOWED_DOMAINS` | Comma list; empty = any public site |
| `MAX_UPLOAD_MB`, `PUID`, `PGID`, `PORT`, `DATA_DIR`, `AUTH_SECRET`, `LOG_LEVEL` | See `apps/server/src/config.ts` |

## Develop
```
npm ci && npm run build
npm run dev:server   # :8080
npm run dev:web      # :5173, proxies /api
npm test             # vitest
```
Layout: `packages/shared` (data model, roles, catalog types, v1 converter) · `apps/server` · `apps/web`.

## Security notes
Closed sign-up (first admin via setup screen, locked afterwards) · Better Auth sessions, optional TOTP 2FA, login rate limits · roles admin/designer/viewer enforced server-side · CSP with `script-src 'self'`, same-origin checks on writes · share tokens stored hashed, expiring, revocable, stripped of prices/notes · uploads sniffed by content (no SVG/HTML) · web import is SSRF-hardened (public addresses only, ports 80/443, redirect re-checks, size/time caps) · Claude output is validated and never executed; API key is env-only · audit log of sign-ins, edits, shares, imports.
