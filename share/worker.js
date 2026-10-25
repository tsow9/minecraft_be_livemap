// Shared pins, text and shapes for the map site.
// Anyone can read; writing needs the group's passphrase (the PASSPHRASE secret).
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_ITEMS = 10000;
const MAX_BATCH = 300;
const KEEP_DELETED_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 3600 * 1000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const fromSite = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': req.method === 'GET' ? '*' : (fromSite ? origin : allowed[0] || 'null'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Passphrase',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });

    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

      if (req.method === 'GET' && url.pathname === '/items') {
        const since = Number(url.searchParams.get('since')) || 0;
        const { results } = await env.DB.prepare('SELECT id, data, deleted, rev FROM items WHERE rev > ? ORDER BY rev LIMIT 5000')
          .bind(since).all();
        const items = results.map((r) => ({ id: r.id, data: JSON.parse(r.data), deleted: !!r.deleted, rev: r.rev }));
        return json({ items, rev: items.length ? items[items.length - 1].rev : since, now: Date.now() });
      }

      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (!fromSite) return json({ error: 'origin' }, 403);
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
      if (!(await passOk(req, env, ip))) return json({ error: 'passphrase' }, 401);

      if (url.pathname === '/check') return json({ ok: true });

      if (url.pathname === '/items') {
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

// Compares the passphrase without leaking timing, and locks an address out for an hour after 10 misses.
async function passOk(req, env, ip) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, since FROM fails WHERE ip = ?').bind(ip).first();
  if (row && row.count >= MAX_FAILS && now - row.since < FAIL_WINDOW_MS) return false;
  const given = req.headers.get('X-Passphrase') || '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, String(env.PASSPHRASE || '')].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const ok = !!env.PASSPHRASE && crypto.subtle.timingSafeEqual(a, b);
  if (ok) {
    if (row) await env.DB.prepare('DELETE FROM fails WHERE ip = ?').bind(ip).run();
  } else {
    const fresh = !row || now - row.since >= FAIL_WINDOW_MS;
    await env.DB.prepare('INSERT INTO fails (ip, count, since) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET count = ?2, since = ?3')
      .bind(ip, fresh ? 1 : row.count + 1, fresh ? now : row.since).run();
  }
  return ok;
}
