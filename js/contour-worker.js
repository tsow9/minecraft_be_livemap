'use strict';
/* global contourStep, decodeGround, drawContour */
// Draws contour tiles in the background so moving and zooming the map stays smooth.
importScripts('contour-core.js' + self.location.search);

const grids = new Map();
const cancelled = new Set();

function loadGrid(url) {
  if (grids.has(url)) return grids.get(url);
  const p = fetch(url).then((r) => (r.ok ? r.blob() : null)).then(async (blob) => {
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return decodeGround(ctx.getImageData(0, 0, c.width, c.height).data, c.width * c.height);
  }).catch(() => null);
  grids.set(url, p);
  if (grids.size > 200) grids.delete(grids.keys().next().value);
  return p;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.cancel) { cancelled.add(m.cancel); return; }
  const tiles = await Promise.all(m.urls.map((u) => (u ? loadGrid(u) : null)));
  if (cancelled.delete(m.id)) { self.postMessage({ id: m.id, bitmap: null }); return; }
  const canvas = new OffscreenCanvas(256 * m.p.dpr, 256 * m.p.dpr);
  if (tiles.some(Boolean)) drawContour(canvas.getContext('2d'), tiles, { ...m.p, step: contourStep(m.z) });
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id: m.id, bitmap }, [bitmap]);
};
