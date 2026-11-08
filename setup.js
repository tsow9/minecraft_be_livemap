'use strict';
// Setup: the steps on one page. Nothing is sent anywhere; the repository's link is kept in this browser. Step 4
// follows the runs of the
// repository's "Map site" workflow through GitHub's public API (the repository is public, so no sign-in is needed).
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'blockmap.setup';
  let saved = {};
  // Automatic updates (step 4): whether the site says they work, the GitHub App to add, and the connecting's stage.
  let timerSeen = false, timerOk = true, appSlug = 'chizuya-connect', auto = { phase: 'idle' }, lastAuto = '';
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* private mode */ }
  // The repository, and once its site is made, that it is done and where (so coming back needs no question to GitHub).
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify({ repo: saved.repo || '', id: saved.id || '', done: saved.done || '', site: saved.site || '', timer: saved.timer || '' })); } catch { /* private mode */ }
  };

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
  // Named after the repository once it is known (blockmap-survival → "Chizuya blockmap-survival"), so a token can be
  // told apart in Cloudflare's list when there is a site per Realm.
  const tokenLink = () => {
    const name = saved.repo ? `Chizuya ${saved.repo.split('/')[1]}` : 'Chizuya';
    $('#token-link').href = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(perms))}`
      + `&accountId=*&zoneId=all&name=${encodeURIComponent(name)}`;
  };

  // ---- the repository ----
  const repoOf = (text) => {
    const m = String(text || '').trim().replace(/\.git$/, '').match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/);
    return m ? `${m[1]}/${m[2]}` : '';
  };
  $('#repo').value = saved.repo ? `https://github.com/${saved.repo}` : '';
  $('#repo').addEventListener('input', () => {
    const repo = repoOf($('#repo').value);
    if (repo !== saved.repo) { saved = { repo }; siteUrl = ''; }
    save(); refresh(); poll(true);
    if (saved.repo) count('repo-entered');
  });
  // The address the workflow gives a new site: <name from the repository's name>.<GitHub owner>.workers.dev
  // (tools/site_name.sh, tools/cloudflare.sh).
  const siteOf = (repo) => {
    const [owner, name] = repo.split('/');
    const site = (name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 50).replace(/-+$/, '') || 'blockmap';
    return `https://${site}.${owner.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.workers.dev`;
  };

  function refresh() {
    const repo = saved.repo || '';
    tokenLink();
    for (const a of document.querySelectorAll('.repo-link')) {
      a.classList.toggle('off', !repo);
      if (repo) a.href = `https://github.com/${repo}${a.dataset.path}`; else a.removeAttribute('href');
    }
    $('#repo-hint').innerHTML = repo
      ? T(`<code>${repo}</code> を使います。手順 3〜5 のボタンが、このリポジトリを開きます。`, `Using <code>${repo}</code>. The buttons in steps 3–5 open it.`)
      : T('入れると、手順 3〜5 のボタンがそのリポジトリを直接開きます。', 'Once filled in, the buttons in steps 3–5 open it directly.');
    // Only the exact address: from the site itself, or from what publishing it wrote (site-info branch).
    const site = siteUrl;
    const box = $('#site-box');
    box.classList.toggle('ready', !!site);
    box.innerHTML = site && !timerOk
      ? `<span class="small">${T('手順 4 の自動更新を設定すると、ここにアドレスが出ます。', 'Your site\'s address appears here once automatic updates are set up in step 4.')}</span>`
      : site
      ? `<b>${T('サイトのアドレス', 'Your site')}</b>
        <div class="url"><code>${esc(site)}</code></div>
        <p class="row"><a class="btn" href="${esc(site)}" data-count="open-site" target="_blank" rel="noopener">${T('サイトを開く', 'Open my site')}</a><button class="copy" type="button" data-text="${esc(site)}"><svg class="ic"><use href="#i-copy"/></svg>${T('アドレスをコピー', 'Copy the address')}</button></p>`
      : `<span class="small">${T('サイトができると、ここにアドレスが出ます。', 'Your site\'s address appears here once it is made.')}</span>`;
  }

  // A link to a troubleshooting entry opens it.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    const d = a && document.getElementById(a.getAttribute('href').slice(1));
    if (d && d.tagName === 'DETAILS') d.open = true;
  });

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
  // GitHub answers about 60 questions an hour to a browser that is not signed in (every answer counts). Spend them
  // freely while many are left; with few left, spread the rest over the time until the limit resets.
  let budget = { left: 60, reset: 0 };
  async function getJSON(url, accept = 'application/vnd.github+json') {
    // no-cache: the browser asks again with the ETag, and GitHub's "unchanged" answers don't count against its limit.
    const res = await fetch(url, { cache: 'no-cache', headers: { Accept: accept } });
    const left = res.headers.get('x-ratelimit-remaining'), reset = res.headers.get('x-ratelimit-reset');
    if (left !== null) budget = { left: Number(left), reset: Number(reset) * 1000 || 0 };
    if (!res.ok) {
      const err = new Error(String(res.status));
      if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        err.reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 15 * 60000;
      }
      throw err;
    }
    return res.json();
  }
  const minsLeft = (at) => Math.max(1, Math.ceil(((at || 0) - Date.now()) / 60000)) || 15;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // One question per look: the runs list. Runs started by hand or by the sign-in carry what they do as their title
  // (run-name: "Sign in to Realms", "Update map"), so no per-run questions are needed. GitHub answers about 60
  // questions an hour per browser without signing in; "unchanged" answers (ETag) do not count.
  let limited = 0;  // when GitHub's limit lifts (ms), while it is reached
  const codeInfo = (repo) => getJSON(`https://api.github.com/repos/${repo}/contents/code.json?ref=login-code`, 'application/vnd.github.raw');
  // Once the site is up (signing in puts it up first), it says how things are getting on (/api/setup): asked every few
  // seconds, with no limit. Only what is about this repository counts (an earlier site may share the address).
  let fromSite = false;  // the site answered last time
  // The repository's id (and its owner's), from GitHub's public API once per visit: a repository made again under an
  // old name is another one (its old site may still answer), and the app's install page can preselect it.
  let info = null;
  async function repoInfo(repo) {
    if (info?.repo === repo) return info;
    try {
      const r = await getJSON(`https://api.github.com/repos/${repo}`);
      if (!r?.id) return null;
      info = { repo, id: String(r.id), owner: String(r.owner?.id || '') };
    } catch (e) {
      if (e.reset) limited = e.reset;
      // Not there for anyone: a mistyped link, or a repository made Private (the setup page and Chizuya need it Public).
      if (e.message === '404' && saved.repo === repo) {
        $('#repo-hint').innerHTML = T(`<code>${esc(repo)}</code> が見つかりません。リンクが合っているか、公開範囲が <b>Public</b> になっているか確かめてください(Private だと動きません)。`,
          `<code>${esc(repo)}</code> cannot be found. Check the link, and that the repository is <b>Public</b> (Chizuya does not work with Private).`);
      }
      // GitHub's hourly limit: the id this browser learned before (a repository made again under the same name since
      // then is told apart once GitHub answers again).
      return saved.repo === repo && saved.id ? { repo, id: saved.id, owner: '', cached: true } : null;
    }
    if (saved.repo === repo && saved.id && saved.id !== info.id) { saved = { repo, id: info.id }; siteUrl = ''; save(); refresh(); }
    // Remembered before ids were: "done" may be an older repository's, so it is looked at afresh.
    else if (saved.repo === repo && !saved.id) { saved = { repo, id: info.id }; save(); refresh(); }
    return info;
  }
  const repoTag = async (repo) => {
    // Only with the id: by name alone, an older repository's site of the same name would answer for this one.
    const i = await repoInfo(repo);
    if (!i?.id) return null;
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${repo.toLowerCase()}#${i.id}`));
    return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  // Until the address is known, the addresses the workflow would give it are all tried: a new Cloudflare account gets
  // the GitHub owner's name, or that name with -2, -3 when it is taken (tools/cloudflare.sh).
  function candidates(repo) {
    if (siteUrl) return [siteUrl];
    const one = siteOf(repo);
    const [, name, sub] = one.match(/^https:\/\/([^.]+)\.([^.]+)\.workers\.dev$/) || [];
    return name ? [one, `https://${name}.${sub}-2.workers.dev`, `https://${name}.${sub}-3.workers.dev`] : [one];
  }
  async function askOne(base, tag) {
    const res = await fetch(`${base}/api/setup`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    // With this repository's id: its own tag. Without it (GitHub's hourly limit reached): only news from the last 20
    // minutes counts, so a site left from an older repository of this name (finished long ago) is not taken for it.
    if (!s?.state || (tag ? s.r !== tag : !(Date.now() - (s.at || 0) < 20 * 60000))) throw new Error('another site');
    return [base, s];
  }
  async function askSite(repo) {
    const tag = await repoTag(repo);
    let hit;
    try { hit = await Promise.any(candidates(repo).map((b) => askOne(b.replace(/\/$/, ''), tag))); } catch { return null; }
    const [base, s] = hit;
    if (siteUrl !== base) { siteUrl = base; refresh(); }  // it answered about this repository: the address is sure
    if (!prefsSent) sendPrefs(base);
    return s;
  }
  let lastSiteLook = 0;
  // This browser's language and time zone, for the runs' messages and the map's dates (until the admin's map page says).
  let prefsSent = false;
  function sendPrefs(base) {
    prefsSent = true;
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old browser */ }
    if (tz) fetch(`${base}/api/setup/prefs`, { method: 'POST', body: JSON.stringify({ lang, tz }) }).catch(() => {});
  }
  // Signing in puts the site up first and notes its exact address (site-info branch): with it, the site itself is
  // asked from then on (no limit, and it says at once when signing in is done). Looked for at most every 20 seconds.
  async function lookForSite(repo) {
    if (siteUrl || Date.now() - lastSiteLook < 20000) return;
    lastSiteLook = Date.now();
    try { siteUrl = ((await getJSON(`https://api.github.com/repos/${repo}/contents/site.json?ref=site-info`, 'application/vnd.github.raw')).url || '').replace(/\/$/, ''); } catch { /* not yet */ }
    if (siteUrl) refresh();
  }
  const STEPS = ['signed-in', 'downloading', 'drawing', 'publishing'];
  async function check() {
    const repo = saved.repo;
    if (!repo) { state = null; return; }
    // This repository's id (GitHub's public API) tells it apart from an older one of its name; "done" is trusted only with it.
    const known = await repoInfo(repo);
    // What this browser remembers is only where to ask (the site's address); what is shown always comes from the site
    // or the repository as they are now.
    if (known && saved.done && saved.site && !siteUrl) siteUrl = saved.site;
    const s = await askSite(repo);
    fromSite = !!s;
    // The timer (a must): known from the site; sites from before it existed say nothing, and are not held up.
    if (s) {
      const was = timerOk;
      timerOk = s.timer !== false; timerSeen = typeof s.timer === 'boolean'; appSlug = s.app || appSlug; sitePending = !!s.pending;
      if (s.timer === true && !saved.timer) { saved.timer = '1'; save(); }
      if (was !== timerOk) refresh();
    }
    if (s) {
      const url = s.log;
      if (s.state === 'starting') state = { kind: 'code', url, code: '' };
      else if (s.state === 'code') state = { kind: 'code', url, code: s.expires > Date.now() ? s.code : '', uri: s.uri, expires: s.expires };
      else if (s.state === 'pick-realm') state = { kind: 'pick', url, realms: Array.isArray(s.realms) ? s.realms : [] };
      else if (s.state === 'picked') state = { kind: 'making', url, step: 'signed-in' };
      else if (STEPS.includes(s.state)) state = { kind: 'making', url, step: s.state, detail: s.detail };
      else if (s.state === 'login-failed' || s.state === 'map-failed') state = { kind: s.state, url };
      else if (s.state === 'done') {
        siteUrl = s.url ? s.url.replace(/\/$/, '') : (siteUrl || siteOf(repo));
        state = { kind: 'done', url };
        saved.done = '1'; saved.site = siteUrl; save(); refresh();
      }
      return;
    }
    // While the code is shown, only the code's file is asked about: it turns to "signed in", or goes when signing in ends.
    if (state?.kind === 'code' && state.code) {
      await lookForSite(repo);
      try {
        const info = await codeInfo(repo);
        limited = 0;
        if (info?.state === 'signed-in') { state = { kind: 'building', url: state.url }; return; }
        if (info?.state === 'code' && info.code === state.code) return;
      } catch (e) {
        if (e.reset) { limited = e.reset; return; }
        // gone: signing in has ended; the runs tell how
      }
    }
    let data;
    try {
      data = await getJSON(`https://api.github.com/repos/${repo}/actions/workflows/map.yml/runs?per_page=10`);
    } catch (e) {
      if (e.reset) limited = e.reset;
      if (!state) state = { kind: 'waiting' };
      return;
    }
    limited = 0;
    // A run cancelled before it started (Run workflow pressed twice: GitHub drops the twin) counts for nothing.
    const runs = (data.workflow_runs || []).filter((r) => r.conclusion !== 'cancelled');
    const login = runs.find((r) => r.display_title === 'Sign in to Realms');  // newest first
    if (!login) { state = { kind: 'waiting' }; return; }
    await lookForSite(repo);
    if (login.status !== 'completed') {
      // The code to enter, put by the sign-in on the "login-code" branch (tools/login_code.sh); then "signed in".
      let info = null;
      try { info = await codeInfo(repo); } catch { /* not there yet */ }
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
    if (siteUrl) { saved.done = '1'; saved.site = siteUrl; save(); }
    refresh();
  }
  let lastBox = '';
  function renderStatus() {
    const box = $('#status');
    const pick = (v) => (typeof v === 'function' ? v() : v);
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    const site = saved.repo ? siteOf(saved.repo) : '';
    const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    const html = {
      waiting: `<b>${T('ログインを待っています', 'Waiting to sign in')}</b>${T('手順 3 のトークンが確認できると、自動でログインの準備が始まります。', 'Once the token from step 3 is found, signing in gets ready by itself.')}`,
      code: state?.code
        ? `<b>${T('下のリンクからコードを入力してください', 'Enter this code at the link below')}</b>
          <div class="code"><span id="the-code">${esc(state.code)}</span><button class="copy" type="button" data-text="${esc(state.code)}"><svg class="ic"><use href="#i-copy"/></svg>${T('コピー', 'Copy')}</button></div>
          <p><a class="btn" href="${esc(state.uri || 'https://www.microsoft.com/link')}" target="_blank" rel="noopener">${T('microsoft.com/link を開く', 'Open microsoft.com/link')}</a></p>
          <span class="small">${T(`Realm のオーナーのアカウントでログインします(あと ${minsLeft(state.expires)} 分)。時間が切れても、すぐに新しいコードが出ます。`, `Sign in with the Realm owner's account (${minsLeft(state.expires)} minutes left). If it runs out, a new code appears shortly.`)}</span>`
        : `<b>${T('ログインの準備をしています', 'Getting signing in ready')}<span class="dots"><i></i><i></i><i></i></span></b>${T('サイトの入れ物を用意してから、ここにコードが出ます。最初は 2 分ほどかかります。', 'The site is put up first, then the code appears here. The first time takes about 2 minutes.')}`,
      building: `<b>${T('サイトを作っています', 'Building your site')}<span class="dots"><i></i><i></i><i></i></span></b>${T('ログインできました。数分かかります。このページは開いたままで大丈夫です。', 'Signed in. This takes a few minutes; you can leave this page open.')}`,
      progress: () => {
        const names = { 'signed-in': T('Realms にログイン', 'Signed in to Realms'), downloading: T('ワールドをダウンロード', 'Downloading the world'),
          drawing: T('地図を作る', 'Making the map'), publishing: T('サイトに反映', 'Putting it on your site') };
        const at = Math.max(1, STEPS.indexOf(state.step));  // just signed in: the download is next
        // What the drawing is doing right now (render_map.py says so as it goes).
        const detail = state.step === 'drawing' && {
          read: T('ワールドを読み込んでいます', 'Reading the world'), items: T('チェストや村人を調べています', 'Looking at chests and villagers'),
          overworld: T('地上の地図を作っています', 'Making the Overworld map'), nether: T('ネザーの地図を作っています', 'Making the Nether map'),
          end: T('エンドの地図を作っています', 'Making the End map'), save: T('保存しています', 'Saving'),
        }[state.detail];
        return `<b>${T('サイトを作っています', 'Building your site')}</b>${T('数分かかります。このページは開いたままで大丈夫です。', 'This takes a few minutes; you can leave this page open.')}
          <ol class="progress">${STEPS.map((k, i) => `<li class="${i < at || k === 'signed-in' ? 'did' : i === at ? 'now' : ''}">${names[k]}${i === at && detail ? `<small>${detail}</small>` : ''}</li>`).join('')}</ol>
          ${state.url ? link(state.url, T('記録を見る', 'See the log')) : ''}`;
      },
      'login-failed': `<b class="bad">${T('ログインできませんでした', 'Sign-in did not work')}</b>${T('コードの時間切れなら、1〜2 分で自動で新しいコードが出ます。ほかの原因は<a href="#trouble">トラブルシューティング</a>へ。', 'If the code ran out, a new one appears here by itself in a minute or two. For other causes, see <a href="#trouble">Troubleshooting</a>.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      making: `<b>${T('サイトを作っています', 'Building your site')}<span class="dots"><i></i><i></i><i></i></span></b>${T('数分かかります。このページは開いたままで大丈夫です。', 'This takes a few minutes; you can leave this page open.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      'map-failed': `<b class="bad">${T('地図を作れませんでした', 'The map could not be made')}</b> ${T('記録のメッセージを見て、<a href="#trouble">トラブルシューティング</a>を確認してください。', 'Check the message in the log, then see <a href="#trouble">Troubleshooting</a>.')}<br>${link(state?.url, T('記録を見る', 'See the log'))}`,
      pick: `<b>${T('どの Realm の地図を作りますか?', 'Which Realm should this site map?')}</b>${T('あなたの Realm が 2 つ以上見つかりました。地図にする Realm を選んでください(15 分以内)。', 'You own two or more Realms. Pick the one to map (within 15 minutes).')}
        <div class="realms">${(state?.realms || []).map((n) => `<button type="button" class="realm" data-realm="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <span class="small">${T('ほかの Realm の地図は、別の名前でもう 1 つリポジトリを作ると作れます。', 'To map another Realm too, make one more repository with another name.')}</span>`,
      done: () => (timerOk ? `<b class="good">${T('サイトができました', 'Your site is ready')}</b> ${T('手順 5 に進みます。', 'Go on to step 5.')}`
        : `<b class="good">${T('サイトができました', 'Your site is ready')}</b> ${T('あと 1 つ、下の自動更新を設定してください。', 'One more thing: set up automatic updates below.')}`),
    }[state?.kind === 'making' && state.step ? 'progress' : state?.kind] || '';
    box.className = `status ${state?.kind || ''}`;
    secretHint();
    if (state?.kind && state.kind !== 'waiting') count(`status-${state.kind}`);  // code, login-failed, making, map-failed, done
    const paused = '';
    // Only when it changed: asked every 2 seconds, the box would otherwise be remade under a finger about to press.
    const next = pick(html) + paused;
    if (next !== lastBox) { box.innerHTML = next; lastBox = next; }
    renderAuto();
  }
  // ---- automatic updates (a must): the Chizuya Connect GitHub App, connected with a code while the site is made ----
  // GitHub's own timer runs hours late; with this the site starts the live check every minute. The site keeps the
  // token (only if it really can start this repository's runs); this page only sees the code to enter.
  function renderAuto() {
    const box = $('#auto-box');
    // Shown once the site has said whether automatic updates work (older sites do not say): ✓, or how to set them up.
    const show = ['building', 'making', 'done'].includes(state?.kind) && fromSite && !!siteUrl && timerSeen;
    box.hidden = !show;
    if (!show) return;
    resumeAuto();
    let html;
    if (timerOk) html = `<b class="good">${T('✓ 自動更新を設定しました', '✓ Automatic updates are set up')}</b>`;
    else if (auto.phase === 'code') {
      html = `<b>${T('GitHub でこのコードを入れて「Authorize」を押します', 'Enter this code on GitHub, then press “Authorize”')}</b>
        <div class="code"><span>${esc(auto.code)}</span><button class="copy" type="button" data-text="${esc(auto.code)}"><svg class="ic"><use href="#i-copy"/></svg>${T('コピー', 'Copy')}</button></div>
        <p><a class="btn" href="${esc(auto.uri)}" target="_blank" rel="noopener">${T('github.com/login/device を開く', 'Open github.com/login/device')}</a></p>
        <span class="small">${T('許可すると、ここが自動で次に進みます。', 'Once you allow it, this moves on by itself.')}<span class="dots"><i></i><i></i><i></i></span></span>`;
    } else if (auto.phase === 'install') {
      // Approved, but Chizuya Connect is not on this repository yet (the approval waits on the site for 30 minutes).
      html = `<b>${T('あと 1 つ:Chizuya Connect をリポジトリに入れます', 'One more: add Chizuya Connect to the repository')}</b>
        ${T(`下のボタンで GitHub を開き、「<b>Only select repositories</b>」で <code>${esc(saved.repo)}</code> を選んで「<b>Install</b>」を押します(前に入れたことがあれば <code>${esc(saved.repo)}</code> を足して「<b>Save</b>」)。`,
          `Open GitHub with the button below, choose “<b>Only select repositories</b>”, pick <code>${esc(saved.repo)}</code> and press “<b>Install</b>” (if you added it before, add <code>${esc(saved.repo)}</code> and press “<b>Save</b>”).`)}
        <p><a class="btn" href="https://github.com/apps/${esc(appSlug)}/installations/new">${T('Chizuya Connect を入れる', 'Add Chizuya Connect')}</a></p>
        <span class="small">${T('入れると、このページに戻って自動で完了します。', 'Once added, you come back to this page and it finishes by itself.')}<span class="dots"><i></i><i></i><i></i></span></span>`;
    } else {
      html = auto.phase === 'starting'
        ? `<b>${T('GitHub と連携しています', 'Connecting GitHub')}<span class="dots"><i></i><i></i><i></i></span></b>`
        : `<b>${T('自動更新を設定します', 'Set up automatic updates')}</b>
        ${T('地図とプレイヤーの位置をこまめに新しくするために、GitHub と連携します。サイトを作っているあいだに進められます。', 'So the map and players\' places stay up to date, connect GitHub. You can do it while the site is being built.')}
        <p><button class="btn" type="button" id="auto-connect">${T('GitHub と連携する', 'Connect GitHub')}</button></p>`
        + (auto.phase === 'error' ? `<span class="bad">${auto.err === 'access_denied' ? T('許可されませんでした。もう一度押してください。', 'It was not allowed. Please press it again.')
          : auto.err === 'expired' ? T('時間が切れました。もう一度押してください。', 'It ran out of time. Please press it again.')
            : T('うまくいきませんでした。もう一度押してください。', 'That did not work. Please press it again.')}</span>` : '');
    }
    if (html !== lastAuto) { box.innerHTML = html; lastAuto = html; }
    box.className = `status ${timerOk ? 'done' : 'code'}`;
  }
  const autoDone = () => { timerOk = true; auto = { phase: 'ok' }; forgetCode(); saved.timer = '1'; save(); refresh(); renderStatus(); poll(); };
  // Text bodies, so no preflight.
  const askTimer = (what, body) => fetch(`${siteUrl}/api/setup/timer/${what}`, { method: 'POST', body: JSON.stringify(body || {}) }).then((r) => r.json());
  // The code being shown is kept in this browser until it runs out, so a reload (or another tab) carries on with it.
  const CODE_KEY = 'blockmap.setup.code';
  const keepCode = (d) => { try { localStorage.setItem(CODE_KEY, JSON.stringify(d)); } catch { /* private mode */ } };
  const forgetCode = () => { try { localStorage.removeItem(CODE_KEY); } catch { /* private mode */ } };
  const keptCode = () => { try { const d = JSON.parse(localStorage.getItem(CODE_KEY) || 'null'); return d && d.repo === saved.repo && d.until > Date.now() ? d : null; } catch { return null; } };
  // After a reload: the code still shown, or an approval the site keeps while the app is added (sitePending, from /api/setup).
  let sitePending = false;
  function resumeAuto() {
    if (timerOk || !['idle', 'error'].includes(auto.phase)) return;
    const d = keptCode();
    if (d) { auto = { phase: 'code', code: d.code, uri: d.uri }; watchCode(d); return; }
    if (sitePending) { auto = { phase: 'install' }; waitInstall(); }
  }
  // Waiting for the app to be added: the site tries the kept approval again every few seconds.
  function waitInstall() {
    const look = async () => {
      if (auto.phase !== 'install') return;
      let p = null;
      try { p = await askTimer('retry'); } catch { /* try again */ }
      if (p?.ok || p?.error === 'set') { autoDone(); return; }
      if (p?.error === 'expired') { sitePending = false; auto = { phase: 'error', err: 'expired' }; renderAuto(); return; }
      setTimeout(look, 5000);
    };
    setTimeout(look, 3000);
  }
  // GitHub's code: asked about every few seconds until it is approved (or runs out).
  function watchCode(d) {
    let wait = Math.max(5, d.interval || 5) * 1000;
    const look = async () => {
      if (auto.phase !== 'code' || auto.code !== d.code) return;
      if (Date.now() > d.until) { forgetCode(); auto = { phase: 'error', err: 'expired' }; renderAuto(); return; }
      let p = null;
      try { p = await askTimer('poll', { handle: d.handle }); } catch { /* try again */ }
      if (!p || p.pending) { if (p?.interval) wait = p.interval * 1000; setTimeout(look, wait); return; }
      forgetCode();
      if (p.ok || p.error === 'set') { autoDone(); return; }
      // Approved, and Chizuya Connect is not on the repository yet: that comes next.
      if (p.error === 'not-installed') { auto = { phase: 'install' }; renderAuto(); waitInstall(); return; }
      auto = { phase: 'error', err: p.error };
      renderAuto();
    };
    setTimeout(look, wait);
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#auto-connect')) return;
    e.preventDefault();
    startConnect();
  });
  async function startConnect() {
    if (!siteUrl || ['starting', 'code'].includes(auto.phase)) return;
    auto = { phase: 'starting' };
    renderAuto();
    let d = null;
    try { d = await askTimer('connect'); } catch { /* offline */ }
    if (d?.error === 'set') { autoDone(); return; }
    if (!d?.user_code) { auto = { phase: 'error', err: 'github' }; lastAuto = ''; renderAuto(); return; }
    const kept = { repo: saved.repo, code: d.user_code, uri: d.uri || 'https://github.com/login/device', handle: d.handle,
      interval: d.interval || 5, until: Date.now() + (d.expires_in || 900) * 1000 };
    keepCode(kept);
    auto = { phase: 'code', code: kept.code, uri: kept.uri };
    renderAuto();
    watchCode(kept);
  }
  // Step 3: once signing in has started, the token is surely there; while still waiting after a few minutes, what to check.
  let waitingSince = 0;
  // Step 3's box: waiting for the token, then found (once signing in has started, the token is surely there).
  let lastToken = '', lastLook = 0;
  function secretHint() {
    const box = $('#token-box'), kind = state?.kind;
    if (kind !== 'waiting') waitingSince = 0; else if (!waitingSince) waitingSince = Date.now();
    const late = kind === 'waiting' && limited <= Date.now() && Date.now() - waitingSince > 3 * 60000;
    const found = ['code', 'pick', 'building', 'making', 'done', 'map-failed', 'login-failed'].includes(kind);
    box.hidden = !(found || kind === 'waiting' || kind === 'limited');
    box.className = `status ${found ? 'done' : 'code'}`;
    const html = found ? `<b class="good">${T('✓ トークンを確認できました', '✓ The token was found')}</b>`
      : `<b>${T('トークンの登録を待っています', 'Waiting for the token')}<span class="dots"><i></i><i></i><i></i></span></b>`
        + (late ? `<span class="bad">${T('まだトークンを確認できていません。Name が <code>CLOUDFLARE_API_TOKEN</code> になっているか確かめてください(<a href="#trouble">詳しく</a>)。',
          'The token has not been found yet. Check that its Name is <code>CLOUDFLARE_API_TOKEN</code> (<a href="#trouble">more</a>).')}</span>`
          : `${T('登録すると、30 秒ほどで自動で確認します。', 'Once added, it is found by itself within about half a minute.')}${lastLook ? `<span class="small">${T('このページの最終確認', 'Last checked by this page')}: ${new Date(lastLook).toLocaleTimeString()}</span>` : ''}`);
    if (html !== lastToken) { box.innerHTML = html; lastToken = html; }
  }
  // Picking a Realm: sent to the site (plain text, so no preflight); the sign-in, waiting on the site, carries on.
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.realm');
    if (!b || !saved.repo) return;
    for (const x of document.querySelectorAll('.realm')) x.disabled = true;
    b.classList.add('on');
    try {
      const res = await fetch(`${(siteUrl || siteOf(saved.repo)).replace(/\/$/, '')}/api/setup/pick`, { method: 'POST', body: JSON.stringify({ name: b.dataset.realm }) });
      if (!res.ok) throw new Error(String(res.status));
      count('realm-picked');
      poll();
    } catch {
      toast(T('選べませんでした。もう一度押してください。', 'That did not go through. Please try again.'));
      for (const x of document.querySelectorAll('.realm')) x.disabled = false;
      b.classList.remove('on');
    }
  });
  let timer = null;
  async function poll(now = false) {
    clearTimeout(timer);
    if (now) { state = saved.repo ? { kind: 'waiting' } : null; limited = 0; renderStatus(); timer = setTimeout(() => poll(), 1500); return; }
    try { await check(); lastLook = Date.now(); } catch { /* offline: try again shortly */ }
    renderStatus();
    if (document.visibilityState !== 'visible') return;  // looks again when the page is shown
    // Every 5 seconds while the code is shown, 10 while the site is made, 15 while waiting; slower near GitHub's limit.
    const moving = state && ['code', 'building', 'making'].includes(state.kind);
    let wait = fromSite ? 2000 : state?.kind === 'code' ? 5000 : moving ? 10000 : 15000;
    if (fromSite) { /* no limit */ } else if (limited > Date.now()) wait = Math.max(30000, Math.min(limited - Date.now() + 2000, 5 * 60000));
    else if (budget.left < 25 && budget.reset > Date.now()) wait = Math.max(wait, (budget.reset - Date.now()) / Math.max(1, budget.left - 3));
    // Once everything is done, looked at less often (it still follows any change at the site).
    if (state?.kind === 'done' && timerOk) wait = Math.max(wait, 15000);
    timer = setTimeout(() => poll(), wait);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && saved.repo) poll(); });

  // A link to a troubleshooting item (#lost-repo, #remake-token…) opens it, not just scrolls to it closed.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    const d = a && document.getElementById(a.getAttribute('href').slice(1));
    if (d && d.tagName === 'DETAILS') d.open = true;
  });

  applyLang();
  if (saved.repo) poll();
})();
