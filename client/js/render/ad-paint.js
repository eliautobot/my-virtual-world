// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Painting ads (the shop's advertising, shared/ads.js): one painter for every surface - the billboards' faces
// (render/ad-spaces.js), the banners, blimps and balloons (render/promo-aircraft.js), and the ad builder's previews and
// the ad panel (ui/ads.js) - so what a buyer designs is exactly what flies and stands in the world. A picture is
// loaded once per address; textures are kept per ad and shape, and given back when the ad stops running.
import * as THREE from 'three';

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
const images = new Map();   // src → Promise<HTMLImageElement | null>

/** A picture from this site (an ad's upload), loaded once. Resolves null when it can't be loaded. */
export function loadImage(src) {
  if (!src) return Promise.resolve(null);
  let p = images.get(src);
  if (!p) {
    p = new Promise(resolve => { const img = new Image(); img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; });
    images.set(src, p);
  }
  return p;
}
/** The host of an ad's website, for the small line under its title ("joespizza.com"). */
export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Splits text into at most `max` lines that fit width at the context's current font. */
function wrap(x, text, width, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width <= width || !line) line = t;
    else { lines.push(line); line = w; if (lines.length === max) break; }
  }
  if (line && lines.length < max) lines.push(line);   // past max lines the rest is cut (the ad's panel shows it all)
  return lines;
}
/** The largest font (≤ cap) at which text fits the box in at most `max` lines; returns { size, lines }. */
function fit(x, text, w, h, cap, max = 2, weight = 800) {
  let size = cap;
  for (; size > 10; size *= 0.92) {
    x.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(x, text, w, max);
    const words = String(text || '').split(/\s+/).filter(Boolean).length, used = lines.join(' ').split(/\s+/).filter(Boolean).length;
    if (used === words && lines.every(l => x.measureText(l).width <= w) && lines.length * size * 1.12 <= h) return { size, lines };
  }
  x.font = `${weight} ${size}px ${FONT}`;
  return { size, lines: wrap(x, text, w, max) };
}

/** The picture a design shows in a shape: the tall one in tall places (when it has one), else the wide one. */
export const pictureFor = (cr, aspect) => (aspect < 1 && cr.imageTallSrc ? cr.imageTallSrc : cr.imageSrc || cr.imageTallSrc || '');
/** The placement of the picture a shape shows (shared/ads.js picture: crop, fit, zoom, move): the tall one's in tall places. */
export const placementFor = (cr, aspect) => ((aspect < 1 && cr.imageTallSrc ? cr.picTall : cr.picTall && !cr.imageSrc ? cr.picTall : cr.pic) || {});
/** The part of the picture its crop keeps: [sx, sy, sw, sh] in its pixels. */
function cropOf(img, P) {
  const c = P.crop || [0, 0, 1, 1];
  return [c[0] * img.width, c[1] * img.height, Math.max(1, (c[2] - c[0]) * img.width), Math.max(1, (c[3] - c[1]) * img.height)];
}
/**
 * Paints an ad (a checked creative: shared/ads.js normalizeAdCreative) on a W×H canvas. 'image': the picture (cropped)
 * fills the space, shows whole or stretches, zoomed and moved as its placement says. 'logo': the background colour, the
 * picture (cropped) at its place and size, the title in the room beside it and the website's host under it where the
 * shape leaves room; in a tall shape the picture stands above the title. img: the loaded picture (pictureFor) or null.
 * hem: a cloth's hemmed edge. Returns where the picture was drawn ({ x, y, w, h } in canvas pixels, or null).
 */
export function drawCreative(x, W, H, cr, img, { hem = false } = {}) {
  x.save();
  x.fillStyle = cr.backgroundColor || '#ffffff'; x.fillRect(0, 0, W, H);
  let at = null;
  const P = placementFor(cr, W / H);
  if (cr.format === 'image') {
    if (img) {
      const [sx, sy, sw, sh] = cropOf(img, P), z = P.zoom || 1, fitk = P.fit || 'cover';
      let dw, dh;
      if (fitk === 'stretch') { dw = W * z; dh = H * z; }
      else { const k = (fitk === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh)) * z; dw = sw * k; dh = sh * k; }
      const cx = W / 2 + (P.x || 0) * W / 2, cy = H / 2 + (P.y || 0) * H / 2;
      at = { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh };
      x.drawImage(img, sx, sy, sw, sh, at.x, at.y, dw, dh);
    }
  } else if (W / H < 1.25) {   // tall or square: the picture above, the title and the website below
    const pad = W * 0.08, title = String(cr.title || '').trim(), host = hostOf(cr.website);
    let ty0 = pad;
    if (img && cr.imageSrc) {
      const [sx, sy, sw, sh] = cropOf(img, P);
      const lw = Math.min(W - pad * 2, W * (cr.logoSize ?? 74) / 100), lh = Math.min(H * 0.48, lw * sh / sw), lw2 = lh * sw / sh;
      at = { x: (W - lw2) / 2, y: pad + (title ? 0 : (H - pad * 2 - lh) / 2), w: lw2, h: lh };
      x.drawImage(img, sx, sy, sw, sh, at.x, at.y, lw2, lh);
      ty0 = pad + lh + pad * 0.6;
    }
    if (title) {
      const th = H - ty0 - pad - (host ? H * 0.08 : 0);
      const { size, lines } = fit(x, title, W - pad * 2, th, W * 0.2, 5);
      x.fillStyle = cr.textColor || '#111827'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const top = ty0 + (th - lines.length * size * 1.12) / 2;
      lines.forEach((l, i) => x.fillText(l, W / 2, top + size * 0.56 + i * size * 1.12));
    }
    if (host) { x.globalAlpha = 0.75; x.fillStyle = cr.textColor || '#111827'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `600 ${W * 0.065}px ${FONT}`; x.fillText(host, W / 2, H - pad - H * 0.03); x.globalAlpha = 1; }
  } else {
    const pad = H * 0.08;
    let tx0 = pad, tx1 = W - pad;
    if (img && cr.imageSrc) {
      const [sx, sy, sw, sh] = cropOf(img, P);
      const lh = Math.min(H - pad * 2, H * (cr.logoSize ?? 74) / 100), lw = Math.min(W * 0.46, lh * sw / sh), lh2 = lw * sh / sw;
      const lx = pad + (W - pad * 2 - lw) * (cr.logoX ?? 4) / 100, ly = pad + (H - pad * 2 - lh2) * (cr.logoY ?? 50) / 100;
      at = { x: lx, y: ly, w: lw, h: lh2 };
      x.drawImage(img, sx, sy, sw, sh, lx, ly, lw, lh2);
      if (lx + lw / 2 < W / 2) tx0 = lx + lw + pad; else tx1 = lx - pad;
    }
    const title = String(cr.title || '').trim(), host = hostOf(cr.website);
    if (title && tx1 - tx0 > H * 0.4) {
      const room = W / H <= 3.4 && host, th = H - pad * 2 - (room ? H * 0.2 : 0);
      const { size, lines } = fit(x, title, tx1 - tx0, th, H * (W / H > 4 ? 0.5 : 0.32), W / H > 4 ? 1 : 2);
      x.fillStyle = cr.textColor || '#111827'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const cx = (tx0 + tx1) / 2, total = lines.length * size * 1.12 + (room ? H * 0.16 : 0), top = (H - total) / 2;
      lines.forEach((l, i) => x.fillText(l, cx, top + size * 0.56 + i * size * 1.12));
      if (room) { x.globalAlpha = 0.75; x.font = `600 ${Math.min(H * 0.1, size * 0.5)}px ${FONT}`; x.fillText(host, cx, top + lines.length * size * 1.12 + H * 0.08); x.globalAlpha = 1; }
    }
  }
  if (hem) { x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = Math.max(4, H * 0.035); x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, W - x.lineWidth, H - x.lineWidth); }
  x.restore();
  return at;
}
/** The house's turn on a billboard: "Advertise here", in the world's own colours. */
export function drawHouse(x, W, H, { title = 'Advertise here', line = 'Tap to book this space', world = '' } = {}) {
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d3557'); g.addColorStop(1, '#274c77');
  x.save(); x.fillStyle = g; x.fillRect(0, 0, W, H);
  const band = Math.min(H * 0.16, W * 0.12);
  x.fillStyle = '#ffd166'; x.fillRect(0, H - band, W, band);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const tall = W / H < 1.25, { size, lines } = fit(x, title, W * 0.86, tall ? H * 0.4 : H * 0.42, tall ? W * 0.2 : H * 0.3, tall ? 3 : 1);
  x.fillStyle = '#ffffff';
  const top = (tall ? H * 0.34 : H * 0.36) - (lines.length - 1) * size * 0.56;
  lines.forEach((l, i) => x.fillText(l, W / 2, top + i * size * 1.12));
  if (line) { x.font = `600 ${Math.min(tall ? W * 0.07 : H * 0.1, size * 0.45)}px ${FONT}`; x.fillStyle = '#cfe0f5'; x.fillText(line, W / 2, tall ? H * 0.7 : H * 0.62, W * 0.9); }
  if (world) { x.font = `800 ${band * 0.5}px ${FONT}`; x.fillStyle = '#1d3557'; x.fillText(world.toUpperCase(), W / 2, H - band / 2, W * 0.9); }
  x.restore();
}
/** A sign that shows nothing yet (or one an administrator hid): a calm panel with a line of text. */
export function drawBlank(x, W, H, text = '') {
  x.save(); x.fillStyle = '#2c3138'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = Math.max(4, Math.min(W, H) * 0.03); x.strokeRect(x.lineWidth, x.lineWidth, W - x.lineWidth * 2, H - x.lineWidth * 2);
  if (text) { x.fillStyle = '#c9ced6'; x.textAlign = 'center'; x.textBaseline = 'middle'; const { size, lines } = fit(x, text, W * 0.8, H * 0.6, Math.min(W, H) * 0.16, 3, 600); const top = H / 2 - (lines.length - 1) * size * 0.56; lines.forEach((l, i) => x.fillText(l, W / 2, top + i * size * 1.12)); }
  x.restore();
}
/** The administrators' own advertisement on the aircraft (shared/promo.js normalizeGraphic): picture and/or text. */
export function drawGraphic(x, W, H, g, img, { hem = true } = {}) {
  x.save();
  x.globalAlpha = 1; x.fillStyle = g.backgroundColor; x.fillRect(0, 0, W, H);
  x.globalAlpha = g.opacity;
  if (img) {
    const s = (g.fit === 'contain' ? Math.min(W / img.width, H / img.height) : Math.max(W / img.width, H / img.height)) * g.scale;
    x.drawImage(img, (W - img.width * s) / 2 + g.offsetX * W / 2, (H - img.height * s) / 2 + g.offsetY * H / 2, img.width * s, img.height * s);
  }
  const text = String(g.text || '').trim();
  if (text) {
    let size = H * 0.6; const font = sz => `800 ${sz}px ${FONT}`; x.font = font(size);
    while (x.measureText(text).width > W * 0.9 && size > 16) { size *= 0.92; x.font = font(size); }
    x.fillStyle = g.textColor; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, W / 2, H / 2 + size * 0.04);
  }
  x.globalAlpha = 1;
  if (hem) { x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = Math.max(4, H * 0.035); x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, W - x.lineWidth, H - x.lineWidth); }
  x.restore();
}

/**
 * Textures for ads, one per ad and shape, shared by every surface showing it. get(key, aspect, paint(x, W, H, img),
 * src): painted at once, and again when its picture arrives. keep(keys): gives back the textures no longer needed.
 */
export class AdTextures {
  /** width: every texture's width; or long: its longer side (for shapes of any aspect). */
  constructor({ width = 1024, long = 0, anisotropy = 8 } = {}) { this.width = width; this.long = long; this.anisotropy = anisotropy; this.map = new Map(); }
  get(key, aspect, paint, src = null) {
    let e = this.map.get(key);
    if (e) return e.tex;
    const c = document.createElement('canvas');
    if (this.long) { c.width = Math.max(64, Math.round(aspect >= 1 ? this.long : this.long * aspect)); c.height = Math.max(64, Math.round(c.width / aspect)); }
    else { c.width = this.width; c.height = Math.max(64, Math.round(this.width / aspect)); }
    const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.anisotropy;
    e = { tex, canvas: c };
    this.map.set(key, e);
    paint(x, c.width, c.height, null); tex.needsUpdate = true;
    if (src) loadImage(src).then(img => { if (!img || this.map.get(key) !== e) return; paint(x, c.width, c.height, img); tex.needsUpdate = true; });
    return tex;
  }
  keep(keys) { const want = new Set(keys); for (const [k, e] of this.map) if (!want.has(k)) { e.tex.dispose(); this.map.delete(k); } }
  clear() { this.keep([]); }
}
