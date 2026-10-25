// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade games' drawing kit (docs/features/arcade.md): a screen of fixed logical size (360 × 480) drawn sharp at the
// device's pixels, our own 5 × 7 pixel font, glow sprites, particles, screen shake, a starfield and the CRT's scanlines
// and vignette. Everything heavy (text, glows, sprites, the CRT layer) is drawn once into a small canvas and stamped, so
// a frame is a few hundred drawImage/fillRect calls at most, fast on a phone. Drawing only: nothing here touches a sim.

export const LW = 360, LH = 480;

// ------------------------------------------------------------------------------------------- the screen
/** A canvas kept at the device's pixels for a LW × LH picture; draw in logical units after begin(). */
export function makeScreen(cv, lw = LW, lh = LH, o = {}) {
  const ctx = cv.getContext('2d', { alpha: !!o.alpha });   // (alpha: a layer over a 3D screen)
  const S = { cv, ctx, lw, lh, k: 1, dpr: 1 };
  S.fit = () => {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    S.k = w / lw; S.dpr = dpr;
  };
  S.begin = () => { ctx.setTransform(S.k, 0, 0, S.k, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; };
  S.fit();
  return S;
}
/** An offscreen canvas of w × h logical px at scale k (device pixels per logical px). */
export function canvas(w, h, k = 1) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k))) : Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.ceil(w * k)), height: Math.max(1, Math.ceil(h * k)) });
  const x = c.getContext('2d');
  x.setTransform(k, 0, 0, k, 0, 0);
  return { c, x, w, h, k };
}

// ------------------------------------------------------------------------------------------- the pixel font (our own)
const G = {
  'A': '.###.#...##...#######...##...##...#', 'B': '####.#...##...#####.#...##...#####.', 'C': '.###.#...##....#....#....#...#.###.',
  'D': '####.#...##...##...##...##...#####.', 'E': '######....#....####.#....#....#####', 'F': '######....#....####.#....#....#....',
  'G': '.###.#...##....#.####...##...#.####', 'H': '#...##...##...#######...##...##...#', 'I': '.###...#....#....#....#....#...###.',
  'J': '..###...#....#....#....#.#..#..##..', 'K': '#...##..#.#.#..##...#.#..#..#.#...#', 'L': '#....#....#....#....#....#....#####',
  'M': '#...###.###.#.##.#.##...##...##...#', 'N': '#...##...###..##.#.##..###...##...#', 'O': '.###.#...##...##...##...##...#.###.',
  'P': '####.#...##...#####.#....#....#....', 'Q': '.###.#...##...##...##.#.##..#..##.#', 'R': '####.#...##...#####.#.#..#..#.#...#',
  'S': '.#####....#.....###.....#....#####.', 'T': '#####..#....#....#....#....#....#..', 'U': '#...##...##...##...##...##...#.###.',
  'V': '#...##...##...##...##...#.#.#...#..', 'W': '#...##...##...##.#.##.#.##.#.#.#.#.', 'X': '#...##...#.#.#...#...#.#.#...##...#',
  'Y': '#...##...#.#.#...#....#....#....#..', 'Z': '#####....#...#...#...#...#....#####', '0': '.###.#...##..###.#.###..##...#.###.',
  '1': '..#...##....#....#....#....#...###.', '2': '.###.#...#....#...#...#...#...#####', '3': '#####...#...#.....#.....##...#.###.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.', '6': '..##..#...#....####.#...##...#.###.',
  '7': '#####....#...#...#...#....#....#...', '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#...#..##..',
  '.': '..........................##...##..', ',': '.....................##....#...#...', ':': '......##...##........##...##.......',
  '!': '..#....#....#....#....#.........#..', '?': '.###.#...#....#...#...#.........#..', '-': '...............#####...............',
  '+': '.......#....#..#####..#....#.......', '/': '....#....#...#...#...#...#....#....', "'": '..#....#...#.......................',
  '*': '..#....#..#####.###..#.#.#...#.....', 'x': '.....#...#.#.#...#...#.#.#...#.....', '<': '...#...#...#...#.....#.....#.....#.',
  '>': '.#.....#.....#.....#...#...#...#...', '#': '.#.#..#.#.#####.#.#.#####.#.#..#.#.', '(': '...#...#...#....#....#.....#.....#.',
  ')': '.#.....#.....#....#....#...#...#...', '=': '..........#####.....#####..........', '$': '..#...#####.#...###...#.#####...#..',
  '@': '......#.#.##########.###...#.......', ' ': '...................................',
};
const GLYPH = new Map(Object.entries(G).map(([k, v]) => [k, v.padEnd(35, '.')]));
const textCache = new Map();
/** The width of a line of pixel text at scale s (logical px). */
export const textW = (str, s = 1) => Math.max(0, String(str).length * 6 - 1) * s;
function glyphOf(ch) { return GLYPH.get(ch) ?? GLYPH.get(ch.toUpperCase()) ?? GLYPH.get('?'); }
/** Draws image src (device pixels) with its top-left at logical (x, y), on whole device pixels: sharp at any scale. */
export function blit(ctx, src, x, y, w = null, h = null) {
  const m = ctx.getTransform(), X = Math.round(m.a * x + m.e), Y = Math.round(m.d * y + m.f);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (w === null) ctx.drawImage(src, X, Y);
  else ctx.drawImage(src, X, Y, Math.round(m.a * (x + w) + m.e) - X, Math.round(m.d * (y + h) + m.f) - Y);
  ctx.setTransform(m);
}
/**
 * Pixel text: our own font, scale s (1 = 5 × 7 px), drawn on whole device pixels (sharp at any screen size): each line
 * once into a cached canvas (with its glow) and stamped. o: { color, glow (a colour, or false), align: 'left' | 'center'
 * | 'right' }.
 */
export function text(ctx, str, x, y, s = 1, o = {}) {
  str = String(str);
  const color = o.color || '#ffffff', glow = o.glow === undefined ? color : o.glow, K = ctx.getTransform().a, P = Math.max(1, Math.round(s * K));
  const key = `${str}|${P}|${color}|${glow}`;
  let t = textCache.get(key);
  if (!t) {
    const pad = glow ? 3 * P : 0, w = Math.max(0, str.length * 6 - 1) * P + pad * 2, h = 7 * P + pad * 2;
    t = canvas(w, h, 1);
    const draw = () => {
      for (let i = 0; i < str.length; i++) {
        const g = glyphOf(str[i]);
        for (let p = 0; p < 35; p++) if (g[p] === '#') t.x.fillRect(pad + (i * 6 + (p % 5)) * P, pad + Math.floor(p / 5) * P, P, P);
      }
    };
    if (glow) { t.x.shadowColor = glow; t.x.shadowBlur = 3 * P; t.x.fillStyle = glow; draw(); t.x.shadowBlur = 0; }
    t.x.fillStyle = color; draw();
    t.pad = pad; t.wd = w - pad * 2;
    if (textCache.size > 500) textCache.delete(textCache.keys().next().value);
    textCache.set(key, t);
  }
  const wl = t.wd / K, ax = o.align === 'center' ? x - wl / 2 : o.align === 'right' ? x - wl : x;
  blit(ctx, t.c, ax - t.pad / K, y - t.pad / K);
}

// ------------------------------------------------------------------------------------------- glows and sprites
const glowCache = new Map();
/** A soft round glow of `color`, radius r (logical px): add it with ctx.globalCompositeOperation = 'lighter'. */
export function glowSprite(color, r, k = 2) {
  const key = `${color}|${r}|${k}`;
  let g = glowCache.get(key);
  if (!g) {
    g = canvas(r * 2, r * 2, k);
    const grd = g.x.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color); grd.addColorStop(0.35, withAlpha(color, 0.35)); grd.addColorStop(1, withAlpha(color, 0));
    g.x.fillStyle = grd; g.x.fillRect(0, 0, r * 2, r * 2);
    glowCache.set(key, g);
  }
  return g;
}
export function glow(ctx, color, x, y, r, a = 1) {
  const g = glowSprite(color, r);
  const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * a;
  ctx.drawImage(g.c, x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
}
/** A colour '#rrggbb' at alpha a, as rgba(). */
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** A colour mixed toward white (t > 0) or black (t < 0). */
export function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => f(c).toString(16).padStart(2, '0')).join('')}`;
}
/** A pixel sprite from rows of '#' and '.', each pixel P device px, in color, with a glow; → { c, w, h, pad } (device px). */
export function pixelSprite(rows, P, color, o = {}) {
  const w = rows[0].length * P, h = rows.length * P, pad = o.glow === false ? 0 : 3 * P;
  const t = canvas(w + pad * 2, h + pad * 2, 1);
  const draw = c => { t.x.fillStyle = c; rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') t.x.fillRect(pad + x * P, pad + y * P, P, P); }); };
  if (pad) { t.x.shadowColor = o.glow || color; t.x.shadowBlur = 3 * P; draw(o.glow || color); t.x.shadowBlur = 0; }
  draw(color);
  if (o.light) { t.x.globalAlpha = 0.35; t.x.fillStyle = '#ffffff'; rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#' && (y === 0 || rows[y - 1][x] !== '#')) t.x.fillRect(pad + x * P, pad + y * P, P, Math.max(1, Math.round(P / 2))); }); t.x.globalAlpha = 1; }
  return { c: t.c, w: w + pad * 2, h: h + pad * 2, pad };
}
const spriteCache = new Map();
/** A pixel sprite for this screen's scale (s logical px a pixel), made once: stamp it with stamp(). */
export function sprite(ctx, key, rows, s, color, o = {}) {
  const P = Math.max(1, Math.round(s * ctx.getTransform().a)), id = `${key}|${P}|${color}`;
  let sp = spriteCache.get(id);
  if (!sp) { sp = pixelSprite(rows, P, color, { light: true, ...o }); sp.P = P; spriteCache.set(id, sp); }
  return sp;
}
/** Stamps a sprite with its pixels' top-left at logical (x, y), on whole device pixels. */
export function stamp(ctx, sp, x, y) {
  const m = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sp.c, Math.round(m.a * x + m.e) - sp.pad, Math.round(m.d * y + m.f) - sp.pad);
  ctx.setTransform(m);
}
export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ------------------------------------------------------------------------------------------- particles, shake, floating text
export class Particles {
  constructor(max = 600) { this.p = []; this.max = max; }
  /** n sparks at (x, y): o = { color, speed, life (s), size, gravity, spread (radians, default all round), dir } */
  burst(x, y, n, o = {}) {
    const sp = o.speed ?? 120, life = o.life ?? 0.6, size = o.size ?? 2, dir = o.dir ?? 0, spread = o.spread ?? Math.PI * 2;
    for (let i = 0; i < n && this.p.length < this.max; i++) {
      const a = dir + (Math.random() - 0.5) * spread, v = sp * (0.35 + Math.random() * 0.65);
      this.p.push({ x, y, vx: Math.sin(a) * v, vy: -Math.cos(a) * v, t: 0, life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8), color: Array.isArray(o.color) ? o.color[i % o.color.length] : o.color || '#ffffff', g: o.gravity ?? 0 });
    }
  }
  update(dt) {
    const p = this.p;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      q.t += dt; if (q.t >= q.life) { p[i] = p[p.length - 1]; p.pop(); continue; }
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - dt * 1.5; q.vy *= 1 - dt * 1.5;
    }
  }
  draw(ctx) {
    if (!this.p.length) return;
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.p) {
      const a = 1 - q.t / q.life;
      ctx.globalAlpha = a; ctx.fillStyle = q.color;
      const s = q.size * (0.5 + a * 0.5);
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = op;
  }
}
export class Shake {
  constructor() { this.a = 0; this.x = 0; this.y = 0; }
  kick(a) { this.a = Math.max(this.a, a); }
  update(dt) { this.a = Math.max(0, this.a - dt * 30); this.x = (Math.random() * 2 - 1) * this.a; this.y = (Math.random() * 2 - 1) * this.a; }
}
/** Words that rise and fade: add(text, x, y, o), draw(ctx, dt). */
export class Floaters {
  constructor() { this.l = []; }
  add(str, x, y, o = {}) { this.l.push({ str, x, y, t: 0, life: o.life || 1.1, s: o.s || 1, color: o.color || '#ffffff', rise: o.rise ?? 26 }); if (this.l.length > 16) this.l.shift(); }
  draw(ctx, dt) {
    for (let i = this.l.length - 1; i >= 0; i--) {
      const f = this.l[i]; f.t += dt;
      if (f.t >= f.life) { this.l.splice(i, 1); continue; }
      const u = f.t / f.life, pop = u < 0.12 ? 0.6 + (u / 0.12) * 0.4 : 1;
      ctx.globalAlpha = u > 0.7 ? (1 - u) / 0.3 : 1;
      text(ctx, f.str, f.x, f.y - f.rise * u, Math.max(1, Math.round(f.s * pop)), { color: f.color, align: 'center' });
      ctx.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------------------------------- backdrops
/** A starfield of three depths that drifts (speed: logical px/s downward). */
export class Stars {
  constructor(n = 90, w = LW, h = LH) {
    this.w = w; this.h = h;
    this.s = Array.from({ length: n }, (_, i) => ({ x: Math.random() * w, y: Math.random() * h, z: (i % 3) + 1, tw: Math.random() * 6 }));
  }
  draw(ctx, dt, speed = 12) {
    for (const s of this.s) {
      s.y += speed * s.z * 0.5 * dt; if (s.y > this.h) { s.y -= this.h; s.x = Math.random() * this.w; }
      s.tw += dt * 3;
      const a = 0.25 + s.z * 0.2 + Math.sin(s.tw) * 0.12;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = s.z === 3 ? '#ffffff' : s.z === 2 ? '#a5b4fc' : '#64748b';
      ctx.fillRect(s.x, s.y, s.z === 3 ? 1.6 : 1, s.z === 3 ? 1.6 : 1);
    }
    ctx.globalAlpha = 1;
  }
}
const crtCache = new Map();
/** The CRT layer over the whole screen: fine scanlines and a vignette, made once per device size. */
export function crt(ctx, S) {
  const key = `${S.cv.width}x${S.cv.height}`;
  let c = crtCache.get(key);
  if (!c) {
    crtCache.clear();
    const W = S.cv.width, H = S.cv.height;
    c = canvas(W, H, 1);
    c.x.fillStyle = 'rgba(0,0,0,0.16)';
    const step = Math.max(2, Math.round(S.k * 1.5));
    for (let y = 0; y < H; y += step) c.x.fillRect(0, y, W, Math.max(1, Math.round(step / 3)));
    const g = c.x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.x.fillStyle = g; c.x.fillRect(0, 0, W, H);
    crtCache.set(key, c);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.c, 0, 0);
  ctx.setTransform(S.k, 0, 0, S.k, 0, 0);
}
/** Whether something blinks on now (period s seconds, on for share of it). */
export const blink = (t, period = 1, share = 0.55) => (t % period) / period < share;
/** "12,345" */
export const fmt = n => Math.max(0, Math.floor(n)).toLocaleString('en-US');
