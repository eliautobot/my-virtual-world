// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A fishing trip's grounds as they show on the water (docs/features/fishing.md §Finding fish; shared/fishing-trip.js
// GROUNDS shows): bird flocks wheeling over the fish and diving into them (seen from far off), surface boils (the water
// churning, bait fish breaking it), lily pads, weed beds, rocks breaking the surface off a point, and the water's own
// colour - the sand of the flats, the dark of a reef, the line of a drop-off, the cobalt of the blue water. Hidden
// grounds show nothing (the fish finder finds them). The legend's ground, while it's about, gets a golden ring. One mesh
// for every patch of colour, one for every bird, one for the pads, one for the weed, one for the rocks.
import * as THREE from 'three';
import { groundPos } from '/shared/fishing-trip.js';

const BIRDS = 14, MAX_BIRDS = 64, PADS = 70, MAX_PADS = 420, WEED = 40, MAX_WEED = 360, MAX_ROCKS = 60;
const TINT = { sand: ['#e8dcae', 0.3], dark: ['#06222c', 0.42], line: ['#0b3550', 0.38], blue: ['#0a2f78', 0.36], weed: ['#4a5a26', 0.45], pads: ['#36552a', 0.2], rocks: ['#3a4a50', 0.25] };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const rnd = seed => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s >>> 0) / 4294967296)); };
const hashOf = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

function softDisc(ring = false) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, ring ? 40 : 4, 64, 64, 63);
  if (ring) { g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,1)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** A bird: a body and two wings (their tips flap in the shader by the instance's phase). */
function birdGeometry() {
  const p = [0, 0, 0.18, 0.04, 0, -0.16, -0.04, 0, -0.16, /* wings */ 0, 0, 0.06, 0.55, 0.05, -0.04, 0, 0, -0.08, 0, 0, 0.06, -0.55, 0.05, -0.04, 0, 0, -0.08];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
}
function padGeometry() { return new THREE.CircleGeometry(0.5, 14, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2); }

export class GroundMarks {
  constructor(scene) {
    this.scene = scene; this.list = []; this.on = false;
    const mk = (geo, mat, n, name, order = 2) => { const o = new THREE.InstancedMesh(geo, mat, n); o.count = 0; o.frustumCulled = false; o.renderOrder = order; o.name = name; scene.add(o); return o; };
    this.patches = mk(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softDisc(), transparent: true, depthWrite: false, opacity: 1 }), 24, 'ground-patches');
    this.patches.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.patchA = new Float32Array(24);
    this.patches.material.onBeforeCompile = sh => {   // (each patch its own strength: an instance attribute)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aA; varying float vA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aA;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vA;\n#include <opaque_fragment>');
    };
    this.patches.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(this.patchA, 1));
    this.legendRing = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softDisc(true), color: 0xffc83d, transparent: true, depthWrite: false }));
    this.legendRing.visible = false; this.legendRing.renderOrder = 3; scene.add(this.legendRing);
    const bm = new THREE.MeshBasicMaterial({ color: 0x2a2e33, side: THREE.DoubleSide });
    bm.onBeforeCompile = sh => {
      sh.uniforms.uT = this.uT = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;').replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 1.3;\ntransformed.y += abs(position.x) * 0.9 * sin(uT * 11.0 + ph);');
    };
    this.birds = mk(birdGeometry(), bm, MAX_BIRDS, 'ground-birds', 1);
    this.pads = mk(padGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f6f32, roughness: 0.8, side: THREE.DoubleSide }), MAX_PADS, 'ground-pads');
    this.pads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PADS * 3), 3);
    this.weed = mk(new THREE.CircleGeometry(0.5, 7).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55602c, roughness: 0.95, transparent: true, opacity: 0.85, depthWrite: false }), MAX_WEED, 'ground-weed');
    this.rocks = mk(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshStandardMaterial({ color: 0x5b5a52, roughness: 0.95, flatShading: true }), MAX_ROCKS, 'ground-rocks', 0);
    this.rocks.castShadow = true;
  }
  /** The trip's grounds (plan: shared/fishing-trip.js generateTrip; level(x, z) → the calm water's height there). */
  set(plan, level) {
    this.plan = plan; this.level = level; this.on = !!plan;
    this.list = plan ? plan.grounds.map(g => ({ g, seed: hashOf(g.id + plan.seed), birds: [], dive: null })) : [];
    // the things that stay put: pads, weed, rocks - laid out once
    let np = 0, nw = 0, nr = 0;
    for (const G of this.list) {
      const g = G.g, R = rnd(G.seed), y = level(g.x, g.z);
      if (g.hidden || y == null) continue;
      if (g.shows === 'pads') for (let k = 0; k < PADS && np < MAX_PADS; k++) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * g.r * 0.95, s = 0.35 + R() * 0.55;
        this.pads.setMatrixAt(np, _m.compose(_p.set(g.x + Math.cos(a) * r, y + 0.025, g.z + Math.sin(a) * r), _q.setFromEuler(_e.set(0, R() * 6.3, 0)), _s.set(s, 1, s)));
        this.pads.setColorAt(np++, _c.set(R() < 0.06 ? '#e98fb5' : R() < 0.5 ? '#3f6f32' : '#4f7d36'));
      }
      if (g.shows === 'weed' || g.shows === 'pads') for (let k = 0; k < WEED * (g.shows === 'weed' ? 1 : 0.3) && nw < MAX_WEED; k++) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * g.r, s = 0.6 + R() * 1.6;
        this.weed.setMatrixAt(nw++, _m.compose(_p.set(g.x + Math.cos(a) * r, y + 0.015, g.z + Math.sin(a) * r), _q.setFromEuler(_e.set(0, R() * 6.3, 0)), _s.set(s, 1, s * (0.4 + R()))));
      }
      if (g.shows === 'rocks') for (let k = 0; k < 7 && nr < MAX_ROCKS; k++) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * g.r * 0.8, s = 0.5 + R() * 1.4;
        this.rocks.setMatrixAt(nr++, _m.compose(_p.set(g.x + Math.cos(a) * r, y - 0.2 + s * 0.15, g.z + Math.sin(a) * r), _q.setFromEuler(_e.set(R(), R() * 6.3, R())), _s.set(s, s * 0.6, s)));
      }
      if (g.shows === 'birds') for (let k = 0; k < BIRDS; k++) G.birds.push({ a: R() * Math.PI * 2, r: 12 + R() * 22, h: 9 + R() * 12, w: (0.25 + R() * 0.2) * (R() < 0.5 ? -1 : 1), dive: null });
    }
    this.pads.count = np; this.weed.count = nw; this.rocks.count = nr;
    for (const o of [this.pads, this.weed, this.rocks]) { o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; }
    if (!plan) { this.patches.count = 0; this.birds.count = 0; this.legendRing.visible = false; }
  }
  /**
   * Once a frame: the patches and flocks where their grounds are now (they wander), the birds wheel and dive, a boil
   * breaks (fx: render/fishing-fx.js - its ripples and drops, near the camera only), the legend's ring pulses.
   * minute: into the trip; legend: the plan's sighting (shown from..to).
   */
  update(dt, t, minute, cam, fx) {
    if (!this.on) return;
    if (this.uT) this.uT.value = t;
    let np = 0, nb = 0;
    const lg = this.plan.legend, legendOn = lg && minute >= lg.from && minute <= lg.to;
    this.legendRing.visible = false;
    for (const G of this.list) {
      const g = G.g; if (g.hidden && !(legendOn && lg.ground === g.id)) continue;
      const p = groundPos(g, minute, this.plan.water), y = this.level(p.x, p.z); if (y == null) continue;
      const tint = TINT[g.shows];
      if (tint && np < 24 && !g.hidden) {
        const r = g.r * (g.shows === 'line' ? 1.15 : 1);
        this.patches.setMatrixAt(np, _m.compose(_p.set(p.x, y + 0.12, p.z), _q.identity(), _s.set(r, 1, g.shows === 'line' ? r * 0.35 : r)));
        this.patches.setColorAt(np, _c.set(tint[0])); this.patchA[np] = tint[1]; np++;
      }
      if (g.shows === 'birds') for (const b of G.birds) {
        b.a += b.w * dt;
        let bx = p.x + Math.cos(b.a) * b.r, bz = p.z + Math.sin(b.a) * b.r, by = y + b.h;
        if (!b.dive && Math.random() < dt * 0.05) b.dive = { t: 0 };
        if (b.dive) {   // folded, straight down into the water, a splash, and back up
          b.dive.t += dt; const u = b.dive.t / 1.6, k = u < 0.45 ? u / 0.45 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
          by = y + 0.3 + (b.h - 0.3) * (1 - k);
          if (u >= 0.45 && !b.dive.hit) { b.dive.hit = true; if (fx && cam.distanceTo(_p.set(bx, y, bz)) < 400) fx.splash(bx, y, bz, 0.15); }
          if (u >= 1) b.dive = null;
        }
        if (nb < MAX_BIRDS) this.birds.setMatrixAt(nb++, _m.compose(_p.set(bx, by, bz), _q.setFromEuler(_e.set(b.dive && !b.dive.hit ? 1.2 : 0, b.a + (b.w > 0 ? 0 : Math.PI), b.w > 0 ? -0.35 : 0.35)), _s.set(b.dive ? 0.6 : 1.4, 1.4, 1.4)));
      }
      if (g.shows === 'boil' && fx && cam.distanceTo(_p.set(p.x, y, p.z)) < 320) {   // the water broken by bait fish
        G.next = (G.next ?? 0) - dt;
        if (G.next <= 0) { G.next = 0.15 + Math.random() * 0.35; const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * g.r * 0.7; const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (Math.random() < 0.6) fx.ripple(x, y, z, 1 + Math.random() * 1.5, 1.2); else fx.splash(x, y, z, 0.12); }
      }
      if (legendOn && lg.ground === g.id) {
        const k = 1 + 0.08 * Math.sin(t * 2.5);
        this.legendRing.visible = true; this.legendRing.position.set(p.x, y + 0.15, p.z); this.legendRing.scale.set(g.r * 1.1 * k, 1, g.r * 1.1 * k);
        this.legendRing.material.opacity = 0.45 + 0.25 * Math.sin(t * 2.5);
      }
    }
    this.patches.count = np; this.birds.count = nb;
    this.patches.instanceMatrix.needsUpdate = true; if (np) { this.patches.instanceColor.needsUpdate = true; this.patches.geometry.attributes.aA.needsUpdate = true; }
    this.birds.instanceMatrix.needsUpdate = true;
  }
  clear() { this.set(null); }
}
