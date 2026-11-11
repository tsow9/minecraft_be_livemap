// The PNG icons, drawn from favicon.svg and tools/brand/mark.svg (made by tools/brand/make.py; node tools/brand/png.js; needs Playwright).
//   icons/icon-32.png, icon-192.png, icon-512.png   the rounded paper tile, as favicon.svg
//   icons/icon-maskable-512.png, apple-touch-icon.png   full-bleed paper with the mark inside the safe area
//   (Android and iOS cut their own shape out of these)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..');
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (file, size, html) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent">${html}</body></html>`);
    await page.screenshot({ path: path.join(root, file), omitBackground: true });
    console.log(file);
  };
  const tile = (s) => `<img src="data:image/svg+xml;base64,${b64('favicon.svg')}" style="width:${s}px;height:${s}px;display:block">`;
  const bleed = (s, k) => `<div style="width:${s}px;height:${s}px;background:#ffffff;display:flex;align-items:center;justify-content:center"><img src="data:image/svg+xml;base64,${b64('tools/brand/mark.svg')}" style="width:${s * k}px;height:${s * k}px"></div>`;
  for (const s of [32, 192, 512]) await shot(`icons/icon-${s}.png`, s, tile(s));
  await shot('icons/icon-maskable-512.png', 512, bleed(512, .68));
  await shot('apple-touch-icon.png', 180, bleed(180, .8));
  await browser.close();
})();
