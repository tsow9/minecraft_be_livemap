// Home-made 16×16 pixel textures for the 3D view (not the game's own pictures, which may not be shared).
// Each texture is a light/dark pattern; the colour comes from the map, so the land keeps its real colours.
// All textures sit side by side in one picture (an atlas).

export const TEX = {
  grassTop: 0, grassBand: 1, dirt: 2, stone: 3, cobble: 4, sand: 5, gravel: 6, logSide: 7,
  logTop: 8, planks: 9, leaves: 10, bricks: 11, snow: 12, water: 13, plain: 14, wool: 15,
};
export const TILE_COUNT = 16;

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Points spread over the tile; each pixel takes the nearest one (wrapping round the edges so tiles join up).
function cells(r, count) {
  const pts = Array.from({ length: count }, () => [r() * 16, r() * 16, r()]);
  return (x, y) => {
    let a = Infinity, b = Infinity, id = 0;
    pts.forEach(([px, py], i) => {
      const dx = Math.min(Math.abs(x + 0.5 - px), 16 - Math.abs(x + 0.5 - px));
      const dy = Math.min(Math.abs(y + 0.5 - py), 16 - Math.abs(y + 0.5 - py));
      const d = Math.hypot(dx, dy);
      if (d < a) { b = a; a = d; id = i; } else if (d < b) b = d;
    });
    return { id, shade: pts[id][2], edge: b - a };
  };
}

// Each maker returns [light 0..1, opacity 0..1] for pixel (x, y); y = 0 is the top row.
const MAKERS = {
  grassTop: (r) => () => [0.72 + r() * 0.22 - (r() < 0.12 ? 0.15 : 0), 1],
  grassBand: (r) => {
    const depth = Array.from({ length: 16 }, () => 2 + (r() < 0.6 ? 1 : 0) + (r() < 0.35 ? 1 : 0) + (r() < 0.15 ? 1 : 0));
    return (x, y) => (y < depth[x] ? [0.72 + r() * 0.22, 1] : [0, 0]);
  },
  dirt: (r) => () => {
    const v = r();
    return [v < 0.1 ? 0.55 : v > 0.9 ? 0.98 : 0.72 + r() * 0.14, 1];
  },
  stone: (r) => {
    const c = cells(r, 9);
    return (x, y) => {
      const { shade, edge } = c(x, y);
      return [0.74 + shade * 0.12 + r() * 0.06 - (edge < 0.6 && r() < 0.5 ? 0.08 : 0), 1];
    };
  },
  cobble: (r) => {
    const c = cells(r, 7);
    return (x, y) => {
      const { shade, edge } = c(x, y);
      return [edge < 1 ? 0.42 + r() * 0.08 : 0.68 + shade * 0.26 + r() * 0.05, 1];
    };
  },
  sand: (r) => () => [0.86 + r() * 0.1 - (r() < 0.08 ? 0.1 : 0), 1],
  gravel: (r) => {
    const c = cells(r, 14);
    return (x, y) => {
      const { shade, edge } = c(x, y);
      return [edge < 0.5 ? 0.5 : 0.55 + shade * 0.42, 1];
    };
  },
  logSide: (r) => {
    const col = Array.from({ length: 16 }, (_, x) => (x % 4 === 0 ? 0.55 : 0.72 + r() * 0.16));
    return (x) => [col[x] + r() * 0.06, 1];
  },
  logTop: (r) => (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [0.55 + r() * 0.08, 1];
    const d = Math.hypot(x - 7.5, y - 7.5);
    return [(Math.floor(d * 0.75) % 2 ? 0.92 : 0.78) + r() * 0.05, 1];
  },
  planks: (r) => {
    const board = [0.84, 0.76, 0.88, 0.8].map((v) => v + r() * 0.04);
    const cut = [3, 11, 7, 14].map((v) => (v + Math.floor(r() * 3)) % 16);
    return (x, y) => {
      const b = y >> 2;
      if (y % 4 === 3 || x === cut[b]) return [0.52, 1];
      return [board[b] + (r() - 0.5) * 0.08, 1];
    };
  },
  leaves: (r) => () => (r() < 0.2 ? [0, 0] : [0.68 + r() * 0.26, 1]),
  bricks: (r) => (x, y) => {
    const row = y >> 2, shift = row % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + shift) % 8 === 7) return [0.98, 1];
    return [0.7 + r() * 0.12, 1];
  },
  snow: (r) => () => [0.93 + r() * 0.07, 1],
  water: (r) => (x, y) => {
    const wave = Math.sin((x + Math.sin(y * 0.9) * 2) * 0.8 + y * 1.6);
    return [0.8 + (wave > 0.75 ? 0.15 : 0) + r() * 0.04, 1];
  },
  plain: (r) => {
    const c = cells(r, 20);
    return (x, y) => [0.78 + c(x, y).shade * 0.12 + r() * 0.04, 1];
  },
  wool: (r) => (x, y) => [0.8 + ((x + y) % 4 === 0 ? 0.07 : 0) + r() * 0.08, 1],
};

// Draws the atlas; also returns, per texture, 1 / its average lightness so colours keep their brightness.
export function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = 16 * TILE_COUNT; c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, 16);
  const boost = new Float32Array(TILE_COUNT);
  for (const [name, tile] of Object.entries(TEX)) {
    const px = MAKERS[name](rng(tile * 7919 + 17));
    let sum = 0, n = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const [v, a] = px(x, y);
        const l = Math.max(0, Math.min(1, v));
        const i = (y * c.width + tile * 16 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(l * 255);
        img.data[i + 3] = a ? 255 : 0;
        if (a) { sum += l; n++; }
      }
    }
    boost[tile] = n ? n / sum : 1;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, boost };
}

// Which texture a block gets, from its name. Natural ground also decides what lies under it.
const RULES = [
  [/water/, 'water'],
  [/leaves|wart_block|azalea$/, 'leaves'],
  [/snow|ice/, 'snow'],
  [/grass_block|mycelium|podzol|moss_block/, 'grass'],
  [/brick/, 'bricks'],
  [/cobble|mossy/, 'cobble'],
  [/sandstone/, 'sandstoneBlock'],
  [/sand/, 'sand'],
  [/gravel/, 'gravel'],
  [/dirt|farmland|mud|clay/, 'dirt'],
  [/_log|_wood|_stem|hyphae|bamboo_block/, 'log'],
  [/planks|_slab|_stairs|fence|door|bookshelf|crafting_table|chest|barrel|scaffolding/, 'planks'],
  [/wool|carpet|concrete|terracotta/, 'wool'],
  [/stone|andesite|diorite|granite|deepslate|tuff|calcite|_ore|basalt|blackstone|bedrock|netherrack|end_stone/, 'stone'],
];

export function kindOf(name) {
  const n = name || '';
  for (const [re, kind] of RULES) if (re.test(n)) return kind;
  return 'plain';
}

// Texture of the top, of the sides, and whether the column is natural ground (dirt and stone under it).
export const LOOK = {
  grass: { top: TEX.grassTop, side: TEX.dirt, band: true, natural: true, fill: 'dirt' },
  snow: { top: TEX.snow, side: TEX.dirt, band: true, natural: true, fill: 'dirt' },
  dirt: { top: TEX.dirt, side: TEX.dirt, natural: true, fill: 'dirt' },
  sand: { top: TEX.sand, side: TEX.sand, natural: true, fill: 'same' },
  gravel: { top: TEX.gravel, side: TEX.gravel, natural: true, fill: 'same' },
  stone: { top: TEX.stone, side: TEX.stone, natural: true, fill: 'same' },
  sandstoneBlock: { top: TEX.sand, side: TEX.sand },
  cobble: { top: TEX.cobble, side: TEX.cobble },
  bricks: { top: TEX.bricks, side: TEX.bricks },
  log: { top: TEX.logTop, side: TEX.logSide },
  planks: { top: TEX.planks, side: TEX.planks },
  wool: { top: TEX.wool, side: TEX.wool },
  leaves: { top: TEX.leaves, side: TEX.leaves },
  water: { top: TEX.water, side: TEX.water },
  plain: { top: TEX.plain, side: TEX.plain },
};
