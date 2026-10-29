// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Radio Station world module's grounds (shared/radio-layout.js; the studio itself is a real building, drawn as
// buildings are): the car park and the plaza, the broadcast tower (a 96 m three-legged lattice mast in red and white
// bands, its platforms, its antennas), the satellite dishes on their pads, the station's name board by the road, the
// ON AIR sign over the studio's door (lit while one of the stations has a host: shared/radio.js, audio/radio.js), and
// the tower's aviation lights (red: the top one flashes, the others glow, brighter at night). Built in code, in the
// module's own frame (s across, f along: FB's x and z), one mesh a station.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { FB } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { lettering } from './airport.js';
import { modulesOf } from '/shared/world-modules.js';
import { toWorldAt } from '/shared/airport-layout.js';
import { RADIO_STUDIO, RADIO_TOWER, RADIO_DISHES, RADIO_DOOR, RADIO_PARKING, RADIO_LIGHTS, RADIO_ROAD_END, RADIO_DRIVE, RADIO_SURFACES } from '/shared/radio-layout.js';

const SURF = { paving: '#c9c4b8', asphalt: '#4a4f55', gravel: '#9aa0a6', grass: null };   // (grass: the ground's own)
const BOARD_F = RADIO_DRIVE.f0 - 10;   // (the name board's middle: beside the drive, clear of it)

const FAR = 2600, TAU = Math.PI * 2;
let app = null, group = null, gmat = null, dirty = true;
const built = new Map();   // key → { mesh, lights: [Mesh], onAir: Mesh, at }
let haloTex = null;
const lightMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a }), onAirMat = new THREE.MeshBasicMaterial({ color: 0x401010 });

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'radio-stations'; a.stage.scene.add(group);
  gmat = makeFurnMat({ lit: true }); gmat.polygonOffset = true; gmat.polygonOffsetFactor = -1; gmat.polygonOffsetUnits = -4;
  for (const k of ['wmods', 'terrain', 'roads', 'world']) bus.on(k, () => { dirty = true; });
  bus.on('frame', update);
  a.radioStations = { get count() { return built.size; }, get lit() { return onAirMat.color.getHex() !== 0x401010; } };
}

/** The mast: three legs from a 9 m triangle tapering to 1.6 m at the top, horizontal rings and zig-zag bracing every
 *  4 m, painted in seven red and white bands; two platforms; antennas and a lightning rod on top. */
function mast(f, x, z, h, base) {
  const R0 = base / 2, R1 = 0.8, legs = [0, 1, 2].map(k => k * TAU / 3 + Math.PI / 6);
  const at = (k, y) => { const r = R0 + (R1 - R0) * (y / h), a = legs[k]; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; };
  const band = y => (Math.floor(y / (h / 7)) % 2 ? '#f3f1ec' : '#d23a2c');
  f.col('#8d9196'); for (let k = 0; k < 3; k++) { const [px, , pz] = at(k, 0); f.box(px - 0.9, -0.05, pz - 0.9, px + 0.9, 0.5, pz + 0.9); }   // the footings
  const STEP = 4;
  for (let y = 0; y < h; y += STEP) {
    const y1 = Math.min(h, y + STEP);
    f.col(band(y + 0.1));
    for (let k = 0; k < 3; k++) {
      const a = at(k, y), b = at(k, y1), c = at((k + 1) % 3, y1);
      f.rod(a, b, 0.16 * (1 - y / h * 0.5), 6);                          // a leg
      f.rod(b, at((k + 1) % 3, y1), 0.06, 4);                            // the ring
      f.rod(a, c, 0.05, 4);                                              // a brace across the face
    }
  }
  f.col('#5d6268');
  for (const y of [h * 0.48, h * 0.82]) {                                // the platforms, a rail round each
    const r = R0 + (R1 - R0) * (y / h) + 0.9;
    f.cyl(x, z, r, y - 0.12, y, 18);
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; f.rod([x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(a) * r, y + 1.0, z + Math.sin(a) * r], 0.03, 4); }
    f.col('#6c7177');
  }
  f.col('#e7e7e2');                                                       // the antennas: panels on the upper platform, whips at the top
  for (let k = 0; k < 3; k++) { const a = legs[k] + Math.PI / 3, r = R0 + (R1 - R0) * 0.86 + 1.2; f.boxC(x + Math.cos(a) * r, h * 0.86, z + Math.sin(a) * r, 0.25, 1.4, 0.45, -a); }
  f.col('#b9bcbf'); f.rod([x, h, z], [x, h + 7, z], 0.12, 6); f.rod([x + 0.5, h, z], [x + 0.5, h + 4, z], 0.05, 4); f.rod([x - 0.5, h, z + 0.3], [x - 0.5, h + 3.2, z + 0.3], 0.05, 4);
}
/** A satellite dish on its pad (2026-10-27: "the satellites need to be bigger, also they are pointing towards the
 *  ground and also disappear at certain angles"): a concrete pad and a pedestal, the yoke, the bowl (a paraboloid, both
 *  of its faces drawn so it shows from behind too) aimed up at the sky (elevation el) towards yaw, three struts to the
 *  feed horn at its focus. */
function dish(f, x, z, r, yaw, el = 0.62) {
  const lift = r * 0.75 + 1.2;
  f.col('#9a9da2'); f.box(x - r * 0.55, -0.05, z - r * 0.55, x + r * 0.55, 0.35, z + r * 0.55);   // the pad
  f.col('#6f747a'); f.cyl(x, z, r * 0.12 + 0.2, 0.35, lift - 0.4, 10);                                // the pedestal
  f.push(x, lift, z, yaw);
  f.col('#5d6268'); f.box(-0.5, -0.5, -0.9, 0.5, 0.3, 0.9);                                            // the yoke
  const th = -(Math.PI / 2 - el), c = Math.cos(th), sn = Math.sin(th);
  const R = ([px, py, pz]) => [px * c - py * sn, px * sn + py * c, pz];   // the bowl's axis (up) turned to point el above the horizon, along +x
  const k = 0.18 / r, N = 24, M = 7, P = (u, a) => R([u * Math.cos(a), k * u * u, u * Math.sin(a)]);
  const quad = (q, front) => {
    const [a0, b0, , d0] = q, e1 = [b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]], e2 = [d0[0] - a0[0], d0[1] - a0[1], d0[2] - a0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const L = Math.hypot(...n) || 1; n = n.map(v => v / L);
    f.col(front ? '#f2f3f4' : '#c9ccd0'); f.quad(q, n);
    f.quad([q[3], q[2], q[1], q[0]], n.map(v => -v));                    // (the other face: never culled away)
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, u0 = r * j / M, u1 = r * (j + 1) / M;
    quad([P(u0, a0), P(u1, a0), P(u1, a1), P(u0, a1)], true);
  }
  f.col('#8a8e94'); for (let i = 0; i < N; i++) f.rod(P(r, i / N * TAU), P(r, (i + 1) / N * TAU), 0.07, 4);   // the rim
  const focus = R([0, r * r * k + r * 0.35, 0]);
  f.col('#7b8086'); for (let i = 0; i < 3; i++) f.rod(P(r * 0.92, i / 3 * TAU + 0.5), focus, 0.06, 4);   // the struts
  f.col('#2f3237'); f.boxC(focus[0], focus[1], focus[2], 0.35, 0.35, 0.35);                              // the feed horn
  f.col('#5d6268'); f.rod([0, 0, 0], R([0, 0.6, 0]), 0.25, 6);                                            // the mount behind the bowl
  f.pop();
}
function grounds(m) {
  const f = new FB(), G = -0.05, P0 = G - 0.02, P1 = G + 0.015, M1 = G + 0.03;
  f.push(m.x, m.y, m.z, m.rot);
  const park = RADIO_PARKING, line = '#eceae4';
  // its surfaces (shared/radio-layout.js RADIO_SURFACES; the grass between them is the ground's own, as at the airport)
  for (const [s0, f0, s1, f1, kind] of RADIO_SURFACES) if (SURF[kind]) { f.col(SURF[kind]); f.box(s0, P0, f0, s1, P1, f1, 'b'); }
  // the car park's bays: a line between each two, the near row nose to the walk, the far row nose to the road, none
  // across the drive; a line along each row's back
  f.col(line);
  for (const [s0, s1] of park.rows) {
    for (let fz = park.f0; fz <= park.f1 + 0.01; fz += park.bay) {
      if (s0 >= park.aisle[1] && fz > RADIO_DRIVE.f0 - 0.01 && fz < RADIO_DRIVE.f1 + 0.01) continue;
      f.box(s0 + 0.3, P1, fz - 0.06, s1 - 0.3, M1, fz + 0.06, 'b');
    }
    const back = s0 >= park.aisle[1] ? s1 - 0.3 : s0 + 0.3;
    for (const [a, b] of s0 >= park.aisle[1] ? [[park.f0, RADIO_DRIVE.f0], [RADIO_DRIVE.f1, park.f1]] : [[park.f0, park.f1]]) f.box(back - 0.06, P1, a, back + 0.06, M1, b, 'b');
  }
  // the drive: its centre line, dashed, from the aisle out to the road; arrows in and out on the aisle
  for (let sz = park.aisle[1] + 1; sz < RADIO_ROAD_END.s - 1; sz += 4) f.box(sz, P1, RADIO_ROAD_END.f - 0.07, sz + 2, M1, RADIO_ROAD_END.f + 0.07, 'b');
  // the walk's kerb along the car park
  f.col('#b9b4a8'); f.box(park.s0 - 0.25, P1, park.f0, park.s0, P1 + 0.12, park.f1, 'b');
  f.col('#9aa0a6');   // (the compound's fence posts below are its own grey)
  const T = RADIO_TOWER, side = [[-8, -8, 8, -8], [8, -8, 8, 8], [8, 8, -8, 8], [-8, 8, -8, -8]];   // its fence: posts and three wires
  f.col('#8e949a'); for (const [s0, f0, s1, f1] of side) for (let k = 0; k < 8; k++) { const u = k / 8, ps = T.s + s0 + (s1 - s0) * u, pf = T.f + f0 + (f1 - f0) * u; f.box(ps - 0.05, G, pf - 0.05, ps + 0.05, G + 2.2, pf + 0.05); }
  f.col('#a8adb3'); for (const [s0, f0, s1, f1] of side) for (const y of [0.4, 1.3, 2.15]) f.rod([T.s + s0, G + y, T.f + f0], [T.s + s1, G + y, T.f + f1], 0.03, 4);
  mast(f, RADIO_TOWER.s, RADIO_TOWER.f, RADIO_TOWER.h, RADIO_TOWER.base);
  for (const d of RADIO_DISHES) dish(f, d.s, d.f, d.r, d.yaw, d.el);
  // the name board beside the entrance, facing the road: two posts and a board (its letters: signs())
  const nb = BOARD_F;
  f.col('#24272c'); f.box(park.s1 + 1, G, nb - 6.6, park.s1 + 1.5, G + 3.6, nb - 6.2); f.box(park.s1 + 1, G, nb + 6.2, park.s1 + 1.5, G + 3.6, nb + 6.6);
  f.col('#e23b3b'); f.box(park.s1 + 0.9, G + 2.0, nb - 7, park.s1 + 1.6, G + 3.8, nb + 7);
  f.pop();
  return f.build().geo;
}
/** The letters (the station's name on the board), the ON AIR sign over the door and the tower's lights, as meshes. */
function extras(m, mesh) {
  const put = (o, s, fz, y, face) => { const p = toWorldAt(m, s, fz); o.position.set(p.x, m.y + y, p.z); o.rotation.y = m.rot + face * Math.PI / 2; mesh.add(o); return o; };
  put(lettering((m.name || 'MVW Radio').toUpperCase(), 12.5, 0.9), RADIO_PARKING.s1 + 1.62, BOARD_F, 2.9, 1);
  put(lettering('88.3 · 94.7 · 99.9 · 1040 AM', 12.5, 0.5), RADIO_PARKING.s1 + 1.62, BOARD_F, 2.25, 1);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 3.2), onAirMat); put(sign, RADIO_STUDIO.s1 + 0.25, RADIO_DOOR.f + 4.2, 3.6, 0);
  put(lettering('ON AIR', 3, 0.62), RADIO_STUDIO.s1 + 0.37, RADIO_DOOR.f + 4.2, 3.6, 1);
  const lights = RADIO_LIGHTS.map((y, k) => put(new THREE.Mesh(new THREE.SphereGeometry(k === RADIO_LIGHTS.length - 1 ? 0.7 : 0.45, 10, 8), lightMat.clone()), RADIO_TOWER.s, RADIO_TOWER.f, y + (k === RADIO_LIGHTS.length - 1 ? 0.6 : 0), 0));
  // a red glow round each, seen from far off (drawn over the sky, never hidden by its own mast)
  if (!haloTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,90,70,1)'); r.addColorStop(0.25, 'rgba(255,40,30,0.55)'); r.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); haloTex = new THREE.CanvasTexture(c); }
  for (const [k, L] of lights.entries()) {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const big = k === lights.length - 1 ? 9 : 5; h.scale.set(big, big, 1); L.add(h); L.userData.halo = h;
  }
  return lights;
}
function build() {
  dirty = false;
  const list = modulesOf(S.world).filter(m => m.kind === 'radio' && Number.isFinite(m.y)), keep = new Set();
  for (const m of list) {
    const key = `${m.id}:${m.x}:${m.z}:${m.rot}:${m.y}:${m.name}`; keep.add(key);
    if (built.has(key)) continue;
    const mesh = new THREE.Mesh(grounds(m), gmat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = `radio-${m.id}`;
    const lights = extras(m, mesh);
    built.set(key, { mesh, lights, at: { x: m.x, z: m.z } }); group.add(mesh);
  }
  for (const [key, b] of built) if (!keep.has(key)) {
    group.remove(b.mesh); b.mesh.geometry.dispose();
    b.mesh.traverse(c => { if (c === b.mesh) return; c.geometry?.dispose(); if (c.material && c.material !== onAirMat) { if (c.material.map !== haloTex) c.material.map?.dispose(); c.material.dispose(); } });
    built.delete(key);
  }
}
function update() {
  if (dirty) { if (!app.terrain?.ground && modulesOf(S.world).some(m => m.kind === 'radio')) return; build(); }
  if (!built.size) return;
  const c = app.stage.camera.position, night = app.stage.state.night ?? 0, t = performance.now() / 1000;
  const flash = (t % 1.5) < 0.18 ? 1 : 0.08;   // the top light: a red flash every 1.5 s
  const hosted = Object.values(app.radio?.hosts || {}).some(Boolean), talking = !!app.radio?.onAir;
  onAirMat.color.setHex(talking ? 0xff2a2a : hosted ? 0xd32222 : 0x401010);
  for (const b of built.values()) {
    b.mesh.visible = Math.hypot(b.at.x - c.x, b.at.z - c.z) < FAR;
    if (!b.mesh.visible) continue;
    b.lights.forEach((L, k) => { const on = k === b.lights.length - 1 ? flash : 0.35 + 0.65 * night; L.material.color.setRGB(on, 0.08 * on + 0.02, 0.05 * on + 0.02); const h = L.userData.halo; if (h) h.material.opacity = on * (0.25 + 0.75 * night); });
  }
}
