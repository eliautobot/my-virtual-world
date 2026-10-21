// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World management (WP4.10, PLAN WP4.10, wp4-world-spec.md §4.1, §9): Settings → Data for administrators.
// - Download a backup of the world: everything built and lived in — buildings and their floors, roads, the land and its
//   changes, the island chain, stations, decorations, residents — as one versioned JSON bundle. Lots are listed in it
//   for reference only: a backup never carries property claims back (titles are never rewound, spec §5.8).
// - Restore a backup of this world: the current world is backed up first; lots and titles stay exactly as they are.
// - Reset the residents: everyone but the agents' residents starts afresh (new people, homes and jobs given again).
// A restore or a reset puts the new data in place and restarts the server (a few seconds; browsers reconnect). Each
// needs the password again and is audited.
import { generatePopulation, reassign } from './sim/population.js';
import { WorldIndex } from './sim/windex.js';
import { RNG } from '../shared/rng.js';

export const BACKUP_FORMAT = 'mvw-next-world-backup';
const MAX_UPLOAD = 200 * 1024 * 1024;   // bytes: the largest backup a restore takes

/** The backup bundle of a world. lots: the property store's lots (listed for reference, never restored). */
export function backupBundle(world, people, lots = []) {
  return {
    format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), worldId: world.worldId || null, name: world.name || '',
    world, people,
    lotsForReference: lots.map(l => ({ id: l.id, zoning: l.zoning, lifecycle: l.lifecycle, holder: l.holder ? l.holder.kind : null, poly: l.poly })),
    note: 'A restore puts the world and its residents back. Lots and who holds them are never changed by a restore.',
  };
}
/** Why a bundle can't be restored into world `worldId`, or null. */
export function backupWhy(b, worldId) {
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) return 'That is not a world backup';
  if (b.version !== 1) return 'This backup comes from a newer version; update the server first';
  const w = b.world;
  if (!w || w.format !== 1 || !Array.isArray(w.buildings) || !Array.isArray(w.levels) || !w.grid) return 'The backup\'s world is damaged';
  if (!Array.isArray(b.people)) return 'The backup\'s residents are damaged';
  if (worldId && w.worldId && w.worldId !== worldId) return 'This backup is of another world; it can only be restored there';
  if (w.buildings.length > 20000 || b.people.length > 100000) return 'The backup is larger than a world can be';
  return null;
}
/** New residents for the world: the agents' residents stay (records, looks, homes given again), everyone else is new. */
export function freshPopulation(world, people, { population, seed = 'reset' } = {}) {
  const keep = people.filter(p => p && (p.vip || p.agentId) && !p.retired);
  const index = new WorldIndex(world);
  const target = Math.max(keep.length, Math.min(12000, Math.round(population ?? world.population ?? people.length)));
  const fresh = generatePopulation(world, index, { population: target - keep.length, roster: [] });
  const used = new Set(keep.map(p => p.id));
  let n = 0;
  for (const p of fresh) { while (used.has(p.id)) p.id = `r${people.length + n++}`; used.add(p.id); }
  for (const p of keep) { p.home = null; if (p.job && p.job.kind !== 'vip') p.job = { kind: 'free', title: 'Between jobs', seek: 1 }; }
  const out = [...keep, ...fresh];
  reassign(world, index, out, new RNG(`${seed}:${world.worldId || ''}`));
  return out;
}

/**
 * @param router the API router
 * @param d { world(), people(), lots(), worldId, audit, replace({ world?, people? }, why) → { backup }, readStream(req, limit) }
 */
export function addWorldAdminRoutes(router, d) {
  const audit = (P, action, detail) => d.audit?.log(action, { actor: P.account ? { id: P.account.id, login: P.account.login } : null, detail });
  router.add({ method: 'GET', path: '/api/world/backup', cap: 'world.backup', handler: async ({ P }) => {
    const W = d.world(), body = JSON.stringify(backupBundle(W, d.people(), d.lots()));
    audit(P, 'world.backup', { bytes: body.length, buildings: W.buildings.length, people: d.people().length });
    const day = new Date().toISOString().slice(0, 10), name = String(W.name || 'world').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40);
    return { status: 200, pre: { body }, headers: { 'content-disposition': `attachment; filename="${name}-backup-${day}.json"` } };
  } });
  router.add({ method: 'POST', path: '/api/world/restore', cap: 'world.manage', lock: 'edit', raw: true, reauth: true, csrf: true, handler: async ({ P, req }) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return { status: 415, json: { error: 'Send the backup as JSON', code: 'unsupported_media_type' } };
    let b;
    try { b = JSON.parse((await d.readStream(req, MAX_UPLOAD)).toString('utf8')); } catch (e) { return { status: e.status || 400, json: { error: e.status === 413 ? 'The backup is too large' : 'That file could not be read', code: 'bad_backup' } }; }
    const why = backupWhy(b, d.worldId);
    if (why) return { status: 400, json: { error: why, code: 'bad_backup' } };
    const world = { ...b.world, worldId: d.worldId, version: (d.world().version || 1) + 1, restoredAt: Date.now() };
    audit(P, 'world.restore', { from: b.exportedAt, buildings: world.buildings.length, people: b.people.length });
    const r = d.replace({ world, people: b.people }, 'restore');
    return { status: 200, json: { ok: true, restarting: true, backup: r.backup } };
  } });
  router.add({ method: 'POST', path: '/api/world/reset-population', cap: 'world.manage', reauth: true, csrf: true, handler: async ({ P, body }) => {
    const W = d.world(), n = Number.isFinite(+body.population) ? +body.population : null;
    if (n !== null && (n < 0 || n > 12000)) return { status: 400, json: { error: 'Between 0 and 12,000 residents', code: 'input' } };
    const people = freshPopulation(W, d.people(), { population: n ?? undefined, seed: `reset:${Date.now()}` });
    audit(P, 'world.reset_population', { before: d.people().length, after: people.length });
    const r = d.replace({ people }, 'reset-population');
    return { status: 200, json: { ok: true, restarting: true, people: people.length, backup: r.backup } };
  } });
}
