// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents cooking on their shifts (PLAN-RESTAURANT-GAME.md "Progression" P3, 2026-10-28, the product owner: "for agents, I
// want the same skill system and badge system so that agents and players are scored within the same, with the same
// criteria, and their achievements are visible and comparable to players"). An agent posted at a kitchen's station (its
// owner's ⋯ on the pass, or the Studio: server/agent-posts/), on duty (24/7, or its work hours now), cooks Rushes there:
// the server lays each out as for a player (the kitchen's record, the agent's own skills), the agent cooks it beat by
// beat as a player would (shared/orderup/cook-bot.js: the coach's steps at the pace and with the slips of its level), and
// after the Rush's real minutes the server plays it again from what it pressed and records it, exactly as a player's:
// score, stars, experience (half, unattended: server/play/play.js AUTO_XP), its Order Up level and rank, badges, the
// Cookbook. A few minutes' break between Rushes, at most AUTO_DAY a day. An agent with Free Will spends its own skill
// points on what its kitchen needs (unless its owner keeps that choice); else its owner spends them. Its owner hears of
// its badges and levels.
import { COURSES } from '../../shared/orderup/module.js';
import { cookRush } from '../../shared/orderup/cook-bot.js';
import { SKILLS, skillAt, SKILL_MAX } from '../../shared/orderup/skills.js';
import { onHours } from '../../shared/shifts.js';

const TICK_MS = 20000, BREAK_MS = 4 * 60000, AUTO_DAY = 16, DAY_MS = 86400e3;

export class KitchenShifts {
  /** o: { play: PlayCore, cooks: CookRecord, posts: Posts, world(), freeWill?(agentId) → on, notify?(accountId, m), ownerOf?(agent) → account id, now?, log? } */
  constructor({ play, cooks, posts, world, freeWill = () => false, notify = null, ownerOf = a => a.ownerId ?? null, now = () => Date.now(), log = null }) {
    Object.assign(this, { play, cooks, posts, worldOf: world, freeWill, notify, ownerOf, now, log });
    this.state = new Map();   // agent id → { run, next, done: [times] , last }
    this.timer = null;
  }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[orderup] shifts', e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  /** The agents cooking now: [{ agent, b, f, item }] — on post at a kitchen's station (24/7), or working one on its hours. */
  onDuty() {
    const W = this.worldOf(), sim = this.posts.simOf(), people = sim?.people || [], out = [];
    let clock = null;
    for (const a of this.posts.agents.list()) {
      const i = this.posts.bodyOf(a), p = i >= 0 ? people[i] : null; if (!p || p.retired) continue;
      let r = p.post;
      if (!r && p.job && ['office', 'vip', 'staff'].includes(p.job.kind)) { clock ||= this.posts.clockNow(); if (onHours({ start: p.job.start, end: p.job.end, days: p.job.days ?? 31 }, clock.h, clock.day)) r = p.job; }
      if (!r) continue;
      const B = W.buildings[r.b], L = B && !B.gone ? W.levels[B.lv?.[r.f]] : null, it = L?.items.find(x => x.id === r.id);
      if (!it?.t?.startsWith('ou_') || !(L.mods || []).some(m => m.kind === 'kitchen' && m.id === it.mod)) continue;
      out.push({ agent: a, b: r.b, f: r.f, item: r.id });
    }
    return out;
  }
  /** One look: Rushes ended are recorded, those due begun. */
  tick() {
    const t = this.now(), duty = this.onDuty(), here = new Set(duty.map(d => d.agent.id));
    for (const [id, s] of this.state) if (s.run && t >= s.run.due) this.end(id, s);
    for (const d of duty) {
      const s = this.state.get(d.agent.id) || { next: 0, done: [] }; this.state.set(d.agent.id, s);
      s.done = s.done.filter(x => t - x < DAY_MS);
      if (!s.run && t >= s.next && s.done.length < AUTO_DAY) this.begin(d, s);
    }
    for (const [id, s] of this.state) if (!s.run && !here.has(id) && t - (s.lastAt || 0) > DAY_MS) this.state.delete(id);
  }
  /** A Rush begun for agent d: laid out by the server, cooked by the agent now, recorded once its minutes have passed. */
  begin(d, s) {
    const cook = { id: -d.agent.id }, pr = this.play.progress(cook.id).modules.orderup;
    const open = COURSES.filter(c => pr.unlocked.includes(c.id)), course = open[open.length - 1] || COURSES[0];
    let st;
    try { st = this.play.start(cook, 'orderup', course.id, { b: d.b, f: d.f }, { auto: true }); }
    catch (e) { s.next = this.now() + BREAK_MS; this.log?.info?.(`[orderup] ${d.agent.name} can't cook at ${d.b}:${d.f}: ${e.message}`); return; }
    const { log } = cookRush(st.data, course, { level: pr.level });
    s.run = { id: st.run, log, course, due: this.now() + course.dur * 1000 + 1500, at: { b: d.b, f: d.f }, stations: st.data.stations };
  }
  /** A Rush's minutes over: the server plays it again and records it (as a player's); the agent's skill points spent when
   *  it chooses them itself; its owner told of new badges and levels. */
  end(id, s) {
    const run = s.run, cook = { id: -id }, a = this.posts.agents.get(id); s.run = null;
    const t = this.now(); s.next = t + BREAK_MS; s.done.push(t); s.lastAt = t;
    let r;
    try { r = this.play.finish(cook, run.id, { log: run.log }); } catch (e) { this.log?.warn?.('[orderup] an agent\'s Rush', e.message); return; }
    if (!r?.ok) { this.log?.info?.(`[orderup] ${a?.name}'s Rush did not count: ${r?.why}`); return; }
    let c = null; try { c = this.cooks.afterRush(cook.id, r); } catch (e) { this.log?.warn?.('[orderup] an agent\'s Cookbook', e.message); }
    const badges = [...(r.badges || []), ...(c?.badges || [])];
    s.last = { course: run.course.id, label: run.course.label, score: r.score, stars: r.stars, xp: r.xp, level: r.module.level, badges: badges.map(b => b.id), at: t };
    if (a && this.chooses(a)) this.spend(a, run.stations);
    const owner = a ? this.ownerOf(a) : null;
    if (owner && this.notify && (badges.length || r.module.level > r.module.was)) {
      const bits = [...(r.module.level > r.module.was ? [`reached Order Up level ${r.module.level}`] : []), ...badges.map(b => `earned ${b.icon} ${b.label}`)];
      try { this.notify(owner, { t: 'mind', ev: 'note', agent: { id: a.id, name: a.name }, text: `${a.name} ${bits.join(', ')} cooking ${run.course.label} (${r.score} pts, ${'★'.repeat(r.stars) || 'no stars'})` }); } catch { /* the owner's notice is a courtesy */ }
    }
  }
  /** Whether agent a spends its own skill points: with Free Will on, unless its owner keeps that choice (cook.js mode). */
  chooses(a) { return this.cooks.modeOf(-a.id) === 'self' || (this.cooks.modeOf(-a.id) !== 'owner' && !!this.freeWill(a.id)); }
  /** Its points into what its kitchen has most of (the stations a skill helps at), the lowest rank first between equals. */
  spend(a, stations) {
    const id = -a.id, weight = {};
    for (const x of stations || []) { const k = skillAt(x.t); if (k) weight[k.id] = (weight[k.id] || 0) + 1; }
    weight.service = (weight.service || 0) + 1.5;   // (every kitchen serves)
    for (let n = 0; n < 40; n++) {
      const v = this.cooks.skills(id); if (!v.points.free) break;
      const pick = SKILLS.filter(k => weight[k.id] && (v.list.find(x => x.id === k.id)?.rank || 0) < SKILL_MAX)
        .sort((x, y) => weight[y.id] / (1 + (v.list.find(q => q.id === y.id).rank)) - weight[x.id] / (1 + (v.list.find(q => q.id === x.id).rank)))[0];
      if (!pick) break;
      try { this.cooks.skill(id, pick.id); } catch { break; }
    }
  }
  /** What the page shows of an agent's cooking now: { cooking (a Rush on), at, next, today, last }. */
  view(agentId) {
    const s = this.state.get(Number(agentId));
    return s ? { cooking: !!s.run, course: s.run?.course.label || null, ends: s.run?.due || null, next: s.next || null, today: s.done.filter(x => this.now() - x < DAY_MS).length, cap: AUTO_DAY, last: s.last || null } : { cooking: false, today: 0, cap: AUTO_DAY, last: null };
  }
}
