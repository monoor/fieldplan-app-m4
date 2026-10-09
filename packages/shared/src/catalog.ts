// Device catalog items: vendor models with specs, an optional datasheet and photo, and any number of prices.
// Prices are entered per source (distributor, retailer, quote) because they differ by vendor and job.
import { z } from 'zod';

export const CATEGORIES = ['camera', 'network', 'access', 'electrical', 'smart', 'av', 'mech', 'other'] as const;

/** Fieldplan device types a catalog item can behave like on the plan. */
export const DEVICE_TYPE_KEYS = ['cam-fixed', 'cam-bullet', 'cam-dome', 'cam-ptz', 'cam-lpr', 'cam-fisheye', 'cam-pano', 'cam-multi', 'doorbell', 'nvr', 'ap', 'ap-out',
  'nswitch', 'poe-sw', 'poe-inj', 'router', 'firewall', 'modem', 'patch', 'reader', 'reader-kp', 'ctrl', 'maglock', 'strike', 'psu-lock', 'intercom',
  'alarm-panel', 'panel', 'subpanel', 'disconnect', 'xfmr', 'psu', 'ev', 'rtu', 'condenser', 'minisplit', 'spk-ceil', 'spk-wall', 'amp', 'tv', 'other'] as const;

/** Spec fields Fieldplan uses for checks and drawings. Units are in the key name. Unknown extras go in `extra`. */
export const Specs = z.object({
  hfovDeg: z.number().positive().max(360).nullable().optional(),
  vfovDeg: z.number().positive().max(360).nullable().optional(),
  resolutionPx: z.number().int().positive().nullable().optional(),
  megapixels: z.number().positive().nullable().optional(),
  irRangeFt: z.number().nonnegative().nullable().optional(),
  lens: z.string().max(80).nullable().optional(),
  poeStandard: z.string().max(40).nullable().optional(),
  maxPowerW: z.number().nonnegative().nullable().optional(),
  poeBudgetW: z.number().nonnegative().nullable().optional(),
  ports: z.number().int().nonnegative().nullable().optional(),
  poePorts: z.number().int().nonnegative().nullable().optional(),
  sfpPorts: z.number().int().nonnegative().nullable().optional(),
  rackUnits: z.number().nonnegative().nullable().optional(),
  channels: z.number().int().nonnegative().nullable().optional(),
  voltageV: z.number().nonnegative().nullable().optional(),
  currentA: z.number().nonnegative().nullable().optional(),
  va: z.number().nonnegative().nullable().optional(),
  ipRating: z.string().max(10).nullable().optional(),
  ikRating: z.string().max(10).nullable().optional(),
  tempMinC: z.number().nullable().optional(),
  tempMaxC: z.number().nullable().optional(),
  widthMm: z.number().nonnegative().nullable().optional(),
  heightMm: z.number().nonnegative().nullable().optional(),
  depthMm: z.number().nonnegative().nullable().optional(),
  weightKg: z.number().nonnegative().nullable().optional(),
  wireless: z.string().max(80).nullable().optional(),
  extra: z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
});
export type Specs = z.infer<typeof Specs>;

export const Price = z.object({
  source: z.string().min(1).max(120),
  price: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  note: z.string().max(300).optional(),
  updatedAt: z.string().optional(),
});
export type Price = z.infer<typeof Price>;

export const CatalogItemInput = z.object({
  vendor: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  name: z.string().max(200).default(''),
  category: z.enum(CATEGORIES),
  /** v1 device type this behaves like on the plan (e.g. cam-dome, poe-sw, panel). */
  typeKey: z.string().max(60).optional(),
  specs: Specs.default({}),
  prices: z.array(Price).max(50).default([]),
  sourceUrl: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  datasheetSha: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  imageSha: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  notes: z.string().max(5000).optional(),
});
export type CatalogItemInput = z.infer<typeof CatalogItemInput>;
export interface CatalogItem extends CatalogItemInput { id: string; createdAt: string; updatedAt: string }

/** What an import from a web page returns for review before saving. */
export interface ImportDraft {
  sourceUrl: string;
  item: Partial<CatalogItemInput> & { specs: Specs };
  /** Candidate datasheet / image links found on the page. */
  datasheets: string[];
  images: string[];
  /** Which extractors contributed: 'json-ld', 'opengraph', 'claude'. */
  via: string[];
  warnings: string[];
}
