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
  $('#repo').addEventListener('input', () => { saved.repo = repoOf($('#repo').value); save(); refresh(); poll(true); });
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
    const site = repo ? siteOf(repo) : '';
    $('#site-link').classList.toggle('off', !site);
    if (site) $('#site-link').href = site; else $('#site-link').removeAttribute('href');
    $('#site-hint').innerHTML = site
      ? T(`サイトのアドレスは、おそらく <code>${site}</code> です。違う場合は、手順 4 の記録の Summary に正しいアドレスが表示されます。`,
        `Your site is most likely at <code>${site}</code>. If not, step 4's run shows the address in its Summary.`) : '';
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
  const jobsCache = new Map();
  async function getJSON(url) {
    // no-cache: the browser asks again with the ETag, and GitHub's "unchanged" answers don't count against its limit.
    const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  async function jobsOf(run) {
    const k = `${run.id}:${run.updated_at}`;
    if (!jobsCache.has(k)) jobsCache.set(k, (await getJSON(run.jobs_url)).jobs || []);
    return jobsCache.get(k);
  }
  const ran = (jobs, name) => jobs.find((j) => j.name === name && j.conclusion !== 'skipped');
  async function check() {
    const repo = saved.repo;
    if (!repo) { state = null; return; }
    const { workflow_runs: runs = [] } = await getJSON(`https://api.github.com/repos/${repo}/actions/workflows/map.yml/runs?event=workflow_dispatch&per_page=6`);
    let login = null, loginJobs = null;
    for (const run of runs) {  // newest first
      const jobs = await jobsOf(run);
      if (ran(jobs, 'login')) { login = run; loginJobs = jobs; break; }  // a login job that was not skipped (running or done)
    }
    if (!login) { state = { kind: 'waiting' }; return; }
    const job = loginJobs.find((j) => j.name === 'login');
    if (login.status !== 'completed') { state = { kind: 'code', url: job?.html_url || login.html_url }; return; }
    if (login.conclusion !== 'success') { state = { kind: 'login-failed', url: job?.html_url || login.html_url }; return; }
    // The map run the sign-in started: the newest run after it that made the map.
    for (const run of runs) {
      if (new Date(run.created_at) < new Date(login.created_at) || run.id === login.id) continue;
      const jobs = await jobsOf(run);
      if (!jobs.some((j) => j.name === 'update')) continue;
      const cf = jobs.find((j) => j.name === 'cloudflare');
      if (run.status !== 'completed') { state = { kind: 'making', url: run.html_url }; return; }
      state = run.conclusion === 'success' && cf?.conclusion === 'success'
        ? { kind: 'done', url: run.html_url } : { kind: 'map-failed', url: run.html_url };
      return;
    }
    state = { kind: 'making', url: login.html_url };
  }
  function renderStatus() {
    const box = $('#status');
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    const site = saved.repo ? siteOf(saved.repo) : '';
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    const html = {
      waiting: `<b>${T('待っています', 'Waiting')}</b> ${T('「Sign in to Realms」を実行すると、ここに進み具合が出ます。', 'Once “Sign in to Realms” runs, its progress shows here.')}`,
      code: `<b>${T('コードを入力してください', 'Enter the code')}</b> ${T('下のボタンを開くと、四角で囲まれたコードが出ています。', 'Open the button below: the code is shown in a box.')}
        <p><a class="btn" href="${state?.url}" target="_blank" rel="noopener">${T('コードを開く', 'Show the code')}</a></p>
        ${T('コードを <a href="https://www.microsoft.com/link" target="_blank" rel="noopener">microsoft.com/link</a> に入れて、Realm のオーナーのアカウントでログインします(15 分以内)。',
          'Enter it at <a href="https://www.microsoft.com/link" target="_blank" rel="noopener">microsoft.com/link</a> and sign in with the Realm owner\'s account (within 15 minutes).')}`,
      'login-failed': `<b class="bad">${T('ログインできませんでした', 'Sign-in did not work')}</b> ${T('時間切れの場合は、もう一度「Sign in to Realms」を実行します。', 'If it timed out, run “Sign in to Realms” again.')} ${link(state?.url, T('記録を見る', 'See the log'))}`,
      making: `<b>${T('地図を作っています', 'Making the map')}</b><span class="spin"></span> ${T('数分かかります。このページは開いたままで大丈夫です。', 'This takes a few minutes. You can leave this page open.')} ${link(state?.url, T('記録を見る', 'See the log'))}`,
      'map-failed': `<b class="bad">${T('地図を作れませんでした', 'The map could not be made')}</b> ${T('記録のメッセージを見て、説明書の「トラブルシューティング」を確認してください。', 'Check the message in the log against the README\'s Troubleshooting.')} ${link(state?.url, T('記録を見る', 'See the log'))}`,
      done: `<b class="good">${T('サイトができました', 'Your site is ready')}</b> ${T('手順 5 に進みます。', 'Go on to step 5.')}`,
    }[state?.kind] || '';
    box.className = `status ${state?.kind || ''}`;
    box.innerHTML = html;
  }
  let timer = null;
  async function poll(now = false) {
    clearTimeout(timer);
    if (!now) {
      try { await check(); } catch { /* offline or GitHub's limit: try again later */ }
      renderStatus();
    } else { state = saved.repo ? { kind: 'waiting' } : null; renderStatus(); }
    if (now) { timer = setTimeout(() => poll(), 1500); return; }
    const busy = state && (state.kind === 'code' || state.kind === 'making');
    if (state?.kind !== 'done' || busy) timer = setTimeout(() => poll(), busy ? 15000 : 30000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && saved.repo) poll(); });

  applyLang();
  if (saved.repo) poll();
})();
