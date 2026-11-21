// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent at the controls (docs/features/play-modules.md §Airport, "Agents fly"): the airport's ring courses flown by an
// autopilot with the SAME flight model a person flies (shared/flight-model.js) — it only moves the stick, the pedals and the
// throttle, so every metre of its path is one that aircraft could fly, and the module's own run check (shared/airport.js
// verifyFlight) judges it like anyone's. Pure maths, no three.js: the server flies it for an agent (server/play/
// flight-crew.js) and the tests fly it.
//
// A flight, start to end (AutoFlight): on its stand; a plane taxis out along the airport's taxiway (shared/airport-layout.js)
// to the runway's threshold, lines up and takes off (full power, the nose up at its rotation speed); a helicopter spins its
// rotor up and lifts straight off its pad. Then the rings in order — the next one approached so that it goes through its
// disc the right way, a ring it can't make from where it is (too close, too sharp, behind it) flown round to again —, then
// home: a plane on a final approach down a glide slope to the runway (the end whose approach is clear of the hills),
// a flare, braking and back along the taxiway to its stand; a helicopter back over its pad, a hover, down. Its path is
// sampled four times a second as the browser's is (the run's report), and the ring passes are found in those samples as
// the server finds them (ringPasses), so what the agent thinks it has flown through is what the check will find.
//
// How well it flies (skill 0–1, from its airport level): a beginner flies slower and banks less (wider, safer), a good pilot
// nearer the aircraft's cruise and its limits — never past what the model allows.
import { AIRCRAFT } from './aircraft-specs.js';
import { stepFlight, anglesOf, instruments, newFlight, qrot, G } from './flight-model.js';
import { ringPasses } from './airport.js';
import { toWorldAt, toFrame, RUNWAY } from './airport-layout.js';

export const DT = 1 / 120;               // the flight model's step (as the browser's)
export const SAMPLE_MS = 250;            // the path's samples: four a second (shared/airport.js MAX_SAMPLES)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; };
const angDiff = (from, to) => wrap(to - from);
const hdg = (dx, dz) => Math.atan2(dx, dz);
const ALPHA_STALL = 0.26;                // the wing's stall (shared/flight-model.js)
/** The wing's angle of attack now, as the flight model works it out. */
function alphaOf(s) { const f = qrot(s.q, 0, 0, 1), u = qrot(s.q, 0, 1, 0), v = s.v; return Math.atan2(-(v.x * u.x + v.y * u.y + v.z * u.z), Math.max(1, v.x * f.x + v.y * f.y + v.z * f.z)); }

/** How it flies each class (m/s; banks in radians): course speed (beginner → ace), the most bank, the final approach. */
export const STYLE = Object.freeze({
  prop: Object.freeze({ v: [33, 44], turnV: 1.5, bank: [0.75, 0.98], approach: 30, glide: 0.07, final: 900, taxi: 6, climb: 0.13 }),
  jet: Object.freeze({ v: [60, 80], turnV: 1.5, bank: [0.8, 1.02], approach: 60, glide: 0.06, final: 2000, taxi: 7, climb: 0.12 }),
  heli: Object.freeze({ v: [24, 40], approach: 6 }),
});

/**
 * The autopilot of one flight: what to do with the controls now (input()), and where it is in the flight (phase).
 * o: { rings ([{ x, y, z, r, nx, nz }] the course's, world metres), airport ({ x, z, y, rot }: the module), stand ({ x, z, yaw }:
 * its own stand), clearAt(x, z) → the ground or a roof there, skill (0–1) }.
 */
export class Autopilot {
  constructor(type, { rings, airport, stand, clearAt = () => -Infinity, skill = 0.5 }) {
    const S = AIRCRAFT[type];
    Object.assign(this, { type, S, rings, airport, stand, clearAt, skill: clamp(skill, 0, 1) });
    this.heli = S.kind === 'heli';
    this.k = 0;                       // the next ring
    this.phase = this.heli ? 'spinup' : 'taxi';
    this.around = null;               // a ring it is flying round to again: the set-up point it heads for first
    this.missed = 0;                  // rings it went past outside their disc (and came round to again)
    this.route = null; this.ri = 0;   // a taxi route (world points) and the next point on it
    const st = STYLE[type];
    this.vCourse = st.v[0] + (st.v[1] - st.v[0]) * this.skill;
    this.bankMax = this.heli ? 0 : Math.min(S.maxBank * 0.95, st.bank[0] + (st.bank[1] - st.bank[0]) * this.skill);
    this.dir = this.heli ? 1 : this.pickDeparture();   // take-off along +f (1) or −f (−1): the way clearer of hills and roofs
    this.runwayH = wrap(airport.rot + (this.dir > 0 ? 0 : Math.PI));
    if (!this.heli) this.route = this.taxiOut();
  }
  /** World point of airport frame (s, f). */
  at(s, f) { return toWorldAt(this.airport, s, f); }
  /** The taxi route out: off the stand to the taxiway, along it to the runway's end link, on to the threshold. */
  taxiOut() {
    const me = toFrame(this.airport, this.stand.x, this.stand.z), d = this.dir;
    return [[me.s - 18, me.f], [55, me.f], [55, -312 * d], [44, -328 * d], [22, -336 * d], [8, -338 * d]].map(([s, f]) => this.at(s, f));
  }
  /** Which way to take off: the one whose climb-out (straight on past the runway's end, at the climb a plane makes) has the
   *  most room over the land and roofs under it. */
  pickDeparture() {
    const room = d => {
      let worst = Infinity;
      for (let f = RUNWAY.len / 2; f <= RUNWAY.len / 2 + 1500; f += 50) {
        const p = this.at(0, f * d), above = this.airport.y + (f - RUNWAY.len / 2 + 300) * 0.09 - this.clearAt(p.x, p.z);
        worst = Math.min(worst, above);
      }
      return worst;
    };
    return room(-1) > room(1) + 5 ? -1 : 1;
  }
  /** The taxi route in from where it stopped on the runway (frame f) to its stand: off by the nearest link, along the
   *  taxiway, up to the stand. */
  taxiIn(f) {
    const links = [-330, 0, 330], L = links.reduce((b, x) => (Math.abs(x - f) < Math.abs(b - f) ? x : b), links[0]), me = toFrame(this.airport, this.stand.x, this.stand.z);
    return [[0, f], [0, L], [18, L], [40, L], [55, L + Math.sign(me.f - L) * 14], [55, me.f], [me.s - 14, me.f]].map(([s, f2]) => this.at(s, f2));
  }

  // ------------------------------------------------------------------------------------------- the controls
  /** The controls now for flight state s (env: the flight model's), dt: the step. */
  input(s, env) {
    if (s.crashed || this.phase === 'done') return { throttle: -1, brake: true };
    return this.heli ? this.heliInput(s, env) : this.planeInput(s, env);
  }
  /** Throttle input (a rate) that brings the lever to `want` (0–1). */
  lever(s, want) { return clamp((clamp(want, 0, 1) - s.throttle) * 6, -1, 1); }
  /** Rolling on the ground toward point p at speed v: { throttle, roll (steering), brake }. */
  roll(s, p, v) {
    const a = anglesOf(s.q), i = instruments(s), err = angDiff(a.heading, hdg(p.x - s.p.x, p.z - s.p.z));
    const want = v * clamp(1 - Math.abs(err) / 1.6, 0.35, 1);
    return { throttle: this.lever(s, i.ground < want ? 0.35 + (want - i.ground) * 0.12 : 0), roll: clamp(-err * 3, -1, 1), brake: i.ground > want + 1.5, pitch: 0, yaw: 0 };
  }
  /** Following a taxi route; true when it is at its end. */
  follow(s, v) {
    const R = this.route;
    while (this.ri < R.length - 1 && Math.hypot(R[this.ri].x - s.p.x, R[this.ri].z - s.p.z) < 9) this.ri++;
    const last = this.ri === R.length - 1, d = Math.hypot(R[this.ri].x - s.p.x, R[this.ri].z - s.p.z);
    return { done: last && d < 4, ctl: this.roll(s, R[this.ri], last ? Math.min(v, 1 + d * 0.4) : v) };
  }
  /** In the air: hold heading `h` (the way it goes over the ground), height `y`, speed `v` (bank at most `bank`). */
  fly(s, h, y, v, bank = this.bankMax, landing = false, horizon = 14) {
    const S = this.S, a = anglesOf(s.q), V = Math.hypot(s.v.x, s.v.y, s.v.z), track = Math.hypot(s.v.x, s.v.z) > 5 ? hdg(s.v.x, s.v.z) : a.heading;
    const slow = V < S.stall * 1.3;
    // (the ground, hills and roofs on the way it is going over the next seconds: over them with room to spare; low down,
    //  no steep bank — a wing tip)
    if (!landing) {
      const fl = this.floorAhead(s, a.bank, horizon), over = fl.y + 22;
      // (held a few seconds: the way ahead changes as it turns, the climb shouldn't flicker with it)
      if (!this.hold || over >= this.hold.y || s.t > this.hold.until) this.hold = { y: over, until: s.t + 3 };
      if (this.hold.y > y) y = this.hold.y;
      // too high to climb over before it gets there: round it — the nearest way to the heading it wants that is clear,
      // kept a few seconds once chosen (no swerving to and fro)
      const clears = f => f.y + 10 - s.p.y <= f.at * S.climb * 0.55 + 2;
      if (this.dodge && s.t < this.dodge.until) h = this.dodge.h;
      else if (!clears(fl) || !clears(this.floorOn(s, track, horizon))) {
        const ways = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3].map(d => wrap(track + d)).sort((p, q) => Math.abs(angDiff(p, h)) - Math.abs(angDiff(q, h)));
        const w = ways.find(x => clears(this.floorOn(s, x, horizon)));
        if (w != null && Math.abs(angDiff(w, h)) > 0.05) { this.dodge = { h: w, until: s.t + 3 }; h = w; }
      }
    }
    const bmax = Math.min(bank, this.bankAt(V), landing || s.agl > 40 ? Infinity : 0.25 + s.agl * 0.015);
    const b = clamp(-angDiff(track, h) * clamp(V / (2 * G), 1.5, 4), -bmax, bmax);   // (faster: more bank for the same error — the heading follows in about two seconds)
    // (never down to the ground: under 15 m over it, climbing whatever the target says)
    const vsWant = Math.max(clamp((y - s.p.y) * 0.3, -7, S.climb * (slow ? 0.2 : 0.75)), s.agl < 15 && !s.onGround && !landing ? (15 - s.agl) * 0.5 : -Infinity);
    // (the wing near its stall — pulling round a tight turn and climbing too —: no more pull; stalled: the nose down,
    //  wings level, full power until it flies again)
    const al = alphaOf(s);
    if (s.stall || al > ALPHA_STALL * 0.85) return { throttle: this.lever(s, 1), pitch: -0.7, roll: clamp(-a.bank * 3, -1, 1), yaw: 0, brake: false };
    let pitch = clamp((vsWant - s.v.y) * 0.16 - (slow ? 0.3 : 0), -1, 1);
    if (al > ALPHA_STALL * 0.65 && pitch > 0) pitch *= clamp((ALPHA_STALL * 0.85 - al) / (ALPHA_STALL * 0.2), 0, 1);
    return {
      throttle: this.lever(s, 0.55 + (v - V) * 0.09 + (vsWant - s.v.y) * 0.03),
      pitch, roll: clamp((b - a.bank) * 3, -1, 1), yaw: 0, brake: false,
    };
  }
  /** The highest ground or roof under where it will be over the next `secs` seconds (going round as it turns now, and
   *  straight on), sampled every half second: { y, t (when) }. Worked out a few times a second, not every step. */
  floorAhead(s, bank = 0, secs = this.heli ? 7 : 14) {
    if (this.fa && s.t - this.fa.t < 0.25 && this.fa.secs === secs) return this.fa;
    const V = Math.max(5, Math.hypot(s.v.x, s.v.z)), h0 = hdg(s.v.x, s.v.z), w = this.heli ? 0 : (G * Math.tan(clamp(bank, -1.2, 1.2))) / V;
    let y = this.clearAt(s.p.x, s.p.z), at = 0;
    for (const turn of w ? [w, 0] : [0]) {
      let x = s.p.x, z = s.p.z, h = h0;
      for (let t = 0.5; t <= secs; t += 0.5) {
        h -= turn * 0.5; x += Math.sin(h) * V * 0.5; z += Math.cos(h) * V * 0.5;
        // (a corridor: a wing's width and some either side of the way)
        for (const o of [0, 22, -22]) {
          const c = this.clearAt(x + Math.cos(h) * o, z - Math.sin(h) * o);
          if (c > y) { y = c; at = t; }
        }
      }
    }
    return (this.fa = { y, at, t: s.t, secs });
  }
  /** The highest ground or roof straight on along heading h over the next `secs` seconds: { y, at }. */
  floorOn(s, h, secs = 14) {
    const V = Math.max(5, Math.hypot(s.v.x, s.v.z));
    let y = -Infinity, at = 0;
    for (let t = 0.5; t <= secs; t += 0.5) for (const o of [0, 22, -22]) {
      const c = this.clearAt(s.p.x + Math.sin(h) * V * t + Math.cos(h) * o, s.p.z + Math.cos(h) * V * t - Math.sin(h) * o);
      if (c > y) { y = c; at = t; }
    }
    return { y, at };
  }
  /** The most bank it takes at airspeed V without the wing running out of lift (a margin under the stall in the turn). */
  bankAt(V) { const n = 0.75 * (V / this.S.stall) ** 2; return n <= 1 ? 0.12 : Math.min(this.bankMax, Math.acos(1 / n)); }
  /** The height to fly at on the way to (x, z) at height y: no lower than the ground and roofs ahead allow. */
  safeY(s, y, tx, tz) {
    const dx = tx - s.p.x, dz = tz - s.p.z, d = Math.hypot(dx, dz), n = Math.min(14, Math.ceil(d / 30)), ux = dx / (d || 1), uz = dz / (d || 1);
    let floor = -Infinity;
    for (let k = 1; k <= n; k++) { const t = Math.min(d - 60, k * 30); if (t <= 0) break; floor = Math.max(floor, this.clearAt(s.p.x + ux * t, s.p.z + uz * t)); }
    floor = Math.max(floor, this.clearAt(s.p.x, s.p.z));
    return Math.max(y, floor + (this.heli ? 18 : 30));
  }
  /** The way to go for ring R (a plane): the shortest way a plane turning no tighter than it can (a Dubins path: turn,
   *  straight, turn) from where it is and the way it goes now to a point a little before the ring, lined up with its way
   *  through — planned again every step, so a gust of its own errors or a ring missed is simply flown round to again.
   *  Far enough back to climb or sink to the ring's height on the way. key: which ring. → the heading to fly now. */
  aim(s, R, V, key = this.k) {
    const S = this.S, rho = (V * V) / (G * Math.tan(this.bankAt(V) * 0.85)), track = hdg(s.v.x, s.v.z);
    const dy = Number.isFinite(R.y) ? R.y - s.p.y : 0, rate = dy > 0 ? S.climb * 0.6 : 6;
    // its last straight, on its axis: held on the axis line (turning back to it the more, the farther off it is)
    const along = (s.p.x - R.x) * R.nx + (s.p.z - R.z) * R.nz, side = (s.p.x - R.x) * R.nz - (s.p.z - R.z) * R.nx;   // (side > 0: left of it)
    const finalLen = Math.max(70, rho * 1.5), nH = hdg(R.nx, R.nz);
    const need = (Math.abs(dy) / rate) * V;   // (the way it needs to climb or sink to the ring's height)
    if (along < 0 && along > -finalLen * 1.6 && Math.abs(side) < Math.max(20, finalLen * 0.12) && Math.abs(angDiff(track, nH)) < 0.35 && need <= -along + (R.r || 20) * 2) {
      this.around = null;
      this.turning = false;
      return wrap(nH - Math.atan(side / Math.max(30, -along * 0.6)));   // (a point on the axis ahead, nearer as the ring nears)
    }
    // the way in: a straight lined up on its axis as long as suits (the longer, the surer), ahead of it — the shortest
    // way all told, long enough to climb or sink to its height
    let best = null;
    for (const u of [1, 0.7, 0.45, 0.25, 0]) {
      const lead = Math.max(30, finalLen * u);
      const gx = R.x - R.nx * lead, gz = R.z - R.nz * lead, w = dubins(s.p.x, s.p.z, track, gx, gz, nH, rho, this.turnSide);
      if (!w) continue;
      const cost = w.len + lead + 0.4 * (finalLen - lead) + Math.max(0, need - w.len - lead) * 3 + (lead > -along - 10 ? 1e4 : 0);   // (a way in behind it: only if nothing ahead works)
      if (!best || cost < best.cost) best = { ...w, cost };
    }
    if (!best) return hdg(R.x - s.p.x, R.z - s.p.z);
    // too high or too low for any way in from here: round in a circle, climbing or sinking, until one will do
    if (need > best.len + Math.max(30, finalLen * 0.25) + (R.r || 20) * 2 && Math.hypot(R.x - s.p.x, R.z - s.p.z) < need + 2 * rho) {
      this.turnSide = this.turnSide === 'R' ? 'R' : 'L'; this.around = key; this.turning = true;
      return wrap(track + (this.turnSide === 'L' ? 1 : -1) * 2.4);
    }
    this.turnSide = best.first;
    this.around = best.loops ? key : null;
    this.turning = best.first !== 'S' && best.turn > 0.5;   // (a turn ahead: slower, so it is tighter)
    return best.first === 'S' ? best.straight : wrap(track + (best.first === 'L' ? 1 : -1) * Math.min(2.4, best.turn + 0.05));
  }
  /** Whether (tx, tz) is inside either of the circles it turns on at radius r from (px, pz) heading h (out of reach). */
  inCircle(px, pz, h, tx, tz, r) {
    for (const sg of [1, -1]) {   // left (+) and right (−) turn centres
      const cx = px + Math.cos(h) * r * sg, cz = pz - Math.sin(h) * r * sg;
      if (Math.hypot(tx - cx, tz - cz) < r * 1.02) return true;
    }
    return false;
  }
  /** The heading toward (tx, tz); out of reach (inside its turning circle), straight on until it is not. */
  reach(s, tx, tz, r, track) { return this.inCircle(s.p.x, s.p.z, track, tx, tz, r) ? track : hdg(tx - s.p.x, tz - s.p.z); }

  // ------------------------------------------------------------------------------------------- planes
  planeInput(s, env) {
    const S = this.S, i = instruments(s), a = anglesOf(s.q);
    switch (this.phase) {
      case 'taxi': {
        const r = this.follow(s, STYLE[this.type].taxi);
        if (r.done) this.phase = 'lineup';
        return r.ctl;
      }
      case 'lineup': {   // round on to the centreline, facing down the runway
        const err = angDiff(a.heading, this.runwayH);
        if (Math.abs(err) < 0.06 && i.ground < 4) { this.phase = 'takeoff'; this.rollFrom = toFrame(this.airport, s.p.x, s.p.z).f; }
        return { throttle: this.lever(s, i.ground < 3 ? 0.3 : 0), roll: clamp(-err * 4, -1, 1), brake: i.ground > 4, pitch: 0, yaw: 0 };
      }
      case 'takeoff': {
        const q = toFrame(this.airport, s.p.x, s.p.z), want = this.runwayH - clamp(q.s * this.dir * 0.02, -0.25, 0.25);   // (back to the centreline: +s is to the left of the nose taking off along +f)
        const air = !s.onGround && s.agl > 2;
        if (air && s.agl > 25) { this.phase = 'course'; this.climbed = true; }
        const pitch = i.speed > S.rotate || !s.onGround ? clamp((STYLE[this.type].climb - a.pitch) * 4, -1, 1) : 0;
        if (!s.onGround && s.agl > 6) { const c = this.fly(s, this.runwayH, this.airport.y + 120, this.vCourse); return { ...c, throttle: 1 }; }   // (off the ground: climbing out, round anything in the way)
        if (!s.onGround) return { throttle: 1, pitch, roll: clamp(-a.bank * 3, -1, 1), yaw: 0 };
        return { throttle: 1, pitch, roll: clamp(-angDiff(a.heading, want) * 3, -1, 1), yaw: 0, brake: false };
      }
      case 'course': {
        if (this.k >= this.rings.length) { this.phase = 'return'; return this.planeInput(s, env); }
        const R = this.rings[this.k], V = Math.max(i.speed, S.stall);
        const h = this.aim(s, R, V), d = Math.hypot(R.x - s.p.x, R.z - s.p.z);
        // (near the ring: its height; farther: no lower than what lies on the way — the ring itself stands clear of the
        //  roofs and the ground round it, so only what is before it counts, rounded to half seconds)
        const y = d < 160 ? R.y : this.safeY(s, R.y, R.x, R.z), horizon = clamp(Math.round(((d - R.r) / V) * 2) / 2, 1.5, 14);
        return this.fly(s, h, y, this.turning ? Math.min(this.vCourse, S.stall * STYLE[this.type].turnV) : this.vCourse, this.bankMax, false, horizon);
      }
      case 'return': {   // to the start of the final approach, lined up with the runway
        const F = this.final || (this.final = this.pickFinal());
        const ring = { x: F.ax, z: F.az, y: F.y0, r: 40, nx: Math.sin(F.h), nz: Math.cos(F.h) }, V = Math.max(i.speed, S.stall);
        const ux = ring.nx, uz = ring.nz, along = (s.p.x - F.tx) * ux + (s.p.z - F.tz) * uz, side = (s.p.x - F.tx) * uz - (s.p.z - F.tz) * ux;
        if (along > -F.len * 1.05 && along < -F.len * 0.3 && Math.abs(side) < 25 && Math.abs(angDiff(hdg(s.v.x, s.v.z), F.h)) < 0.25) { this.phase = 'approach'; return this.planeInput(s, env); }
        return this.fly(s, this.aim(s, ring, V, 'final'), this.safeY(s, F.y0, F.ax, F.az), STYLE[this.type].approach + 12);
      }
      case 'approach': {   // down the glide slope to the touchdown point, on the centreline; the flare
        const F = this.final, ux = Math.sin(F.h), uz = Math.cos(F.h);
        const along = (s.p.x - F.tx) * ux + (s.p.z - F.tz) * uz, side = (s.p.x - F.tx) * uz - (s.p.z - F.tz) * ux;
        if (s.onGround) { this.phase = 'rollout'; return this.planeInput(s, env); }
        if (along < -F.len * 1.4 || Math.abs(side) > 90) { this.phase = 'return'; this.final = null; this.goArounds = (this.goArounds || 0) + 1; return this.planeInput(s, env); }   // (lost it: round again)
        const h = F.h - clamp(side * 0.012, -0.35, 0.35);   // (side > 0: off to the left of the way down — turn right)
        const gy = F.ty + S.gearH + Math.max(0, -along) * STYLE[this.type].glide;
        if (s.agl < 5) return { throttle: -1, pitch: clamp((0.08 - a.pitch) * 4 + (-0.6 - s.v.y) * 0.3, -1, 1), roll: clamp(-a.bank * 3, -1, 1), yaw: 0 };   // the flare
        const c = this.fly(s, h, gy, STYLE[this.type].approach, 0.35, true);
        return c;
      }
      case 'rollout': {
        const q = toFrame(this.airport, s.p.x, s.p.z);
        if (i.ground < 4) { this.phase = 'taxiin'; this.route = this.taxiIn(q.f); this.ri = 0; }
        return { throttle: -1, brake: true, roll: clamp(-angDiff(a.heading, this.final.h) * 2, -1, 1), pitch: 0, yaw: 0 };
      }
      case 'taxiin': {
        const r = this.follow(s, STYLE[this.type].taxi);
        if (r.done || (this.ri === this.route.length - 1 && i.ground < 0.5 && Math.hypot(this.stand.x - s.p.x, this.stand.z - s.p.z) < 25)) { this.phase = 'stop'; }
        return r.ctl;
      }
      case 'stop': if (i.ground < 0.3) this.phase = 'done'; return { throttle: -1, brake: true, roll: 0, pitch: 0 };
      default: return { throttle: -1, brake: true };
    }
  }
  /** The final approach: down the runway one way or the other, the way whose glide slope is clearest of the land under
   *  it (and roofs). → { h, tx, tz, ty (touchdown), ax, az (the final's start), y0 (its height), len }. */
  pickFinal() {
    const st = STYLE[this.type], len = st.final, A = this.airport, out = [];
    for (const dir of [1, -1]) {
      const h = wrap(this.runwayH + (dir > 0 ? 0 : Math.PI)), ux = Math.sin(h), uz = Math.cos(h);
      const td = this.at(0, -dir * (RUNWAY.len / 2 - 110));   // (touchdown 110 m in from the threshold)
      let worst = -Infinity;
      for (let d = 60; d <= len; d += 40) { const x = td.x - ux * d, z = td.z - uz * d; worst = Math.max(worst, this.clearAt(x, z) + 25 - (A.y + d * st.glide)); }
      out.push({ h, tx: td.x, tz: td.z, ty: A.y, ax: td.x - ux * len, az: td.z - uz * len, y0: A.y + len * st.glide + this.S.gearH, len, worst });
    }
    out.sort((x, y) => x.worst - y.worst);
    const F = out[0];
    if (F.worst > 0) F.y0 += F.worst;   // (hills under it: a steeper way down from higher up)
    F.glideUp = Math.max(0, F.worst);
    return F;
  }

  // ------------------------------------------------------------------------------------------- the helicopter
  heliInput(s, env) {
    const S = this.S, a = anglesOf(s.q), h = a.heading, fx = Math.sin(h), fz = Math.cos(h);
    const vf = s.v.x * fx + s.v.z * fz, vs = s.v.x * -Math.cos(h) + s.v.z * Math.sin(h);   // forward, to the right
    /** to point (x, z) at height y, at most v m/s (slowing to arrive when stop), facing faceH once close: the cyclic and
     *  the pedals' side-slip drive it the way it should go (forward, sideways or back), the pedals turn its nose. */
    const go = (x, y, z, v, stop = false, faceH = null) => {
      const dx = x - s.p.x, dz = z - s.p.z, d = Math.hypot(dx, dz);
      const err = angDiff(h, faceH != null && d < 15 ? faceH : d > 6 ? hdg(dx, dz) : h);
      let sp = stop ? Math.min(v, Math.max(0.4, d * 0.3)) : v;
      if (d > 15) sp *= clamp(1 - Math.abs(err) / 1.3, 0.25, 1);
      const ux = d > 0.3 ? dx / d : 0, uz = d > 0.3 ? dz / d : 0;
      const vfW = sp * (ux * fx + uz * fz), vsW = sp * (ux * -Math.cos(h) + uz * Math.sin(h));
      if (y > -1e8) { const fl = this.floorAhead(s, 0, 6); if (fl.y + 12 > y) y = fl.y + 12; }   // (not into a roof or a hill on the way)
      const vsWant = clamp((y - s.p.y) * 0.45, -S.descend * 0.8, S.climb * 0.85);
      return {
        throttle: clamp(vsWant >= 0 ? vsWant / S.climb : vsWant / S.descend, -1, 1),
        pitch: clamp(-(vfW - vf) * 0.12, -1, 1),
        yaw: clamp(-err * 1.4, -1, 1),
        strafe: clamp((vsW - vs) * 0.3, -1, 1),
      };
    };
    switch (this.phase) {
      case 'spinup': if (s.rpm >= 0.99) this.phase = 'liftoff'; return { throttle: 0 };
      case 'liftoff': if (s.agl > 12) this.phase = 'course'; return { throttle: 1, pitch: clamp(vf * 0.1, -1, 1), strafe: clamp(-vs * 0.2, -1, 1) };
      case 'course': {
        if (this.k >= this.rings.length) { this.phase = 'return'; return this.heliInput(s, env); }
        const R = this.rings[this.k], d = Math.hypot(R.x - s.p.x, R.z - s.p.z);
        const along = (s.p.x - R.x) * R.nx + (s.p.z - R.z) * R.nz;
        // from the wrong side, or too close to line up: back out along its axis first
        if (this.around === this.k) {
          const bx = R.x - R.nx * 45, bz = R.z - R.nz * 45;
          if (Math.hypot(bx - s.p.x, bz - s.p.z) < 8) this.around = null;
          return go(bx, this.safeY(s, R.y, bx, bz), bz, this.vCourse * 0.7, true, hdg(R.nx, R.nz));
        }
        if (along > -3 || (d < 40 && Math.abs(angDiff(hdg(R.nx, R.nz), hdg(R.x - s.p.x, R.z - s.p.z))) > 1.0)) { this.around = this.k; return this.heliInput(s, env); }
        const lead = clamp(d * 0.4, 0, 35), tx = R.x - R.nx * lead, tz = R.z - R.nz * lead;
        const y = d < 90 ? R.y : this.safeY(s, R.y, R.x, R.z);
        // (slower in close: the rings of a hop are small and near each other)
        const v = clamp(d * 0.35 + 8, 10, this.vCourse);
        return go(lead < 2 ? R.x + R.nx * 20 : tx, y, lead < 2 ? R.z + R.nz * 20 : tz, Math.abs(s.p.y - y) > 12 && d < 80 ? Math.min(v, 9) : v);
      }
      case 'return': {
        const pad = this.stand, d = Math.hypot(pad.x - s.p.x, pad.z - s.p.z), cruise = this.safeY(s, this.airport.y + 40, pad.x, pad.z);
        if (d < 2.5 && Math.hypot(s.v.x, s.v.z) < 1.2) { this.phase = 'land'; return this.heliInput(s, env); }
        return go(pad.x, d < 60 ? Math.max(this.airport.y + 18, this.clearAt(s.p.x, s.p.z) + 15) : cruise, pad.z, this.vCourse, true, pad.yaw);
      }
      case 'land': {
        if (s.onGround) { this.phase = 'done'; return { throttle: 0 }; }
        const c = go(this.stand.x, -1e9, this.stand.z, 1.5, true, this.stand.yaw);
        return { ...c, throttle: -0.6 };
      }
      default: return { throttle: s.onGround ? 0 : -0.5 };
    }
  }
}

/**
 * A whole flight flown step by step (the server's live flight, and the tests): the flight model, the autopilot at its
 * controls, the path sampled four times a second and the ring passes found in it as the run check finds them.
 * o: Autopilot's options, plus { start ({ x, z, yaw }: where it stands, if not on its stand), y (the ground there), t0 (ms:
 * where the run's clock stands when this flight starts) }.
 */
export class AutoFlight {
  constructor(type, o) {
    const S = AIRCRAFT[type];
    this.type = type; this.rings = o.rings;
    this.ap = new Autopilot(type, o);
    const at = o.start || o.stand;   // (where it stands now: its stand, or where someone left it)
    this.s = newFlight(type, at.x, o.y ?? o.airport.y, at.z, at.yaw ?? o.stand.yaw);
    void S;
    this.t0 = o.t0 || 0;          // ms on the run's clock when it set off
    this.path = []; this.passes = [];
    this.nextSample = 0;          // flight seconds of its next sample
    this.acc = 0;
    this.sample();
  }
  get t() { return this.s.t; }
  /** Its clock (ms from the run's start). */
  ms() { return Math.round(this.t0 + this.s.t * 1000); }
  get crashed() { return this.s.crashed; }
  get phase() { return this.ap.phase; }
  /** Through every ring (the run can be reported). */
  get through() { return this.passes.length >= this.rings.length; }
  get done() { return this.ap.phase === 'done' || !!this.s.crashed; }
  sample() {
    const s = this.s, p = [this.ms(), +s.p.x.toFixed(2), +s.p.y.toFixed(2), +s.p.z.toFixed(2)], last = this.path[this.path.length - 1];
    if (last && p[0] <= last[0]) return;
    this.path.push(p);
    // the passes, found in the samples the way the run check will find them (the same segment may go through two rings)
    if (last && this.passes.length < this.rings.length) {
      for (const x of ringPasses(this.rings.slice(this.passes.length), [last, p])) this.passes.push(x.t);
      if (this.ap.k < this.passes.length) { this.ap.k = this.passes.length; this.ap.around = null; }
      // (past the ring's disc without a pass: it goes round to it again)
      const R = this.rings[this.passes.length];
      if (R && this.ap.phase === 'course' && this.ap.around !== this.ap.k) {
        const side = q => (q[1] - R.x) * R.nx + (q[3] - R.z) * R.nz;
        if (side(last) < 0 && side(p) >= 0 && Math.hypot(p[1] - R.x, p[3] - R.z) < 200) { this.ap.missed++; (this.misses ||= []).push({ k: this.ap.k, d: Math.round(Math.hypot(p[1] - R.x, p[3] - R.z)), dy: Math.round(p[2] - R.y), r: R.r }); }
      }
    }
  }
  /** Flies on for `secs` seconds (the server's tick, a test's loop): steps of 1/120 s, samples every quarter second.
   *  env: the flight model's ({ ground, water, solid }). */
  step(secs, env) {
    this.acc += secs;
    while (this.acc >= DT && !this.done) {
      const inp = this.ap.input(this.s, env);
      stepFlight(this.s, inp, env, DT);
      this.acc -= DT;
      if (this.s.t >= this.nextSample) { this.nextSample = this.s.t + SAMPLE_MS / 1000; this.sample(); }
    }
    if (this.done) this.acc = 0;
    return this;
  }
  /** Where it is now, as the fleet shares an aircraft's pose (server/world/aircraft.js): { x, y, z, q, v, g, th }. */
  pose() {
    const s = this.s, i = instruments(s), r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;
    return { x: r2(s.p.x), y: r2(s.p.y), z: r2(s.p.z), q: [s.q.x, s.q.y, s.q.z, s.q.w].map(r4), v: r2(i.speed), g: s.onGround ? 1 : 0, th: r2(this.type === 'heli' ? s.rpm : s.throttle) };
  }
  /** The run's report (shared/airport.js verifyFlight): the path up to and including the sample through the last ring. */
  report() {
    const end = this.passes.length >= this.rings.length ? this.path.findIndex(p => p[0] > this.passes[this.passes.length - 1]) : -1;   // (the sample after the last pass: its segment)
    return { aircraft: this.type, path: end >= 0 ? this.path.slice(0, end + 1) : this.path.slice() };
  }
}

// ------------------------------------------------------------------------------------------- Dubins paths
const TAU = 2 * Math.PI, m2 = a => ((a % TAU) + TAU) % TAU;
/**
 * The shortest way (turns of radius rho and straights) from (x0, z0) going heading h0 to (x1, z1) going heading h1 — in
 * this world's headings (the way (sin h, cos h); a left turn makes it bigger). prefer: 'L' | 'R' — the side it is turning
 * already counts a little shorter (no flip-flop between two near-equal ways). → { first ('L' | 'R' | 'S'), turn (the
 * first turn's angle), straight (the straight's heading), len (m), loops (a turn of more than half round first) } or null.
 */
export function dubins(x0, z0, h0, x1, z1, h1, rho, prefer = null) {
  // (plane coordinates X = z, Y = x: a heading is the angle from X toward Y, left turns counter-clockwise)
  const dX = z1 - z0, dY = x1 - x0, D = Math.hypot(dX, dY), d = D / rho, phi = Math.atan2(dY, dX);
  const al = m2(h0 - phi), be = m2(h1 - phi), sa = Math.sin(al), sb = Math.sin(be), ca = Math.cos(al), cb = Math.cos(be), cab = Math.cos(al - be);
  const out = [];
  const add = (kind, t, p, q) => { if ([t, p, q].every(Number.isFinite)) out.push({ kind, t, p, q }); };
  { const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb); if (p2 >= 0) { const t1 = Math.atan2(cb - ca, d + sa - sb); add('LSL', m2(-al + t1), Math.sqrt(p2), m2(be - t1)); } }
  { const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa); if (p2 >= 0) { const t1 = Math.atan2(ca - cb, d - sa + sb); add('RSR', m2(al - t1), Math.sqrt(p2), m2(-be + t1)); } }
  { const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb); if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p); add('LSR', m2(-al + t2), p, m2(-m2(be) + t2)); } }
  { const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb); if (p2 >= 0) { const p = Math.sqrt(p2), t2 = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p); add('RSL', m2(al - t2), p, m2(be - t2)); } }
  { const c = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8; if (Math.abs(c) <= 1) { const p = m2(TAU - Math.acos(c)), t = m2(al - Math.atan2(ca - cb, d - sa + sb) + p / 2); add('RLR', t, p, m2(al - be - t + p)); } }
  { const c = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8; if (Math.abs(c) <= 1) { const p = m2(TAU - Math.acos(c)), t = m2(-al - Math.atan2(ca - cb, d + sa - sb) + p / 2); add('LRL', t, p, m2(m2(be) - al - t + p)); } }
  let best = null;
  for (const w of out) {
    // (checked by flying it: a way that doesn't end where and how it should is not one)
    const end = walk(x0, z0, h0, w, rho);
    if (Math.hypot(end.x - x1, end.z - z1) > Math.max(0.5, rho * 0.01) || Math.abs(wrap(end.h - h1)) > 0.02) continue;
    const t = w.t > TAU - 1e-3 ? 0 : w.t, len = (t + w.p + w.q) * rho - (prefer && t > 0.02 && w.kind[0] === prefer ? 0.25 * rho : 0);
    if (!best || len < best.len) best = { ...w, t, len };
  }
  if (!best) return null;
  const first = best.t < 0.02 ? 'S' : best.kind[0], h = wrap(h0 + (best.kind[0] === 'L' ? best.t : -best.t));
  return { first, turn: best.t, straight: best.kind[1] === 'S' ? h : h0, len: (best.t + best.p + best.q) * rho, loops: best.t > Math.PI, kind: best.kind };
}
/** Where a Dubins way ends: { x, z, h }. */
function walk(x, z, h, w, rho) {
  const seg = (c, a) => {
    if (c === 'S') { x += Math.sin(h) * a * rho; z += Math.cos(h) * a * rho; return; }
    const sg = c === 'L' ? 1 : -1, cx = x + Math.cos(h) * rho * sg, cz = z - Math.sin(h) * rho * sg;   // (the turn's centre: left is (cos h, −sin h))
    const h2 = h + sg * a;
    x = cx - Math.cos(h2) * rho * sg; z = cz + Math.sin(h2) * rho * sg; h = h2;
  };
  seg(w.kind[0], w.t); seg(w.kind[1], w.p); seg(w.kind[2], w.q);
  return { x, z, h };
}
