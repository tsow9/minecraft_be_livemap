// 3D view (try-out): walk around the land in plain-coloured blocks, like a street view.
// It is built from the same files as the map: the map picture for colours, the info tiles for the top block
// and the ground tiles for the ground under trees. Only the top of the land is known, so caves and the
// insides of buildings are not shown; every column is drawn solid from the ground down.
import * as THREE from '../vendor/three/three.module.min.js';

// Same version tag as this file, so a site update never mixes old and new parts.
const { TEX, TILE_COUNT, makeAtlas, kindOf, LOOK } = await import(`./street-textures.js${new URL(import.meta.url).search}`);

// How far around you the land is built, in blocks (a little less on phones to stay smooth).
const RADIUS = matchMedia('(pointer: coarse)').matches ? 72 : 96;
const REBUILD_AFTER = 40;   // build again once you have walked this far from the last build
const EYE = 1.62;
const WALK = 4.3, RUN = 5.6, SWIM = 2.2;  // blocks per second, as in the game
const GRAVITY = 32, JUMP = 8.4;
const SKY = { overworld: 0x9fc6f2, nether: 0x3a1410, end: 0x1a1426 };
const SEABED = [118, 110, 82];
const TRUNK = [104, 80, 52];
const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

// Colours go to the screen exactly as the map has them (no colour-space conversion).
THREE.ColorManagement.enabled = false;

// ---------- reading the tiles ----------
const tileCache = new Map();

function loadPixels(url) {
  if (!url) return Promise.resolve(null);
  if (tileCache.has(url)) return tileCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height).data);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  tileCache.set(url, p);
  if (tileCache.size > 60) tileCache.delete(tileCache.keys().next().value);
  return p;
}

// The land around (cx, cz) as flat arrays, one entry per block column.
async function readLand(cx, cz, tileUrl, names, dim) {
  const size = RADIUS * 2 + 1, x0 = cx - RADIUS, z0 = cz - RADIUS;
  const tiles = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + size - 1) / 256); tx++) {
    for (let tz = Math.floor(z0 / 256); tz <= Math.floor((z0 + size - 1) / 256); tz++) {
      tiles.push(Promise.all([loadPixels(tileUrl('map', tx, tz)), loadPixels(tileUrl('info', tx, tz)), loadPixels(tileUrl('ground', tx, tz))])
        .then(([map, info, ground]) => ({ tx, tz, map, info, ground })));
    }
  }
  const n = size * size;
  const land = {
    x0, z0, size, dim,
    solid: new Int16Array(n).fill(-999),  // height of the walkable top (top face of the highest ground block)
    top: new Int16Array(n).fill(-999),    // the highest block (leaves, water surface, ...)
    kind: new Uint8Array(n),              // 0 nothing known, 1 ground, 2 something above the ground (trees), 3 water
    plant: new Uint8Array(n),             // 1 = a plant or thin layer on the ground; the ground itself is not known
    rgb: new Uint8Array(n * 3),           // colour of the top block
    look: new Array(n),                   // texture group of the top block (see LOOK)
    under: new Uint8Array(n * 3),         // colour of the ground itself
    underLook: new Array(n),
  };
  for (const t of await Promise.all(tiles)) {
    if (!t.map || !t.info) continue;
    for (let i = 0; i < size; i++) {
      const z = z0 + i, lz = z - t.tz * 256;
      if (lz < 0 || lz > 255) continue;
      for (let j = 0; j < size; j++) {
        const x = x0 + j, lx = x - t.tx * 256;
        if (lx < 0 || lx > 255) continue;
        const p = (lz * 256 + lx) * 4;
        if (!t.map[p + 3]) continue;
        const v = (t.info[p] << 16) | (t.info[p + 1] << 8) | t.info[p + 2];
        if (!(v >> 9)) continue;
        const k = i * size + j;
        const topY = (v & 511) - 64;
        const gv = t.ground ? (t.ground[p] << 8) | t.ground[p + 1] : 0;
        const wet = t.ground ? t.ground[p + 2] > 0 : false;
        const g = gv ? gv - 65 : null;
        land.top[k] = topY;
        land.rgb.set([t.map[p], t.map[p + 1], t.map[p + 2]], k * 3);
        land.look[k] = kindOf(names[v >> 9]);
        if (wet) {
          land.kind[k] = 3;
          land.solid[k] = g !== null && g < topY ? g + 1 : topY - 2;
        } else if (g !== null && topY > g + 1) {
          land.kind[k] = 2;
          land.solid[k] = g + 1;
        } else {
          land.kind[k] = 1;
          land.solid[k] = (g !== null ? g : topY) + 1;
          land.plant[k] = topY >= land.solid[k] ? 1 : 0;
        }
      }
    }
  }
  unshade(land);
  groundColours(land);
  return land;
}

// The map picture is a little lighter on slopes facing north and darker facing south; take that back out.
function unshade(land) {
  const { size, top, kind, rgb } = land;
  for (let i = size - 1; i >= 1; i--) {
    for (let j = 0; j < size; j++) {
      const k = i * size + j, n = k - size;
      if (kind[k] === 0 || kind[k] === 3 || kind[n] === 0 || kind[n] === 3) continue;
      const dh = top[k] - top[n];
      const f = dh > 0 ? 1.1 : dh < 0 ? 0.84 : 1;
      if (f !== 1) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.min(255, Math.round(rgb[k * 3 + c] / f));
    }
  }
}

// Under trees and plants the ground is unknown: borrow it from the nearest open natural ground.
function groundColours(land) {
  const { size, kind, plant, rgb, look, under, underLook } = land;
  const known = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) {
    if (kind[k] === 1 && !plant[k] && LOOK[look[k]]?.natural) {
      under.set(rgb.subarray(k * 3, k * 3 + 3), k * 3); underLook[k] = look[k]; known[k] = 1;
    } else if (kind[k] === 3) {
      under.set(SEABED, k * 3); underLook[k] = 'sand'; known[k] = 1;
    }
  }
  const spread = (k, from) => {
    if (known[k] || !known[from] || kind[from] === 3) return;
    under.copyWithin(k * 3, from * 3, from * 3 + 3); underLook[k] = underLook[from]; known[k] = 2;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < size; i++) {
      for (let j = 1; j < size; j++) spread(i * size + j, i * size + j - 1);
      for (let j = size - 2; j >= 0; j--) spread(i * size + j, i * size + j + 1);
    }
    for (let j = 0; j < size; j++) {
      for (let i = 1; i < size; i++) spread(i * size + j, (i - 1) * size + j);
      for (let i = size - 2; i >= 0; i--) spread(i * size + j, (i + 1) * size + j);
    }
  }
  const fallback = land.dim === 'overworld' ? 'grass' : 'stone';
  for (let k = 0; k < size * size; k++) {
    if (!known[k]) { under.set(land.dim === 'overworld' ? [96, 128, 62] : [110, 52, 50], k * 3); underLook[k] = fallback; }
  }
}

// ---------- building the blocks ----------
const hash = (a, b, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
};

const atlas = makeAtlas();
const INSET = 0.02 / (16 * TILE_COUNT);

class Faces {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }

  // A rectangle given by its four corners (counter-clockwise seen from outside, starting bottom left),
  // a colour, a texture and which part of the texture (v0..v1, bottom to top) it shows.
  quad(a, b, c, d, rgb, light, tile, v0 = 0, v1 = 1) {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    const l = light * atlas.boost[tile] / 255;
    const r = rgb[0] * l, g = rgb[1] * l, bl = rgb[2] * l;
    for (let i = 0; i < 4; i++) this.col.push(r, g, bl);
    const u0 = tile / TILE_COUNT + INSET, u1 = (tile + 1) / TILE_COUNT - INSET;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // One block's face on a side of a column, between heights y and t (out = push it outwards a little).
  side(side, x, z, y, t, rgb, light, tile, v0 = 0, v1 = 1, out = 0) {
    if (side === 0) { z -= out; this.quad([x + 1, y, z], [x, y, z], [x, t, z], [x + 1, t, z], rgb, light, tile, v0, v1); }          // north
    else if (side === 1) { z += 1 + out; this.quad([x, y, z], [x + 1, y, z], [x + 1, t, z], [x, t, z], rgb, light, tile, v0, v1); } // south
    else if (side === 2) { x -= out; this.quad([x, y, z], [x, y, z + 1], [x, t, z + 1], [x, t, z], rgb, light, tile, v0, v1); }      // west
    else { x += 1 + out; this.quad([x, y, z + 1], [x, y, z], [x, t, z], [x, t, z + 1], rgb, light, tile, v0, v1); }                   // east
  }

  top(x, z, y, rgb, light, tile) { this.quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z], rgb, light, tile); }
  bottom(x, z, y, rgb, light, tile) { this.quad([x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1], rgb, light, tile); }

  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

const SIDE_LIGHT = [0.8, 0.8, 0.64, 0.64];
const NEIGHBOUR = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIRT = [134, 96, 67], STONE = [126, 126, 126];
const BAND = 11 / 16;  // the green edge of a grass block covers the top 5/16 of its sides

function buildMeshes(land) {
  const { x0, z0, size, solid, top, kind, plant, rgb, look, under, underLook } = land;
  const solidFaces = new Faces(), cutout = new Faces(), water = new Faces();
  const at = (i, j) => (i < 0 || j < 0 || i >= size || j >= size ? -1 : i * size + j);
  const colour = (arr, k) => [arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]];
  const leafLow = (k) => Math.max(solid[k], top[k] - 1);
  const overworld = land.dim === 'overworld';

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const k = i * size + j;
      if (!kind[k]) continue;
      const x = x0 + j, z = z0 + i, s = solid[k];
      const own = kind[k] === 1 && !plant[k];
      const L = LOOK[own ? look[k] : underLook[k]] || LOOK.plain;
      let c = own ? colour(rgb, k) : colour(under, k);
      if (plant[k]) c = c.map((v, n) => Math.round(v * 0.75 + rgb[k * 3 + n] * 0.25));
      solidFaces.top(x, z, s, c, 0.96 + 0.06 * hash(x, z), L.top);

      // What each block down the side of the column is made of: natural ground has dirt and then stone under it.
      const blockAt = (y) => {
        const depth = s - 1 - y;
        if (depth === 0) return L.band ? [TEX.dirt, DIRT] : [L.side, c];
        if (!L.natural) return [L.side, c];
        if (depth <= 3) return L.fill === 'dirt' ? [TEX.dirt, DIRT] : [L.side, c];
        return overworld ? [TEX.stone, STONE] : [L.side, c];
      };
      NEIGHBOUR.forEach(([dj, di], side) => {
        const n = at(i + di, j + dj);
        const ns = n >= 0 && kind[n] ? solid[n] : s - 6;
        if (ns >= s) return;
        const light = SIDE_LIGHT[side] * 0.92;
        for (let y = ns; y < s; y++) {
          const [tile, col] = blockAt(y);
          solidFaces.side(side, x, z, y, y + 1, col, light * (0.95 + 0.06 * hash(x, z, y)), tile);
        }
        if (L.band) cutout.side(side, x, z, s - 1 + BAND, s, c, light, TEX.grassBand, BAND, 1, 0.003);
      });

      if (kind[k] === 2) {
        // Leaves (or whatever is above the ground) as a block two high at the top, and a trunk under the highest spot.
        const lc = colour(rgb, k), lo = leafLow(k), hi = top[k] + 1;
        const leafy = look[k] === 'leaves' || look[k] === 'plain';
        const F = leafy ? cutout : solidFaces;
        const tile = leafy ? TEX.leaves : (LOOK[look[k]] || LOOK.plain).side;
        F.top(x, z, hi, lc, 0.96 + 0.06 * hash(x, z, 1), tile);
        if (lo > s) F.bottom(x, z, lo, lc, 0.55, tile);
        NEIGHBOUR.forEach(([dj, di], side) => {
          const n = at(i + di, j + dj);
          if (n >= 0 && kind[n] === 2 && top[n] === top[k]) return;
          for (let y = lo; y < hi; y++) F.side(side, x, z, y, y + 1, lc, SIDE_LIGHT[side], tile);
        });
        if (top[k] - s >= 3 && isPeak(land, i, j)) {
          NEIGHBOUR.forEach((_, side) => {
            for (let y = s; y < lo; y++) solidFaces.side(side, x, z, y, y + 1, TRUNK, SIDE_LIGHT[side], TEX.logSide);
          });
        }
      } else if (kind[k] === 3) {
        water.top(x, z, top[k] + 0.88, colour(rgb, k), 1.05, TEX.water);
      }
    }
  }
  return { solid: solidFaces.geometry(), cutout: cutout.geometry(), water: water.geometry() };
}

// The highest leaf in its 3×3 neighbourhood (ties broken by position) gets a trunk.
function isPeak(land, i, j) {
  const { size, top, kind } = land, k = i * size + j;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
      const n = ii * size + jj;
      if (kind[n] !== 2) continue;
      if (top[n] > top[k] || (top[n] === top[k] && n < k)) return false;
    }
  }
  return true;
}

// ---------- names floating over pins, players, beds and gates ----------
function label(text, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 30px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 44;
  c.width = w; c.height = 52;
  ctx.font = font;
  ctx.fillStyle = 'rgba(20,22,28,.82)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, 52, 26); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(22, 26, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 36, 27);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.userData.aspect = w / 52;
  sprite.renderOrder = 10;
  return sprite;
}

// ---------- the view ----------
export function openStreet({ dim, x, z, places = [], tileUrl, names = [], onClose }) {
  const root = document.createElement('div');
  root.id = 'street';
  root.innerHTML = `
    <canvas></canvas>
    <div class="st-hud"><span class="st-pos"></span><span class="st-dir"></span></div>
    <button class="st-close icon-btn" type="button" title="3Dビューを閉じる"><svg class="ic"><use href="#i-close"/></svg></button>
    <div class="st-loading">読み込み中…</div>
    <div class="st-hint"></div>
    <div class="st-stick" hidden><div class="st-knob"></div></div>
    <button class="st-jump" type="button">ジャンプ</button>`;
  document.body.append(root);
  const touch = matchMedia('(pointer: coarse)').matches;
  root.classList.toggle('touch', touch);
  root.querySelector('.st-hint').textContent = touch
    ? '左下をなぞって歩く・右側をなぞって見回す'
    : 'WASD・矢印キーで移動／ドラッグで見回す／スペースでジャンプ／Shiftで走る／Escで閉じる';
  setTimeout(() => root.querySelector('.st-hint').classList.add('fade'), 7000);

  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  const scene = new THREE.Scene();
  const sky = SKY[dim] ?? SKY.overworld;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, RADIUS * 0.45, RADIUS * 0.95);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, RADIUS * 2);
  camera.rotation.order = 'YXZ';
  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const mats = {
    solid: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex }),
    cutout: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, side: THREE.DoubleSide }),
    water: new THREE.MeshBasicMaterial({ vertexColors: true, map: tex, transparent: true, opacity: 0.72, depthWrite: false }),
  };
  let meshes = [];

  const me = { x: x + 0.5, z: z + 0.5, y: null, vy: 0, yaw: 0, pitch: -0.08, onGround: false };
  let land = null, building = false, closed = false;

  const signs = [];
  for (const p of places) {
    const s = label(p.name, p.color || '#fff');
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.25, 6, 0.25), new THREE.MeshBasicMaterial({ color: p.color || '#fff', transparent: true, opacity: 0.85 }));
    scene.add(s, pole);
    signs.push({ p, s, pole });
  }

  function standAt(px, pz) {
    if (!land) return null;
    const j = Math.floor(px) - land.x0, i = Math.floor(pz) - land.z0;
    if (i < 0 || j < 0 || i >= land.size || j >= land.size) return null;
    const k = i * land.size + j;
    return land.kind[k] ? { solid: land.solid[k], water: land.kind[k] === 3 ? land.top[k] + 0.88 : null } : null;
  }

  async function build() {
    if (building) return;
    building = true;
    const cx = Math.floor(me.x), cz = Math.floor(me.z);
    const next = await readLand(cx, cz, tileUrl, names, dim);
    if (closed) return;
    const geo = buildMeshes(next);
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); }
    meshes = Object.entries(geo).filter(([, g]) => g).map(([kind, g]) => {
      const m = new THREE.Mesh(g, mats[kind]);
      if (kind === 'water') m.renderOrder = 1;
      scene.add(m);
      return m;
    });
    land = next;
    land.cx = cx; land.cz = cz;
    for (const g of signs) {
      const h = standAt(g.p.x + 0.5, g.p.z + 0.5);
      g.y = h ? Math.max(h.solid, h.water ?? -999) : null;
    }
    if (me.y === null) {
      const h = standAt(me.x, me.z);
      me.y = h ? Math.max(h.solid, h.water ? h.water - 1.2 : -999) : 80;
      if (!h) root.querySelector('.st-loading').textContent = 'この場所の地形データがありません';
      else root.querySelector('.st-loading').hidden = true;
    }
    building = false;
  }

  // ---------- controls ----------
  const keys = new Set();
  let stick = null, look = null, jumpPressed = false;
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.target.closest?.('input,textarea')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.type === 'keydown') keys.add(k); else keys.delete(k);
    if (e.type === 'keydown' && (k === ' ' || k.startsWith('Arrow'))) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const onBlur = () => keys.clear();
  window.addEventListener('blur', onBlur);

  const stickEl = root.querySelector('.st-stick'), knob = root.querySelector('.st-knob');
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the finger already lifted */ }
    if (touch && !stick && e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.35) {
      stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      stickEl.hidden = false;
      stickEl.style.left = `${e.clientX}px`; stickEl.style.top = `${e.clientY}px`;
      knob.style.transform = '';
    } else if (!look) {
      look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
      const d = Math.hypot(dx, dy), max = 50;
      if (d > max) { dx *= max / d; dy *= max / d; }
      stick.dx = dx / max; stick.dy = dy / max;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (look && e.pointerId === look.id) {
      const speed = touch ? 0.006 : 0.004;
      me.yaw -= (e.clientX - look.x) * speed;
      me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - (e.clientY - look.y) * speed));
      look.x = e.clientX; look.y = e.clientY;
    }
  });
  const release = (e) => {
    if (stick && e.pointerId === stick.id) { stick = null; stickEl.hidden = true; }
    if (look && e.pointerId === look.id) look = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const jumpBtn = root.querySelector('.st-jump');
  jumpBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); jumpPressed = true; });
  jumpBtn.addEventListener('pointerup', () => { jumpPressed = false; });
  jumpBtn.addEventListener('pointercancel', () => { jumpPressed = false; });
  root.querySelector('.st-close').addEventListener('click', () => close());

  // ---------- moving ----------
  function step(dt) {
    if (me.y === null) return;
    let fwd = 0, right = 0;
    if (keys.has('w') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('s') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) right += 1;
    if (keys.has('a') || keys.has('ArrowLeft')) right -= 1;
    let run = keys.has('Shift');
    if (stick) { fwd = -stick.dy; right = stick.dx; run = Math.hypot(stick.dx, stick.dy) > 0.9; }
    const here = standAt(me.x, me.z);
    const inWater = here?.water != null && me.y < here.water - 0.3;
    const len = Math.hypot(fwd, right);
    if (len > 0) {
      const speed = (inWater ? SWIM : run ? RUN : WALK) * Math.min(1, len) / len;
      const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
      const dx = (-sin * fwd + cos * right) * speed * dt;
      const dz = (-cos * fwd - sin * right) * speed * dt;
      tryMove(me.x + dx, me.z);
      tryMove(me.x, me.z + dz);
    }
    const under = standAt(me.x, me.z);
    const floor = under ? under.solid : me.y;
    const wantJump = keys.has(' ') || jumpPressed;
    if (inWater) {
      // Float with the head above the surface; jump swims up.
      const float = under.water - 1.25;
      me.vy = wantJump ? 3 : me.y < float ? 2 : Math.max(me.vy - GRAVITY * 0.15 * dt, -2);
    } else {
      if (wantJump && me.onGround) me.vy = JUMP;
      me.vy -= GRAVITY * dt;
    }
    me.y += me.vy * dt;
    if (me.y <= floor) { me.y = floor; me.vy = 0; me.onGround = true; } else me.onGround = false;
  }

  // Walking into a step one block high climbs it (like auto-jump); higher walls stop you.
  function tryMove(nx, nz) {
    const h = standAt(nx, nz);
    if (!h) return;
    if (h.solid - me.y > 1.01) return;
    if (h.solid > me.y) { me.y = h.solid; me.vy = Math.max(me.vy, 0); }
    me.x = nx; me.z = nz;
  }

  // ---------- drawing ----------
  const posEl = root.querySelector('.st-pos'), dirEl = root.querySelector('.st-dir');
  let last = performance.now(), raf = 0, hudText = '';
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    if (land && !building && Math.hypot(me.x - land.cx, me.z - land.cz) > REBUILD_AFTER) build();
    const eye = (me.y ?? 80) + EYE;
    camera.position.set(me.x, eye, me.z);
    camera.rotation.set(me.pitch, me.yaw, 0);
    for (const g of signs) {
      const d = Math.hypot(g.p.x + 0.5 - me.x, g.p.z + 0.5 - me.z);
      const show = g.y !== null && g.y !== undefined && d < RADIUS * 1.5;
      g.s.visible = g.pole.visible = show;
      if (!show) continue;
      g.pole.position.set(g.p.x + 0.5, g.y + 3, g.p.z + 0.5);
      const scale = Math.max(0.9, d * 0.06);
      g.s.position.set(g.p.x + 0.5, g.y + 6 + scale * 0.6, g.p.z + 0.5);
      g.s.scale.set(scale * g.s.userData.aspect, scale, 1);
    }
    const heading = ((-me.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const text = `X ${Math.floor(me.x)}  Y ${Math.floor(me.y ?? 0)}  Z ${Math.floor(me.z)}|${DIRS[Math.round(heading / 45) % 8]}向き`;
    if (text !== hudText) {
      hudText = text;
      const [pos, dir] = text.split('|');
      posEl.textContent = pos; dirEl.textContent = dir;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  build();

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
    for (const m of meshes) m.geometry.dispose();
    for (const m of Object.values(mats)) m.dispose();
    tex.dispose();
    for (const g of signs) { g.s.material.map.dispose(); g.s.material.dispose(); g.pole.geometry.dispose(); g.pole.material.dispose(); }
    renderer.dispose();
    root.remove();
    onClose?.({ x: Math.floor(me.x), z: Math.floor(me.z) });
  }
  return close;
}
