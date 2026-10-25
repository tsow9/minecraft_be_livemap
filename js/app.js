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
  // Keeps a copy on this device; when sharing, also sends what changed to the group's server.
  save() {
    store.saveLocal();
    if (sharing()) queueChanges();
  },
  saveLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.annotations)); }
    catch { toast('この端末に保存できませんでした'); }
    updateDataCount();
  },
};

// ---------- sharing: pins and drawings live on the group's server (share/worker.js) ----------
// Anyone can look; writing needs the group's passphrase, which this device remembers once entered.
const PASS_KEY = 'mcmap.pass';
const SYNC_KEY = 'mcmap.sync.v1';
const LOCAL_ONLY_KEY = 'mcmap.localOnly.v1';
const share = { url: null, rev: 0, synced: new Map(), pending: new Map(), trash: new Map(), pushing: false, localOnly: [] };

function sharing() { return !!share.url; }
function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch { return ''; } }
function setPass(v) { try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch { /* private mode */ } }

function saveSyncState() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ rev: share.rev, synced: [...share.synced], pending: [...share.pending] }));
  } catch { /* private mode: changes still go out while the page is open */ }
}

function loadSyncState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch { /* ignore */ }
  try { share.localOnly = sanitizeList(JSON.parse(localStorage.getItem(LOCAL_ONLY_KEY) || '[]')); } catch { share.localOnly = []; }
  if (saved) {
    share.rev = Number(saved.rev) || 0;
    share.synced = new Map(Array.isArray(saved.synced) ? saved.synced : []);
    share.pending = new Map(Array.isArray(saved.pending) ? saved.pending : []);
    return;
  }
  // First time sharing on this device: what was drawn before stays aside until someone chooses to share it.
  if (state.annotations.length) {
    share.localOnly = sanitizeList([...share.localOnly, ...state.annotations]);
    try { localStorage.setItem(LOCAL_ONLY_KEY, JSON.stringify(share.localOnly)); } catch { /* ignore */ }
  }
  state.annotations = [];
  store.saveLocal();
  saveSyncState();
}

// Compares what is on the map with what the server last had, and lines up the differences to send.
function queueChanges() {
  const now = new Map(state.annotations.map((a) => [a.id, a]));
  for (const [id, p] of share.pending) {
    if (!p.deleted && !now.has(id) && !share.synced.has(id)) share.pending.delete(id);
  }
  for (const [id, a] of now) {
    const j = JSON.stringify(a);
    if (share.synced.get(id) !== j && share.pending.get(id)?.json !== j) share.pending.set(id, { data: a, deleted: false, json: j });
  }
  for (const [id, j] of share.synced) {
    if (!now.has(id) && !share.pending.get(id)?.deleted) share.pending.set(id, { data: JSON.parse(j), deleted: true, json: j });
  }
  saveSyncState();
  clearTimeout(share.pushTimer);
  share.pushTimer = setTimeout(pushChanges, 400);
}

async function pushChanges() {
  if (share.pushing || !share.pending.size) return;
  const pass = getPass();
  if (!pass) { askPass(); return; }
  share.pushing = true;
  let retry = 10000;
  const batch = [...share.pending].slice(0, 200);
  try {
    const res = await fetch(`${share.url}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Passphrase': pass },
      body: JSON.stringify({ items: batch.map(([id, p]) => ({ id, data: p.data, deleted: p.deleted })) }),
    });
    if (res.status === 401) {
      setPass('');
      retry = 0;
      toast('書き込みの許可が切れました。新しい招待リンクを開いてください');
      askPass();
    } else if (res.ok) {
      retry = 0;
      for (const [id, p] of batch) {
        if (share.pending.get(id) === p) share.pending.delete(id);
        if (p.deleted) { share.synced.delete(id); share.trash.set(id, { data: p.data, at: Date.now() }); }
        else { share.synced.set(id, p.json); share.trash.delete(id); }
      }
      saveSyncState();
      renderShareStatus();
    }
  } catch { /* offline: try again shortly */ }
  share.pushing = false;
  if (share.pending.size && getPass()) setTimeout(pushChanges, retry);
}

// Brings in what others changed. A full pull (page open) also drops things the server no longer has.
async function pullChanges(full = false) {
  let data;
  try {
    const since = full ? 0 : Math.max(0, share.rev - 10000 * 1000);
    const res = await fetch(`${share.url}/items?since=${since}`, { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }
  if (!Array.isArray(data?.items)) return;
  let changed = false;
  const seen = new Set();
  const removeLocal = (id) => {
    const before = state.annotations.length;
    state.annotations = state.annotations.filter((a) => a.id !== id);
    if (state.annotations.length !== before) { removeAnnLayer(id); changed = true; }
  };
  for (const it of data.items) {
    seen.add(it.id);
    if (share.pending.has(it.id)) continue;
    const clean = sanitize({ ...it.data, id: it.id });
    if (!clean) continue;
    if (it.deleted) {
      share.trash.set(it.id, { data: clean, at: Math.floor(it.rev / 1000) });
      share.synced.delete(it.id);
      removeLocal(it.id);
      continue;
    }
    share.trash.delete(it.id);
    const j = JSON.stringify(clean);
    if (share.synced.get(it.id) === j && state.annotations.some((a) => a.id === it.id)) continue;
    share.synced.set(it.id, j);
    const i = state.annotations.findIndex((a) => a.id === it.id);
    if (i >= 0) state.annotations[i] = clean; else state.annotations.push(clean);
    renderAnn(clean);
    changed = true;
  }
  if (full) {
    for (const id of [...share.synced.keys()]) {
      if (!seen.has(id) && !share.pending.has(id)) { share.synced.delete(id); removeLocal(id); }
    }
  }
  share.rev = Math.max(share.rev, Number(data.rev) || 0);
  saveSyncState();
  if (changed) store.saveLocal();
  renderShareStatus();
}

// Asks for the passphrase (once per device). Resolves true when this device may write.
let passAsk = null;
function askPass() {
  if (passAsk) return passAsk;
  const dlg = $('#pass-dialog');
  passAsk = new Promise((resolve) => {
    $('#pass-error').textContent = '';
    $('#pass-input').value = '';
    const finish = (ok) => {
      dlg.removeEventListener('close', onClose);
      $('#pass-form').removeEventListener('submit', onSubmit);
      passAsk = null;
      resolve(ok);
    };
    const onClose = () => finish(!!getPass());
    const onSubmit = async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      const pass = passFromText($('#pass-input').value);
      if (!pass) return;
      $('#pass-error').textContent = '確認中…';
      try {
        const res = await fetch(`${share.url}/check`, { method: 'POST', headers: { 'X-Passphrase': pass } });
        if (res.ok) {
          setPass(pass);
          dlg.close();
          toast('書き込めるようになりました');
          renderShareStatus();
          pushChanges();
          return;
        }
        $('#pass-error').textContent = res.status === 401 ? 'このリンクは使えません。新しい招待リンクをもらってください' : 'うまく確認できませんでした';
      } catch {
        $('#pass-error').textContent = '通信できませんでした。電波のよいところでもう一度';
      }
    };
    dlg.addEventListener('close', onClose);
    $('#pass-form').addEventListener('submit', onSubmit);
    dlg.showModal();
    setTimeout(() => $('#pass-input').focus(), 50);
  });
  return passAsk;
}

// The invite link carries the passphrase after # (that part never leaves this device's browser).
function passFromText(text) {
  const t = String(text || '').trim();
  const m = t.match(/[#&]join=([^&\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return t;
}
function inviteLink() {
  return `${location.origin}${location.pathname}#join=${encodeURIComponent(getPass())}`;
}

// Opening an invite link: remember the passphrase on this device and take it out of the address bar.
async function joinFromLink() {
  const m = location.hash.match(/[#&]join=([^&]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let pass;
  try { pass = decodeURIComponent(m[1]); } catch { pass = m[1]; }
  if (!sharing()) { setPass(pass); toast('招待リンクを受け取りました(共有の準備ができると書き込めます)'); return; }
  try {
    const res = await fetch(`${share.url}/check`, { method: 'POST', headers: { 'X-Passphrase': pass } });
    if (res.ok) {
      setPass(pass);
      toast('招待リンクを確認しました。ピンや図形を書き込めます');
      renderShareStatus();
      pushChanges();
    } else if (res.status === 401) {
      toast('この招待リンクは使えません。合言葉が合っているか確かめてください');
    } else {
      toast(`共有サーバーがうまく答えませんでした(${res.status})`);
    }
  } catch {
    toast('通信できませんでした。もう一度リンクを開いてください');
  }
}

// Call before anything that changes pins or drawings.
async function ensureWriter() {
  if (!sharing() || getPass()) return true;
  return askPass();
}

function renderShareStatus() {
  if (!sharing()) return;
  const st = $('#share-status');
  st.textContent = getPass()
    ? (share.pending.size ? `送信待ち ${share.pending.size}件(つながると自動で送ります)` : 'みんなと共有中・書き込めます')
    : '見るだけ(招待リンクを開くと書き込めます)';
  $('#share-login').hidden = !!getPass();
  $('#share-invite').hidden = !getPass();
  const lo = $('#local-only');
  lo.hidden = !share.localOnly.length;
  $('#local-only-count').textContent = share.localOnly.length;
  const list = $('#trash-list');
  list.innerHTML = '';
  const items = [...share.trash.values()].sort((a, b) => b.at - a.at).slice(0, 30);
  for (const t of items) {
    const li = document.createElement('li');
    const kind = { waypoint: 'ピン', text: '文字' }[t.data.type] || '図形';
    li.innerHTML = `<span class="dot" style="background:${esc(t.data.color)}"></span><span class="grow"></span><span class="sub"></span>`;
    li.querySelector('.grow').textContent = t.data.name || t.data.text || kind;
    li.querySelector('.sub').textContent = `${kind}・${timeText(t.at)}`;
    li.append(button('戻す', async () => {
      if (!(await ensureWriter())) return;
      share.trash.delete(t.data.id);
      addAnn({ ...t.data, updatedAt: Date.now() });
      toast('元に戻しました');
      renderShareStatus();
    }));
    list.append(li);
  }
  $('#trash').hidden = !items.length;
}

function setupShare() {
  // Pasting the link into the address bar of an open page only changes the part after #, so watch for that too.
  window.addEventListener('hashchange', joinFromLink);
  if (!sharing()) { joinFromLink(); return; }
  document.body.classList.add('shared');
  loadSyncState();
  renderAll();
  $('#share-login').addEventListener('click', () => askPass());
  $('#share-invite').addEventListener('click', () => copyText(inviteLink(), '招待リンクをコピーしました。仲間にだけ送ってください'));
  $('#local-only-send').addEventListener('click', async () => {
    if (!(await ensureWriter())) return;
    const ids = new Set(state.annotations.map((a) => a.id));
    for (const a of share.localOnly) if (!ids.has(a.id)) state.annotations.push(a);
    const n = share.localOnly.length;
    share.localOnly = [];
    try { localStorage.removeItem(LOCAL_ONLY_KEY); } catch { /* ignore */ }
    store.save();
    renderAll();
    toast(`${n}件をみんなと共有しました`);
  });
  renderShareStatus();
  joinFromLink();
  pullChanges(true).then(() => { if (share.pending.size && getPass()) pushChanges(); });
  setInterval(() => { if (document.visibilityState === 'visible') pullChanges(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullChanges(); });
}

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
  t.textContent = msg;
  t.hidden = false;
  void t.offsetWidth;  // start the fade-in from the hidden state
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast(message || `コピーしました: ${text}`);
}

// "~" lets the copied text work directly in /tp when Y is unknown.
const coordText = (x, z, y) => `${x} ${y ?? '~'} ${z}`;

function otherDimLine(x, z, dim = state.dim) {
  if (dim === 'overworld') return `ネザー X ${Math.floor(x / 8)} / Z ${Math.floor(z / 8)}`;
  if (dim === 'nether') return `地上 X ${x * 8} / Z ${z * 8}`;
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

// Pins are game-style checkpoint flags; the foot of the pole marks the spot.
const flagSvg = (c) => `<svg class="gm-svg flag" viewBox="0 0 26 36" width="22.4" height="31"><ellipse class="gm-shadow" cx="8" cy="33" rx="5.5" ry="1.8"/>`
  + `<g class="gm-body"><path d="M7 31V5" stroke="#1b1d22" stroke-width="5" stroke-linecap="round"/><path d="M7 31V5" stroke="#f4f1ea" stroke-width="2" stroke-linecap="round"/>`
  + `<path d="M8.5 5.5h13l-3.5 5 3.5 5h-13z" fill="${c}" stroke="#1b1d22" stroke-width="2.6" stroke-linejoin="round"/></g></svg>`;

function makeLayer(a) {
  const pts = () => a.pts.map((p) => ll(p[0], p[1]));
  switch (a.type) {
    case 'waypoint':
      return L.marker(ll(a.x + 0.5, a.z + 0.5), {
        icon: L.divIcon({
          className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div style="transform:translate(-50%,-28.4px)" class="wp-icon gm">${flagSvg(a.color)}${a.name ? `<span class="nm" style="--c:${a.color}">${esc(a.name)}</span>` : ''}</div>`,
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
    button('ここに印をつける', async () => { map.closePopup(); if (await ensureWriter()) createWaypoint(x, z); }, 'pin'),
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
  const del = button('削除', async () => { if (!(await ensureWriter())) return; deleteAnn(a.id); toast('削除しました'); }, 'trash');
  del.classList.add('danger');
  acts.append(button('編集', async () => { map.closePopup(); if (await ensureWriter()) openEditor(a, false); }, 'pencil'), del);
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
  const canCancel = mode !== 'none' && window.matchMedia('(pointer: fine)').matches;
  $('#mode-hint').textContent = (HINTS[mode] || '') + (canCancel ? '(Esc・右クリックでやめる)' : '');
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
  $('#btn-tools').addEventListener('click', async () => {
    const t = $('#tools');
    if (t.hidden && !(await ensureWriter())) return;
    t.hidden = !t.hidden;
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
  setupCancel();
}

// Esc or right-click: drop the shape being drawn and go back to the normal pointer.
function setupCancel() {
  const cancel = () => {
    if (state.mode === 'none') return false;
    setMode('none');
    return true;
  };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || editor.open || e.target.closest?.('input, textarea')) return;
    cancel();
  });
  map.getContainer().addEventListener('contextmenu', (e) => {
    if (state.mode === 'none') return;
    e.preventDefault();
    cancel();
  });
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
// The drawing itself lives in contour-core.js and normally runs in a background worker.
let contourLayer = null;
const groundGrids = new Map();

// Fallback for browsers without background drawing: decode a ground tile on the page.
function loadGroundGrid(url) {
  if (groundGrids.has(url)) return groundGrids.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      resolve(decodeGround(ctx.getImageData(0, 0, c.width, c.height).data, c.width * c.height));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  groundGrids.set(url, p);
  if (groundGrids.size > 200) groundGrids.delete(groundGrids.keys().next().value);
  return p;
}

let contourWorker = null;
const contourJobs = new Map();
let contourJobId = 0;
function getContourWorker() {
  if (contourWorker !== null) return contourWorker;
  contourWorker = false;
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return false;
  try {
    const v = (document.querySelector('script[src*="contour-core.js"]')?.src.split('?')[1]) || '';
    contourWorker = new Worker(`js/contour-worker.js${v ? `?${v}` : ''}`);
    contourWorker.onmessage = (e) => {
      const job = contourJobs.get(e.data.id);
      contourJobs.delete(e.data.id);
      if (job) job(e.data.bitmap);
    };
    contourWorker.onerror = () => { contourWorker = false; };
  } catch { contourWorker = false; }
  return contourWorker;
}

const ContourLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    tile.width = tile.height = 256 * dpr;
    const scale = Math.pow(2, coords.z);
    const bx = coords.x * 256 / scale, bz = coords.y * 256 / scale;
    const cell = Math.max(1, scale);
    const stride = Math.max(1, 1 / scale);
    const n = 256 / cell;
    const tx0 = Math.floor(bx / 256), tz0 = Math.floor(bz / 256);
    const tx1 = Math.floor((bx + n * stride) / 256), tz1 = Math.floor((bz + n * stride) / 256);
    const urls = [];
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const u = infoUrl(tx, tz, 'ground');
        urls.push(u ? new URL(u, location.href).href : null);
      }
    }
    const p = { bx, bz, n, cell, stride, tx0, tz0, cols: tx1 - tx0 + 1, dpr };
    if (!urls.some(Boolean)) { setTimeout(() => done(null, tile)); return tile; }
    const worker = getContourWorker();
    if (worker) {
      const id = ++contourJobId;
      tile._contourJob = id;
      contourJobs.set(id, (bitmap) => {
        if (bitmap) { tile.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); }
        done(null, tile);
      });
      worker.postMessage({ id, urls, z: coords.z, p });
    } else {
      Promise.all(urls.map((u) => (u ? loadGroundGrid(u) : null))).then((grids) => {
        if (grids.some(Boolean)) drawContour(tile.getContext('2d'), grids, { ...p, step: contourStep(coords.z) });
        done(null, tile);
      }, () => done(null, tile));
    }
    return tile;
  },
});

function refreshContours() {
  if (contourLayer) { map.removeLayer(contourLayer); contourLayer = null; }
  if ($('#btn-contour').classList.contains('on') && !state.demo) {
    contourLayer = new ContourLayer({ minZoom: -2, maxZoom: 4, pmIgnore: true, zIndex: 3,
      updateWhenZooming: false, keepBuffer: 1 }).addTo(map);
    // Tiles that scroll away before they are drawn are dropped from the worker's queue.
    contourLayer.on('tileunload', (e) => {
      const id = e.tile._contourJob;
      if (id && contourJobs.has(id) && contourWorker) contourWorker.postMessage({ cancel: id });
    });
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
    if (!on) toast('等高線を非表示');
    else toast(map.getZoom() < -2 ? '等高線はもう少し拡大すると表示されます' : '等高線を表示(太い線は4本ごと)');
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
    if (!file || !(await ensureWriter())) return;
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
// Clearly different colors first: the first people get the easiest ones to tell apart.
const PLAYER_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60', '#c0ca33', '#6d4c41'];
const playerGroup = L.layerGroup();
// Game-style marker: a dark outline, a light body and a shadow on the ground; the body lifts on hover.
const DEATH_SVG = `<svg class="gm-svg" viewBox="0 0 24 34" width="20" height="28"><ellipse class="gm-shadow" cx="12" cy="31" rx="6.5" ry="2"/>`
  + '<g class="gm-body"><path d="M12 4.5v21M5 11.5h14" stroke="#1b1d22" stroke-width="7" stroke-linecap="round"/>'
  + '<path d="M12 4.5v21M5 11.5h14" stroke="#f4f1ea" stroke-width="3.5" stroke-linecap="round"/></g></svg>';
let exploreLayer = null;

const playerSvg = (c) => `<svg class="gm-svg" viewBox="0 0 20 24" width="17" height="20.4"><ellipse class="gm-shadow" cx="10" cy="21" rx="4.5" ry="1.4"/>`
  + `<g class="gm-body"><circle cx="10" cy="9" r="6.5" fill="${c}" stroke="#1b1d22" stroke-width="2.6"/><circle cx="10" cy="9" r="2.2" fill="#f4f1ea"/></g></svg>`;

// Each person keeps the same color: the order comes from their ID, not from where they are in the list
// (the list order changes as people log in and out). Colors are handed out from the top of the list.
const colorCache = new Map();
function playerColor(key) {
  if (!state.players.some((p) => p.key === key)) return '#9e9e9e';
  const keys = state.players.map((p) => p.key).sort();
  const sig = keys.join('|');
  if (colorCache.get('sig') !== sig) {
    colorCache.clear(); colorCache.set('sig', sig);
    const hash = (k) => { let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
    keys.sort((a, b) => hash(a) - hash(b) || (a < b ? -1 : 1))
      .forEach((k, i) => colorCache.set(k, PLAYER_COLORS[i % PLAYER_COLORS.length]));
  }
  return colorCache.get(key);
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
          html: `<div class="pl-icon gm ${cls}" style="transform:translate(-50%,-18px)"><span class="ring"></span>${playerSvg(color)}<span class="nm">${esc(p.name)}</span></div>` }),
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
  noteVersion(cfg?.version);
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
  // Phones pause background tabs, so also check right away when the page comes back into view.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshConfig(); });
}

// ---------- staying on the newest version of the site ----------
// When a new version is published, a small bar offers to switch; the page comes back to the same spot.
const APP_VERSION = (document.querySelector('script[src*="js/app.js"]')?.src.match(/[?&]v=([\w-]+)/) || [])[1] || '';
let newVersion = null;

function noteVersion(v) {
  if (!APP_VERSION || typeof v !== 'string' || !v || v === APP_VERSION || v === newVersion) return;
  newVersion = v;
  $('#update-bar').hidden = false;
}

function applyUpdate() {
  if (!newVersion) return;
  try {
    sessionStorage.setItem('mcmap.updated', '1');
    sessionStorage.setItem('mcmap.view', JSON.stringify({ ...block(map.getCenter()), zoom: map.getZoom(), dim: state.dim }));
  } catch { /* the view just starts over */ }
  // A new address skips the file server's cached copy of the page.
  location.replace(`${location.pathname}?v=${encodeURIComponent(newVersion)}`);
}

function setupUpdates() {
  $('#update-go').addEventListener('click', applyUpdate);
  if (/[?&]v=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  let view = null, updated = false;
  try {
    view = JSON.parse(sessionStorage.getItem('mcmap.view') || 'null');
    updated = sessionStorage.getItem('mcmap.updated') === '1';
    sessionStorage.removeItem('mcmap.view'); sessionStorage.removeItem('mcmap.updated');
  } catch { /* ignore */ }
  if (view && Number.isFinite(view.x) && Number.isFinite(view.z)) {
    if (DIMS[view.dim]) setDim(view.dim);
    map.setView(ll(view.x + 0.5, view.z + 0.5), Number.isFinite(view.zoom) ? view.zoom : map.getZoom(), { animate: false });
  }
  if (updated) toast('最新版に更新しました');
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
    shareUrl: typeof cfg.shareUrl === 'string' && /^https:\/\/[\w.-]+(:\d+)?$/.test(cfg.shareUrl.replace(/\/$/, '')) ? cfg.shareUrl.replace(/\/$/, '') : null,
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
  share.url = new URLSearchParams(location.search).get('share') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? new URLSearchParams(location.search).get('share') : state.config.shareUrl;
  renderAll();
  setupShare();
  setupTools();
  setupCoords();
  setupPanels();
  setupSearch();
  await setupPlayers();
  document.querySelectorAll('#dims button').forEach((b) => b.addEventListener('click', () => setDim(b.dataset.dim)));
  setMode('none');
  setupUpdates();
  window.mcmap = { state, map, refreshConfig, refreshLive };
}

main();
