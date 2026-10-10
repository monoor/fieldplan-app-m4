// Camera resolution helpers: DORI distances (EN 62676-4 pixel densities) and bitrate / storage estimates.
export const HPX_OPTIONS: [number, string][] = [[1920, '1080p (1920)'], [2560, '4 MP (2560)'], [2688, '4 MP wide (2688)'], [3840, '4K / 8 MP (3840)'], [4512, '12 MP (4512)'], [7680, 'Dual 4K (7680)']];
export const DEFAULT_HPX = 2560;
/** Required pixels per foot (EN 62676-4: 250 / 125 / 62.5 / 25 px per metre). */
export const DORI_LEVELS = [{ key: 'I', label: 'Identify', ppf: 76 }, { key: 'R', label: 'Recognize', ppf: 38 }, { key: 'O', label: 'Observe', ppf: 19 }, { key: 'D', label: 'Detect', ppf: 7.6 }] as const;

/** Distance (ft) at which the scene still has `ppf` pixels per foot across the field of view. */
export function doriDistance(hpx: number, fovDeg: number, ppf: number): number {
  const width = fovDeg >= 120 ? (fovDeg * Math.PI) / 180 : 2 * Math.tan((fovDeg / 2) * Math.PI / 180);
  return hpx / (width * ppf);
}
export const doriTable = (hpx: number, fovDeg: number) => DORI_LEVELS.map(l => ({ ...l, ft: doriDistance(hpx, fovDeg, l.ppf) }));

/** Typical H.264 bitrate (Mbps) for a camera at 15–20 fps, medium quality, by horizontal resolution. */
const H264: [number, number][] = [[1920, 4], [2560, 6], [2688, 6], [3840, 12], [4512, 16], [7680, 24]];
export function bitrateMbps(hpx: number, codec: string | undefined, override?: number): number {
  if (override && override > 0) return override;
  const base = (H264.find(([h]) => hpx <= h) ?? H264[H264.length - 1]!)[1];
  return codec === 'h265' ? base * 0.6 : base;
}
/** Terabytes (decimal) needed to record `mbps` for `days`, with `activity` = share of the day actually recorded (1 = continuous). */
export const storageTB = (mbps: number, days: number, activity = 1) => (mbps / 8) * 86400 * days * activity / 1e6;
