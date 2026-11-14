// The whole map site on Cloudflare: the site's files, the map data, and the shared pins.
//
// People sign in with Microsoft. Realm members may look; the site's owner (the account the map uses, which set the
// site up) may also choose which members may write. Once someone is in, the page is handed the name of the folder
// the map data sits in (DATA_DIR, a long random name), so the map pictures can be served as plain files (free and
// unlimited) without checking each one.
// The owner's passphrase (PASSPHRASE) is what the live check uses to put in player data.
//
// What is stored in chests and who owns which pet (items.json) sits in another hidden folder (ITEMS_DIR) that pages are
// never told: it goes out through /api/world, where the owner's privacy switches take out what nobody may see.
//
// Secrets: DATA_DIR, ITEMS_DIR, PASSPHRASE, MEMBER_KEY (checks a sign-in against the members' ids).
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_ITEMS = 10000;
const MAX_BATCH = 300;
const KEEP_DELETED_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 3600 * 1000;
const SESSION = 'bms';          // signed in with Microsoft
const COOKIE_DAYS = 400;
const USED_EVERY_MS = 3600 * 1000;  // how often "last seen" is brought up to date

export default {
  // The timer (wrangler.template.toml): starts the repository's live check, which also redraws the map hourly.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(startLiveCheck(env, { skipBusy: true }));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
    });
    const cookie = (name, value, days) => `${name}=${value}; Max-Age=${days * 86400}; Path=/; Secure; HttpOnly; SameSite=Lax`;
    try {
      // How setting up is getting on, for the setup page (another site, hence open to any page). Nothing secret:
      // the stage, the sign-in code while it is shown (also in the public run log), and links to the run.
      if (url.pathname === '/api/setup' && req.method === 'GET') {
        const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('setup').first();
        const t = await kvGet(env, 'timer');
        // Someone is watching the setup page: the runs may start a new sign-in code at once (tools/auto_signin.sh).
        const seen = await kvGet(env, 'setup_seen');
        if (!(Date.now() - (seen || 0) < 30000)) await kvPut(env, 'setup_seen', Date.now());
        const pend = await kvGet(env, 'timer_pending');
        return json({ ...(row ? JSON.parse(row.v) : {}), timer: timerWorks(env, t), app: appSlug(env), rid: env.GH_REPO_ID || null, pending: !!(pend?.token && pend.until > Date.now()) },
          200, { 'Access-Control-Allow-Origin': '*' });
      }
      // Setting up the timer from the setup page, before anyone can sign in to the site: only while no working timer
      // is set, and a token is kept only if it really can start this repository's runs (so only someone who may run
      // them can set it). Plain text bodies, so the setup page needs no preflight.
      if (/^\/api\/setup\/timer\/(connect|poll|retry)$/.test(url.pathname) && req.method === 'POST') {
        const open = { 'Access-Control-Allow-Origin': '*' };
        if (timerWorks(env, await kvGet(env, 'timer'))) return json({ error: 'set' }, 409, open);
        if (url.pathname.endsWith('/connect')) return json(...(await timerConnect(env)), open);
        if (url.pathname.endsWith('/retry')) return json(await timerRetry(env), 200, open);
        let handle = '';
        try { handle = String(JSON.parse(await req.text())?.handle || ''); } catch { /* not JSON */ }
        return json(await timerPoll(env, handle), 200, open);
      }
      // The language and time zone of the runs' messages and the map's dates, from the setup page's browser (only
      // until the admin's own map page sets them, below). Nothing but a language code and a zone name.
      if (url.pathname === '/api/setup/prefs' && req.method === 'POST') {
        const open = { 'Access-Control-Allow-Origin': '*' };
        let b = null;
        try { b = JSON.parse(await req.text()); } catch { /* not JSON */ }
        const cur = await kvGet(env, 'prefs');
        if (cur?.by === 'admin') return json({ ok: true }, 200, open);
        const p = cleanPrefs(b);
        if (p) await kvPut(env, 'prefs', { ...p, by: 'setup' });
        return json({ ok: !!p }, 200, open);
      }
      // The owner picks which of their Realms to map (only while the sign-in is asking, and only one it offered).
      // Sent as plain text, so the setup page needs no preflight.
      if (url.pathname === '/api/setup/pick' && req.method === 'POST') {
        const open = { 'Access-Control-Allow-Origin': '*' };
        const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('setup').first();
        const cur = row ? JSON.parse(row.v) : {};
        let name = '';
        try { name = String(JSON.parse(await req.text())?.name || ''); } catch { /* not JSON */ }
        if (cur.state !== 'pick-realm' || !Array.isArray(cur.realms) || !cur.realms.includes(name)) return json({ error: 'bad' }, 400, open);
        const at = Date.now();
        const put = (k, v) => env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3').bind(k, v, at).run();
        await put('realm_pick', name);
        await put('setup', JSON.stringify({ state: 'picked', pick: name, at, r: cur.r, log: cur.log }));
        return json({ ok: true }, 200, open);
      }
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      // The live check's latest data (who the members are, where players are): read once per request at most.
      let liveP = null;
      const live = () => (liveP ??= readLive(env));
      const me = await whoIs(req, env, ip, live);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!me) return gatePage(env);
        const page = await env.ASSETS.fetch(new Request(new URL('/index.html', url)));
        // The Realm's worlds (tools/worlds.py), when it has had more than one: the page opens on the one played.
        const w = await env.ASSETS.fetch(new Request(new URL(`/d/${env.DATA_DIR}/worlds.json`, url)));
        const worlds = w.ok ? await w.text().catch(() => '') : '';
        const extra = /^\{[\s\S]{0,20000}\}$/.test(worlds.trim()) ? `window.BLOCKMAP_WORLDS=${worlds.trim().replace(/</g, '\\u003c')};` : '';
        const html = (await page.text()).replace('<head>', () => `<head><script>window.BLOCKMAP_DATA=${JSON.stringify(`/d/${env.DATA_DIR}/`)};${extra}</script>`);
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      }
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
      const path = url.pathname.slice(4);

      // Signing in with Microsoft (open to anyone: only Realm members get through).
      if (path === '/ms/start' && req.method === 'POST') return json(await msStart(env, url));
      if (path === '/ms/finish' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const r = await msFinish(env, String(body?.code || ''), String(body?.ms || ''), live);
        if (!r.session) return json(r, r.error === 'not member' ? 403 : r.error === 'not ready' ? 503 : 400);
        return json({ ok: true, name: r.name }, 200, { 'Set-Cookie': cookie(SESSION, r.session, COOKIE_DAYS) });
      }
      if (path === '/logout' && req.method === 'POST') {
        const token = cookies(req)[SESSION];
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha(token)).run();
        return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax` });
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

      // What is in the world's chests, its villagers, signs and pets (items.json), less what the owner hides (from everyone,
      // the owner too).
      if (req.method === 'GET' && path === '/world') {
        if (!env.ITEMS_DIR) return json({ error: 'none' }, 404);
        // ?w=<slot>: another of the Realm's worlds (tools/worlds.py), kept in worlds/<slot>/.
        const w = url.searchParams.get('w');
        const sub = /^\d{1,2}$/.test(w || '') ? `worlds/${w}/` : '';
        const file = await env.ASSETS.fetch(new Request(new URL(`/x/${env.ITEMS_DIR}/${sub}items.json`, url)));
        if (!file.ok) return json({ error: 'none' }, 404);
        const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        const hide = await privacy(env);
        if (!hide.chests && !hide.pets) return new Response(file.body, { headers });
        return new Response(JSON.stringify(hideFrom((await live()).data, await file.json(), hide, me.xid)), { headers });
      }
      // The Realm's payment day and price, which the owner types in (the Realms API's own date is not reliable).
      // Everyone sees them in Realms情報.
      if (req.method === 'GET' && path === '/settings') return json(await settings(env));
      if (path === '/settings' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const next = cleanSettings(body);
        await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
          .bind('settings', JSON.stringify(next), Date.now()).run();
        return json(next);
      }
      // Chizuya's own version: the newest release (told by the live check) and an update the owner asked for.
      if (path === '/release' && admin && me.via === 'microsoft' && req.method === 'GET') {
        return json({ release: await kvGet(env, 'release'), update: await kvGet(env, 'update') });
      }
      if (path === '/update' && admin && me.via === 'microsoft' && req.method === 'POST') {
        const rel = await kvGet(env, 'release');
        if (!rel?.latest || !newer(rel.latest, rel.current)) return json({ error: 'up to date' }, 400);
        const v = { state: 'requested', version: rel.latest, at: Date.now() };
        await kvPut(env, 'update', v);
        return json(v);
      }
      // The admin's page says its language and time zone: the runs' messages and the map's dates follow them.
      if (path === '/prefs' && admin && me.via === 'microsoft' && req.method === 'POST') {
        const p = cleanPrefs(await req.json().catch(() => null));
        if (p) await kvPut(env, 'prefs', { ...p, by: 'admin' });
        return json({ ok: !!p });
      }
      // The timer's GitHub token (admin only): saved, never shown again; the page sees only whether it works.
      if (path === '/timer' && admin && me.via === 'microsoft' && req.method === 'GET') {
        const t = await kvGet(env, 'timer');
        return json({ repo: env.GH_REPO || '', set: !!t?.token, ok: t?.token ? timerWorks(env, t) : null, last: t?.last || null, status: t?.status || null,
          app: appSlug(env), via: t?.via || null });
      }
      // Connecting the Chizuya Connect GitHub App with a code (GitHub's device flow: the site needs no secret).
      if (path === '/timer/connect' && admin && me.via === 'microsoft' && req.method === 'POST') return json(...(await timerConnect(env)));
      if (path === '/timer/retry' && admin && me.via === 'microsoft' && req.method === 'POST') return json(await timerRetry(env));
      if (path === '/timer/poll' && admin && me.via === 'microsoft' && req.method === 'POST') {
        const b = await req.json().catch(() => null);
        return json(await timerPoll(env, String(b?.handle || '')));
      }
      if (path === '/timer' && admin && me.via === 'microsoft' && req.method === 'POST') {
        const b = await req.json().catch(() => null);
        const token = String(b?.token || '').trim();
        if (b?.clear) { await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('timer').run(); return json({ ok: true }); }
        if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/.test(token)) return json({ error: 'bad token' }, 400);
        await kvPut(env, 'timer', { token });
        const r = await startLiveCheck(env);  // tried at once, so the admin sees whether it works
        return json({ ok: r === 204, status: r });
      }
      if (path === '/privacy' && admin && req.method === 'GET') return json(await privacy(env));
      if (path === '/privacy' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const hide = { ...(await privacy(env)) };
        for (const k of ['chests', 'pets']) if (typeof body?.[k] === 'boolean') hide[k] = body[k];
        await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
          .bind('privacy', JSON.stringify(hide), Date.now()).run();
        return json(hide);
      }

      // Latest player data, put here by the live check so pages can look every few seconds.
      if (req.method === 'GET' && path === '/live') {
        const since = Number(url.searchParams.get('since')) || 0;
        const row = await live();
        if (!row.v) return json({ error: 'none' }, 404);
        if (row.at <= since) return json({ unchanged: true, at: row.at });
        return new Response(`{"at":${row.at},"live":${row.v}}`, {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      // The owner's list of members, and who of them may write (nobody until the owner says so).
      if (path === '/access' && admin && req.method === 'GET') {
        const info = liveInfo((await live()).data);
        const { results } = await env.DB.prepare('SELECT xid, write FROM access').all();
        const may = new Map(results.map((r) => [r.xid, !!r.write]));
        return json({ owner: info.ownerName, members: info.members.filter((m) => m.xid !== info.ownerXid)
          .map((m) => ({ xid: m.xid, name: m.name, write: !!may.get(m.xid) }))
          // Always by name, so the list does not move around when someone joins or leaves the game.
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja', { sensitivity: 'base' }) || a.xid.localeCompare(b.xid)) });
      }
      if (path === '/access' && admin && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const xid = String(body?.xid || '');
        if (!/^[0-9a-f]{32}$/.test(xid)) return json({ error: 'bad request' }, 400);
        await env.DB.prepare('INSERT INTO access (xid, write, updated) VALUES (?1, ?2, ?3) ON CONFLICT(xid) DO UPDATE SET write = ?2, updated = ?3')
          .bind(xid, body?.write ? 1 : 0, Date.now()).run();
        return json({ ok: true });
      }

      if (req.method !== 'POST') return json({ error: 'not found' }, 404);

      // Only the live check (with the passphrase) puts in player data.
      // The runs say how setting up is getting on (tools/setup_status.sh).
      if (path === '/setup' && req.method === 'POST' && admin && me.via === 'key') {
        const b = await req.json().catch(() => null);
        const str = (v, re) => (typeof v === 'string' && v.length <= 300 && re.test(v) ? v : undefined);
        const state = str(b?.state, /^(starting|code|pick-realm|signed-in|downloading|drawing|publishing|done|login-failed|map-failed)$/);
        if (!state) return json({ error: 'bad' }, 400);
        // Once the site is made, later map updates do not turn the setup page back to "making the map": only a new
        // sign-in starts the story again.
        const was = await kvGet(env, 'setup');
        if (was?.state === 'done' && !['starting', 'code', 'pick-realm', 'login-failed'].includes(state)) return json({ ok: true, kept: 'done' });
        const v = {
          state, at: Date.now(), r: str(b.r, /^[0-9a-f]{16}$/),
          detail: str(b.detail, /^[a-z]{1,12}$/),
          // The owner's Realms to pick from (shown on the setup page until one is picked).
          realms: state === 'pick-realm' && Array.isArray(b.realms)
            ? b.realms.filter((n) => typeof n === 'string' && n && n.length <= 100 && !/[\u0000-\u001f]/.test(n)).slice(0, 10) : undefined,
          code: str(b.code, /^[A-Z0-9-]{4,20}$/), uri: str(b.uri, /^https:\/\/[\w./-]+$/),
          expires: Number.isFinite(b.expires) ? b.expires : undefined,
          url: str(b.url, /^https:\/\/[\w.-]+\.workers\.dev\/?$/), log: str(b.log, /^https:\/\/github\.com\/[\w./-]+$/),
        };
        await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
          .bind('setup', JSON.stringify(v), v.at).run();
        return json({ ok: true });
      }
      // The live check: the newest release, and whether the owner asked for it (then it starts the update).
      if (path === '/release' && req.method === 'POST' && admin && me.via === 'key') {
        const b = await req.json().catch(() => null);
        const ver = (v) => (typeof v === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) ? v : null);
        const rel = { current: ver(b?.current), latest: ver(b?.latest), at: Date.now(),
          url: typeof b?.url === 'string' && /^https:\/\/github\.com\/[\w./-]+$/.test(b.url) ? b.url : null };
        await kvPut(env, 'release', rel);
        const up = await kvGet(env, 'update');
        let start = false;
        if (up?.state === 'requested') { start = true; await kvPut(env, 'update', { ...up, state: 'started', at: Date.now() }); }
        // Done once this version runs (or given up after a day, so the owner can press again).
        else if (up && (up.state === 'started' || up.state === 'updating') && (rel.current === up.version || Date.now() - up.at > 86400000)) {
          await kvPut(env, 'update', { ...up, state: rel.current === up.version ? 'done' : 'failed', at: Date.now() });
        }
        return json({ start });
      }
      if (path === '/update/state' && req.method === 'POST' && admin && me.via === 'key') {
        const b = await req.json().catch(() => null);
        if (!['updating', 'done', 'failed'].includes(b?.state)) return json({ error: 'bad' }, 400);
        const up = (await kvGet(env, 'update')) || {};
        await kvPut(env, 'update', { ...up, state: b.state, at: Date.now() });
        return json({ ok: true });
      }
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

async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

// ---------- Microsoft sign-in → gamertag ----------
// One app (MS_CLIENT_ID, registered once for every Chizuya site) signs people in; the sign-in comes back to a shared
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
    // No prompt: someone Microsoft already knows on this device goes straight through, without picking an account.
    state: `${url.host}~${session}~${page}`,
  });
  return { url: `${MS}/authorize?${q}` };
}

async function msFinish(env, code, signIn, live) {
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
    const info = liveInfo((await live()).data);
    // A new site before its first live check: nobody can be told apart yet (not even its owner).
    if (!info.ownerXid && !info.members.length) return { error: 'not ready', gamertag: who.gtg };
    if (xid !== info.ownerXid && !info.members.some((m) => m.xid === xid)) return { error: 'not member', gamertag: who.gtg };
    const session = randomHex(32), now = Date.now();
    // Sign-ins unused for as long as the cookie lasts are gone for good.
    await env.DB.prepare('DELETE FROM sessions WHERE COALESCE(seen, created) < ?').bind(now - COOKIE_DAYS * 86400 * 1000).run();
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

// { v: the text as stored, at: when it came, data: the same read in }; v is null before the first check.
async function readLive(env) {
  const row = await env.DB.prepare('SELECT v, at FROM kv WHERE k = ?').bind('live').first();
  let data = {};
  try { data = JSON.parse(row?.v || '{}') || {}; } catch { /* none yet */ }
  return { v: row?.v || null, at: row?.at || 0, data };
}

async function kvGet(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  try { return row ? JSON.parse(row.v) : null; } catch { return null; }
}
async function kvPut(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3')
    .bind(k, JSON.stringify(v), Date.now()).run();
}
// A timer that works for this repository (not one left from an older repository of the same name, whose site and
// database a new one takes over).
const timerWorks = (env, t) => !!t?.ok && (!/^\d+$/.test(env.GH_REPO_ID || '') || t.rid === env.GH_REPO_ID);
const appSlug = (env) => (env.GH_APP_SLUG && env.GH_APP_CLIENT_ID ? env.GH_APP_SLUG : null);
// Start: a code to enter at github.com/login/device. The page keeps GitHub's device code (its own request's) and asks
// with it every few seconds; the token itself stays here. Returns [body, status].
async function timerConnect(env) {
  if (!env.GH_APP_CLIENT_ID) return [{ error: 'no app' }, 400];
  const r = await ghForm('https://github.com/login/device/code', { client_id: env.GH_APP_CLIENT_ID });
  if (!r?.device_code) return [{ error: 'github' }, 502];
  return [{ user_code: r.user_code, uri: r.verification_uri, interval: r.interval || 5, expires_in: r.expires_in || 900, handle: r.device_code }, 200];
}
// Approved yet? Once it is, the token is kept only if it starts this repository's live check (which it does at once);
// otherwise most likely the app is not on the repository yet.
async function timerPoll(env, handle) {
  if (!env.GH_APP_CLIENT_ID || !/^[\w-]{10,100}$/.test(handle)) return { error: 'bad' };
  const r = await ghForm('https://github.com/login/oauth/access_token', {
    client_id: env.GH_APP_CLIENT_ID, device_code: handle, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  if (r?.error === 'authorization_pending' || r?.error === 'slow_down') return { pending: true, interval: r.interval || null };
  if (!r?.access_token) return { error: r?.error || 'github' };
  const t = { token: r.access_token, via: 'app', refresh: r.refresh_token || null, expires: r.expires_in ? Date.now() + r.expires_in * 1000 : null };
  return useTimer(env, t);
}
// The approved token starts this repository's live check: kept as the timer. Not yet (the app is not on the
// repository): kept aside for a while, and tried again (timerRetry) once the app has been added.
async function useTimer(env, t) {
  const status = await dispatchLive(env, t.token);
  if (status === 204) {
    await kvPut(env, 'timer', { ...t, ok: true, status, last: Date.now(), rid: env.GH_REPO_ID || null });
    await env.DB.prepare('DELETE FROM kv WHERE k = ?').bind('timer_pending').run();
    return { ok: true };
  }
  if (status === 404 || status === 403) {
    await kvPut(env, 'timer_pending', { ...t, until: Date.now() + 30 * 60000 });
    return { error: 'not-installed', status };
  }
  return { error: 'github', status };
}
async function timerRetry(env) {
  const p = await kvGet(env, 'timer_pending');
  if (!p?.token || p.until < Date.now()) return { error: 'expired' };
  const { until, ...t } = p;
  return useTimer(env, t);
}
async function dispatchLive(env, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GH_REPO || '')) return 0;
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/live.yml/dispatches`, {
      method: 'POST', body: JSON.stringify({ ref: 'main' }),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Chizuya', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    return res.status;
  } catch { return 0; }
}
// A form post to GitHub's sign-in endpoints, answered in JSON.
async function ghForm(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams(body),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Chizuya' } });
    return await res.json();
  } catch { return null; }
}

// Starts the repository's live check (GitHub's workflow_dispatch) with the admin's token; remembers how it went.
async function startLiveCheck(env, { skipBusy = false } = {}) {
  let t = await kvGet(env, 'timer');
  // A token from the GitHub App that expires (if the app's tokens expire): renewed with its refresh token first.
  if (t?.via === 'app' && t.refresh && t.expires && t.expires - Date.now() < 10 * 60000 && env.GH_APP_CLIENT_ID) {
    const r = await ghForm('https://github.com/login/oauth/access_token', { client_id: env.GH_APP_CLIENT_ID, grant_type: 'refresh_token', refresh_token: t.refresh });
    if (r?.access_token) {
      t = { ...t, token: r.access_token, refresh: r.refresh_token || t.refresh, expires: r.expires_in ? Date.now() + r.expires_in * 1000 : null };
      await kvPut(env, 'timer', t);
    }
  }
  if (!t?.token || !/^[\w.-]+\/[\w.-]+$/.test(env.GH_REPO || '')) return null;
  // Every minute from the timer: not while a live check is still running or waiting to start (it keeps looking every
  // 20 seconds while someone plays, and hands over to the next itself), so runs do not pile up.
  if (skipBusy && t.ok) {
    try {
      const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/live.yml/runs?per_page=5`, {
        headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Chizuya', 'X-GitHub-Api-Version': '2022-11-28' } });
      const runs = res.ok ? (await res.json()).workflow_runs || [] : [];
      if (runs.some((r) => r.status !== 'completed')) return 'busy';
    } catch { /* look anyway */ }
  }
  const status = await dispatchLive(env, t.token);
  // It worked for this very repository: noted with its id (see timerWorks).
  await kvPut(env, 'timer', { ...t, ok: status === 204, status, last: Date.now(), rid: status === 204 ? env.GH_REPO_ID || null : t.rid || null });
  return status;
}

function cleanPrefs(b) {
  const lang = b?.lang === 'en' || b?.lang === 'ja' ? b.lang : null;
  const tz = typeof b?.tz === 'string' && /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(b.tz) && b.tz.length <= 40 ? b.tz : null;
  return lang && tz ? { lang, tz } : null;
}
// "1.10.0" is newer than "1.9.2".
function newer(a, b) {
  const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function liveInfo(live) {
  const members = (Array.isArray(live.members) ? live.members : []).filter((m) => m && typeof m.xid === 'string')
    .map((m) => ({ xid: m.xid, name: String(m.name || '') }));
  return { members, ownerXid: live.realm?.ownerXid || null, ownerName: live.realm?.owner || null };
}

// The owner's privacy switches: chests hides every chest; pets hides the pets other players own. They hold for everyone.
async function privacy(env) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('privacy').first();
  let v = {};
  try { v = JSON.parse(row?.v || '{}'); } catch { /* not set */ }
  return { chests: v.chests === true, pets: v.pets === true };
}

async function settings(env) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('settings').first();
  let v = {};
  try { v = JSON.parse(row?.v || '{}') || {}; } catch { /* not set */ }
  return cleanSettings(v);
}

// { billingDay: 1–31 or null, price: a number or null, currency: 'JPY', 'USD', … }. A price once kept as text
// ("930円") is read as yen.
function cleanSettings(v) {
  const day = Number(v?.billingDay);
  let price = v?.price, currency = typeof v?.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) ? v.currency : null;
  if (typeof price === 'string') {
    const n = parseFloat(price.replace(/[^\d.]/g, ''));
    if (!currency && /円|¥|￥/.test(price)) currency = 'JPY';
    price = n;
  }
  price = Number(price);
  return {
    billingDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
    price: Number.isFinite(price) && price > 0 && price < 1e7 ? Math.round(price * 100) / 100 : null,
    currency: currency || 'JPY',
  };
}

// items.json as this person may see it. Pets nobody owns stay; a pet stays for its owner (the world's player records the
// live check linked to this member).
function hideFrom(live, items, hide, xid) {
  let mine = new Set();
  if (hide.pets) {
    const id = (live.members || []).find((m) => m && m.xid === xid)?.id;
    if (id) mine = new Set((live.players || []).filter((p) => p && p.member === id).map((p) => p.key));
  }
  for (const d of Object.values(items.dims || {})) {
    if (hide.chests) d.containers = [];
    // [x, y, z, kind, name, tamed, owner, variant]
    if (hide.pets) d.animals = (d.animals || []).filter((a) => !a[6] || mine.has(a[6]));
  }
  items.hidden = Object.keys(hide).filter((k) => hide[k]);
  return items;
}

// { role: 'admin' | 'writer' | 'viewer', name, xid, via } for whoever is asking, or null.
// Signed in with Microsoft: the site's owner is the admin; members the owner allowed may write; other members look.
// Someone no longer in the Realm is let in no more.
async function whoIs(req, env, ip, live) {
  // The live check puts in player data with the owner's passphrase.
  const pass = req.headers.get('X-Passphrase') || '';
  if (pass && (await keyOk(env, ip, pass, [env.PASSPHRASE]))) return { role: 'admin', name: null, xid: null, via: 'key' };
  const jar = cookies(req);
  if (jar[SESSION] && /^[0-9a-f]{64}$/.test(jar[SESSION])) {
    const id = await sha(jar[SESSION]);
    const row = await env.DB.prepare('SELECT xid, name, seen FROM sessions WHERE token = ?').bind(id).first();
    if (row) {
      const info = liveInfo((await live()).data);
      const member = info.members.find((m) => m.xid === row.xid);
      const owner = row.xid === info.ownerXid;
      if (owner || member) {
        if (!row.seen || Date.now() - row.seen > USED_EVERY_MS) await env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(Date.now(), id).run();
        const may = owner ? null : await env.DB.prepare('SELECT write FROM access WHERE xid = ?').bind(row.xid).first();
        return { role: owner ? 'admin' : may?.write ? 'writer' : 'viewer', name: (owner ? info.ownerName : member.name) || row.name, xid: row.xid, via: 'microsoft' };
      }
    }
  }
  return null;
}

function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Checks a key without leaking timing, and locks an address out for an hour after 10 misses.
async function keyOk(env, ip, given, keys) {
  if (!given) return false;
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, since FROM fails WHERE ip = ?').bind(ip).first();
  if (row && row.count >= MAX_FAILS && now - row.since < FAIL_WINDOW_MS) return false;
  let ok = false;
  for (const k of keys) if (k && (await same(given, String(k)))) ok = true;
  if (ok) {
    if (row) await env.DB.prepare('DELETE FROM fails WHERE ip = ?').bind(ip).run();
  } else {
    const fresh = !row || now - row.since >= FAIL_WINDOW_MS;
    await env.DB.prepare('INSERT INTO fails (ip, count, since) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET count = ?2, since = ?3')
      .bind(ip, fresh ? 1 : row.count + 1, fresh ? now : row.since).run();
  }
  return ok;
}

// Shown to anyone not let in yet: sign in with Microsoft (the Realm's members get in). A sign-in comes back here
// (#mscode=…).
function gatePage(env) {
  // The privacy policy and terms sit next to the sign-in relay page.
  const legal = String(env.MS_RELAY || '').replace(/login\.html$/, '');
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no,email=no,address=no">
<meta name="robots" content="noindex"><title>Chizuya</title><link rel="icon" href="/favicon.svg?v=10">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700&display=swap">
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f1;color:#211a16;
font-family:"M PLUS Rounded 1c",system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
button{font:inherit}
.box{width:min(420px,calc(100vw - 32px));padding:24px;border-radius:6px;background:#fff;border:1px solid #dcdbd6}
h1{margin:0 0 12px;font-size:20px}p{margin:0 0 16px;color:#5a5c5f;line-height:1.6;font-size:14px}
#ms{width:100%;height:46px;border:0;border-radius:4px;background:#4a4542;color:#fff;font-weight:700;font-size:16px;cursor:pointer}
#msg{margin:12px 0 0;min-height:1.6em;color:#a33a2e}
.legal{margin:16px 0 0;font-size:12px;color:#75777b;text-align:center}.legal a{color:#75777b}
</style></head><body><div class="box"><h1><img src="/logo.png" alt="Chizuya" style="height:36px;width:auto;display:block"></h1>
<div id="start"><p id="intro"></p>
<button id="ms"></button></div><p id="msg"></p>
<p class="legal"><a id="privacy" href="${legal}privacy.html" target="_blank" rel="noopener"></a> · <a id="terms" href="${legal}terms.html" target="_blank" rel="noopener"></a></p>
</div>
<script>
// Japanese or English, the same choice as the map (js/i18n.js): the viewer's pick, else the browser's language.
let saved = null;
try { saved = localStorage.getItem('blockmap.lang'); } catch { /* private mode */ }
const ja = saved ? saved === 'ja' : /^ja(-|$)/i.test(navigator.language || '');
document.documentElement.lang = ja ? 'ja' : 'en';
const T = ja ? {
  intro: 'Realm のメンバーだけが見られる地図です。マイクラで使っている Microsoft アカウントでログインしてください。',
  button: 'Microsoft でログイン', cantStart: 'ログインを始められませんでした。もう一度ためしてください',
  checking: 'ゲーマータグを確かめています…', done: 'ログインできました。地図を開いています…',
  notMember: (g) => 'このアカウント(' + g + ')は、この Realm のメンバーではありません',
  notReady: 'このサイトは、まだメンバーの一覧を受け取っていません。数分後にもう一度ログインしてください。',
  expired: '時間がたちすぎました。もう一度ログインしてください', failed: 'ログインを確かめられませんでした',
  offline: '通信できませんでした。もう一度ためしてください',
} : {
  intro: 'Only members of the Realm can see this map. Sign in with the Microsoft account you play Minecraft with.',
  button: 'Sign in with Microsoft', cantStart: 'Could not start signing in. Please try again',
  checking: 'Checking your gamertag…', done: 'Signed in. Opening the map…',
  notMember: (g) => 'This account (' + g + ') is not a member of this Realm',
  notReady: 'This site has not received the member list yet. Please sign in again in a few minutes.',
  expired: 'That took too long. Please sign in again', failed: 'Could not check the sign-in',
  offline: 'No connection. Please try again',
};
document.getElementById('intro').textContent = T.intro;
document.getElementById('ms').textContent = T.button;
document.getElementById('privacy').textContent = ja ? 'プライバシーポリシー' : 'Privacy Policy';
document.getElementById('terms').textContent = ja ? '利用規約' : 'Terms of Use';
const msg = document.getElementById('msg');
document.getElementById('ms').onclick = async () => {
  msg.textContent = '';
  const r = await fetch('/api/ms/start', { method: 'POST' }).then((x) => x.json()).catch(() => null);
  if (r && r.url) location.href = r.url; else msg.textContent = T.cantStart;
};
// While a sign-in is being checked, only that is shown; the buttons come back if it does not work out.
function busy(on) {
  document.getElementById('start').hidden = on;
}
async function finish(code, ms) {
  busy(true);
  msg.style.color = '#a7abb3';
  msg.textContent = T.checking;
  try {
    const res = await fetch('/api/ms/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ms }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { msg.textContent = T.done; location.reload(); return; }
    busy(false);
    msg.style.color = '';
    msg.textContent = d.error === 'not member' ? T.notMember(d.gamertag)
      : d.error === 'not ready' ? T.notReady
      : d.error === 'expired' ? T.expired
      : T.failed + ' (' + [d.step, d.status, d.error].filter(Boolean).join(' / ') + ')';
  } catch { busy(false); msg.style.color = ''; msg.textContent = T.offline; }
}
function fromAddress() {
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', '/');
  if (h.get('mscode')) finish(h.get('mscode'), h.get('ms') || '');
}
addEventListener('hashchange', fromAddress);
fromAddress();
</script></body></html>`;
  return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
