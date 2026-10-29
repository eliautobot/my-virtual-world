// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where an AI agent lives and works (2026-10-23: "agents from the owner account must either live or work on the owners
// own buildings ... if its an owner agent, i dont think they should work at another owner's buildings, i think they
// could work at the nearest free desk at a city owned (public) workplace, not someone elses private business"; "it
// should be kindoff random, maybe based on what the agent decides to work at"). Its owner's home base (server/towns.js)
// decides, in tiers, best first:
//   0  its owner's own property: a building on a lot the owner holds, a flat the owner owns;
//   1  the city's (a lot the city holds, or no lot) in the owner's home town;
//   2  the city's anywhere else;
//   never another player's property.
// Within a tier the nearest to the home base wins, a job weighed by what suits the agent (its role's words, how sociable
// it is: a counter or a desk). Only work a business pays for (a company's desks, a venue's counters), never at an
// employer it quit for not paying it, for a while (p.quit: server/economy/households.js agentPay). On its owner's own property an ordinary resident in the way makes room (it finds a home or
// work elsewhere: population.js reassign). An agent is moved only to a better tier than it has (never back and forth
// within one), and never off a place its owner chose for it: a desk or a counter given it from the piece (pin:
// server/agent-posts/posts.js work), a flat it was moved into (a tenant there: ui/flats.js).
import { RNG } from '../../shared/rng.js';
import { SHIFTS, daysMask, schedule } from './population.js';

const r2 = v => Math.round(v * 100) / 100;
export const TIER_NONE = 9;   // no place, or someone else's
/** Words in an agent's role that point to serving people at a counter, or to a desk. */
const STAFFY = /\b(chef|cook|baker|barista|bartender|cashier|clerk|server|waiter|waitress|host|hostess|receptionist|concierge|sales|shop|store|retail|trainer|coach|front ?desk|customer)\b/i;
const DESKY = /\b(developer|engineer|programmer|coder|writer|editor|analyst|designer|research|researcher|accountant|lawyer|scientist|manager|assistant|secretary|admin|architect|marketer|consultant)\b/i;
/** 'staff' or 'desk' (or null: either) for an agent. */
export function suits(p) {
  const role = String(p.role || '');
  if (STAFFY.test(role)) return 'staff';
  if (DESKY.test(role)) return 'desk';
  const soc = p.tr?.soc ?? 0.6;
  return soc >= 0.7 ? 'staff' : soc <= 0.45 ? 'desk' : null;
}

/**
 * places: { townOf(b), holderOf(b) → 'city' | 'account:<id>' | other, flat(b, f, u) → record | null,
 *           base(owner) → { town, x, z } } (server/towns.js places()).
 * The tier of building b for an agent of `owner` whose home town is `town`.
 */
export function tierOf(places, b, owner, town) {
  const h = places.holderOf(b);
  if (owner != null && h === `account:${owner}`) return 0;
  if (h !== 'city') return TIER_NONE;
  return places.townOf(b) === town ? 1 : 2;
}
/** The tier of a bed in flat (b, f, u): a flat owned by the owner is theirs; a flat let or sold to someone else, never. */
function bedTier(places, b, f, u, owner, town) {
  const rec = places.flat(b, f, u);
  if (rec) {
    if (owner != null && rec.owner?.kind === 'account' && String(rec.owner.id) === String(owner)) return 0;
    if (rec.deal !== 'own' || rec.tenants?.length || (rec.owner && rec.owner.kind !== 'municipality' && rec.owner.kind !== 'city')) return TIER_NONE;
  }
  return tierOf(places, b, owner, town);
}

/** Who holds which bed and which work place: key → person index (posts hold their spot too). */
function holders(people) {
  const beds = new Map(), work = new Map();
  people.forEach((p, i) => {
    if (!p || p.retired) return;
    if (p.home?.bed) beds.set(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`, i);
    const j = p.job;
    if (j && j.b !== undefined && j.id !== undefined) work.set(`${j.b}:${j.f}:${j.id}:${j.k}`, i);
    if (p.post) work.set(`${p.post.b}:${p.post.f}:${p.post.id}:${p.post.k}`, i);
  });
  return { beds, work };
}
const isAgent = p => !!(p && (p.vip || p.agentId));

/** Every bed: [{ b, f, u, id, k, x, z }]. */
function allBeds(world, index) {
  const out = [];
  for (const B of world.buildings) {
    if (!B || B.gone || B.type !== 'apartment') continue;
    for (let f = 1; f < B.floors; f++) {
      const lv = B.lv[f], L = world.levels[lv];
      for (let u = 0; u < (L?.units || []).length; u++) {
        for (const id of index.unitItems(lv, u)) {
          const e = index.slots(lv).get(id);
          for (const s of e.slots) if (s.use === 'sleep') out.push({ b: B.idx, f, u, id, k: s.k, x: B.x, z: B.z });
        }
      }
    }
  }
  return out;
}
/** Every work place an agent may have: desks ('work'; in the city's buildings an office's upper floors, as for everyone)
 *  and serving sides ('staff'): [{ b, f, id, k, kind: 'desk' | 'staff', venue, x, z, city }]. */
function allWork(world, index) {
  const out = [];
  for (const B of world.buildings) {
    if (!B || B.gone || B.type === 'park') continue;
    for (let f = 0; f < B.floors; f++) {
      const lv = B.lv[f], L = world.levels[lv];
      if (!L) continue;
      const venue = L.venue && SHIFTS[L.venue] ? L.venue : 'lobby', company = B.type === 'office' || B.type === 'hq';
      // (pays: a business there pays its wages, server/economy/households.js jobOf — a company's desks and lobby, a venue's
      // serving sides; a desk in a block of flats has no employer)
      for (const [id, k] of index.findUses(lv, 'work')) out.push({ b: B.idx, f, id, k, kind: 'desk', venue, x: B.x, z: B.z, office: company && f > 0, pays: company });
      for (const [id, k] of index.findUses(lv, 'staff')) out.push({ b: B.idx, f, id, k, kind: 'staff', venue, x: B.x, z: B.z, office: false, pays: venue === 'lobby' ? company : true });
    }
  }
  return out;
}


const hasJob = j => !!(j && j.b !== undefined && j.id !== undefined && (j.kind === 'vip' || j.kind === 'office' || j.kind === 'staff'));
/**
 * The work places agent p may take, best first (lower score): only better tiers than `cur`, work that pays, not the
 * employer it quit; on its owner's own property an ordinary resident in the way makes room. → [{ ...w, key, who, t, sc }].
 */
function rankWork({ work, workHeld, people, places, p, i, owner, town, base, cur, avoidB, rng }) {
  const want = suits(p), out = [];
  for (const w of work) {
    const t = tierOf(places, w.b, owner, town);
    if (t >= cur || t === TIER_NONE) continue;
    if (t > 0 && w.kind === 'desk' && !w.office) continue;   // (the city's desks: in its offices, as for everyone)
    if (!w.pays || w.b === avoidB) continue;                   // (work that pays; not the employer it quit)
    const key = `${w.b}:${w.f}:${w.id}:${w.k}`, who = workHeld.get(key);
    if (who !== undefined && who !== i && (t !== 0 || isAgent(people[who]) || people[who].post)) continue;   // (on its owner's own: an ordinary resident makes room)
    const sc = t * 1e7 + (who !== undefined && who !== i ? 5e5 : 0) + (want && want !== w.kind ? 400 : 0) + Math.hypot(w.x - base.x, w.z - base.z) + rng.next() * (t === 0 ? 60 : 350);   // (the city's: some of its own choosing among the near ones)
    out.push({ ...w, key, who, t, sc });
  }
  return out.sort((a, b) => a.sc - b.sc);
}
/** Agent p takes work place w ({ b, f, id, k, kind: 'desk' | 'staff', venue }): its job, hours and routine. o.by: who chose it. */
export function giveJob(world, p, w, rng, o = {}) {
  const B = world.buildings[w.b], L = world.levels[B.lv[w.f]], where = w.kind === 'staff' && w.venue !== 'lobby' ? (L?.name || B.name) : B.name;
  const role = p.role || 'Agent', by = o.by ? { by: o.by } : {};
  if (w.kind === 'staff') {
    const sh = rng.pick(SHIFTS[w.venue] || SHIFTS.lobby);
    p.job = { kind: 'staff', b: w.b, f: w.f, id: w.id, k: w.k, start: sh[0], end: sh[1], days: daysMask(rng, 'staff'), venue: w.venue, title: `${role} at ${where}`, ...by };
  } else {
    const start = r2(rng.float(8, 9.5));
    p.job = { kind: 'vip', b: w.b, f: w.f, id: w.id, k: w.k, start, end: r2(start + rng.float(9, 10.5)), days: 0b0011111, title: `${role} at ${where}`, ...by };
  }
  p.sched = schedule(rng, p.job.kind, p.job.start, p.job.end, p.tr?.night);
  return p.job;
}
/**
 * The jobs an agent's own brain may choose from (step 7, 2026-10-23: "it should be kindoff random, maybe based on what
 * the agent decides to work at (based on availability and their own preference unless specified by the owner)"): the best
 * few by the same rules as placeAgents, one per building and kind, none taken by anyone (no resident made to leave for a
 * choice). → [{ id, b, f, idx, k, kind, venue, x, z, t (tier), dist, where }].
 */
export function jobOptions(world, index, people, i, owner, places, n = 6) {
  const p = people[i]; if (!p) return [];
  const base = places.base(owner), town = base.town, rng = new RNG(`options:${p.id}`);
  if (p.quit && places.today != null && places.today >= p.quit.untilDay) delete p.quit;
  const { work: workHeld } = holders(people);
  const ranked = rankWork({ work: allWork(world, index), workHeld, people, places, p, i, owner, town, base, cur: TIER_NONE, avoidB: p.quit ? p.quit.b : -1, rng });
  const out = [], seen = new Set();
  for (const w of ranked) {
    if (w.who !== undefined && w.who !== i) continue;
    const key = `${w.b}:${w.kind}`; if (seen.has(key)) continue;
    seen.add(key);
    const B = world.buildings[w.b], L = world.levels[B.lv[w.f]];
    out.push({ id: `j${out.length + 1}`, b: w.b, f: w.f, idx: w.id, k: w.k, kind: w.kind, venue: w.venue, x: w.x, z: w.z, t: w.t, dist: Math.round(Math.hypot(w.x - base.x, w.z - base.z)),
      where: w.kind === 'staff' && w.venue !== 'lobby' ? (L?.name || B.name) : B.name });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Places the agents in `list` ([{ i, owner, noJob }], owner: an account id; noJob: its work left alone) where they should live and work. Changes people in
 * place. → { changed: Set of agents moved, bumped: Set of ordinary residents who made way (their home or job cleared,
 * for population.js reassign) }.
 */
export function placeAgents(world, index, people, list, places, o = {}) {
  const changed = new Set(), bumped = new Set();
  if (!list.length) return { changed, bumped };
  const { beds: bedHeld, work: workHeld } = holders(people);
  const beds = allBeds(world, index), work = allWork(world, index);
  const dist = (base, x, z) => Math.hypot(x - base.x, z - base.z);
  for (const { i, owner, noJob = false } of list) {
    const p = people[i];
    if (!p || p.retired || !isAgent(p)) continue;
    const base = places.base(owner), town = base.town, rng = new RNG(`place:${p.id}:${o.seed ?? ''}`);
    // an employer it quit (unpaid: households.js agentPay) it keeps away from until then
    if (p.quit && places.today != null && places.today >= p.quit.untilDay) delete p.quit;
    const avoidB = p.quit ? p.quit.b : -1;
    // ---------------------------------------------------------------- home
    const tenant = p.home?.bed && places.flat(p.home.b, p.home.f, p.home.u ?? -1)?.tenants?.some(t => t.kind === 'person' && Number(t.id) === i);   // (moved in by its flat's owner: theirs to change, ui/flats.js)
    if (!p.home?.pin && !tenant) {
      const cur = p.home?.bed ? bedTier(places, p.home.b, p.home.f, p.home.u ?? -1, owner, town) : TIER_NONE;
      let best = null, bs = Infinity;
      for (const d of beds) {
        const t = bedTier(places, d.b, d.f, d.u, owner, town);
        if (t >= cur || t === TIER_NONE) continue;
        const key = `${d.b}:${d.f}:${d.id}:${d.k}`, who = bedHeld.get(key);
        if (who !== undefined && who !== i && (t !== 0 || isAgent(people[who]) || places.flat(d.b, d.f, d.u))) continue;   // (on its owner's own: an ordinary resident in a flat nobody let makes room)
        const sc = t * 1e7 + (who !== undefined && who !== i ? 5e5 : 0) + dist(base, d.x, d.z) + rng.next();
        if (sc < bs) { bs = sc; best = { ...d, key, who }; }
      }
      if (best) {
        if (best.who !== undefined && best.who !== i) { people[best.who].home = null; bumped.add(best.who); }
        if (p.home?.bed) bedHeld.delete(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`);
        p.home = { b: best.b, f: best.f, u: best.u, bed: [best.id, best.k] };
        bedHeld.set(best.key, i);
        changed.add(i);
      }
    }
    // ---------------------------------------------------------------- work
    // (an agent whose own brain is choosing its job right now (step 7: index.mjs job hunts) waits for its answer; one on
    // post has its post for its work: 2026-10-28, the product owner: "their assigned post is their job")
    if (!p.job?.pin && !noJob && !p.post) {
      const j = p.job, has = hasJob(j);
      const cur = has ? tierOf(places, j.b, owner, town) : TIER_NONE;
      const best = rankWork({ work, workHeld, people, places, p, i, owner, town, base, cur, avoidB, rng })[0];
      if (best) {
        if (best.who !== undefined && best.who !== i) { const q = people[best.who]; q.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: q.job?.kind || 'office' }; bumped.add(best.who); }
        if (has) workHeld.delete(`${j.b}:${j.f}:${j.id}:${j.k}`);
        giveJob(world, p, best, rng);
        workHeld.set(best.key, i);
        changed.add(i);
      }
    }
  }
  return { changed, bumped };
}
