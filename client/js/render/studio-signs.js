// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Each radio studio's name over its door, outside (2026-10-27, the product owner: "a name outside the radio station module
// so that they are easy to spot to know what station is each module"): a lit sign in the station's colour, its frequency
// and name, on the floor being looked into or walked on; it follows the station (renamed, retuned, recoloured).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { toWorld, bRot } from '/shared/geom.js';
import { floorAt } from '/shared/constants.js';
import { moduleDoor } from '/shared/interior-modules.js';

const W = 2.3, H = 0.56, OUT = 0.1, Y = 2.5;   // (m: its size, how far out of the wall, its middle above the floor)
let app = null, group = null, last = 0;
const signs = new Map();   // key → mesh

function texture(st) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 250;
  const g = c.getContext('2d'), col = st.color || '#4aa3ff';
  g.fillStyle = '#0d0f14'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = col; g.lineWidth = 14; g.shadowColor = col; g.shadowBlur = 24; g.strokeRect(14, 14, c.width - 28, c.height - 28);
  g.shadowBlur = 18; g.fillStyle = col; g.textBaseline = 'middle';
  g.font = '800 92px system-ui, sans-serif'; const fq = `${st.freq} ${st.band}`, fw = g.measureText(fq).width;
  g.font = '700 74px system-ui, sans-serif'; const nm = String(st.name || ''), nw = g.measureText(nm).width;
  const gap = 34, total = fw + gap + 6 + gap + nw, s = Math.min(1, (c.width - 90) / total);
  g.save(); g.translate(c.width / 2 - total * s / 2, c.height / 2); g.scale(s, s);
  g.font = '800 92px system-ui, sans-serif'; g.fillText(fq, 0, 4);
  g.fillRect(fw + gap, -44, 6, 88);
  g.fillStyle = '#ffffff'; g.shadowColor = col; g.font = '700 74px system-ui, sans-serif'; g.fillText(nm, fw + gap * 2 + 6, 4);
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** The floors drawn now: the one looked into, and the one the player walks on. */
function floorsNow() {
  const out = new Set();
  if (S.focus?.b >= 0) out.add(`${S.focus.b}:${S.focus.f | 0}`);
  const P = app.player; if (P?.active && P.ctx >= 0) out.add(`${P.ctx >> 6}:${P.ctx & 63}`);
  return out;
}
function update() {
  const want = new Set(), Wd = S.world, list = app.radio?.all || [];
  if (Wd) for (const key of floorsNow()) {
    const [b, f] = key.split(':').map(Number), B = Wd.buildings[b], L = B && Wd.levels[B.lv?.[f]];
    for (const m of L?.mods || []) {
      if (m.kind !== 'studio') continue;
      const st = list.find(s => s.studio && s.studio.b === b && s.studio.f === f && s.studio.room === m.id); if (!st) continue;
      const d = moduleDoor(B, m), k = `${b}:${f}:${m.id}:${d.x},${d.z},${d.side}:${st.freq}${st.band}:${st.name}:${st.color}`;
      want.add(k);
      if (signs.has(k)) continue;
      const mat = new THREE.MeshBasicMaterial({ map: texture(st), toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
      const p = toWorld(B, d.x + d.nx * OUT, d.z + d.nz * OUT);
      mesh.position.set(p.x, floorAt(B, f) + Y, p.z);
      mesh.rotation.y = bRot(B) + Math.atan2(d.nx, d.nz);
      mesh.name = `studio-sign ${st.name}`; mesh.userData.station = st.id;
      group.add(mesh); signs.set(k, mesh);
    }
  }
  for (const [k, mesh] of signs) if (!want.has(k)) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); signs.delete(k); }
}

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'studio-signs'; a.stage.scene.add(group);
  a.studioSigns = { get list() { return [...signs.values()].map(m => ({ station: m.userData.station, x: +m.position.x.toFixed(2), y: +m.position.y.toFixed(2), z: +m.position.z.toFixed(2), yaw: +m.rotation.y.toFixed(3) })); } };
  bus.on('frame', () => { const now = performance.now(); if (now - last > 500) { last = now; update(); } });
}
