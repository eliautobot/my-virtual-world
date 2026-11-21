// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The companions' fishing drawn as a player's own is (2026-11-19, the product owner: "I want to see them cast the line and
// see their line, and see their actual fish same as the player"): for each companion aboard a boat this page draws
// (render/boat-crew.js, from the harbour's crew rows and their detail: server/play/fishing-crew.js rows), the effects of a
// player's own (render/fishing-fx.js, one set each): the lure flying out from the rod's tip on its arc and landing with a
// splash, the bobber riding the water (or the lure) with the line to it, reeled in when nothing took it; on a fish, the
// same fight its server played (shared/fishing-fight.js on its seed, played over the time it took): the line taut to the
// fish in the water, its runs this way and that, its leaps clear of the water; the net at the boat's side; and the catch
// held up the way anglers hold one (by the line, by the gills, in both arms: its weight), sparks round a rare one.
import * as THREE from 'three';
import { FishingFx } from './fishing-fx.js';
import { bodyToWorld } from './characters.js';
import { heights, waterUnder } from './sea-probe.js';
import { ROD_TIP } from '/shared/held.js';
import { speciesOf, RARITY } from '/shared/fish-species.js';
import { kitFor } from '/shared/fishing.js';
import { fightSetup, fightStep, botInput, FIGHT_DT, MAX_FIGHT_S } from '/shared/fishing-fight.js';

const POOL = 8;                // the most companions' fishing drawn at once (each its own line, lure and fish)
const CAST_RELEASE = 0.42;     // s into the cast clip: the lure leaves the rod
const REEL_S = 3.5;            // s: an empty line reeled in (server/play/fishing-crew.js REEL_IN_MS)
const _q = new THREE.Vector3(), _tip = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** How a catch is held up (fishing-game.js holdStyle): by the line, by the gills, in both arms. */
export function holdStyle(c) {
  if (c.find) return { boot: 'line', can: 'line', pouch: 'line', goldenlure: 'line', bottle: 'gill', tyre: 'two' }[c.find] || 'two';
  return c.kg < 1.2 ? 'line' : c.kg < 7 ? 'gill' : 'two';
}
/** The water's surface at x, z (the drawn waves, as the player's own lure rides them), or null over land. */
function surface(x, z) {
  const w = waterUnder(x, z); if (!w) return null;
  const y = heights('fish:crew', [{ x, z }], w.level, w.lake)[0];
  return { level: w.level, y: Number.isFinite(y) ? y : w.level, lake: !!w.lake };
}

export class CrewFishing {
  constructor(app) {
    this.app = app;
    this.on = new Map();     // body index → { fx, seq, F, … } (its effects and this phase's state)
    this.free = [];          // effects not in use (pooled)
    this.last = performance.now();
    this.stats = { drawn: 0, fights: 0 };
  }
  stateOf(i) {
    let s = this.on.get(i);
    if (!s) {
      if (this.on.size >= POOL) return null;
      const fx = this.free.pop() || new FishingFx(this.app.stage, { uw: this.app.terrain?.uw });
      this.on.set(i, s = { fx, seq: -1 });
    }
    return s;
  }
  /** Body i's effects put away (not fishing, out of view, gone). */
  drop(i) { const s = this.on.get(i); if (!s) return; s.fx.hideAll(); this.free.push(s.fx); this.on.delete(i); }
  /** Before the crew are drawn: the time since the last frame. */
  begin() { const now = performance.now(); this.dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.seen = new Set(); }
  /** After: the effects of those not drawn this frame put away; the ripples spread. */
  end() {
    for (const i of [...this.on.keys()]) if (!this.seen.has(i)) this.drop(i);
    for (const s of this.on.values()) s.fx.update(this.dt);
    this.stats.drawn = this.on.size;
  }
  /**
   * Companion i's fishing this frame. r: its crew row ({ phase, at, x: detail }); at: where it stands on the deck ({ x, y,
   * z }), yaw: the way it faces out; clip, ph: its body's clip and phase now (for the rod's tip and its hands).
   */
  frame(i, r, at, yaw, clip, ph) {
    const x = r.x;
    if (!Array.isArray(x)) return;
    const s = this.stateOf(i);
    if (!s) return;
    this.seen.add(i);
    const fx = s.fx, chars = this.app.agents?.chars, now = performance.now(), t = (now - r.at) / 1000;
    if (s.seq !== r.seq) { s.seq = r.seq; s.F = null; s.splashed = false; s.jumping = false; s.burst = false; s.ang = 0; s.net = false; fx.hideAll(); }
    const [H, Bd] = chars?.bodyScale ? chars.bodyScale(i) : [1, 1];
    const grip = (side, off, out) => { const q = chars?.gripPoint?.(i, clip, ph, side, off, [0, 0, 0]); return q ? bodyToWorld(q, H, Bd, yaw, at.x, at.y, at.z, out) : null; };
    const tip = grip('R', ROD_TIP, _tip) || _tip.set(at.x + Math.sin(yaw) * 1.6, at.y + 2.2, at.z + Math.cos(yaw) * 1.6);
    const d0 = Math.max(3, x[0] / 10), float = !x[1];
    const out = d => ({ x: at.x + Math.sin(yaw + (s.ang || 0)) * d, z: at.z + Math.cos(yaw + (s.ang || 0)) * d });
    const lureAt = (d, sink = 0) => { const p = out(d), w = surface(p.x, p.z); return w ? _a.set(p.x, w.y - sink, p.z) : null; };
    switch (r.phase) {
      case 'cast': {
        // the rod comes over; the lure leaves its tip and flies out on its arc to the water, a splash where it lands
        const dur = 0.55 + d0 / 32, u = (t - CAST_RELEASE) / dur;
        if (u <= 0) { fx.line(null); fx.lure(null); return; }
        const end = lureAt(d0); if (!end) return;
        if (u >= 1) {
          if (!s.splashed) { s.splashed = true; fx.splash(end.x, end.y, end.z, 0.12); }
          fx.lure(end, float ? 'float' : 'lure', '#e8d040', 0, yaw); fx.line(tip, end, 0.55, end.y); return;
        }
        const p = _b.set(tip.x + (end.x - tip.x) * u, tip.y + (end.y - tip.y) * u + Math.sin(Math.PI * u) * (1.2 + d0 * 0.08), tip.z + (end.z - tip.z) * u);
        fx.lure(p, 'lure', float ? '#e03a2e' : '#e8d040', 0, yaw); fx.line(tip, p, 0.1);
        return;
      }
      case 'wait': {
        // the bobber riding the swell (now and then a nibble dips it), or the lure swimming; the line lying to it
        const end = lureAt(d0); if (!end) return;
        const nib = Math.max(0, Math.sin(now / 1000 * 2.1 + i) - 0.93) * 0.9;
        fx.lure(end, float ? 'float' : 'lure', '#e8d040', float ? nib : 0, yaw);
        fx.line(tip, end, 0.6, end.y);
        if (nib > 0.03 && Math.random() < 0.05) fx.ripple(end.x, end.y, end.z, 0.6, 0.9);
        return;
      }
      case 'reel': {
        // nothing took it: wound in to the boat's side
        const u = Math.min(1, t / REEL_S), end = lureAt(d0 + (1.4 - d0) * u, float ? 0 : 0.15); if (!end) return;
        if (u >= 1) { fx.line(null); fx.lure(null); return; }
        fx.lure(end, float ? 'float' : 'lure', '#e8d040', 0, yaw); fx.line(tip, end, 0.12, end.y);
        return;
      }
      case 'fight': return this.fight(s, x, tip, at, yaw, t, d0);
      case 'net': {
        // at the boat's side, into the net: a splash as it comes out of the water
        fx.line(null); fx.lure(null); fx.fish(null, null);
        if (!s.net) { s.net = true; const p = lureAt(1.3); if (p) fx.splash(p.x, p.y, p.z, Math.min(1.2, (x[5] || 40) / 100)); }
        return;
      }
      case 'show': return this.show(s, x, grip, at, yaw, now);
      default: fx.hideAll();
    }
  }
  /** The fight its server played, played again here on its seed over the time it took: the fish's runs, dives and leaps. */
  fight(s, x, tip, at, yaw, t, d0) {
    const fx = s.fx, [, , id, find, g, seed, ds, landed, skill, cm0, push = 0] = x, kg = g / 1000, secs = Math.max(1, ds / 10);
    const what = find ? { find: id } : { species: id, kg, cm: cm0 };
    const len = find ? 1 : Math.min(3.5, (cm0 || 40) / 100);
    if (!s.F) {
      const sp = find ? null : speciesOf(id), water = surface(at.x + Math.sin(yaw) * 4, at.z + Math.cos(yaw) * 4)?.lake ? 'lake' : 'sea';
      if (sp) {
        const L = kitFor({}, water), mk = () => fightSetup(sp, { kg }, L, { d0, seed });
        // (how long its fight runs here, to play it over the time the server's took)
        const probe = mk(); let k = 0;
        for (; !probe.out && k < MAX_FIGHT_S / FIGHT_DT; k++) fightStep(probe, botInput(probe, (skill || 70) / 100, push));
        s.F = mk(); s.rate = Math.max(0.2, probe.t / secs); s.skill = (skill || 70) / 100; s.push = push;
      } else s.F = { find: true };
      s.ang = 0; this.stats.fights++;
    }
    const F = s.F;
    let d = d0, mode = 'run', jumpU = -1;
    if (F.find) d = Math.max(1.5, d0 - (d0 - 1.5) * Math.min(1, t / secs));
    else {
      // the fight on to where it is now (its own clock, scaled to the server's time)
      const want = Math.min(t * s.rate, MAX_FIGHT_S);
      while (!F.out && F.t < want) {
        const before = F.mode;
        fightStep(F, botInput(F, s.skill, s.push || 0));
        if (F.mode === 'jump' && before !== 'jump') s.jumping = true;
        // its runs carry it round the boat (drawn: the way it pulls, never behind the angler)
        s.ang = Math.max(-1, Math.min(1, s.ang + (F.dir || 0) * 0.35 * FIGHT_DT * (F.mode === 'blitz' ? 1.6 : 1) - (F.mode === 'toward' ? s.ang * 0.4 * FIGHT_DT : 0)));
      }
      d = Math.max(1.2, F.d); mode = F.mode;
      if (F.mode === 'jump' && F.jump) jumpU = Math.min(1, F.jump.t / (0.85 + Math.min(0.5, len * 0.25)));
    }
    // lost at the end (its server's fight went that way): the line goes slack, the fish is gone
    if (!landed && t > secs - 0.4) { fx.fish(null, null); fx.line(tip, _b.set(tip.x + Math.sin(yaw) * 5, tip.y - 2, tip.z + Math.cos(yaw) * 5), 0.8); return; }
    const p = { x: at.x + Math.sin(yaw + s.ang) * d, z: at.z + Math.cos(yaw + s.ang) * d }, w = surface(p.x, p.z);
    if (!w) return;
    const fyaw = yaw + s.ang + (mode === 'toward' ? Math.PI : 0) + (F.dir || 0) * 0.9;
    if (jumpU >= 0 && jumpU < 1) {
      const h = Math.min(2.6, 0.5 + len * 0.9), y = w.y + Math.sin(Math.PI * jumpU) * h;
      if (s.jumping) { s.jumping = false; fx.splash(p.x, w.y, p.z, Math.min(1.4, 0.3 + len * 0.6)); }
      fx.fish(what, 'air', _c.set(p.x, y, p.z), fyaw, Math.cos(Math.PI * jumpU) * 0.9, len, 0);
      fx.line(tip, _c, 0.05, w.y, 0.5);
      if (jumpU > 0.92 && !s.fell) { s.fell = true; fx.splash(p.x, w.y, p.z, Math.min(1.6, 0.4 + len * 0.7)); }
      return;
    }
    s.fell = false;
    const depth = mode === 'dive' ? 0.55 + len * 0.2 : 0.14 + len * 0.08;
    if (!F.find) { fx.fish(what, 'under', _c.set(p.x, w.y + 0.01, p.z), fyaw, 0, len, 0, { mode, depth, up: d < 6 }); fx.stir(p.x, w.y, p.z, len, mode, this.dt); }
    fx.line(tip, _b.set(p.x, w.y - (F.find ? 0.3 : depth * 0.8), p.z), 0, w.y, F.find ? 0.4 : Math.min(1, (F.T || 0) / Math.max(1, F.L?.drag || 5)));
  }
  /** The catch held up as anglers hold one (its weight), sparks round a rare one or a trophy, then into the cooler. */
  show(s, x, grip, at, yaw, now) {
    const fx = s.fx, [, , id, find, g, cm] = x, c = find ? { find: id } : { species: id, kg: g / 1000, cm };
    const st = holdStyle(c), len = find ? 1 : Math.min(1.6, (cm || 40) / 100);
    const R = grip('R', [0, 0, 0.05], _a), Lh = st === 'two' ? grip('L', [0, 0, 0.05], _b) : null, lx = Math.cos(yaw), lz = -Math.sin(yaw);
    let fyaw = yaw + Math.PI / 2, pitch = 0, roll = 0;
    const deep = find ? 0 : fx.depthOf(c) * len;
    if (st === 'two' || !R) {
      if (R && Lh) _c.copy(R).add(Lh).multiplyScalar(0.5).add(_q.set(-lx * 0.1 * len, -0.05 + (find ? 0.12 : 0.25 * deep), -lz * 0.1 * len));
      else _c.set(at.x + Math.sin(yaw) * 0.35, at.y + 1.15, at.z + Math.cos(yaw) * 0.35);
      roll = 0.06 * Math.sin(now / 1000 * 2); fx.line(null);
    } else if (st === 'line') {
      const drop = find ? 0.16 : 0.14, half = find ? 0.06 : len * 0.5;
      _c.set(R.x, R.y - drop - half, R.z); pitch = find ? 0 : Math.PI / 2; roll = find ? 0 : 0.5 * Math.sin(now / 1000 * 0.9);
      fx.line(_q.set(R.x, R.y - 0.03, R.z), _b.set(R.x, R.y - drop + 0.005, R.z), 0, -Infinity);
    } else {
      const k = Math.max(0, deep * 0.3 - 0.04);
      _c.set(R.x + lx * k, R.y - (find ? 0.05 : len * 0.3), R.z + lz * k); pitch = find ? 0 : Math.PI / 2; roll = 0.05 * Math.sin(now / 1000 * 1.3); fx.line(null);
    }
    fx.lure(null);
    fx.fish(c, 'held', _c, fyaw, pitch, len, roll);
    if (!s.burst) {
      s.burst = true;
      const sp = find ? null : speciesOf(id), rare = sp && ['rare', 'epic', 'legendary'].includes(sp.rarity);
      if (rare) fx.burst(_c.x, _c.y, _c.z, RARITY[sp.rarity]?.color || '#ffd36a', sp.rarity !== 'rare', len);
    }
  }
}
