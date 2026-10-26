// 3D view (try-out): walk around the land in plain-coloured blocks, like a street view.
// It is built from the same files as the map: the map picture for colours, the info tiles for the top block
// and the ground tiles for the ground under trees. Only the top of the land is known, so caves and the
// insides of buildings are not shown; every column is drawn solid from the ground down.
import * as THREE from '../vendor/three/three.module.min.js';

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
async function readLand(cx, cz, tileUrl) {
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
    x0, z0, size,
    solid: new Int16Array(n).fill(-999),  // height of the walkable top (top face of the highest ground block)
    top: new Int16Array(n).fill(-999),    // the highest block (leaves, water surface, ...)
    kind: new Uint8Array(n),              // 0 nothing known, 1 ground, 2 something above the ground (trees), 3 water
    rgb: new Uint8Array(n * 3),           // colour of the top block
    under: new Uint8Array(n * 3),         // colour of the ground itself
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
        if (wet) {
          land.kind[k] = 3;
          land.solid[k] = g !== null && g < topY ? g + 1 : topY - 2;
        } else if (g !== null && topY > g + 1) {
          land.kind[k] = 2;
          land.solid[k] = g + 1;
        } else {
          land.kind[k] = 1;
          land.solid[k] = (g !== null ? g : topY) + 1;
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

// Under trees the ground colour is unknown: borrow it from the nearest open ground.
function groundColours(land) {
  const { size, kind, rgb, under } = land;
  const known = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) {
    if (kind[k] === 1) { under.set(rgb.subarray(k * 3, k * 3 + 3), k * 3); known[k] = 1; }
    else if (kind[k] === 3) { under.set(SEABED, k * 3); known[k] = 1; }
  }
  const spread = (k, from) => {
    if (known[k] || !known[from] || kind[from] === 3) return;
    under.copyWithin(k * 3, from * 3, from * 3 + 3); known[k] = 2;
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
  for (let k = 0; k < size * size; k++) if (!known[k]) under.set([96, 128, 62], k * 3);
}

// ---------- building the blocks ----------
const hash = (a, b, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
};

class Faces {
  constructor() { this.pos = []; this.col = []; this.idx = []; }

  // A rectangle given by its four corners (counter-clockwise seen from outside) and a colour.
  quad(a, b, c, d, rgb, light) {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    const r = rgb[0] * light / 255, g = rgb[1] * light / 255, bl = rgb[2] * light / 255;
    for (let i = 0; i < 4; i++) this.col.push(r, g, bl);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Wall of a column on one side, from y0 up to y1, split per block so the blocks show.
  wall(side, x, z, y0, y1, rgb, light) {
    const step = y1 - y0 > 16 ? y1 - y0 : 1;
    for (let y = y0; y < y1; y += step) {
      const t = Math.min(y + step, y1);
      const l = light * (0.94 + 0.08 * hash(x, z, y));
      if (side === 0) this.quad([x + 1, y, z], [x, y, z], [x, t, z], [x + 1, t, z], rgb, l);              // north
      else if (side === 1) this.quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, t, z + 1], [x, t, z + 1], rgb, l); // south
      else if (side === 2) this.quad([x, y, z], [x, y, z + 1], [x, t, z + 1], [x, t, z], rgb, l);          // west
      else this.quad([x + 1, y, z + 1], [x + 1, y, z], [x + 1, t, z], [x + 1, t, z + 1], rgb, l);           // east
    }
  }

  top(x, z, y, rgb, light) { this.quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z], rgb, light); }
  bottom(x, z, y, rgb, light) { this.quad([x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1], rgb, light); }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const SIDE_LIGHT = [0.8, 0.8, 0.64, 0.64];
const NEIGHBOUR = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function buildMeshes(land) {
  const { x0, z0, size, solid, top, kind, rgb, under } = land;
  const ground = new Faces(), water = new Faces();
  const at = (i, j) => (i < 0 || j < 0 || i >= size || j >= size ? -1 : i * size + j);
  const colour = (arr, k) => [arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]];
  const leafLow = (k) => Math.max(solid[k], top[k] - 1);

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const k = i * size + j;
      if (!kind[k]) continue;
      const x = x0 + j, z = z0 + i, s = solid[k];
      const plant = kind[k] === 1 && top[k] >= s;  // flowers and grass on the ground: mostly the ground colour
      let c = kind[k] === 1 && !plant ? colour(rgb, k) : colour(under, k);
      if (plant) c = c.map((v, n) => Math.round(v * 0.7 + rgb[k * 3 + n] * 0.3));
      ground.top(x, z, s, c, 0.95 + 0.07 * hash(x, z));
      NEIGHBOUR.forEach(([dj, di], side) => {
        const n = at(i + di, j + dj);
        const ns = n >= 0 && kind[n] ? solid[n] : s - 6;
        if (ns < s) ground.wall(side, x, z, ns, s, c, SIDE_LIGHT[side] * 0.9);
      });

      if (kind[k] === 2) {
        // Leaves (or whatever is above the ground) as a block two high at the top, and a trunk under the highest spot.
        const lc = colour(rgb, k), lo = leafLow(k), hi = top[k] + 1;
        ground.top(x, z, hi, lc, 0.95 + 0.07 * hash(x, z, 1));
        if (lo > s) ground.bottom(x, z, lo, lc, 0.5);
        NEIGHBOUR.forEach(([dj, di], side) => {
          const n = at(i + di, j + dj);
          if (n >= 0 && kind[n] === 2 && top[n] === top[k]) return;
          ground.wall(side, x, z, lo, hi, lc, SIDE_LIGHT[side]);
        });
        if (top[k] - s >= 3 && isPeak(land, i, j)) {
          NEIGHBOUR.forEach((_, side) => ground.wall(side, x, z, s, lo, TRUNK, SIDE_LIGHT[side]));
        }
      } else if (kind[k] === 3) {
        water.top(x, z, top[k] + 0.88, colour(rgb, k), 1.05);
      }
    }
  }
  return { ground: ground.geometry(), water: water.idx.length ? water.geometry() : null };
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
export function openStreet({ dim, x, z, places = [], tileUrl, onClose }) {
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
  const groundMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const waterMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false });
  let groundMesh = null, waterMesh = null;

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
    const next = await readLand(cx, cz, tileUrl);
    if (closed) return;
    const meshes = buildMeshes(next);
    if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); }
    if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); waterMesh = null; }
    groundMesh = new THREE.Mesh(meshes.ground, groundMat);
    scene.add(groundMesh);
    if (meshes.water) { waterMesh = new THREE.Mesh(meshes.water, waterMat); waterMesh.renderOrder = 1; scene.add(waterMesh); }
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
    if (groundMesh) groundMesh.geometry.dispose();
    if (waterMesh) waterMesh.geometry.dispose();
    for (const g of signs) { g.s.material.map.dispose(); g.s.material.dispose(); g.pole.geometry.dispose(); g.pole.material.dispose(); }
    renderer.dispose();
    root.remove();
    onClose?.({ x: Math.floor(me.x), z: Math.floor(me.z) });
  }
  return close;
}
