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
// Closest zoom: 2^5 = 32 screen pixels per block (about 12 blocks across a phone).
const MAX_ZOOM = 5;
const ll = (x, z) => L.latLng(-z, x);
// On Cloudflare the map data sits in a folder whose name only invited visitors are given (set by the page).
const DATA = typeof window.BLOCKMAP_DATA === 'string' ? window.BLOCKMAP_DATA : '';
let noTapAbove = 0;  // phones: screen y where the search box, the dimension switch and the chips end
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
  },
};

// ---------- sharing: pins and drawings live on the group's server (share/worker.js) ----------
// Anyone can look; writing needs the group's passphrase, which this device remembers once entered.
const PASS_KEY = 'mcmap.pass';
const SYNC_KEY = 'mcmap.sync.v1';
const LOCAL_ONLY_KEY = 'mcmap.localOnly.v1';
const share = { url: null, rev: 0, synced: new Map(), pending: new Map(), pushing: false, me: null };
// On Cloudflare, signed in with Microsoft: the server knows who this is ({ name, role, via }); no passphrase needed.
const signedIn = () => share.me?.via === 'microsoft';
const mayWrite = () => (signedIn() ? share.me.role === 'admin' || share.me.role === 'writer' : !!getPass());

function sharing() { return !!share.url; }
// What this device may do: 'admin' (the owner's passphrase), 'writer' (a write link), or null (look only).
// On Cloudflare (DATA) writers can hand out the view link and the owner manages the write links;
// the old site's link carrying the passphrase itself is not offered there.
function showInvites(role) {
  share.role = role || null;
  $('#share-invite').hidden = !role || !!DATA;
  $('#site-invite').hidden = !DATA || role !== 'admin';
  $('#writers').hidden = !DATA || role !== 'admin';
  $('#privacy').hidden = !DATA || role !== 'admin';
  // The owner's menu (sign-in, the site's address, what to keep off the map, who may write) is the owner's alone.
  $('#btn-site').hidden = !DATA || role !== 'admin';
  if (DATA && role === 'admin') { loadAccess(); loadPrivacy(); }
  renderMe();
}
function renderMe() {
  const line = $('#me-line');
  line.hidden = !signedIn();
  if (!signedIn()) return;
  // The owner sees it at the top of the owner's menu; members at the end of the Realm's panel.
  const body = (id) => $(`#${id} .panel-body`) || $(`#${id}`);  // the body is made once the panels are set up
  if (share.me.role === 'admin') body('panel-site').prepend(line);
  else body('panel-realm').append(line);
  const what = { admin: '管理者', writer: '書き込みOK', viewer: '見るだけ' }[share.me.role] || '';
  line.textContent = `${share.me.name || ''} としてログイン中(${what}) `;
  line.append(button('ログアウト', async () => {
    await fetch(`${share.url}/logout`, { method: 'POST' }).catch(() => {});
    location.reload();
  }));
}

// The owner's list of the Realm's members: each one looks only until the owner lets them write.
async function loadAccess() {
  const list = $('#writer-list');
  try {
    const res = await fetch(`${share.url}/access`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const { members } = await res.json();
    list.innerHTML = members.length ? '' : '<li class="sub">メンバーの情報がまだありません</li>';
    for (const m of members) {
      list.append(switchRow(m.name || '(名前なし)', ['見るだけ', '書き込みOK'], m.write, `${m.name || 'このメンバー'}さんの書き込み`, async (on) => {
        const r = await fetch(`${share.url}/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ xid: m.xid, write: on }) }).catch(() => null);
        return !!r?.ok;
      }));
    }
  } catch { list.innerHTML = '<li class="sub">一覧を読み込めませんでした</li>'; }
}

// A row with an on/off switch. save(on) answers whether the change went through; if not, the switch goes back.
// Only this row changes, so a list stays in place.
function switchRow(label, words, on, aria, save) {
  const li = document.createElement('li');
  li.innerHTML = '<span class="grow"></span><span class="state"></span>'
    + '<label class="switch"><input type="checkbox" role="switch"><span class="knob"></span></label>';
  li.querySelector('.grow').textContent = label;
  const state = li.querySelector('.state'), box = li.querySelector('input');
  const show = (v) => { box.checked = v; state.textContent = words[v ? 1 : 0]; li.classList.toggle('on', v); };
  box.setAttribute('aria-label', aria);
  show(on);
  box.addEventListener('change', async () => {
    const want = box.checked;
    show(want);
    box.disabled = true;
    const ok = await save(want);
    box.disabled = false;
    if (ok) on = want;
    else { show(on); toast('変えられませんでした。もう一度ためしてください'); }
  });
  return li;
}

// What the owner keeps off the map, for everyone including the owner (the worker takes it out of what is sent).
async function loadPrivacy() {
  const list = $('#privacy-list');
  try {
    const res = await fetch(`${share.url}/privacy`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const hide = await res.json();
    const rows = [['chests', 'チェスト'], ['pets', 'ほかの人のペット']];
    list.innerHTML = '';
    for (const [key, what] of rows) {
      list.append(switchRow(what, ['見せる', '隠す'], hide[key], `${what}を隠す`, async (on) => {
        const r = await fetch(`${share.url}/privacy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: on }) }).catch(() => null);
        if (r?.ok) loadItems();
        return !!r?.ok;
      }));
    }
  } catch { list.innerHTML = '<li class="sub">設定を読み込めませんでした</li>'; }
}
const roleFrom = async (res) => (await res.json().catch(() => ({}))).role || 'writer';

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
  if (saved) {
    share.rev = Number(saved.rev) || 0;
    share.synced = new Map(Array.isArray(saved.synced) ? saved.synced : []);
    share.pending = new Map(Array.isArray(saved.pending) ? saved.pending : []);
    return;
  }
  // First time sharing on this device: what was drawn before is kept aside on this device, not shared.
  if (state.annotations.length) {
    let kept = [];
    try { kept = sanitizeList(JSON.parse(localStorage.getItem(LOCAL_ONLY_KEY) || '[]')); } catch { /* ignore */ }
    try { localStorage.setItem(LOCAL_ONLY_KEY, JSON.stringify(sanitizeList([...kept, ...state.annotations]))); } catch { /* ignore */ }
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
  if (!pass && !signedIn()) { askPass(); return; }
  if (!mayWrite()) return;
  share.pushing = true;
  let retry = 10000;
  const batch = [...share.pending].slice(0, 200);
  try {
    const res = await fetch(`${share.url}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(pass ? { 'X-Passphrase': pass } : {}) },
      body: JSON.stringify({ items: batch.map(([id, p]) => ({ id, data: p.data, deleted: p.deleted })) }),
    });
    if (res.status === 401 && signedIn() && !pass) {
      retry = 0;
      share.me.role = 'viewer';
      toast('書き込みの許可がなくなりました(管理者に頼んでください)');
    } else if (res.status === 401) {
      setPass('');
      retry = 0;
      toast('書き込みの許可が切れました。新しい招待リンクを開いてください');
      askPass();
    } else if (res.ok) {
      retry = 0;
      for (const [id, p] of batch) {
        if (share.pending.get(id) === p) share.pending.delete(id);
        if (p.deleted) share.synced.delete(id);
        else share.synced.set(id, p.json);
      }
      saveSyncState();
    }
  } catch { /* offline: try again shortly */ }
  share.pushing = false;
  if (share.pending.size && mayWrite()) setTimeout(pushChanges, retry);
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
      share.synced.delete(it.id);
      removeLocal(it.id);
      continue;
    }
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
      showInvites(await roleFrom(res));
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
  const m = t.match(/[#&](?:join|w)=([^&\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return t;
}
function inviteLink() {
  return `${location.origin}${location.pathname}#join=${encodeURIComponent(getPass())}`;
}

// Opening an invite link: remember the passphrase on this device and take it out of the address bar.
async function joinFromLink() {
  const m = location.hash.match(/[#&](?:join|w)=([^&]+)/);
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
      showInvites(await roleFrom(res));
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
  if (signedIn()) {
    if (mayWrite()) return true;
    toast('書き込みは、管理者が許可したメンバーだけです');
    return false;
  }
  return askPass();
}

function setupShare() {
  // Pasting the link into the address bar of an open page only changes the part after #, so watch for that too.
  window.addEventListener('hashchange', joinFromLink);
  if (!sharing()) { joinFromLink(); return; }
  document.body.classList.add('shared');
  showInvites(getPass() ? 'writer' : null);
  // On Cloudflare, ask who this is: signed in with Microsoft, or an older key (the owner's, or a write link).
  if (DATA) {
    fetch(`${share.url}/me`, { headers: getPass() ? { 'X-Passphrase': getPass() } : {}, cache: 'no-store' }).then(async (res) => {
      const me = res.ok ? await res.json() : null;
      if (getPass() && me?.via !== 'key') setPass('');  // that key no longer works
      share.me = me;
      showInvites(me && me.role !== 'viewer' ? me.role : null);
      if (share.pending.size && mayWrite()) pushChanges();
    }).catch(() => {});
  }
  $('#site-invite').addEventListener('click', () => copyText(`${location.origin}/`, 'サイトのURLをコピーしました。Realm のメンバーに送ってください(ログインすれば見られます)'));
  $('#share-invite').addEventListener('click', () => copyText(inviteLink(), '書き込み用の招待リンクをコピーしました。信頼できる仲間にだけ送ってください'));
  loadSyncState();
  renderAll();
  joinFromLink();
  pullChanges(true).then(() => { if (share.pending.size && mayWrite()) pushChanges(); });
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
  if (typeof a.by === 'string' && a.by) out.by = a.by.slice(0, 40);  // who made it (set by the server)
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

// The readout's second line: the same spot in the other dimension, written like the main X / Z.
function showOtherDim(x, z) {
  const el = $('#c-center-other');
  const part = (k, v) => `<span><i>${k}</i>${v}</span>`;
  if (state.dim === 'overworld') el.innerHTML = `<b>ネザー</b>${part('X', Math.floor(x / 8))}${part('Z', Math.floor(z / 8))}`;
  else if (state.dim === 'nether') el.innerHTML = `<b>地上</b>${part('X', x * 8)}${part('Z', z * 8)}`;
  else el.innerHTML = '';
}

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

// ---------- slime chunks ----------
// Bedrock picks slime chunks from the chunk position alone (the world seed plays no part): the game's
// random number generator (MT19937) is seeded with x * 0x1f1f1f1f XOR z, and a first number that is a
// multiple of 10 makes a slime chunk. Only that first number is needed, so only 398 of the 624 seeding steps run.
const slimeCache = new Map();
function isSlimeChunk(cx, cz) {
  const key = `${cx},${cz}`;
  const hit = slimeCache.get(key);
  if (hit !== undefined) return hit;
  const seed = (Math.imul(cx, 0x1f1f1f1f) ^ cz) >>> 0;
  let prev = seed, second = 0;
  for (let i = 1; i <= 397; i++) {
    prev = (Math.imul(0x6c078965, prev ^ (prev >>> 30)) + i) >>> 0;
    if (i === 1) second = prev;
  }
  const y = (seed & 0x80000000) | (second & 0x7fffffff);
  let v = (prev ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
  v ^= v >>> 11;
  v ^= (v << 7) & 0x9d2c5680;
  v ^= (v << 15) & 0xefc60000;
  v ^= v >>> 18;
  const slime = (v >>> 0) % 10 === 0;
  if (slimeCache.size > 200000) slimeCache.clear();
  slimeCache.set(key, slime);
  return slime;
}

const SLIME_MIN_ZOOM = -2;
const SlimeLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    if (state.dim !== 'overworld' || coords.z < SLIME_MIN_ZOOM) return tile;
    const ctx = tile.getContext('2d');
    const scale = Math.pow(2, coords.z), size = 16 * scale;
    const cx0 = coords.x * 256 / size, cz0 = coords.y * 256 / size, n = 256 / size;
    ctx.fillStyle = 'rgba(110, 230, 90, 0.32)';
    ctx.strokeStyle = 'rgba(150, 255, 120, 0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!isSlimeChunk(cx0 + i, cz0 + j)) continue;
        ctx.fillRect(i * size, j * size, size, size);
        if (size >= 8) ctx.strokeRect(i * size + 0.5, j * size + 0.5, size - 1, size - 1);
      }
    }
    return tile;
  },
});

// ---------- base map ----------
function snapshots() { return state.demo ? DEMO_SNAPSHOTS : state.config.snapshots; }

function makeBaseLayer() {
  // Load tiles once the zoom settles (not at every step on the way), and keep a few extra around for panning.
  const opts = { minZoom: -6, maxZoom: MAX_ZOOM, noWrap: true, pmIgnore: true, updateWhenZooming: false, keepBuffer: 3 };
  if (state.demo) {
    return new DemoLayer({ ...opts, dim: state.dim, week: state.snapshotIndex, maxNativeZoom: 2, attribution: 'デモ地形(本物の地図はまだ未設定)' });
  }
  const snap = snapshots()[state.snapshotIndex];
  const url = state.config.tileUrl.replace('{snapshot}', encodeURIComponent(snap.id)).replace('{dim}', state.dim);
  // Sharp screens (most phones) get the next more detailed picture shown at half size, so zoomed-out views stay crisp.
  const hi = (window.devicePixelRatio || 1) >= 1.5 ? 1 : 0;
  // Closer than the most detailed picture, tiles are enlarged on a canvas here (see createTile) rather than by the browser,
  // which on some phones smooths enlarged pictures into a blur.
  return new HistoryTileLayer(url, {
    ...opts, tileSize: 256 >> hi, zoomOffset: hi, manifest: manifests.get(snap.id), dim: state.dim,
    minNativeZoom: state.config.minNativeZoom - hi, maxNativeZoom: opts.maxZoom, detailZoom: state.config.maxNativeZoom - hi,
    backdropZoom: Math.min(state.config.maxNativeZoom, Math.max(state.config.minNativeZoom, BACKDROP_ZOOM)),
    attribution: esc(snapText(snap)),
  });
}

// Each day's manifest says which day's folder holds each tile (unchanged tiles are stored only once).
const EMPTY_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const manifests = new Map();
const enlargeCache = new Map();
const warmed = new Map();
// The detailed picture a closer zoom enlarges, loaded once.
function sourceImage(url) {
  if (!enlargeCache.has(url)) {
    enlargeCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
    if (enlargeCache.size > 60) enlargeCache.delete(enlargeCache.keys().next().value);
  }
  return enlargeCache.get(url);
}
// A rough picture of the whole area (16 blocks a pixel) stays loaded under the map, so that zooming out shows it,
// a little blurred, where the sharp pictures are still on their way, instead of the bare background.
const BACKDROP_ZOOM = -4;
const HistoryTileLayer = L.TileLayer.extend({
  onAdd(map) {
    L.TileLayer.prototype.onAdd.call(this, map);
    const z = this.options.backdropZoom;
    if (z == null) return;
    map.on('moveend', this._warmSoon, this);
    this._warmSoon();
    if (!map.getPane('backdrop')) map.createPane('backdrop').style.zIndex = 150;  // under the map's own pictures
    this._backdrop = new HistoryTileLayer(this._url, {
      pane: 'backdrop', manifest: this.options.manifest, dim: this.options.dim, noWrap: true, pmIgnore: true,
      minZoom: this.options.minZoom, maxZoom: this.options.maxZoom, minNativeZoom: z, maxNativeZoom: z,
      updateWhenZooming: false, keepBuffer: 4, opacity: 0,
    }).addTo(map);
    // Shown only while sharp pictures are still coming: once they are in, it would peek out, blurred, along the edges
    // of what has been explored.
    map.on('zoomstart', this._showBackdrop, this);
    this.on('loading', this._showBackdrop, this);
    this.on('load', this._hideBackdrop, this);
  },

  _showBackdrop() {
    clearTimeout(this._hideTimer);
    this._backdrop?.setOpacity(1);
  },
  // A little after the last picture is in, so it has faded in fully.
  _hideBackdrop() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this._backdrop?.setOpacity(0), 400);
  },

  onRemove(map) {
    map.off('moveend', this._warmSoon, this);
    map.off('zoomstart', this._showBackdrop, this);
    this.off('loading', this._showBackdrop, this);
    this.off('load', this._hideBackdrop, this);
    clearTimeout(this._hideTimer);
    clearTimeout(this._warmTimer);
    if (this._backdrop) map.removeLayer(this._backdrop);
    this._backdrop = null;
    L.TileLayer.prototype.onRemove.call(this, map);
  },

  getTileUrl(coords) {
    return this.urlAt(coords.x, coords.y, this._getZoomForUrl()) || EMPTY_TILE;
  },

  // Once the map stands still, fetch what one or two steps out and one step in would show, so the next zoom finds
  // its pictures already here (sharp at once, rather than the rough picture first).
  _warmSoon() {
    clearTimeout(this._warmTimer);
    this._warmTimer = setTimeout(() => this._warm(), 400);
  },

  _warm() {
    const map = this._map;
    if (!map) return;
    const now = Math.round(map.getZoom()), size = this.getTileSize().x, detail = this.options.detailZoom;
    for (const z of [now - 1, now + 1, now - 2]) {
      if (z < this.options.minNativeZoom || z > this.options.maxZoom) continue;
      const b = map.getPixelBounds(map.getCenter(), z);
      const lo = b.min.divideBy(size).floor(), hi = b.max.divideBy(size).floor();
      if ((hi.x - lo.x + 1) * (hi.y - lo.y + 1) > 80) continue;
      for (let x = lo.x; x <= hi.x; x++) {
        for (let y = lo.y; y <= hi.y; y++) {
          if (detail != null && z > detail) {
            const f = 2 ** (z - detail);
            const url = this.urlAt(Math.floor(x / f), Math.floor(y / f), detail + this.options.zoomOffset);
            if (url) sourceImage(url);
          } else {
            const url = this.urlAt(x, y, z + this.options.zoomOffset);
            if (url && !warmed.has(url)) {
              const img = new Image();
              img.src = url;
              warmed.set(url, img);  // held on to, so the browser keeps the picture ready
              if (warmed.size > 400) warmed.delete(warmed.keys().next().value);
            }
          }
        }
      }
    }
  },

  urlAt(x, y, z) {
    const m = this.options.manifest;
    if (!m) return null;
    const key = `${this.options.dim}/${z}/${x}/${y}`;
    const hit = m[key];
    return hit ? `${DATA}tiles/${encodeURIComponent(hit[0])}/${key}.png?v=${hit[1]}` : null;
  },

  _initTile(tile) {
    L.TileLayer.prototype._initTile.call(this, tile);
    if (tile.dataset?.overlap) tile.style.width = tile.style.height = `${this.getTileSize().x + 1}px`;
  },

  createTile(coords, done) {
    const detail = this.options.detailZoom;
    if (detail == null || coords.z <= detail) return L.TileLayer.prototype.createTile.call(this, coords, done);
    // Enlarge part of the most detailed picture, block by block (no smoothing), at the screen's full sharpness.
    const f = 2 ** (coords.z - detail);
    const size = this.getTileSize().x;
    // One extra pixel overlaps the next tile, so no thin seam shows between tiles on screens with uneven pixel ratios.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round((size + 1) * (window.devicePixelRatio || 1));
    canvas.dataset.overlap = '1';
    // Leaflet throws away pictures that are not "complete" when a zoom starts; a canvas has no such flag, so without
    // this every picture on screen went at each zoom and the map flashed until the new ones came.
    canvas.complete = true;
    const url = this.urlAt(Math.floor(coords.x / f), Math.floor(coords.y / f), detail + this.options.zoomOffset);
    if (!url) { setTimeout(() => done(null, canvas)); return canvas; }
    sourceImage(url).then((img) => {
      if (img) {
        const part = img.naturalWidth / f;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, (coords.x - Math.floor(coords.x / f) * f) * part, (coords.y - Math.floor(coords.y / f) * f) * part, part, part,
          0, 0, canvas.width, canvas.height);
      }
      done(null, canvas);
    });
    return canvas;
  },
});

// The corner: the day of the map, and when its world was saved (maps drawn before this was kept show the day only).
function snapText(snap) {
  const t = new Date(snap.savedAt);
  if (!snap.savedAt || Number.isNaN(t.getTime())) return snap.label || snap.id;
  return `${t.getMonth() + 1}月${t.getDate()}日 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

async function loadManifest(id) {
  const v = encodeURIComponent(state.config.updatedAt || '');
  if (!manifests.has(id)) manifests.set(id, (await fetchJson(`${DATA}manifests/${encodeURIComponent(id)}.json?v=${v}`))?.tiles || null);
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
    if (pickRouteTarget(a.id)) return;
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
    button('ピン', async () => { map.closePopup(); if (await ensureWriter()) createWaypoint(x, z); }, 'flag'),
    routeButton({ id: `point:${x}:${z}`, name: `X ${x} / Z ${z}`, x, z, dim: state.dim }),
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
  if (a.by) { const b = document.createElement('div'); b.className = 'sub'; b.textContent = `作った人: ${a.by}`; el.append(b); }
  const acts = document.createElement('div'); acts.className = 'acts';
  if (isPoint) acts.append(button('コピー', () => copyText(coordText(c.x, c.z, a.y)), 'copy'));
  if (a.type === 'waypoint') acts.append(routeButton({ id: a.id, name: a.name || 'ピン', x: a.x, z: a.z, dim: a.dim }));
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

  // A tap while a bubble is open just closes it; the next tap shows coordinates again.
  let popupWasOpen = false;
  map.on('preclick', () => { popupWasOpen = !!map._popup && map.hasLayer(map._popup); });
  map.on('click', (e) => {
    // Phones: the map showing between the search box, the dimension switch and the chips is never tapped on
    // purpose (a finger aiming at a chip lands there), so a tap up there does nothing.
    if (matchMedia('(max-width: 700px)').matches && e.originalEvent && e.originalEvent.clientY < noTapAbove) return;
    // A search result is marked: a tap on another spot of the map just takes the marking away.
    if (finds && state.mode === 'none' && !route.from) { clearFinds(); return; }
    const { x, z } = block(e.latlng);
    if (state.mode === 'none' && route.from && !popupWasOpen) {
      // Choosing a destination: a tap on an empty spot of the map picks that spot.
      setRouteTarget(null, { id: `point:${x}:${z}`, name: `X ${x} / Z ${z}`, x, z, dim: state.dim });
    } else if (state.mode === 'none') { if (!popupWasOpen) openCoordPopup(e.latlng); }
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
  const data = await fetchJson(`${DATA}blocks.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
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
  if (infoCache.size > 160) {
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
  return hit ? `${DATA}tiles/${encodeURIComponent(hit[0])}/${key}.png?v=${hit[1]}` : null;
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

// Biome tiles store, per block, the biome at the surface (value = biome ID + 1, 0 = unknown).
// Answers like blockAtNow: the name, nothing known, or a promise while the tile loads.
function biomeAtNow(x, z) {
  const tx = Math.floor(x / 256), tz = Math.floor(z / 256);
  const url = infoUrl(tx, tz, 'biome');
  if (!url) return { name: '' };
  if (!infoData.has(url)) return { pending: loadInfoTile(url) };
  const data = infoData.get(url);
  const v = data ? data.data[((z - tz * 256) * data.width + (x - tx * 256)) * 4] : 0;
  return { name: v ? BIOME_JA[v - 1] || '' : '' };
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
    contourLayer = new ContourLayer({ minZoom: -2, maxZoom: MAX_ZOOM, pmIgnore: true, zIndex: 3,
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
      for (const url of [infoUrl(tx, tz), infoUrl(tx, tz, 'biome')]) {
        if (url && !infoCache.has(url)) urls.push([Math.abs(tx - cx) + Math.abs(tz - cz), url]);
      }
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

function showCenterInfo(x, z, info, biome) {
  centerInfo = info;
  $('#c-biome').textContent = biome || '';
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
  const r = blockAtNow(x, z), b = biomeAtNow(x, z);
  if (!r.pending && !b.pending) { showCenterInfo(x, z, r.info, b.name); return; }
  showCenterInfo(x, z, r.info || null, b.name || '');
  Promise.all([r.pending, b.pending]).then(() => {
    const now = block(map.getCenter());
    if (now.x === x && now.z === z) showCenterInfo(x, z, blockAtNow(x, z).info, biomeAtNow(x, z).name);
  });
}

function setupCoords() {
  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const { x, z } = block(map.getCenter());
      showOtherDim(x, z);
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
  // Close it and bring it back with the small button.
  const box = $('#coords'), open = $('#coords-open');
  // The fold button switches between everything and the X/Y/Z alone.
  const save = () => {
    const mode = box.hidden ? 'closed' : box.classList.contains('only') ? 'only' : 'open';
    try { localStorage.setItem('mcmap.coords', mode); } catch { /* private mode */ }
  };
  const show = (visible) => { box.hidden = !visible; open.hidden = visible; save(); };
  const fold = (only) => {
    box.classList.toggle('only', only);
    $('#coords-mode').title = only ? 'ブロック名やバイオームも表示する' : '座標だけの表示にする';
    save();
  };
  $('#coords-mode').addEventListener('click', (e) => { e.stopPropagation(); fold(!box.classList.contains('only')); });
  $('#coords-close').addEventListener('click', (e) => { e.stopPropagation(); show(false); });
  open.addEventListener('click', () => show(true));
  // Phones: the readout reaches right up to the dimension switch beside it.
  const dims = $('#dims');
  // …and the side buttons start just below the switch (or the clock under it), never on top of them.
  const keepWidth = () => {
    const root = document.documentElement.style;
    root.setProperty('--dims-left', `${Math.floor(dims.getBoundingClientRect().left)}px`);
    const clock = $('#clock');
    const above = clock.hidden || getComputedStyle(clock).position !== 'static' ? dims : clock;
    root.setProperty('--clock-w', `${clock.hidden ? 0 : Math.ceil(clock.getBoundingClientRect().width)}px`);
    // Phones: the chips run the whole width, so the side buttons also start below them.
    const chips = $('#chips');
    const phone = matchMedia('(max-width: 700px)').matches && !chips.hidden;
    root.setProperty('--side-top', `${Math.ceil(Math.max(above.getBoundingClientRect().bottom, phone ? chips.getBoundingClientRect().bottom : 0) + 8)}px`);
    // Bubbles that open move the map so they are not hidden under the boxes at the top (and the side buttons).
    const top = Math.max(...[dims, clock, box, $('#chips')].map((e) => {
      const r = e.getBoundingClientRect();
      return e.hidden || r.top > innerHeight / 3 ? 0 : r.bottom;  // only what sits at the top (the PC readout is at the bottom)
    }));
    const side = $('#sidebuttons').getBoundingClientRect();
    noTapAbove = Math.max(...[$('#topbar .search'), dims, $('#chips')].map((e) => (e.hidden ? 0 : e.getBoundingClientRect().bottom)));
    L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(10, Math.ceil(top + 8));
    L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(side.top < top + 120 ? Math.ceil(innerWidth - side.left + 8) : 10, 80);
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(keepWidth); [dims, $('#clock'), box, $('#chips')].forEach((e) => ro.observe(e)); }
  window.addEventListener('resize', keepWidth);
  keepWidth();
  let saved = null;
  try { saved = localStorage.getItem('mcmap.coords'); } catch { /* private mode */ }
  if (saved === 'closed') show(false);
  if (saved === 'only') fold(true);
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
  renderPortals();
  stopRoute();
  refreshExplore();
  state.slimeLayer?.redraw();
  renderFinds();
  renderThings();
  showOtherDim(block(map.getCenter()).x, block(map.getCenter()).z);
}

function goTo(x, z, dim, zoom) {
  if (dim) setDim(dim);
  map.setView(ll(x + 0.5, z + 0.5), Math.max(map.getZoom(), zoom ?? 0));
}

function updatePastBanner() {
  const snaps = snapshots();
  const past = !state.demo && state.snapshotIndex < snaps.length - 1;
  $('#past-banner').hidden = !past;
  if (past) $('#past-text').textContent = `📅 ${snapText(snaps[state.snapshotIndex])}の地図を表示中`;
}

let setSnapshotIndex = () => {};
const isDateId = (id) => /^\d{4}-\d{2}-\d{2}$/.test(id);

function labelTimeline() {
  const s = snapshots()[state.snapshotIndex];
  $('#time-label').textContent = s ? snapText(s) : 'なし';
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
  // Everything under a panel's title goes in a body that scrolls, so the title stays put on the same background.
  document.querySelectorAll('.panel').forEach((panel) => {
    const body = document.createElement('div');
    body.className = 'panel-body';
    for (const el of [...panel.children]) if (el.tagName !== 'H2') body.append(el);
    panel.append(body);
  });
  $('#past-back').addEventListener('click', () => setSnapshotIndex(snapshots().length - 1));
  const panels = { 'btn-players': 'panel-players', 'btn-explore': 'panel-explore', 'btn-nether': 'panel-nether', 'btn-time': 'panel-time', 'btn-realm': 'panel-realm', 'btn-site': 'panel-site' };
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

  // 表示: one button for the overlays that are only switched on and off; it stays lit while any of them is on.
  const layerMenu = $('#layer-menu'), layersBtn = $('#btn-layers');
  const syncLayers = () => layersBtn.classList.toggle('on', !!layerMenu.querySelector('button.on'));
  const showLayerMenu = (open) => {
    layerMenu.hidden = !open;
    layersBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = layersBtn.getBoundingClientRect();
    layerMenu.style.top = `${Math.max(8, Math.min(r.top - 5, innerHeight - layerMenu.offsetHeight - 8))}px`;
    layerMenu.style.right = `${innerWidth - r.left + 8}px`;
  };
  layersBtn.addEventListener('click', (e) => { e.stopPropagation(); showLayerMenu(layerMenu.hidden); });
  layerMenu.addEventListener('click', (e) => { e.stopPropagation(); setTimeout(syncLayers); });
  document.addEventListener('click', () => showLayerMenu(false));
  map.on('movestart', () => showLayerMenu(false));
  syncLayers();

  $('#btn-contour').addEventListener('click', () => {
    const on = !$('#btn-contour').classList.contains('on');
    $('#btn-contour').classList.toggle('on', on);
    refreshContours();
    // The menu shows what is on; a message only when nothing would show yet.
    if (on && map.getZoom() < -2) toast('等高線はもう少し拡大すると表示されます');
  });

  $('#btn-slime').addEventListener('click', () => {
    if (state.slimeLayer) { map.removeLayer(state.slimeLayer); state.slimeLayer = null; }
    else state.slimeLayer = new SlimeLayer({ minZoom: -6, maxZoom: MAX_ZOOM, pmIgnore: true, zIndex: 4, updateWhenZooming: false }).addTo(map);
    $('#btn-slime').classList.toggle('on', !!state.slimeLayer);
    if (!state.slimeLayer) return;
    if (state.dim !== 'overworld') toast('スライムチャンクは地上だけで表示されます');
    else if (map.getZoom() < SLIME_MIN_ZOOM) toast('スライムチャンクはもう少し拡大すると表示されます');
  });

  $('#btn-grid').addEventListener('click', () => {
    if (state.gridLayer) { map.removeLayer(state.gridLayer); state.gridLayer = null; }
    else state.gridLayer = new ChunkGrid({ minZoom: -6, maxZoom: MAX_ZOOM, pmIgnore: true, zIndex: 5, updateWhenZooming: false }).addTo(map);
    $('#btn-grid').classList.toggle('on', !!state.gridLayer);
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

}

// ---------- search ----------
let searchText = () => {};  // puts a name in the search box (set up below)
function setupSearch() {
  const input = $('#search'), list = $('#search-results');
  let items = [], active = 0, picked = '';
  const hide = () => { list.hidden = true; };
  // Searching ends only by picking, jumping, Escape, or touching somewhere else, not when the keyboard is put away.
  const close = () => {
    hide();
    document.body.classList.remove('searching');
    if (document.activeElement?.closest?.('.search, #find')) document.activeElement.blur();
  };
  let picking = false;
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    input.value = picked = it.title;  // the picked name stays in the box (the × clears it with the highlight)
    picking = true;  // the bubble this opens keeps the searched name
    try {
      it.go();
      if (it.kind !== 'find') focusPlace(it);
    } finally { picking = false; }
  };
  const render = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      if (i === active) li.className = 'active';
      li.innerHTML = `<span class="s-icon">${it.icon}</span><div class="grow"><div class="s-title"></div><div class="meta"></div></div>`;
      li.querySelector('.s-title').textContent = it.title;
      li.querySelector('.meta').textContent = it.meta;
      // Pick on a tap (click), not on touch-down, so a finger can scroll the list; mousedown keeps the box focused.
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(i));
      list.append(li);
    });
    list.hidden = items.length === 0;
  };
  // Everything that can be found: pins, text and shapes, players, beds, last deaths and nether gates (all dimensions).
  const where = whereText;
  const all = () => {
    const out = [];
    for (const b of findIndex.beings) out.push({ ...b, kind: 'find', go: () => showFinds(b.type, b.key) });
    for (const a of state.annotations) {
      const c = annCenter(a);
      const shape = { line: '線', draw: '手書き', polygon: '多角形', rect: '四角', circle: '円' }[a.type];
      out.push({
        kind: 'pin', dim: a.dim, x: c.x, z: c.z,
        title: a.name || a.text || shape || 'ピン',
        hay: `${a.name || ''} ${a.text || ''} ${a.note || ''}`,
        icon: a.type === 'waypoint' ? flagSvg(a.color) : `<span class="dot" style="background:${esc(a.color)}"></span>`,
        meta: `${{ waypoint: 'ピン', text: '文字' }[a.type] || '図形'}  ${where(a.dim, c.x, c.z)}`,
        go: () => { goTo(c.x, c.z, a.dim, 0); openAnnPopup(a.id); },
      });
    }
    for (const p of state.players) {
      const color = playerColor(p.key);
      out.push({ kind: 'player', dim: p.dim, x: p.x, z: p.z, title: p.name, hay: p.name,
        icon: playerSvg(color), meta: `プレイヤー  ${where(p.dim, p.x, p.z)}`, go: () => goTo(p.x, p.z, p.dim, 0) });
      if (p.bed) out.push({ kind: 'bed', dim: p.bed.dim, x: p.bed.x, z: p.bed.z, title: `${p.name}・ベッド`, hay: `${p.name} ベッド`,
        icon: BED_SVG(color), meta: `ベッド  ${where(p.bed.dim, p.bed.x, p.bed.z)}`, go: () => goTo(p.bed.x, p.bed.z, p.bed.dim, 0) });
      if (p.death) out.push({ kind: 'death', dim: p.death.dim, x: p.death.x, z: p.death.z, title: `${p.name}・最終死亡地点`, hay: `${p.name} 死亡 最終死亡地点`,
        icon: DEATH_SVG, meta: `死亡地点  ${where(p.death.dim, p.death.x, p.death.z)}`, go: () => goTo(p.death.x, p.death.z, p.death.dim, 0) });
    }
    for (const dim of ['overworld', 'nether']) {
      for (const g of shownGates(dim)) {
        out.push({ kind: 'gate', dim, x: g.x, z: g.z, title: g.name || 'ネザーゲート', hay: `${g.name || ''} ネザーゲート ゲート`,
          icon: PORTAL_SVG, meta: `ネザーゲート  ${where(dim, g.x, g.z)}`, go: () => goTo(g.x, g.z, dim, 1) });
      }
    }
    return out;
  };
  // With nothing typed: what is shown on the map right now, nearest to the crosshair first.
  const shownNow = (it) => it.dim === state.dim && (
    (it.kind === 'death' && $('#show-deaths').checked) || (it.kind === 'bed' && $('#show-beds').checked)
    || (it.kind === 'gate' && $('#show-portals').checked) || it.kind === 'pin' || it.kind === 'player');
  const suggest = () => {
    const q = input.value.trim().toLowerCase();
    const c = block(map.getCenter());
    const near = (it) => (it.dim === state.dim ? 0 : 1e12) + Math.hypot(it.x - c.x, it.z - c.z);
    items = (q ? all().filter((it) => `${it.title} ${it.hay}`.toLowerCase().includes(q)) : all().filter(shownNow))
      .sort((p, r) => near(p) - near(r)).slice(0, 200);
    if (q) {
      // A whole kind first ("農民 すべて"), then each one with its place, then stored and sold items.
      const kinds = findIndex.groups.filter((g) => `${g.label} ${g.hay}`.toLowerCase().includes(q)).map((g) => ({
        kind: 'find', title: `${g.label} すべて`, icon: g.icon, meta: `${g.villagers.size + g.pets.size}${g.unit}・地図にまとめて表示`,
        go: () => showFinds('group', g.key) }));
      items = kinds.concat(items, findSuggestions(q));
    }
    active = 0;
    render();
  };
  input.addEventListener('input', suggest);
  // The × in the box: empties it, closes the suggestions and takes away any marking on the map.
  const clear = $('#search-clear');
  const showClear = () => { clear.hidden = !input.value && !finds; };
  searchText = (text) => {
    if (picking) return;
    input.value = picked = text;
    showClear();
  };
  input.addEventListener('input', showClear);
  clear.addEventListener('mousedown', (e) => e.preventDefault());
  clear.addEventListener('click', () => {
    input.value = '';
    hide();
    clearFinds();
    showClear();
  });
  // When the highlight goes (a tap elsewhere on the map), the name that was picked goes with it.
  document.addEventListener('finds-changed', () => {
    if (!finds && input.value === picked && document.activeElement !== input) input.value = '';
    showClear();
  });
  input.addEventListener('focus', suggest);
  // Phones: while the search is in use, the X/Z search opens right under it.
  const bar = $('#topbar');
  bar.addEventListener('focusin', (e) => { if (e.target.closest('.search, #find')) document.body.classList.add('searching'); });
  // Tabbing away with a keyboard (focus moves to something else) also ends it.
  bar.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !e.relatedTarget.closest('.search, #find')) close();
  });
  // Outside touches: while typing, the first only puts the keyboard away (search stays open); the next one closes it.
  // Those touches only close things; the map underneath does not also react (no coordinate bubble).
  let swallow = false;
  document.addEventListener('pointerdown', (e) => {
    swallow = false;
    if (e.target.closest?.('.search, #find')) return;
    const open = document.body.classList.contains('searching') || !list.hidden;
    // Touch: the first touch only puts the on-screen keyboard away. Mouse: one click closes right away.
    if (e.pointerType === 'touch' && document.activeElement?.closest?.('.search, #find')) { document.activeElement.blur(); swallow = true; return; }
    if (open) { close(); swallow = true; }
  }, true);
  document.addEventListener('click', (e) => {
    if (!swallow) return;
    swallow = false;
    if (!e.target.closest?.('.search, #find')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });

  // Coordinates: type X and Z, then jump there.
  const cx = $('#find-x'), cz = $('#find-z'), go = $('#find-go');
  const ready = () => cx.value.trim() !== '' && cz.value.trim() !== '' && Number.isFinite(Number(cx.value)) && Number.isFinite(Number(cz.value));
  const update = () => { go.disabled = !ready(); };
  const jump = () => {
    if (!ready()) return;
    const x = Math.floor(Number(cx.value)), z = Math.floor(Number(cz.value));
    close();
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

// ---------- what is stored where (chests and other containers) and who sells what (villagers) ----------
// items.json comes from the map maker; picking a search result marks every place it was found.
const findGroup = L.layerGroup();
let finds = null;          // what is marked now: { label, matches: [{ dim, x, y, z, popup }] }
let findIndex = { items: [], trades: [], signs: [], beings: [], groups: [] };
const whereText = (dim, x, z) => `${DIMS[dim].name}  X ${x}  Z ${z}`;
// Pixel-art mark: each string is a row, each letter a colour from the palette ('.' = empty). Drawn above a shadow.
// One drawing pixel is a whole number of screen pixels (near `size` page pixels), so every mark looks the same
// wherever it sits.
// `edge` adds an extra dark outline around the whole picture (about that many page pixels, whole screen pixels).
// For search hits, `grow` makes each drawing pixel that many screen pixels larger.
const SCREEN = window.devicePixelRatio || 1;
function pixSvg(rows, pal, size, edge = 0, { grow = 0 } = {}) {
  const w = rows[0].length, h = rows.length;
  const dots = Math.max(1, Math.round(size * SCREEN)) + grow;  // screen pixels per drawing pixel
  const unit = dots / SCREEN;                                  // page pixels per drawing pixel
  const e = edge ? Math.max(1, Math.round(edge * SCREEN)) / dots : 0;  // outline, in drawing pixels
  const top = e;                                               // room above the picture
  let r = e ? `<rect x="${-e / 2}" y="${-e / 2}" width="${w + e}" height="${h + e}" fill="none" stroke="${pal.K}" stroke-width="${e}"/>` : '';
  // One exact-size rectangle per run of the same colour in a row: edges then land on the screen's pixels the same way
  // everywhere (slightly oversized squares used to grow by a screen pixel at some positions).
  const draw = (lines, colours, dx, dy) => {
    let out = '';
    lines.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        let end = x + 1;
        while (end < row.length && row[end] === row[x]) end += 1;
        if (colours[row[x]]) out += `<rect x="${dx + x}" y="${dy + y}" width="${end - x}" height="1" fill="${colours[row[x]]}"/>`;
        x = end;
      }
    });
    return out;
  };
  r += draw(rows, pal, 0, 0);
  return `<svg class="gm-svg" viewBox="${-e} ${-top} ${w + 2 * e} ${h + 2 + e + top}" width="${(w + 2 * e) * unit}" height="${(h + 2 + e + top) * unit}" shape-rendering="crispEdges">`
    + `<ellipse class="gm-shadow" cx="${w / 2}" cy="${h + 1 + e}" rx="${w / 2 - 1.5}" ry="0.9"/><g class="gm-body">${r}</g></svg>`;
}
// A villager's face over a brown robe, after the game's villager.
const VILLAGER_ART = [[
  '..KKKKKKKK..',
  '..KssssssK..',
  '..KssssssK..',
  '..KbbbbbbK..',
  '..KwgnngwK..',
  '..KssnnssK..',
  '..KssnnssK..',
  'KKKKKnnKKKKK',
  'KrrrrKKrrrrK',
  'KrRRRRRRRRrK',
  'KrRRRRRRRRrK',
  'KKKKKKKKKKKK'], { K: '#1f150f', s: '#bd8b72', b: '#4a2d1f', w: '#f4f1ea', g: '#2f8f3a', n: '#a26f55', r: '#6b4428', R: '#7d5131' }];
const VILLAGER_SVG = pixSvg(...VILLAGER_ART, 1.6);
const VILLAGER_BIG = pixSvg(...VILLAGER_ART, 1.6, 0, { grow: 1 });  // search hits
// Each job's clothes on the villager above, after the game's: hats, aprons, an eye patch, the armorer's goggles.
const JOB_ART = {
  farmer: [['..KKKKKKKK..', '..KYyYYyYK..', '..KUUUUUUK..', 'KYYyYYYYyYYK', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { Y: '#e3be55', y: '#c9a23d', U: '#5a3a22' }],
  fisherman: [['..KKKKKKKK..', '..KTTTTTTK..', '.KQQQQQQQQK.', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KQQQQKKQQQQK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { T: '#c9a66b', Q: '#3e8c8c' }],
  shepherd: [['..KKKKKKKK..', '..KHHHHHHK..', '.KWWWWWWWWK.', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KWWWWKKWWWWK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { H: '#6b4428', W: '#ece8df' }],
  fletcher: [['..KKKKKKKKF.', '..KGGGGGGKF.', '..KGGGGGGK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KGGGGKKGGGGK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { G: '#4f7a3a', F: '#f4f1ea' }],
  librarian: [['..KKKKKKKK..', '..KLLLLLLK..', '..KPPPPPPK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KLLLLKKLLLLK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { L: '#8c2a2a', P: '#efe6cf' }],
  cartographer: [['..KKKKKKKK..', '..KHHHHHHK..', '..KssssssK..', '..KbbbbYYK..', '..KwgnngYK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRRRYYRRRrK', 'KrRRRYYRRRrK', 'KKKKKKKKKKKK'], { H: '#5a3a22', Y: '#d9b24c' }],
  cleric: [['..KKKKKKKK..', '..KssssssK..', '..KssssssK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRRRYYRRRrK', 'KrRRRYYRRRrK', 'KKKKKKKKKKKK'], { r: '#5b2a6b', R: '#7a3a8c', Y: '#d9b24c' }],
  armorer: [['..KKKKKKKK..', '.KGGGGGGGGK.', '.KGLLGGLLGK.', '.KGGGGGGGGK.', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrAAKKAArrK', 'KrRAAAAAARrK', 'KrRAAAAAARrK', 'KKKKKKKKKKKK'], { G: '#8f8f8f', L: '#4a3226', A: '#4a2e1c' }],
  weaponsmith: [['..KKKKKKKK..', '..KssssssK..', '..KssssssK..', '..KbbbbKbK..', '..KwgnnKKK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRAAAAAARrK', 'KrRAAAAAARrK', 'KKKKKKKKKKKK'], { A: '#2b2b2b' }],
  toolsmith: [['..KKKKKKKK..', '..KssssssK..', '..KssssssK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRAAAAAARrK', 'KrRAAAAAARrK', 'KKKKKKKKKKKK'], { A: '#3c4048' }],
  butcher: [['..KKKKKKKK..', '..KssssssK..', '..KDDDDDDK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRWWWWWWRrK', 'KrRWWDWWWRrK', 'KKKKKKKKKKKK'], { D: '#b3261e', W: '#ece8df' }],
  leatherworker: [['..KKKKKKKK..', '..KssssssK..', '..KssssssK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRAAAAAARrK', 'KrRAAAAAARrK', 'KKKKKKKKKKKK'], { A: '#a0632f' }],
  mason: [['..KKKKKKKK..', '..KCCCCCCK..', '..KssssssK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRAAAAAARrK', 'KrRAAAAAARrK', 'KKKKKKKKKKKK'], { A: '#8c8c8c', C: '#8c8c8c' }],
  nitwit: [['..KKKKKKKK..', '..KssssssK..', '..KssssssK..', '..KbbbbbbK..', '..KwgnngwK..', '..KssnnssK..', '..KssnnssK..', 'KKKKKnnKKKKK', 'KrrrrKKrrrrK', 'KrRRRRRRRRrK', 'KrRRRRRRRRrK', 'KKKKKKKKKKKK'], { r: '#3f6b30', R: '#4f8a3c' }],
};
const jobIcons = {};
function villagerIcon(job, big = false) {
  const key = `${JOB_ART[job] ? job : ''}:${big}`;
  if (!jobIcons[key]) {
    const [rows, pal] = JOB_ART[job] ? [JOB_ART[job][0], { ...VILLAGER_ART[1], ...JOB_ART[job][1] }] : VILLAGER_ART;
    jobIcons[key] = pixSvg(rows, pal, 1.6, 0, { grow: big ? 1 : 0 });
  }
  return jobIcons[key];
}
// The wandering trader: the villager's shape, dressed after the game's trader — dark blue hood with a red-brown rim,
// a red-brown band round the lower face, and a blue robe with gold trim down the front.
const TRADER_ART = [[
  '..KKKKKKKK..',
  '..KhhhhhhK..',
  '..KccccccK..',
  '..KbbbbbbK..',
  '..KwgnngwK..',
  '..KssnnssK..',
  '..KccnnccK..',
  'KKKKKnnKKKKK',
  'KTTTTKKTTTTK',
  'KTSSSIISSSTK',
  'KTSSSIISSSTK',
  'KKKKKKKKKKKK'], { K: '#141a2b', h: '#2b4170', c: '#7a1a0c', b: '#3a2a18', w: '#f4f1ea', g: '#2f8f3a', n: '#a26f55', s: '#bd8b72',
  T: '#2c456c', S: '#3d5a8c', I: '#c98a2a' }];
const TRADER_SVG = pixSvg(...TRADER_ART, 1.6);
const TRADER_BIG = pixSvg(...TRADER_ART, 1.6, 0, { grow: 1 });  // search hits
// A chest seen from the front, after the game's chest kept flat: frame, wood, the dark band where the lid
// closes and the silver latch over it.
const CHEST_ART = [[
  'AAAAAAAAAAAAAAAA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDNNDDDDDDA',
  'BBBBBBBNNBBBBBBB',
  'ADDDDDDNNDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'ADDDDDDDDDDDDDDA',
  'AAAAAAAAAAAAAAAA'], { K: '#16130f', A: '#56493b', B: '#56493b', D: '#c6924a', N: '#e2e2e2' }];
const CHEST_SVG = pixSvg(...CHEST_ART, 1.15, 0.8);
const CHEST_BIG = pixSvg(...CHEST_ART, 1.15, 0.8, { grow: 1 });  // search hits
// A wooden sign on its post: a plank board with lines of writing.
const SIGN_ART = [[
  'KKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWK',
  'KWllllllllllWK',
  'KWWWWWWWWWWWWK',
  'KWlllllllWWWWK',
  'KWWWWWWWWWWWWK',
  'KWllllllllWWWK',
  'KWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKK',
  '.....KPPK.....',
  '.....KPPK.....',
  '.....KPPK.....',
  '.....KKKK.....'], { K: '#2b1d10', W: '#c49a5c', l: '#4a3220', P: '#7a5430' }];
const SIGN_SVG = pixSvg(...SIGN_ART, 1.3);
const SIGN_BIG = pixSvg(...SIGN_ART, 1.3, 0, { grow: 1 });  // search hits
const signTitle = (text) => text.split('\n').join(' ');
// Pets and named animals: the animal's head as the game draws it (traced from the game's head models and textures,
// a little brighter; horses, cats and llamas in their own coat, 'kind:variant'), over a collar in the owner's colour (brown leather when nobody owns it); a little name tag
// hangs from the collar when the animal has a name.
// The faces themselves are made from the game's own models and textures each time the map is built
// (tools/pet_faces.py) and come in items.json; this plain face is for when they are not there.
const PLAIN_FACE = [['a....a', 'aa..aa', 'aaaaaa', 'abaaba', 'aaaaaa', 'aaddaa'], { a: '#c9c2b8', b: '#2b2622', d: '#8a7f74' }];
const LEATHER = '#6b4a2a';
function animalSvg(kind, collar, named, big = false, size = 1.6, variant = null) {
  const faces = state.items?.faces || {};
  const [face, pal] = faces[`${kind}:${variant}`] || faces[kind] || PLAIN_FACE;
  const w = face[0].length + 2;
  const grid = [Array(w).fill('.'), ...face.map((r) => ['.', ...r, '.'])];
  // The collar: two rows as wide as the bottom of the head.
  const last = grid[grid.length - 1];
  const from = last.findIndex((ch) => ch !== '.'), to = last.length - 1 - [...last].reverse().findIndex((ch) => ch !== '.');
  for (let i = 0; i < 2; i++) grid.push(last.map((_, x) => (x >= from && x <= to ? 'c' : '.')));
  if (named) {
    const mid = Math.floor((from + to) / 2);
    for (let i = 0; i < 2; i++) grid.push(grid[0].map((_, x) => (x === mid || x === mid + 1 ? 't' : '.')));
  }
  grid.push(Array(w).fill('.'));
  // Heads differ in size (a cat's is small, a cow's wide): scale them to about the same size on the map.
  const scale = Math.min(2.2, 14 / w, 17 / grid.length);
  const dots = Math.max(1, Math.round(size * scale * SCREEN)) + (big ? 1 : 0);  // screen pixels per drawing pixel
  // A dark outline round the whole shape, so it stands out on any ground. It is the same thickness on screen for
  // every animal (as thin as on the widest heads), not one drawing pixel, which would be thicker on the small heads.
  const e = Math.max(1, Math.round(size * SCREEN)) / dots;
  const colours = { ...pal, c: collar, t: '#f2e2b0' };
  let edge = '', body = '';
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (row[x] === '.') { x += 1; continue; }
      let end = x + 1;
      while (end < row.length && row[end] !== '.') end += 1;
      edge += `<rect x="${x - e}" y="${y - e}" width="${end - x + 2 * e}" height="${1 + 2 * e}"/>`;
      for (let i = x; i < end;) {
        let j = i + 1;
        while (j < end && row[j] === row[i]) j += 1;
        body += `<rect x="${i}" y="${y}" width="${j - i}" height="1" fill="${colours[row[i]]}"/>`;
        i = j;
      }
      x = end;
    }
  });
  const unit = dots / SCREEN, h = grid.length;
  return `<svg class="gm-svg" viewBox="0 0 ${w} ${h + 1}" width="${w * unit}" height="${(h + 1) * unit}" shape-rendering="crispEdges">`
    + `<ellipse class="gm-shadow" cx="${w / 2}" cy="${h - 0.2}" rx="${w / 2 - 1.5}" ry="0.9"/>`
    + `<g class="gm-body"><g fill="#231c17">${edge}</g>${body}</g></svg>`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
function itemName(id) {
  return state.items?.names?.[id] || BLOCK_JA(id) || id;
}
function enchText(ench) {
  return (ench || []).map(([i, l]) => `${state.items?.ench?.[i] || `エンチャント${i}`}${ROMAN[l] || l}`).join('・');
}
function itemLabel(it) {
  return it[2]?.length ? `${itemName(it[0])}(${enchText(it[2])})` : itemName(it[0]);
}
const itemKey = (it) => `${it[0]}|${(it[2] || []).map((e) => e.join(':')).sort().join(',')}`;
function mobName(kind) {
  return state.items?.mobs?.[kind] || kind;
}
function jobName(job) {
  return (job && state.items?.jobs?.[job]) || '村人';
}

async function loadItems() {
  // On Cloudflare it comes through the worker, without what the owner hides from members.
  state.items = await fetchJson(DATA ? `${location.origin}/api/world` : `items.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  const hidden = new Set(state.items?.hidden || []);
  if (hidden.has('chests')) thingsOn.chests = false;
  document.querySelector('#chips [data-layer="chests"]').hidden = hidden.has('chests');
  $('#chip-pet').innerHTML = animalSvg('wolf', LEATHER, false);
  buildFindIndex();
  if (finds) showFinds(finds.type, finds.key, false);
  renderThings();
}

// One search entry per kind of item stored, per kind of item sold, and per villager job.
function buildFindIndex() {
  const items = new Map(), trades = new Map(), signs = new Map(), beings = [], groups = new Map();
  // "All farmers", "all cats", "all of 〇〇's pets"...: one entry that marks every one of a kind at once.
  const group = (key, label, hay, icon, unit, type, place) => {
    if (!groups.has(key)) groups.set(key, { key, label, hay, icon, unit, villagers: new Set(), pets: new Set() });
    groups.get(key)[type].add(place);
  };
  for (const [dim, d] of Object.entries(state.items?.dims || {})) {
    for (const c of d.containers || []) {
      for (const it of c[4]) {
        const k = itemKey(it);
        if (!items.has(k)) items.set(k, { key: k, label: itemLabel(it), hay: `${itemLabel(it)} ${it[0]}`, places: new Set(), total: 0 });
        const e = items.get(k);
        e.places.add(`${dim}:${c[0]}:${c[1]}:${c[2]}`);
        e.total += it[1];
      }
    }
    // Each villager, wandering trader and pet is its own search hit, shown with its place like a pin.
    for (const v of d.villagers || []) {
      const job = jobName(v[3]), trader = v[3] === 'wandering_trader';
      const title = v[4] ? `${v[4]}(${job})` : job;
      const place = `${dim}:${v[0]}:${v[1]}:${v[2]}`;
      if (trader) group('trader', '行商人', '行商人', TRADER_SVG, '人', 'villagers', place);
      else {
        group('villager', '村人', '村人', VILLAGER_SVG, '人', 'villagers', place);
        // Without a job the name is just 村人, which the whole-village entry already uses.
        const label = job === '村人' ? '職業なしの村人' : job;
        group(`job:${v[3]}`, label, label, villagerIcon(v[3]), '人', 'villagers', place);
      }
      beings.push({ type: 'villager', key: `${dim}:${v[0]}:${v[1]}:${v[2]}`, dim, x: v[0], z: v[2], title,
        hay: `${v[4] ? v[4].normalize('NFKC') : ''} ${job} ${trader ? '行商人' : '村人'}`, icon: trader ? TRADER_SVG : villagerIcon(v[3]),
        meta: `${trader ? '行商人' : '村人'}  ${whereText(dim, v[0], v[2])}` });
      // What villagers sell is found by the item's name only, so "村人" does not list every item on sale.
      for (const [, sell] of v[5]) {
        const k = itemKey(sell);
        if (!trades.has(k)) trades.set(k, { key: k, label: itemLabel(sell), hay: `${itemLabel(sell)} ${sell[0]}`, villagers: new Set() });
        trades.get(k).villagers.add(`${dim}:${v[0]}:${v[1]}:${v[2]}`);
      }
    }
    // Signs with the same words (signposts along a road) are one entry.
    for (const g of d.signs || []) {
      const k = signTitle(g[3]);
      // Full-width letters (ＦＲＥＥ) are also found by typing them half-width (free).
      if (!signs.has(k)) signs.set(k, { key: k, label: k, hay: `${k} ${k.normalize('NFKC')} 看板`, count: 0 });
      signs.get(k).count += 1;
    }
    // Pets and named animals: found by name, kind ("オオカミ") or owner ("〇〇").
    for (const a of d.animals || []) {
      const kind = mobName(a[3]);
      const owner = a[6] && state.players.some((p) => p.key === a[6]) ? playerName(a[6]) : '';
      const place = `${dim}:${a[0]}:${a[1]}:${a[2]}`, face = animalSvg(a[3], animalCollar(a), false, false, 1.6, a[7]);
      group('pet', 'ペット', 'ペット', $('#chip-pet')?.innerHTML || face, '匹', 'pets', place);
      group(`kind:${a[3]}`, kind, `${kind} ${a[3]}`, face, '匹', 'pets', place);
      if (owner) group(`owner:${a[6]}`, `${owner}のペット`, `${owner}`, face, '匹', 'pets', place);
      beings.push({ type: 'pet', key: `${dim}:${a[0]}:${a[1]}:${a[2]}`, dim, x: a[0], z: a[2], title: a[4] || kind,
        hay: `${a[4] ? `${a[4].normalize('NFKC')} 名札` : ''} ${kind} ${a[3]} ペット ${owner}`,
        icon: animalSvg(a[3], animalCollar(a), !!a[4], false, 1.6, a[7]),
        meta: `${a[4] ? kind : 'ペット'}${owner ? `(${owner})` : ''}  ${whereText(dim, a[0], a[2])}` });
    }
  }
  findIndex = { items: [...items.values()], trades: [...trades.values()], signs: [...signs.values()], beings,
    groups: [...groups.values()].filter((g) => g.villagers.size + g.pets.size >= 2) };
}

// Search suggestions for a typed word (sign writing, stored items, things villagers sell).
function findSuggestions(q) {
  const out = [];
  const hit = (e) => e.hay.toLowerCase().includes(q);
  for (const e of findIndex.signs.filter(hit)) {
    out.push({ kind: 'find', title: e.label, hay: e.hay, icon: SIGN_SVG, meta: `看板・${e.count}枚`, go: () => showFinds('sign', e.key) });
  }
  for (const e of findIndex.trades.filter(hit)) {
    out.push({ kind: 'find', title: e.label, hay: e.hay, icon: VILLAGER_SVG, meta: `${e.villagers.size}人`, go: () => showFinds('trade', e.key) });
  }
  for (const e of findIndex.items.filter(hit)) {
    out.push({ kind: 'find', title: e.label, hay: e.hay, icon: CHEST_SVG, meta: `${e.places.size}件・全${e.total}個`, go: () => showFinds('item', e.key) });
  }
  return out.slice(0, 60);
}

function invHtml(items, matchKey) {
  const sum = new Map();
  for (const it of items) {
    const k = itemKey(it);
    if (!sum.has(k)) sum.set(k, { it, n: 0 });
    sum.get(k).n += it[1];
  }
  const rows = [...sum.entries()].sort((a, b) => (b[0] === matchKey) - (a[0] === matchKey) || b[1].n - a[1].n);
  return `<ul class="inv">${rows.map(([k, { it, n }]) => `<li${k === matchKey ? ' class="hit"' : ''}><span>${esc(itemLabel(it))}</span><b>${n}</b></li>`).join('')}</ul>`;
}
function tradesHtml(trades, matchKey) {
  if (!trades.length) return '<div class="sub">取引の情報がありません</div>';
  const price = (buy) => buy.map((b) => `${esc(itemLabel(b))}×${b[1]}`).join(' + ');
  return `<ul class="inv trades">${trades.map(([buy, sell]) => `<li${itemKey(sell) === matchKey ? ' class="hit"' : ''}>`
    + `<span>${esc(itemLabel(sell))}${sell[1] > 1 ? `×${sell[1]}` : ''}</span><b>${price(buy)}</b></li>`).join('')}</ul>`;
}

// A container or villager as a map mark: where it is, its icon, and what its bubble says.
function containerMark(dim, c, key) {
  const kind = itemName(c[3]);
  return { dim, x: c[0], y: c[1], z: c[2], icon: CHEST_SVG, iconBig: CHEST_BIG, name: kind,
    popup: `<h4>${esc(kind)}</h4><div class="xyz">X ${c[0]} / Y ${c[1]} / Z ${c[2]}</div>${c[4].length ? invHtml(c[4], key) : '<div class="sub">空っぽ</div>'}` };
}
function villagerMark(dim, v, key) {
  const name = v[4] ? `${v[4]}(${jobName(v[3])})` : jobName(v[3]);
  const trader = v[3] === 'wandering_trader';
  return { dim, x: v[0], y: v[1], z: v[2], icon: trader ? TRADER_SVG : villagerIcon(v[3]), iconBig: trader ? TRADER_BIG : villagerIcon(v[3], true), name,
    popup: `<h4>${esc(name)}</h4><div class="xyz">X ${v[0]} / Y ${v[1]} / Z ${v[2]}</div>${tradesHtml(v[5], key)}` };
}
function signMark(dim, g) {
  const lines = g[3].split('\n');
  return { dim, x: g[0], y: g[1], z: g[2], icon: SIGN_SVG, iconBig: SIGN_BIG, name: signTitle(g[3]),
    popup: `<h4>${g[4] ? '吊り看板' : '看板'}</h4><div class="xyz">X ${g[0]} / Y ${g[1]} / Z ${g[2]}</div>`
      + `<div class="sign-text">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>` };
}
// The owner's colour for a tamed animal (grey when the owner is not known yet), brown leather otherwise.
const animalCollar = (a) => (a[5] ? playerColor(a[6]) : LEATHER);
function animalMark(dim, a) {
  const kind = mobName(a[3]);
  const name = a[4] ? `${a[4]}(${kind})` : kind;
  const collar = animalCollar(a);
  const known = a[6] && state.players.some((p) => p.key === a[6]);
  const owner = a[5] ? `<div class="sub">飼い主: ${known ? esc(playerName(a[6])) : 'わからない'}</div>` : '';
  return { dim, x: a[0], y: a[1], z: a[2], icon: animalSvg(a[3], collar, !!a[4], false, 1.6, a[7]), iconBig: animalSvg(a[3], collar, !!a[4], true, 1.6, a[7]), name: a[4] || kind,
    popup: `<h4>${esc(name)}</h4><div class="xyz">X ${a[0]} / Y ${a[1]} / Z ${a[2]}</div>${owner}` };
}

// Search hits (hit = true) are drawn larger and get a circle under them. Marks in the same block share one mark; its bubble first lists the candidates so each one can be picked.
function markLayer(marks, group, zIndexOffset, hit = false) {
  const at = new Map();
  for (const m of marks) {
    const k = `${m.x},${m.z}`;
    if (!at.has(k)) at.set(k, []);
    at.get(k).push(m);
  }
  for (const list of at.values()) {
    const first = list[0];
    const marker = L.marker(ll(first.x + 0.5, first.z + 0.5), {
      pmIgnore: true, zIndexOffset,
      icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0],
        html: `<div class="find-icon gm${hit ? ' hit' : ''}">${hit ? '<span class="hit-ring"></span>' : ''}${hit ? first.iconBig || first.icon : first.icon}</div>` }),
    });
    const el = document.createElement('div'); el.className = 'pop';
    // The bubble's contents are swapped on a click; keep that click from reaching the map (which would close it).
    el.addEventListener('click', (e) => e.stopPropagation());
    const refresh = () => marker.getPopup()?.update();
    const show = (m) => {
      el.innerHTML = m.popup;
      const acts = document.createElement('div'); acts.className = 'acts';
      if (list.length > 1) acts.append(button('一覧に戻る', () => { showList(); refresh(); }));
      acts.append(routeButton({ id: `find:${m.dim}:${m.x}:${m.y}:${m.z}`, name: m.name, x: m.x, z: m.z, dim: m.dim }));
      el.append(acts);
    };
    const showList = () => {
      el.innerHTML = `<h4>複数の候補があります</h4><div class="xyz">X ${first.x} / Z ${first.z}</div>`;
      const ul = document.createElement('ul'); ul.className = 'mark-list';
      for (const m of list) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="s-icon">${m.icon}</span><span class="grow"></span><span class="sub">Y ${m.y}</span>`;
        li.querySelector('.grow').textContent = m.name;
        li.addEventListener('click', () => { show(m); refresh(); if (!hit) searchText(m.name); });
        ul.append(li);
      }
      el.append(ul);
    };
    marker.bindPopup(el);
    marker.on('popupopen', () => { if (list.length > 1) showList(); else show(first); refresh(); });
    // Swapped when the mark is picked; the name goes into the search box on a click (a group waits for its pick).
    marker.mark = { small: first.icon, big: first.iconBig || first.icon, name: list.length > 1 ? '' : first.name };
    marker.addTo(group);
  }
}

// The chips under the search box (PC): show every villager / wandering trader / chest, barrel and shulker box here.
const thingGroup = L.layerGroup();
const STORAGE_KINDS = new Set(['chest', 'large_chest', 'barrel', 'shulker_box']);
const thingsOn = { villagers: false, traders: false, chests: false, signs: false, pets: false };
function renderThings() {
  thingGroup.clearLayers();
  const d = state.items?.dims?.[state.dim] || {};
  const marks = [];
  if (thingsOn.pets) marks.push(...(d.animals || []).map((a) => animalMark(state.dim, a)));
  if (thingsOn.signs) marks.push(...(d.signs || []).map((g) => signMark(state.dim, g)));
  if (thingsOn.chests) marks.push(...(d.containers || []).filter((c) => STORAGE_KINDS.has(c[3])).map((c) => containerMark(state.dim, c, null)));
  if (thingsOn.villagers) marks.push(...(d.villagers || []).filter((v) => v[3] !== 'wandering_trader').map((v) => villagerMark(state.dim, v, null)));
  if (thingsOn.traders) marks.push(...(d.villagers || []).filter((v) => v[3] === 'wandering_trader').map((v) => villagerMark(state.dim, v, null)));
  markLayer(marks, thingGroup, 300);
}
function setupThingChips() {
  thingGroup.addTo(map);
  $('#chip-villager').innerHTML = VILLAGER_SVG;
  $('#chip-chest').innerHTML = CHEST_SVG;
  $('#chip-trader').innerHTML = TRADER_SVG;
  $('#chip-sign').innerHTML = SIGN_SVG;
  $('#chip-pet').innerHTML = animalSvg('wolf', LEATHER, false);
  try { Object.assign(thingsOn, JSON.parse(localStorage.getItem('mcmap.things') || '{}')); } catch { /* defaults */ }
  document.querySelectorAll('#chips button').forEach((b) => {
    const k = b.dataset.layer;
    b.classList.toggle('on', !!thingsOn[k]);
    b.addEventListener('click', () => {
      thingsOn[k] = !thingsOn[k];
      b.classList.toggle('on', thingsOn[k]);
      try { localStorage.setItem('mcmap.things', JSON.stringify(thingsOn)); } catch { /* private mode */ }
      renderThings();
    });
  });
}

// Mark every place where the chosen thing was found, in the dimension that has it (this one if it can).
function showFinds(type, key, move = true) {
  const matches = [];
  for (const [dim, d] of Object.entries(state.items?.dims || {})) {
    if (type === 'item') {
      for (const c of d.containers || []) {
        if (c[4].some((it) => itemKey(it) === key)) matches.push(containerMark(dim, c, key));
      }
    } else if (type === 'pet') {
      for (const a of d.animals || []) if (`${dim}:${a[0]}:${a[1]}:${a[2]}` === key) matches.push(animalMark(dim, a));
    } else if (type === 'villager') {
      for (const v of d.villagers || []) if (`${dim}:${v[0]}:${v[1]}:${v[2]}` === key) matches.push(villagerMark(dim, v, null));
    } else if (type === 'group') {
      const g = findIndex.groups.find((e) => e.key === key);
      for (const v of d.villagers || []) if (g?.villagers.has(`${dim}:${v[0]}:${v[1]}:${v[2]}`)) matches.push(villagerMark(dim, v, null));
      for (const a of d.animals || []) if (g?.pets.has(`${dim}:${a[0]}:${a[1]}:${a[2]}`)) matches.push(animalMark(dim, a));
    } else if (type === 'sign') {
      for (const g of d.signs || []) if (signTitle(g[3]) === key) matches.push(signMark(dim, g));
    } else {
      for (const v of d.villagers || []) if (v[5].some(([, sell]) => itemKey(sell) === key)) matches.push(villagerMark(dim, v, key));
    }
  }
  const entry = type === 'item' ? findIndex.items.find((e) => e.key === key) : type === 'sign' ? findIndex.signs.find((e) => e.key === key)
    : type === 'trade' ? findIndex.trades.find((e) => e.key === key)
    : type === 'group' ? findIndex.groups.find((e) => e.key === key)
    : findIndex.beings.find((e) => e.type === type && e.key === key);
  if (!matches.length) { clearFinds(); if (move) toast('見つかりませんでした'); return; }
  finds = { type, key, label: entry?.label || entry?.title || '', matches };
  if (move) {
    const count = (dim) => matches.filter((m) => m.dim === dim).length;
    const dim = count(state.dim) ? state.dim : Object.keys(DIMS).sort((a, b) => count(b) - count(a))[0];
    if (dim !== state.dim) setDim(dim);
    const here = matches.filter((m) => m.dim === state.dim);
    if (here.length === 1) goTo(here[0].x, here[0].z, null, 1);
    else map.fitBounds(L.latLngBounds(here.map((m) => ll(m.x + 0.5, m.z + 0.5))).pad(0.2), { maxZoom: 1 });
  }
  renderFinds();
  // Open the bubble of the hit nearest the middle of the screen, so the result can be read straight away.
  if (move) nearestMarker((l) => findGroup.hasLayer(l), map.getCenter())?.openPopup();
}

function renderFinds() {
  findGroup.clearLayers();
  document.dispatchEvent(new Event('finds-changed'));
  document.body.classList.toggle('finding', !!finds);
  map.eachLayer(focusMark);
  if (!finds || finds.type === 'place') return;
  markLayer(finds.matches.filter((m) => m.dim === state.dim), findGroup, 2000, true);  // in front of every other mark
}

// A place picked in the search, or any mark that is clicked, keeps its full colour and grows,
// while the rest of the map's marks fade as for other search results.
const FOCUS_SCALE = 1.35;  // keep in step with .leaflet-marker-icon.keep .gm-svg in style.css

function focusPlace(it) {
  finds = { type: 'place', label: it.title, place: { dim: it.dim, x: it.x, z: it.z }, matches: [] };
  renderFinds();
  // The bubble may already be open (the jump opens it), measured before the mark grew; otherwise open the mark's own.
  const open = map._popup, src = open?.isOpen() && (open._source || markerAt(open.getLatLng()));
  if (src instanceof L.Marker) fitPopup(open, src);
  else nearestMarker((l) => l.getElement()?.classList.contains('keep'), ll(it.x + 0.5, it.z + 0.5))?.openPopup();
}

// The marker passing `test` that is closest to `at` (on screen), or null.
function nearestMarker(test, at) {
  const to = map.latLngToContainerPoint(at);
  let best = null, gap = Infinity;
  map.eachLayer((l) => {
    if (!(l instanceof L.Marker) || !l.getPopup() || !test(l)) return;
    const d = map.latLngToContainerPoint(l.getLatLng()).distanceTo(to);
    if (d < gap) { best = l; gap = d; }
  });
  return best;
}

function focusMark(layer) {
  const el = layer instanceof L.Marker ? layer.getElement() : null;
  if (!el) return;
  const p = finds?.type === 'place' ? finds.place : null;
  const at = layer.getLatLng();
  // Only the marks in that very block: a pet or villager standing next to it is not picked with it.
  const on = !!p && p.dim === state.dim && Math.floor(at.lng) === Math.floor(p.x) && Math.floor(-at.lat) === Math.floor(p.z);
  el.classList.toggle('keep', on);
  // Chests and villagers: the larger drawing (same as a search hit); other marks grow through CSS.
  const fi = el.querySelector('.find-icon');
  if (fi && layer.mark) {
    if (fi.classList.contains('hit') !== on) {
      fi.classList.toggle('hit', on);
      fi.innerHTML = on ? `<span class="hit-ring"></span>${layer.mark.big}` : layer.mark.small;
    }
  }
}

// Focus the mark that was clicked (its bubble opened), unless it is already one of the marked search results.
function focusClicked(e) {
  const src = e.popup._source || markerAt(e.popup.getLatLng());  // pins open a bubble of their own at the pin
  if (!(src instanceof L.Marker)) return;
  if (!findGroup.hasLayer(src)) {
    const at = src.getLatLng();
    finds = { type: 'place', label: '', place: { dim: state.dim, x: Math.floor(at.lng), z: Math.floor(-at.lat) }, matches: [] };
    renderFinds();
    // The clicked mark's name goes into the search box, as if it had been searched for.
    // (A group of marks in one block clears it until one of them is picked from its list.)
    const name = src.mark ? src.mark.name : e.popup.getElement()?.querySelector('h4')?.textContent.trim();
    if (name || src.mark) searchText(name);
  }
  fitPopup(e.popup, src);
}

function markerAt(at) {
  let found = null;
  map.eachLayer((l) => { if (!found && l instanceof L.Marker && l.getElement() && l.getLatLng().equals(at)) found = l; });
  return found;
}

// Point the bubble's tip at the top of the (now larger) picture instead of covering it.
function fitPopup(popup, marker) {
  const svg = marker.getElement()?.querySelector('svg');
  if (!svg) return;
  const top = svg.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
  const gap = Math.round(top - map.latLngToContainerPoint(marker.getLatLng()).y);
  popup.options.offset = L.point(0, Math.min(0, gap) + 7);
  popup.update();
}

function clearFinds() {
  finds = null;
  renderFinds();
}

// ---------- nether portals (found in the world by the map maker) ----------
const portalGroup = L.layerGroup();
const PORTAL_SVG = `<svg class="gm-svg" viewBox="0 0 20 28" width="17" height="24"><ellipse class="gm-shadow" cx="10" cy="25.5" rx="7" ry="1.8"/>`
  + '<g class="gm-body"><rect x="2.5" y="2.5" width="15" height="21" rx="1.5" fill="#7b3fe4" stroke="#1b1d22" stroke-width="3"/>'
  + '<path d="M6 8c3-1 5 1 8 0M6 13c3-1 5 1 8 0M6 18c3-1 5 1 8 0" stroke="#d6b8ff" stroke-width="1.6" fill="none" stroke-linecap="round"/></g></svg>';

async function loadPortals() {
  state.portals = (await fetchJson(`${DATA}portals.json?v=${encodeURIComponent(state.config.updatedAt || '')}`))?.dims || {};
  renderPortals();
}

// Where a gate leads: the nearest gate on the other side around x/8 (or x*8), as the game looks for it.
function portalLink(g, dim) {
  const other = dim === 'overworld' ? 'nether' : dim === 'nether' ? 'overworld' : null;
  if (!other) return null;
  const k = dim === 'overworld' ? 1 / 8 : 8;
  const tx = Math.floor(g.x * k), tz = Math.floor(g.z * k);
  const range = dim === 'overworld' ? 16 : 128;
  let best = null;
  for (const o of state.portals?.[other] || []) {
    const d = Math.max(Math.abs(o.x - tx), Math.abs(o.z - tz));
    if (d <= range && (!best || d < best.d)) best = { ...o, d };
  }
  return { other, tx, tz, gate: best };
}

// Every gate found in the world is shown in its own dimension.
function shownGates(dim) {
  return (state.portals?.[dim] || []).map((g) => ({ ...g }));
}

function renderPortals() {
  portalGroup.clearLayers();
  if (!$('#show-portals').checked) return;
  for (const g of shownGates(state.dim)) {
    const m = L.marker(ll(g.x + 0.5, g.z + 0.5), {
      pmIgnore: true, zIndexOffset: 400,
      icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0],
        html: `<div class="portal-icon gm" style="transform:translate(-50%,-22px)">${PORTAL_SVG}<span class="nm">${esc(g.name || 'ゲート')}</span></div>` }),
    });
    const place = { id: `gate:${state.dim}:${g.x}:${g.y}:${g.z}`, name: g.name || 'ネザーゲート', x: g.x, z: g.z, dim: state.dim };
    m.bindPopup(() => {
      const el = document.createElement('div'); el.className = 'pop';
      el.innerHTML = `<h4>${esc(g.name || 'ネザーゲート')}</h4><div class="sub">ネザーゲート</div><div class="xyz">X ${g.x} / Y ${g.y} / Z ${g.z}</div>`;
      const acts = document.createElement('div'); acts.className = 'acts';
      acts.append(routeButton(place));
      const link = portalLink(g, state.dim);
      if (link) {
        const name = DIMS[link.other].name;
        const line = document.createElement('div'); line.className = 'sub';
        if (link.gate) {
          line.textContent = `つながり先(推定): ${name}の「${link.gate.name || 'ゲート'}」 X ${link.gate.x} / Y ${link.gate.y} / Z ${link.gate.z}`;
          el.append(line);
          acts.append(button('つながり先を見る', () => goTo(link.gate.x, link.gate.z, link.other, 1)));
        } else {
          // No gate on the other side yet: where the game will make one when someone goes through.
          line.textContent = `${name}側のゲートはまだ見つかっていません`;
          const spot = document.createElement('div'); spot.className = 'sub';
          spot.textContent = `${name}のゲート生成目安 X ${link.tx} Z ${link.tz}`;
          el.append(line, spot);
          acts.append(button('その場所を見る', () => goTo(link.tx, link.tz, link.other, 1)));
        }
      }
      el.append(acts);
      return el;
    });
    portalGroup.addLayer(routeAware(m, place.id));
  }
}

// ---------- the game's clock and weather (from the latest world save) ----------
// Realms only runs while someone plays, so the clock moves on from the save only while someone is online.
function worldTimeNow() {
  const w = state.world;
  if (!w) return null;
  let t = w.time;
  if (state.anyoneOnline && w.cycle !== false) t += Math.max(0, Date.now() - w.at) * 0.02;
  return ((Math.floor(t) % 24000) + 24000) % 24000;
}

function renderClock() {
  const el = $('#clock');
  const t = worldTimeNow();
  if (t === null) { el.hidden = true; return; }
  const minutes = Math.floor(((t / 1000 + 6) % 24) * 60);
  const hh = Math.floor(minutes / 60), mm = minutes % 60;
  const phase = t < 12000 ? '昼' : t < 13000 ? '夕方' : t < 23000 ? '夜' : '朝';
  const w = state.world;
  const weather = w.thunder ? '雷雨' : w.rain ? '雨' : '晴れ';
  const night = t >= 12000 && t < 23500;
  el.innerHTML = `<svg class="ic"><use href="#i-${night ? 'moon' : 'sun'}"/></svg><b>${phase} ${hh}:${String(mm).padStart(2, '0')}</b><span>${weather}</span>`;
  el.title = state.anyoneOnline ? 'ゲーム内の時刻と天気(だいたい)' : 'ゲーム内の時刻と天気(最後に遊んだとき)';
  el.classList.toggle('frozen', !state.anyoneOnline);
  el.hidden = false;
}

// ---------- route: from a pin to a chosen destination (like a map app) ----------
const route = { from: null, to: null, line: null, job: 0 };

// Sprinting time along the straight line, using the map's heights and surface blocks:
// open ground at sprint speed, extra time for climbing, swimming through water, and a warning for lava.
const SPRINT = 5.6, SWIM = 2.2, STEP_UP = 0.25, CLIMB = 0.6;
async function travelEstimate(f, t) {
  const n = Math.max(1, Math.ceil(Math.hypot(t.x - f.x, t.z - f.z)));
  if (n > 20000) return '';
  const pts = [];
  for (let i = 0; i <= n; i++) {
    pts.push([Math.floor(f.x + 0.5 + (t.x - f.x) * i / n), Math.floor(f.z + 0.5 + (t.z - f.z) * i / n)]);
  }
  // Load every map piece the line crosses (heights and surface blocks).
  const tiles = new Set(pts.map(([x, z]) => `${Math.floor(x / 256)},${Math.floor(z / 256)}`));
  const ground = new Map();
  await Promise.all([...tiles].map(async (k) => {
    const [tx, tz] = k.split(',').map(Number);
    const gu = infoUrl(tx, tz, 'ground'), iu = infoUrl(tx, tz, 'info');
    const [g] = await Promise.all([gu ? loadGroundGrid(gu) : null, iu ? loadInfoTile(iu) : null]);
    ground.set(k, g);
  }));
  const water = new Set(['water', 'flowing_water'].map((nm) => blockNames.indexOf(nm)).filter((i) => i > 0));
  const lava = new Set(['lava', 'flowing_lava'].map((nm) => blockNames.indexOf(nm)).filter((i) => i > 0));
  let sec = 0, hot = false, prev = null;
  for (const [x, z] of pts.slice(1)) {
    const top = blockAtNow(x, z).raw;
    const g = ground.get(`${Math.floor(x / 256)},${Math.floor(z / 256)}`);
    const h = g ? g[(z - Math.floor(z / 256) * 256) * 256 + (x - Math.floor(x / 256) * 256)] : NO_GROUND;
    if (top && lava.has(top.id)) hot = true;
    if (top && water.has(top.id)) { sec += 1 / SWIM; prev = null; continue; }
    if (!top && h === NO_GROUND) { sec += 1 / SPRINT; continue; }
    sec += 1 / SPRINT;
    if (h !== NO_GROUND && prev !== null && h > prev) {
      const rise = h - prev;
      sec += rise === 1 ? STEP_UP : rise * CLIMB;
    }
    if (h !== NO_GROUND) prev = h;
  }
  const time = sec < 60 ? `${Math.max(1, Math.round(sec))}秒` : `${Math.floor(sec / 60)}分${Math.round(sec % 60) ? `${Math.round(sec % 60)}秒` : ''}`;
  return `走って約${time}${hot ? '・途中に溶岩あり' : ''}`;
}

// Everything on the map that a route can start from or go to, in one dimension.
function routePlaces(dim) {
  const out = [];
  for (const a of state.annotations) {
    if (a.type === 'waypoint' && a.dim === dim) out.push({ id: a.id, name: a.name || 'ピン', x: a.x, z: a.z, dim, icon: flagSvg(a.color) });
  }
  for (const p of state.players) {
    const c = playerColor(p.key);
    if (p.dim === dim) out.push({ id: `player:${p.key}`, name: p.name, x: p.x, z: p.z, dim, icon: playerSvg(c) });
    if (p.bed?.dim === dim) out.push({ id: `bed:${p.key}`, name: `${p.name}・ベッド`, x: p.bed.x, z: p.bed.z, dim, icon: BED_SVG(c) });
    if (p.death?.dim === dim) out.push({ id: `death:${p.key}`, name: `${p.name}・最終死亡地点`, x: p.death.x, z: p.death.z, dim, icon: DEATH_SVG });
  }
  for (const g of shownGates(dim)) {
    out.push({ id: `gate:${dim}:${g.x}:${g.y}:${g.z}`, name: g.name || 'ネザーゲート', x: g.x, z: g.z, dim, icon: PORTAL_SVG });
  }
  return out;
}

function routeTargets() {
  const f = route.from;
  const out = routePlaces(f.dim).filter((t) => t.id !== f.id);
  for (const t of out) t.dist = Math.hypot(t.x - f.x, t.z - f.z);
  return out.sort((p, q) => p.dist - q.dist);
}

// While choosing a destination, tapping something on the map picks it instead of opening its bubble.
function pickRouteTarget(id) {
  if (!route.from || id === route.from.id || !routeTargets().some((t) => t.id === id)) return false;
  setRouteTarget(id);
  return true;
}

// Markers other than pins: pick as destination when a route is open, otherwise show the bubble.
function routeAware(marker, id) {
  marker.on('popupopen', () => { if (pickRouteTarget(id)) marker.closePopup(); });
  return marker;
}

// A bubble from HTML plus a "choose destination" button for this place.
function popupWithRoute(html, place) {
  return () => {
    const el = document.createElement('div'); el.className = 'pop';
    el.innerHTML = html;
    const acts = document.createElement('div'); acts.className = 'acts';
    acts.append(routeButton(place));
    el.append(acts);
    return el;
  };
}

function routeButton(place) {
  return button('行き先を選ぶ', () => startRoute(place), 'route');
}

function startRoute(a) {
  stopRoute();
  route.from = { id: a.id, name: a.name || 'ピン', x: a.x, z: a.z, dim: a.dim };
  map.closePopup();
  $('#route-from').textContent = route.from.name;
  showRouteChoice(null);
  $('#route-result').hidden = true;
  $('#route').hidden = false;
  showRoutePoints();
  toast('行き先を一覧から選ぶか、地図でタップしてください');
}

function setRouteTarget(id, point) {
  const t = point || routeTargets().find((v) => v.id === id);
  if (!t) return;
  t.dist = Math.hypot(t.x - route.from.x, t.z - route.from.z);
  route.to = t;
  if (point) t.icon = GOAL_SVG;
  showRouteChoice(t);
  const f = route.from;
  if (route.line) map.removeLayer(route.line);
  route.line = L.polyline([ll(f.x + 0.5, f.z + 0.5), ll(t.x + 0.5, t.z + 0.5)],
    { color: '#fff', weight: 3, opacity: 0.95, dashArray: '6 6', pmIgnore: true, interactive: false }).addTo(map);
  $('#route-dist').textContent = `${Math.round(t.dist)}ブロック`;
  const nether = f.dim === 'overworld' && t.dist >= 200 ? `ネザー経由なら約${Math.round(t.dist / 8)}ブロック` : '';
  $('#route-time').textContent = '走って…計算中';
  $('#route-nether').textContent = nether;
  const job = ++route.job;
  travelEstimate(f, t).then((est) => { if (job === route.job) $('#route-time').textContent = est; });
  showRoutePoints();
  $('#route-result').hidden = false;
  // Keep both ends clear of the route card (top on a computer, bottom on a phone).
  const phone = window.matchMedia('(max-width: 700px)').matches;
  map.fitBounds(route.line.getBounds(), phone
    ? { paddingTopLeft: [50, 130], paddingBottomRight: [70, 260], maxZoom: 2 }
    : { paddingTopLeft: [60, 290], paddingBottomRight: [90, 70], maxZoom: 2 });
}

// A spot picked on empty ground (not a pin or other mark) gets its own small mark while the route is open.
const routePoints = L.layerGroup();
// Start: a green flag (pin style). Destination: a red cross. Both only for spots picked on empty ground.
const GOAL_SVG = '<svg class="gm-svg" viewBox="0 0 22 24" width="20" height="22"><ellipse class="gm-shadow" cx="11" cy="21.5" rx="6" ry="1.6"/>'
  + '<g class="gm-body"><path d="M5 5l12 12M17 5L5 17" stroke="#1b1d22" stroke-width="7" stroke-linecap="round"/>'
  + '<path d="M5 5l12 12M17 5L5 17" stroke="#e5484d" stroke-width="3.6" stroke-linecap="round"/></g></svg>';

function showRoutePoints() {
  routePoints.clearLayers();
  const marks = [
    [route.from, `<div class="wp-icon gm" style="transform:translate(-50%,-28.4px)">${flagSvg('#3ecf8e')}</div>`],
    [route.to, `<div class="gm" style="transform:translate(-50%,-10px)">${GOAL_SVG}</div>`],
  ];
  for (const [p, html] of marks) {
    if (!p || !String(p.id).startsWith('point:')) continue;
    routePoints.addLayer(L.marker(ll(p.x + 0.5, p.z + 0.5), {
      pmIgnore: true, interactive: false, zIndexOffset: 1500,
      icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html }),
    }));
  }
  if (!map.hasLayer(routePoints)) routePoints.addTo(map);
}

function showRouteChoice(t) {
  const btn = $('#route-to');
  btn.querySelector('.s-icon').innerHTML = t?.icon || '';
  btn.querySelector('.pick-name').textContent = t ? t.name : '行き先を選んでください';
  btn.classList.toggle('placeholder', !t);
  $('#route-list').hidden = true;
}

function stopRoute() {
  routePoints.clearLayers();
  if (route.line) map.removeLayer(route.line);
  route.from = null; route.to = null; route.line = null; route.job++;
  $('#route').hidden = true;
}

function setupRoute() {
  // The destination list looks like the search suggestions (icon + name), on every screen.
  const btn = $('#route-to'), list = $('#route-list');
  btn.addEventListener('click', () => {
    if (!list.hidden) { list.hidden = true; return; }
    list.innerHTML = '';
    const targets = routeTargets();
    for (const t of targets) {
      const li = document.createElement('li');
      if (route.to?.id === t.id) li.className = 'active';
      li.innerHTML = `<span class="s-icon">${t.icon || ''}</span><span class="s-title"></span>`;
      li.querySelector('.s-title').textContent = t.name;
      li.addEventListener('click', () => { list.hidden = true; setRouteTarget(t.id); });
      list.append(li);
    }
    if (!targets.length) list.innerHTML = '<li class="empty">選べる行き先がありません。地図をタップして選べます</li>';
    list.hidden = false;
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#route-pick')) list.hidden = true; }, true);
  $('#route-close').addEventListener('click', stopRoute);
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

const playerSvg = (c) => `<svg class="gm-svg" viewBox="0 0 20 24" width="20" height="24"><ellipse class="gm-shadow" cx="10" cy="21" rx="4.5" ry="1.4"/>`
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

const TRAIL_HOURS = 24;
const BED_SVG = (c) => `<svg class="gm-svg" viewBox="0 0 30 24" width="24" height="19"><ellipse class="gm-shadow" cx="15" cy="21.5" rx="11" ry="1.8"/>`
  + `<g class="gm-body"><path d="M4 19V6M26 19v-5" stroke="#1b1d22" stroke-width="5" stroke-linecap="round"/>`
  + `<path d="M3.5 11.5h23v5h-23z" fill="${c}" stroke="#1b1d22" stroke-width="2.4" stroke-linejoin="round"/>`
  + `<path d="M5.5 9.5h6v2h-6z" fill="#f4f1ea" stroke="#1b1d22" stroke-width="2" stroke-linejoin="round"/>`
  + `<path d="M4 19V6M26 19v-5" stroke="#b07a3f" stroke-width="2" stroke-linecap="round"/></g></svg>`;

function renderPlayers() {
  playerGroup.clearLayers();
  const showDeaths = $('#show-deaths').checked;
  const showTrails = $('#btn-trails').classList.contains('on');
  const showBeds = $('#show-beds').checked;
  // Footprints of the last day, one line per stretch in this dimension.
  if (showTrails) {
    const since = Date.now() - TRAIL_HOURS * 3600 * 1000;
    for (const p of state.players) {
      const color = playerColor(p.key);
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          playerGroup.addLayer(L.polyline(run, { color, weight: 3, opacity: 0.75, dashArray: '2 7', lineCap: 'round', pmIgnore: true, interactive: false }));
        }
        run = [];
      };
      const pts = (Array.isArray(p.trail) ? p.trail : []).filter((t) => t[0] >= since);
      if (pts.length && p.dim === state.dim) pts.push([Date.now(), p.dim, p.x, p.z]);
      for (const [t, dim, x, z] of pts) {
        if (dim !== state.dim) { flush(); continue; }
        run.push(ll(x + 0.5, z + 0.5));
        // Each recorded spot gets a small dot that tells when the player was there.
        if (t < Date.now() - 1000) {
          playerGroup.addLayer(L.circleMarker(ll(x + 0.5, z + 0.5), { radius: 3, color: '#1b1d22', weight: 1, fillColor: color, fillOpacity: 1, pmIgnore: true })
            .bindTooltip(`${p.name} ${timeText(t)}`, { direction: 'top', offset: [0, -4] }));
        }
      }
      flush();
    }
  }
  // Beds: players sharing one bed get one mark.
  if (showBeds) {
    const beds = new Map();
    for (const p of state.players) {
      const b = p.bed;
      if (!b || b.dim !== state.dim) continue;
      const k = `${b.x},${b.y},${b.z}`;
      if (!beds.has(k)) beds.set(k, { ...b, who: [] });
      beds.get(k).who.push(p);
    }
    for (const b of beds.values()) {
      const names = b.who.map((p) => p.name).join('・');
      const m = L.marker(ll(b.x + 0.5, b.z + 0.5), {
        pmIgnore: true, zIndexOffset: 500,
        icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="bed-icon gm" style="transform:translate(-50%,-17px)">${BED_SVG(playerColor(b.who[0].key))}</div>` }),
      });
      const place = { id: `bed:${b.who[0].key}`, name: `${b.who[0].name}・ベッド`, x: b.x, z: b.z, dim: b.dim };
      m.bindPopup(popupWithRoute(`<h4>${esc(names)}のベッド</h4><div class="sub">リスポーン地点</div><div class="xyz">X ${b.x} / Y ${b.y} / Z ${b.z}</div>`, place));
      playerGroup.addLayer(routeAware(m, place.id));
    }
  }
  for (const p of state.players) {
    const color = playerColor(p.key);
    if (p.dim === state.dim) {
      const off = p.online !== true;
      const cls = p.online === true ? 'on' : p.online === false ? 'off' : 'unk';
      const m = L.marker(ll(p.x + 0.5, p.z + 0.5), {
        pmIgnore: true, zIndexOffset: off ? 900 : 1000,
        icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0],
          html: `<div class="pl-icon gm ${cls}" style="transform:translate(-50%,-21px)"><span class="ring"></span>${playerSvg(color)}<span class="nm">${esc(p.name)}</span></div>` }),
      });
      const place = { id: `player:${p.key}`, name: p.name, x: p.x, z: p.z, dim: p.dim };
      m.bindPopup(popupWithRoute(`<h4>${esc(p.name)}</h4><div class="sub">${esc(placeText(p))}</div><div class="xyz">X ${p.x} / Y ${p.y} / Z ${p.z}</div><div class="sub">${esc(otherDimLine(p.x, p.z, p.dim))}</div>`, place));
      playerGroup.addLayer(routeAware(m, place.id));
    }
    const d = p.death;
    if (showDeaths && d && d.dim === state.dim) {
      const m = L.marker(ll(d.x + 0.5, d.z + 0.5), {
        pmIgnore: true,
        icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html: `<div class="death-icon gm" style="transform:translate(-50%,-25px)">${DEATH_SVG}<span class="nm">${esc(p.name)}</span></div>` }),
      });
      const place = { id: `death:${p.key}`, name: `${p.name}・最終死亡地点`, x: d.x, z: d.z, dim: d.dim };
      m.bindPopup(popupWithRoute(`<h4 class="death-h">${DEATH_SVG} ${esc(p.name)}が最後に死んだ場所</h4><div class="xyz">X ${d.x} / Y ${d.y} / Z ${d.z}</div>`, place));
      playerGroup.addLayer(routeAware(m, place.id));
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
    exploreLayer = new ExploreLayer({ minZoom: -6, maxZoom: MAX_ZOOM, opacity: 0.45, pmIgnore: true, zIndex: 4, updateWhenZooming: false }).addTo(map);
  }
  renderExploreLegend();
}

let lastPlayersJson = '';

// The GitHub API answers "unchanged" (304) for free, so polling it stays fresh without the file server's 5-minute cache.
// The live check also sends its data to the group's server, which pages can ask every few seconds.
let liveAt = 0, liveCache = null;
async function fetchLive() {
  if (share.url) {
    try {
      const res = await fetch(`${share.url}/live?since=${liveAt}`, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        if (d.unchanged && liveCache) return liveCache;
        if (d.live) { liveAt = d.at; liveCache = d.live; return d.live; }
      }
    } catch { /* fall back to GitHub */ }
  }
  if (state.config.liveApiUrl) {
    try {
      const res = await fetch(state.config.liveApiUrl, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.raw' } });
      if (res.ok) return await res.json();
    } catch { /* fall back to the file server */ }
  }
  return state.config.liveUrl ? fetchJson(state.config.liveUrl) : null;
}

async function refreshConfig() {
  const cfg = await fetchJson(`${DATA}config.json?t=${Date.now()}`);
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
  state.explore = await fetchJson(`${DATA}explore.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  refreshExplore();
  loadPortals();
  loadItems();
}

async function refreshLive() {
  const badge = $('#online-badge');
  const list = $('#live-list');
  if (!state.config.liveUrl && !share.url) {
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
    const when = m.online ? 'プレイ中' : '最終ログイン ' + esc(agoText(Math.max(m.lastSeenOnline || 0, m.lastLogin || 0)));
    li.innerHTML = `<span class="dot" style="background:${m.online ? 'var(--accent)' : '#555'}"></span><span class="grow">${esc(m.name)}</span><span class="sub">${when}</span>`;
    list.append(li);
  }

  renderRealm(data.realm, online.length, members.length);

  const players = Array.isArray(data.players) ? data.players : [];
  const json = JSON.stringify(players);
  state.worldAt = data.worldAt;
  state.world = data.world && typeof data.world.time === 'number' ? data.world : null;
  state.anyoneOnline = online.length > 0;
  renderClock();
  $('#players-updated').textContent = data.worldAt ? `${timeText(data.worldAt)} の記録` : '';
  if (json !== lastPlayersJson) {
    lastPlayersJson = json;
    state.players = players;
    renderPlayers();
    renderExploreLegend();
    // Pet owners' names and colours come from the player list.
    if (state.items) { buildFindIndex(); renderThings(); if (finds && finds.type !== 'place') showFinds(finds.type, finds.key, false); }
  }
}

// ---------- Realm information (settings read from Realms by the frequent check) ----------
const DIFFICULTY = ['ピース', 'イージー', 'ノーマル', 'ハード'];
const GAME_MODE = ['サバイバル', 'クリエイティブ', 'アドベンチャー'];
const RULE_NAMES = [
  ['keepInventory', '死んでも持ち物を失わない'], ['pvp', 'プレイヤー同士の攻撃'], ['showCoordinates', '座標を表示'],
  ['mobGriefing', 'モブがブロックを壊す'], ['doImmediateRespawn', 'すぐにリスポーン'], ['playersSleepingPercentage', '朝にするのに寝る人の割合'],
  ['doFireTick', '火が燃え広がる'], ['tntExplodes', 'TNTが爆発する'], ['naturalRegeneration', '体力の自然回復'],
  ['showDeathMessages', '死亡メッセージ'], ['doDayLightCycle', '昼と夜が進む'], ['doWeatherCycle', '天気が変わる'],
];

// The next payment day on or after today; months shorter than the day pay on their last day.
function nextBillingDate(day) {
  const now = new Date();
  const on = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  const thisMonth = on(now.getFullYear(), now.getMonth());
  return thisMonth >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? thisMonth : on(now.getFullYear(), now.getMonth() + 1);
}

function renderRealm(r, online, memberCount) {
  const box = $('#realm-info');
  if (!r || typeof r !== 'object') return;
  const row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const onOff = (v) => (v === true ? 'オン' : v === false ? 'オフ' : esc(v));
  let html = r.motd ? `<p class="help">${esc(r.motd)}</p>` : '';
  html += '<h3>状態</h3>';
  if (r.owner) html += row('所有者', esc(r.owner));
  html += row('サーバー', r.open ? '<i class="dot on"></i>開いている' : '<i class="dot"></i>閉じている');
  html += row('参加中', `${online}人・メンバー ${memberCount}人${Number.isFinite(r.maxPlayers) ? `・最大 ${r.maxPlayers}人` : ''}`);
  if (r.expired) html += row('期限', '<span class="warn">切れています</span>');
  const day = state.config.realmBillingDay;
  if (day) {
    const d = nextBillingDate(day);
    html += row('次の支払い', `${d.getMonth() + 1}月${d.getDate()}日${state.config.realmPrice ? `・${state.config.realmPrice.toLocaleString('ja-JP')}円` : ''}`);
  } else if (state.config.realmPrice) {
    html += row('料金', `月${state.config.realmPrice.toLocaleString('ja-JP')}円`);
  }
  if (r.backups && Number.isFinite(r.backups.count)) {
    html += row('バックアップ', `${r.backups.count}個${r.backups.latest ? `・最新 ${esc(timeText(r.backups.latest))}` : ''}`);
  }
  html += '<h3>ワールド</h3>';
  if (r.slotName) html += row('名前', esc(r.slotName) + (r.slot ? ` <span class="sub">スロット${r.slot}</span>` : ''));
  if (DIFFICULTY[r.difficulty]) html += row('難易度', DIFFICULTY[r.difficulty] + (r.hardcore ? '・ハードコア' : ''));
  if (GAME_MODE[r.gameMode]) html += row('ゲームモード', GAME_MODE[r.gameMode]);
  html += row('チート', r.cheats ? 'オン' : 'オフ');
  const rules = r.rules && typeof r.rules === 'object' ? r.rules : {};
  const known = RULE_NAMES.filter(([k]) => k in rules);
  if (known.length) {
    html += '<h3>ルール</h3>';
    for (const [k, label] of known) html += row(label, k === 'playersSleepingPercentage' ? `${Number(rules[k])}%` : onOff(rules[k]));
  }
  if (r.at) html += `<p class="help">${esc(timeText(r.at))} 時点</p>`;
  box.innerHTML = html;
}

async function setupPlayers() {
  state.explore = await fetchJson(`${DATA}explore.json?v=${encodeURIComponent(state.config.updatedAt || '')}`);
  playerGroup.addTo(map);
  portalGroup.addTo(map);
  findGroup.addTo(map);
  map.on('layeradd', (e) => { if (finds?.type === 'place') focusMark(e.layer); });
  map.on('popupopen', focusClicked);
  setupThingChips();
  renderPlayers();
  $('#show-deaths').addEventListener('change', renderPlayers);
  $('#btn-trails').addEventListener('click', () => {
    const on = !$('#btn-trails').classList.contains('on');
    $('#btn-trails').classList.toggle('on', on);
    renderPlayers();
    toast(on ? `足あとを表示(${TRAIL_HOURS}時間)` : '足あとを非表示');
  });
  $('#show-beds').addEventListener('change', renderPlayers);
  $('#show-portals').addEventListener('change', renderPortals);
  await loadPortals();
  loadItems();
  setInterval(renderClock, 15000);
  await refreshLive();
  // While someone plays: positions every 5 seconds and the map every 20 seconds.
  // Otherwise every 15 seconds through the group's server (cheap; every minute from GitHub without it) and the map every minute.
  const every = (fn, playing, idle) => {
    const next = () => setTimeout(async () => {
      if (document.visibilityState === 'visible') { try { await fn(); } catch { /* try again next time */ } }
      next();
    }, state.anyoneOnline ? playing : idle);
    next();
  };
  every(refreshLive, share.url ? 5000 : 30000, share.url ? 15000 : 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshLive(); });
  every(refreshConfig, 20000, 60000);
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

// Phone browsers: keep the page from being pinch-zoomed (only the map zooms), and keep the map
// exactly as tall as the visible screen as the browser's toolbars slide in and out.
function setupMobileView() {
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && !e.target.closest?.('#map')) e.preventDefault();
  }, { passive: false });
  // The page keeps its full height when the on-screen keyboard opens (only the search suggestions shrink, via --vv-h).
  let lastH = 0;
  const fit = () => {
    const root = document.documentElement.style;
    const vv = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    root.setProperty('--vv-h', `${Math.round(vv)}px`);
    const keyboard = !!document.activeElement?.matches?.('input, textarea') && vv < window.innerHeight * 0.85;
    if (keyboard) return;
    const h = Math.round(vv);
    if (h !== lastH) { lastH = h; root.setProperty('--app-h', `${h}px`); map.invalidateSize({ pan: false }); }
  };
  window.visualViewport?.addEventListener('resize', fit);
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
  fit();
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
    const res = await fetch(`${DATA}config.json?t=${Date.now()}`, { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch { /* fall through to demo */ }
  return {};
}

async function main() {
  const cfg = await loadConfig();
  state.config = {
    title: cfg.title || 'Blockmap',
    tileUrl: DATA + (cfg.tileUrl || 'tiles/{snapshot}/{dim}/{z}/{x}/{y}.png'),
    minNativeZoom: Number.isFinite(cfg.minNativeZoom) ? cfg.minNativeZoom : -4,
    maxNativeZoom: Number.isFinite(cfg.maxNativeZoom) ? cfg.maxNativeZoom : 0,
    snapshots: Array.isArray(cfg.snapshots) ? cfg.snapshots.filter((s) => s && s.id) : [],
    updatedAt: cfg.updatedAt,
    // Monthly Realm fee and day of the month it is paid (written by hand: Realms does not report either).
    realmPrice: Number.isFinite(cfg.realmPrice) ? cfg.realmPrice : null,
    realmBillingDay: Number.isInteger(cfg.realmBillingDay) && cfg.realmBillingDay >= 1 && cfg.realmBillingDay <= 31 ? cfg.realmBillingDay : null,
    liveUrl: typeof cfg.liveUrl === 'string' && /^https:\/\//.test(cfg.liveUrl) ? cfg.liveUrl : null,
    shareUrl: typeof cfg.shareUrl === 'string' && /^https:\/\/[\w.-]+(:\d+)?$/.test(cfg.shareUrl.replace(/\/$/, '')) ? cfg.shareUrl.replace(/\/$/, '') : null,
    liveApiUrl: typeof cfg.liveApiUrl === 'string' && /^https:\/\/api\.github\.com\//.test(cfg.liveApiUrl) ? cfg.liveApiUrl : null,
  };
  document.title = state.config.title;
  state.demo = state.config.snapshots.length === 0;
  state.snapshotIndex = snapshots().length - 1;

  map = L.map('map', {
    crs: L.CRS.Simple, center: ll(0, 0), zoom: 0, minZoom: -6, maxZoom: MAX_ZOOM,
    zoomSnap: 1, zoomControl: false, attributionControl: true, tap: false,
  });
  map.attributionControl.setPrefix(false);  // only the map's date shows in the corner
  L.control.zoom({ position: 'bottomright', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map);
  map.pm.setLang('ja');
  map.pm.setGlobalOptions({ snappable: false, continueDrawing: false, tooltips: false });
  annGroup.addTo(map);

  await loadBlockNames();
  refreshBase();
  state.annotations = store.load();
  share.url = DATA ? `${location.origin}/api`
    : new URLSearchParams(location.search).get('share') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
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
  setupMobileView();
  setupRoute();
  window.mcmap = { state, map, refreshConfig, refreshLive };
}

main();
