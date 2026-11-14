// "Find a map": a Chizuya map site's address from its maker's GitHub username (or a repository link). Each Chizuya copy
// notes its site's exact address on its "site-info" branch (site.json) when it publishes the site; this page reads those
// from GitHub. Nothing is sent anywhere else, and nothing is kept.
(() => {
  const ja = () => document.documentElement.lang !== 'en';
  const T = (j, e) => (ja() ? j : e);
  const SITE = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/;
  // "tsow9", "@tsow9", "github.com/tsow9", "https://github.com/tsow9/chizuya" → [owner, repo or ''].
  const parse = (text) => {
    const m = String(text || '').trim().replace(/\.git$/, '').replace(/^@/, '')
      .match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]{1,39})(?:\/([\w.-]{1,100}))?\/?$/);
    return m ? [m[1], m[2] || ''] : null;
  };
  const siteOf = async (owner, repo) => {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/site-info/site.json`, { cache: 'no-store' });
      if (!res.ok) return '';
      const url = String((await res.json())?.url || '').replace(/\/$/, '');
      return SITE.test(url) ? url : '';
    } catch { return ''; }
  };
  async function repos(owner) {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&page=${page}&sort=updated`);
      if (res.status === 404) throw new Error('user');
      if (!res.ok) throw new Error(res.headers.get('x-ratelimit-remaining') === '0' ? 'limit' : 'github');
      const list = await res.json();
      out.push(...list.filter((r) => !r.private).map((r) => r.name));
      if (list.length < 100) break;
    }
    return out;
  }
  for (const form of document.querySelectorAll('.find-form')) {
    const box = form.closest('section');
    const msg = box.querySelector('.find-msg'), table = box.querySelector('.find-out'), body = table.querySelector('tbody');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = parse(form.q.value);
      body.textContent = '';
      table.hidden = true;
      if (!q) { msg.textContent = T('GitHub のユーザー名か、リポジトリのリンクを入れてください', 'Enter a GitHub username or a repository link'); return; }
      const [owner, one] = q;
      const button = form.querySelector('button');
      button.disabled = true;
      msg.textContent = T('探しています…', 'Looking…');
      let found = [];
      try {
        const names = one ? [one] : await repos(owner);
        // A few at a time.
        for (let i = 0; i < names.length; i += 8) {
          const part = names.slice(i, i + 8);
          const urls = await Promise.all(part.map((n) => siteOf(owner, n)));
          part.forEach((n, j) => { if (urls[j]) found.push([n, urls[j]]); });
        }
        msg.textContent = found.length ? T(`${found.length} 件見つかりました`, `Found ${found.length}`)
          : T('Chizuya の地図サイトは見つかりませんでした。名前が合っているか確かめてください', 'No Chizuya map site was found. Check the name');
      } catch (err) {
        msg.textContent = err.message === 'user' ? T('そのユーザーは GitHub に見つかりませんでした', 'No such user on GitHub')
          : err.message === 'limit' ? T('GitHub への問い合わせが多すぎました。しばらく(最大1時間)してから、もう一度ためしてください', 'Too many lookups at GitHub. Please try again later (within an hour)')
          : T('GitHub に問い合わせられませんでした。もう一度ためしてください', 'Could not reach GitHub. Please try again');
      }
      button.disabled = false;
      for (const [name, url] of found) {
        const tr = document.createElement('tr');
        const a = document.createElement('td'); a.textContent = name;
        const b = document.createElement('td'); b.className = 'm'; b.textContent = url.replace(/^https:\/\//, '');
        const c = document.createElement('td'); c.className = 'acts';
        const open = document.createElement('a'); open.href = url; open.target = '_blank'; open.rel = 'noopener'; open.textContent = T('開く', 'Open');
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = T('コピー', 'Copy');
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); copy.textContent = T('コピーしました', 'Copied'); } catch { /* not allowed */ }
        });
        c.append(open, copy);
        tr.append(a, b, c);
        body.append(tr);
      }
      table.hidden = !found.length;
    });
  }
})();
