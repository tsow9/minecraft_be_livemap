// Japanese or English: the same choice as the map (blockmap.lang), else the browser's language. The buttons switch.
(() => {
  let lang = null;
  try { lang = localStorage.getItem('blockmap.lang'); } catch { /* private mode */ }
  if (lang !== 'ja' && lang !== 'en') lang = /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
  const show = (l) => {
    document.documentElement.lang = l;
    const t = document.querySelector('title');
    if (t?.dataset[l]) document.title = t.dataset[l];
    for (const a of document.querySelectorAll('article')) a.hidden = a.lang !== l;
  };
  // The globe button opens a list of the two languages (as on the setup page).
  const close = () => { for (const m of document.querySelectorAll('.lang-menu')) { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); } };
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = btn.nextElementSibling, open = m.hidden;
      close();
      m.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      for (const o of m.querySelectorAll('button')) o.classList.toggle('on', o.dataset.lang === lang);
    });
  }
  for (const o of document.querySelectorAll('.lang-menu button')) {
    o.addEventListener('click', () => {
      lang = o.dataset.lang;
      try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
      close();
      show(lang);
    });
  }
  document.addEventListener('click', close);
  show(lang);
})();
