// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's own player (docs/features/arcade.md "Agents at the arcade"; 2026-11-17, the product owner: AI agents are
// players — "if the player can do it then AI agents should also be able to do it"): one player for every built-in game,
// from the sim's interface alone (init, step, over, score: shared/arcade/core.js) — never a bot written for a game, so a
// game added later is played by agents the day it is added.
//
// - What it can press: found by trying the sim itself (controlsOf): from states met while wandering through a few games,
//   each button (and the pointer, along x and y) held then let go against holding nothing; what changes nothing is not a
//   button of this game, and two that change the same things are one. Then the pairs that make sense (two directions, a
//   direction and a button).
// - How it plays: a rolling plan of inputs held for a while (segments: what is held, how many steps), over a horizon of
//   steps ahead. Every few steps it thinks again — the plan it is following (what is left of it), changes to it, and new
//   ones, each played out on a copy of the game, the best kept — then does the next few steps of the best. Anytime: it
//   thinks as much as its budget lets it (steps of the sim, a few thousand a second: bounded per player), and a plan
//   it can't afford to think about again it just goes on with. The horizon grows when nothing it tries makes a
//   difference yet (the ball still rolling to the cups) and shrinks back slowly.
// - Fair: a copy it plays out has dice of its own (the state's own dice replaced with the player's), so it sees what is
//   on the screen, never what the game's dice will throw next (the next piece, whether the claw slips).
// - Its value of a plan: the points it makes, a life lost worth half a bronze score (the game's own stars), the game over
//   worth a silver one (later is better); winding up (its time is up), the game over sooner is all it wants.
// - Skill (0 … 1, from its arcade level): how often it thinks (every 10 steps new, every 4 at best), how quickly what it
//   decides reaches its hands (230 ms new, 100 ms at best), how much it thinks (its budget), how far ahead at most, and
//   its slips (a moment's hesitation or a wrong press: one in two seconds new, one in twenty at best).
// - Human, not a machine: what a person of its skill scores is the game's own yardstick — its stars, a beginner about
//   bronze, the best about gold (with its form on the day). Past it, it tires (slower, less thought, more slips); at a
//   third as much again it has had its fill and lets the game run out. A simulated mind could otherwise outscore every
//   person on the boards by ten times.
// Everything it does is deterministic from its seed (its own dice), and every step is recorded (InputLog): the server
// plays its log again from the run's seed to check it like anyone's (shared/arcade.js verify).
import { BTN, BTN_MASK, InputLog, inputValue, inputBits, makeRng, TICK_HZ } from './core.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/** A deep copy of a sim's state (plain data: objects, arrays, typed arrays, numbers, strings, booleans, null). */
export function cloneState(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) {
    const n = x.length, out = new Array(n);
    for (let i = 0; i < n; i++) { const v = x[i]; out[i] = v !== null && typeof v === 'object' ? cloneState(v) : v; }
    return out;
  }
  if (ArrayBuffer.isView(x)) return x.slice();
  const out = {};
  for (const k of Object.keys(x)) { const v = x[k]; out[k] = v !== null && typeof v === 'object' ? cloneState(v) : v; }
  return out;
}
/** How much of a plan presses something (steps). */
const busyOf = segs => { let n = 0; for (const [v, k] of segs) if (v) n += k; return n; };
/** Plans, best first: by value; as good, the one pressing less (nothing better than waiting found: it waits, and thinks
 *  on — a shot not taken before it is worth taking). */
const better = (x, y) => y.val - x.val || (x.busy ?? 0) - (y.busy ?? 0);
/** One step of a sim as the replay does it (its events cleared first). */
const stepOf = (sim, s, v) => { s.ev.length = 0; sim.step(s, inputBits(v)); };
/** What a state is, to compare two (its events left out: they never change the play; a game over is its score — what
 *  was held when it ended is no difference). */
const digestOf = sim => s => { if (sim.over(s)) return `over:${sim.score(s)}`; const ev = s.ev; s.ev = []; const j = JSON.stringify(s); s.ev = ev; return j; };

// ------------------------------------------------------------------------------------------- what it can press
const CTRL = new WeakMap();
const PROBE_SEEDS = [0x51ab, 0x2f3c9, 0x77e1, 0x1d00d];
const DIRS = [BTN.U, BTN.D, BTN.L, BTN.R], ACTS = [BTN.A, BTN.B];

/**
 * The controls of a sim, found by trying it (cached per sim): { inputs: [input values, buttons only: the first is
 * nothing], pointer: null | { x, y } (which of its axes the game reads), stepUs (about how long a step takes, in µs) }.
 */
export function controlsOf(sim) {
  let c = CTRL.get(sim);
  if (!c) { c = probe(sim); CTRL.set(sim, c); }
  return c;
}
const PROBE_MS = 160;   // the most a probe looks for (once per game): what it has not settled by then counts as a button
function probe(sim) {
  const rng = makeRng(0xc0de5), t0 = now(), late = () => now() - t0 > PROBE_MS;
  // states met while wandering through a few games, pressing anything (taken in turn from each game)
  const games = [];
  let steps = 0;
  for (const seed of PROBE_SEEDS) {
    const s = sim.init(seed), mine = [];
    let v = 0, hold = 0;
    for (let t = 0; t < 2600 && !sim.over(s) && mine.length < 10 && now() - t0 < PROBE_MS / 3; t++) {
      if (hold-- <= 0) { v = rng() % 3 === 0 ? 0 : inputValue(rng() & BTN_MASK, rng() & 255, rng() & 255, rng() & 1); hold = 3 + (rng() % 40); }
      stepOf(sim, s, v); steps++;
      if (t % 83 === 30) mine.push(cloneState(s));
    }
    games.push(mine);
  }
  const samples = [];
  for (let k = 0; k < 10; k++) for (const g of games) if (g[k]) samples.push(g[k]);
  const stepUs = steps ? ((now() - t0) * 1000) / steps : 5, digest = digestOf(sim);
  // what a sample becomes with an input pressed a moment, held a while, and tapped again and again — each time let go
  // after (a sim keeps what was held last, its own `prev`: that alone is no difference)
  const memo = new Map();
  const after = (v, i) => {
    const key = `${v}:${i}`;
    let d = memo.get(key);
    if (d) return d;
    const s0 = samples[i], a = cloneState(s0), b = cloneState(s0), c = cloneState(s0);
    for (let k = 0; k < 6; k++) stepOf(sim, a, v);
    for (let k = 0; k < 24; k++) stepOf(sim, a, 0);
    for (let k = 0; k < 40; k++) stepOf(sim, b, v);
    stepOf(sim, b, 0);
    for (let k = 0; k < 60; k++) stepOf(sim, c, k % 4 < 2 ? v : 0);
    d = [digest(a), digest(b), digest(c)];
    memo.set(key, d);
    return d;
  };
  /** Whether input v does something none of `others` does, on some sample (not settled in time: yes). */
  const differs = (v, others) => {
    for (let i = 0; i < samples.length; i++) {
      if (late()) return true;
      const d = after(v, i);
      if (others.every(o => { const e = after(o, i); return d[0] !== e[0] || d[1] !== e[1] || d[2] !== e[2]; })) return true;
    }
    return false;
  };
  const inputs = [0], used = [];
  for (const bt of [...DIRS, ...ACTS]) if (differs(bt, [0])) { used.push(bt); inputs.push(bt); }
  const has = bt => used.includes(bt);
  // the pairs that do more than either alone: two directions at once (diagonals), a direction with a button, both buttons
  const pair = (x, y) => { if (has(x) && has(y) && differs(x | y, [x, y])) inputs.push(x | y); };
  for (const y of [BTN.U, BTN.D]) for (const x of [BTN.L, BTN.R]) pair(x, y);
  for (const d of DIRS) for (const a of ACTS) pair(d, a);
  pair(BTN.A, BTN.B);
  // the pointer: does the game read where it points, along x, along y?
  const P = (x, y) => inputValue(0, x, y, 1);
  const px = differs(P(48, 128), [P(208, 128)]), py = differs(P(128, 48), [P(128, 208)]);
  const pointer = px || py || differs(P(128, 128), [0]) ? { x: px, y: py } : null;
  return Object.freeze({ inputs: Object.freeze(inputs), pointer: pointer && Object.freeze(pointer), stepUs: clamp(stepUs, 0.05, 500), probeMs: Math.round(now() - t0) });
}

// ------------------------------------------------------------------------------------------- skill
/** The skill (0 … 1) of an arcade level (shared/play.js moduleLevel): new at level 1, its best from level 12. */
export const skillOfLevel = level => clamp(((Number(level) || 1) - 1) / 11, 0, 1);
/** CPU it may spend thinking, in µs a second of play (its budget, before the sim's own cost per step). */
export const THINK_US = Object.freeze({ low: 8000, high: 24000 });
const SAVE_S = 20;     // seconds of thinking it may save up while it waits (a shot to plan after the computer's turn)
const SLICE_MS = 8;    // the most one decision may take (what it saved up is spent over the next ones)

// ------------------------------------------------------------------------------------------- the player
/**
 * Plays one run of a sim from its seed. o: { skill (0 … 1), dice (its own dice' seed), stars ([bronze, silver, gold]: the
 * game's own, to weigh lives and the game over), stepsPerTick (its thinking budget in sim steps per step played: else
 * from THINK_US and the sim's cost), horizon ([start, most] in steps) }.
 * Use: play(n) steps (it decides as it goes), then encode() → the input log the server checks.
 */
export class ArcadePlayer {
  constructor(sim, seed, o = {}) {
    this.sim = sim;
    this.ctl = controlsOf(sim);
    this.seed = seed >>> 0;
    this.s = sim.init(this.seed);
    this.log = new InputLog();
    this.ticks = 0;
    this.skill = clamp(Number(o.skill) || 0, 0, 1);
    this.rng = makeRng(((o.dice ?? this.seed ^ 0x9e3779b9) >>> 0) || 1);
    const st = Array.isArray(o.stars) && o.stars.length ? o.stars : [100, 1000, 3000];
    this.lifeW = Math.max(1, (Number(st[0]) || 100) * 0.5);
    this.overW = Math.max(1, Number(st[1] ?? st[0]) || 1000);
    const k = this.skill;
    this.every = Math.round(10 - 6 * k);                       // steps between its decisions
    this.lag = Math.round(14 - 8 * k);                         // steps before what it decides reaches its hands (230 ms new, 100 ms at best)
    this.slip = (0.6 - 0.55 * k) * this.every / TICK_HZ;       // a decision's chance to go wrong (new: one slip in two seconds; at best one in twenty)
    // what a person of its skill scores (the game's own stars: a beginner about bronze, the best about gold) and
    // its form today; past it, its concentration goes (its slips grow: a long game wears anyone out)
    const lo = Math.max(1, 0.8 * (Number(st[0]) || 100)), hi = Math.max(lo, 1.1 * (Number(st[st.length - 1]) || lo));
    const g = (this.r01() + this.r01() + this.r01() - 1.5) * 2;   // (about −1 … 1, mostly near 0)
    this.target = Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * k + 0.2 * g);
    // thinking: sim steps per step played — fixed (o.stepsPerTick: the same play every time, for tests), else its CPU
    // budget (o.thinkUs: µs a second of play) over what a step of this sim really takes, measured as it thinks
    this.fixed = Number.isFinite(o.stepsPerTick);
    this.thinkUs = Number(o.thinkUs) > 0 ? Number(o.thinkUs) : THINK_US.low + (THINK_US.high - THINK_US.low) * k;
    this.costUs = this.ctl.stepUs;
    this.rate = this.fixed ? Math.max(1, o.stepsPerTick) : this.rateOf();
    const [h0, h1] = o.horizon || [45, Math.round(480 + 720 * k)];
    this.sliceMs = Number(o.sliceMs) > 0 ? Number(o.sliceMs) : SLICE_MS;
    this.h0 = h0; this.hMax = Math.max(h0, h1); this.H = h0;
    this.bank = this.rate * 30;                                // a moment to look before the first step
    this.elite = [];                                           // its best plans: { segs: [[v, n], …], val }
    this.doing = [];                                           // what it does next: [[v, n], …]
    this.wrap = false;
    this.stats = { thought: 0, plans: 0, slips: 0, decisions: 0 };
  }
  get over() { return !!this.sim.over(this.s); }
  get score() { return this.sim.score(this.s); }
  /** The input log so far (what the server plays again). */
  encode() { return this.log.encode(); }
  rateOf() { return clamp(Math.round(this.thinkUs / TICK_HZ / this.costUs), 4, 20000); }
  /** Its CPU budget (µs a second of play), changed while it plays (more players at once: less each). */
  budget(us) { if (Number(us) > 0 && !this.fixed) { this.thinkUs = Number(us); this.rate = this.rateOf(); } }
  /** Its time is up: from now on it plays to end the game (it lets it run out). */
  windUp() { if (!this.wrap) { this.wrap = true; this.elite = []; this.H = Math.max(this.H, 120); } }

  /** Plays up to n steps (deciding when it is due). → steps played (fewer once the game is over). */
  play(n) {
    let k = 0;
    while (k < n && !this.sim.over(this.s)) {
      if (!this.doing.length || this.ticks % this.every === 0) this.decide();
      const seg = this.doing[0], v = seg[0];
      if (--seg[1] <= 0) this.doing.shift();
      stepOf(this.sim, this.s, v);
      this.log.push(v);
      this.ticks++; k++;
      this.bank = Math.min(this.rate * SAVE_S * TICK_HZ, this.bank + this.rate);   // (what it may save up while it waits: the computer's turn, the balls rolling)
    }
    return k;
  }

  // ---- thinking
  r01() { return this.rng() / 4294967296; }
  pick(n) { return Math.floor(this.r01() * n); }
  /** How long a hold (or a wait) lasts: anything from a step to almost three seconds, short ones as likely as long
   *  ones on a log scale (a tap, a turn, a charge, a long straight run). */
  randLen(most = 160) { return clamp(Math.round(Math.exp(this.r01() * Math.log(most))), 1, most); }
  /** Something to hold: nothing, or one of its inputs (with the pointer somewhere, for a game that reads it). */
  randInput() {
    const I = this.ctl.inputs, P = this.ctl.pointer;
    const b = this.pick(4) === 0 ? 0 : I[this.pick(I.length)];
    return P && this.pick(2) === 0 ? inputValue(b, P.x ? this.pick(256) : 128, P.y ? this.pick(256) : 128, 1) : b;
  }
  randSeg() { return [this.randInput(), this.randLen()]; }
  /** A random plan of H steps: holds, each let go for a while after (a tap and a wait) or not (one straight into the next). */
  randPlan(H = this.H) {
    const segs = [];
    let t = 0;
    while (t < H) {
      const g = this.randSeg(); segs.push(g); t += g[1];
      if (g[0] && this.pick(2)) { const w = [0, this.randLen()]; segs.push(w); t += w[1]; }
    }
    return this.fit(segs, H);
  }
  /** A plan holding one input all along (nothing at all, among them): what the simplest of plans would do. */
  steady(v, H = this.H) { return [[v, H]]; }
  /** A plan cut or filled out to H steps (after dropping the first `drop` steps: those it has done). */
  fit(segs, H, drop = 0) {
    const out = [];
    let skip = drop, t = 0;
    for (const [v, n0] of segs) {
      let n = n0;
      if (skip > 0) { const d = Math.min(skip, n); n -= d; skip -= d; if (n <= 0) continue; }
      if (t >= H) break;
      n = Math.min(n, H - t); out.push([v, n]); t += n;
    }
    if (t < H) { const tail = this.randTail(H - t); for (const g of tail) out.push(g); }
    return out;
  }
  randTail(n) { const out = []; let t = 0; while (t < n) { const g = this.randSeg(); g[1] = Math.min(g[1], n - t); out.push(g); t += g[1]; if (t < n && g[0] && this.pick(2)) { const w = [0, Math.min(n - t, this.randLen())]; out.push(w); t += w[1]; } } return out; }
  mutate(segs) {
    const out = segs.map(g => [g[0], g[1]]), i = this.pick(out.length), P = this.ctl.pointer, r = this.pick(6);
    if (r === 0) out[i] = this.randSeg();
    else if (r === 1) out[i][0] = this.randSeg()[0];
    else if (r === 2) out[i][1] = clamp(Math.round(out[i][1] * (0.5 + this.r01())) + this.pick(5) - 2, 1, 200);
    else if (r === 3 && P && (out[i][0] >>> 24) & 1) {   // (aim a little differently)
      const { b, px, py } = inputBits(out[i][0]), d = () => this.pick(2) ? 1 + this.pick(4) : 4 + this.pick(28);
      out[i][0] = inputValue(b, P.x ? clamp(px + (this.pick(2) ? d() : -d()), 0, 255) : px, P.y ? clamp(py + (this.pick(2) ? d() : -d()), 0, 255) : py, 1);
    } else if (r === 4 && out.length > 1) out.splice(i, 1);
    else out.splice(i, 0, this.randSeg());
    return this.fit(out, this.H);
  }
  livesOf(s) { return typeof s.lives === 'number' ? s.lives : 0; }
  /** Plays plan segs on a copy of the game with its own dice — after what its hands are already doing (base.now) —:
   *  → its value. */
  value(segs, base) {
    const sim = this.sim, c = cloneState(this.s), H = this.H;
    if (Array.isArray(c.rs)) for (let k = 0; k < c.rs.length; k++) c.rs[k] = this.rng() | 0;
    let t = 0;
    out: for (const list of [base.now, segs]) for (const [v, n] of list) for (let k = 0; k < n; k++) { if (sim.over(c)) break out; stepOf(sim, c, v); t++; }
    this.bank -= t + 4; this.stats.thought += t;
    const over = sim.over(c);
    this.lastOver = over;
    // (winding up: the game over soonest — a life lost is a step toward it —, else pressing as little as it can: it lets
    // the game run out)
    if (this.wrap) { let busy = 0; for (const [v, n] of segs) if (v) busy += n; return (over ? 1e9 - t : 0) + 1e6 * Math.max(0, base.lives - this.livesOf(c)) - busy / H; }
    let val = sim.score(c) - base.score + this.lifeW * (this.livesOf(c) - base.lives);
    if (over) val -= this.overW * (1 - (0.5 * t) / H);
    return val;
  }
  decide() {
    this.stats.decisions++;
    const done = this.ticks - (this.lastAt ?? this.ticks);
    this.lastAt = this.ticks;
    // past what a person of its skill scores, it tires: slower to react, less to think with, more slips (below); at a third
    // as much again it has had its fill and lets the game run out
    const score0 = this.sim.score(this.s);
    if (!this.wrap && score0 > 1.35 * this.target) this.windUp();
    const tired = this.wrap ? 0 : Math.max(0, score0 / this.target - 0.75);
    const lag = this.lag + Math.round(10 * Math.min(2, tired)), most = Math.max(4, Math.round(160 / (1 + 8 * tired)));
    // what its hands are already doing (its reaction time: what it decides now starts after that)
    const now0 = this.fit(this.doing.length ? this.doing : [[0, lag]], lag);
    const base = { score: score0, lives: this.livesOf(this.s), now: now0 };
    const H = this.H, cost = H + lag + 4, t0 = this.fixed ? 0 : now(), spent0 = this.stats.thought;
    // what it was going to do: what is left of it
    const keep = this.elite.map(e => ({ segs: this.fit(e.segs, H, done), val: e.val }));
    let tried = 0, lo = Infinity, hi = -Infinity;
    const note = v => { tried++; if (v < lo) lo = v; if (v > hi) hi = v; };
    if (this.bank >= cost) {
      const pool = [];
      const add = segs => { const v = this.value(segs, base); note(v); pool.push({ segs, val: v, over: this.lastOver, busy: busyOf(segs) }); this.stats.plans++; };
      // its plans again (with fresh dice: the value it had and the new one, together)
      for (const e of keep) {
        if (this.bank < cost) { pool.push(e); continue; }
        const v = this.value(e.segs, base); note(v);
        pool.push({ segs: e.segs, val: Number.isFinite(e.val) ? (e.val + v) / 2 : v, over: this.lastOver, busy: busyOf(e.segs) });
      }
      // the simplest plans — holding nothing, holding what it holds now — then changes to its best and new ones
      if (this.bank >= cost) add(this.steady(0, H));
      const held = keep[0]?.segs[0]?.[0];
      if (held && this.bank >= cost) add(this.steady(held, H));
      for (let n = 0; this.bank >= cost && n < most; n++) {
        if (this.fixed ? this.stats.thought - spent0 > this.rate * 2 * TICK_HZ : now() - t0 > this.sliceMs) break;   // (the rest on the next decision)
        const top = Math.min(pool.length, 4);
        add(top && this.pick(3) ? this.mutate(pool.sort(better)[this.pick(top)].segs) : this.randPlan(H));
      }
      pool.sort(better);
      this.elite = pool.slice(0, 4);
      // its best plan safe to the end and nothing to win in it (nothing in sight yet: the ball still rolling to the cups,
      // the orb across the field): look further ahead; the best of them ending the game, or winning something: come
      // back (slowly when it wins: it keeps sight of it)
      const top = this.elite[0];
      if (tried >= 2 && !top.over && Math.abs(top.val) < 1e-6) this.H = Math.min(this.hMax, Math.ceil(this.H * 1.25));
      else if (tried >= 3) this.H = Math.max(this.h0, Math.floor(this.H * (top.over ? 0.9 : 0.985)));
    } else this.elite = keep;
    if (!this.elite.length) this.elite = [{ segs: this.randPlan(H), val: -Infinity }];
    // what a step of this sim really costs it (its budget is CPU time, not steps)
    if (!this.fixed) {
      const steps = this.stats.thought - spent0;
      if (steps > 200) { const us = ((now() - t0) * 1000) / steps; this.costUs = clamp(this.costUs * 0.8 + us * 0.2, 0.02, 500); this.rate = this.rateOf(); }
    }
    // what it does next: what its hands are doing, then the best plan's first steps — or a slip (a moment's hesitation, a
    // wrong press), more of them once it plays past what a person of its skill would (tired, it loses focus)
    const best = this.elite[0].segs, every = this.every, over = tired;
    const slip = Math.min(0.85, this.slip * (1 + 40 * over * over));
    let next;
    if (!this.wrap && this.r01() < slip) { this.stats.slips++; next = [[this.r01() < 0.5 + Math.min(0.4, over) ? this.randInput() : 0, every]]; }
    else next = this.fit(best, every);
    this.doing = [...now0, ...next].map(g => [g[0], g[1]]);
  }
}

/**
 * Plays a whole run at once (tests, the score table): → { score, ticks, log, over, player }. o: ArcadePlayer's, maxTicks
 * (it winds up after this many steps) and windTicks (it gives up that many steps later: 3 minutes).
 */
export function playRun(sim, seed, o = {}) {
  const p = new ArcadePlayer(sim, seed, o), max = o.maxTicks ?? 10 * 60 * TICK_HZ, wind = o.windTicks ?? 3 * 60 * TICK_HZ;
  while (!p.over && p.ticks < max) p.play(60);
  if (!p.over) { p.windUp(); while (!p.over && p.ticks < max + wind) p.play(60); }
  return { score: p.score, ticks: p.ticks, log: p.encode(), over: p.over, player: p };
}
