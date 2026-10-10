// Bill of materials from a project's records: devices (grouped by catalog item or built-in type), cable by type with slack, doors/windows.
import { deviceType } from './devicetypes.js';
import { pathLength, type Rec } from './checks.js';

export interface BomSettings { slackPct: number; markupPct: number; laborHours: number; laborRate: number; prices: Record<string, number> }
export const DEFAULT_BOM: BomSettings = { slackPct: 10, markupPct: 0, laborHours: 0, laborRate: 95, prices: {} };
export interface CatalogRef { id: string; vendor: string; model: string; name: string; prices: { price: number }[] }
export interface BomLine { key: string; section: 'Devices' | 'Cable' | 'Openings'; description: string; detail: string; qty: number; unit: 'ea' | 'ft'; unitPrice: number | null; priceFromCatalog: boolean; ext: number }

export function buildBom(records: Rec[], scaleOf: (sheetId: string | null) => number, s: BomSettings, catalog: Map<string, CatalogRef> = new Map()) {
  const lines = new Map<string, BomLine>();
  const bump = (key: string, base: Omit<BomLine, 'key' | 'qty' | 'unitPrice' | 'priceFromCatalog' | 'ext'>, qty: number, catalogPrice?: number) => {
    const l = lines.get(key) ?? { key, ...base, qty: 0, unitPrice: null, priceFromCatalog: false, ext: 0 }; l.qty += qty;
    const own = s.prices[key]; if (own !== undefined) { l.unitPrice = own; l.priceFromCatalog = false; } else if (catalogPrice !== undefined) { l.unitPrice = catalogPrice; l.priceFromCatalog = true; }
    lines.set(key, l);
  };
  for (const r of records) {
    if (r.deleted) continue;
    if (r.kind === 'device') {
      const cat = r.data.catalogId ? catalog.get(r.data.catalogId) : undefined, t = deviceType(r.data.typeId);
      if (cat) bump('cat:' + cat.id, { section: 'Devices', description: `${cat.vendor} ${cat.model}`, detail: cat.name, unit: 'ea' }, 1, cat.prices.length ? Math.min(...cat.prices.map(p => p.price)) : undefined);
      else bump('type:' + r.data.typeId, { section: 'Devices', description: t?.label ?? String(r.data.typeId), detail: t?.cat ?? '', unit: 'ea' }, 1);
    } else if (r.kind === 'cable') {
      const ft = (pathLength(r.data.points) / (scaleOf(r.sheetId ?? null) || 20)) * (1 + s.slackPct / 100);
      bump('cable:' + r.data.cableType, { section: 'Cable', description: String(r.data.cableType), detail: `${s.slackPct}% slack included`, unit: 'ft' }, ft);
    } else if (r.kind === 'opening') {
      const k = r.data.kind === 'window' ? 'window' : 'door' + ':' + (r.data.doorType ?? 'single');
      bump('opening:' + k, { section: 'Openings', description: r.data.kind === 'window' ? 'Window' : 'Door — ' + (r.data.doorType ?? 'single'), detail: '', unit: 'ea' }, 1);
    }
  }
  const out = [...lines.values()].map(l => ({ ...l, qty: l.unit === 'ft' ? Math.ceil(+l.qty.toFixed(6)) : l.qty, ext: 0 })).map(l => ({ ...l, ext: (l.unitPrice ?? 0) * l.qty }))
    .sort((a, b) => ['Devices', 'Cable', 'Openings'].indexOf(a.section) - ['Devices', 'Cable', 'Openings'].indexOf(b.section) || a.description.localeCompare(b.description));
  const materials = out.reduce((t, l) => t + l.ext, 0), markup = materials * (s.markupPct / 100), labor = s.laborHours * s.laborRate;
  return { lines: out, materials, markup, labor, total: materials + markup + labor, unpriced: out.filter(l => l.unitPrice === null && l.section !== 'Openings').length };
}
