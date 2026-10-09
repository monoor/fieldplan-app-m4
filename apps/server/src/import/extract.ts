// Pulls what a product page publishes about itself: JSON-LD Product data, OpenGraph tags, datasheet links and
// a compact text version of the page (headings, lists, spec tables) for Claude to read when it is enabled.
import * as cheerio from 'cheerio';
import type { Specs } from '@fieldplan/shared';

export interface PageFacts {
  title: string | null;
  product: { name?: string; brand?: string; model?: string; description?: string; specs: Specs } | null;
  images: string[];
  datasheets: string[];
  text: string;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : isObj(v) && typeof v.name === 'string' ? v.name.trim() : undefined);
const num = (v: unknown): number | undefined => { const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '')); return m ? Number(m[0]) : undefined; };

function abs(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try { const u = new URL(href, base); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

function products(node: unknown, out: J[]) {
  if (Array.isArray(node)) { node.forEach(n => products(n, out)); return; }
  if (!isObj(node)) return;
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(node);
  if (node['@graph']) products(node['@graph'], out);
}

/** Maps a JSON-LD additionalProperty name to a spec field. */
function specFromProperty(name: string, value: unknown, specs: Specs) {
  const n = name.toLowerCase(), v = String(value ?? '');
  const extra = (specs.extra ??= {});
  if (/field of view|\bfov\b|angle of view|viewing angle/.test(n) && num(v)) specs.hfovDeg = num(v);
  else if (/poe budget|total poe/.test(n) && num(v)) specs.poeBudgetW = num(v);
  else if (/(max(imum)?\s+)?power (consumption|draw)|max power/.test(n) && num(v)) specs.maxPowerW = num(v);
  else if (/resolution/.test(n) && /(\d{3,5})\s*[x×]\s*\d{3,5}/.test(v)) specs.resolutionPx = Number(/(\d{3,5})\s*[x×]/.exec(v)![1]);
  else if (/megapixel/.test(n) && num(v)) specs.megapixels = num(v);
  else if (/ip rating|ingress|weather/.test(n) && /IP\d{2}/i.test(v)) specs.ipRating = /IP\d{2}/i.exec(v)![0].toUpperCase();
  else if (/rack (unit|size)|\bru\b/.test(n) && num(v)) specs.rackUnits = num(v);
  else if (/^ports?$|number of ports|ethernet ports/.test(n) && num(v)) specs.ports = num(v);
  else if (Object.keys(extra).length < 40) extra[name.slice(0, 60)] = v.slice(0, 300);
}

export function extractFromHtml(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const found: J[] = [];
  $('script[type="application/ld+json"]').each((_, el) => { try { products(JSON.parse($(el).text()), found); } catch { /* malformed JSON-LD is common */ } });
  const images = new Set<string>(), datasheets: string[] = [];
  let product: PageFacts['product'] = null;
  const p = found[0];
  if (p) {
    const specs: Specs = {};
    if (Array.isArray(p.additionalProperty)) for (const ap of p.additionalProperty) if (isObj(ap) && typeof ap.name === 'string') specFromProperty(ap.name, ap.value, specs);
    product = { name: str(p.name), brand: str(p.brand) ?? str(p.manufacturer), model: str(p.model) ?? str(p.mpn) ?? str(p.sku), description: str(p.description)?.slice(0, 2000), specs };
    for (const im of ([] as unknown[]).concat(p.image ?? [])) { const u = abs(typeof im === 'string' ? im : isObj(im) ? str(im.url) ?? str(im.contentUrl) : undefined, pageUrl); if (u) images.add(u); }
  }
  const og = (k: string) => $('meta[property="' + k + '"]').attr('content') ?? $('meta[name="' + k + '"]').attr('content');
  const ogImg = abs(og('og:image'), pageUrl); if (ogImg) images.add(ogImg);
  const title = (og('og:title') ?? $('title').first().text() ?? '').trim() || null;

  const scored: { url: string; score: number }[] = [];
  $('a[href]').each((_, el) => {
    const href = abs($(el).attr('href'), pageUrl); if (!href || !/\.pdf(\?|#|$)/i.test(href)) return;
    const label = ($(el).text() + ' ' + href).toLowerCase();
    scored.push({ url: href, score: (/datasheet|data sheet|spec/.test(label) ? 2 : 0) + (/quick start|manual|guide/.test(label) ? 1 : 0) });
  });
  for (const s of scored.sort((a, b) => b.score - a.score)) if (!datasheets.includes(s.url) && datasheets.length < 10) datasheets.push(s.url);

  $('script,style,noscript,svg,iframe,nav,footer,header,form').remove();
  const lines: string[] = [], seen = new Set<string>();
  $('h1,h2,h3,h4,p,li,tr,dt,dd').each((_, el) => {
    const t = el.tagName === 'tr' ? $(el).children('th,td').map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).join(' | ') : $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length < 400 && !seen.has(t)) { seen.add(t); lines.push(t); }
  });
  return { title, product, images: [...images].slice(0, 6), datasheets, text: lines.join('\n').slice(0, 60_000) };
}
