// Japanese or English: the same choice as the map (blockmap.lang), else the browser's language. The button switches.
(() => {
  let lang = null;
  try { lang = localStorage.getItem('blockmap.lang'); } catch { /* private mode */ }
  if (lang !== 'ja' && lang !== 'en') lang = /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
  const btn = document.getElementById('lang');
  const show = (l) => {
    document.documentElement.lang = l;
    for (const a of document.querySelectorAll('article')) a.hidden = a.lang !== l;
    btn.textContent = l === 'ja' ? 'English' : '日本語';
  };
  btn.addEventListener('click', () => {
    lang = lang === 'ja' ? 'en' : 'ja';
    try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
    show(lang);
  });
  show(lang);
})();
