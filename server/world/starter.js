// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The starting map: the city a new installation opens with (server/world/starter-map.json.gz) - its land, roads, lots,
// buildings and their floors, metro stations, parks, the airport, the marina and the lake docks, built by hand in the
// editor. It holds no residents (a new world's residents follow its homes: server/sim/housing.js), no accounts, no
// agents and no money. MVW_STARTER_MAP=off generates a city instead (server/world/generate.js), as the tests do.
// Made from a running installation's data folder with `node tools/starter-map.mjs export <data folder>`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const STARTER_FORMAT = 'mvw-starter-map';
export const STARTER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'starter-map.json.gz');

/** The starting map's bundle from a world and its lots (the live ones): no world id, no residents, no owners. */
export function starterBundle(world, lots, { name = null } = {}) {
  const w = structuredClone(world);
  delete w.worldId;
  w.created = null; w.population = null;
  if (name) w.name = String(name).slice(0, 60);
  const live = lots.filter(l => l && l.lifecycle !== 'retired').map(l => ({
    id: l.id, region: l.region || 'main', block: Number.isInteger(l.block) ? l.block : null, poly: l.poly, zoning: l.zoning || 'mixed',
    frontage: l.frontage || null, access: l.access || 'public', name: l.name || null, note: l.note || null,
  }));
  return { format: STARTER_FORMAT, version: 1, name: w.name || '', exportedAt: new Date().toISOString(), world: w, lots: live };
}

/** Why a bundle can't be a starting map, or null. */
export function starterWhy(b) {
  if (!b || typeof b !== 'object' || b.format !== STARTER_FORMAT) return 'not a starting map';
  if (b.version !== 1) return 'a starting map from a newer version';
  const w = b.world;
  if (!w || w.format !== 1 || !Array.isArray(w.buildings) || !Array.isArray(w.levels) || !w.grid || !w.terrain) return 'its world is damaged';
  if (!Array.isArray(b.lots)) return 'its lots are damaged';
  const ids = new Set(b.lots.map(l => l.id));
  for (const B of w.buildings) if (B && !B.gone && B.lot && !ids.has(B.lot)) return `building ${B.idx} stands on lot ${B.lot}, which it does not have`;
  return null;
}

/** The starting map ({ world, lots, name }), or null when there is none or it can't be read (`log` says why). */
export function readStarter(file = STARTER_FILE, log = null) {
  let b;
  try { b = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
  catch (e) { if (e.code !== 'ENOENT') log?.warn?.(`[boot] the starting map ${path.basename(file)} cannot be read: ${e.message}`); return null; }
  const why = starterWhy(b);
  if (why) { log?.warn?.(`[boot] the starting map ${path.basename(file)} is ${why}: generating a city instead`); return null; }
  return { world: b.world, lots: b.lots, name: b.name };
}

/** Writes a starting map (gzip). */
export function writeStarter(bundle, file = STARTER_FILE) {
  const why = starterWhy(bundle);
  if (why) throw new Error(`not written: ${why}`);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }));
  return file;
}
