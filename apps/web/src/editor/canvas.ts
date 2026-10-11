// Canvas size (feet) and drawing scale (screen px per foot) live on the project's meta record.
export interface Canvas { w: number; h: number }
export const DEFAULT_CANVAS: Canvas = { w: 100, h: 70 };
export const GRID_CHOICES = [0.5, 1, 2, 5, 10];
export const SCALE_CHOICES: { px: number; label: string }[] = [
  { px: 8, label: 'Large site (8 px/ft)' }, { px: 12, label: 'Whole building (12 px/ft)' }, { px: 20, label: 'Floor plan (20 px/ft) — default' },
  { px: 32, label: 'Single floor, detailed (32 px/ft)' }, { px: 48, label: 'Room level (48 px/ft)' },
];
export const CANVAS_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'Room 20×15 ft', w: 20, h: 15 }, { label: 'House 60×40 ft', w: 60, h: 40 }, { label: 'Large home / small office 100×70 ft', w: 100, h: 70 },
  { label: 'Commercial 200×140 ft', w: 200, h: 140 }, { label: 'Campus 500×350 ft', w: 500, h: 350 },
];
/** The canvas set on a project, or null for older projects that never set one. */
export function canvasOf(meta: Record<string, any>): Canvas | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const w = Number(meta.canvasW), h = Number(meta.canvasH);
  return w > 0 && h > 0 ? { w, h } : null;
}
