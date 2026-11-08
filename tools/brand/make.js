// Makes Chizuya's logo files: the ensō with the compass, and the name, both drawn by a small brush model.
//   node tools/brand/make.js            writes favicon.svg, logo.svg, logo-dark.svg, tools/brand/mark.svg
// The PNG icons (icons/*.png, apple-touch-icon.png) are made from favicon.svg by tools/brand/png.js (needs Playwright).
//
// The brush: each stroke is one inked shape along a centre line. Its width follows the pressure (a narrow touch where
// the brush lands, a press a little wider than the stroke, then steady; heavier going down than across), its edges
// waver a little, and where the brush runs short of ink (only near the end) white streaks open inside it, each from a
// hairline widening to the end, so the stroke ends square, split into bristle marks. The streaks are holes (a mask),
// so the logo sits on any background.
const fs = require('fs');
const path = require('path');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const STEP = .02;
const f2 = (v) => (Math.round(v * 100) / 100).toString();
// fewer points where a line is nearly straight (Ramer-Douglas-Peucker), so the files stay small
function simplify(pts, tol = .006) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], L = Math.hypot(bx - ax, by - ay) || 1e-9;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > far) { far = d; at = i; } }
  return far <= tol ? [pts[0], pts[pts.length - 1]] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}
const ptsStr = (list) => list.map((q) => f2(q[0]) + ',' + f2(q[1])).join(' ');

// evenly spaced points (with direction) along a polyline
function resample(raw) {
  const out = [raw[0]]; let acc = 0;
  for (let k = 1; k < raw.length; k++) {
    let [ax, ay] = raw[k - 1]; const [bx, by] = raw[k]; let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= STEP) { const r = (STEP - acc) / seg; ax += (bx - ax) * r; ay += (by - ay) * r; out.push([ax, ay]); seg = Math.hypot(bx - ax, by - ay); acc = 0; }
    acc += seg;
  }
  return out.map((p, k) => { const a = out[Math.max(0, k - 2)], b = out[Math.min(out.length - 1, k + 2)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { x: p[0], y: p[1], tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L }; });
}
// centre line from an SVG path (absolute M L H V C)
function samplePath(d) {
  const tok = d.match(/[MLHVC]|-?\d*\.?\d+/g); let i = 0, cmd = '', x = 0, y = 0; const raw = [];
  const num = () => parseFloat(tok[i++]);
  const line = (nx, ny) => { for (let k = 1; k <= 20; k++) raw.push([x + (nx - x) * k / 20, y + (ny - y) * k / 20]); x = nx; y = ny; };
  while (i < tok.length) {
    if (/[MLHVC]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { x = num(); y = num(); raw.push([x, y]); cmd = 'L'; }
    else if (cmd === 'L') line(num(), num());
    else if (cmd === 'H') line(num(), y);
    else if (cmd === 'V') line(x, num());
    else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
      for (let k = 1; k <= 60; k++) { const t = k / 60, u = 1 - t; raw.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); }
      x = x3; y = y3;
    }
  }
  return resample(raw);
}

let uid = 0;
function stroke(pts, o = {}) {
  const { width = 1.24, down = .24, dry = .5, streaks = 9, seed = 1, fill = '#1d1d22', slantIn = .22, pressure = null,
    rough = .035, dryFrom = .85, entry = .45, press = .12 } = o;
  const R = rng(seed), n = pts.length, id = `m${o.idp || ''}${++uid}`;
  const waves = () => { const a = [R() * 6, R() * 6, R() * 6]; return (t) => .55 * Math.sin(t * 9 + a[0]) + .3 * Math.sin(t * 23 + a[1]) + .15 * Math.sin(t * 61 + a[2]); };
  const eL = waves(), eR = waves(), d0 = dryFrom;
  const W = (k) => {
    const t = k / (n - 1), p = pts[k], dist = k * STEP, e = Math.min(1, dist / entry);
    let w = pressure ? pressure(t) : 1;
    w *= (.62 + .38 * Math.sin(e * Math.PI / 2)) * (1 + press * Math.sin(Math.min(1, dist / (entry * 1.8)) * Math.PI));
    return width * w * (1 - down + down * Math.abs(p.ty));
  };
  const left = [], right = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), p = pts[k], w = W(k) / 2, r = rough + .09 * dry * sm(d0, 1, t);
    let lx = p.x - p.ty * w * (1 + r * eL(t)), ly = p.y + p.tx * w * (1 + r * eL(t));
    const rx = p.x + p.ty * w * (1 + r * eR(t)), ry = p.y - p.tx * w * (1 + r * eR(t));
    const lag = slantIn * w * 2 * Math.pow(Math.max(0, 1 - k * STEP / (entry * .9)), 2);   // one side lands a moment later
    lx += p.tx * lag; ly += p.ty * lag;
    left.push([lx, ly]); right.push([rx, ry]);
  }
  // the start: rounded (the brush's belly), not cut
  const p0 = pts[0], [ax, ay] = right[0], [bx, by] = left[0], cx = (ax + bx) / 2 - p0.tx * W(0) * .32, cy = (ay + by) / 2 - p0.ty * W(0) * .32;
  const cap = []; for (let j = 1; j < 10; j++) { const u = j / 10; cap.push([(1 - u) * (1 - u) * ax + 2 * u * (1 - u) * cx + u * u * bx, (1 - u) * (1 - u) * ay + 2 * u * (1 - u) * cy + u * u * by]); }
  const thin = (list) => simplify(list);
  const poly = ptsStr([...thin(left), ...thin(right).reverse(), ...cap.filter((q, k) => k % 2 === 0)]);
  // dry streaks, cut out of the stroke
  let holes = '';
  for (let i = 0; i < Math.round(streaks * dry); i++) {
    const u = (R() - .5) * .86, t0 = d0 + R() * (1 - d0) * .55, wmax = .04 + R() * .1, wig = R() * 6;
    const a = Math.floor(t0 * (n - 1)), l = [], r = [];
    for (let k = a; k < n; k++) {
      const t = k / (n - 1), p = pts[k], w = W(k), fct = sm(t0, 1, t), uu = u + .03 * Math.sin(t * 15 + wig);
      const half = w * wmax * Math.pow(fct, .8) / 2, x0 = p.x - p.ty * uu * w, y0 = p.y + p.tx * uu * w;
      l.push([x0 - p.ty * half, y0 + p.tx * half]); r.push([x0 + p.ty * half, y0 - p.tx * half]);
    }
    const e = pts[n - 1], ew = W(n - 1), half = ew * wmax / 2, x0 = e.x - e.ty * u * ew + e.tx * .4, y0 = e.y + e.tx * u * ew + e.ty * .4;
    l.push([x0 - e.ty * half, y0 + e.tx * half]); r.push([x0 + e.ty * half, y0 - e.tx * half]);
    holes += `<polygon points="${ptsStr([...thin(l), ...thin(r).reverse()])}"/>`;
  }
  if (!holes) return `<polygon points="${poly}" fill="${fill}"/>`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200"><polygon points="${poly}" fill="#fff"/><g fill="#000">${holes}</g></mask>`
    + `<polygon points="${poly}" fill="${fill}" mask="url(#${id})"/>`;
}

// ---- the mark: an ensō (one round stroke) with the compass inside ----
const P = (a, r) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)];
function enso(ink, idp) {
  const R = rng(3), ph = R() * 6, raw = [];
  for (let k = 0; k <= 400; k++) { const t = k / 400, a = 29 + (343 - 29) * t; raw.push(P(a, 5.4 * (1 + .016 * Math.sin(t * Math.PI * 2.1 + ph) + .03 * Math.cos(2 * (a - 25) * Math.PI / 180)) - .25 * t)); }
  return stroke(resample(raw), { fill: ink, idp, width: 1.8, down: .06, dry: .9, streaks: 20, seed: 5, slantIn: .14, entry: 1.1, press: .12, rough: .03, dryFrom: .9, pressure: (t) => 1 - .12 * t });
}
const RAYS = [[0, 2.7, .55], [90, 2.7, .55], [180, 2.7, .55], [270, 2.7, .55], [45, 1.7, .38], [135, 1.7, .38], [225, 1.7, .38], [315, 1.7, .38]];
const star = () => RAYS.map(([a, L, b]) => `<g transform="rotate(${a})"><path d="M0,0L${-b},${-b}L0,${-L}Z" fill="#9c7428"/><path d="M0,0L${b},${-b}L0,${-L}Z" fill="#d9b562"/></g>`).join('');
const needle = (south) => `<path d="M0,-4.3L.62,0L-.62,0Z" fill="#c63b2f"/><path d="M-.62,0L.62,0L0,4.3Z" fill="${south}"/><circle r=".58" fill="#b38a36"/><circle r=".22" fill="#f3ecdc"/>`;
// light: on paper; dark: on a dark page
const COL = { light: { ring: '#141923', ink: '#1d1d22', south: '#1d1d22' }, dark: { ring: '#f3ecdc', ink: '#f3ecdc', south: '#e6dcc6' } };
const markBody = (c, idp) => `<g transform="rotate(20) scale(-1,1)">${enso(c.ring, idp)}</g>${star()}${needle(c.south)}`;

// ---- the name, drawn for this one word, stroke by stroke in the order a hand writes it ----
const LET = {
  C: { w: 4.1, s: [['M3.85,1.35 C3.0,.15 .4,.2 .35,3.6 C.3,7.1 3.0,7.35 3.95,5.85', .6]] },
  h: { w: 4.3, s: [['M.6,0 V7', .35], ['M.6,4.3 C1.0,2.45 3.55,2.15 3.6,4.0 V7', .55]] },
  i: { w: 1.5, s: [['M.6,2.4 V7', .5]], dot: [.6, .75] },
  z: { w: 4.3, s: [['M.3,2.5 H3.6 L.3,7.0 H3.95', .6]] },
  u: { w: 4.3, s: [['M.6,2.4 V5.1 C.6,7.35 3.6,7.35 3.6,5.0', .15], ['M3.6,2.4 V7', .55]] },
  y: { w: 4.3, s: [['M.6,2.4 V4.7 C.6,6.65 3.6,6.65 3.6,4.7', .15], ['M3.6,2.4 V7.8 C3.6,9.7 1.4,9.85 -.9,9.15', .75]] },
  a: { w: 4.3, s: [['M.7,3.1 C1.4,2.2 3.6,2.1 3.6,3.95 V7', .55], ['M3.6,4.6 C1.2,4.3 .3,5.0 .35,5.9 C.4,7.3 2.6,7.3 3.6,6.2', .1]] },
};
function wordBody(ink, idp) {
  let x = 0, s = '', n = 0;
  for (const ch of 'Chizuya') {
    const g = LET[ch];
    for (const [d, dry] of g.s) s += stroke(samplePath(d).map((p) => ({ ...p, x: p.x + x })), { fill: ink, idp, width: 1.41, dry, streaks: 9, seed: 11 + n++ * 7, dryFrom: .85 });
    if (g.dot) { const [dx, dy] = g.dot; s += `<path d="M${f2(dx + x - .55)},${f2(dy + .1)}Q${f2(dx + x - .3)},${f2(dy - .7)} ${f2(dx + x + .5)},${f2(dy - .25)}Q${f2(dx + x + .4)},${f2(dy + .55)} ${f2(dx + x - .55)},${f2(dy + .1)}Z" fill="${ink}"/>`; }
    x += g.w + 1.25;
  }
  return { body: s, w: x - 1.25 };
}

const svg = (vb, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}>${body}</svg>\n`;
const root = path.join(__dirname, '..', '..');
const out = (name, text) => { fs.writeFileSync(path.join(root, name), text); console.log(`${name}: ${(text.length / 1024).toFixed(1)} KB`); };

// the mark alone, on a transparent ground
out('tools/brand/mark.svg', svg('-7.5 -7.5 15 15', markBody(COL.light, 'a')));
// the browser tab and home screen icon: the mark on a paper-coloured rounded square (reads on light and dark tabs)
out('favicon.svg', svg('-7.5 -7.5 15 15', `<rect x="-7.5" y="-7.5" width="15" height="15" rx="3.2" fill="#ffffff"/><g transform="scale(.9)">${markBody(COL.light, 'f')}</g>`));
// the mark and the name side by side, for page headings: logo.svg on light pages, logo-dark.svg on dark ones
for (const [name, c] of [['logo.svg', COL.light], ['logo-dark.svg', COL.dark]]) {
  const idp = name === 'logo.svg' ? 'l' : 'd', wd = wordBody(c.ink, idp);
  // the mark is 15 units; the name is drawn about 11 units tall: scale it to sit beside the mark
  const k = .95, wx = 17.5;
  out(name, svg(`-7.6 -7.6 ${wx + wd.w * k + 2.6} 15.2`, `${markBody(c, idp)}<g transform="translate(${wx - 7.5 + 1.3},${-4.4}) scale(${k})">${wd.body}</g>`));
}
