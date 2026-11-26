// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The foxes' minds (2026-11-24, the product owner: "most animals run away from a very far distance if a player gets near
// ... I want the fox to be playful, interactable, and have its own unique playful behaviour ... make the fox feel
// alive"). A species with behaviour 'play' (shared/world-config/species/fox.json) is run here instead of the herds'
// graze-and-flee (server/world/wildlife.js step). A fox:
//   - on its own: wanders its patch, sniffs and digs, mouses (the high pounce) mostly at dusk and by night, sits and
//     looks about with its head cocked, curls up nose-to-brush for a nap in the middle of the day (stretching and
//     shaking itself when it gets up), now and then tears round in a circle of zoomies; two foxes play-chase each other;
//   - with people about: notices someone on foot within NOTICE m and comes to look, a little nearer each time (shy of a
//     stranger, sitting to watch from a distance; up close to a friend); trots after someone walking (never into town:
//     at the edge it sits and watches them go, then goes home); when they stand still it plays — a play bow, an excited
//     hop, zoomies round them, chasing its own tail, a pounce at their feet, a happy roll on its back for a friend;
//     someone sprinting at it starts a game of tag: it darts off, bows, waits to be chased again;
//   - only cars frighten it (it bolts from a moving car, then comes back to see);
//   - answers what a player does to it (wildlife.interact, the 'fox' message): pet (it comes to their feet and rolls
//     over or wags), a treat (it sits and begs, takes it, hops for joy), throw a stick (it watches the throw, races
//     after it, pounces on it, carries it back, drops it at their feet and bows for another), chase me (tag), bye (it
//     gives them a last look and trots off home, and leaves them be for a while);
//   - follows someone walking for a while only (FOLLOW_S): then it sits, watches them go, and lets them be (2026-11-24,
//     the product owner: "i dont like that the fox keeps following me");
//   - AI agents are people to it too (2026-11-24: "agents should be able to interact with animals the same way"): an
//     agent's body on foot is noticed, followed and played with as a player is, and its acts come through the
//     interaction registry (server/interactions/sources/animals.js) — from a little further off: the fox comes to it.
// Each fox remembers each player it has played with (trust 0..5: pets, treats, fetches; it fades over days) — a friend
// it knows runs up to greet them. Kept in memory: a fox forgets everyone when the server restarts.
//
// A member's plan (as the herds'): a segment { x, z, x1, z1, t0, t1, mode: rest | walk | run | orbit, yaw } with an act
// (one of ACTS: the clip the pages play — render/wildlife.js) and, in orbit, a circle: (x, z) its middle, x1 its
// radius, z1 the angle it starts at, arg its turn rate (rad/s). carry: the stick in its mouth.

import { ACTS, ACT_LEN, ONCE } from '../../shared/fauna-acts.js';
export { ACTS, ACT_LEN };

const NOTICE = 32;            // m: someone on foot this near is noticed (more for a friend)
const HOME_R = 45;            // m: its patch round its den
const LEASH = 160;            // m from its den it will follow someone
const TRUST_MAX = 5;
const TRUST_FADE = 3 * 86400; // s for a friend's trust to fade by one
const TROT = 2.6, WALK = 1.2, DASH = 7.5, ZOOM = 6.5;   // m/s
const REACH = { pet: 4.5, treat: 4.5, fetch: 14, chase: 14, bye: 30 };
const AGENT_REACH = 25;       // m: an agent's act reaches a fox this far (it comes over; its body may walk up too)
const FOLLOW_S = 40;          // s it trots after someone walking before it lets them go
const LET_GO_S = 300;         // s after that it won't follow them again (it may still come to play if they stand still)
const SHUN = 14;              // m it keeps from someone who said bye
const BYE_S = 600;            // s a "bye" keeps it away from them (unless they play with it again)

const hash = (s, n = 0) => { let h = 2166136261 ^ n; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
const yawTo = (dx, dz) => Math.atan2(-dz, dx);
const loops = (act, n) => ACT_LEN[act] * Math.max(1, Math.round(n));

export class Foxes {
  constructor() {
    this.trust = new Map();   // `${player}|${fox}` → { v, at }
    this.lastP = new Map();   // player id → { x, z, t, vx, vz }
    this.dirty = new Set();   // herds changed since the pages last heard (sent at once: wildlife.changed)
  }
  // ---------------------------------------------------------------- the people about
  /** Players and agents on foot this tick ([{ id, x, z, name, agent? }]) with their velocity (from their last place). */
  people(list, now) {
    const out = [];
    for (const p of list) {
      const was = this.lastP.get(p.id); let vx = 0, vz = 0;
      if (was && now > was.t) { const dt = now - was.t; vx = (p.x - was.x) / dt; vz = (p.z - was.z) / dt; if (Math.hypot(vx, vz) > 15) vx = vz = 0; }   // (a warp is not a sprint)
      // (smoothed a little: moves come in bursts)
      if (was) { vx = was.vx * 0.4 + vx * 0.6; vz = was.vz * 0.4 + vz * 0.6; }
      this.lastP.set(p.id, { x: p.x, z: p.z, t: now, vx, vz });
      out.push({ id: p.id, x: p.x, z: p.z, vx, vz, v: Math.hypot(vx, vz), name: p.name, agent: !!p.agent });
    }
    if (this.lastP.size > 500) for (const [k, v] of this.lastP) if (now - v.t > 60) this.lastP.delete(k);
    return out;
  }
  trustOf(pid, fid, now) {
    const T = this.trust.get(`${pid}|${fid}`); if (!T) return 0;
    return Math.max(0, T.v - (now - T.at) / TRUST_FADE);
  }
  befriend(pid, fid, by, now) {
    const k = `${pid}|${fid}`, v = Math.min(TRUST_MAX, this.trustOf(pid, fid, now) + by);
    this.trust.set(k, { v, at: now });
    if (this.trust.size > 20000) this.trust.delete(this.trust.keys().next().value);
    return v;
  }
  /** A fox's own state (its plan, whom it greeted, whom it said bye to or let go). */
  static mind(m) {
    const b = (m.b ||= { plan: [], greeted: new Map(), lastPlay: -1e9, tags: 0, nap: -1e9 });
    b.bye ||= new Map(); b.letGo ||= new Map();
    return b;
  }
  /** Whether person pid is in map M (bye, letGo) until a time not yet past (an old entry dropped). */
  static until(M, pid, now) {
    const t = M.get(pid); if (t == null) return false;
    if (now < t) return true;
    M.delete(pid); return false;
  }
  // ---------------------------------------------------------------- segments
  static at(m, now) {
    if (m.mode === 'orbit') { const a = m.z1 + m.arg * (Math.min(now, m.t1) - m.t0); return { x: m.x + Math.cos(a) * m.x1, z: m.z + Math.sin(a) * m.x1 }; }
    const u = m.t1 > m.t0 ? Math.min(1, Math.max(0, (now - m.t0) / (m.t1 - m.t0))) : 1;
    return { x: m.x + (m.x1 - m.x) * u, z: m.z + (m.z1 - m.z) * u };
  }
  rest(H, m, now, act, dur, yaw = m.yaw) {
    const p = Foxes.at(m, now);
    Object.assign(m, { x: p.x, z: p.z, x1: p.x, z1: p.z, t0: now, t1: now + dur, mode: 'rest', act: act || '', arg: 0, yaw });
    this.dirty.add(H);
  }
  go(H, m, now, gx, gz, speed, act = '') {
    const p = Foxes.at(m, now), len = Math.hypot(gx - p.x, gz - p.z);
    if (len < 0.15) return this.rest(H, m, now, act, 0.6);
    const mode = act ? 'rest' : speed > 3.2 ? 'run' : 'walk';
    Object.assign(m, { x: p.x, z: p.z, x1: gx, z1: gz, t0: now, t1: now + Math.max(0.4, len / speed), mode, act, arg: 0, yaw: yawTo(gx - p.x, gz - p.z) });
    this.dirty.add(H);
  }
  orbit(H, m, now, cx, cz, r, laps, speed, dir) {
    const p = Foxes.at(m, now), a0 = Math.atan2(p.z - cz, p.x - cx), w = dir * speed / Math.max(0.3, r);
    // (it starts on the circle where it is: a dash to the circle first if it is off it, the circle after)
    if (Math.abs(Math.hypot(p.x - cx, p.z - cz) - r) > 0.6) {
      m.b.plan.unshift({ k: 'orbit', x: cx, z: cz, r, laps, speed, dir });
      return this.go(H, m, now, cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, Math.max(TROT, speed * 0.8));
    }
    Object.assign(m, { x: cx, z: cz, x1: r, z1: a0, t0: now, t1: now + Math.abs(laps * 2 * Math.PI / w), mode: 'orbit', act: '', arg: w, yaw: yawTo(-Math.sin(a0) * w, Math.cos(a0) * w) });
    this.dirty.add(H);
  }
  // ---------------------------------------------------------------- a tick
  /** Advance the foxes of one group (H: its herd; I: the island; ctx { dry, town, threats, people, hour }). */
  step(H, now, ctx) {
    this.now = now;
    H.fox ||= { stick: null, wary: -1e9 };
    // the stick: lands at its time; a carried one goes with its carrier
    const S = H.fox.stick;
    if (S && S.state === 'flying' && now >= S.t1) { S.state = 'ground'; this.dirty.add(H); }
    if (S && S.state === 'ground' && now - S.t1 > 120) { H.fox.stick = null; this.dirty.add(H); }
    H.members.forEach((m, k) => this.member(H, m, k, now, ctx));
  }
  member(H, m, k, now, ctx) {
    const fid = `${H.id}:${k}`, b = Foxes.mind(m);
    const p = Foxes.at(m, now);
    // a moving car: bolt, whatever it was doing (a stick in its mouth is dropped)
    for (const T of ctx.threats) {
      if (!(T.r > 0)) continue;
      const d = Math.hypot(p.x - T.x, p.z - T.z);
      if (d < 16 + T.r && now - H.fox.wary > 4) {
        const ax = (p.x - T.x) / (d || 1), az = (p.z - T.z) / (d || 1), side = hash(fid, Math.floor(now)) > 0.5 ? 1 : -1;
        let gx = p.x + (ax - az * side * 0.5) * 26, gz = p.z + (az + ax * side * 0.5) * 26;
        if (!ctx.dry(gx, gz) || ctx.town(gx, gz)) { gx = H.ax; gz = H.az; }
        this.drop(H, m, now, p);
        b.plan = [{ k: 'act', act: 'tilt', n: 1, face: { x: T.x, z: T.z } }];   // (and looks back at it from safety)
        this.go(H, m, now, gx, gz, DASH); H.fox.wary = now;
        return;
      }
    }
    const people = ctx.people;
    // someone sprinting at it: tag — it darts off (unless busy with a stick or asleep)
    if (m.act !== 'sleep' && m.act !== 'liedown' && !m.carry && !b.fetch) {
      for (const q of people) {
        if (Foxes.until(b.bye, q.id, now)) continue;
        const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
        if (d < 6.5 && q.v > 4.2 && (q.vx * dx + q.vz * dz) / (d * q.v || 1) > 0.5 && !(m.mode === 'run' && now < m.t1)) { this.tag(H, m, k, now, ctx, q, p); return; }
      }
    }
    // a plan under way: the next step when this one is done (a step chasing someone is re-aimed as they move)
    if (now < m.t1) { this.reaim(H, m, now, ctx, p); return; }
    if (b.plan.length) { this.next(H, m, k, now, ctx); return; }
    this.think(H, m, k, now, ctx, p);
  }
  /** A step that goes to someone follows them as they move. */
  reaim(H, m, now, ctx, p) {
    const g = m.to; if (!g || m.mode === 'rest' || m.mode === 'orbit') return;
    const q = ctx.people.find(x => x.id === g.pid); if (!q) return;
    const want = this.near(q, p, g.dist, g.side);
    if (Math.hypot(want.x - m.x1, want.z - m.z1) > 1.2 && ctx.dry(want.x, want.z) && !ctx.town(want.x, want.z)) { const to = m.to, sp = m.speed; this.go(H, m, now, want.x, want.z, sp); m.to = to; m.speed = sp; }
  }
  /** A spot dist m from someone, on the side the fox is on (side: an angle off it). */
  near(q, p, dist, side = 0) {
    const a = Math.atan2(p.z - q.z, p.x - q.x) + side;
    return { x: q.x + Math.cos(a) * dist, z: q.z + Math.sin(a) * dist };
  }
  /** The next step of its plan: { k: 'go', pid, dist, speed, side } | { k: 'goto', x, z, speed, act } | { k: 'act', act, n, face: pid | {x, z} }
   *  | { k: 'orbit', pid | x, z, r, laps, speed } | { k: 'fn', fn } (a moment in a game: the stick picked up, dropped). */
  next(H, m, k, now, ctx) {
    const b = m.b, s = b.plan.shift(), p = Foxes.at(m, now);
    const who = id => ctx.people.find(x => x.id === id);
    m.to = null;
    if (s.k === 'go') {
      const q = who(s.pid); if (!q) { b.plan = []; b.fetch = null; this.drop(H, m, now, p); return this.rest(H, m, now, 'tilt', ACT_LEN.tilt); }
      const g = this.near(q, p, s.dist, s.side || 0);
      if (!ctx.dry(g.x, g.z) || ctx.town(g.x, g.z)) { b.plan = []; return this.rest(H, m, now, 'sit', ACT_LEN.sit, yawTo(q.x - p.x, q.z - p.z)); }
      this.go(H, m, now, g.x, g.z, s.speed, s.act || ''); m.to = { pid: s.pid, dist: s.dist, side: s.side || 0 }; m.speed = s.speed;
      return;
    }
    if (s.k === 'goto') return this.go(H, m, now, s.x, s.z, s.speed, s.act || '');
    if (s.k === 'act') {
      const f = typeof s.face === 'object' && s.face ? s.face : s.face != null ? who(s.face) : null;
      const yaw = f ? yawTo(f.x - p.x, f.z - p.z) : m.yaw;
      return this.rest(H, m, now, s.act, ONCE.has(s.act) ? ACT_LEN[s.act] : loops(s.act, s.n || 1), yaw);
    }
    if (s.k === 'orbit') {
      const q = s.pid != null ? who(s.pid) : s; if (!q) return this.rest(H, m, now, 'tilt', ACT_LEN.tilt);
      return this.orbit(H, m, now, q.x, q.z, s.r, s.laps, s.speed, s.dir || (hash(`${H.id}:${k}`, Math.floor(now)) > 0.5 ? 1 : -1));
    }
    if (s.k === 'fn') { s.fn(); this.dirty.add(H); return this.next(H, m, k, now, ctx); }
  }
  // ---------------------------------------------------------------- choosing what to do
  think(H, m, k, now, ctx, p) {
    const b = m.b, fid = `${H.id}:${k}`, r = hash(fid, Math.floor(now * 7));
    // asleep: it wakes for someone coming near (a friend from further off), else when its nap is done
    if (m.act === 'sleep' || m.act === 'liedown') {
      const friend = ctx.people.find(q => !Foxes.until(b.bye, q.id, now) && Math.hypot(q.x - p.x, q.z - p.z) < 14 + 3 * this.trustOf(q.id, fid, now));
      if (friend || now - b.nap > 40 + 50 * hash(fid, Math.floor(b.nap))) {
        b.plan = [{ k: 'act', act: 'getup' }, { k: 'act', act: 'stretch' }, { k: 'act', act: 'shake' }];
        if (friend) b.plan.push({ k: 'act', act: 'tilt', n: 1, face: friend.id });
        return this.next(H, m, k, now, ctx);
      }
      return this.rest(H, m, now, 'sleep', ACT_LEN.sleep);
    }
    // the nearest person on foot it would notice (a friend from further off)
    let q = null, qd = Infinity;
    for (const c of ctx.people) {
      const d = Math.hypot(c.x - p.x, c.z - p.z), tr = this.trustOf(c.id, fid, now);
      if (Foxes.until(b.bye, c.id, now)) continue;   // (they said bye: it leaves them be)
      if (Foxes.until(b.letGo, c.id, now) && c.v > 0.8) continue;   // (it let them go: it won't trail after them again yet)
      if (d < NOTICE + 6 * tr && d < qd && Math.hypot(c.x - H.ax, c.z - H.az) < LEASH) { q = c; qd = d; }
    }
    if (q) return this.social(H, m, k, now, ctx, p, q, qd);
    return this.wild(H, m, k, now, ctx, p, r);
  }
  /** On its own. */
  wild(H, m, k, now, ctx, p, r) {
    const b = m.b, fid = `${H.id}:${k}`, h = ctx.hour, dusky = h < 7 || h > 18, midday = h > 11 && h < 15;
    const home = Math.hypot(p.x - H.ax, p.z - H.az);
    // (anyone who said bye is given a wide berth: its wanderings keep SHUN m from them)
    const shun = ctx.people.filter(c => Foxes.until(b.bye, c.id, now)), clear = (x, z) => shun.every(c => Math.hypot(c.x - x, c.z - z) > SHUN);
    const spot = (R, n = 0) => {
      for (let t = 0; t < 8; t++) { const a = hash(fid, now * 3 + n + t) * 6.283, d = 4 + hash(fid, now * 5 + n + t) * R; const x = (home > HOME_R ? H.ax : p.x) + Math.cos(a) * d, z = (home > HOME_R ? H.az : p.z) + Math.sin(a) * d; if (ctx.dry(x, z) && !ctx.town(x, z) && clear(x, z)) return { x, z }; }
      if (clear(H.ax, H.az)) return { x: H.ax, z: H.az };
      const c = shun[0], ax = p.x - c.x, az = p.z - c.z, ad = Math.hypot(ax, az) || 1;
      return { x: c.x + ax / ad * (SHUN + 4), z: c.z + az / ad * (SHUN + 4) };
    };
    // too near someone who said bye (they came its way): it moves off
    if (!clear(p.x, p.z)) { const g = spot(22, 3); return this.go(H, m, now, g.x, g.z, TROT); }
    // far from home: back there at a trot
    if (home > HOME_R * 1.6) { const g = spot(6); b.plan = [{ k: 'act', act: 'tilt', n: 1 }]; return this.go(H, m, now, g.x, g.z, TROT); }
    // the other fox of the pair: now and then they play-chase
    const mate = H.members.find((o, j) => j !== k && o.act !== 'sleep');
    if (mate && r < 0.07 && now - b.lastPlay > 25) {
      const mp = Foxes.at(mate, now); b.lastPlay = now;
      b.plan = [{ k: 'act', act: 'bow' }, { k: 'orbit', x: mp.x, z: mp.z, r: 3, laps: 1.5, speed: ZOOM }, { k: 'act', act: 'hop', n: 1 }];
      return this.next(H, m, k, now, ctx);
    }
    // a nap: mostly in the middle of the day
    if (now - b.nap > 240 && r < (midday ? 0.22 : 0.05)) { b.nap = now; b.plan = [{ k: 'act', act: 'liedown' }]; return this.next(H, m, k, now, ctx); }
    const pick = hash(fid, Math.floor(now * 13));
    if (pick < (dusky ? 0.3 : 0.12)) {
      // mousing: creeps up, listens with its head cocked, springs
      const g = spot(14, 1), dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      b.plan = [{ k: 'act', act: 'tilt', n: 1, face: g }, { k: 'goto', x: g.x + ux * 1.4, z: g.z + uz * 1.4, speed: 1.4 / ACT_LEN.pounce, act: 'pounce' }, { k: 'act', act: 'dig', n: 1 + Math.floor(pick * 6) }];
      return this.go(H, m, now, g.x, g.z, WALK * 0.8);
    }
    if (pick < 0.42) { const g = spot(22, 2); return this.go(H, m, now, g.x, g.z, pick < 0.3 ? TROT : WALK); }
    if (pick < 0.55) return this.rest(H, m, now, 'sit', loops('sit', 1 + pick * 3));
    if (pick < 0.66) return this.rest(H, m, now, 'tilt', loops('tilt', 1 + pick * 2));
    if (pick < 0.76) return this.rest(H, m, now, 'dig', loops('dig', 2 + pick * 3));
    if (pick < 0.8) { b.plan = [{ k: 'act', act: 'shake' }]; return this.rest(H, m, now, '', 1.5); }
    if (pick < 0.84) { b.plan = [{ k: 'act', act: 'hop', n: 1 }]; return this.orbit(H, m, now, p.x + 2.2, p.z, 2.2, 2, ZOOM, pick < 0.82 ? 1 : -1); }   // (zoomies on its own)
    if (pick < 0.87) return this.orbit(H, m, now, p.x + 0.3, p.z, 0.3, 3, 5, 1);   // (chasing its brush)
    return this.rest(H, m, now, '', 3 + pick * 6);   // (standing, breathing, looking about: the rest clip)
  }
  /** With someone near. */
  social(H, m, k, now, ctx, p, q, d) {
    const b = m.b, fid = `${H.id}:${k}`, tr = this.trustOf(q.id, fid, now), r = hash(fid, Math.floor(now * 11));
    const face = yawTo(q.x - p.x, q.z - p.z), comfort = Math.max(1.4, 7 - tr * 1.2);
    // a friend it hasn't greeted for a while: runs up, hops and wags
    const last = b.greeted.get(q.id) ?? -1e9;
    if (tr >= 2 && now - last > 300) {
      b.greeted.set(q.id, now);
      b.plan = [{ k: 'go', pid: q.id, dist: 1.4, speed: DASH }, { k: 'act', act: 'hop', n: 2, face: q.id }, { k: 'act', act: 'wag', n: 1, face: q.id }];
      return this.next(H, m, k, now, ctx);
    }
    b.greeted.set(q.id, Math.max(last, now - 280));   // (seen: no greeting till it has been away a while)
    // someone walking off: trots after them, a little behind and to one side — not into town, and not for long: after
    // FOLLOW_S it sits, watches them go and lets them be (it won't trail after them again for LET_GO_S)
    if (q.v > 0.8 && d < 30) {
      if (b.trail?.pid !== q.id || now - b.trail.at > 6) b.trail = { pid: q.id, since: now };
      b.trail.at = now;
      if (now - b.trail.since > FOLLOW_S) {
        b.letGo.set(q.id, now + LET_GO_S); b.trail = null;
        b.plan = [{ k: 'act', act: 'tilt', n: 1, face: q.id }, { k: 'goto', x: H.ax, z: H.az, speed: WALK }];
        return this.rest(H, m, now, 'sit', ACT_LEN.sit, face);
      }
      const ux = q.vx / q.v, uz = q.vz / q.v, side = (hash(fid, Math.floor(now / 20)) - 0.5) * 3;
      const gx = q.x - ux * (2.2 + comfort * 0.5) - uz * side + ux * q.v * 1.2, gz = q.z - uz * (2.2 + comfort * 0.5) + ux * side + uz * q.v * 1.2;
      if (ctx.town(gx, gz) || !ctx.dry(gx, gz) || Math.hypot(gx - H.ax, gz - H.az) > LEASH) {
        // the edge of its world: sits and watches them go, then home
        b.plan = [{ k: 'goto', x: H.ax, z: H.az, speed: TROT }];
        return this.rest(H, m, now, 'sit', ACT_LEN.sit, face);
      }
      return this.go(H, m, now, gx, gz, Math.min(DASH, Math.max(WALK, q.v * 1.15 + (Math.hypot(gx - p.x, gz - p.z) > 6 ? 1.5 : 0))));
    }
    // still too far for its liking: comes closer — a stranger in short, wary stages (stop, look), a friend straight up
    if (d > comfort + 1.2) {
      const step = tr >= 2 ? d - comfort : Math.min(d - comfort, 3 + r * 4);
      const g = this.near(q, p, d - step, (r - 0.5) * 0.6);
      if (!ctx.dry(g.x, g.z) || ctx.town(g.x, g.z)) return this.rest(H, m, now, 'sit', ACT_LEN.sit, face);
      b.plan = [{ k: 'act', act: r < 0.5 ? 'tilt' : 'sit', n: 1, face: q.id }];
      return this.go(H, m, now, g.x, g.z, tr >= 2 ? TROT : WALK);
    }
    // close and they stand still: play (a stranger mostly watches; the more it trusts them the livelier)
    const lively = 0.35 + tr * 0.13, pick = hash(fid, Math.floor(now * 17));
    if (pick > lively) return this.rest(H, m, now, pick > 0.8 ? 'sit' : pick > 0.6 ? 'tilt' : '', pick > 0.8 ? ACT_LEN.sit : 3, face);
    const u = pick / lively, dir = r > 0.5 ? 1 : -1;
    if (u < 0.2) return this.rest(H, m, now, 'bow', loops('bow', 1 + r), face);
    if (u < 0.33) return this.rest(H, m, now, 'hop', loops('hop', 2), face);
    if (u < 0.45) { b.plan = [{ k: 'act', act: 'bow', face: q.id }]; return this.orbit(H, m, now, q.x, q.z, Math.max(2.5, comfort + 1), 1.5 + r, ZOOM, dir); }
    if (u < 0.55) { b.plan = [{ k: 'act', act: 'tilt', n: 1, face: q.id }]; return this.orbit(H, m, now, p.x + 0.3 * dir, p.z, 0.3, 3, 5, dir); }
    if (u < 0.67) {
      // a pounce at their feet (landing just short)
      const g = this.near(q, p, 0.9);
      b.plan = [{ k: 'act', act: 'wag', n: 1, face: q.id }];
      return this.go(H, m, now, g.x, g.z, Math.max(0.6, Math.hypot(g.x - p.x, g.z - p.z)) / ACT_LEN.pounce, 'pounce');
    }
    if (u < 0.8 && tr >= 2) { b.plan = [{ k: 'act', act: 'wag', n: 1, face: q.id }]; return this.rest(H, m, now, 'roll', ACT_LEN.roll, face); }
    if (u < 0.9) return this.rest(H, m, now, 'wag', loops('wag', 2), face);
    return this.rest(H, m, now, 'dig', loops('dig', 2), face);
  }
  /** Tag: off it darts at an angle, stops, turns and bows for more; chased often enough, zoomies round the chaser. */
  tag(H, m, k, now, ctx, q, p) {
    const b = m.b, fid = `${H.id}:${k}`, dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz) || 1;
    b.tags = now - (b.tagAt || -1e9) < 30 ? b.tags + 1 : 1; b.tagAt = now;
    if (b.tags >= 4) {
      b.tags = 0; b.plan = [{ k: 'act', act: 'bow', face: q.id }, { k: 'act', act: 'hop', n: 1, face: q.id }];
      this.befriend(q.id, fid, 0.5, now);
      return this.orbit(H, m, now, q.x, q.z, 4, 1.5, ZOOM + 1, hash(fid, now) > 0.5 ? 1 : -1);
    }
    for (let t = 0; t < 6; t++) {
      const a = Math.atan2(dz, dx) + (hash(fid, Math.floor(now * 10) + t) - 0.5) * 1.6, run = 10 + hash(fid, now + t) * 6;
      const gx = p.x + Math.cos(a) * run, gz = p.z + Math.sin(a) * run;
      if (!ctx.dry(gx, gz) || ctx.town(gx, gz)) continue;
      b.plan = [{ k: 'act', act: 'bow', face: q.id }];
      return this.go(H, m, now, gx, gz, DASH);
    }
    this.rest(H, m, now, 'bow', ACT_LEN.bow, yawTo(q.x - p.x, q.z - p.z));
  }
  // ---------------------------------------------------------------- what players do to it
  /** A player's or an agent's act on fox k of herd H (from where they stand, q { id, x, z, agent? }): 'pet' | 'treat' |
   *  'fetch' (with where the stick lands, { x, z }) | 'chase' | 'bye'. -> { ok, why?, trust? } */
  interact(H, k, q, act, o, now, ctx) {
    const m = H.members[k]; if (!m) return { ok: false, why: 'no such fox' };
    H.fox ||= { stick: null, wary: -1e9 };
    const fid = `${H.id}:${k}`, p = Foxes.at(m, now), d = Math.hypot(p.x - q.x, p.z - q.z), b = Foxes.mind(m);
    if (!(act in REACH)) return { ok: false, why: 'unknown act' };
    if (d > (q.agent ? Math.max(REACH[act], AGENT_REACH) : REACH[act])) return { ok: false, why: 'too far' };
    if (now - (b.busyAt || -1e9) < 1.0) return { ok: false, why: 'busy' };   // (one ask a second)
    b.busyAt = now;
    const asleep = m.act === 'sleep' || m.act === 'liedown', wake = asleep ? [{ k: 'act', act: 'getup' }, { k: 'act', act: 'shake' }] : [];
    let trust = this.trustOf(q.id, fid, now);
    if (act === 'bye') {
      // a last look at them and off home at a trot (a stick of theirs dropped); it leaves them be for BYE_S — asleep, it
      // sleeps on
      b.bye.set(q.id, now + BYE_S); b.letGo.delete(q.id); b.greeted.set(q.id, now);
      if (b.trail?.pid === q.id) b.trail = null;
      if (asleep) return { ok: true, trust };
      const mine = b.fetch?.pid === q.id || m.to?.pid === q.id || b.plan.some(s => s.pid === q.id || s.face === q.id) || (m.act && Math.hypot(p.x - q.x, p.z - q.z) < 12);
      if (!mine && Math.hypot(p.x - q.x, p.z - q.z) > 12) return { ok: true, trust };   // (busy elsewhere: it just won't come)
      this.drop(H, m, now, p); b.fetch = null; m.to = null;
      const ax = p.x - q.x, az = p.z - q.z, ad = Math.hypot(ax, az) || 1;
      let gx = H.ax, gz = H.az;
      if (Math.hypot(gx - q.x, gz - q.z) < 18) { gx = p.x + ax / ad * 22; gz = p.z + az / ad * 22; if (!ctx.dry(gx, gz) || ctx.town(gx, gz)) { gx = H.ax; gz = H.az; } }
      b.plan = [{ k: 'goto', x: gx, z: gz, speed: TROT }];
      this.rest(H, m, now, 'tilt', ACT_LEN.tilt * 0.5, yawTo(q.x - p.x, q.z - p.z));
      return { ok: true, trust };
    }
    // (playing with it again: whatever bye or let-go there was is over)
    b.bye.delete(q.id); b.letGo.delete(q.id); b.trail = null;
    this.drop(H, m, now, p);
    b.fetch = null; m.to = null;
    if (act === 'pet') {
      trust = this.befriend(q.id, fid, 0.6, now);
      b.plan = [...wake, { k: 'go', pid: q.id, dist: 0.85, speed: TROT }, { k: 'act', act: trust >= 1.5 ? 'roll' : 'wag', n: 1, face: q.id }, { k: 'act', act: 'wag', n: 1, face: q.id }];
    } else if (act === 'treat') {
      trust = this.befriend(q.id, fid, 1.2, now);
      b.plan = [...wake, { k: 'go', pid: q.id, dist: 0.8, speed: TROT }, { k: 'act', act: 'sit', n: 1, face: q.id }, { k: 'act', act: 'hop', n: 2, face: q.id }, { k: 'act', act: 'wag', n: 1, face: q.id }];
    } else if (act === 'chase') {
      // (awake: off it darts, to be chased; asleep: up first, then a bow — come on then)
      if (!wake.length) { this.tag(H, m, k, now, ctx, q, p); return { ok: true, trust }; }
      b.plan = [...wake, { k: 'act', act: 'bow', face: q.id }];
    } else {
      // the throw: from the player to where it lands (no further than 20 m, on dry land out of town)
      let tx = Number(o?.x), tz = Number(o?.z);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) return { ok: false, why: 'where?' };
      const tdx = tx - q.x, tdz = tz - q.z, td = Math.hypot(tdx, tdz);
      if (td > 20) { tx = q.x + tdx / td * 20; tz = q.z + tdz / td * 20; }
      if (!ctx.dry(tx, tz) || ctx.town(tx, tz)) return { ok: false, why: 'water' };
      const fly = 0.5 + Math.min(20, td) * 0.04;
      H.fox.stick = { state: 'flying', x0: q.x, z0: q.z, x: tx, z: tz, t0: now, t1: now + fly, by: k };
      trust = this.befriend(q.id, fid, 0.4, now);
      b.fetch = { pid: q.id };
      const ax = tx - p.x, az = tz - p.z, ad = Math.hypot(ax, az) || 1;
      // it watches the throw, races to just short of where it lands, pounces on it, brings it back, drops it, bows
      b.plan = [...wake,
        { k: 'act', act: 'tilt', n: 1, face: { x: tx, z: tz } },
        { k: 'goto', x: tx - ax / ad * 1.4, z: tz - az / ad * 1.4, speed: DASH },
        { k: 'goto', x: tx, z: tz, speed: 1.4 / ACT_LEN.pounce, act: 'pounce' },
        { k: 'fn', fn: () => { const S = H.fox.stick; if (S && S.by === k) { S.state = 'carried'; m.carry = true; } } },
        { k: 'act', act: 'shake' },
        { k: 'go', pid: q.id, dist: 1.0, speed: DASH * 0.85 },
        { k: 'fn', fn: () => { this.drop(H, m, this.now, Foxes.at(m, this.now)); b.fetch = null; } },
        { k: 'act', act: 'bow', n: 1, face: q.id }, { k: 'act', act: 'wag', n: 1, face: q.id }];
    }
    this.next(H, m, k, now, ctx);
    return { ok: true, trust };
  }
  /** The stick in its mouth dropped where it stands (at its nose). */
  drop(H, m, now, p) {
    if (!m.carry) return;
    m.carry = false;
    const S = H.fox?.stick; if (!S) return;
    const nx = Math.cos(m.yaw) * 0.45, nz = -Math.sin(m.yaw) * 0.45;
    Object.assign(S, { state: 'ground', x: p.x + nx, z: p.z + nz, x0: p.x + nx, z0: p.z + nz, t0: now, t1: now });
    this.dirty.add(H);
  }
}
