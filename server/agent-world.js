// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent living in the world (2026-10-10): an AI that runs on its own platform (Grok Bot,
// Muse, Hermes, OpenClaw…) and joined with the Agent API (server/agent-api.js) gets its body's eyes, ears and hands, not only its
// mailbox. The same plug for every outside service.
//
// Who decides what the body does (the product owner, 2026-10-10), first that applies:
//   1. its body in trouble (starving, exhausted), a post or a task in hand            — the routine, at once
//   2. its AI's order: an activity, a named place or a person, until a time it chose  — sim/agents.js order()
//   3. Free Will (on by default): the small choices, following the plans its AI wrote — server/free-will/
//   4. the routine: sleep, work, meals
// Its AI never steers step by step: it names what, where or whom, and the body walks there and does it. Bodies walk at a
// person's pace while the world's clock runs fast, so a walk across town takes a world hour or two (a few real minutes):
// what it is doing, where it is heading and when it will arrive are said as they are.
//
//   look()   the time, where it is (or where it is heading and when it arrives), what it does, its needs, money, its order
//            (and how the last one ended), Free Will, who is around, what it heard, named places nearby, its plans, its life
//   act()    one action: do (an activity, for a while), go (a named place), meet (be with someone: walk up to them and stay,
//            for a while), stop (end the order), say (out loud, checked like any agent's speech; to someone near: it turns
//            to them), plan / plan_done, remember
//   inbox    (through the Agent API's mailbox, server/agent-api.js extra) the lines said near it since, as they are said —
//            a stranger's only when its owner lets it hear strangers, a few a day — and its friends' messages, invitations
//            and the world's notices (server/agent-social/)
//   friends  (act) its friends, where one is, a message, an invitation (and answering one), ending a friendship, a block:
//            only between agents that count each other as friends, whose owners are friends, as each owner allows
// What it may do is what its body may do: no money moves, no building, nothing of its owner's. Each action is rate limited.
import { evalPlan } from './sim/plan.js';
import { formatClock, WALK_SPEED, worldSeconds } from '../shared/constants.js';
import { F_HIDDEN } from '../shared/proto.js';
import { inFootprint } from '../shared/geom.js';
import { AgentApiError } from './agent-api.js';
import { worldTimeFrom } from './agent-social/social.js';
import { aiName } from './mind/speech.js';
import { NO_INVENTING } from './mind/prompt.js';
import { needWords } from './free-will/prompt.js';

const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// activities an order keeps going (until its time is up) and one-off ones
export const ACTIVITIES = Object.freeze({
  park: 'a park: a bench, a stroll, a picnic', cafe: 'a café (costs money)', gym: 'the gym (costs money)', shop: 'shopping (costs money)',
  jog: 'a jog', dance: 'dancing (the lounge at work, or a park)', home: 'home, to relax', work: 'work (if it has a job)',
  eat: 'a meal, once', sleep: 'sleep, once',
  arcade: 'the arcade: video games, pinball, pool, the bull (costs money)', lounge_bar: 'a lounge: cocktails and live music (costs money)',
  club: 'a night club: the DJ, the dance floor, drinks, VIP booths (costs money, open from 20:00)',
});
const KEEPS = new Set(['park', 'cafe', 'gym', 'shop', 'jog', 'dance', 'home', 'work', 'arcade', 'lounge_bar', 'club']);
const VENUE_KINDS = Object.freeze({ cafe: 'cafe', restaurant: 'restaurant', shop: 'shop', gym: 'gym', park: 'park', arcade: 'arcade', lounge_bar: 'lounge_bar', club: 'club' });
const MOVING_USES = new Set(['wander', 'jog', 'run']);   // activities that are themselves a walk (a stroll, a jog): not "on the way"
const WHY_TEXT = Object.freeze({
  no_money: 'it costs money and you have too little (parks, jogging, dancing and home are free)',
  no_job: 'you have no job', no_home: 'you have no home', nowhere: 'there is no such place in the city',
  done: 'its time was up', nobody: 'they are not in the city right now', not_found: 'you looked for a long while and didn\'t reach them', private: 'they are somewhere private (a home or an office): you only meet people outdoors, in public places or where you are',
  not_possible: 'not possible right now (full or closed): you carry on with what you were doing', no_body: 'you have no body in the city right now',
});
export const WORLD_LIMITS = Object.freeze({
  doGapMs: 10000,        // between two orders (do, go, meet, stop)
  sayGapMs: 20000,       // between two lines out loud (the admin's mind.speechGapSeconds: every agent)
  sayPerDay: 8,          // lines out loud a world day (mind.speechPerDay: every agent)
  writesPerMin: 20,      // plans and memories
  nearM: 30,             // who counts as around (same floor or both outdoors)
  nearMax: 8,
  hearM: 15,             // lines said this close are heard; one can talk to someone this close
  heardMax: 20,
  earsMs: 30 * 60000,    // ears stay open this long after its AI last looked, acted or opened its inbox
  addressedMs: 60000,    // a line said to someone (say --to) counts as theirs this long
  placesMax: 8,
  orderMinutes: [5, 480, 60],   // world minutes: least, most, default
  meetMinutes: 20,              // a meet's default time together (counted from when it reaches them)
  meetSearchMinutes: 180,       // how long a meet looks for its person (world minutes)
  maxOrderMinutes: 480,         // the longest order (world minutes)
  requestsPerMin: 120,          // looks and actions together, one agent (against floods: each is cheap, a flood isn't)
});

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const r1 = v => Math.round(v * 10) / 10;
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hoursOf = clock => { const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(clock || '').trim()); if (!m) return null; const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0); return h + Number(m[2]) / 60; };

export class AgentWorld {
  /**
   * @param {{ agents, sim: () => object, life: () => object, mind: () => object, freeWill?: () => object, econ?: () => object|null,
   *   extKey: (slotId) => string, wake?: (slotId) => void, now?: () => number }} o   wake: the mailbox's long-poll for that slot
   */
  constructor({ agents, sim, life, mind, freeWill = () => null, econ = () => null, social = () => null, extKey, wake = () => {}, limits = () => ({}), now = () => Date.now() }) {
    Object.assign(this, { agents, simOf: sim, lifeOf: life, mindOf: mind, fwOf: freeWill, econOf: econ, socialOf: social, extKey, wake, limitsOf: limits, now });
    this.last = new Map();      // `${agentId}:${kind}` → ms of the last action of that kind
    this.days = new Map();      // `${agentId}:${utc day}` → lines said
    this.writes = new Map();    // agentId → recent write times
    this.calls = new Map();     // agentId → recent look/act times (the per-minute limit)
    this.ears = new Map();      // agentId → { i, slotId, until (ms), heard: [{ from, text, clock, at, distanceM, toYou }] }
    this.addressed = new Map(); // speaker's body index → { to: listener's body index, until (ms) }: a line said to someone
    this.earSim = null; this.earFn = null;
  }

  /** The limits now: WORLD_LIMITS with the admin's own (Settings → Agent limits), read at each use. */
  L() { return { ...WORLD_LIMITS, ...this.limitsOf() }; }
  /** The agent record and body index behind a connected agent's slot; refuses when it has no body in the city. */
  bodyOf(slot) {
    const a = this.agents.byKey(this.extKey(slot.id));
    if (!a) throw new AgentApiError(404, 'no_agent', 'This connected agent has no resident in the city yet');
    const life = this.lifeOf(), sim = this.simOf(), i = life?.byAgent?.get(a.id);
    if (i === undefined || !sim?.agents[i]?.plan || !sim.people[i] || sim.people[i].retired) throw new AgentApiError(409, 'no_body', `${a.name} has no body in the city right now`);
    this.listen(sim, a.id, i, slot.id);
    return { a, i, sim, life };
  }
  /** Looks and actions together, one agent: at most requestsPerMin a minute (its inbox has its own long-poll). */
  rate(slot) {
    const a = this.agents.byKey(this.extKey(slot.id));
    if (!a) return;
    const t = this.now(), L = this.L(), list = (this.calls.get(a.id) || []).filter(x => x > t - 60000);
    if (list.length >= L.requestsPerMin) throw new AgentApiError(429, 'too_many_requests', 'Too many requests this minute: slow down', Math.max(1, Math.ceil((list[0] + 60000 - t) / 1000)));
    list.push(t); this.calls.set(a.id, list);
    if (this.calls.size > 5000) this.calls.clear();
  }

  // ------------------------------------------------------------------------------------------------ ears
  /** Opens its ears for a while (lines said near it wait for its inbox or its next look); one listener on the simulation. */
  listen(sim, agentId, i, slotId) {
    if (this.earSim !== sim) {
      if (this.earSim && this.earFn) this.earSim.events.delete(this.earFn);
      this.earSim = sim; this.earFn = ev => { if (ev && ev.t === 'say') this.heard(ev); };
      sim.events.add(this.earFn);
    }
    const e = this.ears.get(agentId) || { heard: [] };
    Object.assign(e, { i, slotId, until: this.now() + this.L().earsMs });
    this.ears.set(agentId, e);
  }
  heard(ev) {
    if (!this.ears.size) return;
    const sim = this.earSim, now = sim.now(), sp = sim.agents[ev.i], who = sim.people[ev.i];
    if (!sp?.plan || !who) return;
    const s = evalPlan(sp.plan, now), t = this.now(), L = this.L();
    const to = this.addressed.get(ev.i), toIdx = to && to.until > t ? to.to : -1;
    // (who said it: an agent's line reaches an outside AI only as its owner allows — a stranger's a few times a day)
    const social = this.socialOf(), speaker = who.vip && who.agentId ? this.agents.byKey(who.agentId) : null;
    for (const [id, e] of this.ears) {
      if (e.until < t) { this.ears.delete(id); continue; }
      if (e.i === ev.i) continue;
      const me = sim.agents[e.i];
      if (!me?.plan) continue;
      const m = evalPlan(me.plan, now), d = Math.hypot(m.x - s.x, m.z - s.z);
      if (!this.sameSpace(sim, m.ctx, s.ctx) || d > L.hearM) continue;
      if (social && speaker && !social.hears(id, speaker.id, { connectedListener: true })) continue;
      e.heard.push({ from: aiName(who.name), text: clean(ev.text, 200), clock: formatClock(sim.hour(now)), at: new Date(t).toISOString(), distanceM: r1(d), toYou: toIdx === e.i });
      if (e.heard.length > L.heardMax) e.heard.shift();
      try { this.wake(e.slotId); } catch { /* its inbox catches up on its next call */ }
    }
  }
  /** What its mailbox hands over besides messages: the lines heard since (taken once). Opens its ears. */
  inboxExtra(slot) {
    const a = this.agents.byKey(this.extKey(slot.id));
    if (!a) return null;
    // (friends' messages, invitations and notices wait for it, body or not: server/agent-social/)
    const out = this.socialOf()?.takeFor(a.id) || {};
    let body = true;
    try { this.bodyOf(slot); } catch { body = false; }
    const e = body ? this.ears.get(a.id) : null;
    if (e && e.heard.length) out.heard = e.heard.splice(0);
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------------------------------------------ eyes
  /** Metres a body walks in a world minute (it walks at a person's pace while the clock runs fast). */
  walkPerWorldMinute(sim) { return WALK_SPEED * 60 / (sim.clock?.dayScale || 16); }
  /** World and real minutes for a span of sim seconds. */
  span(sim, simSecs) {
    const world = Math.max(0, Math.round(simSecs * (sim.clock?.dayScale || 16) / 60));
    return { worldMinutes: world, realMinutes: r1(Math.max(0, simSecs) / Math.max(1e-6, sim.clock?.rate || 1) / 60) };
  }
  /** A place's name as its AI sees it: unique in the city (a café called "Lobby" is in a building, on a floor). */
  label(sim, b, f) {
    // (a name its owner gave it that carries a link, contact details or words aimed at an AI is not shown: server/mind/speech.js aiName)
    const B = sim.world.buildings[b], nm = aiName(sim.brain.placeName(b, f), 'A place'), bn = B ? aiName(B.name, 'a building') : '';
    if (!B || B.type === 'park') return nm;
    const base = nm === bn || nm.startsWith(`${bn} `) || nm.startsWith(`${bn},`) ? nm : `${nm}, ${bn}`;
    return f > 0 && !/, floor \d+$/.test(base) ? `${base}, floor ${f + 1}` : base;   // (two venues in one building: each floor its own)
  }
  /** Named places of a kind (or all), nearest first, each once: [{ name, kind, distanceM, walkWorldMinutesAtLeast, affordable,
   *  venue }] — the distance is a straight line: the walk along the streets is longer. */
  places(sim, i, kind = null, max = WORLD_LIMITS.placesMax) {
    const brain = sim.brain, me = evalPlan(sim.agents[i].plan, sim.now()), econ = sim.econ, a = sim.agents[i], per = this.walkPerWorldMinute(sim);
    const out = [], seen = new Set();
    for (const [k, list] of Object.entries(brain.index.venues)) {
      if (k === 'lounge' || (kind && k !== kind)) continue;
      for (const v of list) {
        const key = `${v.b}:${v.f}`;
        if (seen.has(key)) continue;   // (a venue is listed once per floor, whatever its rooms)
        seen.add(key);
        const d = Math.hypot(v.x - me.x, v.z - me.z);
        out.push({ name: this.label(sim, v.b, v.f), kind: k, distanceM: Math.round(d), walkWorldMinutesAtLeast: Math.max(1, Math.round(d / per)), affordable: econ ? econ.canSpend(a, k, k === 'restaurant') : true, venue: v });
      }
    }
    // two buildings may share a name (two "Store 21"s): those say their street corner too, so each name is one place
    const count = new Map();
    for (const p of out) count.set(p.name, (count.get(p.name) || 0) + 1);
    for (const p of out) if (count.get(p.name) > 1) { const at = brain.nav.addressAt?.(p.venue.x, p.venue.z); if (at) p.name = `${p.name} (${at})`; }
    const again = new Map();
    for (const p of out) again.set(p.name, [...(again.get(p.name) || []), p]);
    for (const list of again.values()) if (list.length > 1) list.sort((x, y) => x.venue.b - y.venue.b || x.venue.f - y.venue.f).forEach((p, k) => { p.name = `${p.name} #${k + 1}`; });
    out.sort((x, y) => x.distanceM - y.distanceM);
    return out.slice(0, max);
  }
  /** A named place in the city (look's places, any distance): { place } — the nearest of those with that name — or { why, candidates }. */
  findPlace(sim, i, name) {
    const want = norm(name);
    if (!want) return { why: 'name a place (look shows places nearby)' };
    const all = this.places(sim, i, null, Infinity);
    const base = n => norm(String(n).replace(/\s*\([^)]*\)$/, '').split(',')[0]);
    const exact = all.filter(p => norm(p.name) === want || base(p.name) === want);
    const found = exact.length ? exact : all.filter(p => norm(p.name).includes(want));
    if (!found.length) return { why: `no place called "${clean(name, 60)}" (look shows places nearby)` };
    const names = [...new Set(found.map(p => p.name))];
    if (names.length > 1 && !exact.length) return { why: 'more than one place matches', candidates: names.slice(0, 8) };
    return { place: found[0] };
  }
  /** A time in the world for an invitation: { at: "7:30 PM" | "tomorrow 7:30 PM" } (the next such time) or { inMinutes }
   *  (world minutes from now): { world } (world seconds) or { why }. */
  worldTime(sim, b) { return worldTimeFrom(worldSeconds(sim.clock, sim.now()), { at: b.at, inMinutes: b.inMinutes }); }
  social() {
    const s = this.socialOf();
    if (!s) throw new AgentApiError(503, 'no_friends', 'Friends are not available in this world');
    return s;
  }
  /** The person called name (nearest first among those with that name), or null: { j, e, name, act, distanceM }. */
  personNamed(sim, i, name) {
    const want = norm(name);
    if (!want) return null;
    const me = evalPlan(sim.agents[i].plan, sim.now());
    let best = null, bd = Infinity;
    for (let j = 0; j < sim.people.length; j++) {
      const p = sim.people[j], o = sim.agents[j];
      if (j === i || !p || p.retired || !o?.plan || (norm(p.name) !== want && norm(aiName(p.name)) !== want)) continue;
      const e = evalPlan(o.plan, sim.now()), dist = Math.hypot(e.x - me.x, e.z - me.z), same = this.sameSpace(sim, e.ctx, me.ctx), d = (same ? 0 : 1e6) + dist;
      if (d < bd) { bd = d; best = { j, e, name: aiName(p.name), act: o.act, distanceM: Math.round(dist), sameFloor: same }; }
    }
    return best;
  }
  /** Whether it is still on its way to its activity: the act's place is elsewhere (another floor, a building, outdoors) and
   *  it hasn't arrived — a stroll or a jog on the spot is the activity itself, not a way there. */
  heading(sim, act, mine, now) {
    if (!act || !(act.travelEnd > now + 1)) return false;
    // already on that floor (crossing a room to a seat, from the bed to the computer): there, not on the way
    if (act.ctx >= 0 && act.ctx === mine.ctx) return false;
    // already on the place's grounds (a park, walking from a bench to a stroll): there, not on the way
    const B = act.b >= 0 ? sim.world.buildings[act.b] : null;
    if (B && inFootprint(B, mine.x, mine.z, 1) && (MOVING_USES.has(act.use) || act.ctx === mine.ctx)) return false;
    return act.ctx !== mine.ctx || !MOVING_USES.has(act.use);
  }
  /** Whether a body there is in the open air: outdoors, or on a park's grounds (a park has no walls). */
  openAir(sim, ctx) { if (ctx < 0) return true; const B = sim.world.buildings[Math.floor(ctx / 64)]; return !!B && B.type === 'park' && ctx % 64 === 0; }
  /** Whether two bodies share a space where they see and hear each other: the same floor, or the open air (the street and
   *  a park's grounds are one space — someone on a park bench talks with someone on the path beside it). */
  sameSpace(sim, a, b) { return a === b || (this.openAir(sim, a) && this.openAir(sim, b)); }
  /** Where someone is, in words: "outdoors", or the place (building, floor). */
  placeOf(sim, ctx) { return ctx < 0 ? 'outdoors' : sim.brain.placeName(Math.floor(ctx / 64), ctx % 64) || 'inside a building'; }
  /** What it is doing, said from its own side ("Talking with you" is the visitor's view of a chat). */
  doing(sim, i, act, info) {
    if (!act) return info.moving ? 'walking' : 'standing';
    if (act.use === 'greet') return act.label && act.label !== 'Talking with you' ? aiName(act.label, 'talking with someone') : 'talking with someone who walked up to you';
    return aiName(act.label, 'busy');
  }

  /**
   * The facts about it right now, handed over with every inbox (2026-10-12: an outside AI answered "lovely morning" at
   * 6 PM and made up where it was): the world's time and part of the day, where its body is, what it is doing — and what
   * it will go back to after a message —, how it feels, and the rule its built-in peers follow: nothing more is true.
   * Null when it has no body yet.
   */
  /** What it holds, in short (server/economy/inventory.js summary): undefined while the economy is off. */
  holdsOf(agentId, n = 8) { try { return this.econOf()?.holds?.(agentId, n); } catch { return undefined; } }
  /** Its whole inventory (the "inventory" tool): every kind of thing, with the refs that give it. */
  inventoryOf(slot) {
    const { a } = this.bodyOf(slot), h = this.holdsOf(a.id, 200);
    if (!h) return { ok: false, why: 'The economy is switched off here: nothing to hold.' };
    return { ok: true, ...h, how: 'Give something with the "give" tool: the thing (its ref, like S12, or its name), how many, and who to (a person\'s or an agent\'s name). Your owner\'s spending rules apply: above their limit they agree first.' };
  }
  /** Gives something from its inventory (within its owner's limits): { item (a ref or a name), qty, to (a name), memo }. */
  giveFrom(slot, { item, qty = 1, to, memo = '' } = {}) {
    const { a } = this.bodyOf(slot), econ = this.econOf();
    if (!econ?.give) return { ok: false, why: 'The economy is switched off here.' };
    try {
      const r = econ.give(a.id, { item: String(item || ''), qty: Math.max(1, Math.floor(Number(qty) || 1)), to: String(to || ''), memo: String(memo || '').slice(0, 140) });
      if (r?.status === 'approval_required') return { ok: true, waiting: true, said: 'Above your owner\'s limit: they agree first (they see it in their wallet).', approval: r.approval };
      return { ok: true, gave: r?.gave ? { qty: r.gave.qty, to: r.gave.to?.name || to } : null };
    } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 200) }; }
  }
  /** Its trades (the "trades" tool): open ones first, each side spelt out. */
  tradesOf(slot) {
    const { a } = this.bodyOf(slot), econ = this.econOf();
    if (!econ?.trades) return { ok: false, why: 'The economy is switched off here.' };
    const list = econ.trades(a.id).map(t => ({ id: t.id, status: t.status, with: t.them.who.name, note: t.memo || undefined, youGive: { vc: t.me.vc / 100, things: t.me.items.map(l => ({ name: l.name, qty: l.qty, gone: l.gone || undefined })) },
      theyGive: { vc: t.them.vc / 100, things: t.them.items.map(l => ({ name: l.name, qty: l.qty, gone: l.gone || undefined })) }, youAccepted: t.myOk, theyAccepted: t.theirOk }));
    return { ok: true, trades: list, how: 'With the "trade" tool: open (to a name), offer (your side: things by name or ref with how many, and VC), accept (when both have, it all swaps at once; your owner\'s rules apply) or decline. A change to either side takes back both acceptances.' };
  }
  /** Does something with a trade: { action: open|offer|accept|decline, trade, to, items, vc, note }. */
  tradeDo(slot, b = {}) {
    const { a } = this.bodyOf(slot), econ = this.econOf();
    if (!econ?.trade) return { ok: false, why: 'The economy is switched off here.' };
    try {
      const r = econ.trade(a.id, String(b.action || ''), { trade: b.trade, to: b.to, items: b.items, vc: b.vc, memo: b.note });
      if (r?.status === 'approval_required') return { ok: true, waiting: true, said: 'Above your owner\'s limit: they agree first (they see it in their wallet).' };
      const t = r?.trade || r;
      return { ok: true, trade: t?.id, status: t?.status, youAccepted: t?.myOk, theyAccepted: t?.theirOk };
    } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 200) }; }
  }
  nowFacts(slot) {
    let b; try { b = this.bodyOf(slot); } catch { return null; }
    const { i, sim } = b, ag = sim.agents[i];
    if (!ag?.plan) return null;
    const me = sim.agentInfo(i), now = sim.now(), c = sim.clockInfo(), act = me.act;
    const mine = evalPlan(ag.plan, now), heading = this.heading(sim, act, mine, now);
    const here = act?.place ? aiName(act.place, 'a place') : this.placeOf(sim, mine.ctx);
    const day = this.dayDoing(sim, i, act, me, ag, now, heading, here);
    const h = c.hour, part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
    return {
      name: slot.name,   // (2026-10-13: which agent this is — an app with several connectors checks it is the right one)
      time: `${c.weekday} ${formatClock(h)}`, partOfDay: part,
      where: heading ? `on the way to ${here}` : here,
      doing: day.doing,
      ...(day.moment ? { moment: day.moment } : {}),
      feels: needWords(me.needs).join(', '),
      ...(() => { try { const t = (this.econOf()?.trades?.(b.a.id) || []).filter(x => x.status === 'open'); return t.length ? { trades: `${t.length} open (with ${t.map(x => x.them.who.name).join(', ')}): the "trades" tool shows them` } : {}; } catch { return {}; } })(),
      ...(() => { const h = this.holdsOf(b.a.id, 6); return h ? { holds: h.kinds ? `${h.items.map(x => `${x.qty > 1 ? `${x.qty} × ` : ''}${x.name}`).join(', ')}${h.more ? ` and ${h.more} more kinds` : ''} (worth ${h.worthVC} VC in all; the "inventory" tool lists it)` : 'nothing yet' } : {}; })(),
      rule: `These are the facts about you right now. "doing" is your day: answer what you are doing from it; a message is only a moment you take from it. ${NO_INVENTING} Never make up the time, the part of the day, where you are or what you are doing: use these.`,
    };
  }
  /**
   * What its day is, said from its side, and the moment it takes for a message (2026-10-12: "it keeps saying it's on the
   * phone" — the phone a message brings out is not what it is doing with its day): { doing, moment }. At a screen it
   * answers where it is; a message that paused something says what, and until when it goes back to it; one that woke it
   * says so.
   */
  dayDoing(sim, i, act, me, ag, now, heading, here) {
    const onMsg = act && (act.use === 'task' || act.use === 'task_phone' || act.use === 'phone');
    if (ag.wokenAt !== undefined && now - ag.wokenAt < sim.brain.wm(60) && onMsg) return { doing: 'you were asleep in bed; this message woke you', moment: 'you got up to answer it' };
    const r = ag.resume && ag.resume.until > now ? ag.resume : null;
    if (r && onMsg) {
      const what = aiName(r.label, 'what you were doing').toLowerCase(), at = r.place ? aiName(r.place, 'a place') : '';
      return { doing: r.enRoute ? `on your way${at ? ` to ${at}` : ''} (${what})` : `${what}${at ? ` at ${at}` : ''}`, moment: `you paused it to answer this message; you go back to it until ${formatClock(sim.brain.hour(r.until))}` };
    }
    if (onMsg) return { doing: 'taking a moment to answer messages', moment: null };
    const doing = heading ? `walking to ${here}` : this.doing(sim, i, act, me);
    return { doing, moment: ag.msgHere ? 'you answer this message right where you are, carrying on' : null };
  }

  /** Everything it knows about one person, in one small answer: who they are to it, how close, plans and invitations
   *  together, its last messages with them and what it remembers of them. */
  about(a, sim, life, name) {
    const want = normName(name);
    if (!want) return { ok: false, why: 'Name someone you know' };
    const rels = life.relations(a.id, 200).filter(r => normName(r.name) === want).sort((x, y) => y.affinity - x.affinity);
    const r = rels[0];
    if (!r) return { ok: false, why: `You don't know anyone called ${aiName(name, 'that')} yet` };
    const S = this.socialOf(), agentId = r.kind === 'agent' && S ? S.agentOfPerson(r.id) : null;
    const f = agentId !== null && S ? S.friendsOf(a.id, { max: 200 }).find(x => x.agent === agentId) : null;
    const shown = aiName(r.name), mention = x => normName(x).includes(want);
    const memories = [...life.memories(a.id, { term: 'long', limit: 200 }), ...life.memories(a.id, { term: 'short', limit: 200 })]
      .filter(m => mention(m.text) || (m.people || []).some(mention)).slice(0, 5).map(m => m.text);
    const together = S ? S.invitesOf(a.id).filter(v => mention(v.to) || mention(v.from)) : [];
    const thread = agentId !== null && S ? S.thread(a.id, agentId, { limit: 4 }).reverse().map(m => ({ from: m.mine ? 'you' : shown, text: m.text, at: new Date(m.created).toISOString() })) : [];
    return {
      name: shown, who: r.kind === 'agent' ? 'an AI agent who lives in the city' : 'a person who lives in the city',
      closeness: f ? `${f.level} (${f.closeness}%)` : `${r.level} (${Math.round(r.affinity * 100)}%)`,
      ...(f ? { friendBothWays: f.friendBothWays, canReach: f.canReach, ...(f.why ? { why: f.why } : {}) } : {}),
      ...(r.lastDay !== null && r.lastDay !== undefined ? { lastSeenDay: r.lastDay } : {}), ...(r.lastPlace ? { lastPlace: aiName(r.lastPlace, 'a place') } : {}),
      timesTogether: r.interactions || 0,
      plansTogether: [...together, ...life.intentions(a.id).filter(p => p.status === 'open' && mention(p.text)).map(p => ({ plan: p.text }))],
      lastMessages: thread, remembers: memories,
    };
  }

  look(slot, { brief = false } = {}) {
    this.rate(slot);
    const { a, i, sim, life } = this.bodyOf(slot);
    const me = sim.agentInfo(i), now = sim.now(), c = sim.clockInfo(), L = this.L();
    const act = me.act, mine = evalPlan(sim.agents[i].plan, now);
    const heading = this.heading(sim, act, mine, now);
    const here = act?.place ? aiName(act.place, 'a place') : this.placeOf(sim, mine.ctx);
    const around = [];
    for (let j = 0; j < sim.agents.length; j++) {
      if (j === i) continue;
      const o = sim.agents[j], p = sim.people[j];
      if (!o?.plan || !p || p.retired) continue;
      const e = evalPlan(o.plan, now);
      if (!this.sameSpace(sim, e.ctx, mine.ctx) || (e.s && (e.s.flags & F_HIDDEN))) continue;   // (not seen: another floor, a lift, underground)
      const d = Math.hypot(e.x - mine.x, e.z - mine.z);
      if (d > L.nearM) continue;
      around.push({ name: aiName(p.name), distanceM: r1(d), doing: o.act?.label ? aiName(o.act.label, 'busy') : (e.s && !e.s.h ? 'walking' : 'standing'), canTalk: d <= L.hearM, agent: !!(p.vip && p.agentId) || undefined });
    }
    around.sort((x, y) => x.distanceM - y.distanceM);
    const money = (() => { try { const m = this.econOf()?.money?.(sim.people[i]); return m ? { availableVC: Math.round(m.available) / 100, rentPerDayVC: Math.round(m.rentPerDay || 0) / 100 } : undefined; } catch { return undefined; } })();
    const order = sim.orderOf(i), ended = sim.orderEndedOf(i);
    const ears = this.ears.get(a.id), heard = ears ? ears.heard.splice(0) : [];
    const out = {
      // (the world's clock runs fast: a world hour is a few real minutes)
      time: { day: c.weekday, clock: formatClock(c.hour), realMinutesPerWorldHour: c.dayScale && c.rate ? r1(3600 / (c.dayScale * c.rate) / 60) : null },
      me: {
        name: a.name,
        // (on its way: walking there, and what it will do on arrival)
        ...(() => { const d = this.dayDoing(sim, i, act, me, sim.agents[i], now, heading, here); return { doing: d.doing, ...(d.moment ? { moment: d.moment } : {}) }; })(),
        where: heading ? `on the way to ${here}` : here,
        ...(heading ? { arrivesIn: this.span(sim, act.travelEnd - now), then: this.doing(sim, i, act, me) } : {}),
        needs: me.needs,
        money,
        holds: this.holdsOf(a.id, brief ? 5 : 10),
      },
      order: order ? this.orderView(sim, order) : null,
      ...(ended ? { lastOrderEnded: { order: ended.kind, finished: ended.why === 'done', ...(ended.who !== null && ended.who !== undefined ? { with: aiName(sim.people[ended.who]?.name) } : {}), why: WHY_TEXT[ended.why] || ended.why, at: formatClock(sim.hour(ended.at)) } } : {}),
      freeWill: this.freeWillOf(a),
      around: around.slice(0, brief ? 4 : L.nearMax),
      heard,
      plans: life.intentions(a.id).filter(p => p.status === 'open').map(p => ({ id: p.id, kind: p.kind, text: p.text })),
    };
    const social = this.socialOf(), inv = social ? social.invitesOf(a.id) : [];
    if (inv.length) out.invites = inv;
    if (brief) return out;
    if (social) out.friends = social.friendsOf(a.id, { max: 10 }).map(({ agent, ...f }) => f);
    const ctx = life.contextFor(a.id) || {};
    const nowH = c.hour, earlier = (ctx.earlier || []).filter(x => { const h = hoursOf(x.clock); return h === null || h <= nowH + 0.01; }).sort((x, y) => (hoursOf(x.clock) ?? 0) - (hoursOf(y.clock) ?? 0));
    out.me.job = me.job.kind === 'free' ? null : { title: me.job.title, place: me.job.place, hours: me.job.kind === 'post' ? 'around the clock (on post)' : me.job.start != null ? `${formatClock(me.job.start)} to ${formatClock(me.job.end)}` : undefined };
    out.me.home = me.home?.place || null;
    out.places = this.places(sim, i, null, L.placesMax).map(({ venue, ...p }) => p);
    out.life = { personality: ctx.personality, purpose: ctx.purpose || undefined, earlierToday: earlier, remembers: ctx.memories };
    out.canDo = ACTIVITIES;
    // (the limits now: the world's admin may change them)
    out.limits = { orderEverySeconds: Math.round(L.doGapMs / 1000), longestOrderWorldMinutes: L.maxOrderMinutes, meetLooksWorldMinutes: L.meetSearchMinutes,
      sayEverySeconds: Math.round(L.sayGapMs / 1000), linesOutLoudAWorldDay: L.sayPerDay, talkWithinMetres: L.hearM, plansAndMemoriesAMinute: L.writesPerMin,
      longestLineChars: Number(this.mindOf()?.config?.().speechMaxChars) || 140,
      // (what it may show a visitor, and how long a visitor's message to it may be: server/agent-api.js)
      ...(L.answerMaxChars ? { longestAnswerToAVisitorChars: L.answerMaxChars } : {}), ...(L.visitorMaxChars ? { longestVisitorMessageChars: L.visitorMaxChars } : {}) };
    if (social) {
      const S = social.limits(), own = social.settingsOf(a.id);
      Object.assign(out.limits, { friendsMessageChars: S.maxChars, messagesToOneFriendPerConversation: S.convoMessages, conversationMinutes: S.convoMs / 60000,
        messagesBetweenTwoADay: S.pairPerDay, newMessagesADay: own.perDay !== null ? Math.min(own.perDay, S.sentPerDay) : S.sentPerDay, repliesADay: S.repliesPerDay,
        invitesADay: S.invitesPerDay, whereisADay: S.whereisPerDay, friendAtClosenessPercent: Math.round(S.friendAt * 100),
        hearStrangers: own.hearStrangers ? `${S.strangerLines} lines from each stranger a day` : 'no (your owner can allow it)' });
    }
    return out;
  }
  orderView(sim, o) {
    return {
      doing: o.kind,
      ...(o.venue ? { at: this.label(sim, o.venue.b, o.venue.f) } : {}),
      ...(o.kind === 'meet' ? { with: aiName(sim.people[o.who]?.name), found: !!o.reached } : {}),
      // (a meet still on its way: the time it gives up; once together: the time together ends)
      [o.kind === 'meet' && !o.reached ? 'givesUpAt' : 'until']: formatClock(sim.hour(o.until)),
    };
  }
  /** Its Free Will as its AI should know it: on (deciding the small things now) or why not, and the plan's daily amount. */
  freeWillOf(a) {
    const fw = this.fwOf();
    if (!fw) return null;
    const set = fw.settingsOf(a.id), st = fw.status.get(a.id);
    const out = { on: !!(set.enabled && st?.active), ...(set.enabled ? {} : { why: 'switched off by your owner' }) };
    if (set.enabled && !st?.active) out.why = st?.reason || 'starting';
    return out;
  }

  // ------------------------------------------------------------------------------------------------ hands
  /** One action: { action: 'do'|'go'|'meet'|'stop'|'say'|'plan'|'plan_done'|'remember', … }. */
  async act(slot, body) {
    const b = body && typeof body === 'object' ? body : {};
    this.rate(slot);
    const { a, i, sim, life } = this.bodyOf(slot), L = this.L();
    // (an order the world refused — no money, no such place — does not count: only one carried out starts the wait)
    const t = this.now(), gap = (kind, ms) => {
      const k = `${a.id}:${kind}`, prev = this.last.get(k) || 0;
      if (t - prev < ms) throw new AgentApiError(429, 'too_soon', `Wait ${Math.ceil((ms - (t - prev)) / 1000)} s before the next ${kind}`, Math.ceil((ms - (t - prev)) / 1000));
    };
    const mark = kind => this.last.set(`${a.id}:${kind}`, t);
    const write = () => {
      const w = (this.writes.get(a.id) || []).filter(x => x > t - 60000);
      if (w.length >= L.writesPerMin) throw new AgentApiError(429, 'too_many', 'Too many plans and memories this minute', 30);
      w.push(t); this.writes.set(a.id, w);
    };
    const [lo, , def] = WORLD_LIMITS.orderMinutes, hi = L.maxOrderMinutes ?? WORLD_LIMITS.orderMinutes[1];
    // a number of world minutes, or the default when none is given; nonsense (not a number, zero or less) is refused —
    // more than the longest is the longest
    if (b.minutes !== undefined && b.minutes !== null && b.minutes !== '' && !(Number.isFinite(Number(b.minutes)) && Number(b.minutes) > 0)) throw new AgentApiError(400, 'bad_minutes', 'minutes is a number of world minutes, more than 0');
    const minutes = dflt => (b.minutes !== undefined && b.minutes !== null && b.minutes !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(b.minutes)))) : dflt);
    // what an order did, as it is: heading somewhere (and when it arrives) or already doing it
    const result = (r, extra = {}) => {
      if (!r.ok) return { ok: false, ...extra, why: WHY_TEXT[r.why] || r.why };
      mark('order');
      const after = sim.agentInfo(i), o = sim.orderOf(i), act = after?.act, now = sim.now();
      const heading = this.heading(sim, act, evalPlan(sim.agents[i].plan, now), now);
      return {
        ok: true, ...extra,
        ...(heading ? { heading: act.place || null, arrivesIn: this.span(sim, act.travelEnd - now), then: this.doing(sim, i, act, after) }
          : { now: act ? { doing: this.doing(sim, i, act, after), at: act.place ? aiName(act.place, 'a place') : null } : null }),
        ...(o ? { order: this.orderView(sim, o) } : {}),
      };
    };
    switch (String(b.action || '')) {
      case 'do': {
        const what = String(b.activity || '');
        if (!Object.hasOwn(ACTIVITIES, what)) throw new AgentApiError(400, 'bad_activity', `activity is one of: ${Object.keys(ACTIVITIES).join(', ')}`);
        gap('order', L.doGapMs);
        if (KEEPS.has(what)) return result(sim.order(i, { kind: what, minutes: minutes(def), maxMinutes: hi }), { activity: what });
        sim.endOrder(i);
        return result({ ok: sim.command(i, what), why: 'not_possible' }, { activity: what });
      }
      case 'go': {
        const want = norm(b.place);
        if (!want) throw new AgentApiError(400, 'no_place', 'Name a place (look shows places nearby)');
        gap('order', L.doGapMs);
        if (want === 'home' || want === 'work') return result(sim.order(i, { kind: want, minutes: minutes(def), maxMinutes: hi }), { place: want });
        const found = this.findPlace(sim, i, b.place);
        if (found.why) return { ok: false, why: found.why, ...(found.candidates ? { candidates: found.candidates } : {}) };
        const p = found.place;
        return result(sim.order(i, { kind: VENUE_KINDS[p.kind] || p.kind, venue: p.venue, minutes: minutes(def), maxMinutes: hi }), { place: p.name, kind: p.kind });
      }
      case 'meet': {
        gap('order', L.doGapMs);
        const who = this.personNamed(sim, i, b.name);
        if (!who) return { ok: false, why: `nobody called "${clean(b.name, 40)}" is in the city right now (someone just arriving takes a minute to appear: try again soon)` };
        // a lasting order: it walks up to them and stays with them, following them while they are outdoors, in public
        // places or where it is; somewhere private (a home, an office) the order ends and its AI is told
        return result(sim.order(i, { kind: 'meet', who: who.j, minutes: minutes(L.meetMinutes), searchMinutes: L.meetSearchMinutes, maxMinutes: hi }), { meeting: who.name, distanceM: who.distanceM });
      }
      case 'stop': {
        gap('order', L.doGapMs);
        mark('order');
        return { ok: true, stopped: sim.endOrder(i), note: 'from its next choice its Free Will and routine decide again' };
      }
      case 'say': {
        const text = clean(b.text, 400);
        if (!text) throw new AgentApiError(400, 'empty', 'Write what to say');
        const mind = this.mindOf();
        if (!mind?.voice) throw new AgentApiError(503, 'no_speech', 'Speaking out loud is not available here');
        if (mind.config?.().speech === false) throw new AgentApiError(503, 'speech_off', 'Lines out loud are turned off on this world for now');   // (the admin's one switch, every agent)
        // (counted per world day, as for every agent: the admin's one setting for lines out loud)
        const wd = mind.dayOf?.(i)?.lifeDay, day = `${a.id}:${Number.isFinite(wd) ? `w${wd}` : utcDay(t)}`, n = this.days.get(day) || 0;
        if (n >= L.sayPerDay) throw new AgentApiError(429, 'day_limit', 'That is enough talking out loud for today (a world day)');
        let to = null;
        if (b.to) {
          const who = this.personNamed(sim, i, b.to);
          if (!who) return { said: false, why: `nobody called "${clean(b.to, 40)}" is in the city right now` };
          if (!who.sameFloor) {
            const me = evalPlan(sim.agents[i].plan, sim.now());
            return { said: false, why: `${who.name} is ${this.placeOf(sim, who.e.ctx) === 'outdoors' ? 'outdoors' : `in ${this.placeOf(sim, who.e.ctx)}`} and you are ${this.placeOf(sim, me.ctx) === 'outdoors' ? 'outdoors' : `in ${this.placeOf(sim, me.ctx)}`}: you can't talk through walls — meet them first` };
          }
          if (who.distanceM > L.hearM) return { said: false, why: `${who.name} is ${who.distanceM} m away: they hear you within ${L.hearM} m — meet them first`, distanceM: who.distanceM };
          to = who;
        }
        gap('say', L.sayGapMs); mark('say');
        this.days.set(day, n + 1);
        if (to) { sim.hold(i, to.e.x, to.e.z, sim.brain.wm(3), `Talking with ${to.name}`, to.j); this.addressed.set(i, { to: to.j, until: t + WORLD_LIMITS.addressedMs }); }
        const v = await mind.voice(a, text);
        return v.shown ? { said: true, text: v.text, ...(to ? { to: to.name } : {}) } : { said: false, why: v.reason || v.moderation, ...(v.categories?.length ? { categories: v.categories } : {}) };
      }
      case 'plan': {
        write();
        const plans = life.addIntention(a.id, { kind: b.kind === 'must' ? 'must' : 'want', text: b.text, today: b.today !== false }, 'mind');   // (its AI is its mind)
        return { ok: true, plans: plans.filter(p => p.status === 'open').map(p => ({ id: p.id, kind: p.kind, text: p.text })) };
      }
      case 'plan_done': {
        write();
        const plans = life.setIntention(a.id, Number(b.id), b.dropped ? 'dropped' : 'done');
        return { ok: true, plans: plans.filter(p => p.status === 'open').map(p => ({ id: p.id, kind: p.kind, text: p.text })) };
      }
      case 'remember': {
        write();
        life.addMemory(a.id, { term: b.long ? 'long' : 'short', kind: 'note', text: b.text, importance: Number.isInteger(b.importance) ? b.importance : 3 }, 'mind');
        return { ok: true };
      }
      // ---- focused questions (2026-10-12): a small answer about one thing, instead of the whole look
      case 'about': return this.about(a, sim, life, b.name);
      case 'plans': {
        const S = this.socialOf(), order = sim.orderOf(i);
        return { plans: life.intentions(a.id).filter(p => p.status === 'open').map(p => ({ id: p.id, kind: p.kind, text: p.text, today: p.today })),
          appointments: S ? S.invitesOf(a.id) : [], order: order ? this.orderView(sim, order) : null };
      }
      case 'memories': {
        const want = normName(b.about), max = Math.max(1, Math.min(12, Number(b.limit) || 8));
        const all = [...life.memories(a.id, { term: 'long', limit: 200 }), ...life.memories(a.id, { term: 'short', limit: 200 })];
        const hits = all.filter(m => !want || normName(m.text).includes(want) || (m.people || []).some(x => normName(x).includes(want)) || normName(m.place).includes(want));
        return { about: b.about || null, memories: hits.slice(0, max).map(m => ({ text: m.text, term: m.term, kind: m.kind, when: m.when || undefined, place: m.place || undefined })),
          ...(hits.length > max ? { more: hits.length - max } : {}) };
      }
      case 'conversation': {
        const S = this.social();
        let other; try { other = S.target(a.id, b.with); } catch (e) { return { ok: false, why: e.message } ; }
        const n = Math.max(1, Math.min(30, Number(b.limit) || 10));
        return { with: aiName(other.name), messages: S.thread(a.id, other.id, { limit: n }).reverse().map(m => ({ from: m.mine ? 'you' : aiName(other.name), kind: m.kind, text: m.text,
          at: new Date(m.created).toISOString(), ...(m.kind === 'invite' ? { place: m.place, time: m.at } : {}), ...(m.status === 'refused' ? { refused: true } : {}) })) };
      }
      // ---- friends (server/agent-social/): its own words and choices; the world checks every one
      case 'friends': return { friends: this.social().friendsOf(a.id, { max: 30 }).map(({ agent, ...f }) => f), invites: this.social().invitesOf(a.id) };
      case 'whereis': return this.social().whereIs(a.id, b.name);
      case 'message': return this.social().message(a.id, b.to, b.text, { replyTo: b.replyTo ?? null });
      case 'invite': {
        const S = this.social(), found = this.findPlace(sim, i, b.place);
        if (found.why) return { ok: false, why: found.why, ...(found.candidates ? { candidates: found.candidates } : {}) };
        const at = this.worldTime(sim, b);
        if (at.why) return { ok: false, why: at.why };
        const p = found.place;
        return S.invite(a.id, b.to, { venue: { b: p.venue.b, f: p.venue.f, kind: p.kind, name: p.name }, atWorld: at.world, stayMinutes: b.minutes, note: b.note });
      }
      case 'answer': return this.social().answer(a.id, Number(b.id), b.yes === true || b.yes === 'yes' || b.yes === 'true');
      case 'cancel': return this.social().cancel(a.id, Number(b.id));
      case 'unfriend': return this.social().unfriend(a.id, b.name, { by: 'agent' });
      case 'block': return this.social().block(a.id, b.name, true, { by: 'agent' });
      case 'unblock': return this.social().block(a.id, b.name, false, { by: 'agent' });
      default: throw new AgentApiError(400, 'bad_action', 'action is one of: do, go, meet, stop, say, plan, plan_done, remember, about, plans, memories, conversation, friends, whereis, message, invite, answer, cancel, unfriend, block, unblock');
    }
  }
}

/** The two routes, for the agent's bearer token (the mailbox's door: never a browser session). A refusal answers with its
 *  code, message and retryAfter (seconds) in the JSON. */
export function addAgentWorldRoutes(router, { world, LifeError, SocialError = null }) {
  const call = async fn => {
    try { return { status: 200, json: await fn() }; } catch (e) {
      if (e instanceof AgentApiError || (LifeError && e instanceof LifeError) || (SocialError && e instanceof SocialError)) {
        return { status: e.status, json: { error: e.message, code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}), ...(e.categories ? { categories: e.categories } : {}) }, headers: e.retryAfter ? { 'retry-after': String(e.retryAfter) } : null };
      }
      throw e;
    }
  };
  router.add({ method: 'GET', path: '/api/agent-api/world', cap: 'public', principal: 'agent', auth: 'bearer', handler: ({ A, url }) => call(() => world.look(A, { brief: url.searchParams.get('brief') === '1' })) });
  router.add({ method: 'POST', path: '/api/agent-api/act', cap: 'public', principal: 'agent', auth: 'bearer', handler: ({ A, body }) => call(() => world.act(A, body)) });
}
