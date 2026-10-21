// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents on post around the clock (2026-10-08: "assign agents to be permanent occupants of certain spots, like
// the reception desk … restaurants … 24/7"): its owner (or someone it is shared with to manage) posts it at a piece of
// furniture - the serving side of a reception desk, a counter or a checkout, a desk, a kitchen (population.js
// POST_USES) - and it stays there day and night: no sleep, meals or free time, its needs waiting
// (server/sim/agents.js postDuty), talking with whoever walks up as its Visitors choice says (server/agent-talk/).
// - Only where its owner could furnish: a building on a lot they hold or were given furnishing rights on, a flat they
//   own or rent, anywhere for a world administrator - the same rights as the furniture editor (lot-rights.js).
// - One agent to a spot; never another resident's desk or counter (their job's); a business may post many agents.
// - The post lives on the agent's resident (people, like its home and job): kept with the world, dropped by the world's
//   own checks when its furniture goes (validatePerson), and dropped here - its owner told - when its owner no longer
//   holds the place (a lot sold, a flat left), checked every few minutes.
import { CATALOG } from '../../shared/catalog.js';
import { POST_USES } from '../sim/population.js';

export class PostError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const CHECK_MS = 5 * 60000;

export class Posts {
  /**
   * @param {{ sim: () => object, world: () => object, agents: object, perms: object, property: object, rights: object,
   *   roleOf: (accountId: number) => string|null, save: (marks: object) => void, notify?: (accountId, m) => void, log?: object }} o
   */
  constructor({ sim, world, agents, perms, property, rights, roleOf, save, notify = null, log = null }) {
    Object.assign(this, { simOf: sim, worldOf: world, agents, perms, property, rights, roleOf, save, notify, log });
    this.timer = null;
  }
  attach() { this.timer = setInterval(() => this.check(), CHECK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); }

  // ---------------------------------------------------------------- who may post where
  /** The editor's actor for an account: { admin, subject } (as the furniture editor sees them). */
  actorOf(account) {
    if (!account) return null;
    const P = { account: { id: account.id }, role: account.role };
    return { admin: this.perms.allowed(P, 'world.edit'), subject: { kind: 'account', id: String(account.id) } };
  }
  actorFor(P) { return P.account ? this.actorOf({ id: P.account.id, role: P.role }) : null; }
  /** The flat (unit index) of level L holding item it, or -1. */
  unitOf(L, it) {
    const us = L?.units || [];
    for (let u = 0; u < us.length; u++) { const U = us[u]; if (U && it.x >= U.x0 && it.x <= U.x1 && it.z >= U.z0 && it.z <= U.z1) return u; }
    return -1;
  }
  /** Whether actor could furnish where item `id` stands on floor f of building b. */
  mayPost(actor, b, f, id) {
    if (!actor) return false;
    const W = this.worldOf(), B = W.buildings[b];
    if (!B || B.gone || f < 0 || f >= B.floors) return false;
    if (actor.admin) return true;
    if (!this.rights.check({ op: 'item.add', b }, actor)) return true;   // (furnishing rights on its lot)
    const L = W.levels[B.lv[f]], it = L?.items.find(x => x.id === id), u = it ? this.unitOf(L, it) : -1;
    if (u < 0) return false;
    const rec = W.flats?.[`${b}:${f}:${u}`], me = actor.subject?.id;
    return !!(rec && me && ((rec.owner?.kind === 'account' && String(rec.owner.id) === me) || rec.tenants?.some(t => t.kind === 'account' && String(t.id) === me)));
  }

  // ---------------------------------------------------------------- reading
  bodyOf(a) { try { return this.agents.resolver.resolveBody(a.bodyRef); } catch { return -1; } }
  /** Who is posted at or works at each slot, besides person `except`: "b:f:id:k" → { name, post }. */
  holders(except = -1) {
    const people = this.simOf()?.people || [], out = new Map();
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (i === except || !p || p.retired) continue;
      const j = p.job;
      if (j && (j.kind === 'office' || j.kind === 'vip' || j.kind === 'staff')) out.set(`${j.b}:${j.f}:${j.id}:${j.k}`, { name: p.name, post: false });
      if (p.post) out.set(`${p.post.b}:${p.post.f}:${p.post.id}:${p.post.k}`, { name: p.name, post: true });
    }
    return out;
  }
  floorName(B, f) { return B.floors === 1 ? '' : f === 0 ? 'ground floor' : `floor ${f + 1}`; }
  /** Where (b, f) is, in the words the city uses for what its people are doing there (a venue's name, else the building's). */
  place(b, f) {
    const named = this.simOf()?.brain?.placeName(b, f);
    if (named) return named;
    const B = this.worldOf().buildings[b]; if (!B) return 'somewhere';
    const fl = this.floorName(B, f); return `${B.name || 'a building'}${fl ? `, ${fl}` : ''}`;
  }
  /** Agent a's post: { b, f, item, slot, place, furniture, since } or null. */
  of(a) {
    const i = this.bodyOf(a), p = i >= 0 ? this.simOf()?.people[i] : null, r = p?.post;
    if (!r) return null;
    const B = this.worldOf().buildings[r.b], it = B ? this.worldOf().levels[B.lv[r.f]]?.items.find(x => x.id === r.id) : null;
    return { b: r.b, f: r.f, item: r.id, slot: r.k, place: this.place(r.b, r.f), furniture: it ? (CATALOG[it.t]?.name || it.t) : 'its spot', since: r.since || null };
  }
  /**
   * The spots its owner may post agent a at, by building and floor: the buildings on lots they hold or may furnish, the
   * flats they own or rent, and - when they may furnish there - the buildings where the agent works and lives.
   * [{ b, name, floors: [{ f, name, items: [{ id, t, name, slots: [{ k, use, holder }] }] }] }]
   */
  spots(P, a) {
    const actor = this.actorFor(P), W = this.worldOf(), sim = this.simOf();
    if (!actor || !sim) return [];
    const me = { kind: 'account', id: String(P.account.id) };
    const lots = new Set([...this.property.heldBy(me).map(l => l.id), ...this.property.sharedWith(me).filter(s => s.rights.includes('furnish')).map(s => s.id)]);
    const want = new Map();   // b → Set of floors (null: every floor) and, for flats, the units
    const add = (b, f = null, u = null) => {
      let w = want.get(b); if (!w) want.set(b, w = { all: false, floors: new Map() });
      if (f === null) w.all = true; else { let s = w.floors.get(f); if (!s) w.floors.set(f, s = new Set()); if (u !== null) s.add(u); else s.add('*'); }
    };
    for (const B of W.buildings) if (B && !B.gone && B.lot && lots.has(B.lot)) add(B.idx);
    for (const [key, rec] of Object.entries(W.flats || {})) {
      const mine = (rec?.owner?.kind === 'account' && String(rec.owner.id) === me.id) || rec?.tenants?.some(t => t.kind === 'account' && String(t.id) === me.id);
      if (!mine) continue;
      const [b, f, u] = key.split(':').map(Number);
      add(b, f, u);
    }
    const i = this.bodyOf(a), p = i >= 0 ? sim.people[i] : null;
    for (const r of [p?.job, p?.home, p?.post]) if (r && Number.isInteger(r.b) && (actor.admin || !this.rights.check({ op: 'item.add', b: r.b }, actor))) add(r.b);
    const out = [], held = this.holders(i);
    for (const [b, w] of want) {
      const B = W.buildings[b];
      if (!B || B.gone) continue;
      const floors = [];
      for (let f = 0; f < B.floors; f++) {
        const only = w.all ? null : w.floors.get(f);
        if (!w.all && !only) continue;
        const L = W.levels[B.lv[f]], items = [];
        for (const it of L?.items || []) {
          const def = CATALOG[it.t];
          if (!def?.slots?.length) continue;
          if (only && !only.has('*') && !only.has(this.unitOf(L, it))) continue;
          const e = sim.index.entry(b, f, it.id);
          const slots = (e?.slots || []).filter(s => POST_USES.has(s.use)).map(s => ({ k: s.k, use: s.use, holder: held.get(`${b}:${f}:${it.id}:${s.k}`) || null }));
          if (slots.length) items.push({ id: it.id, t: it.t, name: def.name || it.t, slots });
        }
        if (items.length) floors.push({ f, name: this.floorName(B, f) || 'its floor', items });
      }
      if (floors.length) out.push({ b, name: B.name || 'A building', floors });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  // ---------------------------------------------------------------- changing
  /** Posts agent a at slot k of item `item` on floor f of building b. */
  set(P, a, { b, f, item, slot }) {
    const sim = this.simOf(), i = this.bodyOf(a);
    if (!sim || i < 0 || !sim.people[i] || sim.people[i].retired) throw new PostError(409, 'no_body', `${a.name} has no body in the city`);
    [b, f, item, slot] = [b, f, item, slot].map(Number);
    if (![b, f, item, slot].every(Number.isInteger)) throw new PostError(400, 'bad_request', 'Choose a spot');
    const s = sim.index.entry(b, f, item)?.slots[slot];
    if (!s) throw new PostError(404, 'no_spot', 'That spot is no longer there');
    if (!POST_USES.has(s.use)) throw new PostError(400, 'not_a_post', 'An agent is posted where it serves or works: a reception desk, a counter, a checkout, a desk or a kitchen');
    if (!this.mayPost(this.actorFor(P), b, f, item)) throw new PostError(403, 'not_yours', 'You can post an agent only where you could furnish: a building on a lot you hold, or a flat you own or rent');
    const h = this.holders(i).get(`${b}:${f}:${item}:${slot}`);
    if (h) throw new PostError(409, 'taken', h.post ? `${h.name} is on post there already` : `That is ${h.name}'s place at work`);
    sim.setPost(i, { b, f, id: item, k: slot, since: Date.now() });
    this.save({ people: [i] });
    return this.of(a);
  }
  /** Lets agent a go back to its day. */
  leave(a) {
    const sim = this.simOf(), i = this.bodyOf(a);
    if (sim && i >= 0 && sim.people[i]?.post) { sim.setPost(i, null); this.save({ people: [i] }); }
    return null;
  }
  /** Every few minutes: a post its owner no longer holds the place of (a lot sold, a flat left) ends, its owner told. */
  check() {
    const sim = this.simOf();
    if (!sim) return;
    try {
      for (const a of this.agents.list()) {
        const i = this.bodyOf(a), r = i >= 0 ? sim.people[i]?.post : null;
        if (!r || a.ownerId == null) continue;
        const role = this.roleOf(a.ownerId);
        if (this.mayPost(role ? this.actorOf({ id: a.ownerId, role }) : null, r.b, r.f, r.id)) continue;
        const where = this.place(r.b, r.f);
        sim.setPost(i, null); this.save({ people: [i] });
        this.notify?.(a.ownerId, { t: 'mind', ev: 'note', agent: { id: a.id, name: a.name, emoji: a.emoji || '' }, text: `${a.name} left its post at ${where}: you no longer hold that place.` });
      }
    } catch (e) { this.log?.warn?.('[posts] check failed:', e.message); }
  }
}
