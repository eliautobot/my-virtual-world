#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chooses the Amazon model each MVW piece with a counterpart is drawn with (shared/abo-replace.js SPEC): of its kinds,
// the one whose real size fits the piece's box best with the least stretching, a plain colour, light to draw (one part,
// few triangles), not already taken by another piece; and the set's chair. Rewrites PICK in shared/abo-replace.js
// (review it on the contact sheet: tools-bin of the lab, or by placing the pieces).   node tools/abo-pick.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../shared/catalog.js';
import { ABO_LIB } from '../shared/abo-items.js';
import { SPEC, aboFit } from '../shared/abo-replace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = Math.log, A = v => Math.abs(L(v));
const PLAIN = /^(Grey|Brown|Cream|White|Black|Navy|Blue|Green)\b/, LOUD = /Pink|Orange|Purple|Yellow|Red|Patterned|Gold/;
const glbInfo = new Map();
function info(id) {
  let r = glbInfo.get(id);
  if (!r) {
    const f = path.join(ROOT, 'client/assets/abo/m', `${id}.glb`);
    try {
      const b = fs.readFileSync(f), j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
      r = { bytes: b.length, prims: j.meshes.reduce((s, m) => s + m.primitives.length, 0), mats: (j.materials || []).length };
    } catch { r = null; }
    glbInfo.set(id, r);
  }
  return r;
}
const used = new Set();
function look(e, want, avoid) {
  let p = PLAIN.test(e.name) ? 0 : LOUD.test(e.name) ? 0.5 : 0.2;
  if (want && want.test(e.name)) p -= 0.5;
  if (avoid && avoid.test(e.name)) p += 1.5;
  const g = info(e.id); if (!g) return Infinity;
  if (g.prims > 1) p += 0.3 * (g.prims - 1);
  if (g.bytes > 150e3) p += 0.25;
  if (used.has(e.id)) p += 0.2;
  return p;
}
const WANT = { rattan_set: /Rattan|Wicker|Bamboo|Natural|Wood|Brown|Cream/, library_table: /Walnut|Brown/, bistro_set: /Marble|Black/, gilt_mirror: /Gold/, communal_table: /Oak|Wood|Brown/, bench: /Wood|Metal|Teak|Acacia|Brown/ };
const AVOID = { rattan_set: /Plastic|Blue/, bench: /Fabric|Velvet|Linen|Leather|Bouclé|Cotton|Wool/ };
function pickMain(t, S) {
  const def = CATALOG[t], fit = S.fit || [...def.rect, def.h];
  let best = null;
  for (const e of ABO_LIB) {
    if (!S.k.includes(e.k)) continue;
    const f = aboFit(e.id, fit, S); if (!f) continue;
    const d = CATALOG[e.t], [bx0, bz0, bx1, bz1] = d.rect, bh = d.h - (d.lift || 0);
    const fx = (fit[2] - fit[0]) / (bx1 - bx0), fz = (fit[3] - fit[1]) / (bz1 - bz0), fy = fit[4] / bh, [sx, sy, sz] = f.s;
    let sc;
    if (S.wall) sc = A(fx / fy) * 2 + 0.3 * A(sy);
    else if (S.top) sc = A(fx / sx) + A(fz / sz) + 0.8 * A(sy) + 0.5 * A(sx / sy) + 0.5 * A(sz / sy);
    else if (S.seat) sc = 2 * A(sx) + A(fx / fz);
    else if (fit[4] < 0.05) sc = A(fx / fz) + 0.2 * A(fx);
    else sc = A(fx / fz) + A(fy / sy) + 0.5 * A(sx) + 0.3 * A(sx / sy);
    sc += look(e, WANT[t], AVOID[t]);
    if (!best || sc < best.sc) best = { e, sc };
  }
  return best;
}
const CHAIR = { dining_chair: [0.46, 0.52, 0.88], office_chair: [0.62, 0.62, 1.05], bar_stool: [0.45, 0.48, 1.0], armchair: [0.78, 0.8, 0.95] };
function pickChair(t, k) {
  const [w0, d0, h0] = CHAIR[k];
  let best = null;
  for (const e of ABO_LIB) {
    if (e.k !== k) continue;
    const d = CATALOG[e.t], w = d.rect[2] - d.rect[0], dd = d.rect[3] - d.rect[1];
    const sc = A(w / w0) + A(dd / d0) + A(d.h / h0) + look(e, WANT[t], AVOID[t]);
    if (!best || sc < best.sc) best = { e, sc };
  }
  return best;
}
const PICK = {}, lines = [];
for (const [t, S] of Object.entries(SPEC)) {
  if (!CATALOG[t]) { console.log('no such type', t); continue; }
  const m = S.k ? pickMain(t, S) : null, c = S.seats ? pickChair(t, S.seats) : null;
  if (m) used.add(m.e.id);
  if (c) used.add(c.e.id);
  if (S.k && !m) { console.log('no model for', t); continue; }
  PICK[t] = [m ? m.e.id : '', ...(c ? [c.e.id] : [])];
  lines.push(`  ${t}: [${PICK[t].map(x => `'${x}'`).join(', ')}],   // ${[m && m.e.name, c && c.e.name].filter(Boolean).join(' + ')}`);
}
console.log(lines.join('\n'));
if (!process.argv.includes('--dry')) {
  const f = path.join(ROOT, 'shared/abo-replace.js'), src = fs.readFileSync(f, 'utf8');
  const out = src.replace(/export const PICK = \{[\s\S]*?\n\};/, `export const PICK = {\n${lines.join('\n')}\n};`);
  fs.writeFileSync(f, out);
  console.log('PICK written:', Object.keys(PICK).length, 'types');
}
