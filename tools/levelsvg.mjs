// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Debug: render generated floor layouts to SVG (items, slots, walls, zones, nav grid, reachability).
// usage: node tools/levelsvg.mjs <outdir> [seed]
import fs from 'node:fs';
import path from 'node:path';
import { generateWorld } from '../server/world/generate.js';
import { CATALOG, FINISHES } from '../shared/catalog.js';
import { itemToLocal } from '../shared/geom.js';
import { buildGrid, flood, nearestFree } from '../shared/navgrid.js';
import { levelEntries } from '../shared/building.js';

const out = process.argv[2] || '/tmp/lv';
fs.mkdirSync(out, { recursive: true });
const w = generateWorld({ seed: process.argv[3] || 'next-city', population: 5000 });
const pick = [];
const want = [['office', 1], ['office', 0], ['hq', 1], ['hq', 9], ['hq', 0], ['apartment', 1], ['apartment', 0], ['cafe', 0], ['restaurant', 0], ['shop', 0], ['gym', 0], ['park', 0]];
for (const [t, f] of want) {
  const b = w.buildings.find(b => b.type === t && b.floors > f && (t !== 'apartment' || f > 0 || !b.mixed));
  if (b) pick.push([b, f]);
}
const S = 22;
for (const [b, f] of pick) {
  const L = w.levels[b.lv[f]];
  const W = b.w * S, H = b.d * S, ox = b.w / 2, oz = b.d / 2;
  const X = x => ((x + ox) * S).toFixed(1), Z = z => ((z + oz) * S).toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 40}" height="${H + 60}" viewBox="-20 -40 ${W + 40} ${H + 60}" font-family="sans-serif">`;
  s += `<rect x="-20" y="-40" width="${W + 40}" height="${H + 60}" fill="#fff"/>`;
  s += `<text x="0" y="-22" font-size="16">${b.type} ${b.name} f${f} ${L.name} ${b.w}x${b.d} items=${L.items.length}</text>`;
  s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#eee" stroke="#000" stroke-width="3"/>`;
  for (const z of L.zones) s += `<rect x="${X(z[0])}" y="${Z(z[1])}" width="${((z[2] - z[0]) * S).toFixed(1)}" height="${((z[3] - z[1]) * S).toFixed(1)}" fill="${FINISHES[z[4]]?.color || '#ccc'}" opacity="0.55"/>`;
  const g = buildGrid(b, L);
  const seeds = levelEntries(b, f).map(p => nearestFree(g, p.x, p.z, 3)).filter(c => c >= 0);
  const reach = flood(g, seeds);
  for (let j = 0; j < g.gh; j++) for (let i = 0; i < g.gw; i++) {
    const c = j * g.gw + i;
    const col = g.blocked[c] ? '#f004' : reach[c] ? '#0a02' : '#00f3';
    s += `<rect x="${X(g.x0 + i * g.cell)}" y="${Z(g.z0 + j * g.cell)}" width="${g.cell * S}" height="${g.cell * S}" fill="${col}"/>`;
  }
  for (const it of L.items) {
    const d = CATALOG[it.t];
    const c = Math.cos(it.r), sn = Math.sin(it.r);
    const pts = [[d.rect[0], d.rect[1]], [d.rect[2], d.rect[1]], [d.rect[2], d.rect[3]], [d.rect[0], d.rect[3]]].map(([x, z]) => [it.x + x * c + z * sn, it.z - x * sn + z * c]);
    s += `<polygon points="${pts.map(p => X(p[0]) + ',' + Z(p[1])).join(' ')}" fill="${it.c || '#999'}" fill-opacity="0.7" stroke="#222" stroke-width="1"/>`;
    // front marker
    const fp = itemToLocal(it, 0, d.rect[3]);
    s += `<circle cx="${X(fp.x)}" cy="${Z(fp.z)}" r="2" fill="#000"/>`;
    s += `<text x="${X(it.x)}" y="${Z(it.z)}" font-size="8" text-anchor="middle">${it.t}</text>`;
    for (const sl of d.slots) {
      const p = itemToLocal(it, sl.x, sl.z), a = itemToLocal(it, sl.ax ?? sl.x, sl.az ?? sl.z);
      const yaw = sl.yaw + it.r;
      s += `<line x1="${X(p.x)}" y1="${Z(p.z)}" x2="${X(p.x + Math.sin(yaw) * 0.35)}" y2="${Z(p.z + Math.cos(yaw) * 0.35)}" stroke="#d00" stroke-width="2"/>`;
      s += `<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="3" fill="#d00"/><circle cx="${X(a.x)}" cy="${Z(a.z)}" r="2.5" fill="#06f"/>`;
    }
  }
  for (const wl of L.walls) s += `<line x1="${X(wl[0])}" y1="${Z(wl[1])}" x2="${X(wl[2])}" y2="${Z(wl[3])}" stroke="${wl[4] ? '#39f' : '#333'}" stroke-width="${0.12 * S}"/>`;
  for (const p of levelEntries(b, f)) s += `<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="6" fill="none" stroke="#f0f" stroke-width="3"/>`;
  if (b.door) s += `<rect x="${X(b.door.x - b.door.w / 2)}" y="${Z(b.d / 2) - 4}" width="${b.door.w * S}" height="8" fill="#f80"/>`;
  s += '</svg>';
  fs.writeFileSync(path.join(out, `${b.type}-f${f}.svg`), s);
}
console.log('wrote', pick.length, 'to', out);
