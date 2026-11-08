// Fieldplan service worker: lets the app open and read cached pages with no signal. Edits are NOT handled here —
// they are kept in IndexedDB by the editor and pushed when the connection returns.
//  - /assets/* (hashed build files) and icons: cache first
//  - page navigations: network first, falling back to the cached app shell
//  - uploaded files (/api/files/*): cache first (underlays, datasheets)
//  - other GET /api/* reads (projects, catalog, me): network first, cached copy when offline
//  - never cached: auth, snapshot/pull (the editor keeps its own copy), anything that isn't GET
const VERSION = 'fp-v1';
const SHELL = 'fp-shell-' + VERSION, ASSETS = 'fp-assets-' + VERSION, API = 'fp-api-' + VERSION, FILES = 'fp-files-' + VERSION;
const KEEP = [SHELL, ASSETS, API, FILES];

// Precache the shell and the hashed build files the page references (the first visit loaded them before this worker existed).
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL), assets = await caches.open(ASSETS);
    const html = await (await fetch('/', { cache: 'reload' })).text();
    const files = [...html.matchAll(/(?:src|href)="(\/(?:assets\/)[^"]+)"/g)].map(m => m[1]);
    await shell.addAll(['/']);
    await assets.addAll([...files, '/favicon.svg', '/icon-192.png', '/manifest.webmanifest']);
    const api = await caches.open(API); // best effort: whoever is signed in right now can reopen the app offline
    await Promise.all(['/api/me', '/api/status', '/api/projects'].map(u => fetch(u).then(r => { if (r.ok) return api.put(u, r); }).catch(() => undefined)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'clear') e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))); });

const cacheFirst = async (req, name) => {
  const c = await caches.open(name), hit = await c.match(req); if (hit) return hit;
  const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res;
};
const networkFirst = async (req, name, fallbackKey) => {
  const c = await caches.open(name);
  try { const res = await fetch(req); if (res.ok) c.put(fallbackKey || req, res.clone()); return res; }
  catch (err) { const hit = await c.match(fallbackKey || req); if (hit) return hit; throw err; }
};

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/auth/') || p.endsWith('/snapshot') || p.endsWith('/pull') || p.startsWith('/api/shares') || p.startsWith('/s/')) return;
  if (p.startsWith('/assets/') || p === '/favicon.svg' || p.startsWith('/icon-') || p === '/manifest.webmanifest') { e.respondWith(cacheFirst(req, ASSETS)); return; }
  if (p.startsWith('/api/files/')) { e.respondWith(cacheFirst(req, FILES)); return; }
  if (p.startsWith('/api/')) { e.respondWith(networkFirst(req, API)); return; }
  if (req.mode === 'navigate') e.respondWith(networkFirst(req, SHELL, '/').catch(() => caches.match('/')));
});
