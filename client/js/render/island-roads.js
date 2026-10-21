// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Roads drawn from the road kit (shared/road-kit.js; the design review 2026-10-03): every road type band by band — travel
// lanes with their markings (double or dashed yellow centre, dashed white lane lines, solid edge lines), parking lanes
// with stall marks, paved or gravel shoulders, gutters, curbs standing CURB_RISE proud and sidewalks of square tiles —
// at the road's own graded profile (shared/island-roads.js), so the drawn road, the ground, the physics and the
// simulation agree. Junctions follow their plans: a paved area inside curb returns sized for buses, the gutter, curb
// and sidewalk wrapping every corner and blending from one road to the next, zebra crosswalks and stop bars. Dead ends
// simply stop (no turning circle since 2026-10-13; traffic turns round in the roadway). Over deep water a road is a bridge:
// edge beams, railings and piers to the sea floor. Shaded like the city's streets (asphalt grain and patches, worn
// paint, tiled sidewalks, the street lights' glow at night). Four draw calls: surfaces, markings, bridges (+ signals in
// render/road-signals.js).
import * as THREE from 'three';
import { wettable } from './scene.js';
import { commonUniforms, WP_VERT, FRAG_PARS } from './mats.js';
import { pointAt } from '/shared/roads.js';
import { profileAt, DRAW_LIFT } from '/shared/island-roads.js';
import { sectionOf, CURB_RISE } from '/shared/road-kit.js';
import { RoadSignals } from './road-signals.js';
import { FB, treeRound, treeColumn } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { GU } from './scene.js';

const STEP = 2.4384, LIFT = DRAW_LIFT, DROP = 0.45;
/** How far the drawn road stands above the graded ground vehicles (and the physics) run on beyond the city: its lift
 *  plus the formation (shared/island-roads.js) — vehicles are drawn that much higher, wheels on the drawn surface. */
export const ROAD_TOP = LIFT + 0.04;
// surface kinds (the shader's materials)
export const K = { lane: 0, parking: 1, gravel: 2, gutter: 3, curb: 4, walk: 5, pad: 6, walkW: 7, white: 10, yellow: 11 };
const COL = { concrete: new THREE.Color('#a7a49c'), rail: new THREE.Color('#5d6670') };

export class IslandRoadsLayer {
  /** @param {import('/shared/island-roads.js').IslandRoads} roads; seabed(x, z): the ground under water (bridge piers). */
  /** lift: how far the drawn surfaces stand above the road's profile (0 for the city's streets, which are level). */
  /** extraCuts: road id → stretches drawn by someone else (a city junction's arm); only(id): the roads to draw ribbons for. */
  constructor(roads, { cityRect = null, seabed = null, lift = LIFT, extraCuts = null, only = null, ground = null } = {}) {
    this.roads = roads; this.city = cityRect; this.lift = lift;
    this.group = new THREE.Group(); this.group.name = 'island-roads';
    const surf = new Builder(), marks = new Builder(), bridge = new Builder();
    const plans = [...(roads.plans?.values() || [])], padY = new Map((roads.pads || []).map(P => [P.key, P.y]));
    // where each road meets a junction, its ribbon stops at the junction's mouth
    const cut = new Map(), push = (id, a, b) => (cut.get(id) || cut.set(id, []).get(id)).push([Math.min(a, b), Math.max(a, b)]);
    for (const J of plans) for (const A of J.arms) push(A.id, A.s, A.s + A.along * A.mouth);
    if (extraCuts) for (const [id, list] of extraCuts) for (const [a, b] of list) push(id, a, b);
    const ends = (roads.pads || []).filter(P => P.kind === 'end');
    for (const E of ends) { const sg = Math.sign(E.end - E.s) || 1; push(E.road, E.s + sg * Math.sqrt(Math.max(0, E.r * E.r - E.half * E.half)), E.end); }
    const quiet = new Map(); for (const E of ends) (quiet.get(E.road) || quiet.set(E.road, []).get(E.road)).push([E.s - E.r - 0.5, E.s + E.r + 0.5]);
    for (const r of roads.net.all()) if (!only || only(r.id)) this.road(r, surf, marks, bridge, seabed, cut.get(r.id) || [], quiet.get(r.id) || []);
    for (const J of plans) this.junction(J, (padY.get(J.key) ?? 0) + lift, surf, marks);
    for (const E of ends) this.turningCircle(E, roads.profiles[roads.net.get(E.road).profile], E.y + lift, surf);
    const mat = roadMaterial(-1, -2), markMat = roadMaterial(-2, -4, true);
    this.surface = new THREE.Mesh(surf.build(), mat); this.surface.receiveShadow = true; this.surface.renderOrder = 1;
    this.markings = new THREE.Mesh(marks.build(), markMat); this.markings.renderOrder = 2;
    this.group.add(this.surface, this.markings);
    this.signals = new RoadSignals(plans, padY, id => roads.net.get(id)?.name || '');   // with the streets' name signs
    this.group.add(this.signals.group);
    // street furniture along the roads beyond the city (the city's streets have their own)
    if (!only) this.furniture(roads, cut, ground);
    if (bridge.pos.length) {
      this.bridges = new THREE.Mesh(bridge.build(true), wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }), { darken: 0.25, gloss: 0.3 }));
      this.bridges.castShadow = true; this.bridges.receiveShadow = true;
      this.group.add(this.bridges);
    }
  }
  inCity(x, z) { const c = this.city; return !!c && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1; }
  /** The island lamps' light at night (2026-10-14, the product owner: their pools faded under the sidewalk close up, and lit
   *  less than the city's): the city's own way — a light map every lit surface reads (render/mats.js lampLight: road,
   *  sidewalk, lots, walls) — GU.uLightMap2: one channel over the lamps' area, ≤ 4096 texels a side (1.5 m a texel
   *  while it fits), each lamp the city's pool (render/city.js bakeLightMap: 11 m, 0.8 at its head). */
  bakeLamps(heads) {
    if (GU.uLightMap2.value) { GU.uLightMap2.value.dispose(); GU.uLightMap2.value = null; GU.uLightRect2.value.set(-1e7, -1e7, 1, 1); }
    if (!heads.length) return;
    const R = 11, pad = R + 2;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const h of heads) { x0 = Math.min(x0, h.x); z0 = Math.min(z0, h.z); x1 = Math.max(x1, h.x); z1 = Math.max(z1, h.z); }
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
    const s = Math.min(1 / 1.5, 4096 / Math.max(x1 - x0, z1 - z0)), W = Math.max(1, Math.ceil((x1 - x0) * s)), H = Math.max(1, Math.ceil((z1 - z0) * s));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighter';
    for (const h of heads) {
      const px = (h.x - x0) * s, pz = (h.z - z0) * s, rr = R * s, gr = c.createRadialGradient(px, pz, 0, px, pz, rr);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.36)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(px - rr, pz - rr, 2 * rr, 2 * rr);
    }
    const rgba = c.getImageData(0, 0, W, H).data, red = new Uint8Array(W * H);
    for (let k = 0; k < red.length; k++) red[k] = rgba[k * 4];
    const tex = new THREE.DataTexture(red, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.unpackAlignment = 1; tex.needsUpdate = true;
    GU.uLightMap2.value = tex; GU.uLightRect2.value.set(x0, z0, W / s, H / s);
  }
  dispose() { this.signals?.dispose(); for (const m of [this.surface, this.markings, this.bridges, ...(this.extras || [])]) if (m) { m.geometry.dispose(); m.material.dispose?.(); } }
  /**
   * Street furniture (the design review 2026-10-03: the drawn roads should look and work like the city's): roads with
   * sidewalks get the city's street lamps every 30 m on alternate sides, their light pooling on the road at night, and
   * street trees between them; country roads get wooden utility poles with sagging wires along one side and white
   * reflector posts along both edges. Kept clear of junctions, bridges and the city. A few instanced draw calls.
   */
  furniture(roads, cuts, ground) {
    const lamps = [], trees = [], poles = [], posts = [], wires = [], h = (a, b) => { let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d); return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };
    for (const r of roads.net.all()) {
      const G = roads.net.geometry(r.id), prof = roads.prof.get(r.id), sec = sectionOf(roads.profiles[r.profile]), cl = cuts.get(r.id) || [];
      const free = s => s > 6 && s < G.length - 6 && !cl.some(([a, b]) => s > a - 8 && s < b + 8) && !roads.onBridge?.(r.id, s);
      const at = (s, o, lift) => { const p = pointAt(G, s, {}), nx = -p.dz, nz = p.dx, x = p.x + nx * o, z = p.z + nz * o; return { x, z, y: lift === null ? (ground ? ground(x, z) : profileAt(prof, s)) : profileAt(prof, s) + this.lift + lift, nx, nz, dx: p.dx, dz: p.dz }; };
      const rid = [...r.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) | 0;
      if (sec.sidewalk) {
        for (let s = 12; s < G.length; s += 30) for (const side of [1, -1]) {
          const sl = s + (side < 0 ? 15 : 0); if (!free(sl)) continue;
          const q = at(sl, side * (sec.sidewalk.o1 - 0.45), CURB_RISE); if (this.inCity(q.x, q.z)) continue;
          lamps.push({ ...q, yaw: Math.atan2(-side * q.nx, -side * q.nz) });
          // the tree halfway to this side's next lamp (2026-10-13: on one side it stood on the lamp itself — that side's
          // stations were worked out as the lamp's own, so the two grew through each other)
          const st = sl + 15; if (!free(st)) continue;
          const t = at(st, side * (sec.sidewalk.o1 - 1.0), CURB_RISE); if (!this.inCity(t.x, t.z)) trees.push({ ...t, k: h(rid, Math.round(st)) });
        }
      } else {
        // poles on the side the road's own hash picks, 45 m apart, wires between neighbours
        const side = h(rid, 1) < 0.5 ? 1 : -1, o = side * (sec.outer + 2.6);
        let prev = null;
        for (let s = 20; s < G.length - 10; s += 45) {
          if (!free(s)) { prev = null; continue; }
          const q = at(s, o, null); if (this.inCity(q.x, q.z)) { prev = null; continue; }
          const yaw = Math.atan2(q.dx, q.dz), pole = { ...q, yaw }; poles.push(pole);
          if (prev && s - prev.s < 50) {
            // three wires: the crossarm's ends and its middle, sagging between the poles
            for (const off of [-0.95, 0, 0.95]) {
              const a = { x: prev.x + prev.nx * off, y: prev.y + 7.55 + (off ? 0 : 0.5), z: prev.z + prev.nz * off }, b = { x: q.x + q.nx * off, y: q.y + 7.55 + (off ? 0 : 0.5), z: q.z + q.nz * off };
              for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8, sag = t => 4 * t * (1 - t) * 0.55; wires.push(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 - sag(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 - sag(t1), a.z + (b.z - a.z) * t1); }
            }
          }
          prev = { ...q, s };
        }
        for (let s = 25; s < G.length - 10; s += 50) for (const sd of [1, -1]) { if (!free(s)) continue; const q = at(s, sd * (sec.outer - 0.25), null); if (!this.inCity(q.x, q.z)) posts.push({ ...q, yaw: Math.atan2(q.dx, q.dz) + (sd > 0 ? 0 : Math.PI) }); }
      }
    }
    this.extras = []; this.props = { lamps, trees, poles };   // (where they stand: checks read them)
    const mat = makeFurnMat({ lit: true }), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    const inst = (geo, list, scale = () => 1, tint = null) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((q, i) => { im.setMatrixAt(i, m4.compose(pv.set(q.x, q.y, q.z), qq.setFromAxisAngle(up, q.yaw || 0), one.clone().multiplyScalar(scale(q)))); im.setColorAt(i, tint ? tint(q) : new THREE.Color(1, 1, 1)); });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); this.extras.push(im);
      return im;
    };
    if (lamps.length) {
      // the city's street lamp (render/city.js), its arm reaching out over the road
      const f = new FB();
      f.col('#3a3e44'); f.cyl(0, 0, 0.13, 0, 0.35, 8, 0.1); f.cyl(0, 0, 0.075, 0.35, 6.7, 8, 0.055);
      f.rod([0, 6.4, 0], [0, 6.75, 0.9], 0.045, 6); f.rod([0, 6.75, 0.9], [0, 6.72, 1.75], 0.04, 6);
      f.col('#2c3036'); f.box(-0.2, 6.6, 1.4, 0.2, 6.76, 2.05);
      f.col('#ffe2a6', 0, 2); f.box(-0.16, 6.58, 1.45, 0.16, 6.6, 2.0);
      inst(f.build().geo, lamps);
    }
    this.bakeLamps(lamps.map(q => { const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw); return { x: q.x + fx * 1.75, z: q.z + fz * 1.75 }; }));   // (none: the map cleared)
    if (trees.length) {
      // street trees in their pits, as in the city: round-headed and columnar, their leaves each a shade of their own
      for (const [k, build] of [[0, f => treeRound(f, 6.8, 1, 3)], [1, f => treeColumn(f, 8, 0.95, 5)]]) {
        const f = new FB(); f.col('#33363a'); f.box(-0.62, 0, -0.62, 0.62, 0.014, 0.62); f.col('#4a3a2a'); f.box(-0.48, 0, -0.48, 0.48, 0.02, 0.48); build(f);
        const list = trees.filter(t => (t.k < 0.7 ? 0 : 1) === k).map(t => ({ ...t, yaw: t.k * 40 }));
        inst(f.build().geo, list, t => 0.85 + t.k * 0.3, t => new THREE.Color(['#4f8a3c', '#3f7a35', '#5a9142', '#477f3a'][Math.floor(t.k * 4) % 4]).multiplyScalar(0.88 + t.k * 0.24));
      }
    }
    if (poles.length) {
      // a wooden utility pole: a crossarm across the road (2026-10-04: "the cross poles missing up on top" — it ran
      // along the road, end-on to the wires; now square across, the wires' ends on its insulators), two angled braces
      // under it, porcelain insulators on top, one on the pole's top for the middle wire, a transformer on the field side
      const f = new FB();
      f.col('#5b4633'); f.cyl(0, 0, 0.14, -0.5, 8.0, 8, 0.11);
      f.col('#4e3c2b'); f.box(-1.15, 7.32, -0.08, 1.15, 7.5, 0.08);
      for (const sx of [-1, 1]) f.rod([0, 6.75, 0.09], [sx * 0.75, 7.33, 0.09], 0.028, 4);
      f.col('#d9dde2'); for (const x of [-0.95, 0.95]) { f.cyl(x, 0, 0.055, 7.5, 7.58, 8); f.cyl(x, 0, 0.042, 7.58, 7.66, 8); } f.cyl(0, 0, 0.055, 8.0, 8.08, 8); f.cyl(0, 0, 0.042, 8.08, 8.16, 8);
      f.col('#7c8288'); f.cyl(0, 0.32, 0.22, 5.6, 6.5, 10); f.col('#5e646a'); f.box(-0.06, 6.0, 0.1, 0.06, 6.12, 0.18);
      // (the arm is the model's x; the instance turns it to the road's normal: yaw = the road's heading)
      inst(f.build().geo, poles.map(p => ({ ...p, yaw: p.yaw })));
    }
    if (posts.length) {
      const f = new FB(); f.col('#f1f1ee'); f.box(-0.06, 0, -0.04, 0.06, 1.05, 0.04); f.col('#e8a33d', 0, 2); f.box(-0.04, 0.82, 0.041, 0.04, 0.95, 0.05); f.col('#20242a'); f.box(-0.061, 0.62, -0.041, 0.061, 0.7, 0.041);
      inst(f.build().geo, posts);
    }
    if (wires.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x23272c, transparent: true, opacity: 0.85 }));
      this.group.add(ls); this.extras.push(ls);
    }
  }
  /** One road's ribbons and markings between its junction mouths. */
  road(r, surf, marks, bridge, seabed, cuts, quiet) {
    const roads = this.roads, G = roads.net.geometry(r.id), prof = roads.prof.get(r.id), P = roads.profiles[r.profile], sec = sectionOf(P);
    const n = Math.max(2, Math.ceil(G.length / STEP) + 1), d = G.length / (n - 1), stations = [];
    for (let i = 0; i < n; i++) stations.push(i * d);
    for (const [a, b] of cuts) stations.push(Math.max(0, Math.min(G.length, a)), Math.max(0, Math.min(G.length, b)));
    stations.sort((a, b) => a - b);
    const inside = (s, list) => list.some(([a, b]) => s > a + 1e-4 && s < b - 1e-4);
    for (const [a, b] of roads.spans?.get(r.id) || []) stations.push(a, b);
    stations.sort((a, b) => a - b);
    let prev = null, wasBridge = false;
    for (const s of stations) {
      if (prev && s - prev.s < 1e-3) continue;
      const p = pointAt(G, s, {}), cur = { s, x: p.x, z: p.z, y: profileAt(prof, s) + this.lift, nx: -p.dz, nz: p.dx };
      if (this.inCity(p.x, p.z)) { prev = null; continue; }
      if (prev && !inside((prev.s + s) / 2, cuts)) {
        this.section(prev, cur, sec, surf);
        const mid = (prev.s + s) / 2, onBridge = roads.onBridge(r.id, mid);
        if (onBridge !== wasBridge && seabed) {   // an abutment where the bridge meets the bank
          const at = onBridge ? prev : cur, g = seabed(at.x, at.z);
          if (at.y - g > 0.6) bridge.pier(at, sec.outer + 0.3, 0.9, at.y - 0.05, g - 1.5, COL.concrete);
        }
        wasBridge = onBridge;
        if (onBridge) this.bridgePiece(prev, cur, sec, bridge, seabed);
        if (!inside(mid, quiet)) this.markings(prev, cur, sec, marks);
      }
      prev = cur;
    }
    // a dead end's square end: its edge faces closed, down into the ground like the sides
    for (const j of roads.net.junctions()) {
      if (j.kind !== 'end' || j.arms[0].id !== r.id) continue;
      const s = j.arms[0].s, p = pointAt(G, s, {}); if (this.inCity(p.x, p.z) || roads.onBridge?.(r.id, s) || roads.isGate?.(r.id, s)) continue;   // (a module's gate: open on to its paving)
      const y = profileAt(prof, s) + this.lift, c = sec.carriage, o = sec.outer, rise = CURB_RISE;
      const offs = sec.raised ? [-o, -c, -c, c, c, o] : [-o, o], tops = sec.raised ? [rise, rise, 0, 0, rise, rise] : [0, 0];
      const pts = offs.map(k => ({ x: p.x - p.dz * k, z: p.z + p.dx * k })), top = tops.map(t => y + t);
      for (const side of [1, -1]) surf.curtain(pts, top, y - DROP, K.curb, side);
    }
  }
  /** The cross-section from station a to station b. */
  section(a, b, sec, B) {
    const e = sec.laneEdge, rise = CURB_RISE;
    B.strip(a, b, -e, e, K.lane);
    for (const sd of [1, -1]) {
      const band = (o0, o1, kind, dy = 0) => B.strip(a, b, sd > 0 ? o0 : -o1, sd > 0 ? o1 : -o0, kind, dy);
      if (sec.shoulder) band(sec.shoulder.o0, sec.shoulder.o1, sec.shoulder.kind === 'gravel' ? K.gravel : K.parking);
      if (sec.gutter) band(sec.gutter.o0, sec.gutter.o1, K.gutter);
      if (sec.curb) { B.wall(a, b, sd * sec.curb.o0, rise, 0, K.curb, -sd); band(sec.curb.o0, sec.curb.o1, K.curb, rise); }
      if (sec.sidewalk) { band(sec.sidewalk.o0, sec.sidewalk.o1, K.walk, rise); B.wall(a, b, sd * sec.sidewalk.o1, rise, -DROP, K.curb, sd); }
    }
  }
  markings(a, b, sec, M) {
    const on = (period, len) => (((a.s + b.s) / 2) % period) < len;
    const line = (o, w, kind) => M.strip(a, b, o - w / 2, o + w / 2, kind, 0.01);
    if (sec.centre === 'double') { line(-0.11, 0.1, K.yellow); line(0.11, 0.1, K.yellow); }
    else if (sec.centre === 'dashed' && on(12.19, 3.05)) line(0, 0.12, K.yellow);   // 10 ft on, 30 ft off
    for (const o of sec.laneLines) if (on(12.19, 3.05)) { line(o, 0.11, K.white); line(-o, 0.11, K.white); }
    if (sec.edgeLine !== null) { line(sec.edgeLine, 0.12, K.white); line(-sec.edgeLine, 0.12, K.white); }
    if (sec.shoulder?.kind === 'parking' && Math.floor(a.s / 6.7) !== Math.floor(b.s / 6.7)) {   // stall ends every 22 ft
      const t = (Math.floor(b.s / 6.7) * 6.7 - a.s) / (b.s - a.s), p = lerpSt(a, b, t), q = lerpSt(a, b, Math.min(1, t + 0.1 / (b.s - a.s)));
      for (const sd of [1, -1]) M.strip(p, q, sd > 0 ? sec.shoulder.o0 : -sec.shoulder.o0 - 1.2, sd > 0 ? sec.shoulder.o0 + 1.2 : -sec.shoulder.o0, K.white, 0.01);
    }
  }
  bridgePiece(a, b, sec, Br, seabed) {
    const outer = sec.outer;
    for (const sd of [1, -1]) { Br.wallC(a, b, sd * outer, 0.05, -0.95, COL.concrete, sd); Br.wallC(a, b, sd * (outer - 0.08), 1.05, 0.95, COL.rail, sd); }
    Br.stripC(a, b, -outer, outer, COL.concrete, -0.95, true);
    if (Math.floor(a.s / 30) !== Math.floor(b.s / 30) && seabed) {
      const by = seabed(b.x, b.z);
      if (by < b.y - 2 && b.y - by < 90) Br.pier(b, outer * 0.7, 0.7, b.y - 0.95, by - 1, COL.concrete);
    }
    if (Math.floor(a.s / 2.4) !== Math.floor(b.s / 2.4)) for (const sd of [1, -1]) Br.pier({ ...b, x: b.x + b.nx * sd * (outer - 0.08), z: b.z + b.nz * sd * (outer - 0.08) }, 0.05, 0.05, b.y + 1.0, b.y, COL.rail);
  }
  /** A junction from its plan: the paved area, every corner's gutter, curb and sidewalk, crosswalks and stop bars. */
  junction(J, y, S, M) {
    // the paved area up to the gutters' inner edge (2026-10-03: the gutter flickered where the paving ran under it)
    const C = { x: J.x, z: J.z }, area = [];
    // (and up to a gravel shoulder's inner edge, where a country road's shoulder carries on round a corner)
    J.arms.forEach((A, i) => {
      const c = J.corners[i], gw = A.sec.gutter ? A.sec.gutter.o1 - A.sec.gutter.o0 : 0, sw = A.sec.shoulder?.kind === 'gravel' && c.bands.gravel ? A.sec.shoulder.o1 - A.sec.shoulder.o0 : 0;
      const o = A.sec.carriage - gw - sw;
      area.push({ x: C.x + A.d.x * A.mouth - A.n.x * o, z: C.z + A.d.z * A.mouth - A.n.z * o });
      for (const p of c.bands.gravel ? c.bands.gravel[1] : c.bands.gutter ? c.bands.gutter[1] : c.curb) area.push(p);
    });
    S.fan(C, area, y, K.pad);
    for (const c of J.corners) {
      const b = c.bands, top = c.rise ? c.rise.map(r => y + CURB_RISE * r) : y + CURB_RISE;   // the curb comes down where one road has none
      if (b.gutter) S.band(b.gutter[0], b.gutter[1], y, y, K.gutter);
      if (b.gravel) S.band(b.gravel[0], b.gravel[1], y, y, K.gravel);
      // a corner's curb line runs with the road on its left: the curb's face looks left, the sidewalk's edge right
      if (b.curb) { S.curtain(b.curb[0], top, y, K.curb, 1); S.band(b.curb[0], b.curb[1], top, top, K.curb); }
      if (b.sidewalk) {
        const outer = resample(b.sidewalk[1], b.sidewalk[0].length);
        S.band(b.sidewalk[0], outer, top, top, K.walkW);
        S.curtain(outer, top, y - DROP, K.curb, -1);
      }
    }
    for (const cw of J.crosswalks) {   // zebra bars along the road, 0.6 m paint, 0.6 m gap
      const [p0, p1, p2, p3] = cw.poly, across = Math.hypot(p3.x - p0.x, p3.z - p0.z), n = Math.floor(across / 1.2);
      const off = (across - n * 1.2 + 0.6) / 2;
      for (let k = 0; k < n; k++) {
        const t0 = (off + k * 1.2) / across, t1 = (off + k * 1.2 + 0.6) / across, L = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
        M.quad([L(p0, p3, t0), L(p1, p2, t0), L(p1, p2, t1), L(p0, p3, t1)], y + 0.012, K.white);
      }
    }
    for (const st of J.stops) M.quad(st.poly, y + 0.012, K.white);
    for (const [p0, p1, p2, p3] of J.diagonals || []) {   // the scramble's diagonal crossings: bars across the way
      const L = Math.hypot(p1.x - p0.x, p1.z - p0.z), n = Math.floor(L / 1.2), at = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      for (let k = 0; k < n; k++) { const t0 = (k * 1.2 + 0.3) / L, t1 = (k * 1.2 + 0.9) / L; M.quad([at(p0, p1, t0), at(p3, p2, t0), at(p3, p2, t1), at(p0, p1, t1)], y + 0.011, K.white); }
    }
  }
  /** A dead end's turning circle; on a curbed road with a curb and sidewalk round it. */
  turningCircle(E, P, y, S) {
    const sec = sectionOf(P), ring = r => { const out = []; for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2; out.push({ x: E.x + Math.cos(a) * r, z: E.z + Math.sin(a) * r }); } return out; };
    S.fan({ x: E.x, z: E.z }, ring(E.r).slice(0, 48), y, K.pad);
    if (!sec.curb) return;
    const c = ring(E.r), co = ring(E.r + (sec.curb.o1 - sec.curb.o0)), w = ring(E.r + (sec.curb.o1 - sec.curb.o0) + (sec.sidewalk ? sec.sidewalk.o1 - sec.sidewalk.o0 : 0));
    S.curtain(c, y + CURB_RISE, y, K.curb, 1); S.band(c, co, y + CURB_RISE, y + CURB_RISE, K.curb);
    if (sec.sidewalk) { S.band(co, w, y + CURB_RISE, y + CURB_RISE, K.walkW); S.curtain(w, y + CURB_RISE, y - DROP, K.curb, -1); }
  }
}

/** The roads' material: the city's asphalt, gravel, concrete and tiles by kind (attribute aKind), worn paint. */
function roadMaterial(factor, units, paint = false) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: units });
  m.onBeforeCompile = sh => {
    commonUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; attribute vec2 aUV; varying float vKind; varying vec2 vUV; varying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WP_VERT} vKind = aKind; vUV = aUV;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vKind; varying vec2 vUV;\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `
vec2 p = vWP.xz; float fr = 0.9, aw = max(fwidth(p.x), fwidth(p.y)), k = vKind;
float n = fbm(p * 0.33), n2 = vnoise(p * 3.3);
vec3 asphalt = vec3(0.105, 0.105, 0.108) * (0.8 + 0.32 * n + 0.1 * n2 * (1.0 - smoothstep(0.05, 0.3, aw)));
asphalt *= 1.0 - 0.13 * smoothstep(0.6, 0.64, fbm(p * 0.06 + 7.0));
vec3 c = asphalt;
if (k > 0.5 && k < 1.5) c = asphalt * 1.1 + 0.012 * vnoise(p * 0.9);
else if (k > 1.5 && k < 2.5) { float g1 = vnoise(p * 6.0), g2 = vnoise(p * 23.0); c = vec3(0.42, 0.39, 0.34) * (0.78 + 0.26 * g1 + 0.16 * g2); fr = 1.0; }
else if (k > 2.5 && k < 3.5) { float j = abs(fract(vUV.x / 3.0 + 0.5) - 0.5) * 3.0; c = vec3(0.4, 0.395, 0.38) * (0.9 + 0.1 * vnoise(p * 4.0)) * (1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.03 + aw, j))); fr = 0.85; }
else if (k > 3.5 && k < 4.5) { c = vec3(0.46, 0.455, 0.44) * (0.92 + 0.08 * vnoise(p * 3.0)); fr = 0.85; }
else if (k > 4.5 && k < 5.5 || k > 6.5 && k < 7.5) {
  vec2 q = (k < 5.5 ? vUV : p) / 1.5; vec2 gg = fract(q); float e = min(min(gg.x, 1.0 - gg.x), min(gg.y, 1.0 - gg.y));
  float joint = (1.0 - smoothstep(0.0, 0.022 + aw * 0.8, e)) * (1.0 - smoothstep(0.04, 0.12, aw));
  c = vec3(0.36, 0.352, 0.335) * (0.9 + 0.08 * h21(floor(q)) + 0.07 * vnoise(p * 1.7)) * (1.0 - 0.17 * joint); fr = 0.85;
}
if (k > 9.5) {   // paint, worn
  vec3 pc = k < 10.5 ? vec3(0.9) : vec3(0.93, 0.72, 0.18);
  float wear = 0.72 + 0.28 * smoothstep(0.25, 0.6, n2 + n * 0.5);
  c = mix(asphalt, pc * (0.8 + 0.2 * n), wear); fr = 0.6;
}
diffuseColor.rgb *= c;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fr;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 2.2;');
  };
  m.customProgramCacheKey = () => `mvw-roads-${paint ? 'paint' : 'surf'}`;
  return wettable(m, { darken: 0.35, gloss: 0.6 });
}

const lerpSt = (a, b, t) => ({ s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, nx: a.nx, nz: a.nz });
/** A polyline resampled to n points evenly by length. */
function resample(pts, n) {
  if (pts.length === n) return pts;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = cum.at(-1) || 1, out = [];
  for (let k = 0; k < n; k++) {
    const s = L * k / (n - 1); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t });
  }
  return out;
}

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.kind = []; this.uv = []; this.col = []; }
  v(x, y, z, nx, ny, nz, kind, u, w, c = null) { this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.kind.push(kind); this.uv.push(u, w); if (c) this.col.push(c.r, c.g, c.b); }
  /** A strip along the road from station a to b between lateral offsets o0..o1, raised dy (uv: along, across). */
  strip(a, b, o0, o1, kind, dy = 0) {
    const P = (p, o) => [p.x + p.nx * o, p.y + dy, p.z + p.nz * o];
    const a0 = P(a, o0), a1 = P(a, o1), b0 = P(b, o0), b1 = P(b, o1);
    const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z, lx = a1[0] - a0[0], lz = a1[2] - a0[2];
    let nx = ty * lz, ny = tz * lx - tx * lz, nz = -ty * lx; const l = Math.hypot(nx, ny, nz) || 1; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const U = [[a0, a.s, o0], [a1, a.s, o1], [b0, b.s, o0], [a1, a.s, o1], [b1, b.s, o1], [b0, b.s, o0]];
    for (const [q, u, w] of U) this.v(q[0], q[1], q[2], nx / l, ny / l, nz / l, kind, u, w);
  }
  /** A vertical face along the road at offset o from yTop to yBot (relative to the stations), facing side (±1 across). */
  wall(a, b, o, yTop, yBot, kind, side) {
    const P = (p, y) => [p.x + p.nx * o, p.y + y, p.z + p.nz * o], q = [P(a, yTop), P(b, yTop), P(b, yBot), P(a, yBot)];
    const U = [[q[0], a.s, yTop], [q[1], b.s, yTop], [q[2], b.s, yBot], [q[0], a.s, yTop], [q[2], b.s, yBot], [q[3], a.s, yBot]];
    // (top a, top b, bottom b) faces right of the road's direction (−n): reversed to face +n (side 1)
    const list = side > 0 ? [U[0], U[2], U[1], U[3], U[5], U[4]] : U;
    for (const [v, u, w] of list) this.v(v[0], v[1], v[2], a.nx * side, 0, a.nz * side, kind, u, w);
  }
  /** A flat fan from centre c round polygon `poly` at height y. */
  fan(c, poly, y, kind) {
    for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; this.tri([c.x, y, c.z], [a.x, y, a.z], [b.x, y, b.z], kind); }
  }
  /** A band between two polylines of equal length (heights yi inner, yo outer: a number, or one per point). */
  band(inner, outer, yi, yo, kind) {
    const Y = (v, k) => (typeof v === 'number' ? v : v[k]);
    for (let k = 0; k + 1 < inner.length; k++) {
      const a = [inner[k].x, Y(yi, k), inner[k].z], b = [inner[k + 1].x, Y(yi, k + 1), inner[k + 1].z], c = [outer[k + 1].x, Y(yo, k + 1), outer[k + 1].z], d = [outer[k].x, Y(yo, k), outer[k].z];
      this.tri(a, b, c, kind); this.tri(a, c, d, kind);
    }
  }
  /** A vertical face along a polyline from yTop (a number, or one per point) down to yBot, facing its left (+1) or right
   *  (−1) side. */
  curtain(pts, yTop, yBot, kind, side) {
    const T = k => (typeof yTop === 'number' ? yTop : yTop[k]);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * side, nz = dx / l * side;
      const q = [[a.x, T(k), a.z], [b.x, T(k + 1), b.z], [b.x, yBot, b.z], [a.x, yBot, a.z]];
      // (top a, top b, bottom b) faces right of the polyline: reversed to face its left (side 1)
      const list = side > 0 ? [q[0], q[2], q[1], q[0], q[3], q[2]] : [q[0], q[1], q[2], q[0], q[2], q[3]];
      for (const v of list) this.v(v[0], v[1], v[2], nx, 0, nz, kind, v[0], v[2]);
    }
  }
  /** One flat triangle facing up. */
  tri(a, b, c, kind) {
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0, list = up ? [a, b, c] : [a, c, b];
    for (const q of list) this.v(q[0], q[1], q[2], 0, 1, 0, kind, q[0], q[2]);
  }
  quad(P, y, kind) { this.tri([P[0].x, y, P[0].z], [P[1].x, y, P[1].z], [P[2].x, y, P[2].z], kind); this.tri([P[0].x, y, P[0].z], [P[2].x, y, P[2].z], [P[3].x, y, P[3].z], kind); }
  // ---- coloured pieces (bridges)
  vc(x, y, z, nx, ny, nz, c) { this.v(x, y, z, nx, ny, nz, 0, 0, 0, c); }
  wallC(a, b, o, yTop, yBot, c, side) {
    const P = (p, y) => [p.x + p.nx * o, p.y + y, p.z + p.nz * o], q = [P(a, yTop), P(b, yTop), P(b, yBot), P(a, yBot)];
    for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) this.vc(v[0], v[1], v[2], a.nx * side, 0, a.nz * side, c);
  }
  stripC(a, b, o0, o1, c, lift, down) {
    const v = (p, o) => [p.x + p.nx * o, p.y + lift, p.z + p.nz * o], a0 = v(a, o0), a1 = v(a, o1), b0 = v(b, o0), b1 = v(b, o1);
    for (const q of [a0, a1, b0, a1, b1, b0]) this.vc(q[0], q[1], q[2], 0, down ? -1 : 1, 0, c);
  }
  pier(p, hw, hd, y1, y0, c) {
    const ax = p.nx, az = p.nz, tx = -p.nz, tz = p.nx;
    const C = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [p.x + ax * u + tx * v, p.z + az * u + tz * v]);
    for (let k = 0; k < 4; k++) {
      const a = C[k], b = C[(k + 1) % 4], nx = (a[0] + b[0]) / 2 - p.x, nz = (a[1] + b[1]) / 2 - p.z, l = Math.hypot(nx, nz) || 1;
      for (const v of [[a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [a[0], y1, a[1]], [b[0], y0, b[1]], [a[0], y0, a[1]]]) this.vc(v[0], v[1], v[2], nx / l, 0, nz / l, c);
    }
  }
  build(coloured = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (coloured) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    else { g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1)); g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2)); }
    g.computeBoundingSphere();
    return g;
  }
}
