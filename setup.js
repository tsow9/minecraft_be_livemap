'use strict';
// Setup: the steps on one page. Nothing is sent anywhere; the repository's link is kept in this browser. Step 4
// follows the runs of the
// repository's "Map site" workflow through GitHub's public API (the repository is public, so no sign-in is needed).
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'blockmap.setup';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ repo: saved.repo || '' })); } catch { /* private mode */ } };

  // ---- language: the map's choice, else the browser's ----
  let lang = null;
  try { lang = localStorage.getItem('blockmap.lang'); } catch { /* private mode */ }
  if (lang !== 'ja' && lang !== 'en') lang = /^ja(-|$)/i.test(navigator.language || '') ? 'ja' : 'en';
  const ja = new Map();  // the Japanese written in the page, to switch back
  const T = (j, e) => (lang === 'ja' ? j : e);
  function applyLang() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-en]')) {
      if (!ja.has(el)) ja.set(el, el.innerHTML);
      el.innerHTML = lang === 'en' ? el.dataset.en : ja.get(el);
    }
    $('#lang-now').textContent = lang === 'ja' ? '日本語' : 'English';
    for (const b of document.querySelectorAll('#lang-menu button')) b.classList.toggle('on', b.dataset.lang === lang);
    refresh();
    renderStatus();
  }
  const menu = (open) => { $('#lang-menu').hidden = !open; $('#lang').setAttribute('aria-expanded', String(open)); };
  $('#lang').addEventListener('click', (e) => { e.stopPropagation(); menu($('#lang-menu').hidden); });
  document.addEventListener('click', () => menu(false));
  for (const b of document.querySelectorAll('#lang-menu button')) {
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
      menu(false);
      applyLang();
    });
  }

  // ---- anonymous counts (GoatCounter): how far people get, each once per visit. Never the repository or any name. ----
  const counted = new Set();
  function count(what) {
    if (counted.has(what)) return;
    counted.add(what);
    const send = () => window.goatcounter?.count?.({ path: `setup/${what}`, title: what, event: true });
    if (window.goatcounter?.count) send(); else setTimeout(send, 3000);  // the counter loads after this script
  }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-count]'); if (a) count(a.dataset.count); });

  // ---- ⓘ buttons open their explanation ----
  for (const b of document.querySelectorAll('.info')) {
    b.addEventListener('click', () => { const box = document.getElementById(b.dataset.info); box.hidden = !box.hidden; });
  }

  // The token page with its permissions filled in (Cloudflare's template links).
  const perms = [{ key: 'workers_scripts', type: 'edit' }, { key: 'd1', type: 'edit' }, { key: 'account_settings', type: 'read' }];
  $('#token-link').href = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(perms))}`
    + `&accountId=*&zoneId=all&name=${encodeURIComponent('Blockmap')}`;

  // ---- the repository ----
  const repoOf = (text) => {
    const m = String(text || '').trim().replace(/\.git$/, '').match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/);
    return m ? `${m[1]}/${m[2]}` : '';
  };
  $('#repo').value = saved.repo ? `https://github.com/${saved.repo}` : '';
  $('#repo').addEventListener('input', () => {
    saved.repo = repoOf($('#repo').value); save(); refresh(); poll(true);
    if (saved.repo) count('repo-entered');
  });
  // The address the workflow gives a new site (tools/cloudflare.sh): blockmap.<GitHub owner>.workers.dev.
  const siteOf = (repo) => `https://blockmap.${repo.split('/')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')}.workers.dev`;

  function refresh() {
    const repo = saved.repo || '';
    for (const a of document.querySelectorAll('.repo-link')) {
      a.classList.toggle('off', !repo);
      if (repo) a.href = `https://github.com/${repo}${a.dataset.path}`; else a.removeAttribute('href');
    }
    $('#repo-hint').innerHTML = repo
      ? T(`<code>${repo}</code> を使います。手順 3〜5 のボタンが、このリポジトリを開きます。`, `Using <code>${repo}</code>. The buttons in steps 3–5 open it.`)
      : T('入れると、手順 3〜5 のボタンがそのリポジトリを直接開きます。', 'Once filled in, the buttons in steps 3–5 open it directly.');
    const site = siteUrl || (repo ? siteOf(repo) : '');
    $('#site-link').classList.toggle('off', !site);
    if (site) $('#site-link').href = site; else $('#site-link').removeAttribute('href');
    // The exact address once the site is published; until then (or for an older copy) the likely one.
    $('#site-hint').innerHTML = !site ? ''
      : siteUrl ? T(`サイトのアドレス:<code>${site}</code>`, `Your site: <code>${site}</code>`)
        : T(`サイトのアドレスは、おそらく <code>${site}</code> です。違う場合は、手順 4 の記録の Summary に正しいアドレスが表示されます。`,
          `Your site is most likely at <code>${site}</code>. If not, step 4's run shows the address in its Summary.`);
  }

  // ---- copy buttons ----
  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(T('コピーしました', 'Copied')); }
    catch { toast(T('コピーできませんでした', 'Could not copy')); }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.copy');
    if (!b) return;
    copy(b.dataset.text);
  });

  // ---- step 4: how the sign-in and the first map are getting on ----
  // Runs of "Map site" started by hand; a run's jobs say what it was (login, or update + cloudflare).
  let state = null;     // { kind, url } shown in #status
  let siteUrl = '';     // the site's exact address once it is published (site-info branch)
  async function getJSON(url, accept = 'application/vnd.github+json') {
    // no-cache: the browser asks again with the ETag, and GitHub's "unchanged" answers don't count against its limit.
    const res = await fetch(url, { cache: 'no-cache', headers: { Accept: accept } });
    if (!res.ok) {
      const err = new Error(String(res.status));
      if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        err.reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 15 * 60000;
      }
      throw err;
    }
    return res.json();
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // One question per look: the runs list. Runs started by hand or by the sign-in carry what they do as their title
  // (run-name: "Sign in to Realms", "Update map"), so no per-run questions are needed. GitHub answers about 60
  // questions an hour per browser without signing in; "unchanged" answers (ETag) do not count.
  let limited = 0;  // when GitHub's limit lifts (ms), while it is reached
  async function check() {
    const repo = saved.repo;
    if (!repo) { state = null; return; }
    let data;
    try {
      data = await getJSON(`https://api.github.com/repos/${repo}/actions/workflows/map.yml/runs?per_page=10`);
    } catch (e) {
      if (e.reset) { limited = e.reset; state = { kind: 'limited' }; }
      return;
    }
    limited = 0;
    // A run cancelled before it started (Run workflow pressed twice: GitHub drops the twin) counts for nothing.
    const runs = (data.workflow_runs || []).filter((r) => r.conclusion !== 'cancelled');
    const login = runs.find((r) => r.display_title === 'Sign in to Realms');  // newest first
    if (!login) { state = { kind: 'waiting' }; return; }
    if (login.status !== 'completed') {
      // The code to enter, put by the sign-in on the "login-code" branch (tools/login_code.sh); then "signed in".
      let info = null;
      try { info = await getJSON(`https://api.github.com/repos/${repo}/contents/code.json?ref=login-code`, 'application/vnd.github.raw'); } catch { /* not there yet */ }
      if (info?.state === 'signed-in') { state = { kind: 'building', url: login.html_url }; return; }
      state = { kind: 'code', url: login.html_url, code: info?.state === 'code' && info.expires > Date.now() ? info.code : '', uri: info?.uri };
      return;
    }
    if (login.conclusion !== 'success') { state = { kind: 'login-failed', url: login.html_url }; return; }
    // The map run the sign-in started ("Update map", after it).
    const map = runs.find((r) => r.display_title === 'Update map' && new Date(r.created_at) >= new Date(login.created_at));
    if (!map) { state = { kind: 'building', url: login.html_url }; return; }
    if (map.status !== 'completed') { state = { kind: 'making', url: map.html_url }; return; }
    if (map.conclusion !== 'success') { state = { kind: 'map-failed', url: map.html_url }; return; }
    // The site's exact address, put by the publishing step on the "site-info" branch.
    if (!siteUrl) {
      try { siteUrl = (await getJSON(`https://api.github.com/repos/${repo}/contents/site.json?ref=site-info`, 'application/vnd.github.raw')).url || ''; } catch { /* not yet */ }
    }
    state = { kind: 'done', url: map.html_url };
    refresh();
  }
  function renderStatus() {
    const box = $('#status');
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    const site = saved.repo ? siteOf(saved.repo) : '';
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    const html = {
      waiting: `<b>${T('ログインが始まるのを待っています', 'Waiting for signing in to start')}<span class="spin"></span></b>${T('トークンを登録してから、1 分ほどで始まります。', 'It starts about a minute after the token is added.')}`,
      code: state?.code
        ? `<b>${T('下のリンクからコードを入力してください', 'Enter this code at the link below')}</b>
          <div class="code"><span id="the-code">${esc(state.code)}</span><button class="copy" type="button" data-text="${esc(state.code)}"><svg class="ic"><use href="#i-copy"/></svg>${T('コピー', 'Copy')}</button></div>
          <p><a class="btn" href="${esc(state.uri || 'https://www.microsoft.com/link')}" target="_blank" rel="noopener">${T('microsoft.com/link を開く', 'Open microsoft.com/link')}</a></p>
          <span class="small">${T('Realm のオーナーのアカウントでログインします(15 分以内)。', 'Sign in with the Realm owner\'s account (within 15 minutes).')}</span>`
        : `<b>${T('コードを用意しています', 'Getting the code ready')}<span class="spin"></span></b>${T('少し待つと、ここにコードが出ます。', 'The code appears here in a moment.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      limited: `<b>${T('少し待っています', 'Pausing for a moment')}<span class="spin"></span></b>${T(`GitHub への問い合わせの上限に達したため、${Math.max(1, Math.ceil((limited - Date.now()) / 60000))} 分ほど後に表示を再開します。その間の進み具合は「Map site」で見られます。`, `GitHub's limit on questions was reached, so this resumes in about ${Math.max(1, Math.ceil((limited - Date.now()) / 60000))} minutes. Meanwhile, see progress under “Map site”.`)}`,
      building: `<b>${T('サイトを作っています', 'Building your site')}<span class="spin"></span></b>${T('ログインできました。数分かかります。このページは開いたままで大丈夫です。', 'Signed in. This takes a few minutes; you can leave this page open.')}`,
      'login-failed': `<b class="bad">${T('ログインできませんでした', 'Sign-in did not work')}</b>${T('時間切れのときは、もう一度「Sign in to Realms」を実行します。ほかの原因は<a href="#trouble">トラブルシューティング</a>へ。', 'If it timed out, run “Sign in to Realms” again. For other causes, see <a href="#trouble">Troubleshooting</a>.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      making: `<b>${T('サイトを作っています', 'Building your site')}<span class="spin"></span></b>${T('数分かかります。このページは開いたままで大丈夫です。', 'This takes a few minutes; you can leave this page open.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      'map-failed': `<b class="bad">${T('地図を作れませんでした', 'The map could not be made')}</b> ${T('記録のメッセージを見て、<a href="#trouble">トラブルシューティング</a>を確認してください。', 'Check the message in the log, then see <a href="#trouble">Troubleshooting</a>.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      done: `<b class="good">${T('サイトができました', 'Your site is ready')}</b> ${T('手順 5 に進みます。', 'Go on to step 5.')}`,
    }[state?.kind] || '';
    box.className = `status ${state?.kind || ''}`;
    secretHint();
    if (state?.kind && state.kind !== 'waiting') count(`status-${state.kind}`);  // code, login-failed, making, map-failed, done
    box.innerHTML = html;
  }
  // Step 3: once signing in has started, the token is surely there; while still waiting after a few minutes, what to check.
  let waitingSince = 0;
  function secretHint() {
    const hint = $('#secret-hint'), kind = state?.kind;
    if (kind !== 'waiting') waitingSince = 0; else if (!waitingSince) waitingSince = Date.now();
    const late = kind === 'waiting' && Date.now() - waitingSince > 3 * 60000;
    hint.hidden = !(late || ['code', 'building', 'making', 'done', 'map-failed'].includes(kind));
    hint.className = `hint ${late ? 'warn' : 'ok'}`;
    hint.innerHTML = late
      ? T('まだトークンを確認できていません。Name が <code>CLOUDFLARE_API_TOKEN</code> になっているか確かめてください(<a href="#trouble">詳しく</a>)。',
        'The token has not been found yet. Check that its Name is <code>CLOUDFLARE_API_TOKEN</code> (<a href="#trouble">more</a>).')
      : T('✓ トークンを確認できました。', '✓ The token was found.');
  }
  let timer = null;
  async function poll(now = false) {
    clearTimeout(timer);
    if (now) { state = saved.repo ? { kind: 'waiting' } : null; renderStatus(); timer = setTimeout(() => poll(), 1500); return; }
    try { await check(); } catch { /* offline: try again shortly */ }
    renderStatus();
    if (document.visibilityState !== 'visible') return;  // looks again when the page is shown
    // Every 5 seconds while something is happening, every 15 while waiting; after GitHub's limit, when it lifts.
    const moving = state && ['code', 'building', 'making'].includes(state.kind);
    const wait = state?.kind === 'limited' ? Math.max(30000, limited - Date.now() + 2000) : moving ? 5000 : 15000;
    if (state?.kind !== 'done') timer = setTimeout(() => poll(), wait);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && saved.repo) poll(); });

  applyLang();
  if (saved.repo) poll();
})();
