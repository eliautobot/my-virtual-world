// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
/* The loading screen's moving art: a glowing line figure for each step of loading (a padlock, the globe, a road, the
   skyline rising, a furnished room, residents walking, sunrise, a street lamp), each with its own motion, and between two
   figures a transformation - the lines break into sparks that swirl across and join up as the next figure. Also the status
   line and the progress line. (The sparks rising off the logo are CSS: js/loading.js.)

   It draws on its own canvas, in a worker when the browser can hand a canvas to one (OffscreenCanvas), so it keeps moving
   smoothly while the page is busy building the world; on the page otherwise. js/loading.js starts it. No imports: this file
   runs as a classic worker script and as a page script (window.MVWLoadingArt). */
(function (G) {
  'use strict';
  const K = 320;                 // particles every figure is sampled into (one count, so any figure can become any other)
  const FW = 240, FH = 160;      // a figure's own units; the page's .ld-fig box is FW × FH of them
  const CX = 120, CY = 82;       // the swirl's centre
  const MORPH = 1.25;            // seconds a transformation takes
  const HOLD = 0.6;              // seconds a figure stays at least, once formed, before the next transformation
  const STAGGER = 0.24;          // the transformation runs left to right across the figure over this share of it
  const TAU = Math.PI * 2, PI = Math.PI;

  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const backOut = t => { const c = 1.6; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const wave = (T, rate, ph) => 0.5 + 0.5 * Math.sin(T * rate + ph);
  const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ------------------------------------------------------------------ figure building blocks (figure units, y down)
  const st = (pts, o) => ({ pts, closed: !!(o && o.closed), w: o && o.w != null ? o.w : 1, a: o && o.a != null ? o.a : 1, dot: (o && o.dot) || 0 });
  const line = (x1, y1, x2, y2, o) => st([[x1, y1], [x2, y2]], o);
  const poly = (pts, o) => st(pts, o);
  const dot = (x, y, r, o) => st([[x, y]], Object.assign({}, o, { dot: r }));
  function arc(cx, cy, rx, ry, a0, a1, n) {
    const p = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return p;
  }
  function ring(cx, cy, rx, ry, o, n) { const p = arc(cx, cy, rx, ry, 0, TAU, n || 40); p.pop(); return st(p, Object.assign({}, o, { closed: true })); }
  function rrectPts(x, y, w, h, r) {
    const p = [], c = [[x + w - r, y + r, -PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, PI / 2], [x + r, y + r, PI]];
    for (const [cx, cy, a] of c) for (let i = 0; i <= 3; i++) { const t = a + i * PI / 6; p.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
    return p;
  }
  const rrect = (x, y, w, h, r, o) => st(rrectPts(x, y, w, h, r), Object.assign({}, o, { closed: true }));
  function rot(pts, cx, cy, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
  }
  function quad(x0, y0, x1, y1, x2, y2, n) {
    const p = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; p.push([u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]); }
    return p;
  }

  // ------------------------------------------------------------------ the figures: (t since it began, T clock) → strokes
  const FIG = {};

  /** Checking your account: a padlock whose shackle lifts open and drops back (locked: it stays shut). */
  function padlock(t, T, locked) {
    const top = 78, out = [];
    const u = (T % 2.8) / 2.8;
    const lift = locked ? 0 : 12 * (u < 0.2 ? backOut(u / 0.2) : u < 0.58 ? 1 : u < 0.72 ? 1 - ease((u - 0.58) / 0.14) : 0);
    out.push(rrect(CX - 36, top, 72, 56, 10, { w: 1.15 }));
    const sh = [[CX + 23, top - lift + (locked ? 0 : 2)], [CX + 23, top - 16 - lift]];
    for (const p of arc(CX, top - 16 - lift, 23, 23, 0, -PI, 14)) sh.push(p);
    sh.push([CX - 23, top - lift]);
    out.push(poly(sh, { w: 1.15 }));
    out.push(dot(CX, top + 23, 5, { a: 0.75 + 0.25 * wave(T, 3.1, 0) }));
    out.push(line(CX, top + 27, CX, top + 40, { w: 1.6 }));
    out.push(line(CX - 27, top + 10, CX - 27, top + 46, { a: 0.3, w: 0.8 }));   // a glint down the body
    for (let i = 0; i < 3; i++) {   // sparkles as it springs open
      const k = locked ? 0 : sm(0.16, 0.24, u) * (1 - sm(0.36, 0.5, u));
      const a = -PI / 2 + (i - 1) * 0.75, r = 46 + 8 * sm(0.16, 0.5, u);
      out.push(dot(CX + Math.cos(a) * r, top - 16 - lift + 10 + Math.sin(a) * r * 0.7, 2.2, { a: k }));
    }
    return out;
  }
  FIG.account = (t, T) => padlock(t, T, false);
  FIG.signin = (t, T) => padlock(t, T, true);

  /** Loading the city: a turning globe, its meridians coming round the front, a satellite on a tilted orbit. */
  FIG.city = (t, T) => {
    const cx = CX, cy = 80, R = 50, tilt = 0.38, ct = Math.cos(tilt), stt = Math.sin(tilt), out = [];
    const P = (phi, lam) => {
      const x = R * Math.cos(phi) * Math.sin(lam), y = R * Math.sin(phi), z = R * Math.cos(phi) * Math.cos(lam);
      return [cx + x, cy - (y * ct - z * stt)];
    };
    out.push(ring(cx, cy, R, R, { w: 1.2 }, 56));
    for (let k = 0; k < 12; k++) {
      const lam = T * 0.45 + k * PI / 6, pts = [];
      for (let i = 0; i <= 14; i++) pts.push(P(-PI / 2 + PI * i / 14, lam));
      out.push(poly(pts, { a: 0.12 + 0.72 * sm(-0.3, 0.4, Math.cos(lam)), w: 0.85 }));
    }
    for (const phi of [-0.6, 0, 0.6]) {
      const pts = [];
      for (let i = 0; i < 36; i++) pts.push(P(phi, i * TAU / 36));
      out.push(st(pts, { closed: true, a: phi === 0 ? 0.6 : 0.38, w: 0.85 }));
    }
    const orb = (a) => { const x = 78 * Math.cos(a), y = 17 * Math.sin(a), r = -0.28; return [cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]; };
    const ringPts = []; for (let i = 0; i < 48; i++) ringPts.push(orb(i * TAU / 48));
    out.push(st(ringPts, { closed: true, a: 0.22, w: 0.7 }));
    const sa = T * 1.25;
    for (let i = 0; i < 6; i++) {   // the satellite and its fading trail; dim while behind the globe
      const a = sa - i * 0.09, [x, y] = orb(a), behind = Math.sin(a) < 0 && Math.hypot(x - cx, y - cy) < R;
      out.push(dot(x, y, i ? 2.4 - i * 0.32 : 3.2, { a: (behind ? 0.18 : 1) * (1 - i * 0.16) }));
    }
    return out;
  };

  /** Building streets: driving down a road at night - the centre line and lamp posts rush past, a car ahead. */
  FIG.streets = (t, T) => {
    const hy = 48, vx = CX, out = [], f = 92, near = 1, far = 30;
    const sx = (X, Z) => vx + f * X / Z, sy = (Y, Z) => hy + f * (1 - Y) / Z;   // ground units; Y: height above the road
    const loop = (i, per, n, ph) => near + (((i * per + ph - T * 2.3) % (n * per)) + n * per) % (n * per);
    out.push(line(sx(-0.95, near), sy(0, near), sx(-0.95, far), sy(0, far), { w: 1.2 }));
    out.push(line(sx(0.95, near), sy(0, near), sx(0.95, far), sy(0, far), { w: 1.2 }));
    for (let i = 0; i < 14; i++) {   // the centre line
      const z = loop(i, 1.1, 14, 0), a = sm(near, near + 0.35, z) * (1 - sm(9, 15, z));
      out.push(line(vx, sy(0, z), vx, sy(0, z + 0.5), { a, w: 0.45 + 0.9 / z }));
    }
    for (const side of [-1, 1]) out.push(line(sx(side * 1.35, near), sy(0, near), sx(side * 1.35, far), sy(0, far), { a: 0.32, w: 0.75 }));   // pavements
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {   // lamp posts both sides
      const z = loop(i, 2.8, 4, side > 0 ? 1.4 : 0), a = sm(near, near + 0.5, z) * (1 - sm(6, 10.5, z)), X = side * 1.35;
      out.push(poly([[sx(X, z), sy(0, z)], [sx(X, z), sy(1.25, z)], [sx(X - side * 0.32, z), sy(1.3, z)]], { a, w: 0.45 + 0.8 / z }));
      out.push(dot(sx(X - side * 0.32, z), sy(1.22, z), 0.8 + 3 / z, { a }));
    }
    // the city on the horizon
    out.push(poly([[24, hy], [24, hy - 7], [34, hy - 7], [34, hy - 15], [44, hy - 15], [44, hy - 4], [56, hy - 4], [56, hy - 11], [66, hy - 11], [66, hy - 6], [80, hy - 6], [80, hy], [110, hy]], { a: 0.42, w: 0.8 }));
    out.push(poly([[130, hy], [158, hy], [158, hy - 9], [170, hy - 9], [170, hy - 18], [178, hy - 18], [178, hy - 5], [192, hy - 5], [192, hy - 12], [204, hy - 12], [204, hy - 3], [216, hy - 3], [216, hy]], { a: 0.42, w: 0.8 }));
    const cz = 4.2 + 0.7 * Math.sin(T * 0.7), cxw = 0.45 + 0.04 * Math.sin(T * 0.43);   // the car ahead: tail lights
    out.push(dot(sx(cxw - 0.17, cz), sy(0.22, cz), 2.6, { a: 0.95 }));
    out.push(dot(sx(cxw + 0.17, cz), sy(0.22, cz), 2.6, { a: 0.95 }));
    out.push(poly([[sx(cxw - 0.22, cz), sy(0.1, cz)], [sx(cxw - 0.22, cz), sy(0.42, cz)], [sx(cxw - 0.14, cz), sy(0.62, cz)], [sx(cxw + 0.14, cz), sy(0.62, cz)], [sx(cxw + 0.22, cz), sy(0.42, cz)], [sx(cxw + 0.22, cz), sy(0.1, cz)]], { a: 0.6, w: 0.85 }));
    return out;
  };

  /** Raising buildings: towers rise out of the ground one after another; windows light up; a crane swings on top. */
  const TOWERS = [[26, 30, 52, 0], [60, 28, 80, 0.12], [92, 40, 102, 0.24], [136, 30, 66, 0.36], [170, 36, 90, 0.48]];
  FIG.buildings = (t, T) => {
    const gy = 138, out = [line(12, gy, 228, gy, { a: 0.7 })];
    const tops = [];
    TOWERS.forEach(([x, w, h, d], k) => {
      const g = Math.max(0, backOut(clamp((t - d) / 0.95))), hh = h * g;
      tops.push(gy - hh);
      out.push(poly([[x, gy], [x, gy - hh], [x + w, gy - hh], [x + w, gy]], { w: 1.15 }));
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {   // windows, lit at their own pace
        const i = k * 6 + r * 2 + c, wy = gy - hh * (0.22 + 0.26 * r);
        const lit = sm(0.55, 0.9, g) * (0.2 + 0.8 * Math.pow(wave(T, 0.9 + hash(i) * 1.4, hash(i + 7) * 6.3), 2));
        out.push(dot(x + w * (c + 1) / 3, wy, 1.7, { a: lit }));
      }
    });
    const [ax, aw] = TOWERS[2], at = tops[2];   // the antenna and its beacon on the tallest
    out.push(line(ax + aw / 2, at, ax + aw / 2, at - 15 * sm(0.9, 1.3, t), { w: 0.9 }));
    out.push(dot(ax + aw / 2, at - 15 * sm(0.9, 1.3, t), 2.4, { a: sm(1.1, 1.3, t) * (0.25 + 0.75 * Math.pow(wave(T, 3.4, 0), 6)) }));
    const [kx, kw] = TOWERS[4], kt = tops[4], mx = kx + kw * 0.7, show = sm(0.9, 1.4, t);   // the crane
    const c = Math.cos(T * 0.55), mt = kt - 26 * show;
    out.push(line(mx, kt, mx, mt, { w: 1, a: show }));
    out.push(line(mx - 12 * c, mt, mx + 34 * c, mt, { w: 1, a: show }));
    const hx = mx + 24 * c, hl = 12 + 5 * Math.sin(T * 1.1);
    out.push(line(hx, mt, hx, mt + hl * show, { w: 0.6, a: show * 0.8 }));
    out.push(dot(hx, mt + hl * show + 2, 2.4, { a: show }));
    return out;
  };

  /** Furnishing: a sofa, a floor lamp breathing light, a picture swinging gently on its nail, a plant in the draught. */
  FIG.furnish = (t, T) => {
    const gy = 138, out = [line(10, gy, 230, gy, { a: 0.55 })];
    out.push(rrect(54, 88, 84, 26, 7, { w: 1.1 }));
    out.push(rrect(42, 100, 16, 32, 6, { w: 1.1 }));
    out.push(rrect(134, 100, 16, 32, 6, { w: 1.1 }));
    out.push(line(58, 118, 134, 118));
    out.push(line(96, 92, 96, 112, { a: 0.6, w: 0.8 }));
    out.push(line(44, 132, 148, 132));
    out.push(line(50, 132, 50, gy)); out.push(line(142, 132, 142, gy));
    const glow = 0.75 + 0.25 * wave(T, 2.2, 0);
    out.push(line(188, gy, 188, 66, { w: 1.1 }));
    out.push(line(178, gy, 198, gy, { w: 1.1 }));
    out.push(poly([[175, 66], [201, 66], [195, 48], [181, 48]], { closed: true, w: 1.1 }));
    out.push(dot(188, 70, 3, { a: glow }));
    out.push(line(177, 68, 160, 136, { a: 0.2 * glow, w: 0.7 }));
    out.push(line(199, 68, 216, 136, { a: 0.2 * glow, w: 0.7 }));
    const sw = 0.075 * Math.sin(T * 1.7), nx = 96, ny = 22;   // the picture on its nail: frame, strings, mountains inside
    out.push(dot(nx, ny, 1.8));
    const fr = rot([[76, 38], [116, 38], [116, 64], [76, 64]], nx, ny, sw);
    out.push(st(fr, { closed: true }));
    out.push(poly(rot([[76, 38], [nx, ny], [116, 38]], nx, ny, sw), { a: 0.55, w: 0.7 }));
    out.push(poly(rot([[80, 60], [89, 49], [95, 55], [103, 44], [112, 60]], nx, ny, sw), { a: 0.8, w: 0.8 }));
    out.push(poly([[14, gy], [30, gy], [32, 122], [12, 122]], { closed: true }));   // the plant
    for (let i = 0; i < 3; i++) {
      const s = Math.sin(T * 1.25 + i * 1.7) * 3, dx = (i - 1) * 10;
      out.push(poly(quad(22, 122, 22 + dx * 0.4, 106, 22 + dx + s, 92 + Math.abs(dx) * 0.5, 8), { w: 0.9 }));
    }
    return out;
  };

  /** Meeting the residents: three people walking, the middle one waving, a chat bubble typing, a heart between them. */
  FIG.residents = (t, T) => {
    const gy = 138, out = [line(14, gy, 226, gy, { a: 0.45 })];
    [62, 120, 178].forEach((x, k) => {
      const ph = k * 1.9, s = Math.sin(T * 5 + ph), a = 0.42 * s, L = 32;
      const hipY = gy - L * Math.cos(a), shY = hipY - 30;
      out.push(line(x, hipY, x + L * Math.sin(a), gy));
      out.push(line(x, hipY, x - L * Math.sin(a), gy));
      out.push(line(x, hipY, x, shY, { w: 1.1 }));
      out.push(ring(x, shY - 13, 9, 9, { w: 1.1 }, 22));
      const b = -0.85 * a;
      out.push(line(x, shY + 2, x + 25 * Math.sin(b), shY + 2 + 25 * Math.cos(b)));
      if (k === 1) {   // waving
        const ex = x - 12, ey = shY - 4, fa = -2.5 + 0.38 * Math.sin(T * 7.5);
        out.push(poly([[x, shY + 2], [ex, ey], [ex + 15 * Math.sin(fa), ey + 15 * Math.cos(fa)]]));
      } else out.push(line(x, shY + 2, x - 25 * Math.sin(b), shY + 2 + 25 * Math.cos(b)));
    });
    out.push(rrect(18, 20, 34, 20, 7, { w: 0.9 }));   // a chat bubble over the first, typing
    out.push(poly([[30, 40], [27, 47], [38, 40]], { w: 0.9 }));
    for (let i = 0; i < 3; i++) out.push(dot(27 + i * 8, 30, 2, { a: 0.25 + 0.75 * Math.pow(wave(T, 6, -i * 0.9), 3) }));
    const hs = 1 + 0.16 * Math.pow(wave(T, 4.2, 0), 4), hx = 150, hyy = 36;   // a heart between the last two
    const heart = [];
    for (let i = 0; i <= 28; i++) {
      const u = i / 28 * TAU, X = 16 * Math.pow(Math.sin(u), 3), Y = 13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u);
      heart.push([hx + X * 0.62 * hs, hyy - Y * 0.62 * hs]);
    }
    heart.pop();
    out.push(st(heart, { closed: true, w: 0.95 }));
    return out;
  };

  /** Waking the city: the sun comes up over the water, its rays turning, the light rippling, birds crossing. */
  FIG.waking = (t, T) => {
    const hz = 112, R = 26, out = [line(14, hz, 226, hz, { w: 1.1 })];
    const k = easeOut(clamp(t / 1.7)), cy = hz + 22 - 50 * k;
    const s0 = clamp((hz - cy) / R, -1, 1);
    const sun = s0 <= -1 ? arc(CX, cy - R, 0.01, 0.01, 0, 1, 24) : arc(CX, cy, R, R, PI - Math.asin(s0), TAU + Math.asin(s0), 24);
    out.push(poly(sun, { w: 1.2 }));
    const turn = 0.1 * Math.sin(T * 0.5);
    for (let i = 0; i < 11; i++) {
      const a = PI + 0.16 + (PI - 0.32) * i / 10 + turn, r1 = R + 7, r2 = R + 14 + 6 * wave(T, 2.3, i * 0.9);
      const x1 = CX + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      out.push(line(x1, y1, CX + Math.cos(a) * r2, cy + Math.sin(a) * r2, { a: k * sm(hz - 2, hz - 10, y1), w: 0.9 }));
    }
    for (let i = 0; i < 4; i++) {   // the sun's path on the water
      const y = hz + 6 + i * 6.5, hw = (30 - i * 6) * (0.75 + 0.25 * wave(T, 2 + i, i)), dx = 3 * Math.sin(T * 1.3 + i * 2);
      out.push(line(CX - hw + dx, y, CX + hw + dx, y, { a: k * (0.75 - i * 0.14), w: 0.9 }));
    }
    for (let i = 0; i < 2; i++) {   // birds
      const x = 30 + ((T * 13 + i * 95) % 180), y = 40 + i * 16 + 3 * Math.sin(T * 0.8 + i), f = Math.sin(T * 7 + i * 2);
      const a = sm(30, 44, x) * (1 - sm(196, 210, x));
      out.push(poly([[x - 8, y - 3.5 * f], [x - 3, y - 0.5], [x, y + 0.5], [x + 3, y - 0.5], [x + 8, y - 3.5 * f]], { a, w: 0.9 }));
    }
    return out;
  };

  /** Lighting up the world: night - a street lamp flickers on and settles, its pool of light breathing, moon and stars. */
  const STARS = [[24, 26, 1.6], [46, 76, 1.2], [94, 18, 2], [112, 50, 1.3], [184, 24, 1.7], [212, 58, 1.3], [222, 18, 1.1]];
  const MOON = (() => {   // a crescent: the rim of one disc outside a second one, then back along the second
    const [ax, ay, ra, bx, by, rb] = [60, 47, 17, 68, 40, 14.5];
    const d = Math.hypot(bx - ax, by - ay), away = Math.atan2(ay - by, ax - bx);
    const h1 = Math.acos((ra * ra + d * d - rb * rb) / (2 * ra * d)), h2 = Math.acos((rb * rb + d * d - ra * ra) / (2 * rb * d));
    const outer = arc(ax, ay, ra, ra, away - (PI - h1), away + (PI - h1), 30);
    const inner = arc(bx, by, rb, rb, away - h2, away + h2, 16), end = outer[outer.length - 1];
    if (Math.hypot(inner[0][0] - end[0], inner[0][1] - end[1]) > Math.hypot(inner[16][0] - end[0], inner[16][1] - end[1])) inner.reverse();
    return outer.concat(inner.slice(1, -1));
  })();
  FIG.lighting = (t, T) => {
    const gy = 138, out = [line(10, gy, 230, gy, { a: 0.5 })];
    let on = sm(0.25, 0.5, t);
    if (t < 1.5) on *= 0.35 + 0.65 * (Math.sin(t * 41) > -0.2 + 0.8 * sm(0.5, 1.5, t) - 0.6 ? 1 : 0.2);
    on *= 0.85 + 0.15 * wave(T, 1.9, 0);
    const pole = [[154, gy], [154, 56]].concat(arc(142, 56, 12, 12, 0, -PI / 2, 6).slice(1)).concat([[128, 44]]);
    out.push(poly(pole, { w: 1.2 }));
    out.push(line(146, gy, 162, gy, { w: 1.2 }));
    out.push(poly([[119, 44], [137, 44], [134, 51], [122, 51]], { closed: true, w: 1.1 }));
    out.push(dot(128, 53, 3.2, { a: 0.2 + 0.8 * on }));
    out.push(line(122, 53, 98, gy - 2, { a: 0.26 * on, w: 0.75 }));
    out.push(line(134, 53, 158, gy - 2, { a: 0.26 * on, w: 0.75 }));
    out.push(ring(128, gy, 34, 4.5, { a: 0.5 * on, w: 0.8 }, 30));
    out.push(st(MOON, { closed: true, w: 1.05 }));
    STARS.forEach(([x, y, r], i) => out.push(dot(x, y, r, { a: 0.15 + 0.85 * Math.pow(wave(T, 1.1 + hash(i) * 1.7, hash(i + 3) * 6.3), 3) })));
    out.push(dot(128 + 15 * Math.cos(T * 3.1), 60 + 7 * Math.sin(T * 4.3), 1.3, { a: on }));   // a moth round the light
    return out;
  };

  /** Something went wrong: a warning sign, breathing. */
  FIG.error = (t, T) => {
    const a = 0.7 + 0.3 * wave(T, 3, 0), tri = [], C = [[CX, 30], [CX + 50, 120], [CX - 50, 120]];
    for (let i = 0; i < 3; i++) {   // a triangle with rounded corners
      const [px, py] = C[(i + 2) % 3], [x, y] = C[i], [nx, ny] = C[(i + 1) % 3];
      const r = 8, l1 = Math.hypot(px - x, py - y), l2 = Math.hypot(nx - x, ny - y);
      const p = [x + (px - x) * r / l1, y + (py - y) * r / l1], n = [x + (nx - x) * r / l2, y + (ny - y) * r / l2];
      for (const q of quad(p[0], p[1], x, y, n[0], n[1], 4)) tri.push(q);
    }
    return [st(tri, { closed: true, w: 1.2, a }), line(CX, 62, CX, 94, { w: 1.8, a }), dot(CX, 106, 3.4, { a })];
  };

  /** Where the art starts from: sparks scattered round the middle (no lines). */
  const DUST = (() => {
    const out = [];
    for (let i = 0; i < K; i++) {
      const a = hash(i) * TAU, r = 30 + 90 * Math.sqrt(hash(i + 911));
      out.push(dot(CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.62, 0.01, { a: 0 }));
    }
    return out;
  })();
  FIG.dust = () => DUST;

  // ------------------------------------------------------------------ sampling a figure into K particles
  function strokeLen(s) {
    const p = s.pts, n = p.length;
    let l = 0;
    for (let i = 1; i < n; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (s.closed && n > 1) l += Math.hypot(p[0][0] - p[n - 1][0], p[0][1] - p[n - 1][1]);
    return l;
  }
  /** How many particles each stroke gets (fixed for a whole transformation, so particles never hop between strokes). */
  function allocate(strokes) {
    const n = strokes.length, cnt = new Int32Array(n), len = new Float64Array(n);
    let left = K, tot = 0;
    for (let i = 0; i < n; i++) {
      const s = strokes[i];
      if (s.dot) { cnt[i] = 1; left--; continue; }
      len[i] = strokeLen(s) + 1e-3; tot += len[i];
      const V = s.pts.length;
      cnt[i] = V <= 10 ? V : s.closed ? 6 : 4;   // corners of short polylines land exactly; curves get a few to start
      left -= cnt[i];
    }
    if (left > 0 && tot > 0) {
      const frac = [];
      let given = 0;
      for (let i = 0; i < n; i++) if (!strokes[i].dot) {
        const want = left * len[i] / tot, w = Math.floor(want);
        cnt[i] += w; given += w; frac.push([want - w, i]);
      }
      frac.sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < left - given; k++) cnt[frac[k % frac.length][1]]++;
    }
    let off = 0;
    const ranges = new Int32Array(n);
    for (let i = 0; i < n; i++) { ranges[i] = off; off += cnt[i]; }
    // per-edge interior counts for strokes that keep their corners
    const edges = [];
    for (let i = 0; i < n; i++) {
      const s = strokes[i], V = s.pts.length;
      if (s.dot || cnt[i] < V) { edges.push(null); continue; }
      const ne = s.closed ? V : V - 1, extra = cnt[i] - V, el = new Float64Array(ne);
      let et = 0;
      for (let e = 0; e < ne; e++) { const a = s.pts[e], b = s.pts[(e + 1) % V]; el[e] = Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-4; et += el[e]; }
      const ec = new Int32Array(ne), fr = [];
      let g = 0;
      for (let e = 0; e < ne; e++) { const w = extra * el[e] / et, f = Math.floor(w); ec[e] = f; g += f; fr.push([w - f, e]); }
      fr.sort((a, b) => b[0] - a[0]);
      for (let k = 0; k < extra - g; k++) ec[fr[k % fr.length][1]]++;
      edges.push(ec);
    }
    return { cnt, ranges, edges, total: off };
  }
  /** Places the particles of `strokes` (laid out by `lay`) into X, Y. */
  function place(strokes, lay, X, Y) {
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i], p = s.pts, V = p.length, n = lay.cnt[i];
      let o = lay.ranges[i];
      if (s.dot || V === 1) { for (let k = 0; k < n; k++) { X[o + k] = p[0][0]; Y[o + k] = p[0][1]; } continue; }
      const ec = lay.edges[i];
      if (ec) {
        const ne = ec.length;
        for (let e = 0; e < ne; e++) {
          const a = p[e], b = p[(e + 1) % V], m = ec[e];
          X[o] = a[0]; Y[o] = a[1]; o++;
          for (let k = 1; k <= m; k++) { const u = k / (m + 1); X[o] = a[0] + (b[0] - a[0]) * u; Y[o] = a[1] + (b[1] - a[1]) * u; o++; }
        }
        if (!s.closed) { X[o] = p[V - 1][0]; Y[o] = p[V - 1][1]; }
        continue;
      }
      // more vertices than particles (a smooth curve): even spacing along it
      const L = strokeLen(s), steps = s.closed ? n : n - 1;
      let seg = 0, segStart = 0, segLen = Math.hypot(p[1 % V][0] - p[0][0], p[1 % V][1] - p[0][1]);
      for (let k = 0; k < n; k++) {
        const target = steps > 0 ? L * k / steps : 0;
        while (segStart + segLen < target - 1e-6 && seg < (s.closed ? V : V - 1) - 1) {
          segStart += segLen; seg++;
          const a = p[seg], b = p[(seg + 1) % V];
          segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        const a = p[seg], b = p[(seg + 1) % V], u = segLen > 0 ? clamp((target - segStart) / segLen) : 0;
        X[o + k] = a[0] + (b[0] - a[0]) * u; Y[o + k] = a[1] + (b[1] - a[1]) * u;
      }
    }
  }
  /** Which particle of the next figure each particle of this one becomes: short trips, found by swapping pairs from two
   *  starts - round the middle in angle order, and particle for particle (best when the figures are alike, as the open and
   *  the locked padlock) - keeping the shorter. */
  function match(ax, ay, bx, by) {
    const d = (i, j) => { const x = ax[i] - bx[j], y = ay[i] - by[j]; return x * x + y * y; };
    const ia = order(ax, ay, centroid(ax, ay)), ib = order(bx, by, centroid(bx, by));
    const byAngle = new Int32Array(K), same = new Int32Array(K);
    for (let k = 0; k < K; k++) { byAngle[ia[k]] = ib[k]; same[k] = k; }
    let best = null, bestCost = Infinity;
    for (const perm of [byAngle, same]) {
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % K; };
      for (let it = 0; it < 40000; it++) {
        const i = rnd(), j = rnd();
        if (i === j) continue;
        const pi = perm[i], pj = perm[j];
        if (d(i, pj) + d(j, pi) < d(i, pi) + d(j, pj)) { perm[i] = pj; perm[j] = pi; }
      }
      let c = 0;
      for (let i = 0; i < K; i++) c += d(i, perm[i]);
      if (c < bestCost) { bestCost = c; best = perm; }
    }
    return best;
  }
  /** out[o+k] = value(o+k) averaged over its neighbours along the same stroke (closed strokes wrap round). */
  function smoothAlong(strokes, lay, value, out) {
    for (let si = 0; si < strokes.length; si++) {
      const o = lay.ranges[si], n = lay.cnt[si], closed = strokes[si].closed;
      for (let k = 0; k < n; k++) {
        let v = 0, ws = 0;
        for (let d = -6; d <= 6; d++) {
          let q = k + d;
          if (closed) q = (q % n + n) % n; else if (q < 0 || q >= n) continue;
          const w = Math.exp(-d * d / 10);
          v += value(o + q) * w; ws += w;
        }
        out[o + k] = v / ws;
      }
    }
  }
  function centroid(x, y) { let sx = 0, sy = 0; for (let i = 0; i < K; i++) { sx += x[i]; sy += y[i]; } return [sx / K, sy / K]; }
  function order(x, y, c) {
    const idx = Array.from({ length: K }, (_, i) => i);
    const ang = idx.map(i => Math.atan2(y[i] - c[1], x[i] - c[0]));
    idx.sort((a, b) => ang[a] - ang[b]);
    return idx;
  }

  // ------------------------------------------------------------------ the engine
  function mkCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function sprite(stops) {
    const c = mkCanvas(64, 64), g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [o, col] of stops) r.addColorStop(o, col);
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return c;
  }

  function create(canvas, opts) {
    // soft: drawn by the CPU (willReadFrequently keeps a canvas off the GPU), so the art never waits for a GPU busy
    // compiling the world's shaders
    const ctx = canvas.getContext('2d', opts.soft ? { willReadFrequently: true } : undefined);
    const post = opts.post || (() => {});
    const reduced = !!opts.reduced;
    let W = 1, H = 1, dpr = 1, lay = {};
    const SPARK = sprite([[0, 'rgba(255,246,228,1)'], [0.18, 'rgba(255,196,120,0.9)'], [0.45, 'rgba(255,96,40,0.35)'], [1, 'rgba(255,40,90,0)']]);
    const SPARK_M = sprite([[0, 'rgba(255,236,240,1)'], [0.18, 'rgba(255,130,170,0.9)'], [0.45, 'rgba(240,40,110,0.35)'], [1, 'rgba(200,20,90,0)']]);
    let grad = null; const core = 'rgba(255,228,196,1)';

    function resize(m) {
      W = m.w; H = m.h; dpr = m.dpr; lay = m.layout || {};
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
      grad = ctx.createLinearGradient(0, 0, FW, FH * 0.35);
      grad.addColorStop(0, '#ffb547'); grad.addColorStop(0.38, '#ff6a1f'); grad.addColorStop(0.78, '#ff2f6e'); grad.addColorStop(1, '#ff5aa8');
    }
    resize(opts);

    // The art's own clock: it advances at most 50 ms a frame, so when the phone stalls for a moment (the page building the
    // world) the art pauses and carries on, instead of jumping ahead.
    const realNow = () => performance.now() / 1000;
    let vt = 0;
    function now() { return vt; }

    // --- phases
    const msgs = {};
    let cur = 'dust', curStart = now(), settledAt = -1e9, pending = null, morph = null;
    let text = { cur: '', prev: '', t0: -1e9 }, barTarget = 0, barShown = 0, done = null;
    const X = new Float32Array(K), Y = new Float32Array(K);   // where every particle is drawn this frame (for the burst)
    let burst = null;

    function setText(s) { if (s !== text.cur) { text.prev = text.cur; text.cur = s; text.t0 = now(); } }

    function message(m) {
      if (m.type === 'resize') resize(m);
      else if (m.type === 'phase') {
        if (m.p != null) barTarget = clamp(m.p);
        const showing = morph ? morph.to : cur;
        const id = m.id && FIG[m.id] ? m.id : pending || showing;   // no figure named: the message is for the latest one
        if (m.msg) msgs[id] = m.msg;
        if (id !== showing) pending = id;   // the latest wins: steps that came and went meanwhile are skipped
        else { pending = null; if (msgs[id]) setText(msgs[id]); }
      } else if (m.type === 'trace') {   // every gap over 40 ms so far, on the shared clock (timeOrigin + now), for checks
        post({ type: 'trace', gaps: st.gaps.slice() });
      } else if (m.type === 'stats') {   // frames drawn and the longest gap between two since the last ask (checks)
        post({ type: 'stats', frames: st.frames, maxGap: Math.round(st.maxGap * 1000), span: Math.round((realNow() - st.t0) * 1000),
          drawMs: st.frames ? +(st.drawMs / st.frames).toFixed(2) : 0, drawMax: +st.drawMax.toFixed(1), px: canvas.width * canvas.height });
        st.frames = 0; st.maxGap = 0; st.t0 = realNow(); st.drawMs = 0; st.drawMax = 0;
      } else if (m.type === 'done' && !done) {
        done = now(); barTarget = 1; setText(m.msg || 'Welcome!');
        startBurst();
        setTimeout(() => post({ type: 'outro' }), 120);   // the screen fades while the burst plays: no time added
      }
    }

    // --- transformations
    function startMorph(to) {
      const t = now(), from = cur;
      const A = FIG[from](t - curStart, t), B = FIG[to](0, t);
      const la = allocate(A), lb = allocate(B);
      const ax = new Float32Array(K), ay = new Float32Array(K), bx = new Float32Array(K), by = new Float32Array(K);
      place(A, la, ax, ay); place(B, lb, bx, by);
      const perm = match(ax, ay, bx, by), inv = new Int32Array(K);
      for (let i = 0; i < K; i++) inv[perm[i]] = i;
      const delay = new Float32Array(K);
      for (let i = 0; i < K; i++) delay[i] = STAGGER * clamp(ax[i] / FW) * (0.85 + 0.3 * hash(i));
      // Each particle leaves along its stroke's average heading (the trip smoothed over its neighbours on the stroke), so a
      // line slides off as a band instead of fraying into zigzags; on the way it turns onto its own exact trip.
      const sdx = new Float32Array(K), sdy = new Float32Array(K);
      smoothAlong(A, la, i => bx[perm[i]] - ax[i], sdx); smoothAlong(A, la, i => by[perm[i]] - ay[i], sdy);
      // ... and lands as a band too: along the trip smoothed over its neighbours on the new stroke
      const sbx = new Float32Array(K), sby = new Float32Array(K);
      smoothAlong(B, lb, (q) => bx[q] - ax[inv[q]], sbx); smoothAlong(B, lb, (q) => by[q] - ay[inv[q]], sby);
      morph = { from, to, start: t, fromStart: curStart, la, lb, perm, inv, delay, ax, ay, bx, by, sdx, sdy, sbx, sby, E: new Float32Array(K), ES: new Float32Array(K),
        dir: Math.random() < 0.5 ? -1 : 1, mA: new Float32Array(A.length), mB: new Float32Array(B.length) };
      setText(msgs[to] || text.cur);
    }

    /** The end: whatever is drawn now (a figure, or a transformation half-way) bursts into sparks that fly off and fade. */
    function startBurst() {
      const t = now();
      let strokes, l, map = null;
      if (morph) { morphPositions(t); strokes = FIG[morph.to](t - morph.start, t); l = morph.lb; map = morph.inv; }
      else { strokes = FIG[cur](t - curStart, t); l = allocate(strokes); place(strokes, l, X, Y); }
      const vx = new Float32Array(K), vy = new Float32Array(K), life = new Float32Array(K);
      for (let i = 0; i < K; i++) {
        const dx = X[i] - CX, dy = Y[i] - CY, d = Math.hypot(dx, dy) + 1e-3, sp = 40 + 80 * hash(i * 3 + 1);
        vx[i] = dx / d * sp + (hash(i + 5) - 0.5) * 30; vy[i] = dy / d * sp * 0.7 - 35 - 30 * hash(i + 9);
        life[i] = 0.45 + 0.5 * hash(i + 13);
      }
      burst = { t0: t, x: Float32Array.from(X), y: Float32Array.from(Y), vx, vy, life, strokes, lay: l, map };
      morph = null; pending = null;
    }
    /** Fills X, Y with where each particle is mid-transformation: from its place in the old figure to its place in the new,
     *  swirling round the middle on the way; returns both figures as they are now. */
    function morphPositions(t) {
      const m = morph, tau = (t - m.start) / MORPH;
      const A = FIG[m.from](t - m.fromStart, t), B = FIG[m.to](t - m.start, t);
      place(A, m.la, m.ax, m.ay); place(B, m.lb, m.bx, m.by);
      for (let i = 0; i < K; i++) m.E[i] = reduced ? ease(clamp(tau)) : ease(clamp((tau - m.delay[i]) / (1 - STAGGER)));
      smoothAlong(B, m.lb, q => m.E[m.inv[q]], m.ES);   // how far along each new stroke's neighbourhood is
      for (let i = 0; i < K; i++) {
        const e = m.E[i], j = m.perm[i], w = sm(0.3, 0.8, e), es = m.ES[j];
        const ex = m.ax[i] + m.sdx[i] * e, ey = m.ay[i] + m.sdy[i] * e;                    // leaving with its old stroke
        const lx = m.bx[j] - m.sbx[j] * (1 - es), ly = m.by[j] - m.sby[j] * (1 - es);      // arriving with its new one
        let x = ex + (lx - ex) * w, y = ey + (ly - ey) * w;
        if (!reduced) {
          const s = Math.sin(PI * (e + (es - e) * w)), th = m.dir * 0.6 * s, r = 1 + 0.12 * s, c = Math.cos(th), n = Math.sin(th);
          const dx = (x - CX) * r, dy = (y - CY) * r;
          x = CX + dx * c - dy * n; y = CY + dx * n + dy * c;
        }
        X[i] = x; Y[i] = y;
      }
      // how far along each stroke is (its particles' average), for fading the old lines out and the new ones in
      for (let si = 0; si < A.length; si++) { let a = 0; const o = m.la.ranges[si], n = m.la.cnt[si]; for (let k = 0; k < n; k++) a += m.E[o + k]; m.mA[si] = 1 - sm(0, 0.42, a / n); }
      for (let si = 0; si < B.length; si++) { let a = 0; const o = m.lb.ranges[si], n = m.lb.cnt[si]; for (let k = 0; k < n; k++) a += m.E[m.inv[o + k]]; m.mB[si] = sm(0.58, 1, a / n); }
      return { A, B, tau };
    }

    // --- drawing
    function figTransform() {
      const f = lay.fig || { x: W / 2 - 120, y: H / 2, w: 240, h: 160 };
      const sc = f.w / FW * dpr;
      ctx.setTransform(sc, 0, 0, sc, f.x * dpr, f.y * dpr);
      return dpr / sc;   // figure units per CSS pixel
    }
    const PASSES = [[10, 0.07], [5, 0.2], [2.4, 0.55], [1.15, 0.9]];   // [CSS px width, alpha]: halo, glow, colour, hot core
    /** Strokes from their own points (a figure at rest). */
    function drawStrokes(strokes, mult, u) {
      for (let p = 0; p < PASSES.length; p++) {
        const [wpx, al] = PASSES[p];
        ctx.strokeStyle = p === PASSES.length - 1 ? core : grad;
        for (const s of strokes) {
          if (s.dot || s.a * mult < 0.004) continue;
          ctx.globalAlpha = al * s.a * mult;
          ctx.lineWidth = wpx * s.w * u;
          ctx.beginPath();
          const q = s.pts;
          ctx.moveTo(q[0][0], q[0][1]);
          for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
          if (s.closed) ctx.closePath();
          ctx.stroke();
        }
      }
      for (const s of strokes) if (s.dot && s.a * mult > 0.004) drawDot(s.pts[0][0], s.pts[0][1], s.dot, s.a * mult, u);
    }
    /** Strokes through the particles (mid-transformation): idx maps a stroke's particle k to a slot of X, Y. */
    function drawThrough(strokes, l, idx, mults, u) {
      const mOf = si => typeof mults === 'number' ? mults : mults[si];
      for (let p = 0; p < PASSES.length; p++) {
        const [wpx, al] = PASSES[p];
        ctx.strokeStyle = p === PASSES.length - 1 ? core : grad;
        for (let si = 0; si < strokes.length; si++) {
          const s = strokes[si], mult = mOf(si);
          if (s.dot || s.a * mult < 0.004) continue;
          const o = l.ranges[si], n = l.cnt[si];
          ctx.globalAlpha = al * s.a * mult;
          ctx.lineWidth = wpx * s.w * u;
          ctx.beginPath();
          let k0 = idx ? idx[o] : o;
          ctx.moveTo(X[k0], Y[k0]);
          for (let k = 1; k < n; k++) { const q = idx ? idx[o + k] : o + k; ctx.lineTo(X[q], Y[q]); }
          if (s.closed) ctx.closePath();
          ctx.stroke();
        }
      }
      for (let si = 0; si < strokes.length; si++) {
        const s = strokes[si], mult = mOf(si);
        if (!s.dot || s.a * mult < 0.004) continue;
        const q = idx ? idx[l.ranges[si]] : l.ranges[si];
        drawDot(X[q], Y[q], s.dot, s.a * mult, u);
      }
    }
    function drawDot(x, y, r, a, u) {
      const R = (r * 3.4 + 3 * u);
      ctx.globalAlpha = clamp(a);
      ctx.drawImage(SPARK, x - R, y - R, R * 2, R * 2);
    }

    function drawFigure(t) {
      const u = figTransform();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (burst) {
        const b = burst, age = t - b.t0, lineA = 1 - sm(0, 0.28, age);
        for (let i = 0; i < K; i++) {
          const k = age;
          X[i] = b.x[i] + b.vx[i] * k * (1 - 0.35 * k); Y[i] = b.y[i] + b.vy[i] * k + 30 * k * k;
        }
        if (lineA > 0) drawThrough(b.strokes, b.lay, b.map, lineA, u);
        for (let i = 0; i < K; i++) {
          const a = 1 - clamp(age / b.life[i]);
          if (a <= 0) continue;
          const R = (1.2 + 1.6 * a) * 3 * u;
          ctx.globalAlpha = a * 0.9;
          ctx.drawImage(i % 3 ? SPARK : SPARK_M, X[i] - R, Y[i] - R, R * 2, R * 2);
        }
        return;
      }
      if (!morph && pending && t - settledAt >= HOLD) { startMorph(pending); pending = null; }
      if (morph) {
        const { A, B, tau } = morphPositions(t);
        const eg = ease(clamp(tau));
        if (reduced) {   // a cross-fade, no swirl
          drawStrokes(A, 1 - eg, u); drawStrokes(B, eg, u);
        } else {
          drawThrough(A, morph.la, null, morph.mA, u);
          drawThrough(B, morph.lb, morph.inv, morph.mB, u);
          for (let i = 0; i < K; i++) {   // the sparks the lines become in between
            const a = Math.sin(PI * morph.E[i]);
            if (a < 0.02) continue;
            const R = (1.1 + 1.3 * a) * 3 * u;
            ctx.globalAlpha = 0.85 * a;
            ctx.drawImage(i % 4 ? SPARK : SPARK_M, X[i] - R, Y[i] - R, R * 2, R * 2);
          }
        }
        if (tau >= 1) { cur = morph.to; curStart = morph.start; morph = null; settledAt = t; }
        return;
      }
      drawStrokes(FIG[cur](t - curStart, reduced ? 1000 : t), 1, u);
    }

    function drawText(t) {
      const r = lay.text;
      if (!r) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '500 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.6px';
      const k = clamp((t - text.t0) / 0.45);
      const y = r.y + r.h / 2;
      if (text.prev && k < 1) { ctx.globalAlpha = 1 - ease(clamp(k * 1.6)); ctx.fillStyle = '#eadcd2'; ctx.fillText(text.prev, r.x + r.w / 2, y - 4 * ease(k)); }
      if (text.cur) { const kk = ease(clamp((k - 0.25) / 0.75)); ctx.globalAlpha = kk * 0.92; ctx.fillStyle = '#eadcd2'; ctx.fillText(text.cur, r.x + r.w / 2, y + 4 * (1 - kk)); }
    }

    function drawBar(t, dt) {
      const r = lay.bar;
      if (!r) return;
      barShown += (barTarget - barShown) * (1 - Math.exp(-dt * (done ? 7 : 2.6)));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const y = r.y + r.h / 2, x0 = r.x, w = r.w, x1 = x0 + w * barShown;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x0, y - 1, w, 2);
      if (barShown < 0.002) return;
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      g.addColorStop(0, '#ffb547'); g.addColorStop(0.45, '#ff6a1f'); g.addColorStop(1, '#ff2f78');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.25; ctx.fillRect(x0, y - 3, x1 - x0, 6);
      ctx.globalAlpha = 1; ctx.fillRect(x0, y - 1, x1 - x0, 2);
      const R = 9 + 2 * Math.sin(t * 9);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(SPARK, x1 - R, y - R, R * 2, R * 2);
    }

    let last = realNow(), stopped = false;
    const st = { frames: 0, maxGap: 0, t0: realNow(), gaps: [], drawMs: 0, drawMax: 0 };
    const origin = (typeof performance.timeOrigin === 'number' ? performance.timeOrigin : 0);
    function frame() {
      if (stopped) return;
      const r = realNow(), gap = r - last, dt = Math.min(0.05, gap);
      st.frames++; st.maxGap = Math.max(st.maxGap, gap);
      if (gap > 0.04 && st.gaps.length < 200) st.gaps.push([Math.round(origin + r * 1000), Math.round(gap * 1000)]);
      last = r; vt += dt;
      const t = vt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawFigure(t);
      drawText(t);
      drawBar(t, dt);
      const ms = (realNow() - r) * 1000;
      st.drawMs += ms; if (ms > st.drawMax) st.drawMax = ms;
      if (done && t - done > 2.2) { stopped = true; return; }
      raf(frame);
    }
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f => setTimeout(f, 16));
    raf(frame);
    return { message, stop() { stopped = true; } };
  }

  G.MVWLoadingArt = { create, figures: FIG, allocate, place, match, K, FW, FH };   // (the rest for tests)

  // As a worker: the page sends the canvas, then phases.
  if (typeof WorkerGlobalScope !== 'undefined' && G instanceof WorkerGlobalScope) {
    let art = null;
    const early = [];
    G.onmessage = e => {
      const m = e.data;
      if (m.type === 'init') { art = create(m.canvas, Object.assign({}, m, { post: x => G.postMessage(x) })); for (const q of early) art.message(q); early.length = 0; }
      else if (art) art.message(m);
      else early.push(m);
    };
  }
})(typeof self !== 'undefined' ? self : window);
