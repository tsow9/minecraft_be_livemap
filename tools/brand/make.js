// The logo files, drawn from the owner's SVGs in tools/brand (node tools/brand/make.js; needs Playwright):
//   logo.svg       the star and the name    -> logo.png (440px high, transparent)
//   app-icon.svg   the star on its paper     -> favicon.svg (rounded), icons/*.png, apple-touch-icon.png
//   mark.svg       the star alone (kept for other uses)
// The README's logo for GitHub's dark mode (docs/readme-logo-dark.png, the ink turned light; the owner chose it for the
// README only, 2026-11-16): node tools/brand/make.js readme  (draws only that one)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const app = read('app-icon.svg');
// The browser-tab icon: the app icon with rounded corners (the paper's <rect> gets rx).
const rounded = app.replace(/<title>[^<]*<\/title>/, '').replace('<rect width="112" height="112"', '<rect width="112" height="112" rx="23.5"');
fs.writeFileSync(path.join(root, 'favicon.svg'), rounded);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (file, w, h, svg) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;overflow:hidden;background:transparent"><img src="${uri(svg)}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
    await page.waitForFunction(() => document.images[0].complete);
    await page.screenshot({ path: path.join(root, file), omitBackground: true });
    console.log(file);
  };
  const logo = read('logo.svg');
  const [, , vw, vh] = logo.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const dark = async () => {   // the same picture with its ink made light, for dark backgrounds
    const h = 220, w = Math.round(h * vw / vh);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;overflow:hidden;background:transparent"><img src="${uri(logo)}" style="display:block;width:${w}px;height:${h}px;filter:invert(1) sepia(0.12) brightness(0.96)"></body></html>`);
    await page.waitForFunction(() => document.images[0].complete);
    await page.screenshot({ path: path.join(root, 'docs/readme-logo-dark.png'), omitBackground: true });
    console.log('docs/readme-logo-dark.png');
  };
  if (process.argv[2] === 'readme') { await dark(); await browser.close(); return; }
  await dark();
  await shot('logo.png', Math.round(440 * vw / vh), 440, logo);
  for (const s of [32, 192, 512]) await shot(`icons/icon-${s}.png`, s, s, rounded);
  await shot('icons/icon-maskable-512.png', 512, 512, app); // Android and iOS cut their own shape out of these
  await shot('apple-touch-icon.png', 180, 180, app);
  await browser.close();
})();
