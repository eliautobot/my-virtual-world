// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Population: AI-agent residents (a roster from agent connections, given by the caller) + generated citizens,
// with homes (apartment beds), jobs (office desks, venue staff slots, remote work) and daily schedules.
import { RNG } from '../../shared/rng.js';
import { sanitizeAppearance } from '../../shared/appearance.js';
import { randomPopulationAppearance as randomAppearance } from '../../shared/populationAppearance.js';
import * as N from '../../shared/names.js';

const r2 = v => Math.round(v * 100) / 100;

import { roleOf, ROLE_TITLE } from '../../shared/nightlife.js';
export const SHIFTS = {
  cafe: [[6.5, 14.5], [14.5, 21]], restaurant: [[10.5, 17], [17, 23.5]], shop: [[9, 15], [15, 21]],
  gym: [[6, 14], [14, 22]], lobby: [[8, 17]],
  arcade: [[10, 16.75], [16.75, 23.5]], lounge_bar: [[15, 23.95]], club: [[19.5, 23.95]],   // (nights out: shared/nightlife.js)
};
export const STAFF_TITLE = { cafe: 'Barista', restaurant: 'Chef', shop: 'Cashier', gym: 'Trainer', lobby: 'Receptionist', arcade: 'Attendant', lounge_bar: 'Bartender', club: 'Bartender' };

export function daysMask(rng, kind) {
  if (kind === 'office' || kind === 'vip' || kind === 'remote') return 0b0011111; // Mon-Fri (bit0 = Mon)
  const off = rng.int(0, 6);
  return 0b1111111 & ~((1 << off) | (1 << ((off + 1) % 7)));
}
export function schedule(rng, kind, start, end, night) {
  const s = { lunch: r2(rng.float(11.75, 13.1)) };
  // an overnight shift (shared/shifts.js: its end past 24): up a while before it in the evening, asleep the morning
  // after; its meal break halfway through (the shift's own hours)
  if (end > 24) return { lunch: r2(start + (end - start) / 2), wake: r2(start - rng.float(1.4, 2)), bed: r2(end - 24 + rng.float(0.8, 1.5)) };
  if (kind === 'office' || kind === 'vip') s.wake = r2(Math.min(start - 1.2, rng.float(6.2, 7.6)));
  else if (kind === 'staff') s.wake = r2(start < 11 ? start - 1.6 : rng.float(8, 10));
  else s.wake = r2(rng.float(6.8, 9.8));
  s.bed = r2(night ? rng.float(23.6, 25.6) : rng.float(21.9, 23.9));
  // (hours its owner chose may run late, whatever the work: never to bed before its shift is over — 2026-10-28)
  if (end > s.bed - 0.7) s.bed = r2(Math.min(26, end + rng.float(0.8, 1.5)));
  return s;
}

export function generatePopulation(world, index, opts = {}) {
  const rng = new RNG(world.seed + ':people');
  const total = opts.population ?? world.population ?? 4000;
  const roster = opts.roster || [];
  const people = [];
  const usedNames = new Set();
  const personName = (fem) => {
    for (let k = 0; k < 20; k++) {
      const n = `${rng.pick(fem ? N.FIRST_F : N.FIRST_M)} ${rng.pick(N.LAST)}`;
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    return `${rng.pick(fem ? N.FIRST_F : N.FIRST_M)} ${rng.pick(N.LAST)} ${people.length}`;
  };
  // ---- homes: shuffle every apartment unit with beds ----
  const units = [];
  for (const b of world.buildings) {
    if (b.gone || b.type !== 'apartment') continue;
    for (let f = 1; f < b.floors; f++) {
      const lv = b.lv[f], L = world.levels[lv];
      (L.units || []).forEach((U, u) => {
        const beds = [];
        for (const id of index.unitItems(lv, u)) {
          const e = index.slots(lv).get(id);
          for (const s of e.slots) if (s.use === 'sleep') beds.push([id, s.k]);
        }
        if (beds.length) units.push({ b: b.idx, f, u, beds, used: 0 });
      });
    }
  }
  rng.shuffle(units);
  let ui = 0;
  const homeQueue = [];
  const takeHome = () => {
    // share a double bed with the previous person half of the time (couples/roommates)
    if (homeQueue.length && rng.chance(0.45)) return homeQueue.pop();
    while (ui < units.length) {
      const U = units[ui++];
      const bed = U.beds[0];
      const h = { b: U.b, f: U.f, u: U.u, bed: [bed[0], bed[1]] };
      if (U.beds.length > 1) homeQueue.length = 0, homeQueue.push({ b: U.b, f: U.f, u: U.u, bed: [U.beds[1][0], U.beds[1][1]] });
      else homeQueue.length = 0;
      return h;
    }
    return homeQueue.pop() || null;
  };
  // ---- office floors (companies fill 1-3 consecutive floors) ----
  const officeFloors = [], hqFloors = [];
  for (const b of world.buildings) {
    if (b.gone || (b.type !== 'office' && b.type !== 'hq')) continue;
    for (let f = 1; f < b.floors; f++) {
      const desks = index.findUses(b.lv[f], 'work').map(([id, k]) => [id, k]);
      if (!desks.length) continue;
      (b.type === 'hq' ? hqFloors : officeFloors).push({ b: b.idx, f, desks });
    }
  }
  const deskPool = [];
  const hqAgent = hqFloors.find(x => x.f === 1);
  for (const fl of hqFloors) if (fl.f !== 1) { rng.shuffle(fl.desks); for (const d of fl.desks.slice(0, Math.ceil(fl.desks.length * rng.float(0.6, 0.85)))) deskPool.push({ b: fl.b, f: fl.f, id: d[0], k: d[1] }); }
  // group floors per building, pick random runs of floors
  const byB = new Map();
  for (const fl of officeFloors) { if (!byB.has(fl.b)) byB.set(fl.b, []); byB.get(fl.b).push(fl); }
  const blds = rng.shuffle([...byB.keys()]);
  const nOffice = Math.round(total * 0.5);
  const runs = [];
  for (const bi of blds) {
    const fls = byB.get(bi);
    const nRuns = Math.max(1, Math.round(fls.length / rng.float(3.2, 6)));
    for (let r = 0; r < nRuns; r++) {
      const start = rng.int(0, fls.length - 1), len = rng.int(1, 3);
      runs.push(fls.slice(start, start + len));
    }
  }
  rng.shuffle(runs);
  const takenFloors = new Set();
  for (const run of runs) {
    if (deskPool.length >= nOffice) break;
    for (const fl of run) {
      const key = fl.b + ':' + fl.f; if (takenFloors.has(key)) continue; takenFloors.add(key);
      const d = rng.shuffle(fl.desks.slice());
      for (const x of d.slice(0, Math.ceil(d.length * rng.float(0.55, 0.9)))) deskPool.push({ b: fl.b, f: fl.f, id: x[0], k: x[1] });
    }
  }
  // ---- venue staff ----
  const staffPool = [];
  for (const b of world.buildings) {
    if (b.gone) continue;
    for (let f = 0; f < b.floors; f++) {
      const L = world.levels[b.lv[f]], m = index.slots(b.lv[f]);
      for (const [id, k] of index.findUses(b.lv[f], 'staff')) {
        const it = m.get(id)?.it;
        let kind = L.venue && SHIFTS[L.venue] ? L.venue : null;
        if (it && it.t === 'reception' && (b.type === 'office' || b.type === 'hq')) kind = 'lobby';
        if (!kind) continue;
        for (const sh of SHIFTS[kind]) staffPool.push({ b: b.idx, f, id, k, kind, start: sh[0], end: sh[1] });
      }
    }
  }
  const mk = (o) => {
    const fem = o.fem ?? rng.chance(0.5);
    const person = {
      id: o.id, name: o.name || personName(fem), vip: o.vip ? 1 : 0, emoji: o.emoji || '', role: o.role || '', agentId: o.agentId || '',
      fem: fem ? 1 : 0, app: o.app || randomAppearance(rng, { fem }),
      tr: { soc: r2(rng.float(0.2, 1)), act: r2(rng.float(0.1, 1)), food: r2(rng.float(0.5, 1.3)), home: r2(rng.float(0.1, 1)), night: rng.chance(0.15) ? 1 : 0, phone: rng.chance(0.35) ? 1 : 0 },
      speed: r2(rng.float(1.18, 1.55)), off: r2(rng.float(0.2, 1.05)),
      home: takeHome(), job: o.job || { kind: 'free' },
    };
    person.sched = schedule(rng, person.job.kind, person.job.start ?? 9, person.job.end ?? 17, person.tr.night);
    people.push(person);
    return person;
  };
  // ---- AI-agent residents (the roster comes from agent connections) at the headquarters' agent floor ----
  const vipDesks = hqAgent ? hqAgent.desks.slice() : [];
  roster.forEach((r, k) => {
    const vr = new RNG('vip:' + r.name);
    const fem = vr.chance(0.5);
    const d = vipDesks[k % Math.max(1, vipDesks.length)];
    const start = r2(vr.float(8, 9.5));
    mk({ id: 'vip-' + r.agentId, name: r.name, vip: 1, emoji: r.emoji, role: r.role, agentId: r.agentId, fem, app: randomAppearance(vr, { fem }),
      job: d ? { kind: 'vip', b: hqAgent.b, f: 1, id: d[0], k: d[1], start, end: r2(start + vr.float(9, 10.5)), days: 0b0011111, title: `${r.role || 'Agent'} at ${world.buildings[hqAgent.b].name}` } : { kind: 'free', title: r.role || 'Agent', seek: 1, prev: 'vip' } });
  });
  // ---- citizens ----
  rng.shuffle(deskPool); rng.shuffle(staffPool);
  let di = 0, si = 0;
  for (let n = 0; n < total; n++) {
    let job;
    const roll = rng.next();
    if (roll < 0.5 && di < deskPool.length) {
      const d = deskPool[di++], B = world.buildings[d.b];
      const start = r2(rng.float(7.8, 10)), len = rng.float(8, 9.2);
      job = { kind: 'office', b: d.b, f: d.f, id: d.id, k: d.k, start, end: r2(start + len), days: daysMask(rng, 'office'), title: `${rng.pick(N.JOBS_OFFICE)} at ${B.name}` };
    } else if (roll < 0.62 && si < staffPool.length) {
      const s = staffPool[si++], B = world.buildings[s.b], L = world.levels[B.lv[s.f]];
      const place = s.kind === 'lobby' ? B.name : (L.name || B.name);
      job = { kind: 'staff', b: s.b, f: s.f, id: s.id, k: s.k, start: s.start, end: s.end, days: daysMask(rng, 'staff'), title: `${STAFF_TITLE[s.kind]} at ${place}`, venue: s.kind };
    } else if (roll < 0.72) {
      job = { kind: 'remote', start: r2(rng.float(8.5, 10)), end: 0, days: daysMask(rng, 'remote'), title: rng.pick(['Freelance designer', 'Remote developer', 'Writer', 'Online tutor', 'Translator', 'Illustrator']) };
      job.end = r2(job.start + rng.float(6, 8));
    } else job = { kind: 'free', title: rng.weighted([['Student', 4], ['Retired', 3], ['Artist', 1], ['Between jobs', 1], ['Stay-at-home parent', 1], ['Musician', 1]]) };
    mk({ id: 'c' + n, job });
  }
  return people;
}

/** Validate a person's home/job references after world edits; returns true if anything changed. */
/** The furniture an AI agent may be posted at, around the clock (server/agent-posts/): the serving side of a counter, a
 *  checkout or a reception desk, a desk, a kitchen — never a customer's side, a bed or a seat to relax. */
export const POST_USES = Object.freeze(new Set(['staff', 'work', 'computer', 'cook', 'prep']));

export function validatePerson(world, index, p) {
  let changed = false;
  const okSlot = (r, use) => {
    if (!r) return false;
    const B = world.buildings[r.b];
    if (!B || B.gone || r.f >= B.floors) return false;
    const e = index.entry(r.b, r.f, r.id); if (!e) return false;
    const s = e.slots[r.k]; return !!s && (!use || s.use === use);
  };
  if (p.home && !okSlot({ b: p.home.b, f: p.home.f, id: p.home.bed[0], k: p.home.bed[1] }, 'sleep')) { p.home = null; changed = true; }
  if ((p.job.kind === 'office' || p.job.kind === 'vip' || p.job.kind === 'staff') && !okSlot(p.job)) { p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: p.job.kind }; changed = true; }
  // its post (an AI agent's, around the clock): gone with the furniture it was at
  if (p.post && !(okSlot(p.post) && POST_USES.has(index.entry(p.post.b, p.post.f, p.post.id).slots[p.post.k].use))) { delete p.post; changed = true; }
  // (its post's job record goes with it: it looks for work again — server/sim/sim.js postJob)
  if (p.job?.kind === 'post' && !p.post) { p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: 'vip' }; changed = true; }
  return changed;
}

export function sanitizeName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32); }
export { sanitizeAppearance };

// ---------------------------------------------------------------------------------------------
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
function baseTraits(rng) {
  return { soc: r2(rng.float(0.2, 1)), act: r2(rng.float(0.1, 1)), food: r2(rng.float(0.5, 1.3)), home: r2(rng.float(0.1, 1)), night: rng.chance(0.15) ? 1 : 0, phone: rng.chance(0.35) ? 1 : 0 };
}
/** An AI-agent resident with a free desk at the headquarters (agent floor first); without one it looks for an office desk. */
export function makeVip(world, index, r, people) {
  const vr = new RNG('vip:' + r.name);
  const fem = vr.chance(0.5);
  const hq = world.buildings.find(b => b.type === 'hq' && !b.gone);
  let job = { kind: 'free', title: r.role || 'Agent', seek: 1, prev: 'vip' };
  if (hq && hq.floors > 1) {
    const used = new Set(people.filter(p => p.job && p.job.b === hq.idx).map(p => `${p.job.f}:${p.job.id}:${p.job.k}`));
    for (const f of [1, ...range(2, hq.floors)]) {
      const d = index.findUses(hq.lv[f], 'work').find(([id, k]) => !used.has(`${f}:${id}:${k}`));
      if (d) {
        const start = r2(vr.float(8, 9.5));
        job = { kind: 'vip', b: hq.idx, f, id: d[0], k: d[1], start, end: r2(start + vr.float(9, 10.5)), days: 0b0011111, title: `${r.role || 'Agent'} at ${hq.name}` };
        break;
      }
    }
  }
  const p = { id: 'vip-' + r.agentId, name: r.name, vip: 1, emoji: r.emoji, role: r.role, agentId: r.agentId, fem: fem ? 1 : 0,
    app: randomAppearance(vr, { fem }), tr: baseTraits(vr), speed: r2(vr.float(1.2, 1.5)), off: r2(vr.float(0.2, 1.0)), home: null, job };
  p.sched = schedule(vr, job.kind, job.start ?? 9, job.end ?? 17, p.tr.night);
  return p;
}
/**
 * The resident behind a connected agent (WP2.10). To everyone who may not see the agent it is an ordinary citizen: a neutral id and an
 * alias name, no agent marks (the sim decides what to show, see Sim agentShown). p.agentId stays on the server. When the agent is
 * public the body carries its own name.
 */
export function makeAgentBody(world, index, r, people, { visible = false } = {}) {
  const p = makeVip(world, index, r, people);
  const ar = new RNG('alias:' + r.agentId);
  p.id = 'n' + Date.now().toString(36) + people.length;
  p.alias = `${ar.pick(p.fem ? N.FIRST_F : N.FIRST_M)} ${ar.pick(N.LAST)}`;
  p.name = visible ? r.name : p.alias;
  return p;
}
/** New citizen (editor "add resident"). */
export function makeCitizen(people, o = {}, seed = Date.now()) {
  const rng = new RNG('citizen:' + seed + ':' + people.length);
  const fem = o.fem ?? (o.app ? rng.chance(0.5) : rng.chance(0.5));
  const name = sanitizeName(o.name) || `${rng.pick(fem ? N.FIRST_F : N.FIRST_M)} ${rng.pick(N.LAST)}`;
  const app = o.app ? sanitizeAppearance(o.app, randomAppearance(rng, { fem })) : randomAppearance(rng, { fem });
  const p = { id: 'n' + Date.now().toString(36) + people.length, name, vip: 0, emoji: '', role: '', agentId: '', fem: fem ? 1 : 0, app,
    tr: baseTraits(rng), speed: r2(rng.float(1.18, 1.55)), off: r2(rng.float(0.2, 1.05)), home: null,
    job: { kind: 'free', title: 'Newcomer', seek: 1 } };
  p.sched = schedule(rng, 'free', 9, 17, p.tr.night);
  return p;
}
/** A free bed in apartment building b (one nobody else sleeps in), or null — for the resident editor (WP4.12). */
export function freeBed(world, index, people, b, except = -1) {
  const B = world.buildings[b];
  if (!B || B.gone || B.type !== 'apartment') return null;
  const used = new Set();
  people.forEach((p, i) => { if (i !== except && !p.retired && p.home) used.add(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`); });
  for (let f = 1; f < B.floors; f++) {
    const lv = B.lv[f], L = world.levels[lv];
    for (let u = 0; u < (L.units || []).length; u++) {
      const rec = world.flats?.[`${B.idx}:${f}:${u}`];   // a flat its owner assigned, lets or sold keeps to its tenants
      if (rec && (rec.deal !== 'own' || rec.tenants?.length)) continue;
      for (const id of index.unitItems(lv, u)) {
        const e = index.slots(lv).get(id);
        for (const s of e.slots) if (s.use === 'sleep' && !used.has(`${B.idx}:${f}:${id}:${s.k}`)) return { b: B.idx, f, u, bed: [id, s.k] };
      }
    }
  }
  return null;
}
/** A free work place in building b — a desk in an office, else a staff place (a counter, a venue) — or null. */
export function freeWork(world, index, people, b, except = -1) {
  const B = world.buildings[b];
  if (!B || B.gone) return null;
  const used = new Set();
  people.forEach((p, i) => {
    const j = p.job; if (i !== except && !p.retired && j && j.b !== undefined && j.id !== undefined) used.add(`${j.b}:${j.f}:${j.id}:${j.k}`);
    if (i !== except && !p.retired && p.post) used.add(`${p.post.b}:${p.post.f}:${p.post.id}:${p.post.k}`);   // (an agent on post holds it)
  });
  for (const want of ['work', 'staff']) for (let f = 0; f < B.floors; f++) {
    if (want === 'work' && (f === 0 || (B.type !== 'office' && B.type !== 'hq'))) continue;
    const lv = B.lv[f], L = world.levels[lv];
    for (const [id, k] of index.findUses(lv, want)) {
      if (used.has(`${B.idx}:${f}:${id}:${k}`)) continue;
      const kind = want === 'work' ? 'office' : 'staff', venue = L.venue && SHIFTS[L.venue] ? L.venue : 'lobby';
      return { kind, b: B.idx, f, id, k, venue, title: kind === 'office' ? `Works at ${B.name}` : `${STAFF_TITLE[venue] || 'Staff'} at ${venue === 'lobby' ? B.name : (L.name || B.name)}` };
    }
  }
  return null;
}
// The towns (server/towns.js places(), 2026-10-23: residents follow the towns too): set once by the server, so a
// resident given a home takes one in the town it works in, and one given work takes it in the town it lives in, when
// there is any there (else anywhere, as before).
let placesFn = null;
export function setPlaces(fn) { placesFn = typeof fn === 'function' ? fn : null; }
/** Free places (shuffled), taken by town when the towns are known: { left, take(town), pick(pull, rng) }. */
function pool(list, townOf) {
  const by = new Map(), n = new Map();   // town → its places; town → how many are still free
  if (townOf) for (const it of list) { const t = it.town = townOf(it.b); let a = by.get(t); if (!a) by.set(t, a = []); a.push(it); n.set(t, (n.get(t) || 0) + 1); }
  const pop = a => { while (a && a.length) { const it = a.pop(); if (!it.taken) { it.taken = 1; P.left--; if (it.town !== undefined) n.set(it.town, n.get(it.town) - 1); return it; } } return null; };
  const P = {
    left: list.length,
    take: town => (town != null && by.size ? pop(by.get(town)) : null) || pop(list),
    /** A town for someone free to live anywhere (a newcomer): by its pull (server/sim/migration.js) times its free places. */
    pick(pull, rng) {
      if (!pull || by.size < 2) return null;
      let sum = 0; const w = [];
      for (const [t, k] of n) if (k > 0) { const x = (pull.get(t) ?? 0.05) * k; if (x > 0) { w.push([t, x]); sum += x; } }
      let r = rng.next() * sum;
      for (const [t, x] of w) { r -= x; if (r <= 0) return t; }
      return w.at(-1)?.[0] ?? null;
    },
  };
  return P;
}
/** Give homeless people a free bed and people who lost their job (or are seeking one) a free desk/shift. */
export function reassign(world, index, people, rng) {
  let townOf = null, pull = null;
  try { const P = placesFn?.(); if (P) { townOf = P.townOf; pull = P.pull || null; } } catch { townOf = null; }
  const townAt = r => (townOf && r && r.b !== undefined && r.b >= 0 ? townOf(r.b) : null);
  const changed = [];
  const needHome = [];
  const usedBeds = new Set();
  people.forEach((p, i) => { if (p.retired) return; if (p.home) usedBeds.add(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`); else needHome.push(i); });
  if (needHome.length) {
    const free = [];
    for (const b of world.buildings) {
      if (b.gone || b.type !== 'apartment') continue;
      for (let f = 1; f < b.floors; f++) {
        const lv = b.lv[f], L = world.levels[lv];
        (L.units || []).forEach((U, u) => {
          for (const id of index.unitItems(lv, u)) {
            const e = index.slots(lv).get(id);
            for (const s of e.slots) if (s.use === 'sleep' && !usedBeds.has(`${b.idx}:${f}:${id}:${s.k}`)) free.push({ b: b.idx, f, u, bed: [id, s.k] });
          }
        });
      }
    }
    rng.shuffle(free);
    const beds = pool(free, townOf);
    for (const i of needHome) {
      // where it works; one free to live anywhere (a newcomer) by the towns' pull (more to a town that does well)
      const t = townAt(people[i].job) ?? (people[i].vip || people[i].agentId ? null : beds.pick(pull, rng));
      const h = beds.take(t); if (!h) break;
      people[i].home = { b: h.b, f: h.f, u: h.u, bed: h.bed }; changed.push(i);
    }
  }
  const needJob = [];
  const usedWork = new Set();
  people.forEach((p, i) => {
    if (p.retired) return;   // a removed agent's body holds no desk (WP2.1)
    const j = p.job;
    if (p.post) usedWork.add(`${p.post.b}:${p.post.f}:${p.post.id}:${p.post.k}`);   // an agent on post holds its spot: no one is hired there
    if (j && j.b !== undefined && j.id !== undefined) usedWork.add(`${j.b}:${j.f}:${j.id}:${j.k}`);
    else if (j && (j.lost || j.seek) && !(townOf && (p.vip || p.agentId))) needJob.push(i);   // (an agent's work: its owner's, its own brain's or the rules' near its owner: server/index.mjs settleAgents)
  });
  if (needJob.length) {
    const desks = [], hqDesks = [], shifts = [];
    for (const b of world.buildings) {
      if (b.gone) continue;
      for (let f = 0; f < b.floors; f++) {
        const lv = b.lv[f], L = world.levels[lv];
        if ((b.type === 'office' || b.type === 'hq') && f > 0) {
          for (const [id, k] of index.findUses(lv, 'work')) if (!usedWork.has(`${b.idx}:${f}:${id}:${k}`)) (b.type === 'hq' ? hqDesks : desks).push({ b: b.idx, f, id, k });
        }
        for (const [id, k] of index.findUses(lv, 'staff')) {
          if (usedWork.has(`${b.idx}:${f}:${id}:${k}`)) continue;
          const kind = L.venue && SHIFTS[L.venue] ? L.venue : 'lobby';
          shifts.push({ b: b.idx, f, id, k, kind });
        }
      }
    }
    rng.shuffle(desks); rng.shuffle(hqDesks); rng.shuffle(shifts);
    const D = pool(desks, townOf), H = pool(hqDesks, townOf), SH = pool(shifts, townOf);
    for (const i of needJob) {
      const p = people[i], prev = p.job.prev || (p.vip ? 'vip' : 'office'), t = townAt(p.home);
      let d = null, kind = 'office';
      if (p.vip) { d = H.take(t) || D.take(t); kind = 'vip'; }
      else if (prev === 'staff' && SH.left) { d = SH.take(t); kind = 'staff'; }
      else { d = D.take(t) || H.take(t); if (!d && SH.left) { d = SH.take(t); kind = 'staff'; } }
      if (!d) continue;
      const B = world.buildings[d.b], L = world.levels[B.lv[d.f]];
      let job;
      if (kind === 'staff') {
        const sh = rng.pick(SHIFTS[d.kind] || SHIFTS.lobby);
        job = { kind: 'staff', b: d.b, f: d.f, id: d.id, k: d.k, start: sh[0], end: sh[1], days: daysMask(rng, 'staff'), title: `${STAFF_TITLE[d.kind] || 'Staff'} at ${d.kind === 'lobby' ? B.name : (L.name || B.name)}`, venue: d.kind };
      } else {
        const start = r2(rng.float(7.8, 10));
        job = { kind, b: d.b, f: d.f, id: d.id, k: d.k, start, end: r2(start + rng.float(8, 9.2)), days: 0b0011111,
          title: kind === 'vip' ? `${p.role || 'Agent'} at ${B.name}` : `${rng.pick(N.JOBS_OFFICE)} at ${B.name}` };
      }
      p.job = job;
      p.sched = schedule(rng, kind, job.start, job.end, p.tr.night);
      usedWork.add(`${d.b}:${d.f}:${d.id}:${d.k}`);
      changed.push(i);
    }
  }
  hireNightlife(world, index, people, rng, changed);   // (nights out: their bartenders, DJ, band and dancers)
  return { changed };
}

/**
 * The city's nights out want their people (2026-10-23: "the lounge needs bartenders, several, musicians ... the night club
 * needs bartenders, several, nightclub dancers as well as a DJ"): an arcade's, a lounge's or a club's free serving places
 * (a bar's well, the DJ's decks, the band's stage, a podium; shared/nightlife.js) go to residents without work, the
 * nearest first, the club's DJ and the lounge's band before the rest. Returns the indices it hired (also pushed to changed).
 */
const EVERY_NIGHT = new Set(['dj', 'musician']);
export function hireNightlife(world, index, people, rng, changed = []) {
  const held = new Set(), out = [];
  for (const [i, p] of people.entries()) {
    if (!p || p.retired) continue;
    // (the club's one DJ and the lounge's band play every night the place is open: with two days off a week, one night
    // in three had no DJ and no music; bartenders and dancers, several of each, keep theirs)
    if (p.job?.kind === 'staff' && EVERY_NIGHT.has(p.job.role) && p.job.days !== 0b1111111) { p.job.days = 0b1111111; changed.push(i); }
    if (p.post) held.add(`${p.post.b}:${p.post.f}:${p.post.id}:${p.post.k}`);
    const j = p.job; if (j && j.b !== undefined && j.id !== undefined) held.add(`${j.b}:${j.f}:${j.id}:${j.k}`);
  }
  const open = [];
  for (const B of world.buildings) {
    if (!B || B.gone) continue;
    for (let f = 0; f < B.floors; f++) {
      const L = world.levels[B.lv[f]], venue = L?.venue;
      if (venue !== 'arcade' && venue !== 'lounge_bar' && venue !== 'club') continue;
      for (const [id, k] of index.findUses(B.lv[f], 'staff')) {
        if (held.has(`${B.idx}:${f}:${id}:${k}`)) continue;
        const t = L.items.find(i => i.id === id)?.t, role = roleOf(t, k);
        open.push({ b: B.idx, f, id, k, venue, role, x: B.x, z: B.z, first: role === 'dj' || role === 'musician' ? 0 : 1 });
      }
    }
  }
  if (!open.length) return out;
  open.sort((a, b) => a.first - b.first);
  const free = [];
  people.forEach((p, i) => { if (p && !p.retired && !p.vip && !p.agentId && !p.post && p.job?.kind === 'free' && p.job.title !== 'Retired' && p.home) free.push(i); });
  for (const w of open) {
    if (!free.length) break;
    let best = -1, bd = Infinity;
    for (let n = 0; n < free.length; n++) { const h = world.buildings[people[free[n]].home.b]; const d = h ? Math.hypot(h.x - w.x, h.z - w.z) : 1e9; if (d < bd) { bd = d; best = n; } }
    const i = free.splice(best, 1)[0], p = people[i], B = world.buildings[w.b], L = world.levels[B.lv[w.f]];
    const sh = rng.pick(SHIFTS[w.venue]);
    p.job = { kind: 'staff', b: w.b, f: w.f, id: w.id, k: w.k, start: sh[0], end: sh[1], days: EVERY_NIGHT.has(w.role) ? 0b1111111 : daysMask(rng, 'staff'), venue: w.venue, ...(w.role ? { role: w.role } : {}),
      title: `${w.role ? ROLE_TITLE[w.role] : STAFF_TITLE[w.venue]} at ${L.name || B.name}` };
    p.sched = schedule(rng, 'staff', p.job.start, p.job.end, p.tr?.night);
    changed.push(i); out.push(i);
  }
  return out;
}
