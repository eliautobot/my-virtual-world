// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Turbo Rush's screen (the rules: shared/arcade/games/turbo-rush.js), in 3D with three.js inside the sealed box. In
// daylight, five stages one after another (the coast with its sea and palms, a green valley, a red-rock desert, the
// city with its towers and gantries, an alpine pass under snowy peaks; then round again at sunset), each with its own
// sky, ground and things along the road. A red Italian-style supercar (our own model: low and wide, round tail lights,
// quad exhausts, glossy paint that mirrors the sky), traffic of six kinds, three rival supercars marked on screen.
// Boost flames, sparks, smoke, a crash camera that circles the wreck, rivals tumbling away from a takedown. Over it, a
// 2D layer: the clock, the stage and how far to its end, the score and the multiplier, a speedometer, the boost gauge,
// the tricks as they happen. The world is laid out every frame round the car: the road from its bends ahead and
// behind, everything else placed along it from its distance (the same stretch always looks the same).
import * as THREE from '/vendor/three/build/three.module.js';
import * as sim from '/shared/arcade/games/turbo-rush.js';
import { makeScreen, text, Floaters, crt, blink, fmt, rrect, LW, LH } from '../fx.js';

export { sim };
const { WALL, ROAD_HALF, KINDS, LANES, STAGE_LEN, STAGES, stageAt, multOf, placeOf } = sim;
const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH'];
const STEP = 4, BACK = 12, AHEAD = 175, N = BACK + AHEAD + 1;
const hash = k => { let h = Math.imul((k | 0) ^ 0x5bd1e995, 2654435761) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const C = hex => new THREE.Color(hex);

// ------------------------------------------------------------------------------------------- the stages
const THEMES = [
  { key: 'coast', top: '#1d6fe0', hz: '#b4dcff', fog: '#c4e2f7', near: '#e2cf96', far: '#7fb069', hill: 22, sea: true },
  { key: 'valley', top: '#2a7de8', hz: '#d4ecff', fog: '#cfe5f3', near: '#6faa4f', far: '#4e8d3c', hill: 38 },
  { key: 'canyon', top: '#2f86df', hz: '#ffe2bd', fog: '#f1d9bb', near: '#d6a066', far: '#c06b3a', hill: 16 },
  { key: 'city', top: '#3f8ee0', hz: '#dbe6f2', fog: '#d4dce6', near: '#8e949b', far: '#7d858f', hill: 0 },
  { key: 'alpine', top: '#2260cc', hz: '#e4f0ff', fog: '#e1ebf5', near: '#eef3f8', far: '#f7fbff', hill: 70 },
];
const SUNSET = { top: '#3b2f86', hz: '#ffb067', fog: '#f0b78c' };
/** The stage's look at track distance z (round two and on: sunset). */
function themeAt(z) { const st = stageAt(z), t = THEMES[st % 5]; return st >= 5 ? { ...t, ...SUNSET, sunset: true } : t; }

// ------------------------------------------------------------------------------------------- textures
function cv2(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, rep = false, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function asphalt() {
  const [c, x] = cv2(512, 1024), m = 512 / (2 * (WALL + 0.3)), X = v => (v + WALL + 0.3) * m, PM = 1024 / 24;
  x.fillStyle = '#56585f'; x.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 26000; i++) { const v = 70 + ((i * 2654435761) >>> 24) % 70; x.fillStyle = `rgba(${v},${v},${v + 6},0.35)`; x.fillRect((i * 97) % 512, (i * 389) % 1024, 1.5, 1.5); }
  // patches and the joints across the road every 6 m: what the eye reads the speed from
  for (let k = 0; k < 7; k++) { x.fillStyle = `rgba(${k % 2 ? 40 : 105},${k % 2 ? 41 : 106},${k % 2 ? 46 : 110},0.22)`; x.fillRect(X(-6 + ((k * 37) % 12)), (k * 151) % 1024, (1.2 + (k % 3) * 0.8) * m, (2 + (k % 4)) * PM); }
  for (let y = 0; y < 1024; y += 6 * PM) { x.fillStyle = 'rgba(28,28,32,0.42)'; x.fillRect(X(-ROAD_HALF), y, X(ROAD_HALF) - X(-ROAD_HALF), 2.5); x.fillStyle = 'rgba(150,150,156,0.25)'; x.fillRect(X(-ROAD_HALF), y + 2.5, X(ROAD_HALF) - X(-ROAD_HALF), 1); }
  for (const l of LANES) { x.fillStyle = 'rgba(25,25,30,0.18)'; x.fillRect(X(l - 0.95), 0, 0.5 * m, 1024); x.fillRect(X(l + 0.45), 0, 0.5 * m, 1024); }
  x.fillStyle = '#66686e'; x.fillRect(0, 0, X(-ROAD_HALF), 1024); x.fillRect(X(ROAD_HALF), 0, 512 - X(ROAD_HALF), 1024);
  x.fillStyle = 'rgba(40,40,45,0.35)'; for (let y = 0; y < 1024; y += 10) { x.fillRect(X(-ROAD_HALF) - 0.8 * m, y, 0.6 * m, 4); x.fillRect(X(ROAD_HALF) + 0.2 * m, y, 0.6 * m, 4); }
  x.fillStyle = '#f5f5f2'; x.fillRect(X(-ROAD_HALF) - 0.08 * m, 0, 0.16 * m, 1024); x.fillRect(X(ROAD_HALF) - 0.08 * m, 0, 0.16 * m, 1024);
  for (const l of [-3.5, 3.5]) for (let y = 0; y < 1024; y += 12 * PM) x.fillRect(X(l) - 0.07 * m, y, 0.14 * m, 3 * PM);
  x.fillStyle = '#f4c430'; x.fillRect(X(-0.14) - 0.06 * m, 0, 0.12 * m, 1024); x.fillRect(X(0.14) - 0.06 * m, 0, 0.12 * m, 1024);
  return tex(c, true);
}
function noise(base = 200) {
  const [c, x] = cv2(256, 256);
  x.fillStyle = `rgb(${base},${base},${base})`; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = base - 40 + ((i * 2246822519) >>> 25) % 80; x.fillStyle = `rgba(${v},${v},${v},0.5)`; const s = 1 + (i % 4); x.fillRect((i * 131) % 256, (i * 71 + (i >> 3)) % 256, s, s); }
  return tex(c, true);
}
function water() {
  const [c, x] = cv2(256, 256);
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#1d7fc4'); g.addColorStop(1, '#1569a8');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 2;
  for (let i = 0; i < 70; i++) { const px = (i * 53) % 256, py = (i * 97) % 256, w = 10 + (i % 5) * 6; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + w / 2, py - 3, px + w, py); x.stroke(); }
  return tex(c, true);
}
function rail() {
  const [c, x] = cv2(64, 64);
  const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#e7eaee'); g.addColorStop(0.3, '#b9bec6'); g.addColorStop(0.5, '#eef0f3'); g.addColorStop(0.7, '#a7adb6'); g.addColorStop(1, '#d6d9de');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return tex(c, true);
}
function windows(dayGlass) {
  const [c, x] = cv2(128, 256);
  x.fillStyle = dayGlass; x.fillRect(0, 0, 128, 256);
  for (let y = 4; y < 256; y += 10) for (let px = 4; px < 124; px += 10) { const v = hash(px * 977 + y); x.fillStyle = v < 0.15 ? 'rgba(255,255,255,0.55)' : v < 0.5 ? 'rgba(20,40,70,0.45)' : 'rgba(170,205,235,0.5)'; x.fillRect(px, y, 7, 7); }
  x.fillStyle = 'rgba(255,255,255,0.12)'; for (let y = 0; y < 256; y += 40) x.fillRect(0, y, 128, 2);
  return tex(c, true);
}
function blob() {
  const [c, x] = cv2(64, 64), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return tex(c, false);
}
function glowT() {
  const [c, x] = cv2(64, 64), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return tex(c, false);
}
function smokeT() {
  const [c, x] = cv2(64, 64);
  for (let i = 0; i < 6; i++) { const g = x.createRadialGradient(20 + i * 5, 26 + (i % 3) * 6, 0, 20 + i * 5, 26 + (i % 3) * 6, 18); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }
  return tex(c, false);
}
function signT(lines, bg = '#0f6b3a', fg = '#ffffff', w = 512, h = 192) {
  const [c, x] = cv2(w, h);
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => { x.font = `${i ? 600 : 800} ${i ? 40 : 58}px system-ui, sans-serif`; x.fillText(l, w / 2, h / (lines.length + 1) * (i + 1)); });
  return tex(c, false);
}
/** A stage's sky: its gradient, the sun, drifting clouds and its own skyline on the horizon (seamless sideways). */
function skyFor(t) {
  const [c, x] = cv2(1024, 512), HZ = 512 * 0.44;
  const g = x.createLinearGradient(0, 0, 0, HZ); g.addColorStop(0, t.top); g.addColorStop(1, t.hz);
  x.fillStyle = g; x.fillRect(0, 0, 1024, HZ + 1); x.fillStyle = t.fog; x.fillRect(0, HZ, 1024, 512 - HZ);
  const sx = 700, sy = t.sunset ? HZ - 26 : 70, sr = t.sunset ? 46 : 26;
  const sg = x.createRadialGradient(sx, sy, 0, sx, sy, sr * 5); sg.addColorStop(0, t.sunset ? 'rgba(255,190,110,0.95)' : 'rgba(255,255,240,0.95)'); sg.addColorStop(0.2, t.sunset ? 'rgba(255,150,80,0.45)' : 'rgba(255,250,220,0.35)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sg; x.fillRect(0, 0, 1024, HZ); x.fillStyle = t.sunset ? '#ffd9a0' : '#fffef2'; x.beginPath(); x.arc(sx, sy, sr, 0, 7); x.fill();
  // clouds: soft clusters, wrapped so the sky has no seam
  for (let k = 0; k < 14; k++) {
    const cx = hash(k * 31 + t.key.length) * 1024, cy = 30 + hash(k * 17) * (HZ - 90), w = 60 + hash(k * 7) * 140;
    for (const ox of [-1024, 0, 1024]) for (let p = 0; p < 9; p++) {
      const px = cx + ox + (p - 4) * w * 0.12, py = cy + Math.sin(p * 1.7) * 8 - (4 - Math.abs(p - 4)) * 4, r = w * (0.14 + (4 - Math.abs(p - 4)) * 0.03);
      const cg = x.createRadialGradient(px, py, 0, px, py, r); cg.addColorStop(0, t.sunset ? 'rgba(255,214,186,0.85)' : 'rgba(255,255,255,0.9)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = cg; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
  }
  // the skyline of the stage
  const ridge = (col, base, amp, f1, f2, jag = 0) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, HZ);
    for (let px = 0; px <= 1024; px += 8) { const a = (px / 1024) * Math.PI * 2; x.lineTo(px, HZ - base - amp * (0.5 + 0.5 * Math.sin(a * f1 + 1)) * (0.6 + 0.4 * Math.sin(a * f2)) - (jag ? Math.abs(Math.sin(px * 0.09)) * jag : 0)); }
    x.lineTo(1024, HZ); x.fill();
  };
  if (t.key === 'coast') { ridge('rgba(90,130,160,0.55)', 2, 18, 3, 7); ridge('rgba(70,110,140,0.6)', 0, 8, 5, 2); }
  if (t.key === 'valley') { ridge('rgba(96,140,120,0.6)', 4, 40, 2, 5); ridge('rgba(80,128,90,0.75)', 0, 22, 4, 3); }
  if (t.key === 'canyon') { for (let k = 0; k < 9; k++) { const px = hash(k * 13) * 1024, w = 50 + hash(k * 5) * 120, h = 20 + hash(k * 3) * 46; x.fillStyle = 'rgba(176,96,62,0.65)'; for (const ox of [-1024, 0, 1024]) { x.fillRect(px + ox, HZ - h, w, h); x.beginPath(); x.moveTo(px + ox - 14, HZ); x.lineTo(px + ox, HZ - h); x.lineTo(px + ox, HZ); x.fill(); } } }
  if (t.key === 'city') { for (let px = 0; px < 1024; px += 14) { const h = 14 + hash(px) * 70; x.fillStyle = `rgba(${110 + (px % 40)},${125 + (px % 30)},${145},0.6)`; x.fillRect(px, HZ - h, 12, h); } }
  if (t.key === 'alpine') { ridge('rgba(120,140,175,0.7)', 6, 70, 3, 7, 18); x.globalAlpha = 0.85; ridge('#f4f8fc', 50, 26, 3, 7, 18); x.globalAlpha = 1; ridge('rgba(100,120,150,0.75)', 0, 30, 5, 2, 8); }
  const tx = tex(c); tx.wrapS = THREE.RepeatWrapping; tx.repeat.set(0.5, 1);
  return tx;
}
function envCube() {
  const face = (top, mid, bot, horizon = 0.55) => { const [c, x] = cv2(128, 128), g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, top); g.addColorStop(horizon - 0.02, mid); g.addColorStop(horizon + 0.02, bot); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; };
  const side = face('#5d9cf2', '#e8f3ff', '#6a7466');
  const t = new THREE.CubeTexture([side, side, face('#6aa8ff', '#6aa8ff', '#6aa8ff'), face('#4d5249', '#4d5249', '#4d5249'), side, side]);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------- models
/** One geometry from parts [{ geo, color }], with vertex colours (white parts take the material's colour). */
function merge(parts) {
  let n = 0;
  const L = parts.map(({ geo, color }) => { const g = geo.index ? geo.toNonIndexed() : geo; n += g.attributes.position.count; return [g, C(color)]; });
  const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
  let o = 0;
  for (const [g, c] of L) { const cnt = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); Nn.set(g.attributes.normal.array, o * 3); for (let i = 0; i < cnt; i++) { Cc[(o + i) * 3] = c.r; Cc[(o + i) * 3 + 1] = c.g; Cc[(o + i) * 3 + 2] = c.b; } o += cnt; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(Nn, 3)); out.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  out.computeBoundingSphere();
  return out;
}
/** A side profile [[u (metres from the front), y]] extruded across `w`, the front toward −z, centred on a car of length len. */
function profile(pts, w, len, bevel = 0.06) {
  const sh = new THREE.Shape(); pts.forEach(([u, y], i) => (i ? sh.lineTo(u, y) : sh.moveTo(u, y))); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.02, w - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(w - 2 * bevel) / 2); g.rotateY(-Math.PI / 2); g.translate(0, 0, -len / 2);
  return g;
}
/** Like profile(), its outline a straight run then a smooth curve through the rest (a car's back, roof and nose). */
function smooth(start, curve, w, len, bevel = 0.1) {
  const sh = new THREE.Shape(); sh.moveTo(start[0][0], start[0][1]); for (const [u, y] of start.slice(1)) sh.lineTo(u, y); sh.splineThru(curve.map(([u, y]) => new THREE.Vector2(u, y))); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.02, w - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -(w - 2 * bevel) / 2); g.rotateY(-Math.PI / 2); g.translate(0, 0, -len / 2); g.computeBoundingBox();
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, len, x, y, z, seg = 14, axis = 'x', r2 = r) => { const g = new THREE.CylinderGeometry(r, r2, len, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return g.translate(x, y, z); };
function wheelParts(len, ws, us, r = 0.34, tw = 0.26) {
  const out = [];
  for (const u of us) for (const sx of [-1, 1]) {
    const z = u - len / 2, x = sx * ws;
    out.push({ geo: cyl(r, tw, x, r, z, 16), color: '#141416' }, { geo: cyl(r * 0.68, tw + 0.02, x, r, z, 12), color: '#aab1ba' }, { geo: cyl(r * 0.25, tw + 0.04, x, r, z, 8), color: '#3a3d42' });
  }
  return out;
}
/** A car: { paint (white parts take the paint), detail (glass, tyres, trim), lights (lit) } geometries. */
function carModel(kind) {
  const GL = '#18202c', TR = '#1c1d21', HL = '#fff6dc', TL = '#ff2424';
  if (kind === 'supercar') {
    // our red Italian-style mid-engine supercar: low and wide, a short cabin with an upright rear window between flying
    // buttresses, a long engine cover with louvres, haunches over the rear wheels, a black rear with a mesh panel, four
    // round tail lights in chrome rings, a diffuser with fins and quad exhausts
    const L = 4.55, W = 1.92, BLK = '#0c0d0f';
    const body = smooth([[0.38, 0.34], [4.25, 0.36], [4.52, 0.4], [4.53, 0.74], [4.5, 0.8]], [[4.2, 0.85], [3.6, 0.86], [3.0, 0.83], [2.3, 0.78], [1.6, 0.73], [1.15, 0.67], [0.6, 0.57], [0.22, 0.46], [0.05, 0.36], [0.14, 0.3]], W, L, 0.09);
    const tub = profile([[0.22, 0.12], [4.3, 0.12], [4.47, 0.2], [4.47, 0.44], [0.16, 0.42]], 1.5, L, 0.04); tub.computeBoundingBox();   // the low middle: the wheels show at the corners
    const hips = smooth([[2.95, 0.42], [4.3, 0.42], [4.47, 0.44]], [[4.47, 0.66], [4.3, 0.8], [3.9, 0.855], [3.35, 0.8], [3.0, 0.62]], 2.06, L, 0.08);
    const nose = smooth([[0.42, 0.36], [1.45, 0.36]], [[1.48, 0.55], [1.2, 0.665], [0.75, 0.6], [0.45, 0.5]], 2.0, L, 0.07);
    const glass = smooth([[1.5, 0.72], [3.12, 0.8]], [[3.1, 0.96], [2.95, 1.08], [2.6, 1.13], [2.2, 1.12], [1.85, 0.98]], 1.4, L, 0.08);
    const roof = smooth([[2.1, 1.06], [2.95, 1.06]], [[2.96, 1.1], [2.66, 1.17], [2.36, 1.17], [2.12, 1.11]], 1.24, L, 0.04);
    const buttress = sx => profile([[2.8, 0.8], [2.86, 1.13], [3.02, 1.12], [4.05, 0.855], [3.5, 0.84]], 0.13, L, 0.03).translate(sx * 0.64, 0, 0);
    const mirrors = [box(0.15, 0.09, 0.2, -1.05, 0.86, 1.72 - L / 2), box(0.15, 0.09, 0.2, 1.05, 0.86, 1.72 - L / 2)];
    const rz = body.boundingBox.max.z - 0.02, tz = tub.boundingBox.max.z, fz = body.boundingBox.min.z + 0.05, deck = u => u - L / 2;
    const detail = [{ geo: tub, color: '#141518' }, { geo: box(1.46, 0.24, 0.04, 0, 0.29, tz), color: BLK }, ...[-0.56, -0.34, -0.12, 0.12, 0.34, 0.56].map(x => ({ geo: box(0.03, 0.2, 0.2, x, 0.2, tz - 0.06), color: '#24262b' })),
      { geo: box(0.7, 0.15, 0.04, 0, 0.6, rz), color: BLK }, ...[0.56, 0.6, 0.64].map(y => ({ geo: box(0.66, 0.012, 0.045, 0, y, rz), color: '#34373e' })),
      { geo: box(0.42, 0.1, 0.03, 0, 0.5, rz + 0.012), color: '#e9e9e4' }, { geo: box(1.7, 0.06, 0.18, 0, 0.13, fz + 0.06), color: BLK },
      ...[0, 1, 2, 3, 4, 5].map(k => ({ geo: box(0.86, 0.02, 0.06, 0, 0.872, deck(3.45 + k * 0.13)), color: BLK })),
      { geo: smooth([[2.98, 0.44], [3.44, 0.44]], [[3.44, 0.62], [3.08, 0.6]], 2.12, L, 0.02), color: BLK },
      ...[-0.34, -0.2, 0.2, 0.34].map(x => ({ geo: cyl(0.032, 0.2, x, 0.27, tz + 0.05, 10, 'z'), color: '#050505' })),
      ...wheelParts(L, 0.88, [0.98, 3.56], 0.34, 0.34)];
    const shine = [{ geo: glass, color: '#0e141c' }, ...[-0.68, -0.42, 0.42, 0.68].map(x => ({ geo: cyl(0.1, 0.04, x, 0.66, rz, 18, 'z'), color: '#e3e6ea' })),
      ...[-0.34, -0.2, 0.2, 0.34].map(x => ({ geo: cyl(0.05, 0.18, x, 0.27, tz + 0.04, 12, 'z'), color: '#d0d4da' }))];
    const lights = [...[-0.68, -0.42, 0.42, 0.68].map(x => ({ geo: cyl(0.078, 0.045, x, 0.66, rz + 0.008, 18, 'z'), color: TL })),
      { geo: box(0.44, 0.05, 0.05, -0.6, 0.5, fz), color: HL }, { geo: box(0.44, 0.05, 0.05, 0.6, 0.5, fz), color: HL }];
    return { paint: merge([body, hips, nose, roof, buttress(-1), buttress(1), ...mirrors].map(geo => ({ geo, color: '#fff' }))), detail: merge(detail), shine: merge(shine), lights: merge(lights), len: L, w: 2.1 };
  }
  const K = KINDS[kind], L = K.l, W = K.w, rear = L / 2 + 0.005, front = -L / 2 - 0.005;
  let body, cabin, extra = [], ys = 0.62, us = [0.85, L - 0.9], r = 0.33;
  if (kind === 'sedan') {
    body = profile([[0.15, 0.22], [L - 0.2, 0.22], [L, 0.36], [L, 0.78], [L - 0.7, 0.86], [1.3, 0.82], [0.4, 0.74], [0, 0.62], [0, 0.32]], W, L);
    cabin = profile([[1.3, 0.8], [1.95, 1.34], [3.25, 1.36], [3.85, 0.86]], W - 0.18, L, 0.05);
  } else if (kind === 'hatch') {
    body = profile([[0.15, 0.22], [L - 0.15, 0.22], [L, 0.36], [L, 0.86], [L - 0.15, 0.95], [1.1, 0.86], [0.35, 0.76], [0, 0.64], [0, 0.32]], W, L);
    cabin = profile([[1.1, 0.84], [1.75, 1.4], [3.3, 1.42], [L - 0.12, 1.02], [L - 0.15, 0.92]], W - 0.16, L, 0.05);
  } else if (kind === 'suv') {
    body = profile([[0.15, 0.3], [L - 0.15, 0.3], [L, 0.45], [L, 1.05], [1.2, 1.08], [0.3, 0.98], [0, 0.85], [0, 0.4]], W, L);
    cabin = profile([[1.2, 1.04], [1.85, 1.72], [L - 0.35, 1.74], [L - 0.1, 1.06]], W - 0.14, L, 0.05);
    ys = 0.8; r = 0.38; extra = [{ geo: box(W - 0.4, 0.05, L - 2.4, 0, 1.8, 0.3), color: '#2a2b2f' }];
  } else if (kind === 'van') {
    body = profile([[0.1, 0.32], [L - 0.1, 0.32], [L, 0.45], [L, 2.12], [1.3, 2.15], [0.5, 1.25], [0.05, 1.0], [0, 0.45]], W, L);
    cabin = profile([[0.62, 1.2], [1.25, 1.95], [1.9, 1.95], [1.9, 1.22]], W + 0.02, L, 0.02);
    ys = 0.85; r = 0.36;
  } else if (kind === 'truck') {
    body = profile([[0, 0.55], [2.4, 0.55], [2.4, 2.95], [0.25, 2.95], [0, 2.6]], W, L);
    cabin = profile([[0.02, 1.7], [2.2, 1.7], [2.2, 2.55], [0.15, 2.55]], W + 0.02, L, 0.02);
    extra = [{ geo: box(W, 2.9, L - 2.6, 0, 2.45, 1.3), color: '#e9eaec' }, { geo: box(W - 0.3, 0.35, L - 0.4, 0, 0.62, 0.1), color: '#26272b' }];
    us = [1.1, L - 2.6, L - 1.3]; r = 0.48; ys = 1.1;
  } else {   // bus
    body = profile([[0, 0.38], [L, 0.38], [L, 3.05], [0.15, 3.1], [0, 2.85]], W, L);
    cabin = box(W + 0.02, 0.95, L - 1.0, 0, 2.05, 0.2);
    extra = [{ geo: box(W - 0.2, 1.2, 0.06, 0, 1.95, front), color: GL }];
    us = [2.2, L - 2.6]; r = 0.5; ys = 0.9;
  }
  const detail = [{ geo: cabin, color: GL }, ...extra, { geo: box(W * 0.8, 0.14, 0.05, 0, 0.3, rear), color: TR }, ...wheelParts(L, W / 2 - 0.12, us, r, 0.26)];
  const lights = [{ geo: box(0.32, 0.12, 0.05, -W / 2 + 0.28, ys, rear), color: TL }, { geo: box(0.32, 0.12, 0.05, W / 2 - 0.28, ys, rear), color: TL },
    { geo: box(0.3, 0.12, 0.05, -W / 2 + 0.3, ys - 0.06, front), color: HL }, { geo: box(0.3, 0.12, 0.05, W / 2 - 0.3, ys - 0.06, front), color: HL }];
  return { paint: merge([{ geo: body, color: '#fff' }]), detail: merge(detail), lights: merge(lights), len: L, w: W };
}
/** Scenery pieces: merged with vertex colours; an instance colour shades each one. */
function sceneryModels() {
  const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
  const fronds = []; for (let k = 0; k < 7; k++) { const g = new THREE.ConeGeometry(0.5, 3.6, 4, 1); g.scale(1, 1, 0.25); g.rotateZ(Math.PI / 2 + 0.55); g.translate(1.6, -0.6, 0); g.rotateY((k / 7) * Math.PI * 2); g.translate(0, 7.4, 0); fronds.push({ geo: g, color: k % 2 ? '#3f8f3a' : '#4fa443' }); }
  const pine = (snow) => [{ geo: cyl(0.22, 2, 0, 1, 0, 6, 'y'), color: '#6b4a2f' }, ...[0, 1, 2].map(i => ({ geo: new THREE.ConeGeometry(2.4 - i * 0.6, 3.2, 8).translate(0, 2.8 + i * 1.9, 0), color: snow && i === 2 ? '#f2f6fa' : snow ? '#2f5e46' : i === 1 ? '#2f6d3a' : '#285f33' })),
    ...(snow ? [{ geo: new THREE.ConeGeometry(1.25, 1.1, 8).translate(0, 4.45, 0), color: '#eef3f8' }, { geo: new THREE.ConeGeometry(1.85, 1.0, 8).translate(0, 2.55, 0), color: '#e8eef4' }] : [])];
  const mountain = (snow) => { const g = new THREE.ConeGeometry(1, 1, 9, 3); g.translate(0, 0.5, 0); const p = g.attributes.position, col = new Float32Array(p.count * 3), a = C(snow ? '#7e8ea6' : '#5f8a52'), b = C(snow ? '#f6f9fc' : '#7aa063'); for (let i = 0; i < p.count; i++) { const y = p.getY(i), jit = (hash(i * 7) - 0.5) * 0.08; p.setX(i, p.getX(i) * (1 + jit)); p.setZ(i, p.getZ(i) * (1 + jit)); const c = y > (snow ? 0.55 : 0.8) ? b : a; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g; };
  return {
    palm: merge([{ geo: cyl(0.16, 7.4, 0, 3.7, 0, 7, 'y', 0.24), color: '#8a6a45' }, ...fronds, { geo: ico(0.45, 0).translate(0, 7.3, 0), color: '#6b4f2e' }]),
    pine: merge(pine(false)),
    snowpine: merge(pine(true)),
    tree: merge([{ geo: cyl(0.24, 2.6, 0, 1.3, 0, 7, 'y', 0.3), color: '#6d4c33' }, { geo: ico(2.3, 1).translate(0, 3.9, 0), color: '#4f9a3f' }, { geo: ico(1.6, 1).translate(1.0, 4.8, 0.4), color: '#5aa847' }, { geo: ico(1.5, 1).translate(-0.9, 4.4, -0.6), color: '#478f39' }]),
    bush: merge([{ geo: ico(1, 1).scale(1.3, 0.8, 1.2).translate(0, 0.6, 0), color: '#5b9a46' }, { geo: ico(0.8, 1).translate(0.7, 0.6, 0.3), color: '#6aa952' }]),
    cactus: merge([{ geo: cyl(0.32, 4.4, 0, 2.2, 0, 8, 'y'), color: '#3f7f45' }, { geo: ico(0.32, 1).translate(0, 4.4, 0), color: '#3f7f45' }, { geo: cyl(0.2, 1.5, 0.75, 2.4, 0, 7, 'y'), color: '#47884c' }, { geo: cyl(0.2, 0.6, 0.45, 1.7, 0, 7, 'x'), color: '#47884c' }, { geo: cyl(0.18, 1.2, -0.65, 3.0, 0, 7, 'y'), color: '#47884c' }, { geo: cyl(0.18, 0.5, -0.4, 2.45, 0, 7, 'x'), color: '#47884c' }]),
    rock: merge([{ geo: new THREE.DodecahedronGeometry(1, 0).scale(1.4, 0.8, 1.1).translate(0, 0.4, 0), color: '#9a8f86' }, { geo: new THREE.DodecahedronGeometry(0.6, 0).translate(1.0, 0.3, 0.4), color: '#8a7f77' }]),
    mesa: merge([{ geo: new THREE.CylinderGeometry(0.85, 1, 1, 7, 2).translate(0, 0.5, 0), color: '#b8643a' }, { geo: new THREE.CylinderGeometry(0.86, 0.86, 0.1, 7).translate(0, 0.96, 0), color: '#d98a55' }, { geo: new THREE.CylinderGeometry(0.95, 0.95, 0.06, 7).translate(0, 0.62, 0), color: '#9b4f2c' }]),
    mountain: mountain(false), snowmtn: mountain(true),
    house: merge([{ geo: box(1, 0.7, 1, 0, 0.35, 0), color: '#ffffff' }, { geo: new THREE.ConeGeometry(0.82, 0.45, 4).rotateY(Math.PI / 4).translate(0, 0.92, 0), color: '#a5442f' }, { geo: box(0.18, 0.28, 0.02, 0, 0.14, 0.51), color: '#5b3b2a' }, { geo: box(0.2, 0.18, 0.02, 0.28, 0.42, 0.51), color: '#9fc3e6' }, { geo: box(0.2, 0.18, 0.02, -0.28, 0.42, 0.51), color: '#9fc3e6' }]),
    barn: merge([{ geo: box(1, 0.7, 1.4, 0, 0.35, 0), color: '#b23a2e' }, { geo: new THREE.CylinderGeometry(0.58, 0.58, 1.42, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.55, 1).translate(0, 0.7, 0), color: '#5b5f66' }, { geo: box(0.4, 0.45, 0.02, 0, 0.22, 0.71), color: '#f2e6d0' }]),
    lamp: merge([{ geo: cyl(0.09, 8, 0, 4, 0, 6, 'y'), color: '#6b7380' }, { geo: box(1.9, 0.1, 0.12, -0.9, 7.95, 0), color: '#6b7380' }, { geo: box(0.55, 0.12, 0.3, -1.75, 7.85, 0), color: '#e7ecf2' }]),
    post: merge([{ geo: box(0.12, 0.8, 0.12, 0, 0.4, 0), color: '#8a9099' }]),
    marker: merge([{ geo: box(0.14, 1.1, 0.1, 0, 0.55, 0), color: '#f4f4f0' }, { geo: box(0.15, 0.22, 0.11, 0, 0.92, 0), color: '#111216' }, { geo: box(0.08, 0.14, 0.12, 0, 0.92, 0), color: '#ff6a1a' }]),
    snowpole: merge([0, 1, 2, 3, 4, 5].map(k => ({ geo: box(0.09, 0.5, 0.09, 0, 0.25 + k * 0.5, 0), color: k % 2 ? '#111216' : '#ff7a1a' }))),
    pole: merge([{ geo: cyl(0.13, 9, 0, 4.5, 0, 6, 'y', 0.16), color: '#7a5a3c' }, { geo: box(2.2, 0.12, 0.12, 0, 8.4, 0), color: '#6b4f33' }, ...[-0.9, 0, 0.9].map(x2 => ({ geo: cyl(0.06, 0.2, x2, 8.55, 0, 6, 'y'), color: '#cfd8dc' }))]),
    building: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  };
}

// ------------------------------------------------------------------------------------------- the game's screen
export function createView(cv) {
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 3 / 4, 0.3, 2600);
  scene.fog = new THREE.Fog(0xc4e2f7, 200, 1300);
  const skies = new Map(), skyOf = i => { let t = skies.get(i); if (!t) { t = skyFor(i >= 5 ? { ...THEMES[i % 5], ...SUNSET, sunset: true } : THEMES[i]); skies.set(i, t); } return t; };
  let skyIdx = -1;
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x8a8470, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4); sun.position.set(-0.45, 1, 0.65); scene.add(sun);
  const env = envCube();
  // ---- the road, its shoulders and rails, the ground on each side, the sea
  // (rightward: its columns run left to right, so its triangles are wound the other way to face up)
  const ribbon = (cols, mat, rightward = false) => {
    const g = new THREE.BufferGeometry(), V = N * cols;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(V * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(V * 2), 2)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(V * 3).fill(1), 3));
    const idx = []; for (let i = 0; i < N - 1; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j; if (rightward) idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols); else idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m); return m;
  };
  const roadT = asphalt();
  const road = ribbon(2, new THREE.MeshLambertMaterial({ map: roadT, side: THREE.DoubleSide }), true);
  const groundT = noise(205); groundT.repeat.set(1, 1);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundT, side: THREE.DoubleSide });
  const groundL = ribbon(5, groundMat), groundR = ribbon(5, groundMat, true);
  const waterT = water();
  const sea = ribbon(2, new THREE.MeshPhongMaterial({ map: waterT, color: 0xffffff, specular: 0xffffff, shininess: 90, side: THREE.DoubleSide }));
  const railT = rail();
  const railMat = new THREE.MeshPhongMaterial({ map: railT, specular: 0x999999, shininess: 60, side: THREE.DoubleSide });
  const rails = [ribbon(2, railMat), ribbon(2, railMat)];
  // ---- scenery
  const M = sceneryModels(), BIG = 1;
  const kinds = {
    palm: 160, pine: 220, snowpine: 260, tree: 180, bush: 160, cactus: 140, rock: 160, mesa: 50, mountain: 40, snowmtn: 40, house: 60, barn: 24, lamp: 90, post: 340, building: 160, marker: 120, snowpole: 120, pole: 40,
  };
  const winT = windows('#7a93ad');
  const inst = {};
  for (const [k, cap] of Object.entries(kinds)) {
    const mat = k === 'building' ? new THREE.MeshLambertMaterial({ map: winT }) : k === 'mountain' || k === 'snowmtn' ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(M[k], mat, cap); im.frustumCulled = false; im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    scene.add(im); inst[k] = im;
  }
  void BIG;
  // signs: gantries over the city's road, billboards in the country (a few meshes each, moved along)
  const gantrySign = signT(['MVW CITY', 'EXIT 12  ·  ARCADE ↗']), boards = [signT(['MY VIRTUAL WORLD', 'Your city. Your agents.'], '#e11d48', '#fff'), signT(['TURBO RUSH', 'Near misses fill your boost'], '#1d4ed8', '#fff'), signT(['PLAY THE ARCADE', 'Ten games, real high scores'], '#f59e0b', '#1f2937')];
  const signMeshes = [];
  for (let i = 0; i < 6; i++) {
    const gantry = i < 3, g = new THREE.Group();
    if (gantry) { g.add(new THREE.Mesh(box(0.35, 7, 0.35, -9.6, 3.5, 0), new THREE.MeshLambertMaterial({ color: 0x8b929b })), new THREE.Mesh(box(0.35, 7, 0.35, 9.6, 3.5, 0), new THREE.MeshLambertMaterial({ color: 0x8b929b })), new THREE.Mesh(box(19.6, 0.5, 0.5, 0, 7, 0), new THREE.MeshLambertMaterial({ color: 0x8b929b }))); const p = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), new THREE.MeshLambertMaterial({ map: gantrySign })); p.position.set(3.6, 5.6, 0.3); g.add(p); }
    else { g.add(new THREE.Mesh(box(0.3, 5, 0.3, -3, 2.5, 0), new THREE.MeshLambertMaterial({ color: 0x6b7380 })), new THREE.Mesh(box(0.3, 5, 0.3, 3, 2.5, 0), new THREE.MeshLambertMaterial({ color: 0x6b7380 }))); const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), new THREE.MeshLambertMaterial({ map: boards[i - 3], side: THREE.DoubleSide })); p.position.set(0, 5.6, 0); g.add(p); }
    g.visible = false; scene.add(g); signMeshes.push(g);
  }
  // ---- cars
  const glowTex = glowT(), shadowT = blob(), smokeTex = smokeT();
  const MODELS = Object.fromEntries(['supercar', 'sedan', 'hatch', 'suv', 'van', 'truck', 'bus'].map(k => [k, carModel(k)]));
  const paintMat = new Map(), paint = hex => { let m = paintMat.get(hex); if (!m) { m = new THREE.MeshPhongMaterial({ color: hex, vertexColors: true, specular: 0xbbbbbb, shininess: 110, envMap: env, combine: THREE.MixOperation, reflectivity: 0.13 }); paintMat.set(hex, m); } return m; };
  const detailMat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x888888, shininess: 90, envMap: env, combine: THREE.MixOperation, reflectivity: 0.32 });
  const matteMat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x333333, shininess: 30 });   // the supercar's trim (its glass and chrome shine apart)
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat = new THREE.MeshBasicMaterial({ map: shadowT, transparent: true, depthWrite: false, opacity: 0.85 });
  const TRAFFIC_C = ['#f3f4f6', '#a8afb8', '#1f2933', '#b91c1c', '#1d4ed8', '#4b5563', '#0f5132', '#c2410c', '#facc15', '#6d28d9'];
  const RIVAL_C = ['#fbbf24', '#2563eb', '#16a34a'];
  function makeCar(kind, color) {
    const m = MODELS[kind], g = new THREE.Group();
    g.add(new THREE.Mesh(m.paint, paint(color)), new THREE.Mesh(m.detail, m.shine ? matteMat : detailMat), new THREE.Mesh(m.lights, lightMat));
    if (m.shine) g.add(new THREE.Mesh(m.shine, detailMat));
    const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.scale.set(m.w + 0.9, 1, m.len + 1.2); sh.position.y = 0.03; sh.renderOrder = 1; g.add(sh);
    scene.add(g); return g;
  }
  const me = makeCar('supercar', '#c00010');
  const cars = new Map(), rivals = new Map(), wrecks = [];
  // ---- particles: sparks and flames (additive), smoke (soft)
  const particles = (n, size, blend, map) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4)); const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, depthWrite: false, blending: blend, sizeAttenuation: true })); p.frustumCulled = false; scene.add(p); return { p, n, list: [] }; };
  const sparks = particles(260, 0.35, THREE.AdditiveBlending, glowTex), smoke = particles(140, 3.2, THREE.NormalBlending, smokeTex), flames = particles(120, 0.42, THREE.AdditiveBlending, glowTex);
  const emit = (P, pos, n, o) => { for (let i = 0; i < n && P.list.length < P.n; i++) P.list.push({ x: pos.x + (Math.random() - 0.5) * (o.spread || 0.4), y: pos.y + Math.random() * 0.3, z: pos.z + (Math.random() - 0.5) * (o.spread || 0.4), vx: (Math.random() - 0.5) * o.v, vy: Math.random() * o.up, vz: (Math.random() - 0.5) * o.v + (o.vz || 0), t: 0, life: o.life * (0.6 + Math.random() * 0.6), c: o.c, g: o.g ?? 9 }); };
  const stepParticles = (P, dt, fade = true) => {
    const pos = P.p.geometry.attributes.position.array, col = P.p.geometry.attributes.color.array; let n = 0;
    P.list = P.list.filter(q => { q.t += dt; if (q.t > q.life) return false; q.vy -= q.g * dt; q.x += q.vx * dt; q.y = Math.max(0.05, q.y + q.vy * dt); q.z += q.vz * dt; const a = fade ? 1 - q.t / q.life : 1; pos[n * 3] = q.x; pos[n * 3 + 1] = q.y; pos[n * 3 + 2] = q.z; col[n * 4] = q.c[0]; col[n * 4 + 1] = q.c[1]; col[n * 4 + 2] = q.c[2]; col[n * 4 + 3] = a * (q.c[3] ?? 1); n++; return true; });
    P.p.geometry.setDrawRange(0, n); P.p.geometry.attributes.position.needsUpdate = true; P.p.geometry.attributes.color.needsUpdate = true;
  };
  // ---- the road's line round the car
  const px = new Float32Array(N), pz = new Float32Array(N), py = new Float32Array(N), ph = new Float32Array(N), pzt = new Float32Array(N);
  const hillAt = (s, z) => { for (let i = s.track.length - 1; i >= 0; i--) { const sec = s.track[i]; if (z >= sec.z) return sec.hill * Math.sin((Math.PI * (z - sec.z)) / sec.len); } return 0; };
  function line(s) {
    const y0 = hillAt(s, s.z);
    px[BACK] = pz[BACK] = py[BACK] = ph[BACK] = 0; pzt[BACK] = s.z;
    for (let i = BACK + 1; i < N; i++) { const z = s.z + (i - BACK - 0.5) * STEP, h = ph[i - 1] + sim.curveAt(s, z) * STEP; ph[i] = h; px[i] = px[i - 1] + Math.sin(h) * STEP; pz[i] = pz[i - 1] - Math.cos(h) * STEP; pzt[i] = s.z + (i - BACK) * STEP; py[i] = hillAt(s, pzt[i]) - y0; }
    for (let i = BACK - 1; i >= 0; i--) { const z = s.z + (i - BACK + 0.5) * STEP, h = ph[i + 1] - sim.curveAt(s, z) * STEP; ph[i] = h; px[i] = px[i + 1] - Math.sin(h) * STEP; pz[i] = pz[i + 1] + Math.cos(h) * STEP; pzt[i] = s.z + (i - BACK) * STEP; py[i] = hillAt(s, pzt[i]) - y0; }
  }
  /** The point d m along the road from the car (beyond the line: straight on) and lat m to its right; → the heading. */
  function at(d, lat, out) {
    const f = d / STEP + BACK;
    let i = Math.floor(f), u = f - i, h, x, z, y;
    if (i >= N - 1) { const e = (f - (N - 1)) * STEP; h = ph[N - 1]; x = px[N - 1] + Math.sin(h) * e; z = pz[N - 1] - Math.cos(h) * e; y = py[N - 1]; }
    else { if (i < 0) { i = 0; u = 0; } h = ph[i] + (ph[i + 1] - ph[i]) * u; x = px[i] + (px[i + 1] - px[i]) * u; z = pz[i] + (pz[i + 1] - pz[i]) * u; y = py[i] + (py[i + 1] - py[i]) * u; }
    out.set(x + Math.cos(h) * lat, y, z + Math.sin(h) * lat);
    return h;
  }
  // the ground on one side of the road: its distance out from the middle, its height, its colour, row by row
  const groundCols = (z, side, t) => {
    const hill = t.hill, s1 = Math.sin(z / 170 + side * 1.7), s2 = Math.sin(z / 330 + side * 0.6);
    if (t.sea && side < 0) return [[WALL + 0.35, -0.12, t.near], [WALL + 5, -0.5, t.near], [26, -0.9, t.near], [34, -1.6, '#d9c38a'], [34.1, -1.6, '#d9c38a']];
    return [[WALL + 0.35, -0.12, t.near], [WALL + 6, -0.9, t.near], [40, hill * 0.15 * (0.5 + 0.5 * s1), t.near], [220, hill * (0.45 + 0.35 * s2), t.far], [1600, hill * (0.9 + 0.5 * s1), t.far]];
  };
  const groundY = (z, side, t, lat) => { const cols = groundCols(z, side, t); for (let j = 1; j < cols.length; j++) if (lat <= cols[j][0]) { const a = cols[j - 1], b = cols[j], u = (lat - a[0]) / Math.max(0.01, b[0] - a[0]); return a[1] + (b[1] - a[1]) * u; } return cols[cols.length - 1][1]; };
  const _col = new THREE.Color(), _cB = new THREE.Color();
  function fillGround(m, side, s) {
    const P = m.geometry.attributes.position.array, U = m.geometry.attributes.uv.array, Cc = m.geometry.attributes.color.array;
    for (let i = 0; i < N; i++) {
      const t = themeAt(pzt[i]), cols = groundCols(pzt[i], side, t), h = ph[i], c = Math.cos(h), sn = Math.sin(h);
      // (a stage's look fades into the next over the last 120 m)
      const zn = pzt[i] - stageAt(pzt[i]) * STAGE_LEN, nt = zn > STAGE_LEN - 120 ? themeAt(pzt[i] + 130) : null, mix = nt ? (zn - (STAGE_LEN - 120)) / 120 : 0;
      cols.forEach(([lat, y, col], j) => {
        const k = (i * 5 + j);
        P[k * 3] = px[i] + c * lat * side; P[k * 3 + 1] = py[i] + y; P[k * 3 + 2] = pz[i] + sn * lat * side;
        U[k * 2] = (lat * side) / 18; U[k * 2 + 1] = pzt[i] / 18;
        _col.set(col); if (nt) { const nc = groundCols(pzt[i], side, nt)[j][2]; _cB.set(nc); _col.lerp(_cB, mix); }
        Cc[k * 3] = _col.r; Cc[k * 3 + 1] = _col.g; Cc[k * 3 + 2] = _col.b;
      });
    }
    m.geometry.attributes.position.needsUpdate = m.geometry.attributes.uv.needsUpdate = m.geometry.attributes.color.needsUpdate = true;
  }
  function fillStrip(m, latA, latB, yA, yB, uvScale, vScale, yFn = null) {
    const P = m.geometry.attributes.position.array, U = m.geometry.attributes.uv.array;
    for (let i = 0; i < N; i++) {
      const h = ph[i], c = Math.cos(h), sn = Math.sin(h), dy = yFn ? yFn(i) : 0;
      P[i * 6] = px[i] + c * latA; P[i * 6 + 1] = py[i] + yA + dy; P[i * 6 + 2] = pz[i] + sn * latA;
      P[i * 6 + 3] = px[i] + c * latB; P[i * 6 + 4] = py[i] + yB + dy; P[i * 6 + 5] = pz[i] + sn * latB;
      const v = pzt[i] / vScale; U[i * 4] = 0; U[i * 4 + 1] = v; U[i * 4 + 2] = uvScale; U[i * 4 + 3] = v;
    }
    m.geometry.attributes.position.needsUpdate = m.geometry.attributes.uv.needsUpdate = true;
  }
  // ---- placing the scenery along the road
  const v3 = new THREE.Vector3(), v4 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const count = {};
  const put = (k, s, d, lat, sx, sy, sz, yaw, col, onGround = true, side = Math.sign(lat) || 1) => {
    const im = inst[k]; if (!im || count[k] >= kinds[k]) return;
    const h = at(d, lat, v3); if (onGround) v3.y += groundY(s.z + d, side, themeAt(s.z + d), Math.abs(lat));
    q.setFromAxisAngle(up, -h + yaw); sc.set(sx, sy, sz);
    im.setMatrixAt(count[k], m4.compose(v3, q, sc)); im.setColorAt(count[k], _col.set(col)); count[k]++;
  };
  // the road far ahead, coarse (20 m steps to 3.2 km): big things are placed by it and kept off it
  const FSTEP = 20, FN = 160, fX = new Float32Array(FN), fZ = new Float32Array(FN), fH = new Float32Array(FN), farOk = new Map(), bigs = [];
  function farLine(s) { for (let i = 1; i < FN; i++) { const h = fH[i - 1] + sim.curveAt(s, s.z + (i - 0.5) * FSTEP) * FSTEP; fH[i] = h; fX[i] = fX[i - 1] + Math.sin(h) * FSTEP; fZ[i] = fZ[i - 1] - Math.cos(h) * FSTEP; } }
  function farAt(d, lat, out) {
    if (d < AHEAD * STEP - 8) return at(d, lat, out);
    const f = Math.min(FN - 1.001, d / FSTEP), i = Math.floor(f), u = f - i, h = fH[i] + (fH[i + 1] - fH[i]) * u;
    out.set(fX[i] + (fX[i + 1] - fX[i]) * u + Math.cos(h) * lat, py[N - 1], fZ[i] + (fZ[i + 1] - fZ[i]) * u + Math.sin(h) * lat);
    return h;
  }
  /** Is the road (from just behind the car to `to` m ahead) clear of a circle (cx, cz, rad)? */
  function roadClear(cx, cz, rad, to) {
    for (let i = 0; i < BACK; i++) if ((px[i] - cx) ** 2 + (pz[i] - cz) ** 2 < rad * rad) return false;
    for (let i = 0, n = Math.min(FN, Math.ceil(to / FSTEP)); i < n; i++) if ((fX[i] - cx) ** 2 + (fZ[i] - cz) ** 2 < rad * rad) return false;
    return true;
  }
  const bigPut = (k, s, j, d, lat, sx, sy, sz, yaw, col, rad, tag = 'f') => {
    const im = inst[k]; if (!im || count[k] >= kinds[k] || rad < 8) return;
    const h = farAt(d, lat, v3), key = `${tag}${k}:${j}:${lat > 0 ? 1 : 0}`;
    let ok = farOk.get(key);
    if (ok === undefined) { ok = roadClear(v3.x, v3.z, rad + 26, Math.max(0, d) + 1100); farOk.set(key, ok); }
    if (!ok) return;
    bigs.push(v3.x, v3.z, rad);
    v3.y -= k === 'building' ? 0 : 6;
    q.setFromAxisAngle(up, -h + yaw); sc.set(sx, sy, sz);
    im.setMatrixAt(count[k], m4.compose(v3, q, sc)); im.setColorAt(count[k], _col.set(col)); count[k]++;
  };
  const SLOT = 9;
  function scenery(s) {
    for (const k in inst) count[k] = 0;
    const k0 = Math.floor((s.z - 40) / SLOT), k1 = Math.floor((s.z + AHEAD * STEP + 60) / SLOT);
    for (let k = k0; k <= k1; k++) for (const side of [-1, 1]) {
      const zk = k * SLOT, d = zk - s.z, t = themeAt(zk), r = hash(k * 2 + (side > 0 ? 1 : 0)), r2 = hash(k * 7 + side), r3 = hash(k * 13 - side), yaw = r3 * 6.28;
      const near = (lo, hi) => side * (lo + r2 * (hi - lo));
      // guard-rail posts every other slot... (every 4.5 m: two a slot)
      put('post', s, d, side * (WALL + 0.3), 1, 1, 1, 0, '#ffffff', false); put('post', s, d + 4.5, side * (WALL + 0.3), 1, 1, 1, 0, '#ffffff', false);
      // close to the road, in a steady rhythm (the speed shows in them): marker posts, snow poles, lamps, telegraph poles
      if (k % 2 === 0) { if (t.key === 'alpine') put('snowpole', s, d, side * (WALL + 1.3), 1, 1, 1, 0, '#ffffff', false); else if (t.key !== 'city') put('marker', s, d, side * (WALL + 1.3), 1, 1, 1, 0, '#ffffff', false); }
      if (t.key === 'coast' && side > 0 && k % 4 === 0) put('lamp', s, d, side * (WALL + 1.6), 1, 1, 1, 0, '#ffffff', false);
      if ((t.key === 'valley' || t.key === 'canyon') && side > 0 && k % 5 === 0) put('pole', s, d, side * 13.5, 1, 1, 1, 0, '#ffffff', true);
      if (t.key === 'coast') {
        if (side < 0) { if (r < 0.35) put('palm', s, d, near(13, 24), 1, 0.85 + r3 * 0.4, 1, yaw, '#ffffff'); }
        else if (r < 0.4) put('palm', s, d, near(12, 30), 1, 0.8 + r3 * 0.5, 1, yaw, '#ffffff');
        else if (r < 0.5) put('house', s, d, near(34, 70), 6 + r3 * 3, 5 + r2 * 3, 7, yaw, ['#ffffff', '#fde68a', '#bae6fd', '#fecaca'][Math.floor(r3 * 4)]);
        else if (r < 0.62) put('bush', s, d, near(11, 26), 1 + r3, 1 + r3 * 0.5, 1 + r3, yaw, '#ffffff');
        else if (r < 0.7) put('rock', s, d, near(14, 40), 1 + r3 * 2, 1 + r3, 1 + r3 * 2, yaw, '#ffffff');
      } else if (t.key === 'valley') {
        if (r < 0.32) put('tree', s, d, near(12, 45), 0.9 + r3 * 0.5, 0.9 + r3 * 0.6, 0.9 + r3 * 0.5, yaw, ['#ffffff', '#e2f0c4', '#cfe3a8'][Math.floor(r3 * 3)]);
        else if (r < 0.52) put('pine', s, d, near(16, 70), 1 + r3 * 0.4, 1 + r3 * 0.6, 1 + r3 * 0.4, yaw, '#ffffff');
        else if (r < 0.7) put('bush', s, d, near(11, 22), 1 + r3, 1, 1 + r3, yaw, '#ffffff');
        else if (r < 0.74) put(r3 < 0.5 ? 'barn' : 'house', s, d, near(45, 110), 9, 7, 11, yaw, r3 < 0.5 ? '#ffffff' : '#fff7e6');
      } else if (t.key === 'canyon') {
        if (r < 0.26) put('cactus', s, d, near(12, 36), 1, 0.8 + r3 * 0.6, 1, yaw, '#ffffff');
        else if (r < 0.52) put('rock', s, d, near(12, 60), 1.2 + r3 * 3, 1 + r3 * 2, 1.2 + r3 * 3, yaw, '#e9b48a');
        else if (r < 0.6) { const lat = near(70, 200), w = Math.min(30 + r3 * 40, Math.abs(lat) - 30); bigPut('mesa', s, k * 2 + (side > 0 ? 1 : 0), d, lat, w, 25 + r2 * 45, w, yaw, '#ffffff', w, 'n'); }
        else if (r < 0.7) put('bush', s, d, near(11, 30), 0.8 + r3, 0.6, 0.8 + r3, yaw, '#c8b06a');
      } else if (t.key === 'city') {
        if (r < 0.78) { const h = 18 + r2 * r3 * 90 + r3 * 20; put('building', s, d, near(17, 38) + side * 10, 14 + r3 * 10, h, 14 + r2 * 8, 0, ['#ffffff', '#dbe7f3', '#f1e7d8', '#cfd8e3', '#e8eef5'][Math.floor(r3 * 5)], false); }
        if (k % 4 === 0) put('lamp', s, d, side * (WALL + 1.2), 1, 1, 1, side > 0 ? 0 : Math.PI, '#ffffff', false);
        if (r2 < 0.3) put('tree', s, d + 4, side * (WALL + 2.4), 0.55, 0.6, 0.55, yaw, '#ffffff', false);
      } else {   // alpine
        if (r < 0.62) put('snowpine', s, d, near(12, 70), 0.9 + r3 * 0.6, 0.9 + r3 * 0.8, 0.9 + r3 * 0.6, yaw, '#ffffff');
        else if (r < 0.75) put('rock', s, d, near(12, 50), 1.5 + r3 * 3, 1 + r3 * 2, 1.5 + r3 * 3, yaw, '#cfd6de');
        else if (r < 0.8) put('pine', s, d, near(14, 60), 1, 1 + r3 * 0.5, 1, yaw, '#ffffff');
      }
    }
    // the far hills and peaks (bigger steps, further out, further ahead): never wider than their distance from the
    // road, and only where the road ahead never comes round to them (decided once for each, the first time seen)
    farLine(s); bigs.length = 0;
    const j0 = Math.floor((s.z - 100) / 140), j1 = Math.floor((s.z + 1700) / 140);
    for (let j = j0; j <= j1; j++) for (const side of [-1, 1]) {
      const zj = j * 140, d = zj - s.z, t = themeAt(zj), r = hash(j * 3 + side), r2 = hash(j * 11 - side);
      if (t.key === 'city') { if (r < 0.8) { const w = 30 + r * 30; bigPut('building', s, j, d, side * (110 + r2 * 300), w, 60 + r2 * 160, w, 0, '#c7d3e0', w * 0.75); } continue; }
      if (t.sea && side < 0) { if (r < 0.35) { const lat = 500 + r2 * 700, w = Math.min(180 + r * 260, lat - 60); bigPut('mountain', s, j, d, side * lat, w, 40 + r2 * 60, w, r * 6, '#cfe0c0', w); } continue; }
      if (r < 0.75) {
        const k = t.key === 'alpine' ? 'snowmtn' : t.key === 'canyon' ? 'mesa' : 'mountain', lat = 260 + r2 * 500;
        const w = Math.min(t.key === 'canyon' ? 90 + r * 120 : 200 + r * 260, lat - 70);
        bigPut(k, s, j, d, side * lat, w, t.key === 'alpine' ? 160 + r2 * 260 : t.key === 'canyon' ? 50 + r2 * 70 : 70 + r2 * 120, w, r * 6, t.key === 'canyon' ? '#e7a77a' : '#ffffff', w);
      }
    }
    for (const key of farOk.keys()) { const n = +key.split(':')[1]; if (key[0] === 'n' ? n < k0 * 2 - 6 : n < j0 - 2) farOk.delete(key); }
    for (const k in inst) { const im = inst[k]; im.count = count[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // gantries over the city's road (every 420 m) and billboards in the country (every 600 m)
    let gi = 0, bi = 3;
    for (const g of signMeshes) g.visible = false;
    for (let k = Math.floor((s.z - 40) / 420); k <= Math.floor((s.z + 650) / 420); k++) { const zk = k * 420 + 200; if (themeAt(zk).key !== 'city' || gi > 2) continue; const g = signMeshes[gi++], h = at(zk - s.z, 0, v3); g.position.copy(v3); g.rotation.set(0, -h, 0); g.visible = true; }
    for (let k = Math.floor((s.z - 40) / 600); k <= Math.floor((s.z + 650) / 600); k++) { const zk = k * 600 + 330, t = themeAt(zk); if (t.key === 'city' || t.key === 'alpine' || bi > 5) continue; const side = k % 2 ? 1 : -1; if (t.sea && side < 0) continue; const g = signMeshes[bi++], lat = side * 19, h = at(zk - s.z, lat, v3); v3.y += groundY(zk, side, t, 19); g.position.copy(v3); g.rotation.set(0, -h + (side > 0 ? -0.35 : 0.35), 0); g.visible = true; }
  }
  // ---- the 2D layer over it
  const hud = document.createElement('canvas');
  hud.style.cssText = 'position:absolute;pointer-events:none;';
  document.body.appendChild(hud);
  const H = makeScreen(hud, LW, LH, { alpha: true }), F = new Floaters();
  const camPos = new THREE.Vector3(0, 3, 7), camLook = new THREE.Vector3();
  let yawS = 0, best = 0, practice = false, T = 0, banner = null, isPaused = false, shake = 0, flash = 0, flashC = '255,255,255', sideFlash = 0, sideDir = 1, skyX = 0, lastZ = 0, size = '', overT = -1, streaks = [], takedownCam = 0, lastStage = 0;
  const place = () => { const r = cv.getBoundingClientRect(); hud.style.left = `${r.left}px`; hud.style.top = `${r.top}px`; hud.style.width = `${r.width}px`; hud.style.height = `${r.height}px`; };
  const carAt = (g, d, lat, yawExtra, out) => { const h = at(d, lat, out); g.position.copy(out); g.rotation.set(0, -h + yawExtra, 0); return h; };
  const wreck = (g, side) => { wrecks.push({ g, t: 0, vx: side * (6 + Math.random() * 4), vy: 7, spin: (Math.random() - 0.5) * 9, roll: side * (4 + Math.random() * 4), y: 0 }); };
  let cur = null;   // the state drawn last (events place their effects with it)
  const warn = new Map();   // rival id -> seconds left of its warning (it is about to swing at us)
  globalThis.__turbo = {
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    // (lab checks) how close the big things placed this frame come to the road in view (m; under 0 = over it)
    roadGap: () => { let g = 1e9; for (let b = 0; b < bigs.length; b += 3) { for (let i = 0; i < N; i++) g = Math.min(g, Math.hypot(px[i] - bigs[b], pz[i] - bigs[b + 1]) - bigs[b + 2]); for (let i = 0; i < 90; i++) g = Math.min(g, Math.hypot(fX[i] - bigs[b], fZ[i] - bigs[b + 1]) - bigs[b + 2]); } return { gap: Math.round(g), n: bigs.length / 3 }; },
  };

  return {
    resize() { place(); size = ''; },
    pause(on) { isPaused = on; },
    // the engine's sound: the speed, the revs in a six-speed gearbox (they climb, drop at each shift, climb again), the
    // boost, and the tyres squealing in a hard swerve at speed, a slam or a crash
    engine(s) {
      if (s.over) return 0;
      const G = [0, 16, 29, 42, 56, 72, 101]; let g = 1; while (g < G.length - 1 && s.v > G[g]) g++;
      const rpm = s.crashT ? 0.2 : 0.22 + 0.78 * Math.max(0, Math.min(1, (s.v - G[g - 1]) / (G[g] - G[g - 1])));
      const skid = s.crashT > 60 ? 0.7 : s.shoved ? 0.9 : s.v > 30 ? Math.max(0, Math.min(1, (Math.abs(s.vx) - 14) / 4)) : 0;
      return { v: Math.min(1, s.v / 100) * (s.crashT ? 0.35 : 1), rpm, boost: s.boosting, skid };
    },
    reset(s, info) { best = info.best || 0; practice = info.practice; overT = -1; banner = null; farOk.clear(); warn.clear(); for (const [, g] of cars) scene.remove(g); cars.clear(); for (const [, g] of rivals) scene.remove(g); rivals.clear(); lastZ = s.z; lastStage = 0; },
    event(ev) {
      const s = cur;
      switch (ev.k) {
        case 'near': F.add(ev.close ? 'CLOSE CALL!' : ev.oncoming ? 'ONCOMING NEAR MISS!' : 'NEAR MISS!', LW / 2, 150, { color: ev.close ? '#fde047' : '#ffffff', s: 2, life: 1.1 }); F.add(`+${fmt(ev.pts)}   X${ev.mult}`, LW / 2, 172, { color: '#ffffff', s: 2, life: 1.1 }); sideFlash = 0.35; sideDir = ev.side; shake = Math.max(shake, ev.close ? 0.25 : 0.12); break;
        case 'oncoming': F.add(`ONCOMING +${ev.pts}`, LW / 2, 196, { color: '#fdba74', s: 1, life: 0.9 }); break;
        case 'slip': F.add(`SLIPSTREAM +${ev.pts}`, LW / 2, 196, { color: '#a5f3fc', s: 1, life: 1 }); break;
        case 'overtake': F.add(`RIVAL PASSED +${fmt(ev.pts)}`, LW / 2, 212, { color: '#fde68a', s: 1, life: 1.2 }); break;
        case 'lunge': warn.set(ev.id, 0.75); break;
        case 'slammed': F.add('SLAMMED!', LW / 2, 150, { color: '#fb7185', s: 3, life: 1.0 }); shake = Math.max(shake, 0.6); sideFlash = 0.4; sideDir = -ev.side; emit(sparks, v4.set(me.position.x - Math.cos(me.rotation.y) * ev.side * 1.0, me.position.y + 0.5, me.position.z + Math.sin(me.rotation.y) * ev.side * 1.0), 26, { v: 9, up: 3, life: 0.5, c: [1, 0.75, 0.35, 1] }); break;
        case 'takedown': {
          banner = { str: 'TAKEDOWN!', t: 0, life: 1.6, color: '#fb7185', s: 5, sub: `+${fmt(ev.pts)}  BOOST FULL` }; shake = 0.7; flash = 0.25; flashC = '255,240,200'; takedownCam = 1.2;
          const g = rivals.get(ev.id); if (g) { rivals.delete(ev.id); wreck(g, ev.side); if (s) { emit(sparks, g.position, 40, { v: 14, up: 6, life: 0.7, c: [1, 0.7, 0.3, 1] }); emit(smoke, g.position, 10, { v: 3, up: 2, life: 1.6, c: [0.75, 0.75, 0.78, 0.7], g: -0.5, spread: 1.5 }); } }
          break;
        }
        case 'rivalWreck': { const g = rivals.get(ev.id); if (g) { rivals.delete(ev.id); wreck(g, Math.random() < 0.5 ? -1 : 1); } break; }
        case 'bump': shake = Math.max(shake, 0.3); emit(sparks, me.position, 12, { v: 6, up: 3, life: 0.4, c: [1, 0.75, 0.35, 1] }); break;
        case 'boostOn': flash = 0.12; flashC = '120,200,255'; break;
        case 'boostChain': banner = { str: 'BOOST CHAIN!', t: 0, life: 1.6, color: '#7dd3fc', s: 4, sub: `+${fmt(ev.pts)}` }; break;
        case 'crash': shake = 1; flash = 0.45; flashC = '255,255,255'; banner = { str: 'CRASH!', t: 0, life: 1.4, color: '#fda4af', s: 5 }; emit(sparks, me.position, 60, { v: 16, up: 7, life: 0.8, c: [1, 0.65, 0.25, 1] }); emit(smoke, me.position, 18, { v: 4, up: 2, life: 2, c: [0.7, 0.7, 0.72, 0.75], g: -0.6, spread: 2 }); break;
        case 'scrape': emit(sparks, v4.set(me.position.x + Math.cos(me.rotation.y) * ev.side * 1.0, me.position.y + 0.3, me.position.z - Math.sin(me.rotation.y) * ev.side * 1.0), 6, { v: 5, up: 2, life: 0.35, c: [1, 0.8, 0.4, 1], vz: 6 }); break;
        case 'checkpoint': banner = { str: ev.place === 1 ? 'STAGE WON!' : 'CHECKPOINT!', t: 0, life: 2.6, color: ev.place === 1 ? '#fde047' : '#86efac', s: 3, sub: `${ORD[ev.place - 1]} PLACE  +${ev.add} SEC   NEXT: ${STAGES[ev.stage % 5]}${ev.stage >= 5 ? ' AT SUNSET' : ''}` }; flash = 0.5; flashC = '255,255,255'; break;
        case 'timeup': banner = { str: 'TIME UP', t: 0, life: 3, color: '#fda4af', s: 4 }; break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) { if (ev.k === 'near' && ev.close) return [['near', ev.mult], ['honk']]; return { near: ['near', ev.mult], oncoming: ['chain', 2], slip: ['boostOn'], overtake: ['point'], takedown: ['bigboom'], rivalWreck: ['boom'], bump: ['thump'], lunge: ['horn'], slammed: ['slam'], boostOn: ['boostOn'], boostChain: ['fanfare'], crash: ['crash'], checkpoint: ['checkpoint'], scrape: ['scrape'], go: ['go'], multEnd: ['back'], timeup: ['lost'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'crash' ? 220 : ev.k === 'slammed' ? 150 : ev.k === 'takedown' ? 120 : ev.k === 'near' ? (ev.close ? 40 : 20) : ev.k === 'bump' ? 50 : ev.k === 'scrape' ? 10 : 0; },
    draw(dt, s) {
      if (!isPaused) T += dt;
      cur = s;
      const r = cv.getBoundingClientRect(), key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (key !== size) { size = key; renderer.setSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); place(); }
      if (!s) { renderer.render(scene, camera); return; }
      const fdt = isPaused ? 0 : dt;
      line(s);
      // the stage's sky, light and fog (the sky changes at the checkpoint, behind its flash)
      const st = stageAt(s.z), t = themeAt(s.z);
      const si = st >= 5 ? 5 + (st % 5) : st;
      if (si !== skyIdx) { skyIdx = si; scene.background = skyOf(si); }
      if (st !== lastStage) lastStage = st;
      scene.fog.color.set(t.fog); hemi.color.set(t.sunset ? '#ffd6b0' : '#dcecff'); hemi.groundColor.set('#9b958a'); sun.color.set(t.sunset ? '#ffb27a' : '#fff2dc'); sun.intensity = t.sunset ? 1.8 : 2.4;
      // the road, the ground, the sea, the rails
      fillStrip(road, -(WALL + 0.3), WALL + 0.3, 0, 0, 1, 24);
      fillGround(groundL, -1, s); fillGround(groundR, 1, s);
      fillStrip(sea, -33, -2400, -1.35, -1.35, 30, 40, i => (themeAt(pzt[i]).sea ? 0 : -60));
      waterT.offset.set(T * 0.01, -T * 0.03);
      fillStrip(rails[0], -(WALL + 0.3), -(WALL + 0.3), 0.45, 0.82, 1, 6, i => (themeAt(pzt[i]).sea ? 0 : 0)); fillStrip(rails[1], WALL + 0.3, WALL + 0.3, 0.45, 0.82, 1, 6);
      scenery(s);
      // the traffic
      const seen = new Set();
      for (const tr of s.traffic) {
        const d = tr.z - s.z; if (d < -60 || d > AHEAD * STEP + 40) continue;
        seen.add(tr.id);
        let g = cars.get(tr.id);
        if (!g) { g = makeCar(tr.kind, tr.kind === 'bus' ? (tr.color % 2 ? '#facc15' : '#e5e7eb') : tr.kind === 'truck' ? ['#1d4ed8', '#b91c1c', '#e5e7eb', '#065f46'][tr.color % 4] : TRAFFIC_C[tr.color % TRAFFIC_C.length]); cars.set(tr.id, g); }
        const back = tr.v < 0, lc = tr.to !== tr.lane ? Math.sign(LANES[tr.to] - tr.x) * 0.06 : 0;
        carAt(g, d, tr.x, (back ? Math.PI : 0) - lc * (back ? -1 : 1), v3);
      }
      for (const [id, g] of cars) if (!seen.has(id)) { scene.remove(g); cars.delete(id); }
      const rseen = new Set();
      for (const rv of s.rivals) {
        rseen.add(rv.id);
        let g = rivals.get(rv.id);
        if (!g) { g = makeCar('supercar', RIVAL_C[rv.color % RIVAL_C.length]); rivals.set(rv.id, g); }
        const rh = carAt(g, rv.z - s.z, rv.x, rv.slam ? -rv.slamDir * (rv.slam >= 30 ? -0.06 : rv.slam >= 16 ? 0.16 : -0.08) : rv.to !== rv.lane ? -Math.sign(LANES[rv.to] - rv.x) * 0.1 : 0, v3);
        g.visible = rv.z - s.z < AHEAD * STEP;
        if (rv.boosting && !isPaused && Math.abs(rv.z - s.z) < 160) { const c = Math.cos(rh), sn = Math.sin(rh), fx = Math.sin(rh), fz = -Math.cos(rh); for (const ex of [-0.27, 0.27]) emit(flames, v4.set(v3.x + c * ex - fx * 2.5, v3.y + 0.27, v3.z + sn * ex - fz * 2.5), 1, { v: 0.4, up: 0.15, life: 0.12, c: Math.random() < 0.6 ? [0.2, 0.45, 1, 0.75] : [1, 0.42, 0.08, 0.7], g: 0, vz: 0, spread: 0.03 }); }
      }
      for (const [id, g] of rivals) if (!rseen.has(id)) { scene.remove(g); rivals.delete(id); }
      // wrecks tumble away
      for (let i = wrecks.length - 1; i >= 0; i--) {
        const w = wrecks[i]; w.t += fdt;
        if (w.t > 2.4) { scene.remove(w.g); wrecks.splice(i, 1); continue; }
        w.vy -= 18 * fdt; w.y = Math.max(0, w.y + w.vy * fdt); if (w.y === 0) w.vy = Math.abs(w.vy) * 0.35;
        w.g.position.x += w.vx * fdt; w.g.position.z -= (s.v * 0.5) * fdt; w.g.position.y += w.vy * fdt;
        w.g.rotation.y += w.spin * fdt; w.g.rotation.z += w.roll * fdt * (w.y > 0.2 ? 1 : 0.2);
        if (Math.random() < 0.4) emit(smoke, w.g.position, 1, { v: 1, up: 1, life: 1.2, c: [0.5, 0.5, 0.52, 0.6], g: -0.4, spread: 1 });
      }
      // our car: leaning into the steering, spinning in a crash, blinking while it comes back
      // the nose points a little way along the way it is going (a few degrees, eased), as a car changing lanes does
      const yawTo = s.crashT ? 0 : Math.max(-0.15, Math.min(0.15, -Math.atan(s.vx / Math.max(20, s.v)) * 0.75));
      if (!isPaused) yawS += (yawTo - yawS) * Math.min(1, dt * 12);
      const yawSteer = yawS, spin = s.crashT ? (100 - s.crashT) * 0.11 : 0;
      const mh = carAt(me, 0, s.x, yawSteer + spin, v3);
      me.rotation.z = s.crashT ? Math.sin((100 - s.crashT) * 0.2) * 0.15 : -s.vx * 0.0045;
      me.position.y += s.crashT ? Math.max(0, Math.sin((100 - s.crashT) * 0.08)) * 0.6 : isPaused ? 0 : (Math.random() - 0.5) * 0.02 * Math.min(1, s.v / 100);
      me.visible = !(s.ghost && Math.floor(T * 12) & 1);
      // boost flames and the exhaust's shimmer
      if (s.boosting && !isPaused) {
        const c = Math.cos(mh), sn = Math.sin(mh), fx = Math.sin(mh), fz = -Math.cos(mh);
        for (const ex of [-0.34, -0.2, 0.2, 0.34]) emit(flames, v4.set(v3.x + c * ex - fx * 2.5, v3.y + 0.27, v3.z + sn * ex - fz * 2.5), 1, { v: 0.4, up: 0.15, life: 0.12, c: Math.random() < 0.6 ? [0.2, 0.45, 1, 0.75] : [1, 0.42, 0.08, 0.7], g: 0, vz: 0, spread: 0.03 });
      }
      if (s.crashT && Math.random() < 0.5) emit(smoke, me.position, 1, { v: 2, up: 1.5, life: 1.5, c: [0.6, 0.6, 0.62, 0.6], g: -0.5, spread: 1.2 });
      stepParticles(sparks, fdt); stepParticles(smoke, fdt); stepParticles(flames, fdt);
      // the sky turns with the road
      skyX += (s.z - lastZ) * sim.curveAt(s, s.z) * 0.16; lastZ = s.z;
      if (scene.background) scene.background.offset.x = skyX % 1;
      // the camera: chasing low behind, wider with speed; in a crash it circles the wreck; a takedown swings toward it
      if (!isPaused) { shake = Math.max(0, shake - dt * 1.4); takedownCam = Math.max(0, takedownCam - dt); }
      if (s.crashT) {
        const a = (100 - s.crashT) * 0.035 + 0.6;
        v4.set(me.position.x + Math.sin(a) * 9, me.position.y + 3.6, me.position.z + Math.cos(a) * 9);
        camPos.lerp(v4, 0.12); camLook.copy(me.position);
      } else {
        at(-6.2 - Math.min(2.4, s.v / 42) - (s.boosting ? 0.8 : 0), s.x * 0.9, v4); v4.y += 2.05;
        camPos.lerp(v4, isPaused ? 0 : 0.22);
        at(16, s.x * 0.75, camLook); camLook.y += 1.05;
      }
      const buzz = isPaused || s.crashT ? 0 : Math.max(0, s.v - 45) / 55 * 0.03 + (s.boosting ? 0.035 : 0);
      camera.position.copy(camPos).add(v4.set((Math.random() - 0.5) * (shake * 0.5 + buzz), (Math.random() - 0.5) * (shake * 0.35 + buzz), 0));
      camera.lookAt(camLook);
      const fov = 62 + Math.min(1, s.v / 100) * 16 + (s.boosting ? 10 : 0);
      camera.fov += (fov - camera.fov) * 0.12; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      // ---------------------------------------------------------- the 2D layer
      H.fit(); H.begin(); const x = H.ctx; x.clearRect(0, 0, LW, LH);
      // speed lines, stronger in a boost; a blue edge while boosting
      const sp = Math.min(1, s.v / 100);
      if (!isPaused && (sp > 0.6 || s.boosting)) for (let k = 0; k < (s.boosting ? 4 : 1); k++) streaks.push({ a: Math.random() * Math.PI * 2, r: 70 + Math.random() * 50, v: 420 + Math.random() * 300, t: 0 });
      x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 1.3;
      streaks = streaks.filter(q2 => { q2.t += fdt; q2.r += q2.v * fdt; if (q2.r > 380) return false; const cx = LW / 2, cy = LH * 0.42; x.globalAlpha = Math.min(0.55, q2.t * 3); x.beginPath(); x.moveTo(cx + Math.cos(q2.a) * q2.r, cy + Math.sin(q2.a) * q2.r * 1.2); x.lineTo(cx + Math.cos(q2.a) * (q2.r + 34), cy + Math.sin(q2.a) * (q2.r + 34) * 1.2); x.stroke(); return true; });
      x.globalAlpha = 1;
      if (s.boosting) { const g = x.createRadialGradient(LW / 2, LH * 0.45, LH * 0.3, LW / 2, LH * 0.45, LH * 0.75); g.addColorStop(0, 'rgba(56,189,248,0)'); g.addColorStop(1, 'rgba(56,189,248,0.38)'); x.fillStyle = g; x.fillRect(0, 0, LW, LH); }
      if (sideFlash > 0) { const g = x.createLinearGradient(sideDir < 0 ? 0 : LW, 0, sideDir < 0 ? 90 : LW - 90, 0); g.addColorStop(0, `rgba(255,255,255,${sideFlash * 1.6})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, LW, LH); sideFlash -= fdt; }
      // rival markers (nearest first; a label that would sit on another's goes above it, or is left out)
      const tags = [];
      for (const rv of s.startT ? [] : [...s.rivals].sort((p2, q2) => p2.z - q2.z)) {
        const d = rv.z - s.z; if (d < 4 || d > 380) continue;
        at(d, rv.x, v4); v4.y += 2.2; v4.project(camera);
        if (v4.z > 1) continue;
        const sx = (v4.x + 1) / 2 * LW, sy = (1 - v4.y) / 2 * LH;
        x.fillStyle = RIVAL_C[rv.color % 3]; x.beginPath(); x.moveTo(sx, sy + 6); x.lineTo(sx - 5, sy - 2); x.lineTo(sx + 5, sy - 2); x.fill();
        let ty = sy - 12; for (let k = 0; k < 3 && tags.some(([tx, ty2]) => Math.abs(tx - sx) < 56 && Math.abs(ty2 - ty) < 11); k++) ty -= 11;
        if (tags.some(([tx, ty2]) => Math.abs(tx - sx) < 62 && Math.abs(ty2 - ty) < 11)) continue;
        tags.push([sx, ty]); text(x, tags.length === 1 ? `RIVAL ${Math.round(d)}M` : `${Math.round(d)}M`, sx, ty, 1, { color: '#ffffff', glow: '#000000', align: 'center' });
      }
      const panel = (px2, py2, w, h2) => { x.fillStyle = 'rgba(8,12,24,0.55)'; rrect(x, px2, py2, w, h2, 6); x.fill(); };
      // the clock
      const secs = Math.max(0, Math.ceil(s.time / 60)), low = secs <= 10 && !s.startT;
      panel(LW / 2 - 40, 4, 80, 46);
      text(x, 'TIME', LW / 2, 9, 1, { color: '#cbd5e1', glow: false, align: 'center' });
      if (!low || blink(T, 0.5, 0.7)) text(x, String(secs), LW / 2, 20, 4, { color: low ? '#fb7185' : '#ffffff', glow: low ? '#e11d48' : '#0ea5e9', align: 'center' });
      // the score and the multiplier
      panel(4, 4, 104, 46);
      text(x, 'SCORE', 10, 9, 1, { color: '#cbd5e1', glow: false });
      text(x, fmt(s.score), 10, 20, 2, { color: '#ffffff', glow: '#0ea5e9' });
      const mult = multOf(s);
      if (mult > 1) { x.fillStyle = '#f59e0b'; rrect(x, 70, 33, 34, 14, 5); x.fill(); text(x, `X${mult}`, 87, 36, 1, { color: '#111827', glow: false, align: 'center' }); x.fillStyle = 'rgba(253,230,138,0.9)'; x.fillRect(10, 42, 56 * (s.chainT / 200), 3); }
      // the stage and the way to its checkpoint
      panel(LW - 108, 4, 104, 46);
      text(x, `STAGE ${st + 1}`, LW - 10, 9, 1, { color: '#cbd5e1', glow: false, align: 'right' });
      text(x, STAGES[st % 5].split(' ')[0], LW - 10, 21, 1, { color: '#fde68a', glow: false, align: 'right' });
      const prog = 1 - (s.nextCp - s.z) / STAGE_LEN;
      x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(LW - 102, 38, 92, 5); x.fillStyle = '#86efac'; x.fillRect(LW - 102, 38, 92 * Math.max(0, Math.min(1, prog)), 5);
      text(x, `${((s.nextCp - s.z) / 1000).toFixed(1)}KM`, LW - 10, 29, 1, { color: '#e2e8f0', glow: false, align: 'right' });
      if (!s.startT) {
        const pl = placeOf(s), of = 1 + s.rivals.filter(r => r.st === s.stage).length;
        panel(LW - 64, 54, 60, 26);
        text(x, 'POS', LW - 58, 59, 1, { color: '#cbd5e1', glow: false });
        text(x, `${pl}/${Math.max(pl, of)}`, LW - 10, 58, 2, { color: pl === 1 ? '#fde047' : '#ffffff', glow: pl === 1 ? '#f59e0b' : false, align: 'right' });
      }
      if (s.takedowns) text(x, `TAKEDOWNS ${s.takedowns}`, LW - 10, 86, 1, { color: '#fb7185', glow: '#000000', align: 'right' });
      for (const [id, tl] of warn) {
        const rv = s.rivals.find(r => r.id === id); if (!rv || tl <= 0) { warn.delete(id); continue; }
        warn.set(id, tl - fdt);
        at(rv.z - s.z, rv.x, v4); v4.y += 1.9; v4.project(camera); if (v4.z > 1) continue;
        const wx = Math.max(14, Math.min(LW - 14, (v4.x + 1) / 2 * LW)), wy = Math.max(70, (1 - v4.y) / 2 * LH);
        x.globalAlpha = blink(T, 0.16) ? 1 : 0.55; x.fillStyle = '#ef4444'; x.beginPath(); x.moveTo(wx, wy - 22); x.lineTo(wx - 15, wy + 5); x.lineTo(wx + 15, wy + 5); x.fill(); text(x, '!', wx, wy - 14, 2, { color: '#ffffff', glow: false, align: 'center' }); x.globalAlpha = 1;
      }
      // the speedometer
      const kmh = Math.round(s.v * 3.6), gx = 50, gy = LH - 44, gr = 38, a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;   // (to 360 km/h)
      x.fillStyle = 'rgba(8,12,24,0.6)'; x.beginPath(); x.arc(gx, gy, gr + 6, 0, 7); x.fill();
      x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.2)'; x.beginPath(); x.arc(gx, gy, gr, a0, a1); x.stroke();
      const u = Math.min(1, kmh / 360); x.strokeStyle = s.boosting ? '#38bdf8' : u > 0.75 ? '#f97316' : '#22c55e'; x.beginPath(); x.arc(gx, gy, gr, a0, a0 + (a1 - a0) * u); x.stroke();
      x.strokeStyle = '#ffffff'; x.lineWidth = 1; for (let k = 0; k <= 7; k++) { const a = a0 + (a1 - a0) * k / 7; x.beginPath(); x.moveTo(gx + Math.cos(a) * (gr - 7), gy + Math.sin(a) * (gr - 7)); x.lineTo(gx + Math.cos(a) * (gr - 3), gy + Math.sin(a) * (gr - 3)); x.stroke(); }
      const na = a0 + (a1 - a0) * u; x.strokeStyle = '#ef4444'; x.lineWidth = 2; x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + Math.cos(na) * (gr - 6), gy + Math.sin(na) * (gr - 6)); x.stroke();
      text(x, String(kmh), gx, gy + 8, 2, { color: '#ffffff', glow: false, align: 'center' }); text(x, 'KM/H', gx, gy + 24, 1, { color: '#94a3b8', glow: false, align: 'center' });
      // the boost gauge
      const bx = LW - 132, by = LH - 30, bw = 122;
      panel(bx - 6, by - 20, bw + 12, 36);
      text(x, s.boosting ? 'BOOST!' : s.boost >= 100 ? 'BOOST READY' : 'BOOST', bx, by - 14, 1, { color: s.boosting ? '#7dd3fc' : s.boost >= 100 && blink(T, 0.4) ? '#fde047' : '#e2e8f0', glow: false });
      for (let k = 0; k < 10; k++) { const fill = Math.max(0, Math.min(1, (s.boost - k * 10) / 10)); x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(bx + k * 12.2, by, 10.5, 9); if (fill > 0) { x.fillStyle = s.boosting ? '#38bdf8' : k > 6 ? '#f97316' : '#fbbf24'; x.fillRect(bx + k * 12.2, by + 9 * (1 - fill), 10.5, 9 * fill); } }
      // countdown
      if (s.startT) {
        const n = Math.ceil(s.startT / 60);
        for (let k = 0; k < 3; k++) { const on = 3 - k >= n; x.fillStyle = 'rgba(8,12,24,0.7)'; x.beginPath(); x.arc(LW / 2 - 36 + k * 36, LH * 0.3, 15, 0, 7); x.fill(); x.fillStyle = on ? '#ef4444' : '#3f3f46'; x.beginPath(); x.arc(LW / 2 - 36 + k * 36, LH * 0.3, 11, 0, 7); x.fill(); }
        text(x, String(n), LW / 2, LH * 0.36, 10, { color: '#ffffff', glow: '#ef4444', align: 'center' });
      } else if (s.t < 240 && s.t > 180) { for (let k = 0; k < 3; k++) { x.fillStyle = '#22c55e'; x.beginPath(); x.arc(LW / 2 - 36 + k * 36, LH * 0.3, 11, 0, 7); x.fill(); } text(x, 'GO!', LW / 2, LH * 0.36, 9, { color: '#bbf7d0', glow: '#16a34a', align: 'center' }); }
      F.draw(x, fdt);
      if (banner) {
        banner.t += fdt;
        if (banner.t > banner.life) banner = null;
        else { const pop = banner.t < 0.15 ? 0.7 + banner.t * 2 : 1; text(x, banner.str, LW / 2, LH * 0.15, Math.max(2, Math.round(banner.s * pop)), { color: banner.color, glow: '#000000', align: 'center' }); if (banner.sub) text(x, banner.sub, LW / 2, LH * 0.15 + banner.s * 8 + 6, 1, { color: '#ffffff', glow: '#000000', align: 'center' }); }
      }
      if (flash > 0) { x.fillStyle = `rgba(${flashC},${Math.min(0.6, flash)})`; x.fillRect(0, 0, LW, LH); flash -= fdt; }
      if (practice) text(x, 'PRACTICE', LW / 2, 56, 1, { color: '#e2e8f0', glow: '#000000', align: 'center' });
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.4) {
          x.fillStyle = 'rgba(8,12,24,0.78)'; rrect(x, 24, 128, LW - 48, 210, 12); x.fill();
          text(x, 'GAME OVER', LW / 2, 142, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' });
          text(x, fmt(s.score), LW / 2, 184, 3, { color: '#ffffff', glow: '#0ea5e9', align: 'center' });
          const rows = [[`STAGE ${st + 1}`, `${(s.z / 1000).toFixed(2)} KM`], ['NEAR MISSES', String(s.near)], ['CLOSE CALLS', String(s.close)], ['TAKEDOWNS', String(s.takedowns)], ['RIVALS PASSED', String(s.overtakes)], ['STAGES WON', String(s.wins || 0)], ['BEST MULTIPLIER', `X${s.bestMult}`]];
          rows.forEach(([a, b], i) => { text(x, a, 48, 218 + i * 14, 1, { color: '#cbd5e1', glow: false }); text(x, b, LW - 48, 218 + i * 14, 1, { color: '#fde68a', glow: false, align: 'right' }); });
          if (best && s.score > best) text(x, 'NEW BEST!', LW / 2, 322, 2, { color: '#fde047', glow: '#f59e0b', align: 'center' });
        }
      }
      if (isPaused) { x.fillStyle = 'rgba(8,12,24,0.6)'; x.fillRect(0, 0, LW, LH); text(x, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(x, H);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen (2D)
export function cover(ctx, w, h, t, info = {}) {
  const hz = h * 0.46, s = w / 240;
  const g = ctx.createLinearGradient(0, 0, 0, hz); g.addColorStop(0, '#1d6fe0'); g.addColorStop(1, '#bfe1ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, hz);
  for (let k = 0; k < 5; k++) { const cx = ((k * 70 + t * 6) % (w + 80)) - 40, cy = 30 + k * 13; ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let p = 0; p < 4; p++) { ctx.beginPath(); ctx.arc(cx + p * 9 * s, cy - (p % 2) * 4, 8 * s, 0, 7); ctx.fill(); } }
  ctx.fillStyle = '#4e8d3c'; ctx.beginPath(); ctx.moveTo(0, hz); for (let px2 = 0; px2 <= w; px2 += 10) ctx.lineTo(px2, hz - 10 * s - Math.sin(px2 / 30) * 6 * s); ctx.lineTo(w, hz); ctx.fill();
  ctx.fillStyle = '#6faa4f'; ctx.fillRect(0, hz, w, h - hz);
  ctx.fillStyle = '#4a4c53'; ctx.beginPath(); ctx.moveTo(w / 2 - 8 * s, hz); ctx.lineTo(w / 2 + 8 * s, hz); ctx.lineTo(w / 2 + 120 * s, h); ctx.lineTo(w / 2 - 120 * s, h); ctx.fill();
  ctx.fillStyle = '#f4c430'; for (let k = 0; k < 7; k++) { const u = ((k + (t * 2.5) % 1) / 7) ** 2, y = hz + u * (h - hz), ww = 1 + u * 3 * s; ctx.fillRect(w / 2 - ww / 2, y, ww, 2 + u * 10 * s); }
  // the red supercar from behind
  const cy = h * 0.8 + Math.sin(t * 11) * 0.8, cx = w / 2 + Math.sin(t * 0.9) * 26 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(cx, cy + 9 * s, 34 * s, 6 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#b80018'; rrect(ctx, cx - 32 * s, cy - 14 * s, 64 * s, 20 * s, 7 * s); ctx.fill();
  ctx.fillStyle = '#d0021b'; rrect(ctx, cx - 22 * s, cy - 24 * s, 44 * s, 13 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#18202c'; rrect(ctx, cx - 17 * s, cy - 22 * s, 34 * s, 8 * s, 3 * s); ctx.fill();
  ctx.fillStyle = '#ff2424'; for (const dx of [-24, -16, 16, 24]) { ctx.beginPath(); ctx.arc(cx + dx * s, cy - 6 * s, 3 * s, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#1c1d21'; ctx.fillRect(cx - 18 * s, cy - 1 * s, 36 * s, 6 * s);
  text(ctx, 'TURBO', w / 2, h * 0.05, Math.round(4 * s), { color: '#ffffff', glow: '#e11d48', align: 'center' });
  text(ctx, 'RUSH', w / 2, h * 0.05 + 36 * s, Math.round(4 * s), { color: '#fde047', glow: '#ea580c', align: 'center' });
  const top = info.top || [];
  ctx.fillStyle = 'rgba(8,12,24,0.55)'; ctx.fillRect(0, h * 0.5, w, h * 0.18);
  text(ctx, 'HI-SCORES', w / 2, h * 0.515, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.515 + (12 + i * 10) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#e2e8f0', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.95, Math.max(1, Math.round(1.5 * s)), { color: '#bbf7d0', glow: '#16a34a', align: 'center' });
}
