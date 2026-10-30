'use strict';
// The site's language: Japanese or English. The viewer's choice (Realms情報 › Language) wins; otherwise the
// browser's language. Game words in English are the game's own (Mojang's en_US.lang), like the Japanese ones.
const LANG = (() => {
  try {
    const saved = localStorage.getItem('blockmap.lang');
    if (saved === 'ja' || saved === 'en') return saved;
  } catch { /* private mode */ }
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
})();
document.documentElement.lang = LANG;

function setLang(lang) {
  try { localStorage.setItem('blockmap.lang', lang); } catch { /* private mode */ }
  location.reload();
}

// tl('{n}人がプレイ中', { n: 3 }) → "3人がプレイ中" or "3 playing". The Japanese text is the key.
function tl(ja, params) {
  let s = LANG === 'en' && Object.prototype.hasOwnProperty.call(I18N_EN, ja) ? I18N_EN[ja] : ja;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

// The page's fixed words (index.html): text, and the title / placeholder / aria-label of each element.
function translatePage(root = document.body) {
  if (LANG === 'ja') return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue.trim();
    if (s && Object.prototype.hasOwnProperty.call(I18N_EN, s)) n.nodeValue = n.nodeValue.replace(s, I18N_EN[s]);
  }
  // Where the same Japanese word needs other English (the chips are plural: 村人 → Villagers).
  for (const el of root.querySelectorAll('[data-en]')) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) n.nodeValue = el.dataset.en;
  }
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && Object.prototype.hasOwnProperty.call(I18N_EN, v)) el.setAttribute(a, I18N_EN[v]);
    }
  }
}

const I18N_EN = {};
