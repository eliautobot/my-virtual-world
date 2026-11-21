// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who is at work (2026-11-16, the product owner: "if the agent is not at their post then they cant be on the air or at
// their post ... co-hosts need to recognize which agents are there and arent, because they still end up talking as if
// they are there. so this needs to be part of the Radio station positions or any other positions because this will lead
// to other posts and future jobs like kitchens and stores, agents need to know their positions, posts, and co-workers and
// their role so that agents know when a co-worker is missing, late, or will be back soon"; the late mark: 5 minutes;
// residents too; the reason may be said: docs/features/work-presence.md).
//
// One staff list for every workplace, made from what is already set up — nothing to set up again:
// - Positions: everyone whose job is at a piece of furniture (an office desk, a café counter, a bar, a checkout, a
//   reception desk, a kitchen's pass and stations, a radio studio's broadcast desk and DJ booth) by its hours, and every
//   agent on post there around the clock (server/agent-posts/). Their role comes from the piece (a radio host, a DJ, a
//   cook, a cashier …) or their job's title. Their workplace: the room it stands in (a studio, a kitchen: an interior
//   module) or the venue's floor.
// - A status for each, from what their body is doing this moment (the simulation's own act and order — never the
//   timetable alone): on duty (at their place), on the way (its arrival time), late (their shift started more than
//   work.lateMinutes ago and they aren't there), away (gone off during their shift: out with someone, at a meet-up,
//   errands — the reason in words), on a break (back at a given time), or off shift.
// - What changes is noticed (a look every few seconds): someone late, someone arriving (late or not), someone leaving
//   during their shift, someone back. Those are the moments the agents may say something about (./remarks.js) and the
//   agent remembers (its life's memory).
// Everything else asks this one place: the radio (only those in the studio are on the air; the others' absence is known
// to who is), the kitchens (a cook cooks only at the pass), the agents' minds (their work and their co-workers), the
// screens (a seat's sign, the person's card, the Companions bar).
// Nothing here draws a simulation random number or changes anyone's plan: it only looks.
import { CATALOG } from '../../shared/catalog.js';
import { onHours, shiftClock } from '../../shared/shifts.js';
import { roleOf, ROLE_TITLE } from '../../shared/nightlife.js';
import { formatClock } from '../../shared/constants.js';
import { evalPlan } from '../sim/plan.js';

export const LATE_MINUTES = 5;          // world minutes into a shift without them: late (Settings: work.lateMinutes)
const INDEX_MS = 20000;                 // the staff lists are made again this often (jobs change by hiring, posting, moving)
const TICK_MS = 4000;                   // a look at everyone at work
const STATES = Object.freeze(['on_duty', 'coming', 'late', 'away', 'break', 'off']);
const WORK_KINDS = new Set(['office', 'vip', 'staff', 'post']);
const REINDEX_MS = 250;                 // a changed job or post makes the lists again at most this often

/** What person p's place at work is, in a word (its post, else its job at a piece) — '' for none: a change shows. */
function sigOf(p) {
  if (!p || p.retired) return '';
  const r = p.post || (p.job && WORK_KINDS.has(p.job.kind) && Number.isInteger(p.job.b) && Number.isInteger(p.job.id) ? p.job : null);
  return r ? `${r.b}:${r.f}:${r.id}:${r.k}:${p.post ? 'p' : `${p.job.start}-${p.job.end}-${p.job.days ?? 31}`}` : '';
}
const ACTS_AT_WORK = new Set(['work', 'post']);

/** A role in words for a piece of furniture of type t at its slot k (the person's job for the rest: its title). */
export function roleAt(t, k, job = null) {
  if (t === 'broadcast_desk') return 'radio host';
  if (t === 'studio_dj') return 'DJ';
  if (/^ou_/.test(t) || t === 'kitchen' || t === 'counter') return 'cook';
  if (t === 'checkout') return 'cashier';
  if (t === 'reception') return 'receptionist';
  if (t === 'fish_counter') return 'fishmonger';
  const r = roleOf(t, k);
  if (r && ROLE_TITLE[r]) return ROLE_TITLE[r] === 'DJ' ? 'DJ' : ROLE_TITLE[r].toLowerCase();
  if (job?.venue === 'cafe' && /counter|bar/.test(t)) return 'barista';
  if (job?.venue === 'restaurant' && /counter|bar/.test(t)) return 'server';
  const title = String(job?.title || '').split(' at ')[0].trim();
  if (title && !/^agent$/i.test(title)) return title.length > 40 ? title.slice(0, 40) : title;
  return (CATALOG[t]?.name || 'staff').toLowerCase();
}

export class WorkPresence {
  /**
   * o: { sim(), world(), agents (records: byKey), setting(path), playerName(accountId) → name, now(), log }
   *   sim: the simulation (people, agents, brain, now); world: the city (buildings, levels).
   */
  constructor({ sim, world, agents = null, setting = () => undefined, playerName = () => null, now = () => Date.now(), log = null }) {
    Object.assign(this, { simOf: sim, worldOf: world, agents, setting, playerName, now, log });
    this.places = new Map();     // workplace key → { key, b, f, room, name, members: [i] }
    this.byPerson = new Map();   // person i → position { i, key (workplace), seat: 'b:f:id:k', b, f, id, k, t, role, hours, post }
    this.bySeat = new Map();     // 'b:f:id:k' → [i] (several may share a seat by their hours)
    this.ledger = new Map();     // person i → { shift, state, since (sim t), arrived, lateBy, away (sim s), reason, onDutyOnce }
    this.listeners = new Set();
    this.builtAt = -Infinity;
    this.cache = new Map();      // person i → { at (sim t), s } (one look per moment)
    this.stats = { builds: 0, ticks: 0, events: 0, lastBuildMs: 0, lastTickMs: 0 };
    this.timer = null;
  }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[work] look failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }
  /** fn(event): { type: 'late'|'arrived'|'left'|'back', i, pos, status, lateBy?, awayMin? } — each moment once. */
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  lateMinutes() { const v = Number(this.setting('work.lateMinutes')); return Number.isFinite(v) && v >= 1 ? v : LATE_MINUTES; }

  // ------------------------------------------------------------------------------------------- the staff lists
  /** The staff lists, made again when they are older than INDEX_MS (or forced). */
  index(force = false) {
    const t = this.now();
    if (!force && t - this.builtAt < INDEX_MS) return;
    const t0 = Date.now(), sim = this.simOf(), W = this.worldOf();
    this.builtAt = t;
    this.places.clear(); this.byPerson.clear(); this.bySeat.clear();
    if (!sim || !W) return;
    const items = new Map();   // 'b:f:id' → { it, L } (the piece and its floor)
    const itemOf = (b, f, id) => {
      const key = `${b}:${f}:${id}`;
      if (items.has(key)) return items.get(key);
      const B = W.buildings[b], L = B && !B.gone && f >= 0 && f < B.floors ? W.levels[B.lv[f]] : null, it = L?.items?.find(x => x.id === id) || null;
      const v = it ? { it, L } : null; items.set(key, v); return v;
    };
    const people = sim.people || [];
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p || p.retired) continue;
      const post = p.post || null, j = p.job || null;
      const r = post || (j && WORK_KINDS.has(j.kind) && Number.isInteger(j.b) && Number.isInteger(j.id) ? j : null);
      if (!r) continue;
      const found = itemOf(r.b, r.f, r.id);
      if (!found) continue;
      const { it, L } = found, room = it.mod || 0, mod = room ? (L.mods || []).find(m => m.id === room) : null;
      const key = `${r.b}:${r.f}:${room}`;
      let place = this.places.get(key);
      if (!place) {
        const name = (mod?.name && String(mod.name)) || sim.brain?.placeName?.(r.b, r.f) || W.buildings[r.b]?.name || 'work';
        place = { key, b: r.b, f: r.f, room, name, kind: mod?.kind || L.venue || null, members: [] };
        this.places.set(key, place);
      }
      const all = !!post || j?.kind === 'post';
      const pos = { i, key, sig: sigOf(p), seat: `${r.b}:${r.f}:${r.id}:${r.k}`, b: r.b, f: r.f, id: r.id, k: r.k, t: it.t, role: roleAt(it.t, r.k, j), hours: all ? { all: true } : { start: j.start, end: j.end, days: j.days ?? 31 }, post: all };
      this.byPerson.set(i, pos);
      place.members.push(i);
      const s = this.bySeat.get(pos.seat) || []; s.push(i); this.bySeat.set(pos.seat, s);
    }
    this.stats.builds++; this.stats.lastBuildMs = Date.now() - t0;
  }
  /** Person i's position — the lists made again first when its job or post changed since (posted a moment ago, hired,
   *  let go: at most every REINDEX_MS, a few milliseconds each). */
  positionOf(i) {
    this.index();
    const pos = this.byPerson.get(i) || null, p = this.simOf()?.people?.[i];
    if ((pos ? pos.sig : '') !== sigOf(p) && this.now() - this.builtAt >= REINDEX_MS) { this.index(true); return this.byPerson.get(i) || null; }
    return pos;
  }
  placeOf(key) { this.index(); return this.places.get(key) || null; }

  // ------------------------------------------------------------------------------------------- a person's status
  /**
   * Person i's status at work now: null (no workplace), or { state: on_duty | coming | late | away | break | off,
   * role, place, since?, eta (world minutes, or null), lateBy (world minutes, or null), reason (words, or ''), text (the
   * status in a few words), shiftStart (a clock, or null), onShift }.
   */
  status(i) {
    const pos = this.positionOf(i);
    if (!pos) return null;
    const sim = this.simOf(), t = sim.now(), c = this.cache.get(i);
    if (c && c.at === t) return c.s;
    const s = this.look(pos, t);
    this.cache.set(i, { at: t, s });
    if (this.cache.size > 20000) this.cache.clear();
    return s;
  }
  look(pos, t) {
    const sim = this.simOf(), B = sim.brain, a = sim.agents[pos.i], p = sim.people[pos.i];
    const place = this.places.get(pos.key)?.name || '';
    const base = { role: pos.role, place, seat: pos.seat, post: pos.post };
    if (!a || !p) return { ...base, state: 'off', onShift: false, eta: null, lateBy: null, reason: '', text: 'Not at work', shiftStart: null };
    const h = B.hour(t), day = B.day(t), wm = B.wm(1);
    const onShift = pos.hours.all || onHours(pos.hours, h, day);
    const sc = pos.hours.all ? null : shiftClock(pos.hours, h, day);
    const into = sc ? (sc.h - pos.hours.start) * 60 : null;   // world minutes since its shift started
    const shiftStart = pos.hours.all ? null : formatClock(pos.hours.start % 24);
    const act = a.act, late = this.lateMinutes();
    const order = B.liveOrder ? B.liveOrder(a, t) : a.order || null;
    const atSeat = !!act && ACTS_AT_WORK.has(act.kind) && act.b === pos.b && act.f === pos.f && act.id === pos.id && act.k === pos.k;
    const arrive = act ? (Number.isFinite(act.travelEnd) ? act.travelEnd : act.holdStart) : null;
    // where its body is this moment: in its workplace's building (at work, if not at its own place: a meeting, the phone,
    // back to its seat between rounds — not "away")
    const e = a.plan ? evalPlan(a.plan, t) : null, inside = !!e && e.ctx >= 0 && (e.ctx >> 6) === pos.b;
    // at its very place now (the radio's desk, the kitchen's station) — or in the building on its way to it, the last few
    // steps (between two rounds there, or put back after the building moved: not off the air for those seconds)
    const seated = atSeat && (t >= arrive - 0.5 || inside);
    const mins = s => Math.max(0, Math.round(s / wm));
    const led = this.ledger.get(pos.i);
    const wasHere = !!(led && led.shift === this.shiftKey(pos, sc, day) && led.onDutyOnce);
    const onBreak = !!act && (act.kind === 'break' || act.kind === 'meal');
    let state, eta = null, reason = '', lateBy = null;
    if (!onShift) state = 'off';
    else if (order && !seated && this.orderTakesAway(order)) {
      // (kept away by an order: away once it had been there this shift; not there yet and past the late mark: late)
      reason = this.orderReason(order);
      if (!wasHere && into !== null && into >= late) { state = 'late'; lateBy = Math.round(into); } else state = 'away';
    } else if (seated) state = 'on_duty';
    else if (onBreak && (inside || wasHere)) {
      state = 'break'; reason = act.kind === 'meal' ? 'on a meal break' : 'on a short break';
      eta = Number.isFinite(act.holdEnd) && act.holdEnd > t ? mins(act.holdEnd - t) : null;
    } else if (inside && (atSeat || wasHere)) state = 'on_duty';   // (in, on the way to its place, or about the workplace)
    else if (atSeat) {
      eta = mins(arrive - t);
      if (wasHere) { state = 'away'; reason = 'on the way back'; }
      else { state = into !== null && into >= late ? 'late' : 'coming'; reason = 'on the way'; if (state === 'late') lateBy = Math.round(into); }
    } else {
      const doing = this.doingWords(a, act);
      if (wasHere) { state = 'away'; reason = doing; }
      else if (into === null || into >= late) { state = 'late'; reason = doing; lateBy = into === null ? null : Math.round(into); }
      else { state = 'coming'; reason = doing; }
    }
    return { ...base, state, onShift, seated, eta, lateBy, reason, text: this.words(state, { eta, lateBy, reason, shiftStart }), shiftStart };
  }
  /** Whether an order takes them away from work: going with someone, waiting somewhere for them, a meet-up, an errand —
   *  anything but its own work (a companion's order, an AI's errand, a meeting). */
  orderTakesAway(o) { return !!o && o.kind !== 'work' && o.kind !== 'post'; }
  /** Why an order keeps them away, in a few words anyone could see ("out with Kim", "at a meet-up at Founders Park"). */
  orderReason(o) {
    const sim = this.simOf();
    if (o.kind === 'follow' && o.lead) {
      if (o.lead.kind === 'player') return `out with ${this.playerName(o.lead.id) || o.leadName || o.byName || 'someone'}`;
      return `out with ${sim.people[o.lead.i]?.name || o.leadName || 'someone'}`;
    }
    if (o.kind === 'hold') return o.group ? `at a meet-up${o.spot?.place ? ` at ${o.spot.place}` : ''}` : `waiting${o.spot?.place ? ` at ${o.spot.place}` : ' somewhere'}${o.by != null ? ` for ${this.playerName(o.by) || o.byName || 'someone'}` : ''}`;
    if (o.kind === 'meet') return `meeting ${o.who != null ? sim.people[o.who]?.name || 'someone' : 'someone'}`;
    if (o.venue) return `out at ${sim.brain.placeName(o.venue.b, o.venue.f) || 'another place'}`;
    return o.goal ? String(o.goal).toLowerCase().slice(0, 60) : 'out on an errand';
  }
  /** What they are doing instead, in a few words ("still asleep", "at the gym", "on the way"). */
  doingWords(a, act) {
    if (!act) return '';
    if (act.use === 'sleep' || act.use === 'nap') return 'still asleep';
    const label = String(act.label || '').trim();
    if (!label) return '';
    const l = label.charAt(0).toLowerCase() + label.slice(1);
    return l.length > 60 ? `${l.slice(0, 57)}…` : l;
  }
  /** Whether its body is in its workplace's building now (a break taken there). */
  inBuilding(a, pos, t) { const ctx = a.act?.ctx ?? -1; void t; return ctx >= 0 && (ctx >> 6) === pos.b; }
  /** Its shift's key (one per shift: the day it started), for the day's ledger. */
  shiftKey(pos, sc, day) { return pos.hours.all ? `d${day}` : `s${sc ? sc.day : day}`; }
  /** The status in a few words, for the screens and the prompts. */
  words(state, { eta, lateBy, reason, shiftStart }) {
    const back = eta !== null && eta !== undefined ? (eta <= 1 ? 'back any moment' : `back in about ${eta} min`) : '';
    switch (state) {
      case 'on_duty': return 'On duty';
      case 'coming': return eta !== null && eta !== undefined ? `On the way (about ${Math.max(1, eta)} min)` : `Due in${shiftStart ? ` at ${shiftStart}` : ''}`;
      case 'late': return `Late${lateBy ? ` (${lateBy} min)` : ''}${reason && reason !== 'on the way' ? ` — ${reason}` : eta !== null && eta !== undefined ? `, on the way (about ${Math.max(1, eta)} min)` : ''}`;
      case 'away': return `Away${reason ? ` — ${reason}` : ''}${eta !== null && eta !== undefined ? ` (${back})` : ''}`;
      case 'break': return `On a break${back ? ` — ${back}` : ''}`;
      default: return shiftStart ? `Off shift (starts ${shiftStart})` : 'Off shift';
    }
  }

  // ------------------------------------------------------------------------------------------- for the others
  /** Whether person i is at seat 'b:f:id:k' itself now, on duty (the radio's desk or booth, a kitchen's station): in the
   *  building is at work, but on the air or at the stove only at its place. */
  onDutyAt(i, seat) { const pos = this.positionOf(i); if (!pos || (seat && pos.seat !== seat)) return false; const s = this.status(i); return s?.state === 'on_duty' && !!s.seated; }
  /** Why person i is away from its work by an order this moment (out with someone, a meet-up, an errand), or '' — for
   *  work with no place of its own (a radio station with no studio: its hosts are wherever they are). */
  awayBy(i) {
    const sim = this.simOf(), a = sim?.agents[i];
    if (!a) return '';
    const o = sim.brain.liveOrder ? sim.brain.liveOrder(a, sim.now()) : a.order;
    return o && this.orderTakesAway(o) ? this.orderReason(o) : '';
  }
  /** Workplace key of person i, or null. */
  workplaceOf(i) { return this.positionOf(i)?.key || null; }
  /** The people of workplace `key` and their status: [{ i, name, role, state, text, reason, eta, lateBy, onShift, agent }]. */
  team(key, { exclude = -1 } = {}) {
    const place = this.placeOf(key); if (!place) return [];
    const sim = this.simOf(), out = [];
    for (const j of place.members) {
      if (j === exclude) continue;
      const p = sim.people[j], s = this.status(j); if (!p || !s) continue;
      out.push({ i: j, name: p.name, role: s.role, state: s.state, text: s.text, reason: s.reason, eta: s.eta, lateBy: s.lateBy, onShift: s.onShift, agent: !!(p.vip && p.agentId) });
    }
    const order = { on_duty: 0, coming: 1, late: 2, break: 3, away: 4, off: 5 };
    return out.sort((x, y) => order[x.state] - order[y.state] || x.name.localeCompare(y.name));
  }
  /** Person i's work, for its mind and its card: { role, place, hours, status, team } or null. */
  workOf(i, { teamMax = 12 } = {}) {
    const pos = this.positionOf(i), s = pos ? this.status(i) : null;
    if (!pos || !s) return null;
    const hours = pos.hours.all ? 'around the clock' : `${formatClock(pos.hours.start % 24)}–${formatClock(pos.hours.end % 24)}`;
    const all = this.team(pos.key, { exclude: i });
    return { role: pos.role, place: s.place, hours, state: s.state, text: s.text, reason: s.reason, onShift: s.onShift, lateBy: s.lateBy, eta: s.eta,
      team: all.filter(x => x.onShift).slice(0, teamMax), teamSize: all.length };
  }
  /** The workplace for the screens: { key, name, kind, staff: [...] } (everyone, on shift or not). */
  view(key) { const place = this.placeOf(key); if (!place) return null; return { key, name: place.name, kind: place.kind, b: place.b, f: place.f, room: place.room, staff: this.team(key) }; }

  // ------------------------------------------------------------------------------------------- the moments
  /** A look at everyone at work: what changed since the last look becomes an event (late, arrived, left, back). */
  tick() {
    const t0 = Date.now(), sim = this.simOf();
    if (!sim) return;
    this.index();
    const t = sim.now(), day = sim.brain.day(t), h = sim.brain.hour(t);
    for (const [i, pos] of this.byPerson) {
      const s = this.status(i);
      if (!s) continue;
      const sc = pos.hours.all ? null : shiftClock(pos.hours, h, day), shift = this.shiftKey(pos, sc, day);
      let led = this.ledger.get(i);
      if (!led || led.shift !== shift) { led = { shift, state: null, since: t, arrived: null, lateBy: null, away: 0, awayFrom: null, reason: '', why: '', whys: [], onDutyOnce: false, told: new Set() }; this.ledger.set(i, led); }
      const was = led.state;
      // (why it was late or away — what kept it, not "on the way": said when it gets in, so nobody makes one up)
      if ((s.state === 'late' || s.state === 'away') && s.reason && s.reason !== 'on the way' && s.reason !== 'on the way back' && led.whys.at(-1) !== s.reason) {
        // (what kept it first, and what it was doing last: "out with Kim, then eating")
        if (!led.whys.length) led.whys.push(s.reason); else led.whys[1] = s.reason;
        led.why = led.whys.join(', then ');
      }
      if (was === s.state) continue;
      led.state = s.state; led.since = t;
      // (the first look at them this shift — the server just started, a new day for one on post round the clock, a
      // new job: how things are now, no moment to speak of)
      if (was === null) {
        if (s.state === 'on_duty') { led.onDutyOnce = true; led.told.add('arrived'); }
        if (s.state === 'late') led.told.add('late');
        continue;
      }
      if (!s.onShift) continue;
      if (s.state === 'late' && was !== 'late' && !led.onDutyOnce) this.emit(led, 'late', { i, pos, status: s, lateBy: s.lateBy });
      if (s.state === 'on_duty') {
        if (!led.onDutyOnce) {
          led.onDutyOnce = true; led.arrived = t;
          // late by how long: its first arrival this shift, more than the late mark into it
          const into = sc ? Math.round((sc.h - pos.hours.start) * 60) : null;
          led.lateBy = into !== null && into >= this.lateMinutes() ? into : null;
          this.emit(led, 'arrived', { i, pos, status: s, lateBy: led.lateBy, reason: led.lateBy ? led.why || '' : '' });
        } else if (led.awayFrom !== null) {
          const awayMin = Math.round((t - led.awayFrom) / sim.brain.wm(1));
          led.away += t - led.awayFrom; led.awayFrom = null;
          this.emit(led, 'back', { i, pos, status: s, awayMin, reason: led.why || led.reason });
        }
      } else if (led.onDutyOnce && (s.state === 'away' || s.state === 'late') && was === 'on_duty') {
        led.awayFrom = t; led.reason = s.reason; led.whys = s.reason && s.reason !== 'on the way back' ? [s.reason] : []; led.why = led.whys.join('');
        this.emit(led, 'left', { i, pos, status: s });
      }
    }
    // ledgers of people no longer at work anywhere
    if (this.ledger.size > this.byPerson.size + 500) for (const i of this.ledger.keys()) if (!this.byPerson.has(i)) this.ledger.delete(i);
    this.stats.ticks++; this.stats.lastTickMs = Date.now() - t0;
  }
  emit(led, type, e) {
    // (each kind of moment once a shift for 'late' and 'arrived'; 'left' and 'back' as often as they happen)
    if ((type === 'late' || type === 'arrived') && led.told.has(type)) return;
    led.told.add(type);
    this.stats.events++;
    for (const fn of this.listeners) { try { fn({ type, ...e }); } catch (err) { this.log?.warn?.('[work] a listener failed:', err.message); } }
  }
}
export { STATES };
