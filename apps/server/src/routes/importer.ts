// Web import: product page → draft catalog item (published page data + optional Claude extraction);
// datasheet / photo URLs → file store; stored datasheet → specs via Claude.
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import type { ImportDraft, Specs } from '@fieldplan/shared';
import { HttpError, parse, requirePerm } from '../http.js';
import { fetchSafe } from '../import/fetcher.js';
import { extractFromHtml } from '../import/extract.js';
import { sniffMime } from '../files.js';
import type { Ctx } from '../context.js';

const Url = z.object({ url: z.string().max(2000) });
const merge = (a: Specs, b: Specs | undefined): Specs => {
  const out: Specs = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) if (v !== null && v !== undefined && k !== 'extra') (out as Record<string, unknown>)[k] = v;
  if (a.extra || b?.extra) out.extra = { ...(a.extra ?? {}), ...(b?.extra ?? {}) };
  return out;
};

export default async function importRoutes(app: FastifyInstance, { auth, audit, files, claude, settings }: Ctx) {
  const limit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
  const domains = () => settings.effective().importAllowedDomains;

  app.get('/api/import/status', { preHandler: requirePerm(auth, 'catalog:read') }, async () => ({ claude: claude.status(), allowedDomains: domains() }));

  app.post('/api/import/page', { preHandler: requirePerm(auth, 'import:run'), config: limit }, async req => {
    const { url, useClaude } = parse(Url.extend({ useClaude: z.boolean().default(true) }), req.body);
    const page = await fetchSafe(url, { maxBytes: 25 * 1024 * 1024, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5', allowedDomains: domains() });
    const draft: ImportDraft = { sourceUrl: page.url, item: { specs: {}, sourceUrl: page.url }, datasheets: [], images: [], via: [], warnings: [] };
    const useAi = useClaude && claude.status().enabled;

    if (sniffMime(page.body) === 'application/pdf') { // the link was a datasheet itself
      const stored = files.put(page.body, { name: decodeURIComponent(new URL(page.url).pathname.split('/').pop() ?? 'datasheet.pdf'), sourceUrl: page.url, createdBy: req.user!.id });
      draft.item.datasheetSha = stored.sha256; draft.datasheets.push(page.url);
      if (useAi) { const x = await claude.extract({ url: page.url, pdf: page.body }); Object.assign(draft.item, x.item, { specs: merge(draft.item.specs, x.item.specs) }); draft.via.push('claude'); draft.warnings.push(...x.warnings); }
      else draft.warnings.push('PDF stored. Turn on Claude import to read specs from datasheets.');
    } else {
      if (!/html|xml|text\/plain/i.test(page.contentType)) throw new HttpError(415, 'That link is not a web page or PDF (' + (page.contentType || 'unknown type') + ')');
      const facts = extractFromHtml(page.body.toString('utf8'), page.url);
      draft.datasheets = facts.datasheets; draft.images = facts.images;
      if (facts.product) {
        draft.via.push('json-ld');
        Object.assign(draft.item, { ...(facts.product.brand ? { vendor: facts.product.brand } : {}), ...(facts.product.model ? { model: facts.product.model } : {}), ...(facts.product.name ? { name: facts.product.name } : {}) });
        draft.item.specs = merge(draft.item.specs, facts.product.specs);
      } else if (facts.title) { draft.via.push('opengraph'); draft.item.name = facts.title.slice(0, 200); }
      if (useAi) {
        const x = await claude.extract({ url: page.url, text: facts.text });
        draft.item = { ...draft.item, ...Object.fromEntries(Object.entries(x.item).filter(([, v]) => v !== undefined && v !== '')), specs: merge(draft.item.specs, x.item.specs) };
        if (x.datasheetUrl && !draft.datasheets.includes(x.datasheetUrl)) draft.datasheets.unshift(x.datasheetUrl);
        if (x.imageUrl && !draft.images.includes(x.imageUrl)) draft.images.unshift(x.imageUrl);
        draft.via.push('claude'); draft.warnings.push(...x.warnings);
      } else if (!facts.product) draft.warnings.push('This page does not publish structured product data. Turn on Claude import, or fill in the specs by hand.');
    }
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'import.page', detail: { url: page.url.slice(0, 300), via: draft.via } });
    return draft;
  });

  app.post('/api/import/file', { preHandler: requirePerm(auth, 'import:run'), config: limit }, async (req, reply) => {
    const { url } = parse(Url, req.body);
    const got = await fetchSafe(url, { maxBytes: 50 * 1024 * 1024, accept: 'application/pdf,image/*;q=0.9', allowedDomains: domains() });
    const stored = files.put(got.body, { name: decodeURIComponent(new URL(got.url).pathname.split('/').pop() ?? '').slice(0, 200) || null, sourceUrl: got.url, createdBy: req.user!.id });
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'import.file', detail: { url: got.url.slice(0, 300), sha256: stored.sha256, mime: stored.mime } });
    return reply.code(201).send(stored);
  });

  app.post('/api/import/datasheet', { preHandler: requirePerm(auth, 'import:run'), config: limit }, async req => {
    const { sha256 } = parse(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }), req.body);
    const f = files.get(sha256); if (!f || f.mime !== 'application/pdf') throw new HttpError(404, 'No stored PDF with that id');
    const x = await claude.extract({ url: f.sourceUrl ?? 'uploaded datasheet', pdf: fs.readFileSync(files.pathOf(sha256)) });
    audit.log({ userId: req.user!.id, userEmail: req.user!.email, ip: req.ip, action: 'import.datasheet', detail: { sha256 } });
    const draft: ImportDraft = { sourceUrl: f.sourceUrl ?? '', item: { ...x.item, specs: x.item.specs ?? {}, datasheetSha: sha256 }, datasheets: [], images: x.imageUrl ? [x.imageUrl] : [], via: ['claude'], warnings: x.warnings };
    return draft;
  });

  app.post('/api/import/test', { preHandler: requirePerm(auth, 'settings:manage'), config: limit }, async () => claude.test());
}
