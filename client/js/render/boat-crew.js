// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The companions on the fishing boats (docs/features/fishing.md §Companions aboard; server/play/fishing-crew.js): an AI agent
// aboard its owner's boat is hidden in the simulation (as in a car) and drawn here at its fishing spot on the deck — riding
// the boat as it moves and rolls, facing out over its side, rod in hand: ready, casting, waiting on a bite, reeling an empty
// line in, fighting a fish, netting it — as the server says it is (the harbour's crew rows), with its name tag and its
// bubble there. Getting on and off are the simulation's own walk down and up the dock (nobody is drawn twice). Its owner's
// page hears its catches as the fishing game's toast ("Lara landed a 2.3 kg Red Snapper!").
//
// It draws after the cars' people (render/car-occupants.js) in render/agents.js update, through the same hook (seated).
import { bus, S } from '../core/state.js';
import { CLIP, CLIP_DUR } from './anim.js';
import { evalDecoded, F_HIDDEN } from '/shared/proto.js';
import { BOATS, boatPoint } from '/shared/boat-model.js';
import { CrewFishing, holdStyle } from './crew-fishing.js';

// (server/play/fishing-crew.js PHASES: what its body does, by index)
const PHASES = ['aboard', 'ready', 'cast', 'wait', 'reel', 'fight', 'net', 'show', 'rest'];
const _e = { k: 0, u: 0, x: 0, y: 0, z: 0 };

export class BoatCrew {
  constructor(app) {
    this.app = app;
    this.rows = new Map();   // body index → { boat, spot, phase, seq, at (performance.now() its phase began here), x (detail) }
    this.fishing = new CrewFishing(app);   // (their lines, lures, fish and catches: render/crew-fishing.js)
    this.stats = { rows: 0, drawn: 0 };
  }
  /** The harbour's frame (server/world/boats.js tick): the crew aboard the boats this page draws. */
  onHarbour(m) {
    const now = performance.now(), seen = new Set();
    for (const row of m.crew || []) {
      const [boat, i, spot, ph, seq, x] = row;
      if (!Number.isInteger(i)) continue;
      seen.add(i);
      const r = this.rows.get(i);
      if (!r || r.seq !== seq || r.boat !== boat) this.rows.set(i, { boat, spot, phase: PHASES[ph] || 'aboard', seq, at: now, x: x || 0 });
      else { r.spot = spot; r.x = x || 0; }
    }
    for (const i of [...this.rows.keys()]) if (!seen.has(i)) this.rows.delete(i);
    this.stats.rows = this.rows.size;
  }
  /** Its clip and phase now: the cast and the net played once through from when they began, the rest looping. */
  clipOf(r, i, now) {
    const secs = (performance.now() - r.at) / 1000, loop = c => { let ph = now / Math.max(0.3, CLIP_DUR[c] || 1) + (i * 0.381966) % 1; ph -= Math.floor(ph); return ph; };
    const once = c => Math.min(0.98, secs / Math.max(0.3, CLIP_DUR[c] || 1.4));
    switch (r.phase) {
      case 'aboard': return [CLIP.idle, loop(CLIP.idle)];
      case 'cast': return [CLIP.fish_cast, once(CLIP.fish_cast)];
      case 'reel': return [CLIP.fish_reel, loop(CLIP.fish_reel)];
      case 'fight': return [CLIP.fish_fight, loop(CLIP.fish_fight)];
      case 'net': return [CLIP.fish_net, once(CLIP.fish_net)];
      case 'show': {   // (the catch held up as anglers hold one: by the line, by the gills, in both arms — its weight)
        const x = r.x; if (!Array.isArray(x) || x.length < 5) return [CLIP.fish_idle, loop(CLIP.fish_idle)];
        const c = CLIP[`fish_hold_${holdStyle(x[3] ? { find: x[2] } : { kg: x[4] / 1000 })}`] ?? CLIP.fish_show;
        return [c, loop(c)];
      }
      default: return [CLIP.fish_idle, loop(CLIP.fish_idle)];   // (ready, waiting on a bite, the catch in the cooler, a breather)
    }
  }
  /** One frame, from render/agents.js update (after the boats' poses are known, before the people are drawn). */
  draw(A, F) {
    const app = this.app, Bt = app.boating;
    let n = 0;
    this.fishing.begin();
    if (Bt?.poseOf && this.rows.size) for (const [i, r] of this.rows) {
      const p = app.net?.plans?.[i];
      if (!p || !(i < A.n)) continue;
      evalDecoded(p, F.t, _e);
      if (!(p.flags[_e.k] & F_HIDDEN)) continue;   // (walking down or up the dock: the simulation draws it)
      const pose = Bt.poseOf(r.boat), sp = pose && BOATS[pose.type]?.deck.spots[r.spot];
      if (!sp) continue;
      const q = boatPoint(pose, sp.x, sp.y, sp.z), yaw = pose.heading + sp.yaw;
      // its name tag and voice where it stands (render/labels.js reads rx/ry/rz), and off the boat it snaps to its plan
      A.rx[i] = q.x; A.ry[i] = q.y; A.rz[i] = q.z; A.yaw[i] = yaw; A.ctx[i] = -1; A.last[i] = F.frame; A.carF[i] = F.frame;
      const cp = F.cp, dx = q.x - cp.x, dy = q.y + 0.9 - cp.y, dz = q.z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
      const lod = d2 < F.L0 ? 0 : d2 < F.L1 ? 1 : d2 < F.L2 ? 2 : -1;
      if (lod < 0) continue;
      let inF = true;
      for (const P of F.PL) if (P.normal.x * q.x + P.normal.y * (q.y + 0.9) + P.normal.z * q.z + P.constant < -1.3) { inF = false; break; }
      if (!inF) continue;
      const [clip, ph] = this.clipOf(r, i, F.now);
      // (a fishing clip carries its rod: render/char-props.js GEAR_CLIP)
      A.chars.push(lod, q.x, q.y, q.z, yaw, clip, ph, clip, ph, 0, i, 0, i === S.sel ? 2 : i === S.hover ? 1 : 0);
      // (its line, lure and fish, as a player's own are drawn: near enough to see them)
      if (lod <= 1 && r.x) this.fishing.frame(i, r, q, yaw, clip, ph);
      n++;
    }
    this.fishing.end();
    this.stats.drawn = n;
  }
}

export function init(app) {
  if (!app.agents) return;
  const crew = app.boatCrew = new BoatCrew(app), before = app.agents.seated;
  // (after the people in cars: render/car-occupants.js keeps its own hook object)
  app.agents.seated = { draw(A, F) { if (before) before.draw(A, F); crew.draw(A, F); } };
  bus.on('msg:harbour', m => crew.onHarbour(m));
  // its owner's page: a catch as the fishing game's toast, and a word about getting on and off, the sale
  bus.on('msg:crew_catch', m => app.toast?.(`🎣 ${m.text}${m.rarity && m.rarity !== 'common' ? ` · ${m.rarityLabel || m.rarity}` : ''}${m.size === 'trophy' ? ' 👑' : ''}`, 'good', 4200));
  bus.on('msg:crew_note', m => app.toast?.(m.text, m.tone === 'good' ? 'good' : '', 3800));   // (a companion's note: aboard, or cooking a Rush — server/play/kitchen-play.js)
}
