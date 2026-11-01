'use strict';
// かんたん設定: the setup steps on one page. Nothing is sent anywhere; the repository name, the subdomain and the
// ticks are kept in this browser (never the keys, which are made afresh each time the page opens).
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'blockmap.setup';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ } };

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
    $('#lang').textContent = lang === 'ja' ? 'English' : '日本語';
    $('#v-lang').textContent = lang;
    refresh();
  }
  $('#lang').addEventListener('click', () => {
    lang = lang === 'ja' ? 'en' : 'ja';
    try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
    applyLang();
  });

  // ---- the two random keys (48 letters and digits each) ----
  function randomKey(n = 48) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const out = [];
    const bytes = crypto.getRandomValues(new Uint8Array(n * 2));
    for (const b of bytes) { if (b < 248 - (248 % abc.length)) out.push(abc[b % abc.length]); if (out.length === n) break; }
    return out.join('');
  }
  $('#key1').textContent = randomKey();
  $('#v-tz').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';

  // ---- the repository and the subdomain ----
  const repoOf = (text) => {
    const m = String(text || '').trim().replace(/\.git$/, '').match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/);
    return m ? `${m[1]}/${m[2]}` : '';
  };
  const subOf = (text) => String(text || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.workers\.dev.*$/, '')
    .split('.').pop().replace(/[^a-z0-9-]/g, '');
  $('#repo').value = saved.repo || '';
  $('#sub').value = saved.sub || '';
  $('#repo').addEventListener('input', () => { saved.repo = repoOf($('#repo').value); save(); refresh(); });
  $('#sub').addEventListener('input', () => { saved.sub = subOf($('#sub').value); save(); refresh(); });

  // The token page with its permissions filled in (Cloudflare's template links).
  const perms = [{ key: 'workers_scripts', type: 'edit' }, { key: 'd1', type: 'edit' }, { key: 'account_settings', type: 'read' }];
  $('#token-link').href = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(perms))}`
    + `&accountId=*&zoneId=all&name=${encodeURIComponent('Blockmap')}`;

  function refresh() {
    const repo = saved.repo || '';
    for (const a of document.querySelectorAll('.repo-link')) {
      a.classList.toggle('off', !repo);
      if (repo) a.href = `https://github.com/${repo}${a.dataset.path}`; else a.removeAttribute('href');
    }
    $('#repo-hint').innerHTML = repo
      ? T(`リポジトリ:<code>${repo}</code>(手順 3〜5 のボタンが、このリポジトリを開きます)`, `Repository: <code>${repo}</code> (the buttons in steps 3–5 open it)`)
      : T('入れると、手順 3〜5 のボタンがそのリポジトリを直接開きます', 'Once filled in, the buttons in steps 3–5 open it directly');
    // Without a chosen subdomain, the workflow makes one from the GitHub owner's name (tools/cloudflare.sh).
    const sub = saved.sub || (repo ? repo.split('/')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-') : '');
    const site = sub ? `https://blockmap.${sub}.workers.dev` : '';
    $('#site-hint').innerHTML = !site ? ''
      : saved.sub ? T(`サイトの住所は <code>${site}</code> になります`, `Your site will be at <code>${site}</code>`)
        : T(`サイトの住所は、おそらく <code>${site}</code> になります(手順 5 の実行結果に正しい住所が出ます)`,
          `Your site will most likely be at <code>${site}</code> (step 5's run shows the exact address)`);
    $('#site-link').classList.toggle('off', !site);
    if (site) $('#site-link').href = site; else $('#site-link').removeAttribute('href');
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
  for (const b of document.querySelectorAll('[data-copy]')) b.addEventListener('click', () => copy($(`#${b.dataset.copy}`).textContent));
  for (const b of document.querySelectorAll('[data-copy-name]')) {
    b.title = 'Copy';
    b.addEventListener('click', () => copy(b.previousElementSibling.textContent));
  }

  // ---- ticks ----
  saved.done = saved.done || {};
  for (const step of document.querySelectorAll('.step')) {
    const box = step.querySelector('.done input');
    const n = step.dataset.step;
    box.checked = !!saved.done[n];
    step.classList.toggle('is-done', box.checked);
    box.addEventListener('change', () => { saved.done[n] = box.checked; save(); step.classList.toggle('is-done', box.checked); });
  }

  applyLang();
})();
