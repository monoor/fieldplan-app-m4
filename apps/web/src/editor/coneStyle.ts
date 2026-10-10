// How camera/sensor cones are coloured. "By style" gives each device style (bullet, dome, PTZ, fisheye …) its own colour,
// "each camera" separates every cone, "by category" matches the device colours, "single" uses one colour.
export type ColorBy = 'style' | 'camera' | 'category' | 'single';
export interface ConeOptions { show: boolean; colorBy: ColorBy; opacity: number; clip: boolean; labels: boolean; solo: boolean }
export const DEFAULT_CONES: ConeOptions = { show: true, colorBy: 'style', opacity: 0.22, clip: true, labels: true, solo: false };

export const CATEGORY_COLORS: Record<string, string> = { mech: '#ff9f43', electrical: '#e8a33d', smart: '#7ee08a', network: '#4fd1c5', camera: '#c496ff', access: '#ff7a90', av: '#ffd166', building: '#d7e0e8', other: '#9aa7b4' };

// Chosen to stay apart from each other on the dark canvas.
const STYLE: Record<string, { color: string; name: string }> = {
  'cam-fixed': { color: '#5fb8ff', name: 'Fixed' }, 'cam-bullet': { color: '#3b8bff', name: 'Bullet' }, 'cam-dome': { color: '#b388ff', name: 'Dome / turret' },
  'cam-ptz': { color: '#ff9f43', name: 'PTZ' }, 'cam-lpr': { color: '#ff5d73', name: 'LPR' }, 'cam-fisheye': { color: '#2ee6c5', name: 'Fisheye 360' },
  'cam-pano': { color: '#7be04d', name: 'Panoramic 180' }, 'cam-multi': { color: '#e8d44d', name: 'Multi-sensor' }, doorbell: { color: '#ff7ad9', name: 'Doorbell' },
  motion: { color: '#a3e635', name: 'Motion' }, 's-motion': { color: '#a3e635', name: 'Motion' }, 's-presence': { color: '#34d399', name: 'Presence' }, rex: { color: '#fb923c', name: 'REX' },
};
const FALLBACK = ['#5fb8ff', '#ff9f43', '#b388ff', '#2ee6c5', '#ff5d73', '#e8d44d', '#7be04d', '#ff7ad9'];
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Which style a type belongs to. Vendor models (e.g. "ui-g6-turret") are matched by name, then by their field of view. */
export function styleKey(typeId: string, fov?: number): string {
  if (STYLE[typeId]) return typeId;
  const id = typeId.toLowerCase();
  if (/ptz|speed/.test(id)) return 'cam-ptz';
  if (/lpr|plate/.test(id)) return 'cam-lpr';
  if (/fisheye|360/.test(id) || (fov ?? 0) >= 359) return 'cam-fisheye';
  if (/pano|180|multi|sensor|4k-?4/.test(id) || (fov ?? 0) >= 175) return /multi/.test(id) ? 'cam-multi' : 'cam-pano';
  if (/door|bell|video-?door/.test(id)) return 'doorbell';
  if (/turret|dome/.test(id)) return 'cam-dome';
  if (/bullet/.test(id)) return 'cam-bullet';
  return STYLE[id] ? id : 'cam-fixed';
}
export const styleColor = (typeId: string, fov?: number) => STYLE[styleKey(typeId, fov)]?.color ?? FALLBACK[hash(typeId) % FALLBACK.length]!;
export const styleName = (typeId: string, fov?: number) => STYLE[styleKey(typeId, fov)]?.name ?? typeId;
export const cameraColor = (index: number) => `hsl(${Math.round((index * 137.508) % 360)} 85% 64%)`;

export function coneColor(opts: ConeOptions, d: { typeId: string; catKey: string; color?: string; fov?: number }, index: number): string {
  if (d.color) return d.color;
  switch (opts.colorBy) {
    case 'camera': return cameraColor(index);
    case 'category': return CATEGORY_COLORS[d.catKey] ?? CATEGORY_COLORS.other!;
    case 'single': return '#c496ff';
    default: return styleColor(d.typeId, d.fov);
  }
}

const KEY = 'fp.cones.v1';
export function loadConeOptions(): ConeOptions {
  try { return { ...DEFAULT_CONES, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ConeOptions>) }; } catch { return DEFAULT_CONES; }
}
export function saveConeOptions(o: ConeOptions) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private mode */ } }
