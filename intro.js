// Japanese or English: the same choice as the map (blockmap.lang), else the browser's language. The buttons switch.
(() => {
  let lang = null;
  try { lang = localStorage.getItem('blockmap.lang'); } catch { /* private mode */ }
  if (lang !== 'ja' && lang !== 'en') lang = /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
  const show = (l) => {
    document.documentElement.lang = l;
    for (const a of document.querySelectorAll('article')) a.hidden = a.lang !== l;
  };
  for (const b of document.querySelectorAll('button.lang')) {
    b.addEventListener('click', () => {
      lang = lang === 'ja' ? 'en' : 'ja';
      try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
      show(lang);
    });
  }
  show(lang);
})();
