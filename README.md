# Fieldplan (v2)

Site CAD for low-voltage, electrical, security and smart-home installs. TypeScript rewrite of the single-file v1 app: a Fastify + SQLite server, a React web app, user accounts, client share links, an audit log, and a device catalog that can import products from vendor pages.

**Status:** M1 — the plan editor works: draw walls, doors, windows, areas, devices, cables, labels and measurements; coverage cones stop at walls; devices have editable inputs/ports; autosave with undo/redo. See [ROADMAP.md](ROADMAP.md).

## Install on Unraid
1. Make the package public once: GitHub → your profile → Packages → `fieldplan-app-m4` → Package settings → Change visibility → Public.
2. Copy `unraid/fieldplan-app-m4.xml` to `/boot/config/plugins/dockerMan/templates-user/` on the server, then Docker → Add Container → choose **fieldplan-app-m4**.
3. Defaults: port 6302 (v2 stays on 6300, v1 on 6301), data in `/mnt/user/appdata/fieldplan-app-m4`. Open the Web UI and create the admin account.
4. Updates: Docker tab → check for updates → Apply.

Back up the data folder (`fieldplan.db`, `files/`, `auth-secret`).

## Settings (environment variables)
| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | `https://…` when behind a reverse proxy (turns on Secure cookies/HSTS) |
| `TRUST_PROXY` | Number of proxy hops in front (usually `1`) |
| `ANTHROPIC_API_KEY` | Optional: Claude reads product pages and datasheets during import. Can also be set in Settings → Connection & API key (stored in `/data`, wins over this variable) |
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

## Offline tablets (M4)
- Open the app **over HTTPS** (a reverse proxy, Cloudflare tunnel or `tailscale serve`) and use *Add to Home Screen* / *Install*. Browsers only allow the offline app shell on HTTPS or localhost; on plain `http://` the editor still keeps unsent edits on the device, but the app can't start with no connection.
- Open a project in the editor once while online: its records and underlay images are kept on the device. With no signal you can reopen it, keep drawing, and the header shows *Offline — N changes saved on this device*.
- On reconnect the edits are sent automatically. If someone else changed the same item meanwhile, the newest edit wins and the header shows *N overwritten*.
- Signing out clears the device copy. Read-only pages (project list, BOM) show the last version loaded while online.
