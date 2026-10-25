// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Property over HTTP (WP4.14, wp4-world-spec.md §5.0, §5.6): the lot map, a lot's details and title history, the
// caller's own lots, and the operations each kind of person may do — holders on their own lots (merge up to 4,
// split back, who may enter, shared rights), administrators on the public land (transfer, zoning, holds) — every one
// through server/property.js (one transaction, revision check, idempotency key, audit). Changes are announced to every
// browser ({ t: 'lots' }) so the map refreshes.
import { Property, PropertyError, MUNICIPALITY } from './property.js';
import { corners } from '../shared/geom.js';
import { mToUm, ftToUm } from '../shared/units.js';
import { Island } from '../shared/terrain.js';
import { makeGrid } from '../shared/city.js';
import { platAlongRoad, SIDES } from '../shared/plat-road.js';
import { isAdAsset } from '../shared/signs.js';
import { DEFAULT_ENVELOPES, DEFAULT_LOT_POLICY } from '../shared/lots.js';
import { MAIN_TOWN, townId } from '../shared/towns.js';
import { Towns } from './towns.js';

const toPoly = B => corners(B).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) }));   // the footprint in µm (turned ones stay turned)

/**
 * @param {object} router  the API router (server/routes.js)
 * @param {object} d       { dbs, audit, perms, world: () => world, broadcast, log, worldChanged, settings, policy? }
 * @returns {Property}
 */
export function addPropertyRoutes(router, d) {
  const property = new Property(d.dbs, { audit: d.audit, log: d.log, policy: d.policy || null });
  const towns = property.towns = new Towns({ property, world: d.world, settings: d.settings });
  const db = d.dbs.db, w = d.dbs.worldId;
  const nameQ = db.prepare('SELECT id, display_name, login FROM accounts WHERE world_id = ? AND id = ?');
  const loginQ = db.prepare('SELECT id, display_name FROM accounts WHERE world_id = ? AND login = ?');
  let version = 1, cache = null;
  const changed = ids => { version++; cache = null; d.broadcast({ t: 'lots', v: version, ids }); property.onChange?.(ids); };
  // a building placed, moved or taken down changes which lots are built on: the map's list follows
  property.buildingsChanged = () => changed([]);
  property.lotsChanged = ids => changed(Array.isArray(ids) ? ids : []);   // the shop: a lot sold, reserved or listed
  const ok = (json, status = 200) => ({ status, json });
  const fail = e => {
    if (e instanceof PropertyError) return ok({ error: e.message, code: e.code, ...(e.detail || {}) }, e.status);
    throw e;
  };
  const actorOf = P => ({
    subject: P.account ? { kind: 'account', id: String(P.account.id) } : null,
    admin: d.perms.allowed(P, 'property.admin'),
    account: P.account ? { id: P.account.id, login: P.account.login } : null,
  });
  const cityName = () => `City of ${d.world()?.name || 'the world'}`;
  /** A holder as the caller may see it: the city by name; accounts by display name to signed-in people. */
  const holderView = (h, P) => {
    if (!h) return null;
    if (h.kind === 'municipality') return { kind: h.kind, id: h.id, name: cityName() };
    if (h.kind === 'account') {
      if (!P.account) return { kind: h.kind, name: 'A resident' };
      const a = nameQ.get(w, Number(h.id));
      return { kind: h.kind, id: h.id, name: a ? a.display_name : 'A former account' };
    }
    return { kind: h.kind, id: h.id, name: h.kind === 'agent' ? 'An agent' : 'A business' };
  };
  const buildingsOn = id => (d.world()?.buildings || []).filter(b => b && !b.gone && b.lot === id);
  // the Marketing tools' billboards and street signs stand on public land or the city's own lots: a lot with one isn't
  // put up for sale or handed to a player until it is moved (Marketing)
  const adsOn = id => (d.world()?.decorations || []).filter(x => isAdAsset(x.t) && x.lot === id);
  const adsBlock = id => { const n = adsOn(id).length; return n ? ok({ error: `${n === 1 ? 'A billboard or street sign stands' : `${n} billboards or street signs stand`} on lot ${id}: move ${n === 1 ? 'it' : 'them'} first (Marketing)`, code: 'state' }, 409) : null; };
  const summary = (l, P) => ({
    id: l.id, block: l.block, poly: l.poly, lifecycle: l.lifecycle, zoning: l.zoning, access: l.access, origins: l.origins, name: l.name, note: l.note, town: l.region || MAIN_TOWN,
    sqft: Math.round(Number(l.areaTwice) / 2 / 92903040000), revision: l.revision, holder: holderView(l.holder, P),
    buildings: buildingsOn(l.id).map(b => b.idx), frontage: l.frontage.length ? l.frontage : undefined,
  });
  const body = ctx => ctx.body || {};
  const key = ctx => (typeof body(ctx).key === 'string' && body(ctx).key.length <= 100 ? body(ctx).key : null);
  const rev = v => (Number.isInteger(v) ? v : undefined);
  /** The town new lots join: the one most of the lots around them are in (a road of Claim Town platted further stays in
   *  Claim Town), else the world's own. */
  const townAround = lots => {
    const n = new Map();
    for (const l of lots || []) if (l && l.lifecycle !== 'retired') n.set(l.region || MAIN_TOWN, (n.get(l.region || MAIN_TOWN) || 0) + 1);
    let best = MAIN_TOWN, bn = 0;
    for (const [t, c] of n) if (c > bn) { best = t; bn = c; }
    return best;
  };

  // ------------------------------------------------------------------------------------------- reading
  router.add({ method: 'GET', path: '/api/property/lots', cap: 'world.view', handler: async ({ P }) => {
    // Lot shapes and states change rarely: one cached list per version for signed-in viewers and one for guests (the
    // browser marks its own lots by comparing holder ids).
    const who = P.account ? 'member' : 'guest';
    if (!cache || cache.version !== version) cache = { version };
    if (!cache[who]) cache[who] = { version, lots: property.all().map(l => summary(l, P)) };
    return ok(cache[who]);
  } });
  router.add({ method: 'GET', prefix: '/api/property/lot/', cap: 'world.view', handler: async ({ P, param }) => {
    const l = property.get(decodeURIComponent(param || ''));
    if (!l) return ok({ error: 'No such lot', code: 'not_found' }, 404);
    const me = actorOf(P), isHolder = l.holder && me.subject && l.holder.kind === me.subject.kind && l.holder.id === me.subject.id;
    const history = property.history(l.id).map(e => ({
      kind: e.kind, at: e.at, reason: e.reason,
      from: e.from_kind ? holderView({ kind: e.from_kind, id: e.from_id }, P) : null, to: e.to_kind ? holderView({ kind: e.to_kind, id: e.to_id }, P) : null,
      related: e.related, by: me.admin ? `${e.actor_kind}:${e.actor_id}` : undefined,
    }));
    return ok({ lot: { ...summary(l, P), parents: l.parents, children: l.children, retired: l.retired, created: l.created, frontage: l.frontage },
      history, delegations: isHolder || me.admin ? property.delegations(l.id).map(d => ({ ...d, who: holderView(d.subject, P) })) : undefined,
      can: { manage: property.can(me, l, 'manage'), merge: property.can(me, l, 'merge'), admin: me.admin } });
  } });
  router.add({ method: 'GET', path: '/api/property/mine', cap: 'property.hold', handler: async ({ P }) => {
    if (!P.account) return ok({ lots: [], shared: [] });
    const me = { kind: 'account', id: String(P.account.id) };
    return ok({ lots: property.heldBy(me).map(l => summary(l, P)), shared: property.sharedWith(me), homeBase: towns.homeBase(P.account.id) });
  } });
  router.add({ method: 'GET', path: '/api/property/check', cap: 'property.admin', handler: async () => ok({ problems: property.reconcile(), lots: property.count() }) });

  // ------------------------------------------------------------------------------------------- holders
  router.add({ method: 'POST', path: '/api/property/merge', cap: 'property.hold', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    if (!Array.isArray(b.ids) || b.ids.length < 2 || b.ids.length > 64) return ok({ error: 'Choose the lots to merge', code: 'input' }, 400);
    try {
      const r = property.merge(b.ids.map(String), { actor: actorOf(ctx.P), key: key(ctx), revisions: Array.isArray(b.revisions) ? b.revisions.map(rev) : null });
      relink(r.parents, r.id);
      changed([...r.parents, r.id]);
      return ok(r);
    } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/unmerge', cap: 'property.hold', lock: 'edit', handler: async ctx => {
    const b = body(ctx), id = String(b.id || '');
    try {
      const fps = buildingsOn(id).map(B => toPoly(B));
      const r = property.unmerge(id, { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision), footprints: fps });
      relinkSplit(r.from, r.ids);
      changed([r.from, ...r.ids]);
      return ok(r);
    } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/access', cap: 'property.hold', handler: async ctx => {
    const b = body(ctx);
    try { const r = property.setAccess(String(b.id || ''), String(b.access || ''), { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision) }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/info', cap: 'property.hold', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    try { const r = property.setInfo(String(b.id || ''), { name: b.name, note: b.note }, { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision) }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/delegate', cap: 'property.hold', lock: 'edit', handler: async ctx => {
    const b = body(ctx), to = loginQ.get(w, String(b.login || '').trim().toLowerCase());
    if (!to) return ok({ error: 'No account with that username', code: 'not_found' }, 404);
    try { const r = property.delegate(String(b.id || ''), { kind: 'account', id: String(to.id) }, Array.isArray(b.rights) ? b.rights : [], { actor: actorOf(ctx.P), key: key(ctx) }); changed([r.id]); return ok({ ...r, name: to.display_name }); } catch (e) { return fail(e); }
  } });

  // ------------------------------------------------------------------------------------------- administrators
  router.add({ method: 'POST', path: '/api/property/transfer', cap: 'property.admin', lock: 'edit', reauth: true, handler: async ctx => {
    const b = body(ctx);
    let to = null;
    if (b.to === 'city') to = MUNICIPALITY;
    else { const a = loginQ.get(w, String(b.login || '').trim().toLowerCase()); if (!a) return ok({ error: 'No account with that username', code: 'not_found' }, 404); to = { kind: 'account', id: String(a.id) }; }
    const reason = String(b.reason || '').trim().slice(0, 300);
    if (!reason) return ok({ error: 'Give a reason for the transfer (it is kept in the lot\'s history)', code: 'input' }, 400);
    if (to.kind !== 'municipality') { const no = adsBlock(String(b.id || '')); if (no) return no; }
    try { const r = property.transfer(String(b.id || ''), to, { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision), reason }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/zoning', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    try { const r = property.setZoning(String(b.id || ''), b.zoning, { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision) }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });
  for (const op of ['offer', 'withdraw']) router.add({ method: 'POST', path: `/api/property/${op}`, cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    if (op === 'offer') { const no = adsBlock(String(b.id || '')); if (no) return no; }
    try { const r = property.offer(String(b.id || ''), op === 'offer', { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision) }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });
  for (const op of ['hold', 'release']) router.add({ method: 'POST', path: `/api/property/${op}`, cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    try { const r = property[op](String(b.id || ''), { actor: actorOf(ctx.P), key: key(ctx), revision: rev(b.revision), reason: String(b.reason || '').trim().slice(0, 300) }); changed([r.id]); return ok(r); } catch (e) { return fail(e); }
  } });

  // Lots along a road beyond the city (WP4.14): administrators plat lots on the public land beside a road, standard
  // size unless they pick another; what fits is made (one transaction), what doesn't is counted by reason.
  router.add({ method: 'POST', path: '/api/property/plat-road', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx), W = d.world(), id = String(b.road || '');
    if (!W?.terrain || !(W.roads || []).length) return ok({ error: 'This world has no roads beyond the city', code: 'input' }, 400);
    const island = new Island(W.terrain, { roads: W.roads }), net = island.roads.net, rec = net.get(id);
    if (!rec) return ok({ error: 'No such road', code: 'not_found' }, 404);
    const ft = (v, dflt) => (Number.isFinite(+v) && +v > 0 ? +v : dflt);
    const width = ftToUm(ft(b.widthFt, DEFAULT_LOT_POLICY.standardLotW / 304800)) / 1e6, depth = ftToUm(ft(b.depthFt, DEFAULT_LOT_POLICY.standardLotD / 304800)) / 1e6;
    const zoning = Object.hasOwn(DEFAULT_ENVELOPES, b.zoning) ? b.zoning : 'residential';
    const G = net.geometry(id), pad = depth + 80, um = v => Math.round(v * 1e6), g = makeGrid(W.grid);
    const near = property.inBox({ x0: um(G.bbox.x0 - pad), z0: um(G.bbox.z0 - pad), x1: um(G.bbox.x1 + pad), z1: um(G.bbox.z1 + pad) });
    let res;
    try {
      const count = Number.isInteger(b.count) && b.count > 0 ? Math.min(b.count, 200) : null;
      res = platAlongRoad(net, id, { side: SIDES.includes(b.side) ? b.side : 'both', from: Number.isFinite(+b.from) ? +b.from : 0, to: Number.isFinite(+b.to) && b.to !== null ? +b.to : null,
        count, width, depth, isWater: (x, z) => !!island.waterAt(x, z), city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, lots: near,
        buildings: (W.buildings || []).filter(B => B && !B.gone), pads: island.roads.pads });
    } catch (e) { return ok({ error: e.message, code: 'input' }, 400); }
    if (!res.lots.length) return ok({ error: 'No lots fit beside that road', code: 'none', skipped: res.skipped }, 400);
    try {
      const r = property.plat(res.lots.map(l => ({ poly: l.poly, zoning, frontage: l.frontage, region: townAround(near) })), { actor: actorOf(ctx.P), key: key(ctx), reason: `Platted along ${rec.name || 'a road'}` });
      changed(r.ids);
      return ok({ ids: r.ids, skipped: res.skipped });
    } catch (e) { return fail(e); }
  } });
  // A grid's lots in one go (the grid layout tool, client/js/ui/roads.js; the product owner 2026-10-14: "provide an option to
  // place lots along with the roadway"): runs of lots along its roads — { road, side, from, to, count } — each the same
  // platting as above, all made together (one lot change), skipping what doesn't fit.
  router.add({ method: 'POST', path: '/api/property/plat-grid', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx), W = d.world(), runs = Array.isArray(b.runs) ? b.runs.slice(0, 600) : [];
    if (!W?.terrain || !(W.roads || []).length) return ok({ error: 'This world has no roads beyond the city', code: 'input' }, 400);
    if (!runs.length) return ok({ error: 'No lots asked for', code: 'input' }, 400);
    const width = +b.width, depth = +b.depth;
    if (!(width >= 5 && width <= 200 && depth >= 5 && depth <= 200)) return ok({ error: 'Lots must be 5 to 200 m wide and deep', code: 'input' }, 400);
    const zoning = Object.hasOwn(DEFAULT_ENVELOPES, b.zoning) ? b.zoning : 'residential';
    const island = new Island(W.terrain, { roads: W.roads }), net = island.roads.net, g = makeGrid(W.grid), um = v => Math.round(v * 1e6);
    const skipped = { water: 0, city: 0, road: 0, junction: 0, lot: 0, building: 0, shape: 0 }, made = [];
    let box = null;
    for (const r of runs) { const G = net.geometry(String(r?.road || '')); if (!G) return ok({ error: `No such road ${String(r?.road || '').slice(0, 48)}`, code: 'not_found' }, 404); const B = G.bbox; box = box ? { x0: Math.min(box.x0, B.x0), z0: Math.min(box.z0, B.z0), x1: Math.max(box.x1, B.x1), z1: Math.max(box.z1, B.z1) } : { ...B }; }
    const pad = depth + 80, near = property.inBox({ x0: um(box.x0 - pad), z0: um(box.z0 - pad), x1: um(box.x1 + pad), z1: um(box.z1 + pad) });
    const buildings = (W.buildings || []).filter(B => B && !B.gone), isWater = (x, z) => !!island.waterAt(x, z), city = { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ };
    try {
      for (const r of runs) {
        const count = Number.isInteger(r.count) && r.count > 0 ? Math.min(r.count, 200) : null;
        const res = platAlongRoad(net, String(r.road), { side: SIDES.includes(r.side) ? r.side : 'both', from: Number.isFinite(+r.from) ? +r.from : 0, to: Number.isFinite(+r.to) && r.to !== null ? +r.to : null,
          count, width, depth, isWater, city, lots: [...near, ...made], buildings, pads: island.roads.pads, feet: true, even: !!r.even });
        for (const k of Object.keys(skipped)) skipped[k] += res.skipped[k] || 0;
        made.push(...res.lots);
      }
    } catch (e) { return ok({ error: e.message, code: 'input' }, 400); }
    if (!made.length) return ok({ error: 'No lots fit in the grid', code: 'none', skipped }, 400);
    try {
      const r = property.plat(made.map(l => ({ poly: l.poly, zoning, frontage: l.frontage, region: townAround(near) })), { actor: actorOf(ctx.P), key: key(ctx), reason: `Platted a grid (${made.length} lots)` });
      changed(r.ids);
      return ok({ ids: r.ids, skipped });
    } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/retire', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx), ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    try { const r = property.retire(ids, { actor: actorOf(ctx.P), key: key(ctx), reason: String(b.reason || '').trim().slice(0, 300) || 'Retired', inUse: id => buildingsOn(id).length > 0 }); changed(r.ids); return ok(r); } catch (e) { return fail(e); }
  } });

  // Buildings follow their lot through merges and splits (a building's lot id is part of the world).
  function relink(from, to) {
    const W = d.world(); let n = 0;
    for (const B of W.buildings) if (B && from.includes(B.lot)) { B.lot = to; n++; }
    if (n && d.worldChanged) d.worldChanged();
  }
  function relinkSplit(from, ids) {
    const W = d.world(); let n = 0;
    const lots = ids.map(id => property.get(id));
    for (const B of W.buildings) {
      if (!B || B.lot !== from) continue;
      const fp = toPoly(B), home = lots.find(l => property.under(fp).some(u => u.lot.id === l.id && u.inside));
      B.lot = home ? home.id : ids[0]; n++;
    }
    if (n && d.worldChanged) d.worldChanged();
  }
  // ------------------------------------------------------------------------------------------- towns (shared/towns.js)
  // Everyone sees the towns; administrators put lots in a town (a new name makes a new one) and rename them; holders
  // choose which of their lots is their home base (where their agents live and work: server/towns.js).
  router.add({ method: 'GET', path: '/api/towns', cap: 'world.view', handler: async () => ok({ towns: towns.list(), main: MAIN_TOWN }) });
  router.add({ method: 'POST', path: '/api/property/town', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx), ids = Array.isArray(b.ids) ? b.ids.slice(0, 5000).map(String) : [];
    const t = townId(b.town, d.world()?.name);
    if (!t) return ok({ error: 'Give the town a name (up to 32 letters).', code: 'input' }, 400);
    try { const r = property.setTown(ids, t, { actor: actorOf(ctx.P), key: key(ctx) }); if (r.ids.length) changed(r.ids); return ok({ ...r, name: towns.name(r.town) }); } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/town-rename', cap: 'property.admin', lock: 'edit', handler: async ctx => {
    const b = body(ctx);
    try { const r = property.renameTown(String(b.from || ''), String(b.to || ''), { actor: actorOf(ctx.P), key: key(ctx) }); changed(r.ids); return ok({ ...r, name: towns.name(r.town) }); } catch (e) { return fail(e); }
  } });
  router.add({ method: 'POST', path: '/api/property/home-base', cap: 'property.hold', handler: async ctx => {
    const b = body(ctx), P = ctx.P;
    if (!P.account) return ok({ error: 'Sign in first', code: 'signin_required' }, 401);
    const id = b.lot == null || b.lot === '' ? '' : String(b.lot);
    if (id && !towns.held(P.account.id).some(l => l.id === id)) return ok({ error: 'Your home base must be a lot you hold.', code: 'not_yours' }, 403);
    d.settings.changeAccount(P, { 'property.homeBase': id }, { ip: ctx.ip });
    property.onChange?.([]);   // (its agents move to their new home town: server/index.mjs settleAgents)
    return ok({ homeBase: towns.homeBase(P.account.id) });
  } });
  return property;
}
