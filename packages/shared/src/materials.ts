// Floor/area, wall, door and window styles (ported from Fieldplan v1). Pure data: used by the editor, read-only views and export.
export interface SurfaceMat { id: string; label: string; color: string; pat: string; group: string; room?: boolean; hidden?: boolean }
export interface WallMat { id: string; label: string; color: string; thick: number; a24: number; a5: number; dash?: string }

export const SURFACE_MATS: SurfaceMat[] = [ { "id": "grass", "label": "Grass / lawn", "color": "#2f6b3b", "pat": "grass", "group": "Exterior" },
  { "id": "turf", "label": "Artificial turf", "color": "#3f9a4a", "pat": "grass", "group": "Exterior" },
  { "id": "asphalt", "label": "Asphalt pavement", "color": "#3b4047", "pat": "speck", "group": "Exterior" },
  { "id": "concrete", "label": "Concrete slab / sidewalk", "color": "#8d949b", "pat": "joints", "group": "Exterior" },
  { "id": "pavers", "label": "Pavers / brick", "color": "#9a7b62", "pat": "brick", "group": "Exterior" },
  { "id": "gravel", "label": "Gravel / stone", "color": "#7d7a70", "pat": "dots", "group": "Exterior" },
  { "id": "mulch", "label": "Mulch / bed", "color": "#5a3b27", "pat": "speck", "group": "Exterior" },
  { "id": "dirt", "label": "Dirt / unimproved", "color": "#6b5236", "pat": "none", "group": "Exterior" },
  { "id": "sand", "label": "Sand", "color": "#d0b978", "pat": "dots", "group": "Exterior" },
  { "id": "water", "label": "Water / pond", "color": "#2b5f8f", "pat": "waves", "group": "Exterior" },
  { "id": "pool", "label": "Pool", "color": "#2fa6c9", "pat": "waves", "group": "Exterior" },
  { "id": "deck", "label": "Wood deck", "color": "#8b5a2b", "pat": "planks", "group": "Exterior" },
  { "id": "rubber", "label": "Rubber / playground", "color": "#a34848", "pat": "dots", "group": "Exterior" },
  { "id": "roof", "label": "Roof", "color": "#4a3f3a", "pat": "hatch", "group": "Exterior" },
  { "id": "solar", "label": "Solar array", "color": "#1d3a5c", "pat": "joints", "group": "Exterior" },
  { "id": "tile", "label": "Tile", "color": "#aeb4ba", "pat": "grid", "group": "Interior" },
  { "id": "hardwood", "label": "Hardwood / LVP", "color": "#a86f3e", "pat": "planks", "group": "Interior" },
  { "id": "carpet", "label": "Carpet", "color": "#5d5f7a", "pat": "none", "group": "Interior" },
  { "id": "epoxy", "label": "Epoxy / sealed concrete", "color": "#7b8590", "pat": "none", "group": "Interior" },
  { "id": "raised", "label": "Raised floor / data", "color": "#4f6f8a", "pat": "grid", "group": "Interior" },
  { "id": "wet", "label": "Wet / washdown area", "color": "#3f7f9f", "pat": "joints", "group": "Interior" },
  { "id": "hazard", "label": "Hazard / keep-clear", "color": "#b8891f", "pat": "hatch", "group": "Interior" },
  { "id": "room", "label": "Room (named area)", "color": "#5fb8ff", "pat": "none", "group": "Rooms / zones", "room": true },
  { "id": "zone", "label": "Zone / coverage area", "color": "#c496ff", "pat": "none", "group": "Rooms / zones", "room": true },
  { "id": "itroom", "label": "IT / mech room", "color": "#ffd166", "pat": "none", "group": "Rooms / zones", "room": true },
  { "id": "secure", "label": "Secure / restricted area", "color": "#ff7a90", "pat": "hatch", "group": "Rooms / zones", "room": true }
];
SURFACE_MATS.push({ id: 'floor', label: 'Floor', color: '#8a96a3', pat: 'none', group: 'Interior', hidden: true });
export const WALL_MATS: WallMat[] = [ { "id": "stud", "label": "Wood stud / drywall", "color": "#d7e0e8", "thick": 4.5, "a24": 3, "a5": 4 },
  { "id": "mstud", "label": "Metal stud / drywall", "color": "#c5d3e0", "thick": 5, "a24": 4, "a5": 6 },
  { "id": "ext-frame", "label": "Framed exterior (siding)", "color": "#bcc9d6", "thick": 6, "a24": 5, "a5": 8 },
  { "id": "brick", "label": "Brick", "color": "#b8654a", "thick": 8, "a24": 6, "a5": 10 },
  { "id": "cmu", "label": "CMU block", "color": "#a9adb3", "thick": 8, "a24": 8, "a5": 12 },
  { "id": "concrete", "label": "Poured concrete", "color": "#8a9099", "thick": 8, "a24": 10, "a5": 20 },
  { "id": "icf", "label": "ICF", "color": "#9aa5b0", "thick": 12, "a24": 12, "a5": 22 },
  { "id": "tiltup", "label": "Tilt-up concrete", "color": "#7f868e", "thick": 7, "a24": 12, "a5": 22 },
  { "id": "metal", "label": "Metal panel / IMP", "color": "#b0b8c0", "thick": 4, "a24": 15, "a5": 25 },
  { "id": "glass", "label": "Glass / storefront", "color": "#9fd6f0", "thick": 1, "a24": 2, "a5": 6 },
  { "id": "lowe", "label": "Low-E glass", "color": "#7cc2e8", "thick": 1, "a24": 10, "a5": 20 },
  { "id": "partition", "label": "Glass partition", "color": "#bfe6f7", "thick": 0.5, "a24": 2, "a5": 4 },
  { "id": "log", "label": "Log / timber", "color": "#a87a4a", "thick": 8, "a24": 6, "a5": 8 },
  { "id": "freezer", "label": "Cooler / freezer panel", "color": "#cfe8ee", "thick": 5, "a24": 14, "a5": 22 },
  { "id": "chain", "label": "Chain-link fence", "color": "#cfd6dc", "thick": 0.5, "a24": 1, "a5": 1, "dash": "6 5" },
  { "id": "privacy", "label": "Privacy fence (wood)", "color": "#b58b5a", "thick": 1, "a24": 3, "a5": 4 },
  { "id": "vinyl", "label": "Vinyl fence", "color": "#e8e8e8", "thick": 1, "a24": 2, "a5": 3 },
  { "id": "retain", "label": "Retaining wall", "color": "#8b8f85", "thick": 12, "a24": 20, "a5": 30 }
];

export const surfaceMat = (id?: string): SurfaceMat => SURFACE_MATS.find(m => m.id === id) ?? SURFACE_MATS.find(m => m.id === 'floor')!;
export const wallMat = (id?: string): WallMat => WALL_MATS.find(m => m.id === id) ?? WALL_MATS[0]!;

export const DOOR_TYPES: [string, string][] = [['single', 'Single swing'], ['double', 'Double swing'], ['sliding', 'Sliding'], ['pocket', 'Pocket'], ['overhead', 'Overhead / garage'], ['opening', 'Cased opening']];
export const WINDOW_TYPES: [string, string][] = [['fixed', 'Fixed'], ['single-hung', 'Single / double hung'], ['slider', 'Slider'], ['casement', 'Casement'], ['storefront', 'Storefront glass'], ['glass-door', 'Glass door (sees through)']];
