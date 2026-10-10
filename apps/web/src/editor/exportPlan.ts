// Export a sheet as SVG / PNG / PDF: print-style colours, title block and a legend of what's on the drawing.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEVICE_TYPES, surfaceMat, wallMat, type ProjectRecord } from '@fieldplan/shared';
import { Scene, type SceneRec } from './Scene';
import { bounds } from './bounds';
import { CATEGORY_COLORS, type ConeOptions } from './coneStyle';
import { CABLE_TYPES } from './tools';

export type ExportFormat = 'svg' | 'png' | 'pdf';
export const PAPERS = { letter: { label: 'Letter 11×8.5″', w: 11, h: 8.5 }, tabloid: { label: 'Tabloid 17×11″', w: 17, h: 11 }, archd: { label: 'ARCH D 36×24″', w: 36, h: 24 } } as const;
export interface ExportOpts { fmt: ExportFormat; paper: keyof typeof PAPERS; legend: boolean; cones: ConeOptions; projectName: string; client?: string | null; sheetName: string; scale: number }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SANS = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

async function dataUrl(url: string): Promise<string> {
  const r = await fetch(url); if (!r.ok) throw new Error('Could not load the underlay image');
  const b = await r.blob(); return await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(b); });
}

/** Build the drawing sheet as a standalone SVG string (page units = CSS pixels at 96 dpi). */
export async function buildSheetSvg(records: (SceneRec | ProjectRecord)[], o: ExportOpts, fileUrl: (sha: string) => string): Promise<{ svg: string; w: number; h: number }> {
  const recs = records as SceneRec[];
  const paper = PAPERS[o.paper], W = paper.w * 96, H = paper.h * 96, m = 0.4 * 96, tbH = 0.9 * 96, legW = o.legend ? Math.min(3.2, paper.w * 0.22) * 96 : 0;
  const urls = new Map<string, string>();
  for (const r of recs) if (r.kind === 'underlay' && r.data.fileSha && !urls.has(r.data.fileSha)) urls.set(r.data.fileSha, await dataUrl(fileUrl(r.data.fileSha)));
  const b = bounds(recs, o.scale), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const px = m, py = m, pw = W - m * 2 - legW, ph = H - m * 2 - tbH - 6;
  const fit = Math.min(pw / bw, ph / bh), ox = px + (pw - bw * fit) / 2, oy = py + (ph - bh * fit) / 2;
  const plan = renderToStaticMarkup(createElement(Scene, { recs, scale: o.scale, fileUrl: s => urls.get(s) ?? '', cones: o.cones, light: true, unit: 1 / fit }));

  // Legend: only what is actually on the sheet.
  const cnt = new Map<string, number>(), cables = new Map<string, number>(), floors = new Set<string>(), walls = new Set<string>();
  for (const r of recs) {
    if (r.kind === 'device') cnt.set(r.data.typeId, (cnt.get(r.data.typeId) ?? 0) + 1);
    else if (r.kind === 'cable') cables.set(r.data.cableType, (cables.get(r.data.cableType) ?? 0) + 1);
    else if (r.kind === 'surface') floors.add(r.data.matId); else if (r.kind === 'wall') walls.add(r.data.mat ?? '');
  }
  let ly = 0; const L: string[] = [], lx = W - m - legW + 14, row = 15;
  const head = (t: string) => { ly += 8; L.push(`<text x="${lx}" y="${ly + 12}" font-size="11" font-weight="700" fill="#1b2733" font-family="${SANS}">${esc(t)}</text>`); ly += row + 2; };
  const item = (sw: string, t: string, n?: number) => { L.push(sw.replace('X', String(lx)).replace('Y', String(ly)) + `<text x="${lx + 24}" y="${ly + 9}" font-size="10" fill="#1b2733" font-family="${SANS}">${esc(t)}${n ? ' ×' + n : ''}</text>`); ly += row; };
  if (o.legend) {
    L.push(`<text x="${lx}" y="${m + 14}" font-size="13" font-weight="700" fill="#1b2733" font-family="${SANS}">Legend</text>`); ly = m + 20;
    if (cnt.size) { head('Devices'); for (const [id, n] of [...cnt].sort((a, c) => c[1] - a[1]).slice(0, 28)) { const t = DEVICE_TYPES.find(x => x.id === id), col = CATEGORY_COLORS[t?.cat ?? 'other'] ?? '#999'; item(`<circle cx="${lx + 8}" cy="${ly + 5}" r="6" fill="${col}" stroke="#1b2733" stroke-width="1"/>`, (t?.label ?? id), n); } }
    if (cables.size) { head('Cables'); for (const [id, n] of cables) { const c = CABLE_TYPES.find(x => x.id === id), col = CATEGORY_COLORS[c?.category ?? ''] ?? '#999'; item(`<line x1="X" y1="${ly + 5}" x2="${lx + 18}" y2="${ly + 5}" stroke="${col}" stroke-width="2.5"/>`.replace('X', String(lx)), c?.label ?? id, n); } }
    if (floors.size) { head('Floors & areas'); for (const id of floors) { const f = surfaceMat(id); item(`<rect x="${lx}" y="${ly}" width="18" height="10" fill="${f.color}" fill-opacity=".6" stroke="${f.color}"/>`, f.label); } }
    if (walls.size) { head('Walls'); for (const id of walls) { const w = wallMat(id); item(`<rect x="${lx}" y="${ly + 2}" width="18" height="6" fill="${w.color}" stroke="#1b2733" stroke-width=".6"/>`, w.label); } }
  }
  const tx = m, ty = H - m - tbH, date = new Date().toLocaleDateString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<rect width="${W}" height="${H}" fill="#fff"/>
<rect x="${m / 2}" y="${m / 2}" width="${W - m}" height="${H - m}" fill="none" stroke="#1b2733" stroke-width="1.5"/>
<svg x="${px}" y="${py}" width="${pw}" height="${ph}" viewBox="${b.x0} ${b.y0} ${bw} ${bh}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><g>${plan}</g></svg>
${o.legend ? `<line x1="${W - m - legW}" y1="${m}" x2="${W - m - legW}" y2="${H - m - tbH - 6}" stroke="#c4ccd4"/>` + L.join('') : ''}
<rect x="${tx}" y="${ty}" width="${W - m * 2}" height="${tbH}" fill="#f4f6f8" stroke="#1b2733"/>
<text x="${tx + 14}" y="${ty + 30}" font-size="22" font-weight="700" fill="#1b2733">${esc(o.projectName)}</text>
<text x="${tx + 14}" y="${ty + 52}" font-size="12" fill="#5a6b7a">${esc([o.client, o.sheetName].filter(Boolean).join(' · '))}</text>
<text x="${W - m - 14}" y="${ty + 30}" font-size="13" text-anchor="end" fill="#1b2733" font-weight="600">${esc(o.sheetName)}</text>
<text x="${W - m - 14}" y="${ty + 52}" font-size="11" text-anchor="end" fill="#5a6b7a">${date} · ${recs.filter(r => r.kind === 'device').length} devices · Fieldplan</text>
</svg>`;
  return { svg, w: W, h: H };
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function rasterize(svg: string, w: number, h: number, pxScale: number): Promise<HTMLCanvasElement> {
  const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    img.src = url; await img.decode();
    const c = document.createElement('canvas'), s = Math.min(pxScale, 8192 / Math.max(w, h)); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); return c;
  } finally { URL.revokeObjectURL(url); }
}

export async function exportSheet(records: (SceneRec | ProjectRecord)[], o: ExportOpts, fileUrl: (sha: string) => string) {
  const { svg, w, h } = await buildSheetSvg(records, o, fileUrl);
  const base = (o.projectName + ' - ' + o.sheetName).replace(/[^\w\- ]+/g, '').trim() || 'plan';
  if (o.fmt === 'svg') return download(new Blob([svg], { type: 'image/svg+xml' }), base + '.svg');
  const canvas = await rasterize(svg, w, h, o.fmt === 'pdf' ? 200 / 96 : 2);
  if (o.fmt === 'png') return download(await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png')), base + '.png');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [PAPERS[o.paper].w, PAPERS[o.paper].h] });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, PAPERS[o.paper].w, PAPERS[o.paper].h);
  download(pdf.output('blob'), base + '.pdf');
}
