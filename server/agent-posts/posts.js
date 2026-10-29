// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents on post around the clock (2026-10-08: "assign agents to be permanent occupants of certain spots, like
// the reception desk … restaurants … 24/7"): its owner (or someone it is shared with to manage) posts it at a piece of
// furniture — the serving side of a reception desk, a counter or a checkout, a desk, a kitchen (population.js
// POST_USES) — and it stays there day and night: no sleep, meals or free time, its needs waiting
// (server/sim/agents.js postDuty), talking with whoever walks up as its Visitors choice says (server/agent-talk/).
// - Only on its owner's own property (2026-10-23: "only the account owner can have the access ... for their
//   building/property, for their agents, for their account...even admins. that way none one can accidently assign an
//   agent to someone elses property"): a building on a lot their account holds, or a flat their account owns — not
//   for a world administrator elsewhere, not on a lot they were only given rights on, not in a flat they rent. A world
//   without lots: its owner's.
// - One agent to a spot; never another resident's desk or counter (their job's); a business may post many agents.
// - The post lives on the agent's resident (people, like its home and job): kept with the world, dropped by the world's
//   own checks when its furniture goes (validatePerson), and dropped here — its owner told — when its owner no longer
//   holds the place (a lot sold, a flat left), checked every few minutes.
import { CATALOG, isServiceDesk } from '../../shared/catalog.js';
import { MUNICIPALITY } from '../property.js';
import { POST_USES, SHIFTS, daysMask, schedule } from '../sim/population.js';
import { RNG } from '../../shared/rng.js';
import { checkHours, overlaps, onHours } from '../../shared/shifts.js';

/** A kitchen's pass (Order Up): its cook is posted there (2026-10-28: agents cook Rushes on their shifts, server/play/kitchen-shifts.js). */
const isKitchenPass = t => t === 'ou_pass';
export class PostError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const CHECK_MS = 5 * 60000;

export class Posts {
  /**
   * @param {{ sim: () => object, world: () => object, agents: object, perms: object, property: object, rights: object,
   *   roleOf: (accountId: number) => string|null, save: (marks: object) => void, notify?: (accountId, m) => void, log?: object }} o
   */
  constructor({ sim, world, agents, perms, property, rights, roleOf, save, notify = null, log = null, moved = null, pay = null }) {
    Object.assign(this, { simOf: sim, worldOf: world, agents, perms, property, rights, roleOf, save, notify, log, moved, pay });
    this.timer = null;
    this.known = new Map();   // agent id → the post it had at the last look (a post that ends by itself: its owner told)
  }
  attach() {
    this.timer = setInterval(() => this.check(), CHECK_MS); this.timer.unref?.();
    setTimeout(() => this.check(), 15000).unref?.();   // (soon after start: the posts as they are, a job left beside one dropped)
    return this;
  }
  stop() { clearInterval(this.timer); }

  // ---------------------------------------------------------------- who may post where
  /** Who an account is here: { subject, owner (the world's owner) }. */
  actorOf(account) {
    if (!account) return null;
    return { owner: account.role === 'owner', admin: account.role === 'owner' || account.role === 'admin', subject: { kind: 'account', id: String(account.id) } };
  }
  actorFor(P) { return P.account ? this.actorOf({ id: P.account.id, role: P.role }) : null; }
  /** The flat (unit index) of level L holding item it, or -1. */
  unitOf(L, it) {
    const us = L?.units || [];
    for (let u = 0; u < us.length; u++) { const U = us[u]; if (U && it.x >= U.x0 && it.x <= U.x1 && it.z >= U.z0 && it.z <= U.z1) return u; }
    return -1;
  }
  /** Whether building b stands on a lot actor's account holds (the city's, or anyone else's: no). */
  holds(actor, B) {
    const lot = B?.lot ? this.property.get(B.lot) : null, me = actor?.subject;
    return !!(lot && me && lot.lifecycle !== 'retired' && lot.lifecycle !== 'custodial' && lot.holder && lot.holder.kind !== MUNICIPALITY.kind
      && lot.holder.kind === me.kind && String(lot.holder.id) === String(me.id));
  }
  /** Whether item `id` on floor f of building b is on actor's own property: a building on a lot their account holds, a
   *  flat their account owns; a world without lots, its owner's. */
  mayPost(actor, b, f, id) {
    if (!actor?.subject) return false;
    const W = this.worldOf(), B = W.buildings[b];
    if (!B || B.gone || f < 0 || f >= B.floors) return false;
    if (!this.rights.active) return !!actor.owner;
    if (this.holds(actor, B)) return true;
    // a world module's own building (a Radio Station's studio, an airport's terminal, a dock's store) is the world's, on
    // no lot: its administrators post their agents there (2026-10-27, the product owner: a studio's hosts are "admin
    // assigned AI agents, the same way we can already place an agent on a post")
    if (B.module && actor.admin) return true;
    const L = W.levels[B.lv[f]], it = L?.items.find(x => x.id === id), u = it ? this.unitOf(L, it) : -1;
    if (u < 0) return false;
    const rec = W.flats?.[`${b}:${f}:${u}`];
    return !!(rec?.owner?.kind === 'account' && String(rec.owner.id) === actor.subject.id);
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
    return { b: r.b, f: r.f, item: r.id, slot: r.k, place: this.place(r.b, r.f), furniture: it ? (CATALOG[it.t]?.name || it.t) : 'its spot', since: r.since || null, pay: this.payOf(r.b, r.f, r.id, r.k),
      unpaid: p.unpaid ? { days: p.unpaid.days, name: p.unpaid.name || '' } : null };   // (days its employer could not pay it: economy/households.js agentPay)
  }
  /**
   * The spots its owner may post agent a at, by building and floor: on their own property (mayPost) — the buildings on
   * lots their account holds, the flats it owns; a world without lots, its owner's: where the agent works and lives.
   * [{ b, name, floors: [{ f, name, items: [{ id, t, name, slots: [{ k, use, holder }] }] }] }]
   */
  spots(P, a) {
    const actor = this.actorFor(P), W = this.worldOf(), sim = this.simOf();
    if (!actor || !sim) return [];
    const me = actor.subject, want = new Set();   // the buildings to look in (each piece then checked: mayPost)
    if (this.rights.active) {
      for (const l of this.property.heldBy(me)) for (const B of W.buildings) if (B && !B.gone && B.lot === l.id) want.add(B.idx);
      for (const [key, rec] of Object.entries(W.flats || {})) if (rec?.owner?.kind === 'account' && String(rec.owner.id) === me.id) want.add(Number(key.split(':')[0]));
      if (actor.admin) for (const B of W.buildings) if (B && !B.gone && B.module) want.add(B.idx);   // (the world modules' buildings: mayPost)
    }
    const i = this.bodyOf(a), p = i >= 0 ? sim.people[i] : null;
    if (!this.rights.active && actor.owner) for (const r of [p?.job, p?.home, p?.post]) if (r && Number.isInteger(r.b)) want.add(r.b);
    const out = [], held = this.holders(i);
    for (const b of want) {
      const B = W.buildings[b];
      if (!B || B.gone) continue;
      const floors = [];
      for (let f = 0; f < B.floors; f++) {
        const L = W.levels[B.lv[f]], items = [];
        for (const it of L?.items || []) {
          const def = CATALOG[it.t];
          if (!def?.slots?.length || !this.mayPost(actor, b, f, it.id)) continue;
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
    if (!this.mayPost(this.actorFor(P), b, f, item)) throw new PostError(403, 'not_yours', 'You can post your agents only on your own property: a building on a lot your account holds, or a flat it owns');
    const h = this.holders(i).get(`${b}:${f}:${item}:${slot}`);
    if (h) throw new PostError(409, 'taken', h.post ? `${h.name} is on post there already` : `That is ${h.name}'s place at work`);
    sim.setPost(i, { b, f, id: item, k: slot, since: Date.now() });   // (its job record becomes its post's: sim.js setPost)
    this.known.set(a.id, { b, f, id: item, k: slot });
    this.save({ people: [i] });
    return this.of(a);
  }
  // ---------------------------------------------------------------- right at the furniture (2026-10-23)
  // "assign an agent to a post just by clicking on the actual item ... the Cashier/counters and also Reception desks":
  // the piece's own ⋯ menu (client/js/ui/post-menu.js). Its owner's own agents only (routes.js); the agent is there at
  // once, not walking; a resident working there makes way (it looks for work elsewhere), and an agent of theirs already
  // there is switched: it walks off to its day.
  /** Body index → agent, for the agents with a body. */
  byBody() { const m = new Map(); for (const a of this.agents.list()) { const i = this.bodyOf(a); if (i >= 0) m.set(i, a); } return m; }
  /** Who is at each serving spot of item `id` on floor f of building b: k → { j (their resident), name, post, agent }. */
  servingAt(b, f, id, o = {}) {
    const all = this.seatsAt(b, f, id), out = new Map(), now = o.onDuty ? this.clockNow() : null;
    for (const [k, list] of all) {
      // the one on post (24/7); else, of those sharing the seat by their hours (2026-10-28), the one on duty now (onDuty:
      // nobody when none is: a radio studio's host off shift is off the air) or, not asked, the first
      const h = list.find(x => x.post) || (now ? list.find(x => onHours(x.hours, now.h, now.day)) : list[0]);
      if (h) out.set(k, h);
    }
    return out;
  }
  /** Everyone at each serving spot of item `id`: k → [{ j, name, post, agent, hours: { start, end, days } | { all } }]
   *  (several of an owner's own agents may share one by their hours: work below). */
  seatsAt(b, f, id) {
    const people = this.simOf()?.people || [], out = new Map();
    let byBody = null;
    for (let j = 0; j < people.length; j++) {
      const p = people[j];
      if (!p || p.retired) continue;
      for (const [r, post] of [[p.job, false], [p.post, true]]) {
        if (!r || r.b !== b || r.f !== f || r.id !== id || (!post && !(r.kind === 'office' || r.kind === 'vip' || r.kind === 'staff'))) continue;
        const a = (byBody ||= this.byBody()).get(j) || null;
        const list = out.get(r.k) || []; out.set(r.k, list);
        list.push({ j, name: a?.name || p.name, post, agent: a, hours: post ? { all: true } : { start: r.start, end: r.end, days: r.days ?? 31 } });
      }
    }
    return out;
  }
  /** The world's hour and day now. */
  clockNow() { const sim = this.simOf(), t = sim.now(); return { h: sim.brain.hour(t), day: sim.brain.day(t) }; }
  /** Agent a's post ended by its owner's doing (let go, switched, its work changed, it quit): no notice of a post that
   *  vanished. (Its plans wait while it is on post and are open again now: server/agent-life/ intentions.) */
  ended(a) { this.known.delete(a.id); }
  /** Agent i on post: its job record is its post's (server/sim/sim.js postJob; "their assigned post is their job"),
   *  whatever it had before — another job, none (posted before 2026-10-28), an old title; → whether it changed. */
  syncJob(i) {
    const sim = this.simOf(), p = sim.people[i];
    if (!p?.post) return false;
    const want = sim.postJob(p, p.post), j = p.job || {};
    if (j.kind === 'post' && j.b === want.b && j.f === want.f && j.id === want.id && j.k === want.k && j.title === want.title) return false;
    p.job = want;
    return true;
  }
  /** Who at seat `list` makes way for agent i coming to work `hours` there ({ all } for 24/7), for P: an agent of P's
   *  own whose hours meet these (on post: back to its day; working its shifts: it finds work again), a resident (it looks
   *  for work elsewhere); one of P's whose hours don't meet stays (they share the seat). Another account's agent: never
   *  (the seat isn't offered). → the people moved. */
  makeWay(P, list, i, hours) {
    const sim = this.simOf(), moved = [];
    for (const h of list) {
      if (h.j === i) continue;
      if (h.agent && !this.agents.isOwner(P, h.agent)) continue;
      if (h.agent && !overlaps(h.hours, hours)) continue;
      if (h.post) { sim.setPost(h.j, null); if (h.agent) this.ended(h.agent); }
      else if (h.agent) { const q = sim.people[h.j]; q.job = { kind: 'free', title: q.role || 'Agent', seek: 1, prev: 'vip' }; sim.setJob(h.j); this.moved?.(); }
      else { moved.push(...sim.leaveWork(h.j)); continue; }
      moved.push(h.j);
    }
    return moved;
  }
  /** Whether seat `list` may take agent i for `hours`, for P: nobody else there, or only residents (they make way) and
   *  P's own agents (those whose hours meet these make way too). Another account's agent there: no. */
  seatFree(P, list, i, hours, { take = true } = {}) {
    if (!list || !list.length) return true;
    return list.every(h => h.j === i || (h.agent ? this.agents.isOwner(P, h.agent) && (take || !overlaps(h.hours, hours)) : take && !h.post));
  }
  /**
   * The counters, checkouts and reception desks on floor f of building b where P may post an agent, and who is at each
   * serving spot: { items: [{ id, t, name, slots: [{ k, holder: { name, post, agent: { id?, name, emoji, mine } | null } | null }] }] }.
   * Nothing off P's own property (there they see no one's posts).
   */
  floor(P, b, f) {
    const actor = this.actorFor(P), W = this.worldOf(), sim = this.simOf();
    const B = Number.isInteger(b) ? W.buildings[b] : null;
    if (!actor || !sim || !B || B.gone || !Number.isInteger(f) || f < 0 || f >= B.floors) return { items: [] };
    const items = [];
    for (const it of W.levels[B.lv[f]]?.items || []) {
      const service = isServiceDesk(it.t), desk = !service && !!CATALOG[it.t]?.slots?.some(s => s.use === 'work'), cook = isKitchenPass(it.t);
      if ((!service && !desk && !cook) || !this.mayPost(actor, b, f, it.id)) continue;
      const e = sim.index.entry(b, f, it.id); if (!e) continue;
      const at = this.servingAt(b, f, it.id), seats = this.seatsAt(b, f, it.id), slots = [], use = service ? 'staff' : cook ? 'cook' : 'work';
      const who = h => { const a = h.agent, mine = !!(a && this.agents.isOwner(P, a)); return { name: h.name, post: h.post, agent: a ? { ...(mine ? { id: a.id } : {}), name: a.name, emoji: a.emoji || '', mine } : null }; };
      e.slots.forEach((s, k) => {
        if (s.use !== use) return;
        const h = at.get(k);
        // (everyone there and their hours: several of its owner's agents may share it by their hours — 2026-10-28)
        slots.push({ k, holder: h ? who(h) : null, holders: (seats.get(k) || []).map(x => ({ ...who(x), ...(x.post ? { all: true } : { start: x.hours.start, end: x.hours.end, days: x.hours.days }) })), pay: this.payOf(b, f, it.id, k) });
      });
      if (slots.length) items.push({ id: it.id, t: it.t, name: CATALOG[it.t]?.name || it.t, kind: service ? 'service' : 'desk', slots, ...(CATALOG[it.t]?.seatPosts ? { seats: true } : {}) });
    }
    return { items };
  }
  /** The seat asked for (a piece whose seats are each a post of their own: CATALOG seatPosts, e.g. a radio studio's
   *  broadcast desk, its ⋯ over each seat), or undefined (none asked: the first free one, as before). Another account's
   *  agent there is never moved. */
  seatOf(P, ks, at, seat) {
    if (seat === undefined || seat === null || seat === '') return undefined;
    const k = Number(seat);
    if (!ks.includes(k)) throw new PostError(400, 'bad_seat', 'There is no such seat here');
    const h = at.get(k);
    if (h?.agent && !this.agents.isOwner(P, h.agent)) throw new PostError(409, 'taken', `${h.name} has that seat`);
    return k;
  }
  /** Posts agent a at counter, checkout or reception desk `item` on floor f of building b, there at once:
   *  → { post, replaced: { name, post } | null } (who made way for it). */
  here(P, a, { b, f, item, slot }) {
    const sim = this.simOf(), i = this.bodyOf(a);
    if (!sim || i < 0 || !sim.people[i] || sim.people[i].retired) throw new PostError(409, 'no_body', `${a.name} has no body in the city`);
    [b, f, item] = [b, f, item].map(Number);
    if (![b, f, item].every(Number.isInteger)) throw new PostError(400, 'bad_request', 'Choose a counter or a desk');
    const W = this.worldOf(), B = W.buildings[b], it = B && !B.gone && f >= 0 && f < B.floors ? W.levels[B.lv[f]]?.items.find(x => x.id === item) : null;
    const e = it ? sim.index.entry(b, f, item) : null;
    if (!e) throw new PostError(404, 'no_spot', 'That piece is no longer there');
    if (!isServiceDesk(it.t) && !isKitchenPass(it.t)) throw new PostError(400, 'not_a_post', 'An agent is put on post here at a counter, a checkout, a reception desk or a kitchen\'s pass');
    if (!this.mayPost(this.actorFor(P), b, f, item)) throw new PostError(403, 'not_yours', 'You can post your agents only on your own property: a building on a lot your account holds, or a flat it owns');
    const use = isKitchenPass(it.t) ? 'cook' : 'staff';   // (a kitchen's pass: its cook)
    const ks = e.slots.map((s, k) => (s.use === use ? k : -1)).filter(k => k >= 0), at = this.servingAt(b, f, item), seats = this.seatsAt(b, f, item), ALL = { all: true };
    // its own spot here already; else a free one; else a resident's place at work; else one of its owner's own (switched)
    const mineThere = k => (seats.get(k) || []).every(h => h.j === i || (h.agent && this.agents.isOwner(P, h.agent)));
    const k = this.seatOf(P, ks, at, slot) ?? ks.find(x => (seats.get(x) || []).some(h => h.j === i && h.post)) ?? ks.find(x => !seats.has(x))
      ?? ks.find(x => (seats.get(x) || []).every(h => !h.post && !h.agent)) ?? ks.find(mineThere);
    if (k === undefined) { const h = at.get(ks[0]); throw new PostError(409, 'taken', h ? `${h.name} is on post there already` : 'There is no serving side here'); }
    const list = seats.get(k) || [], mover = list.find(h => h.j !== i) || null, post = { b, f, id: item, k, since: Date.now() };
    sim.people[i].post = post;   // (held from now on: the re-hiring below hires no one here)
    sim.people[i].job = sim.postJob(sim.people[i], post);   // its post is its job (setPost below writes the same)
    const moved = this.makeWay(P, list, i, ALL);   // (on duty around the clock: everyone else at that seat makes way)
    sim.setPost(i, post, { now: true });
    this.known.set(a.id, { b, f, id: item, k });
    this.save({ people: [i, ...moved] });
    return { post: this.of(a), replaced: mover ? { name: mover.name, post: !!mover.post } : null };
  }
  /** Agent a's work: { b, f, item, place, furniture, start, end, chosen (its owner gave it this desk or counter) } or null. */
  workOf(a) {
    const i = this.bodyOf(a), j = i >= 0 ? this.simOf()?.people[i]?.job : null;
    if (!j || j.b === undefined || j.id === undefined || j.kind === 'post') return null;   // (on post 24/7: its post, of())
    const B = this.worldOf().buildings[j.b], it = B ? this.worldOf().levels[B.lv[j.f]]?.items.find(x => x.id === j.id) : null;
    const p = this.simOf().people[i];
    return { b: j.b, f: j.f, item: j.id, place: this.place(j.b, j.f), furniture: it ? (CATALOG[it.t]?.name || it.t) : 'its spot', start: j.start, end: j.end, days: j.days ?? 31, pay: this.payOf(j.b, j.f, j.id, j.k), chosen: !!j.pin, by: j.pin ? 'owner' : j.by || 'rules', title: j.title || '',
      unpaid: p.unpaid ? { days: p.unpaid.days, name: p.unpaid.name || '' } : null };   // (days its employer could not pay it: economy/households.js agentPay)
  }
  /**
   * Gives agent a its work at desk or counter `item` on floor f of building b (2026-10-23: "setting a desk assigned to an
   * agent (So the agent has a place of work)"; "Works here (shifts)"): its own property only, its own agents only
   * (routes.js), kept there (pin) until its owner lets it choose again; on shift now, it is there at once. A resident
   * working there makes way; another agent of theirs working there looks for work again (index.mjs settle); an agent on
   * post there, of theirs, goes back to its day. Its own post, if it had one, ends: it works shifts now.
   * → { work, replaced: { name, post } | null }.
   */
  work(P, a, { b, f, item, slot, start, end, days }) {
    const sim = this.simOf(), i = this.bodyOf(a);
    if (!sim || i < 0 || !sim.people[i] || sim.people[i].retired) throw new PostError(409, 'no_body', `${a.name} has no body in the city`);
    [b, f, item] = [b, f, item].map(Number);
    if (![b, f, item].every(Number.isInteger)) throw new PostError(400, 'bad_request', 'Choose a desk or a counter');
    // its hours, when its owner chose them (2026-10-28: "give posts job hours"); none: the place's usual shifts, as before
    const chosen = start !== undefined && start !== null && start !== '' ? checkHours(start, end, days ?? 127) : null;
    if (chosen instanceof Error) throw new PostError(400, 'bad_hours', chosen.message);
    const W = this.worldOf(), B = W.buildings[b], it = B && !B.gone && f >= 0 && f < B.floors ? W.levels[B.lv[f]]?.items.find(x => x.id === item) : null;
    const e = it ? sim.index.entry(b, f, item) : null;
    if (!e) throw new PostError(404, 'no_spot', 'That piece is no longer there');
    const use = isServiceDesk(it.t) ? 'staff' : e.slots.some(s => s.use === 'work') ? 'work' : isKitchenPass(it.t) && e.slots.some(s => s.use === 'cook') ? 'cook' : null;   // (a kitchen's pass: its cook, 2026-10-28)
    if (!use) throw new PostError(400, 'not_a_job', 'An agent works at a desk, a counter, a checkout, a reception desk or a kitchen\'s pass');
    if (!this.mayPost(this.actorFor(P), b, f, item)) throw new PostError(403, 'not_yours', 'You can give your agents work only on your own property: a building on a lot your account holds, or a flat it owns');
    const p = sim.people[i], rng = new RNG(`work:${p.id}:${Date.now()}`);
    const L = W.levels[B.lv[f]], venue = L?.venue && SHIFTS[L.venue] ? L.venue : 'lobby', role = p.role || 'Agent';
    const where = use === 'staff' && venue !== 'lobby' ? (L.name || B.name) : B.name;
    let hrs;
    if (chosen) hrs = chosen;
    else if (use === 'staff' || use === 'cook') { const sh = rng.pick(SHIFTS[venue] || SHIFTS.lobby); hrs = { start: sh[0], end: sh[1], days: daysMask(rng, 'staff') }; }
    else { const st = Math.round(rng.float(8, 9.5) * 100) / 100; hrs = { start: st, end: Math.round((st + rng.float(9, 10.5)) * 100) / 100, days: 0b0011111 }; }
    const ks = e.slots.map((s, k) => (s.use === use ? k : -1)).filter(k => k >= 0), at = this.servingAt(b, f, item), seats = this.seatsAt(b, f, item);
    // its own seat here; else a free one; else one it can share by the hours (only its owner's own agents there, at other
    // hours); else a resident's place at work; else one of its owner's own (those whose hours meet these make way)
    const S = x => seats.get(x) || [];
    const k = this.seatOf(P, ks, at, slot) ?? ks.find(x => S(x).some(h => h.j === i)) ?? ks.find(x => !S(x).length)
      ?? ks.find(x => this.seatFree(P, S(x), i, hrs, { take: false })) ?? ks.find(x => S(x).every(h => !h.post && !h.agent)) ?? ks.find(x => this.seatFree(P, S(x), i, hrs));
    if (k === undefined) { const h = at.get(ks[0]); throw new PostError(409, 'taken', h ? `${h.name} works here already` : 'There is no place to work here'); }
    if (!this.seatFree(P, S(k), i, hrs)) { const h = S(k).find(x => x.agent && !this.agents.isOwner(P, x.agent)); throw new PostError(409, 'taken', `${h?.name || 'Someone'} has that seat`); }
    const list = S(k), mover = list.find(h => h.j !== i && (!h.agent || overlaps(h.hours, hrs))) || null;
    const job = use === 'staff' || use === 'cook' ? { kind: 'staff', b, f, id: item, k, ...hrs, venue, title: `${use === 'cook' ? 'Cook' : role} at ${where}`, pin: 1 }
      : { kind: 'vip', b, f, id: item, k, ...hrs, title: `${role} at ${where}`, pin: 1 };
    if (p.post) { sim.setPost(i, null); this.ended(a); }   // (its post ends: it works these hours now)
    p.job = job; p.sched = schedule(rng, job.kind, job.start, job.end, p.tr?.night);
    delete p.quit; delete p.unpaid;   // (its owner's own choice: a fresh start, even where it quit)
    const moved = this.makeWay(P, list, i, hrs);
    sim.setJob(i, { now: true });
    this.save({ people: [i, ...moved] });
    return { work: this.workOf(a), replaced: mover ? { name: mover.name, post: !!mover.post } : null };
  }
  /** New hours for the work its owner gave agent a (2026-10-28: "Edit hours"), where it is: the same desk or counter, those
   *  hours and days; another of its owner's agents sharing the seat at hours these now meet makes way. */
  hours(P, a, { start, end, days }) {
    const sim = this.simOf(), i = this.bodyOf(a), p = i >= 0 ? sim?.people[i] : null, j = p?.job;
    if (!p) throw new PostError(409, 'no_body', `${a.name} has no body in the city`);
    if (!j || j.b === undefined || j.id === undefined || !j.pin || j.kind === 'post') throw new PostError(409, 'no_work', j?.kind === 'post' ? `${a.name} is on duty 24/7: give it work hours from the ⋯ first` : `${a.name} has no work you gave it: choose a desk or a counter first`);
    if (!this.mayPost(this.actorFor(P), j.b, j.f, j.id)) throw new PostError(403, 'not_yours', 'That place is no longer yours');
    const hrs = checkHours(start, end, days ?? j.days ?? 127);
    if (hrs instanceof Error) throw new PostError(400, 'bad_hours', hrs.message);
    const list = this.seatsAt(j.b, j.f, j.id).get(j.k) || [];
    if (!this.seatFree(P, list, i, hrs)) throw new PostError(409, 'taken', 'Someone else has that seat at those hours');
    Object.assign(j, hrs);
    p.sched = schedule(new RNG(`hours:${p.id}:${Date.now()}`), j.kind, j.start, j.end, p.tr?.night);
    const moved = this.makeWay(P, list, i, hrs);
    sim.setJob(i, { now: true });
    this.save({ people: [i, ...moved] });
    return { work: this.workOf(a) };
  }
  /** What seat k of piece id on floor f of building b pays (server/economy/ households payInfo), or null (the economy off). */
  payOf(b, f, id, k) { try { return this.pay?.(b, f, id, k) || null; } catch { return null; } }
  /** Its owner sets what a position pays an hour (2026-10-28, the product owner: "in the ... button there should be a Pay
   *  option and the user picks a payment amount for that post/position"): rate in cents an hour, or null for its usual
   *  wage; seat `slot`, or every serving side or desk of the piece. At least the minimum wage — or nothing, where the
   *  place's own owner pays (no business there). Whoever pays (the business, the city, the owner) pays whoever works there.
   *  → { pay: [{ k, ...payInfo }] }. */
  setPay(P, { b, f, item, slot, rate }) {
    const sim = this.simOf(), W = this.worldOf();
    [b, f, item] = [b, f, item].map(Number);
    if (![b, f, item].every(Number.isInteger)) throw new PostError(400, 'bad_request', 'Choose a counter or a desk');
    const B = W.buildings[b], it = B && !B.gone && f >= 0 && f < B.floors ? W.levels[B.lv[f]]?.items.find(x => x.id === item) : null;
    const e = it ? sim?.index.entry(b, f, item) : null;
    if (!e) throw new PostError(404, 'no_spot', 'That piece is no longer there');
    if (!this.mayPost(this.actorFor(P), b, f, item)) throw new PostError(403, 'not_yours', 'You set the pay only on your own property: a building on a lot your account holds, or a flat it owns');
    const use = isServiceDesk(it.t) ? 'staff' : isKitchenPass(it.t) ? 'cook' : 'work', all = e.slots.map((s, k) => (s.use === use ? k : -1)).filter(k => k >= 0);
    const ks = slot === undefined || slot === null || slot === '' ? all : [Number(slot)];
    if (!ks.length || !ks.every(k => all.includes(k))) throw new PostError(400, 'bad_seat', 'There is no such place to work here');
    const info = this.payOf(b, f, item, ks[0]);
    if (!info) throw new PostError(409, 'no_economy', 'The economy is switched off in this world: nobody is paid');
    let v = null;
    if (rate !== null && rate !== undefined && rate !== '') {
      v = Number(rate);
      if (!Number.isSafeInteger(v) || v < 0 || v > info.max) throw new PostError(400, 'bad_rate', 'Choose an amount an hour');
      if (v < info.min && !(info.free && v === 0)) throw new PostError(400, 'bad_rate', `At least the minimum wage, ${info.min / 100} VC an hour${info.free ? ', or nothing' : ''}`);
    }
    const next = { ...(W.postPay || {}) };
    for (const k of ks) { const key = `${b}:${f}:${item}:${k}`; if (v === null) delete next[key]; else next[key] = v; }
    W.postPay = next;
    this.save({ docs: ['postPay'] });
    return { pay: ks.map(k => ({ k, ...this.payOf(b, f, item, k) })) };
  }
  /** Agent a chooses its own work again (its owner's pick lifted): placed by the rules a moment later (index.mjs settle). */
  autoWork(a) {
    const sim = this.simOf(), i = this.bodyOf(a), p = i >= 0 ? sim?.people[i] : null;
    if (!p) throw new PostError(409, 'no_body', `${a.name} has no body in the city`);
    if (p.job?.pin && p.job.kind !== 'post') { p.job = { kind: 'free', title: p.role || 'Agent', seek: 1, prev: 'vip' }; sim.setJob(i); this.save({ people: [i] }); this.moved?.(); }   // (on post: Unassign lets it go)
    return { work: this.workOf(a) };
  }
  /** Lets agent a go back to its day. */
  leave(a) {
    const sim = this.simOf(), i = this.bodyOf(a);
    this.ended(a);
    if (sim && i >= 0 && sim.people[i]?.post) { sim.setPost(i, null); this.save({ people: [i] }); }
    return null;
  }
  /** Every few minutes: a post its owner no longer holds the place of (a lot sold, a flat left) ends, its owner told. */
  check() {
    const sim = this.simOf();
    if (!sim) return;
    try {
      for (const a of this.agents.list()) {
        const i = this.bodyOf(a), r = i >= 0 ? sim.people[i]?.post : null, was = this.known.get(a.id);
        // a post that ended by itself since the last look (its furniture gone: population.js validatePerson): its owner told
        // (2026-10-28: Luke's and Sara's posts at the Radio Station ended overnight and nobody knew)
        if (!r) {
          if (was) {
            this.ended(a);
            if (a.ownerId != null) this.notify?.(a.ownerId, { t: 'mind', ev: 'note', agent: { id: a.id, name: a.name, emoji: a.emoji || '' }, text: `${a.name} is no longer on post at ${this.place(was.b, was.f)}: the furniture it was posted at is gone. It has gone back to its day; post it again from the ⋯ on a counter or desk.` });
          }
          continue;
        }
        this.known.set(a.id, { b: r.b, f: r.f, id: r.id, k: r.k });
        // on post, its post is its work: a job left beside it (posted before 2026-10-28, or given by the rules) ends
        if (this.syncJob(i)) { sim.setJob(i); this.save({ people: [i] }); if (typeof this.log === 'function') this.log(`[posts] ${a.name}: on post, its job is its post's now`); }
        if (a.ownerId == null) continue;
        const role = this.roleOf(a.ownerId);
        if (this.mayPost(role ? this.actorOf({ id: a.ownerId, role }) : null, r.b, r.f, r.id)) continue;
        const where = this.place(r.b, r.f);
        sim.setPost(i, null); this.save({ people: [i] }); this.ended(a);
        this.notify?.(a.ownerId, { t: 'mind', ev: 'note', agent: { id: a.id, name: a.name, emoji: a.emoji || '' }, text: `${a.name} left its post at ${where}: you no longer hold that place.` });
      }
    } catch (e) { this.log?.warn?.('[posts] check failed:', e.message); }
  }
}
