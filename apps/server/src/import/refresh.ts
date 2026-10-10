// Re-read a catalog item's product page and update its prices (and fill empty specs) without touching what the user entered.
import type { CatalogItemInput, Price, Specs } from '@fieldplan/shared';
import type { PageFacts } from './extract.js';

export interface RefreshResult { item: CatalogItemInput; changes: string[] }

export function applyRefresh(item: CatalogItemInput, facts: PageFacts, pageUrl: string, now: string): RefreshResult {
  const next: CatalogItemInput = structuredClone(item), changes: string[] = [], host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const p = facts.product?.price;
  if (p) {
    const prices: Price[] = next.prices ?? [], at = prices.findIndex(x => x.source === host);
    if (at < 0) { prices.push({ source: host, price: p.value, currency: p.currency, updatedAt: now }); changes.push(`${host}: price ${p.currency} ${p.value} added`); }
    else if (prices[at]!.price !== p.value || prices[at]!.currency !== p.currency) { changes.push(`${host}: ${prices[at]!.price} → ${p.value}`); prices[at] = { ...prices[at]!, price: p.value, currency: p.currency, updatedAt: now }; }
    else prices[at] = { ...prices[at]!, updatedAt: now };
    next.prices = prices;
  } else changes.push('No price published on the page');
  // fill specs that are still empty; never overwrite values that exist
  const fresh = facts.product?.specs ?? {}, specs: Specs = { ...next.specs };
  for (const [k, v] of Object.entries(fresh)) if (k !== 'extra' && v !== undefined && (specs as Record<string, unknown>)[k] === undefined) { (specs as Record<string, unknown>)[k] = v; changes.push(`spec ${k} filled`); }
  next.specs = specs;
  return { item: next, changes: changes.filter(c => c !== 'No price published on the page' || !changes.some(x => x !== c)) };
}
