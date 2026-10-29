// The whole map site on Cloudflare: the site's files, the map data, and the shared pins.
//
// People sign in with Microsoft. Realm members may look; the site's owner (the account the map uses, which set the
// site up) may also choose which members may write. Once someone is in, the page is handed the name of the folder
// the map data sits in (DATA_DIR, a long random name), so the map pictures can be served as plain files (free and
// unlimited) without checking each one.
// The older ways in still work until the switch-over: the view invite link (VIEW_KEY, a cookie), write links, and
// the owner's passphrase (PASSPHRASE, also used by the live check to put in player data).
//
// Secrets: VIEW_KEY, DATA_DIR, PASSPHRASE, MEMBER_KEY (checks a sign-in against the members' ids).
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_ITEMS = 10000;
const MAX_BATCH = 300;
const KEEP_DELETED_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 3600 * 1000;
const COOKIE = 'bm';            // the older view-link cookie
const SESSION = 'bms';          // signed in with Microsoft
const COOKIE_DAYS = 400;
const MAX_WRITERS = 200;
const USED_EVERY_MS = 3600 * 1000;  // how often "last used" / "last seen" is brought up to date

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
    const cookie = (name, value, days) => `${name}=${value}; Max-Age=${days * 86400}; Path=/; Secure; HttpOnly; SameSite=Lax`;
    try {
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      const me = await whoIs(req, env, ip);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!me) return gatePage();
        const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        const html = (await page.text()).replace('<head>', `<head><script>window.BLOCKMAP_DATA=${JSON.stringify(`/d/${env.DATA_DIR}/`)};</script>`);
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      }
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
      const path = url.pathname.slice(4);

      // Signing in with Microsoft (open to anyone: only Realm members get through).
      if (path === '/ms/start' && req.method === 'POST') return json(await msStart(env, url));
      if (path === '/ms/finish' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const r = await msFinish(env, String(body?.code || ''), String(body?.ms || ''));
        if (!r.session) return json(r, r.error === 'not member' ? 403 : 400);
        return json({ ok: true, name: r.name }, 200, { 'Set-Cookie': cookie(SESSION, r.session, COOKIE_DAYS) });
      }
      if (path === '/logout' && req.method === 'POST') {
        const token = cookies(req)[SESSION];
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha(token)).run();
        return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax` });
      }

      // An older invite link: the view key (or a write link, or the passphrase) becomes a cookie on this device.
      if (path === '/join' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const key = typeof body?.key === 'string' ? body.key : '';
        if (!(await keyOk(env, ip, key, [env.VIEW_KEY], false)) && !(await roleOf(env, ip, key))) return json({ error: 'key' }, 401);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(COOKIE, await cookieValue(env), COOKIE_DAYS) });
      }

      if (!me) return json({ error: 'invite' }, 401);
      const admin = me.role === 'admin', writer = admin || me.role === 'writer';

      if (req.method === 'GET' && path === '/me') return json({ name: me.name, role: me.role, via: me.via });

      if (req.method === 'GET' && path === '/items') {
        const since = Number(url.searchParams.get('since')) || 0;
        const { results } = await env.DB.prepare('SELECT id, data, deleted, rev FROM items WHERE rev > ? ORDER BY rev LIMIT 5000')
          .bind(since).all();
        const items = results.map((r) => ({ id: r.id, data: JSON.parse(r.data), deleted: !!r.deleted, rev: r.rev }));
        return json({ items, rev: items.length ? items[items.length - 1].rev : since, now: Date.now() });
      }

      // Latest player data, put here by the live check so pages can look every few seconds.
      if (req.method === 'GET' && path === '/live') {
        const since = Number(url.searchParams.get('since')) || 0;
        const row = await env.DB.prepare('SELECT v, at FROM kv WHERE k = ?').bind('live').first();
        if (!row) return json({ error: 'none' }, 404);
        if (row.at <= since) return json({ unchanged: true, at: row.at });
        return new Response(`{"at":${row.at},"live":${row.v}}`, {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      // The owner's list of members, and who of them may write (nobody until the owner says so).
      if (path === '/access' && admin && req.method === 'GET') {
        const live = await liveInfo(env);
        const { results } = await env.DB.prepare('SELECT xid, write FROM access').all();
        const may = new Map(results.map((r) => [r.xid, !!r.write]));
        return json({ owner: live.ownerName, members: live.members.filter((m) => m.xid !== live.ownerXid)
          .map((m) => ({ xid: m.xid, name: m.name, write: !!may.get(m.xid) })) });
      }
      if (path === '/access' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const xid = String(body?.xid || '');
        if (!/^[0-9a-f]{32}$/.test(xid)) return json({ error: 'bad request' }, 400);
        await env.DB.prepare('INSERT INTO access (xid, write, updated) VALUES (?1, ?2, ?3) ON CONFLICT(xid) DO UPDATE SET write = ?2, updated = ?3')
          .bind(xid, body?.write ? 1 : 0, Date.now()).run();
        return json({ ok: true });
      }

      // Older ways (until the switch-over): the passphrase check, the view link, and write links.
      if (path === '/check') return writer ? json({ ok: true, role: me.role }) : json({ error: 'passphrase' }, 401);
      if (req.method === 'GET' && path === '/invite' && writer) return json({ link: `${url.origin}/#v=${encodeURIComponent(env.VIEW_KEY)}` });
      const link = (w) => ({ id: w.id, name: w.name, created: w.created, used: w.used, link: `${url.origin}/#w=${w.token}` });
      if (path === '/writers' && admin && req.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT id, name, token, created, used FROM writers ORDER BY created').all();
        return json({ writers: results.map(link) });
      }
      if (path === '/writers' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 30) : '';
        if (!name) return json({ error: 'name' }, 400);
        const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM writers').first()).n;
        if (count >= MAX_WRITERS) return json({ error: 'full' }, 507);
        const w = { id: randomHex(8), name, token: randomHex(32), created: Date.now(), used: null };
        await env.DB.prepare('INSERT INTO writers (id, name, token, created) VALUES (?1, ?2, ?3, ?4)').bind(w.id, w.name, w.token, w.created).run();
        return json(link(w));
      }
      if (path === '/writers/stop' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        await env.DB.prepare('DELETE FROM writers WHERE id = ?').bind(String(body?.id || '')).run();
        return json({ ok: true });
      }

      if (req.method !== 'POST') return json({ error: 'not found' }, 404);

      // Only the live check (with the passphrase) puts in player data.
      if (path === '/live' && admin && me.via === 'key') {
        const text = await req.text();
        if (text.length > 900 * 1024) return json({ error: 'too big' }, 413);
        try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
        await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
          .bind('live', text, Date.now()).run();
        return json({ ok: true });
      }

      if (path === '/items') {
        if (!writer) return json({ error: 'passphrase' }, 401);
        const body = await req.json().catch(() => null);
        const list = Array.isArray(body?.items) ? body.items : null;
        if (!list || list.length > MAX_BATCH) return json({ error: 'bad request' }, 400);
        for (const it of list) {
          if (typeof it?.id !== 'string' || !/^[\w-]{1,40}$/.test(it.id) || typeof it.data !== 'object' || !it.data) {
            return json({ error: 'bad item' }, 400);
          }
        }
        // Who made each pin is kept from its first writing; a new one gets this person's name (never the page's say).
        const before = new Map();
        for (let i = 0; i < list.length; i += 90) {
          const ids = list.slice(i, i + 90).map((it) => it.id);
          const { results } = await env.DB.prepare(`SELECT id, data FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
          for (const r of results) before.set(r.id, JSON.parse(r.data).by);
        }
        const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first()).n;
        const now = Date.now();
        const stmts = [];
        let added = 0;
        for (const [i, it] of list.entries()) {
          const by = before.has(it.id) ? before.get(it.id) : me.name;
          const data = JSON.stringify({ ...it.data, id: it.id, by: by || undefined });
          if (data.length > MAX_ITEM_BYTES) return json({ error: 'too big' }, 413);
          if (!it.deleted && !before.has(it.id)) added++;
          stmts.push(env.DB.prepare(
            'INSERT INTO items (id, data, deleted, rev) VALUES (?1, ?2, ?3, ?4) '
            + 'ON CONFLICT(id) DO UPDATE SET data = ?2, deleted = ?3, rev = ?4',
          ).bind(it.id, data, it.deleted ? 1 : 0, now * 1000 + i));
        }
        if (count + added > MAX_ITEMS) return json({ error: 'full' }, 507);
        stmts.push(env.DB.prepare('DELETE FROM items WHERE deleted = 1 AND rev < ?').bind((now - KEEP_DELETED_MS) * 1000));
        await env.DB.batch(stmts);
        return json({ ok: true, rev: now * 1000 + list.length - 1 });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server' }, 500);
    }
  },
};

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// The cookie holds a value made from the view key, not the key itself.
async function cookieValue(env) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.VIEW_KEY || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('blockmap cookie')));
}

async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

// ---------- Microsoft sign-in → gamertag ----------
// One app (MS_CLIENT_ID, registered once for every Blockmap site) signs people in; the sign-in comes back to a shared
// page (MS_RELAY) that hands the one-time code to the site that asked. This site keeps the PKCE secret, so only it
// can turn the code into a token; the token is used once to ask Xbox for the gamertag, then dropped.
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MS_SESSION_MS = 15 * 60 * 1000;
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function msStart(env, url) {
  const session = randomHex(16), verifier = randomHex(32);
  const page = 'a';
  await env.DB.prepare('DELETE FROM ms_sessions WHERE created < ?').bind(Date.now() - MS_SESSION_MS).run();
  await env.DB.prepare('INSERT INTO ms_sessions (id, verifier, created) VALUES (?1, ?2, ?3)').bind(session, verifier, Date.now()).run();
  const q = new URLSearchParams({
    client_id: env.MS_CLIENT_ID, response_type: 'code', redirect_uri: env.MS_RELAY, scope: 'XboxLive.signin',
    code_challenge: b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier))), code_challenge_method: 'S256',
    state: `${url.host}~${session}~${page}`, prompt: 'select_account',
  });
  return { url: `${MS}/authorize?${q}` };
}

async function msFinish(env, code, signIn) {
  if (!/^[0-9a-f]{32}$/.test(signIn) || !code) return { error: 'bad request' };
  const row = await env.DB.prepare('SELECT verifier, created FROM ms_sessions WHERE id = ?').bind(signIn).first();
  await env.DB.prepare('DELETE FROM ms_sessions WHERE id = ?').bind(signIn).run();
  if (!row || Date.now() - row.created > MS_SESSION_MS) return { error: 'expired', step: 'session' };
  const post = async (step, address, init) => {
    const res = await fetch(address, init);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not json */ }
    // Only the step, the status and the error's name come back: never tokens.
    if (!res.ok) throw Object.assign(new Error(step), { info: { step, status: res.status, error: body?.error || body?.XErr || null } });
    return body;
  };
  try {
    const token = await post('token', `${MS}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, grant_type: 'authorization_code', code, redirect_uri: env.MS_RELAY,
        code_verifier: row.verifier, scope: 'XboxLive.signin' }),
    });
    const xbl = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' };
    const user = await post('xbox', 'https://user.auth.xboxlive.com/user/authenticate', {
      method: 'POST', headers: xbl, body: JSON.stringify({ RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${token.access_token}` } }),
    });
    const xsts = await post('xsts', 'https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST', headers: xbl, body: JSON.stringify({ RelyingParty: 'http://xboxlive.com', TokenType: 'JWT',
        Properties: { SandboxId: 'RETAIL', UserTokens: [user.Token] } }),
    });
    const who = xsts?.DisplayClaims?.xui?.[0] || {};
    if (!who.gtg || !who.xid) return { error: 'no gamertag', step: 'claims' };
    const xid = await siteId(env, who.xid);
    const live = await liveInfo(env);
    if (xid !== live.ownerXid && !live.members.some((m) => m.xid === xid)) return { error: 'not member', gamertag: who.gtg };
    const session = randomHex(32), now = Date.now();
    await env.DB.prepare('INSERT INTO sessions (token, xid, name, created, seen) VALUES (?1, ?2, ?3, ?4, ?4)')
      .bind(await sha(session), xid, String(who.gtg).slice(0, 40), now).run();
    return { session, name: who.gtg };
  } catch (e) {
    return { error: 'failed', ...(e.info || { step: 'other' }) };
  }
}

// ---------- who is asking ----------
function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function sha(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// The members' ids as the live check last saw them (tools/realms/common.js makes them with the same MEMBER_KEY).
async function siteId(env, xuid) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.MEMBER_KEY || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(String(xuid)))).slice(0, 32);
}

async function liveInfo(env) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('live').first();
  let live = {};
  try { live = JSON.parse(row?.v || '{}'); } catch { /* none yet */ }
  const members = (Array.isArray(live.members) ? live.members : []).filter((m) => m && typeof m.xid === 'string')
    .map((m) => ({ xid: m.xid, name: String(m.name || '') }));
  return { members, ownerXid: live.realm?.ownerXid || null, ownerName: live.realm?.owner || null };
}

// { role: 'admin' | 'writer' | 'viewer', name, via } for whoever is asking, or null.
// Signed in with Microsoft: the site's owner is the admin; members the owner allowed may write; other members look.
// Someone no longer in the Realm is let in no more.
async function whoIs(req, env, ip) {
  const pass = req.headers.get('X-Passphrase') || '';
  if (pass) {
    const role = await roleOf(env, ip, pass);
    if (role === 'admin') return { role, name: null, via: 'key' };
    if (role === 'writer') {
      const w = await env.DB.prepare('SELECT name FROM writers WHERE token = ?').bind(pass).first();
      return { role, name: w?.name || null, via: 'key' };
    }
  }
  const jar = cookies(req);
  if (jar[SESSION] && /^[0-9a-f]{64}$/.test(jar[SESSION])) {
    const id = await sha(jar[SESSION]);
    const row = await env.DB.prepare('SELECT xid, name, seen FROM sessions WHERE token = ?').bind(id).first();
    if (row) {
      const live = await liveInfo(env);
      const member = live.members.find((m) => m.xid === row.xid);
      const owner = row.xid === live.ownerXid;
      if (owner || member) {
        if (!row.seen || Date.now() - row.seen > USED_EVERY_MS) await env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(Date.now(), id).run();
        const may = owner ? null : await env.DB.prepare('SELECT write FROM access WHERE xid = ?').bind(row.xid).first();
        return { role: owner ? 'admin' : may?.write ? 'writer' : 'viewer', name: (owner ? live.ownerName : member.name) || row.name, via: 'microsoft' };
      }
    }
  }
  if (env.VIEW_KEY && env.DATA_DIR && jar[COOKIE] && (await same(jar[COOKIE], await cookieValue(env)))) return { role: 'viewer', name: null, via: 'link' };
  return null;
}

function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// 'admin' for the owner's passphrase, 'writer' for a write link that has not been stopped, else null.
async function roleOf(env, ip, given) {
  if (await keyOk(env, ip, given, [env.PASSPHRASE], false)) return 'admin';
  if (!/^[0-9a-f]{64}$/.test(given)) return (await keyOk(env, ip, given, [])) && null;
  const w = await env.DB.prepare('SELECT id, used FROM writers WHERE token = ?').bind(given).first();
  if (!w) return (await keyOk(env, ip, given, [])) && null;
  if (!w.used || Date.now() - w.used > USED_EVERY_MS) await env.DB.prepare('UPDATE writers SET used = ? WHERE id = ?').bind(Date.now(), w.id).run();
  return 'writer';
}

// Checks a key without leaking timing, and locks an address out for an hour after 10 misses.
// With count = false a miss is not counted (another kind of key may still match).
async function keyOk(env, ip, given, keys, count = true) {
  if (!given) return false;
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, since FROM fails WHERE ip = ?').bind(ip).first();
  if (row && row.count >= MAX_FAILS && now - row.since < FAIL_WINDOW_MS) return false;
  let ok = false;
  for (const k of keys) if (k && (await same(given, String(k)))) ok = true;
  if (ok) {
    if (row) await env.DB.prepare('DELETE FROM fails WHERE ip = ?').bind(ip).run();
  } else if (count) {
    const fresh = !row || now - row.since >= FAIL_WINDOW_MS;
    await env.DB.prepare('INSERT INTO fails (ip, count, since) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET count = ?2, since = ?3')
      .bind(ip, fresh ? 1 : row.count + 1, fresh ? now : row.since).run();
  }
  return ok;
}

// Shown to anyone not let in yet: sign in with Microsoft (the Realm's members get in). A sign-in comes back here
// (#mscode=…); an older invite link (#v= / #w= / #join=) still works until the switch-over.
function gatePage() {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Blockmap</title><link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171c;color:#e8e6e3;
font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
.box{width:min(420px,calc(100vw - 32px));padding:24px;border-radius:16px;background:#1f2229;border:1px solid #2e323b}
h1{margin:0 0 8px;font-size:20px}p{margin:0 0 16px;color:#a7abb3;line-height:1.6;font-size:14px}
#ms{width:100%;height:46px;border:0;border-radius:10px;background:#3ecf8e;color:#06130d;font-weight:700;font-size:16px}
#msg{margin:12px 0 0;min-height:1.6em;color:#ff8a86}
details{margin-top:18px;color:#a7abb3;font-size:13px}summary{cursor:pointer}
form{display:flex;gap:8px;margin-top:10px}input{flex:1;min-width:0;height:38px;padding:0 12px;border-radius:10px;border:1px solid #2e323b;
background:#15171c;color:inherit;font-size:16px}form button{height:38px;padding:0 14px;border:0;border-radius:10px;background:#2e323b;color:inherit}
</style></head><body><div class="box"><h1>Blockmap</h1>
<div id="start"><p>Realm のメンバーだけが見られる地図です。マイクラで使っている Microsoft アカウントでログインしてください。</p>
<button id="ms">Microsoft でログイン</button></div><p id="msg"></p>
<details id="old"><summary>招待リンクをお持ちの方</summary><form id="f"><input id="link" placeholder="招待リンク" autocomplete="off"><button>開く</button></form></details>
</div>
<script>
const msg = document.getElementById('msg');
document.getElementById('ms').onclick = async () => {
  msg.textContent = '';
  const r = await fetch('/api/ms/start', { method: 'POST' }).then((x) => x.json()).catch(() => null);
  if (r && r.url) location.href = r.url; else msg.textContent = 'ログインを始められませんでした。もう一度ためしてください';
};
// While a sign-in is being checked, only that is shown; the buttons come back if it does not work out.
function busy(on) {
  document.getElementById('start').hidden = on;
  document.getElementById('old').hidden = on;
}
async function finish(code, ms) {
  busy(true);
  msg.style.color = '#a7abb3';
  msg.textContent = 'ゲーマータグを確かめています…';
  try {
    const res = await fetch('/api/ms/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ms }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { msg.textContent = 'ログインできました。地図を開いています…'; location.reload(); return; }
    busy(false);
    msg.style.color = '';
    msg.textContent = d.error === 'not member' ? 'このアカウント(' + d.gamertag + ')は、この Realm のメンバーではありません'
      : d.error === 'expired' ? '時間がたちすぎました。もう一度ログインしてください'
      : 'ログインを確かめられませんでした(' + [d.step, d.status, d.error].filter(Boolean).join(' / ') + ')';
  } catch { busy(false); msg.style.color = ''; msg.textContent = '通信できませんでした。もう一度ためしてください'; }
}
function keyFrom(text) {
  const m = String(text).match(/[#&](v|w|join)=([^&\\s]+)/);
  if (!m) return null;
  let k; try { k = decodeURIComponent(m[2]); } catch { k = m[2]; }
  return { key: k, write: m[1] !== 'v' };
}
async function join(found) {
  if (!found) { msg.textContent = 'リンクの形が違います。もらったリンクをそのまま貼り付けてください'; return; }
  msg.textContent = '確認しています…';
  try {
    const res = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: found.key }) });
    if (res.ok) {
      // The map page takes a writer's key from the address (#join=…) and keeps it on this device.
      history.replaceState(null, '', '/' + (found.write ? '#join=' + encodeURIComponent(found.key) : ''));
      location.reload();
      return;
    }
    msg.textContent = res.status === 401 ? 'このリンクは使えません' : 'うまくいきませんでした(' + res.status + ')';
  } catch { msg.textContent = '通信できませんでした。もう一度ためしてください'; }
}
document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); join(keyFrom(document.getElementById('link').value)); });
function fromAddress() {
  const h = new URLSearchParams(location.hash.slice(1));
  const found = keyFrom(location.hash);
  history.replaceState(null, '', '/');
  if (h.get('mscode')) finish(h.get('mscode'), h.get('ms') || '');
  else if (found) join(found);
}
addEventListener('hashchange', fromAddress);
fromAddress();
</script></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
