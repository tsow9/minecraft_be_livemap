// The whole map site on Cloudflare: the site's files, the map data, and the shared pins.
//
// Only people who opened an invite link see the map. The link's key is swapped for a cookie on this device;
// the page is then handed the name of the folder the map data sits in (DATA_DIR, a long random name), so the
// map pictures can be served as plain files (free and unlimited) without checking each one.
// Writing pins and drawings needs a write link: the owner makes one per person (and can stop it) while signed in
// with the passphrase (PASSPHRASE), which only the owner keeps.
//
// Secrets: VIEW_KEY (the key in the view invite link), DATA_DIR, PASSPHRASE.
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_ITEMS = 10000;
const MAX_BATCH = 300;
const KEEP_DELETED_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 3600 * 1000;
const COOKIE = 'bm';
const COOKIE_DAYS = 400;
const MAX_WRITERS = 200;
const USED_EVERY_MS = 3600 * 1000;  // how often a write link's "last used" is brought up to date

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!(await viewer(req, env))) return gatePage();
        const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        const html = (await page.text()).replace('<head>', `<head><script>window.BLOCKMAP_DATA=${JSON.stringify(`/d/${env.DATA_DIR}/`)};</script>`);
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      }
      if (url.pathname === '/ms-test') return (await viewer(req, env)) ? msTestPage() : gatePage();
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
      const path = url.pathname.slice(4);
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';

      // Opening an invite link: the view key (or a write link, or the passphrase) becomes a cookie on this device.
      if (path === '/join' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const key = typeof body?.key === 'string' ? body.key : '';
        if (!(await keyOk(env, ip, key, [env.VIEW_KEY], false)) && !(await roleOf(env, ip, key))) return json({ error: 'key' }, 401);
        return json({ ok: true }, 200, {
          'Set-Cookie': `${COOKIE}=${await cookieValue(env)}; Max-Age=${COOKIE_DAYS * 86400}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        });
      }

      if (!(await viewer(req, env))) return json({ error: 'invite' }, 401);

      // Microsoft sign-in, to learn a visitor's gamertag (see msStart / msFinish).
      if (path === '/ms/start' && req.method === 'POST') return json(await msStart(env, url));
      if (path === '/ms/finish' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        return json(await msFinish(env, String(body?.code || ''), String(body?.ms || '')));
      }

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

      const role = await roleOf(env, ip, req.headers.get('X-Passphrase') || '');
      if (!role) return json({ error: 'passphrase' }, 401);
      const admin = role === 'admin';

      if (path === '/check') return json({ ok: true, role });

      // Anyone who may write can hand out the view-only invite link.
      if (req.method === 'GET' && path === '/invite') return json({ link: `${url.origin}/#v=${encodeURIComponent(env.VIEW_KEY)}` });

      // The owner's list of write links: one per person, each can be stopped on its own.
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
      if (path === '/live' && admin) {
        const text = await req.text();
        if (text.length > 900 * 1024) return json({ error: 'too big' }, 413);
        try { JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
        await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
          .bind('live', text, Date.now()).run();
        return json({ ok: true });
      }

      if (path === '/items') {
        const body = await req.json().catch(() => null);
        const list = Array.isArray(body?.items) ? body.items : null;
        if (!list || list.length > MAX_BATCH) return json({ error: 'bad request' }, 400);
        const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first()).n;
        const now = Date.now();
        const stmts = [];
        let added = 0;
        for (const [i, it] of list.entries()) {
          if (typeof it?.id !== 'string' || !/^[\w-]{1,40}$/.test(it.id) || typeof it.data !== 'object' || !it.data) {
            return json({ error: 'bad item' }, 400);
          }
          const data = JSON.stringify({ ...it.data, id: it.id });
          if (data.length > MAX_ITEM_BYTES) return json({ error: 'too big' }, 413);
          if (!it.deleted) added++;
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
  const page = url.searchParams.get('p') === 'a' ? 'a' : 't';
  await env.DB.prepare('DELETE FROM ms_sessions WHERE created < ?').bind(Date.now() - MS_SESSION_MS).run();
  await env.DB.prepare('INSERT INTO ms_sessions (id, verifier, created) VALUES (?1, ?2, ?3)').bind(session, verifier, Date.now()).run();
  const q = new URLSearchParams({
    client_id: env.MS_CLIENT_ID, response_type: 'code', redirect_uri: env.MS_RELAY, scope: 'XboxLive.signin',
    code_challenge: b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier))), code_challenge_method: 'S256',
    state: `${url.host}~${session}~${page}`, prompt: 'select_account',
  });
  return { url: `${MS}/authorize?${q}` };
}

async function msFinish(env, code, session) {
  if (!/^[0-9a-f]{32}$/.test(session) || !code) return { error: 'bad request' };
  const row = await env.DB.prepare('SELECT verifier, created FROM ms_sessions WHERE id = ?').bind(session).first();
  await env.DB.prepare('DELETE FROM ms_sessions WHERE id = ?').bind(session).run();
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
    if (!who.gtg) return { error: 'no gamertag', step: 'claims' };
    const live = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('live').first();
    const names = (JSON.parse(live?.v || '{}').members || []).map((m) => String(m.name || '').toLowerCase());
    return { gamertag: who.gtg, member: names.includes(String(who.gtg).toLowerCase()) };
  } catch (e) {
    return { error: 'failed', ...(e.info || { step: 'other' }) };
  }
}

// A page to try the sign-in by hand: shows the gamertag that came back.
function msTestPage() {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Blockmap ログインの試し</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171c;color:#e8e6e3;
font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}.box{width:min(420px,calc(100vw - 32px));padding:24px;
border-radius:16px;background:#1f2229;border:1px solid #2e323b}h1{margin:0 0 8px;font-size:20px}p{color:#a7abb3;line-height:1.6;font-size:14px}
button{width:100%;height:44px;border:0;border-radius:10px;background:#3ecf8e;color:#06130d;font-weight:700;font-size:16px}#out{color:#e8e6e3;font-size:16px}</style>
</head><body><div class="box"><h1>Microsoft でログイン(試し)</h1><p>ログインして、ゲーマータグが分かるか確かめます。</p>
<button id="go">Microsoft でログイン</button><p id="out"></p></div><script>
const out = document.getElementById('out');
document.getElementById('go').onclick = async () => {
  out.textContent = '準備しています…';
  const r = await fetch('/api/ms/start?p=t', { method: 'POST' }).then((x) => x.json()).catch(() => null);
  if (r?.url) location.href = r.url; else out.textContent = '始められませんでした';
};
const h = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', '/ms-test');
if (h.get('mscode')) {
  out.textContent = 'ゲーマータグを確かめています…';
  fetch('/api/ms/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: h.get('mscode'), ms: h.get('ms') }) })
    .then((x) => x.json()).then((d) => {
      out.textContent = d.gamertag ? 'ゲーマータグ: ' + d.gamertag + ' / Realm のメンバー: ' + (d.member ? 'はい' : 'いいえ')
        : 'うまくいきませんでした(' + [d.step, d.status, d.error].filter(Boolean).join(' / ') + ')';
    }).catch(() => { out.textContent = '通信できませんでした'; });
}
</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
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

async function viewer(req, env) {
  if (!env.VIEW_KEY || !env.DATA_DIR) return false;
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`));
  return !!m && same(m[1], await cookieValue(env));
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

// Shown to anyone without the cookie. Opening an invite link lands here: the key after # never leaves
// the browser except to be swapped for the cookie.
function gatePage() {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Blockmap</title><link rel="icon" href="/favicon.svg">
<style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171c;color:#e8e6e3;
font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
.box{width:min(420px,calc(100vw - 32px));padding:24px;border-radius:16px;background:#1f2229;border:1px solid #2e323b}
h1{margin:0 0 8px;font-size:20px}p{margin:0 0 16px;color:#a7abb3;line-height:1.6;font-size:14px}
form{display:flex;gap:8px}input{flex:1;min-width:0;height:40px;padding:0 12px;border-radius:10px;border:1px solid #2e323b;
background:#15171c;color:inherit;font-size:16px}button{height:40px;padding:0 16px;border:0;border-radius:10px;background:#3ecf8e;
color:#06130d;font-weight:700;font-size:15px}#msg{margin:12px 0 0;min-height:1.6em;color:#ff8a86}
</style></head><body><div class="box"><h1>Blockmap</h1>
<p>この地図を見るには招待リンクが必要です。仲間からもらったリンクを開くか、ここに貼り付けてください。</p>
<form id="f"><input id="link" placeholder="招待リンク" autocomplete="off"><button>開く</button></form><p id="msg"></p></div>
<script>
const msg = document.getElementById('msg');
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
      // The map page takes a writer's passphrase from the address (#join=…) and keeps it on this device.
      history.replaceState(null, '', '/' + (found.write ? '#join=' + encodeURIComponent(found.key) : ''));
      location.reload();
      return;
    }
    msg.textContent = res.status === 401 ? 'このリンクは使えません。新しいリンクを仲間にもらってください' : 'うまくいきませんでした(' + res.status + ')';
  } catch { msg.textContent = '通信できませんでした。もう一度ためしてください'; }
}
document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); join(keyFrom(document.getElementById('link').value)); });
// A link opened here, or pasted into the address bar of this page (only the part after # changes then).
function fromAddress() {
  const found = keyFrom(location.hash);
  history.replaceState(null, '', '/');
  if (found) join(found);
}
addEventListener('hashchange', fromAddress);
fromAddress();
</script></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
