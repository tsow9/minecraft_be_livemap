'use strict';

const DIMS = {
  overworld: { name: '地上' },
  nether: { name: 'ネザー' },
  end: { name: 'エンド' },
};
const TYPES = ['waypoint', 'text', 'line', 'draw', 'polygon', 'rect', 'circle'];
const ICONS = {
  pin: ['📍', 'ピン'], home: ['🏠', '拠点'], death: ['🪦', '死んだ場所'], portal: ['🌀', 'ポータル'],
  mine: ['⛏️', '鉱山'], farm: ['🌾', '畑・トラップ'], village: ['🏘️', '村'], star: ['⭐', 'お気に入り'],
};
const COLORS = ['#ffffff', '#ff5252', '#ffb300', '#ffee58', '#66bb6a', '#29b6f6', '#5c6bc0', '#ab47bc', '#222222'];
const STORE_KEY = 'mcmap.annotations.v1';
const DEMO_SNAPSHOTS = [
  { id: 'demo-1', label: 'デモ 1週目' },
  { id: 'demo-2', label: 'デモ 2週目' },
  { id: 'demo-3', label: 'デモ 3週目' },
];

// Minecraft X → lng, Z → -lat, so north (-Z) is up and 1 block = 1px at zoom 0.
const ll = (x, z) => L.latLng(-z, x);
const block = (latlng) => ({ x: Math.floor(latlng.lng), z: Math.floor(-latlng.lat) });
const round1 = (v) => Math.round(v * 10) / 10;
// Hand drawings keep finer positions so zooming in never makes them wobble.
const round2 = (v) => Math.round(v * 100) / 100;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const state = {
  config: null,
  dim: 'overworld',
  snapshotIndex: 0,
  mode: 'none',
  color: COLORS[1],
  width: 4,
  annotations: [],
  layers: new Map(),
  baseLayer: null,
  gridLayer: null,
  players: [],
  explore: null,
  worldAt: null,
  demo: false,
};

let map;
const annGroup = L.layerGroup();

// ---------- storage ----------
const store = {
  load() {
    try { return sanitizeList(JSON.parse(localStorage.getItem(STORE_KEY) || '[]')); } catch { return []; }
  },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.annotations)); }
    catch { toast('この端末に保存できませんでした'); }
    updateDataCount();
  },
};

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function sanitize(a) {
  if (!a || typeof a !== 'object' || !TYPES.includes(a.type) || !DIMS[a.dim]) return null;
  const out = {
    id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : uid(),
    type: a.type, dim: a.dim,
    name: String(a.name ?? '').slice(0, 60),
    note: String(a.note ?? '').slice(0, 500),
    color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : COLORS[0],
    weight: Math.min(12, Math.max(1, num(a.weight) ?? 4)),
    updatedAt: num(a.updatedAt) ?? Date.now(),
  };
  if (a.type === 'waypoint' || a.type === 'text') {
    out.x = num(a.x); out.z = num(a.z);
    if (out.x === null || out.z === null) return null;
    out.x = Math.floor(out.x); out.z = Math.floor(out.z);
    if (a.type === 'waypoint') {
      out.icon = ICONS[a.icon] ? a.icon : 'pin';
      out.y = num(a.y) === null ? null : Math.floor(num(a.y));
    } else {
      out.text = String(a.text ?? '').slice(0, 200);
    }
  } else if (a.type === 'circle') {
    out.x = num(a.x); out.z = num(a.z); out.r = num(a.r);
    if (out.x === null || out.z === null || !(out.r > 0)) return null;
  } else {
    if (!Array.isArray(a.pts)) return null;
    out.pts = a.pts.map((p) => [num(p?.[0]), num(p?.[1])]).filter((p) => p[0] !== null && p[1] !== null).slice(0, 5000);
    if (out.pts.length < 2) return null;
  }
  return out;
}
function sanitizeList(list) { return Array.isArray(list) ? list.map(sanitize).filter(Boolean) : []; }

// ---------- utils ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast(`コピーしました: ${text}`);
}

// "~" lets the copied text work directly in /tp when Y is unknown.
const coordText = (x, z, y) => `${x} ${y ?? '~'} ${z}`;

function otherDimLine(x, z, dim = state.dim) {
  if (dim === 'overworld') return `ネザーでは X ${Math.floor(x / 8)} / Z ${Math.floor(z / 8)}`;
  if (dim === 'nether') return `地上では X ${x * 8} / Z ${z * 8}`;
  return '';
}

function annCenter(a) {
  if (a.type === 'waypoint' || a.type === 'text') return { x: a.x, z: a.z };
  if (a.type === 'circle') return { x: Math.floor(a.x), z: Math.floor(a.z) };
  const xs = a.pts.map((p) => p[0]); const zs = a.pts.map((p) => p[1]);
  return { x: Math.floor((Math.min(...xs) + Math.max(...xs)) / 2), z: Math.floor((Math.min(...zs) + Math.max(...zs)) / 2) };
}

// ---------- demo terrain (shown until real tiles are configured) ----------
function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z, seed) {
  return vnoise(x, z, seed) * 0.55 + vnoise(x * 2.1, z * 2.1, seed + 1) * 0.3 + vnoise(x * 4.3, z * 4.3, seed + 2) * 0.15;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function demoColor(dim, x, z) {
  const t = 0.92 + hash(x, z, 9) * 0.16;
  if (dim === 'overworld') {
    const h = fbm(x / 220, z / 220, 1), m = fbm(x / 160, z / 160, 7);
    if (h < 0.4) return shade(h < 0.33 ? '#2b4f9e' : '#3a63c4', t);
    if (h < 0.43) return shade('#dccf98', t);
    if (h > 0.74) return shade('#f4f7fb', t);
    if (h > 0.66) return shade('#8a8d8f', t);
    return shade(m > 0.55 ? '#3f7a2e' : '#6eab43', t);
  }
  if (dim === 'nether') {
    const h = fbm(x / 120, z / 120, 3), m = fbm(x / 90, z / 90, 5);
    if (h < 0.34) return shade('#e2701c', t);
    if (m > 0.66) return shade('#5a4a3d', t);
    if (m < 0.3) return shade(h > 0.6 ? '#2a7a6f' : '#9b2b2b', t);
    return shade('#7a2e2e', t);
  }
  const d = Math.hypot(x, z);
  const island = d < 110 + fbm(x / 40, z / 40, 4) * 40 || (d > 1000 && fbm(x / 150, z / 150, 6) > 0.62);
  return island ? shade('#dcdb9f', t) : '#07050c';
}
const DEMO_HOUSES = (() => {
  const out = [];
  for (let i = 0; i < 70; i++) {
    const ang = hash(i, 0, 11) * Math.PI * 2, dist = 20 + hash(i, 1, 11) * 260;
    out.push({
      x: Math.round(Math.cos(ang) * dist), z: Math.round(Math.sin(ang) * dist),
      w: 6 + Math.floor(hash(i, 2, 11) * 10), h: 6 + Math.floor(hash(i, 3, 11) * 10),
      week: Math.floor(hash(i, 4, 11) * 3), color: ['#8d6e4a', '#a0522d', '#9e9e9e', '#c9b38a'][i % 4],
    });
  }
  return out;
})();

const DemoLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const scale = Math.pow(2, coords.z);
    const bx = coords.x * 256 / scale, bz = coords.y * 256 / scale;
    const cell = Math.max(4, scale);
    for (let py = 0; py < 256; py += cell) {
      for (let px = 0; px < 256; px += cell) {
        ctx.fillStyle = demoColor(this.options.dim, Math.floor(bx + (px + cell / 2) / scale), Math.floor(bz + (py + cell / 2) / scale));
        ctx.fillRect(px, py, cell, cell);
      }
    }
    if (this.options.dim === 'overworld') {
      const span = 256 / scale;
      for (const hs of DEMO_HOUSES) {
        if (hs.week > this.options.week) continue;
        if (hs.x + hs.w < bx || hs.x > bx + span || hs.z + hs.h < bz || hs.z > bz + span) continue;
        ctx.fillStyle = hs.color;
        ctx.fillRect((hs.x - bx) * scale, (hs.z - bz) * scale, Math.max(1, hs.w * scale), Math.max(1, hs.h * scale));
      }
    }
    return tile;
  },
});

const ChunkGrid = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const scale = Math.pow(2, coords.z);
    const bx = coords.x * 256 / scale, bz = coords.y * 256 / scale, span = 256 / scale;
    const lines = (step, style, w) => {
      ctx.strokeStyle = style; ctx.lineWidth = w; ctx.beginPath();
      for (let v = Math.ceil(bx / step) * step; v <= bx + span; v += step) { const p = (v - bx) * scale + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, 256); }
      for (let v = Math.ceil(bz / step) * step; v <= bz + span; v += step) { const p = (v - bz) * scale + 0.5; ctx.moveTo(0, p); ctx.lineTo(256, p); }
      ctx.stroke();
    };
    if (scale >= 1) lines(16, 'rgba(255,255,255,0.18)', 1);
    if (scale >= 1 / 16) lines(512, 'rgba(255,230,120,0.35)', 1);
    if (bx <= 0 && 0 <= bx + span) { ctx.fillStyle = 'rgba(255,82,82,.7)'; ctx.fillRect(-bx * scale - 1, 0, 2, 256); }
    if (bz <= 0 && 0 <= bz + span) { ctx.fillStyle = 'rgba(41,182,246,.7)'; ctx.fillRect(0, -bz * scale - 1, 256, 2); }
    return tile;
  },
});

// ---------- base map ----------
function snapshots() { return state.demo ? DEMO_SNAPSHOTS : state.config.snapshots; }

function makeBaseLayer() {
  // Load tiles once the zoom settles (not at every step on the way), and keep a few extra around for panning.
  const opts = { minZoom: -6, maxZoom: 4, noWrap: true, pmIgnore: true, updateWhenZooming: false, keepBuffer: 3 };
  if (state.demo) {
    return new DemoLayer({ ...opts, dim: state.dim, week: state.snapshotIndex, maxNativeZoom: 2, attribution: 'デモ地形(本物の地図はまだ未設定)' });
  }
  const snap = snapshots()[state.snapshotIndex];
  const url = state.config.tileUrl.replace('{snapshot}', encodeURIComponent(snap.id)).replace('{dim}', state.dim);
  // Sharp screens (most phones) get the next more detailed picture shown at half size, so zoomed-out views stay crisp.
  const hi = (window.devicePixelRatio || 1) >= 1.5 ? 1 : 0;
  return new HistoryTileLayer(url, {
    ...opts, tileSize: 256 >> hi, zoomOffset: hi, manifest: manifests.get(snap.id), dim: state.dim,
    minNativeZoom: state.config.minNativeZoom - hi, maxNativeZoom: state.config.maxNativeZoom - hi,
    attribution: esc(snap.label || snap.id) + (state.snapshotIndex === snapshots().length - 1 ? updatedText() : ''),
  });
}

// Each day's manifest says which day's folder holds each tile (unchanged tiles are stored only once).
const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const manifests = new Map();
const HistoryTileLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const m = this.options.manifest;
    if (!m) return L.TileLayer.prototype.getTileUrl.call(this, coords);
    const key = `${this.options.dim}/${this._getZoomForUrl()}/${coords.x}/${coords.y}`;
    const hit = m[key];
    return hit ? `tiles/${encodeURIComponent(hit[0])}/${key}.png?v=${hit[1]}` : EMPTY_TILE;
  },
});

async function loadManifest(id) {
  const v = encodeURIComponent(state.config.updatedAt || '');
  if (!manifests.has(id)) manifests.set(id, (await fetchJson(`manifests/${encodeURIComponent(id)}.json?v=${v}`))?.tiles || null);
}

function updatedText() {
  const t = new Date(state.config.updatedAt);
  if (Number.isNaN(t.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return ` ・最終更新 ${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

let baseToken = 0;
async function refreshBase() {
  const token = ++baseToken;
  if (!state.demo) await loadManifest(snapshots()[state.snapshotIndex].id);
  if (token !== baseToken) return;
  updatePastBanner();
  updateCenterInfo();
  prefetchInfo();
  refreshContours();
  const next = makeBaseLayer();
  const prev = state.baseLayer;
  next.addTo(map).bringToBack();
  state.baseLayer = next;
  if (!prev) return;
  // Keep the old tiles until the new ones are in, so the timelapse doesn't flash black.
  let done = false;
  const drop = () => { if (!done) { done = true; map.removeLayer(prev); } };
  next.once('load', drop);
  setTimeout(drop, 3000);
}

// ---------- annotations: rendering ----------
function styleOf(a) {
  const filled = a.type === 'polygon' || a.type === 'rect' || a.type === 'circle';
  return { color: a.color, weight: a.weight, opacity: 0.95, smoothFactor: a.type === 'draw' ? 0.3 : 1, fill: filled, fillColor: a.color, fillOpacity: 0.15, lineCap: 'round', lineJoin: 'round' };
}

function makeLayer(a) {
  const pts = () => a.pts.map((p) => ll(p[0], p[1]));
  switch (a.type) {
    case 'waypoint':
      return L.marker(ll(a.x + 0.5, a.z + 0.5), {
        icon: L.divIcon({
          className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div style="transform:translate(-50%,-30px);--c:${a.color}" class="wp-icon"><svg class="pin" viewBox="0 0 24 30"><use href="#i-wp-pin"/></svg>${a.name ? `<span class="nm">${esc(a.name)}</span>` : ''}</div>`,
        }),
      });
    case 'text':
      return L.marker(ll(a.x + 0.5, a.z + 0.5), {
        icon: L.divIcon({
          className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="txt-icon" style="color:${a.color};transform:translate(-50%,-50%)">${esc(a.text)}</div>`,
        }),
      });
    case 'line': case 'draw': return L.polyline(pts(), styleOf(a));
    case 'polygon': return L.polygon(pts(), styleOf(a));
    case 'rect': return L.rectangle(L.latLngBounds(pts()), styleOf(a));
    case 'circle': return L.circle(ll(a.x, a.z), { ...styleOf(a), radius: a.r });
  }
  return null;
}

function renderAnn(a) {
  removeAnnLayer(a.id);
  if (a.dim !== state.dim) return;
  const layer = makeLayer(a);
  if (!layer) return;
  layer._annId = a.id;
  layer.on('click', (e) => {
    if (state.mode !== 'none') return;
    L.DomEvent.stop(e);
    openAnnPopup(a.id, e.latlng);
  });
  layer.on('pm:edit pm:dragend', () => updateGeometry(a.id, layer));
  annGroup.addLayer(layer);
  state.layers.set(a.id, layer);
}

function removeAnnLayer(id) {
  const l = state.layers.get(id);
  if (l) { annGroup.removeLayer(l); state.layers.delete(id); }
}

function renderAll() {
  annGroup.clearLayers(); state.layers.clear();
  state.annotations.forEach(renderAnn);
}

function updateGeometry(id, layer) {
  const a = state.annotations.find((v) => v.id === id);
  if (!a) return;
  const r = a.type === 'draw' ? round2 : round1;
  const toPt = (p) => [r(p.lng), r(-p.lat)];
  if (a.type === 'waypoint' || a.type === 'text') {
    const b = block(layer.getLatLng()); a.x = b.x; a.z = b.z;
  } else if (a.type === 'circle') {
    const c = layer.getLatLng(); a.x = round1(c.lng); a.z = round1(-c.lat); a.r = round1(layer.getRadius());
  } else if (a.type === 'rect') {
    const b = layer.getBounds(); a.pts = [toPt(b.getNorthWest()), toPt(b.getSouthEast())];
  } else {
    a.pts = L.LineUtil.isFlat(layer.getLatLngs()) ? layer.getLatLngs().map(toPt) : layer.getLatLngs()[0].map(toPt);
  }
  a.updatedAt = Date.now();
  store.save();
}

function addAnn(a) {
  const clean = sanitize(a);
  if (!clean) return null;
  state.annotations.push(clean);
  store.save();
  renderAnn(clean);
  return clean;
}

function deleteAnn(id) {
  state.annotations = state.annotations.filter((v) => v.id !== id);
  removeAnnLayer(id);
  map.closePopup();
  store.save();
}

// ---------- popups ----------
function button(label, onClick, icon) {
  const b = document.createElement('button');
  b.className = 'mini'; b.type = 'button'; b.textContent = label;
  if (icon) b.insertAdjacentHTML('afterbegin', `<svg class="ic"><use href="#i-${icon}"/></svg>`);
  b.addEventListener('click', onClick);
  return b;
}

function coordBlock(x, z, y, dim) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="xyz">X ${x}${y != null ? ` / Y ${y}` : ''} / Z ${z}</div><div class="sub">${esc(otherDimLine(x, z, dim))}</div>`;
  return wrap;
}

function openCoordPopup(latlng) {
  const { x, z } = block(latlng);
  const el = document.createElement('div'); el.className = 'pop';
  el.append(coordBlock(x, z, null, state.dim));
  const acts = document.createElement('div'); acts.className = 'acts';
  acts.append(
    button('コピー', () => copyText(coordText(x, z)), 'copy'),
    button('ここに印をつける', () => { map.closePopup(); createWaypoint(x, z); }, 'pin'),
  );
  el.append(acts);
  L.popup({ autoPan: false }).setLatLng(ll(x + 0.5, z + 0.5)).setContent(el).openOn(map);
}

function openAnnPopup(id, at) {
  const a = state.annotations.find((v) => v.id === id);
  if (!a) return;
  const c = annCenter(a);
  const el = document.createElement('div'); el.className = 'pop';
  const head = document.createElement('h4');
  if (a.type === 'waypoint') head.textContent = a.name || 'ピン';
  else if (a.type === 'text') head.textContent = a.text;
  else head.textContent = a.name || { line: '線', draw: '手書き', polygon: '多角形', rect: '四角', circle: '円' }[a.type];
  const isPoint = a.type === 'waypoint' || a.type === 'text';
  el.append(head);
  if (isPoint) el.append(coordBlock(c.x, c.z, a.y, a.dim));
  if (a.type === 'circle') el.insertAdjacentHTML('beforeend', `<div class="sub">半径 ${Math.round(a.r)} ブロック</div>`);
  if (a.note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = a.note; el.append(n); }
  const acts = document.createElement('div'); acts.className = 'acts';
  if (isPoint) acts.append(button('コピー', () => copyText(coordText(c.x, c.z, a.y)), 'copy'));
  const del = button('削除', () => { deleteAnn(a.id); toast('削除しました'); }, 'trash');
  del.classList.add('danger');
  acts.append(button('編集', () => { map.closePopup(); openEditor(a, false); }, 'pencil'), del);
  el.append(acts);
  const pos = isPoint ? ll(a.x + 0.5, a.z + 0.5) : (at || ll(c.x, c.z));
  L.popup({ offset: a.type === 'waypoint' ? [0, -8] : [0, 0] }).setLatLng(pos).setContent(el).openOn(map);
}

// ---------- editor dialog ----------
const editor = $('#editor');
let editing = null;

function fillSwatches(container, current, onPick) {
  container.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch' + (c === current ? ' on' : ''); b.style.background = c; b.title = c;
    b.addEventListener('click', () => {
      container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
      b.classList.add('on'); onPick(c);
    });
    container.append(b);
  }
}

function openEditor(a, isNew) {
  editing = { a, isNew, color: a.color };
  const isWp = a.type === 'waypoint', isText = a.type === 'text';
  $('#ed-title').textContent = isWp ? (isNew ? '新しいピン' : 'ピンの編集') : (isNew ? '新しく追加' : '編集');
  $('#ed-name').placeholder = isWp ? nextPinName() : '';
  $('#ed-name-row').hidden = isText;
  $('#ed-text-row').hidden = !isText;
  $('#ed-error').textContent = '';
  $('#ed-delete').hidden = isNew;
  $('#ed-name').value = a.name || '';
  $('#ed-text').value = a.text || '';
  fillSwatches($('#ed-colors'), a.color, (c) => { editing.color = c; });
  editor.showModal();
  setTimeout(() => (isText ? $('#ed-text') : $('#ed-name')).focus(), 50);
}

editor.addEventListener('close', () => {
  if (!editing) return;
  const { a, isNew, color } = editing;
  editing = null;
  const action = editor.returnValue;
  if (action === 'delete') { deleteAnn(a.id); toast('削除しました'); return; }
  if (action !== 'save') return;
  const next = { ...a, color, updatedAt: Date.now() };
  if (a.type === 'text') {
    next.text = $('#ed-text').value.trim();
    if (!next.text) { if (!isNew) deleteAnn(a.id); return; }
  } else {
    next.name = $('#ed-name').value.trim();
  }
  if (a.type === 'waypoint') next.name = next.name || nextPinName();
  if (isNew) { addAnn(next); return; }
  const clean = sanitize(next);
  if (!clean) return;
  const i = state.annotations.findIndex((v) => v.id === a.id);
  state.annotations[i] = clean;
  store.save();
  renderAnn(clean);
});

// Every pin has its own name, so it can be found by searching.
function pinNameTaken(name, exceptId) {
  const key = name.trim().toLowerCase();
  return state.annotations.some((v) => v.type === 'waypoint' && v.id !== exceptId && (v.name || '').trim().toLowerCase() === key);
}
function nextPinName() {
  let n = 1;
  while (pinNameTaken(`ピン${n}`)) n++;
  return `ピン${n}`;
}

// Enter in a one-line box saves (instead of pressing the first button in the form, which is 削除).
$('#editor-form').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !e.isComposing) {
    e.preventDefault();
    $('#editor-form button[value="save"]').click();
  }
});

$('#editor-form').addEventListener('submit', (e) => {
  if (!editing || e.submitter?.value !== 'save' || editing.a.type !== 'waypoint') return;
  const name = $('#ed-name').value.trim();
  if (name && pinNameTaken(name, editing.a.id)) {
    e.preventDefault();
    $('#ed-error').textContent = `「${name}」はもう使われています。別の名前にしてください`;
    $('#ed-name').focus();
  }
});

function createWaypoint(x, z) {
  openEditor({ id: uid(), type: 'waypoint', dim: state.dim, x, z, icon: 'pin', color: state.color, name: '', note: '', y: null }, true);
}
function createText(x, z) {
  openEditor({ id: uid(), type: 'text', dim: state.dim, x, z, text: '', color: state.color, note: '' }, true);
}

// ---------- tools / modes ----------
const HINTS = {
  none: '地図をタップすると座標が出ます',
  waypoint: '印をつけたい場所をタップ',
  text: '文字を置きたい場所をタップ',
  freehand: '1本指(マウス)でなぞって描く・2本指で拡大縮小',
  Line: 'タップで点を足す → 最後の点をもう一度タップで完成',
  Polygon: 'タップで点を足す → 最初の点をタップで完成',
  Rectangle: '角を1か所タップ → 反対の角をタップ',
  Circle: '中心をタップ → 円の端をタップ',
  edit: '図形の白い点をドラッグして形を直す',
  drag: '動かしたいものをドラッグ',
  erase: 'なぞった所の手書きを消す・2本指で拡大縮小',
};
const GEOMAN_SHAPES = { Line: 'line', Polygon: 'polygon', Rectangle: 'rect', Circle: 'circle' };

function setMode(mode) {
  // Set first: disableDraw() fires pm:drawend, which re-arms the drawing tool for whatever mode is current.
  state.mode = mode;
  map.pm.disableDraw();
  if (map.pm.globalEditModeEnabled()) map.pm.disableGlobalEditMode();
  if (map.pm.globalDragModeEnabled()) map.pm.disableGlobalDragMode();
  if (map.pm.globalRemovalModeEnabled()) map.pm.disableGlobalRemovalMode();
  map.dragging.enable();
  const hand = mode === 'freehand' || mode === 'erase';
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === (mode === 'erase' ? 'freehand' : mode)));
  $('#pen-toggle').hidden = !hand;
  document.querySelectorAll('#pen-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.pen === mode));
  $('#mode-hint').textContent = HINTS[mode] || '';
  $('#map').classList.toggle('mode-draw', mode !== 'none');
  $('#map').classList.toggle('mode-freehand', hand);
  $('#map').classList.toggle('mode-erase', mode === 'erase');
  map.closePopup();
  const style = { color: state.color, weight: state.width, fillColor: state.color, fillOpacity: 0.15 };
  if (GEOMAN_SHAPES[mode]) map.pm.enableDraw(mode, { pathOptions: style, templineStyle: style, hintlineStyle: { ...style, dashArray: '5,5' }, tooltips: false });
  else if (mode === 'edit') map.pm.enableGlobalEditMode();
  else if (mode === 'drag') map.pm.enableGlobalDragMode();
  else if (mode === 'remove') map.pm.enableGlobalRemovalMode();
  else if (hand) map.dragging.disable();
}

function setupTools() {
  document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#pen-toggle button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.pen)));
  fillSwatches($('#colors'), state.color, (c) => { state.color = c; if (GEOMAN_SHAPES[state.mode]) setMode(state.mode); });
  $('#width').addEventListener('input', (e) => { state.width = Number(e.target.value); if (GEOMAN_SHAPES[state.mode]) setMode(state.mode); });
  $('#btn-tools').addEventListener('click', () => {
    const t = $('#tools'); t.hidden = !t.hidden;
    $('#btn-tools').classList.toggle('on', !t.hidden);
    document.body.classList.toggle('tools-open', !t.hidden);
    if (t.hidden) setMode('none');
  });

  map.on('pm:create', (e) => {
    const type = GEOMAN_SHAPES[e.shape];
    const layer = e.layer;
    map.removeLayer(layer);
    if (!type) return;
    const toPt = (p) => [round1(p.lng), round1(-p.lat)];
    const a = { id: uid(), type, dim: state.dim, color: state.color, weight: state.width, name: '', note: '' };
    if (type === 'circle') { const c = layer.getLatLng(); a.x = round1(c.lng); a.z = round1(-c.lat); a.r = round1(layer.getRadius()); }
    else if (type === 'rect') { const b = layer.getBounds(); a.pts = [toPt(b.getNorthWest()), toPt(b.getSouthEast())]; }
    else { const ls = layer.getLatLngs(); a.pts = (L.LineUtil.isFlat(ls) ? ls : ls[0]).map(toPt); }
    addAnn(a);
  });
  map.on('pm:drawend', () => { if (GEOMAN_SHAPES[state.mode]) setMode(state.mode); });
  map.on('pm:remove', (e) => { if (e.layer._annId) deleteAnn(e.layer._annId); });

  map.on('click', (e) => {
    const { x, z } = block(e.latlng);
    if (state.mode === 'none') openCoordPopup(e.latlng);
    else if (state.mode === 'waypoint') createWaypoint(x, z);
    else if (state.mode === 'text') createText(x, z);
  });

  setupFreehand();
}

function setupFreehand() {
  const el = map.getContainer();
  const pointers = new Set();
  let pts = null, temp = null;
  const finish = (keep) => {
    if (temp) { map.removeLayer(temp); temp = null; }
    if (keep && pts && pts.length >= 2) {
      // Only drop points that change nothing visible, so the line stays exactly where it was drawn.
      const z = map.getZoom();
      const simplified = L.LineUtil.simplify(pts.map((p) => map.project(p, z)), 0.35).map((p) => map.unproject(p, z));
      if (simplified.length >= 2) {
        addAnn({ id: uid(), type: 'draw', dim: state.dim, color: state.color, weight: state.width, name: '', note: '',
          pts: simplified.map((p) => [round2(p.lng), round2(-p.lat)]) });
      }
    }
    pts = null;
  };
  let eraser = null, erased = false, last = null, smooth = null;
  const stopErase = () => {
    if (eraser) { map.removeLayer(eraser); eraser = null; }
    if (erased) store.save();
    erased = false; last = null;
  };
  el.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'freehand' && state.mode !== 'erase') return;
    pointers.add(e.pointerId);
    if (pointers.size > 1) { finish(false); stopErase(); return; }
    if (e.target.closest('.leaflet-control, .leaflet-popup')) return;
    if (state.mode === 'erase') {
      last = map.mouseEventToContainerPoint(e);
      eraser = L.circleMarker(map.containerPointToLatLng(last), { radius: ERASER_PX, color: '#fff', weight: 1.5, dashArray: '3,3',
        fillColor: '#fff', fillOpacity: 0.15, pmIgnore: true, interactive: false }).addTo(map);
      erased = eraseAlong(last, last) || erased;
      return;
    }
    smooth = map.mouseEventToContainerPoint(e);
    pts = [map.containerPointToLatLng(smooth)];
    temp = L.polyline(pts, { color: state.color, weight: state.width, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
      smoothFactor: 0.3, pmIgnore: true, interactive: false }).addTo(map);
  });
  el.addEventListener('pointermove', (e) => {
    if (last && state.mode === 'erase' && pointers.size === 1) {
      const p = map.mouseEventToContainerPoint(e);
      eraser.setLatLng(map.containerPointToLatLng(p));
      erased = eraseAlong(last, p) || erased;
      last = p;
      return;
    }
    if (!pts || state.mode !== 'freehand' || pointers.size > 1) return;
    // A light steadying of the pen (like drawing apps) takes out the small shakes of a finger or mouse.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const raw = map.mouseEventToContainerPoint(ev);
      smooth = smooth.add(raw.subtract(smooth).multiplyBy(0.45));
      if (smooth.distanceTo(map.latLngToContainerPoint(pts[pts.length - 1])) >= 1) pts.push(map.containerPointToLatLng(smooth));
    }
    temp.setLatLngs(pts);
  });
  const up = (e) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pts) finish(wasSingle && e.type === 'pointerup');
    if (last) stopErase();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// Cuts away the parts of hand drawings that the eraser passed over (screen points p0 → p1).
const ERASER_PX = 12;
function eraseAlong(p0, p1) {
  let changed = false;
  for (const a of [...state.annotations]) {
    if (a.type !== 'draw' || a.dim !== state.dim) continue;
    const r = ERASER_PX + (a.weight || 4) / 2;
    const pts = a.pts.map(([x, z]) => map.latLngToContainerPoint(ll(x, z)));
    const box = L.bounds([p0, p1]);
    if (!L.bounds(pts).intersects(L.bounds([box.min.subtract(L.point(r, r)), box.max.add(L.point(r, r))]))) continue;
    // Fill in points every few pixels so even long straight parts can be cut in the middle.
    const dense = [];
    pts.forEach((p, i) => {
      if (i) {
        const s = pts[i - 1], n = Math.ceil(s.distanceTo(p) / 3);
        for (let k = 1; k < n; k++) dense.push(s.add(p.subtract(s).multiplyBy(k / n)));
      }
      dense.push(p);
    });
    const keep = dense.map((p) => L.LineUtil.pointToSegmentDistance(p, p0, p1) > r);
    if (keep.every(Boolean)) continue;
    changed = true;
    const runs = [];
    let cur = [];
    dense.forEach((p, i) => {
      if (keep[i]) cur.push(p);
      else { if (cur.length >= 2) runs.push(cur); cur = []; }
    });
    if (cur.length >= 2) runs.push(cur);
    state.annotations = state.annotations.filter((v) => v.id !== a.id);
    removeAnnLayer(a.id);
    for (const run of runs) {
      const simple = L.LineUtil.simplify(run, 0.35);
      if (simple.length < 2) continue;
      const piece = sanitize({ ...a, id: uid(), updatedAt: Date.now(),
        pts: simple.map((p) => { const q = map.containerPointToLatLng(p); return [round2(q.lng), round2(-q.lat)]; }) });
      if (piece) { state.annotations.push(piece); renderAnn(piece); }
    }
  }
  return changed;
}

// ---------- coordinates readout ----------
// ---------- what is under the crosshair ----------
// Info tiles store, per block, the top block's ID and height (RGB = 12-bit ID << 9 | Y+64).
const infoCache = new Map();
let blockNames = [];
let blockNamesJa = [];
let centerInfo = null;

async function loadBlockNames() {
  const data = await fetchJson(`blocks.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  blockNames = Array.isArray(data?.names) ? data.names : [];
  blockNamesJa = Array.isArray(data?.ja) ? data.ja : [];
}

const infoData = new Map();

function loadInfoTile(url) {
  if (infoCache.has(url)) return infoCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      infoData.set(url, data);
      resolve(data);
    };
    img.onerror = () => { infoData.set(url, null); resolve(null); };
    img.src = url;
  });
  infoCache.set(url, p);
  if (infoCache.size > 80) {
    const old = infoCache.keys().next().value;
    infoCache.delete(old);
    infoData.delete(old);
  }
  return p;
}

function infoUrl(tx, tz, kind = 'info') {
  if (state.demo) return null;
  const m = manifests.get(snapshots()[state.snapshotIndex]?.id);
  const key = `${kind}/${state.dim}/${tx}/${tz}`;
  const hit = m && m[key];
  return hit ? `tiles/${encodeURIComponent(hit[0])}/${key}.png?v=${hit[1]}` : null;
}

// Answers right away when the tile is already loaded; otherwise starts loading it.
function blockAtNow(x, z) {
  const tx = Math.floor(x / 256), tz = Math.floor(z / 256);
  const url = infoUrl(tx, tz);
  if (!url) return { info: null };
  if (!infoData.has(url)) return { pending: loadInfoTile(url) };
  const data = infoData.get(url);
  if (!data) return { info: null };
  const i = ((z - tz * 256) * data.width + (x - tx * 256)) * 4;
  const v = (data.data[i] << 16) | (data.data[i + 1] << 8) | data.data[i + 2];
  const id = v >> 9;
  if (!id) return { info: null };
  const y = (v & 511) - 64;
  return { info: { name: blockNames[id] || '', ja: blockNamesJa[id] || '', y }, raw: { id, y } };
}

// ---------- contour lines (drawn from the ground heights stored in the ground tiles) ----------
let contourLayer = null;
const NO_GROUND = -32768;
const groundGrids = new Map();

function contourStep(zoom) {
  if (zoom >= 0) return 4;
  return zoom >= -1 ? 8 : 16;
}

// One ground tile as plain heights (R/G = Y + 65, B = 1 under water), kept small and decoded once.
function loadGroundGrid(url) {
  if (groundGrids.has(url)) return groundGrids.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const grid = new Int16Array(c.width * c.height);
      for (let k = 0, i = 0; k < grid.length; k++, i += 4) {
        const v = (d[i] << 8) | d[i + 1];
        grid[k] = v && !d[i + 2] ? v - 65 : NO_GROUND;
      }
      resolve(grid);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  groundGrids.set(url, p);
  if (groundGrids.size > 200) groundGrids.delete(groundGrids.keys().next().value);
  return p;
}

const nextTask = () => new Promise((r) => setTimeout(r, 0));

const ContourLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tile.width = tile.height = 256 * dpr;
    this._draw(tile, coords, dpr).then(() => done(null, tile), () => done(null, tile));
    return tile;
  },
  async _draw(tile, coords, dpr) {
    const scale = Math.pow(2, coords.z);
    const bx = coords.x * 256 / scale, bz = coords.y * 256 / scale;
    const cell = Math.max(1, scale);
    const stride = Math.max(1, 1 / scale);
    const n = 256 / cell;
    const tx0 = Math.floor(bx / 256), tz0 = Math.floor(bz / 256);
    const tx1 = Math.floor((bx + n * stride) / 256), tz1 = Math.floor((bz + n * stride) / 256);
    const grids = [];
    const loads = [];
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const u = infoUrl(tx, tz, 'ground');
        const slot = grids.push(null) - 1;
        if (u) loads.push(loadGroundGrid(u).then((g) => { grids[slot] = g; }));
      }
    }
    if (!loads.length) return;
    await Promise.all(loads);
    // Spread the work over several moments so scrolling stays smooth.
    await nextTask();
    const cols = tx1 - tx0 + 1;
    const step = contourStep(coords.z);
    const level = new Int32Array((n + 1) * (n + 1)).fill(NO_GROUND);
    const colTile = new Int32Array(n + 1), colOff = new Int32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(bx + i * stride);
      colTile[i] = Math.floor(x / 256) - tx0; colOff[i] = x - Math.floor(x / 256) * 256;
    }
    for (let j = 0; j <= n; j++) {
      const z = Math.floor(bz + j * stride);
      const rowTile = (Math.floor(z / 256) - tz0) * cols, rowOff = (z - Math.floor(z / 256) * 256) * 256;
      for (let i = 0; i <= n; i++) {
        const g = grids[rowTile + colTile[i]];
        if (!g) continue;
        const h = g[rowOff + colOff[i]];
        if (h !== NO_GROUND) level[j * (n + 1) + i] = Math.floor(h / step);
      }
    }

    // Lines go on the edge between two cells whose height band differs; every 4th band is bold.
    const thin = [], bold = [];
    const marks = [];  // [x, y, height, bold] for every piece of line, to place the height labels
    const consider = (a, b, x0, y0, x1, y1) => {
      if (a === NO_GROUND || b === NO_GROUND || a === b) return;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const b4 = Math.floor(hi / 4) * 4;
      const isBold = b4 > lo;
      (isBold ? bold : thin).push(x0, y0, x1, y1);
      // Only the bold lines get numbers, so the map stays easy to read.
      if (isBold) marks.push([(x0 + x1) / 2, (y0 + y1) / 2, b4 * step, true]);
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = level[j * (n + 1) + i];
        if (a === NO_GROUND) continue;
        consider(a, level[j * (n + 1) + i + 1], (i + 1) * cell, j * cell, (i + 1) * cell, (j + 1) * cell);
        consider(a, level[(j + 1) * (n + 1) + i], i * cell, (j + 1) * cell, (i + 1) * cell, (j + 1) * cell);
      }
    }
    const labels = placeContourLabels(marks);
    if (!this._map) return;
    const ctx = tile.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    const stroke = (segs, color, width) => {
      ctx.beginPath();
      for (let k = 0; k < segs.length; k += 4) { ctx.moveTo(segs[k], segs[k + 1]); ctx.lineTo(segs[k + 2], segs[k + 3]); }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    stroke(thin, 'rgba(60, 35, 10, 0.55)', 1);
    stroke(bold, 'rgba(60, 35, 10, 0.9)', 2);

    // Like a paper map: the number sits in a gap of its own line, turned to follow it.
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels) {
      const text = `Y${l.y}`;
      const w = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(l.x, l.y0);
      ctx.rotate(l.angle);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(-w / 2 - 3, -5, w + 6, 10);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255, 250, 235, 0.85)'; ctx.strokeText(text, 0, 0.5);
      ctx.fillStyle = 'rgb(70, 40, 10)'; ctx.fillText(text, 0, 0.5);
      ctx.restore();
    }
  },
});

// Picks up to one spot per quarter of a tile where a line runs fairly straight, and the direction it runs there.
function placeContourLabels(marks) {
  const cells = new Map();
  for (const m of marks) {
    const k = `${Math.floor(m[0] / 16)},${Math.floor(m[1] / 16)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(m);
  }
  const near = (m) => {
    const out = [];
    const ci = Math.floor(m[0] / 16), cj = Math.floor(m[1] / 16);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const o of cells.get(`${ci + di},${cj + dj}`) || []) {
          if (o[2] === m[2] && (o[0] - m[0]) ** 2 + (o[1] - m[1]) ** 2 <= 14 * 14) out.push(o);
        }
      }
    }
    return out;
  };
  const labels = [];
  for (let q = 0; q < 4; q++) {
    const cx = q % 2 ? 192 : 64, cy = q >= 2 ? 192 : 64;
    const mine = marks.filter((m) => m[0] >= 26 && m[0] <= 230 && m[1] >= 14 && m[1] <= 242 &&
      (m[0] >= 128) === (q % 2 === 1) && (m[1] >= 128) === (q >= 2));
    mine.sort((a, b) => ((a[0] - cx) ** 2 + (a[1] - cy) ** 2) - ((b[0] - cx) ** 2 + (b[1] - cy) ** 2));
    for (const m of mine.slice(0, 60)) {
      const pts = near(m);
      if (pts.length < 6) continue;
      // Direction of the line from the spread of nearby pieces (principal axis).
      let mx = 0, my = 0;
      for (const p of pts) { mx += p[0]; my += p[1]; }
      mx /= pts.length; my /= pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr - l1;
      if (l1 <= 0 || l2 / l1 > 0.12) continue;
      let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      labels.push({ x: mx, y0: my, angle, y: m[2] });
      break;
    }
  }
  return labels;
}

function refreshContours() {
  if (contourLayer) { map.removeLayer(contourLayer); contourLayer = null; }
  if ($('#btn-contour').classList.contains('on') && !state.demo) {
    contourLayer = new ContourLayer({ minZoom: -2, maxZoom: 4, pmIgnore: true, zIndex: 3,
      updateWhenZooming: false, keepBuffer: 1 }).addTo(map);
  }
}

// Load the block info around the crosshair ahead of time, a little at a time when the browser is idle,
// so moving around answers instantly without slowing down scrolling and zooming.
const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 50));
let prefetchQueue = [];
let prefetchRunning = false;
function prefetchInfo() {
  if (state.demo || map.getZoom() < -3) { prefetchQueue = []; return; }
  const c = block(map.getCenter());
  const cx = Math.floor(c.x / 256), cz = Math.floor(c.z / 256);
  // Close in: the whole screen plus a margin. Zoomed out: only the tiles next to the crosshair.
  const b = map.getBounds();
  let x0 = Math.floor(b.getWest() / 256) - 1, x1 = Math.floor(b.getEast() / 256) + 1;
  let z0 = Math.floor(-b.getNorth() / 256) - 1, z1 = Math.floor(-b.getSouth() / 256) + 1;
  if ((x1 - x0 + 1) * (z1 - z0 + 1) > 30) { x0 = cx - 1; x1 = cx + 1; z0 = cz - 1; z1 = cz + 1; }
  const urls = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let tz = z0; tz <= z1; tz++) {
      const url = infoUrl(tx, tz);
      if (url && !infoCache.has(url)) urls.push([Math.abs(tx - cx) + Math.abs(tz - cz), url]);
    }
  }
  prefetchQueue = urls.sort((p, q) => p[0] - q[0]).map((u) => u[1]);
  if (prefetchRunning) return;
  prefetchRunning = true;
  const work = (deadline) => {
    while (prefetchQueue.length && deadline.timeRemaining() > 2) loadInfoTile(prefetchQueue.shift());
    if (prefetchQueue.length) idle(work); else prefetchRunning = false;
  };
  idle(work);
}

function showCenterInfo(x, z, info) {
  centerInfo = info;
  const part = (k, v) => `<span><i>${k}</i>${v}</span>`;
  $('#c-center').innerHTML = part('X', x) + (info ? part('Y', info.y) : '') + part('Z', z);
  const blk = $('#c-block');
  blk.textContent = '';
  if (info) {
    blk.textContent = info.ja || BLOCK_JA(info.name);
  }
}

function updateCenterInfo() {
  const { x, z } = block(map.getCenter());
  const r = blockAtNow(x, z);
  if (!r.pending) { showCenterInfo(x, z, r.info); return; }
  showCenterInfo(x, z, null);
  r.pending.then(() => {
    const now = block(map.getCenter());
    if (now.x === x && now.z === z) showCenterInfo(x, z, blockAtNow(x, z).info);
  });
}

function setupCoords() {
  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const { x, z } = block(map.getCenter());
      $('#c-center-other').textContent = otherDimLine(x, z);
      updateCenterInfo();
    });
  };
  map.on('move', update);
  map.on('moveend', prefetchInfo);
  update();
  $('#copy-center').addEventListener('click', (e) => {
    e.stopPropagation();
    const { x, z } = block(map.getCenter());
    copyText(coordText(x, z, centerInfo?.y));
  });
  // Small by default; tap for the Nether line, or close it and bring it back with the small button.
  const box = $('#coords'), open = $('#coords-open');
  const show = (visible) => {
    box.hidden = !visible; open.hidden = visible;
    try { localStorage.setItem('mcmap.coords', visible ? 'open' : 'closed'); } catch { /* private mode */ }
  };
  box.addEventListener('click', () => box.classList.toggle('detail'));
  $('#coords-close').addEventListener('click', (e) => { e.stopPropagation(); show(false); });
  open.addEventListener('click', () => show(true));
  let saved = null;
  try { saved = localStorage.getItem('mcmap.coords'); } catch { /* private mode */ }
  if (saved === 'closed') show(false);
}

// ---------- dimensions ----------
function setDim(dim) {
  if (!DIMS[dim] || dim === state.dim) return;
  state.dim = dim;
  document.querySelectorAll('#dims button').forEach((b) => b.classList.toggle('on', b.dataset.dim === dim));
  map.closePopup();
  if (state.baseLayer) { map.removeLayer(state.baseLayer); state.baseLayer = null; }
  refreshBase();
  renderAll();
  renderPlayers();
  refreshExplore();
  $('#c-center-other').textContent = otherDimLine(block(map.getCenter()).x, block(map.getCenter()).z);
}

function goTo(x, z, dim, zoom) {
  if (dim) setDim(dim);
  map.setView(ll(x + 0.5, z + 0.5), Math.max(map.getZoom(), zoom ?? 0));
}

function updatePastBanner() {
  const snaps = snapshots();
  const past = !state.demo && state.snapshotIndex < snaps.length - 1;
  $('#past-banner').hidden = !past;
  if (past) $('#past-text').textContent = `📅 ${snaps[state.snapshotIndex].label || snaps[state.snapshotIndex].id}の地図を表示中`;
}

let setSnapshotIndex = () => {};
const isDateId = (id) => /^\d{4}-\d{2}-\d{2}$/.test(id);

function labelTimeline() {
  const s = snapshots()[state.snapshotIndex];
  $('#time-label').textContent = s ? (s.label || s.id) : 'なし';
  if (s && isDateId(s.id)) $('#time-date').value = s.id;
  $('#time-chips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.index) === state.snapshotIndex));
}

function renderTimeline() {
  const snaps = snapshots();
  const range = $('#time-range');
  range.max = Math.max(0, snaps.length - 1);
  range.value = state.snapshotIndex;
  const dated = snaps.filter((s) => isDateId(s.id));
  if (dated.length) { $('#time-date').min = dated[0].id; $('#time-date').max = dated[dated.length - 1].id; }
  const chips = $('#time-chips');
  chips.innerHTML = '';
  let month = '';
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    const m = isDateId(s.id) ? `${Number(s.id.slice(0, 4))}年${Number(s.id.slice(5, 7))}月` : '';
    if (m && m !== month) { month = m; chips.insertAdjacentHTML('beforeend', `<div class="month">${m}</div>`); }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = i === snaps.length - 1 ? `${s.label || s.id}(最新)` : (s.label || s.id);
    b.dataset.index = i;
    b.addEventListener('click', () => setSnapshotIndex(i));
    chips.append(b);
  }
  labelTimeline();
}

// ---------- panels ----------
function setupPanels() {
  $('#past-back').addEventListener('click', () => setSnapshotIndex(snapshots().length - 1));
  const panels = { 'btn-players': 'panel-players', 'btn-explore': 'panel-explore', 'btn-nether': 'panel-nether', 'btn-time': 'panel-time', 'btn-data': 'panel-data' };
  const close = () => Object.entries(panels).forEach(([b, p]) => { $('#' + p).hidden = true; $('#' + b).classList.remove('on'); });
  for (const [b, p] of Object.entries(panels)) {
    $('#' + b).addEventListener('click', () => {
      const wasHidden = $('#' + p).hidden;
      close();
      $('#' + p).hidden = !wasHidden;
      $('#' + b).classList.toggle('on', wasHidden);
      refreshExplore();
    });
  }
  document.querySelectorAll('.panel .close').forEach((c) => c.addEventListener('click', () => { close(); refreshExplore(); }));

  $('#btn-contour').addEventListener('click', () => {
    const on = !$('#btn-contour').classList.contains('on');
    $('#btn-contour').classList.toggle('on', on);
    refreshContours();
    if (on) toast(map.getZoom() < -2 ? '等高線はもう少し拡大すると表示されます' : '等高線を表示(太い線は4本ごと)');
  });

  $('#btn-grid').addEventListener('click', () => {
    if (state.gridLayer) { map.removeLayer(state.gridLayer); state.gridLayer = null; }
    else state.gridLayer = new ChunkGrid({ minZoom: -6, maxZoom: 4, pmIgnore: true, zIndex: 5, updateWhenZooming: false }).addTo(map);
    $('#btn-grid').classList.toggle('on', !!state.gridLayer);
    toast(state.gridLayer ? 'チャンク線(16ブロック)と原点の線を表示' : 'チャンク線を非表示');
  });

  // nether converter
  const owX = $('#ow-x'), owZ = $('#ow-z'), neX = $('#ne-x'), neZ = $('#ne-z');
  const fromOw = () => { neX.value = owX.value === '' ? '' : Math.floor(owX.value / 8); neZ.value = owZ.value === '' ? '' : Math.floor(owZ.value / 8); };
  const fromNe = () => { owX.value = neX.value === '' ? '' : neX.value * 8; owZ.value = neZ.value === '' ? '' : neZ.value * 8; };
  owX.addEventListener('input', fromOw); owZ.addEventListener('input', fromOw);
  neX.addEventListener('input', fromNe); neZ.addEventListener('input', fromNe);
  $('#conv-from-center').addEventListener('click', () => {
    const { x, z } = block(map.getCenter());
    if (state.dim === 'nether') { neX.value = x; neZ.value = z; fromNe(); }
    else { owX.value = x; owZ.value = z; fromOw(); }
  });
  $('#ow-go').addEventListener('click', () => { if (owX.value !== '' && owZ.value !== '') goTo(Number(owX.value), Number(owZ.value), 'overworld'); });
  $('#ne-go').addEventListener('click', () => { if (neX.value !== '' && neZ.value !== '') goTo(Number(neX.value), Number(neZ.value), 'nether'); });

  // past maps
  const range = $('#time-range');
  const dateInput = $('#time-date');
  const setSnap = (i) => { state.snapshotIndex = i; range.value = i; labelTimeline(); refreshBase(); };
  setSnapshotIndex = setSnap;
  renderTimeline();
  dateInput.addEventListener('change', () => {
    const snaps = snapshots();
    const want = dateInput.value;
    if (!want || !snaps.length) return;
    const i = Math.max(0, snaps.map((s) => s.id).filter((id) => id <= want).length - 1);
    setSnap(i);
    if (snaps[i].id !== want) toast(`その日の地図はないので、${snaps[i].label || snaps[i].id}の地図を表示しています`);
  });
  range.addEventListener('input', () => setSnap(Number(range.value)));
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; $('#time-play').textContent = '▶ 再生'; };
  $('#time-play').addEventListener('click', () => {
    const n = snapshots().length;
    if (timer) { stop(); return; }
    if (n < 2) { toast('保存した地図が2つ以上になると再生できます'); return; }
    if (state.snapshotIndex >= n - 1) setSnap(0);
    $('#time-play').textContent = '■ 停止';
    timer = setInterval(() => {
      if (state.snapshotIndex >= snapshots().length - 1) { stop(); return; }
      setSnap(state.snapshotIndex + 1);
    }, 1500);
  });

  // data
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'mc-map', version: 1, exportedAt: new Date().toISOString(), annotations: state.annotations }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mc-map-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = sanitizeList(Array.isArray(data) ? data : data.annotations);
      const byId = new Map(state.annotations.map((a) => [a.id, a]));
      for (const a of incoming) {
        const cur = byId.get(a.id);
        if (!cur || cur.updatedAt <= a.updatedAt) byId.set(a.id, a);
      }
      state.annotations = [...byId.values()];
      store.save(); renderAll();
      toast(`${incoming.length}件を読み込みました`);
    } catch {
      toast('読み込めないファイルでした');
    }
  });
  updateDataCount();
}

function updateDataCount() {
  const count = (t) => state.annotations.filter((a) => t.includes(a.type)).length;
  const el = $('#data-count');
  if (el) el.textContent = `保存中: 印 ${count(['waypoint'])}件 / 文字 ${count(['text'])}件 / 図形・手書き ${count(['line', 'draw', 'polygon', 'rect', 'circle'])}件`;
}

// ---------- search ----------
function setupSearch() {
  const input = $('#search'), list = $('#search-results');
  let items = [], active = 0;
  const hide = () => { list.hidden = true; };
  const pick = (i) => { const it = items[i]; if (!it) return; hide(); input.blur(); it.go(); };
  const render = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      if (i === active) li.className = 'active';
      li.innerHTML = `<span class="dot" style="background:${esc(it.color)}"></span><div class="grow"><div>${esc(it.title)}</div><div class="meta">${esc(it.kind)} ・ ${esc(it.meta)}</div></div>`;
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(i); });
      list.append(li);
    });
    list.hidden = items.length === 0;
  };
  input.addEventListener('input', () => {
    const q = input.value.trim();
    items = []; active = 0;
    if (!q) { render(); return; }
    const lq = q.toLowerCase();
    const order = [...state.annotations].sort((p, q2) => (p.type !== 'waypoint') - (q2.type !== 'waypoint'));
    for (const a of order) {
      const hay = `${a.name || ''} ${a.text || ''} ${a.note || ''}`.toLowerCase();
      if (!hay.includes(lq)) continue;
      const c = annCenter(a);
      items.push({
        color: a.color,
        kind: { waypoint: 'ピン', text: '文字' }[a.type] || '図形',
        title: a.name || a.text || '(名前なし)',
        meta: `${DIMS[a.dim].name}  X ${c.x} / Z ${c.z}`,
        go: () => { goTo(c.x, c.z, a.dim, 0); openAnnPopup(a.id); },
      });
      if (items.length >= 30) break;
    }
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
    else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('focus', () => { if (items.length) list.hidden = false; });

  // Coordinates: type X and Z, then jump there.
  const cx = $('#find-x'), cz = $('#find-z'), go = $('#find-go');
  const ready = () => cx.value.trim() !== '' && cz.value.trim() !== '' && Number.isFinite(Number(cx.value)) && Number.isFinite(Number(cz.value));
  const update = () => { go.disabled = !ready(); };
  const jump = () => {
    if (!ready()) return;
    const x = Math.floor(Number(cx.value)), z = Math.floor(Number(cz.value));
    cx.blur(); cz.blur();
    goTo(x, z, null, 1);
    openCoordPopup(ll(x + 0.5, z + 0.5));
  };
  for (const el of [cx, cz]) {
    el.addEventListener('input', update);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (el === cx && cz.value.trim() === '') cz.focus(); else jump();
    });
  }
  go.addEventListener('click', jump);
  update();
}

// ---------- players, deaths, explorers, who's online ----------
const PLAYER_COLORS = ['#ff5252', '#29b6f6', '#ffb300', '#66bb6a', '#ab47bc', '#ff7043', '#26c6da', '#d4e157', '#ec407a', '#8d6e63'];
const playerGroup = L.layerGroup();
// Game-style marker: a dark outline, a light body and a shadow on the ground; the body lifts on hover.
const DEATH_SVG = `<svg class="gm-svg" viewBox="0 0 24 34" width="20" height="28"><ellipse class="gm-shadow" cx="12" cy="31" rx="6.5" ry="2"/>`
  + '<g class="gm-body"><path d="M12 4.5v21M5 11.5h14" stroke="#1b1d22" stroke-width="7" stroke-linecap="round"/>'
  + '<path d="M12 4.5v21M5 11.5h14" stroke="#f4f1ea" stroke-width="3.5" stroke-linecap="round"/></g></svg>';
let exploreLayer = null;

function playerColor(key) {
  const i = state.players.findIndex((p) => p.key === key);
  return i < 0 ? '#9e9e9e' : PLAYER_COLORS[i % PLAYER_COLORS.length];
}
function playerName(key) {
  if (key === '_') return '記録を始める前';
  if (key === '?') return 'わからない';
  return state.players.find((p) => p.key === key)?.name || '(不明)';
}
function timeText(ms) {
  if (!ms) return '';
  const t = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
function agoText(ms) {
  if (!ms) return '未ログイン';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${Math.max(1, min)}分前`;
  if (min < 60 * 24) return `${Math.round(min / 60)}時間前`;
  return `${Math.round(min / 1440)}日前`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function placeText(p) {
  if (p.online === true) return `プレイ中 ・ 現在地(${timeText(state.worldAt)} の記録)`;
  if (p.online === false) return `最終ログアウト位置${p.lastSeenOnline ? `(${timeText(p.lastSeenOnline)} ごろ)` : ''}`;
  return '最後に記録された位置(誰の記録かまだ分かりません)';
}

function renderPlayers() {
  playerGroup.clearLayers();
  const showDeaths = $('#show-deaths').checked;
  for (const p of state.players) {
    const color = playerColor(p.key);
    if (p.dim === state.dim) {
      const off = p.online !== true;
      const cls = p.online === true ? 'on' : p.online === false ? 'off' : 'unk';
      const m = L.marker(ll(p.x + 0.5, p.z + 0.5), {
        pmIgnore: true, zIndexOffset: off ? 900 : 1000,
        icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="pl-icon ${cls}" style="transform:translate(-50%,-9px)"><span class="dot" style="background:${color}"></span><span class="nm">${esc(p.name)}</span></div>` }),
      });
      m.bindPopup(() => `<div class="pop"><h4>${esc(p.name)}</h4><div class="sub">${esc(placeText(p))}</div><div class="xyz">X ${p.x} / Y ${p.y} / Z ${p.z}</div><div class="sub">${esc(otherDimLine(p.x, p.z, p.dim))}</div></div>`);
      playerGroup.addLayer(m);
    }
    const d = p.death;
    if (showDeaths && d && d.dim === state.dim) {
      const m = L.marker(ll(d.x + 0.5, d.z + 0.5), {
        pmIgnore: true,
        icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html: `<div class="death-icon gm" style="transform:translate(-50%,-25px)">${DEATH_SVG}<span class="nm">${esc(p.name)}</span></div>` }),
      });
      m.bindPopup(() => `<div class="pop"><h4 class="death-h">${DEATH_SVG} ${esc(p.name)}が最後に死んだ場所</h4><div class="xyz">X ${d.x} / Y ${d.y} / Z ${d.z}</div></div>`);
      playerGroup.addLayer(m);
    }
  }
  const list = $('#player-list');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.className = 'click';
    const status = p.online === true ? '現在地' : p.online === false ? 'ログアウト位置' : '記録';
    li.innerHTML = `<span class="dot" style="background:${playerColor(p.key)};opacity:${p.online === true ? 1 : 0.5}"></span><span class="grow">${esc(p.name)}</span><span class="sub">${status} ${DIMS[p.dim]?.name || ''} ${p.x}, ${p.z}</span>`;
    li.addEventListener('click', () => { goTo(p.x, p.z, p.dim, 0); });
    list.append(li);
  }
  if (!state.players.length) list.innerHTML = '<li class="sub">まだ記録がありません</li>';
}

const ExploreLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const ctx = tile.getContext('2d');
    const scale = Math.pow(2, coords.z);
    const bx = coords.x * 256 / scale, bz = coords.y * 256 / scale, span = 256 / scale;
    const size = Math.max(1, 16 * scale);
    const owners = state.explore?.dims?.[state.dim] || {};
    for (const [key, chunks] of Object.entries(owners)) {
      if (key === '_') continue;
      ctx.fillStyle = key === '?' ? '#000000' : playerColor(key);
      for (const [cx, cz] of chunks) {
        const x = cx * 16, z = cz * 16;
        if (x + 16 < bx || x > bx + span || z + 16 < bz || z > bz + span) continue;
        ctx.fillRect((x - bx) * scale, (z - bz) * scale, size, size);
      }
    }
    return tile;
  },
});

function renderExploreLegend() {
  const list = $('#explore-legend');
  list.innerHTML = '';
  const owners = state.explore?.dims?.[state.dim] || {};
  const rows = Object.entries(owners).map(([k, cs]) => [k, cs.length]).sort((a, b) => b[1] - a[1]);
  for (const [key, n] of rows) {
    const li = document.createElement('li');
    const color = key === '_' ? 'transparent' : key === '?' ? '#000' : playerColor(key);
    li.innerHTML = `<span class="dot" style="background:${color};border:1px solid #fff5"></span><span class="grow">${esc(playerName(key))}</span><span class="sub">${n} チャンク</span>`;
    list.append(li);
  }
  if (!rows.length) list.innerHTML = '<li class="sub">まだ記録がありません</li>';
}

function refreshExplore() {
  if (exploreLayer) { map.removeLayer(exploreLayer); exploreLayer = null; }
  if ($('#btn-explore').classList.contains('on')) {
    exploreLayer = new ExploreLayer({ minZoom: -6, maxZoom: 4, opacity: 0.45, pmIgnore: true, zIndex: 4, updateWhenZooming: false }).addTo(map);
  }
  renderExploreLegend();
}

let lastPlayersJson = '';

// The GitHub API answers "unchanged" (304) for free, so polling it stays fresh without the file server's 5-minute cache.
async function fetchLive() {
  if (state.config.liveApiUrl) {
    try {
      const res = await fetch(state.config.liveApiUrl, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.raw' } });
      if (res.ok) return await res.json();
    } catch { /* fall back to the file server */ }
  }
  return fetchJson(state.config.liveUrl);
}

async function refreshConfig() {
  const cfg = await fetchJson(`config.json?t=${Date.now()}`);
  if (!cfg || !Array.isArray(cfg.snapshots) || cfg.updatedAt === state.config.updatedAt) return;
  const before = snapshots();
  const wasLatest = state.snapshotIndex >= before.length - 1;
  const viewing = before[state.snapshotIndex]?.id;
  state.config.snapshots = cfg.snapshots.filter((x) => x && x.id);
  state.config.updatedAt = cfg.updatedAt;
  if (!state.config.snapshots.length) return;
  state.demo = false;
  const latest = state.config.snapshots[state.config.snapshots.length - 1].id;
  manifests.delete(latest);
  const keep = state.config.snapshots.findIndex((x) => x.id === viewing);
  state.snapshotIndex = wasLatest || keep < 0 ? state.config.snapshots.length - 1 : keep;
  renderTimeline();
  await loadBlockNames();
  refreshBase();
  state.explore = await fetchJson(`explore.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  refreshExplore();
}

async function refreshLive() {
  const badge = $('#online-badge');
  const list = $('#live-list');
  if (!state.config.liveUrl) {
    $('#live-title').textContent = '参加中の人(まだ設定されていません)';
    return;
  }
  const data = await fetchLive();
  if (!data) { list.innerHTML = '<li class="sub">まだ情報がありません</li>'; badge.hidden = true; return; }
  const members = (Array.isArray(data.members) ? data.members : []).filter((m) => m.name)
    .sort((a, b) => (b.online - a.online) || ((b.lastLogin || 0) - (a.lastLogin || 0)));
  const online = members.filter((m) => m.online);
  badge.textContent = online.length;
  badge.hidden = online.length === 0;
  const at = typeof data.updatedAt === 'number' ? data.updatedAt : Date.parse(data.updatedAt);
  $('#live-title').innerHTML = `参加中の人 <span class="sub">${online.length}人がプレイ中 ・ ${esc(timeText(at))} 時点</span>`;
  list.innerHTML = '';
  for (const m of members) {
    const li = document.createElement('li');
    const when = m.online ? 'プレイ中' : m.lastSeenOnline ? `${esc(agoText(m.lastSeenOnline))}まで遊んでいた` : '最終ログイン ' + esc(agoText(m.lastLogin));
    li.innerHTML = `<span class="dot" style="background:${m.online ? 'var(--accent)' : '#555'}"></span><span class="grow">${esc(m.name)}</span><span class="sub">${when}</span>`;
    list.append(li);
  }

  const players = Array.isArray(data.players) ? data.players : [];
  const json = JSON.stringify(players);
  state.worldAt = data.worldAt;
  $('#players-updated').textContent = data.worldAt ? `${timeText(data.worldAt)} の記録` : '';
  if (json !== lastPlayersJson) {
    lastPlayersJson = json;
    state.players = players;
    renderPlayers();
    renderExploreLegend();
  }
}

async function setupPlayers() {
  state.explore = await fetchJson(`explore.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  playerGroup.addTo(map);
  renderPlayers();
  $('#show-deaths').addEventListener('change', renderPlayers);
  await refreshLive();
  setInterval(refreshLive, 60000);
  setInterval(refreshConfig, 60000);
}

// ---------- boot ----------
async function loadConfig() {
  try {
    const res = await fetch(`config.json?t=${Date.now()}`, { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch { /* fall through to demo */ }
  return {};
}

async function main() {
  const cfg = await loadConfig();
  state.config = {
    title: cfg.title || 'Blockmap',
    tileUrl: cfg.tileUrl || 'tiles/{snapshot}/{dim}/{z}/{x}/{y}.png',
    minNativeZoom: Number.isFinite(cfg.minNativeZoom) ? cfg.minNativeZoom : -4,
    maxNativeZoom: Number.isFinite(cfg.maxNativeZoom) ? cfg.maxNativeZoom : 0,
    snapshots: Array.isArray(cfg.snapshots) ? cfg.snapshots.filter((s) => s && s.id) : [],
    updatedAt: cfg.updatedAt,
    liveUrl: typeof cfg.liveUrl === 'string' && /^https:\/\//.test(cfg.liveUrl) ? cfg.liveUrl : null,
    liveApiUrl: typeof cfg.liveApiUrl === 'string' && /^https:\/\/api\.github\.com\//.test(cfg.liveApiUrl) ? cfg.liveApiUrl : null,
  };
  document.title = state.config.title;
  state.demo = state.config.snapshots.length === 0;
  state.snapshotIndex = snapshots().length - 1;

  map = L.map('map', {
    crs: L.CRS.Simple, center: ll(0, 0), zoom: 0, minZoom: -6, maxZoom: 4,
    zoomSnap: 1, zoomControl: false, attributionControl: true, tap: false,
  });
  L.control.zoom({ position: 'bottomright', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map);
  map.pm.setLang('ja');
  map.pm.setGlobalOptions({ snappable: false, continueDrawing: false, tooltips: false });
  annGroup.addTo(map);

  await loadBlockNames();
  refreshBase();
  state.annotations = store.load();
  renderAll();
  setupTools();
  setupCoords();
  setupPanels();
  setupSearch();
  await setupPlayers();
  document.querySelectorAll('#dims button').forEach((b) => b.addEventListener('click', () => setDim(b.dataset.dim)));
  setMode('none');
  window.mcmap = { state, map, refreshConfig, refreshLive };
}

main();
