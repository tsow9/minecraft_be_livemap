'use strict';
// Contour drawing shared by the page and its background worker (so the heavy part can run off the main thread).
/* exported NO_GROUND, contourStep, decodeGround, drawContour */
var NO_GROUND = -32768;

function contourStep(zoom) {
  if (zoom >= 0) return 4;
  return zoom >= -1 ? 8 : 16;
}

// A ground tile as plain heights (R/G = Y + 65, B = 1 under water).
function decodeGround(d, size) {
  const grid = new Int16Array(size);
  for (let k = 0, i = 0; k < size; k++, i += 4) {
    const v = (d[i] << 8) | d[i + 1];
    grid[k] = v && !d[i + 2] ? v - 65 : NO_GROUND;
  }
  return grid;
}

// p: { bx, bz, n, cell, stride, tx0, tz0, cols, step, dpr }; grids: ground tiles row by row (null = none).
function drawContour(ctx, grids, p) {
  const { bx, bz, n, cell, stride, tx0, tz0, cols, step, dpr } = p;
  const level = new Int32Array((n + 1) * (n + 1)).fill(NO_GROUND);
  const colTile = new Int32Array(n + 1), colOff = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.floor(bx + i * stride);
    colTile[i] = Math.floor(x / 256) - tx0; colOff[i] = x - Math.floor(x / 256) * 256;
  }
  for (let j = 0; j <= n; j++) {
    const z = Math.floor(bz + j * stride);
    const rowTile = (Math.floor(z / 256) - tz0) * cols, rowOff = (z - Math.floor(z / 256) * 256) * 256;
    for (let i = 0; i <= n; i++) {
      const g = grids[rowTile + colTile[i]];
      if (!g) continue;
      const h = g[rowOff + colOff[i]];
      if (h !== NO_GROUND) level[j * (n + 1) + i] = Math.floor(h / step);
    }
  }

  // Lines go on the edge between two cells whose height band differs; every 4th band is bold.
  const thin = [], bold = [];
  const marks = [];  // [x, y, height, bold] for every piece of line, to place the height labels
  const consider = (a, b, x0, y0, x1, y1) => {
    if (a === NO_GROUND || b === NO_GROUND || a === b) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const b4 = Math.floor(hi / 4) * 4;
    const isBold = b4 > lo;
    (isBold ? bold : thin).push(x0, y0, x1, y1);
    // Only the bold lines get numbers, so the map stays easy to read.
    if (isBold) marks.push([(x0 + x1) / 2, (y0 + y1) / 2, b4 * step, true]);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = level[j * (n + 1) + i];
      if (a === NO_GROUND) continue;
      consider(a, level[j * (n + 1) + i + 1], (i + 1) * cell, j * cell, (i + 1) * cell, (j + 1) * cell);
      consider(a, level[(j + 1) * (n + 1) + i], i * cell, (j + 1) * cell, (i + 1) * cell, (j + 1) * cell);
    }
  }
  const labels = placeContourLabels(marks);
  ctx.scale(dpr, dpr);
  ctx.lineCap = 'round';
  const stroke = (segs, color, width) => {
    ctx.beginPath();
    for (let k = 0; k < segs.length; k += 4) { ctx.moveTo(segs[k], segs[k + 1]); ctx.lineTo(segs[k + 2], segs[k + 3]); }
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  stroke(thin, 'rgba(60, 35, 10, 0.55)', 1);
  stroke(bold, 'rgba(60, 35, 10, 0.9)', 2);

  // Like a paper map: the number sits in a gap of its own line, turned to follow it.
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const l of labels) {
    const text = `Y${l.y}`;
    const w = ctx.measureText(text).width;
    ctx.save();
    ctx.translate(l.x, l.y0);
    ctx.rotate(l.angle);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(-w / 2 - 3, -5, w + 6, 10);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255, 250, 235, 0.85)'; ctx.strokeText(text, 0, 0.5);
    ctx.fillStyle = 'rgb(70, 40, 10)'; ctx.fillText(text, 0, 0.5);
    ctx.restore();
  }
}

// Picks up to one spot per quarter of a tile where a line runs fairly straight, and the direction it runs there.
function placeContourLabels(marks) {
  const cells = new Map();
  for (const m of marks) {
    const k = `${Math.floor(m[0] / 16)},${Math.floor(m[1] / 16)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(m);
  }
  const near = (m) => {
    const out = [];
    const ci = Math.floor(m[0] / 16), cj = Math.floor(m[1] / 16);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const o of cells.get(`${ci + di},${cj + dj}`) || []) {
          if (o[2] === m[2] && (o[0] - m[0]) ** 2 + (o[1] - m[1]) ** 2 <= 14 * 14) out.push(o);
        }
      }
    }
    return out;
  };
  const labels = [];
  for (let q = 0; q < 4; q++) {
    const cx = q % 2 ? 192 : 64, cy = q >= 2 ? 192 : 64;
    const mine = marks.filter((m) => m[0] >= 26 && m[0] <= 230 && m[1] >= 14 && m[1] <= 242 &&
      (m[0] >= 128) === (q % 2 === 1) && (m[1] >= 128) === (q >= 2));
    mine.sort((a, b) => ((a[0] - cx) ** 2 + (a[1] - cy) ** 2) - ((b[0] - cx) ** 2 + (b[1] - cy) ** 2));
    for (const m of mine.slice(0, 60)) {
      const pts = near(m);
      if (pts.length < 6) continue;
      // Direction of the line from the spread of nearby pieces (principal axis).
      let mx = 0, my = 0;
      for (const p of pts) { mx += p[0]; my += p[1]; }
      mx /= pts.length; my /= pts.length;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr - l1;
      if (l1 <= 0 || l2 / l1 > 0.12) continue;
      let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      labels.push({ x: mx, y0: my, angle, y: m[2] });
      break;
    }
  }
  return labels;
}

