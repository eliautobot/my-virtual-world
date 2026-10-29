// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// People's sounds (2026-10-26, F2 of the sound effects plan; the product owner: "the characters need sounds like foot
// steps, jumping, running", "walking on different surfaces, swimming"): played by the sound engine (audio/engine.js),
// each from where it happens and heard through the walls the way it would be.
// - Footsteps: the player's, and the residents' walking or running near the listener (the nearest few). A step falls
//   as the walk or run animation brings a heel to the ground (STRIKES, measured from the clips), on what is underfoot: indoors the floor by the building (tile in shops, cafés, offices' lobbies and gyms,
//   carpet on office floors, wood at home), on a deck or pier wood, the city's streets and the island's roads concrete,
//   then the ground itself (shared/biome.js: grass on meadows, fields and lawns, dirt in the woods, sand on the beach,
//   gravel on rock, snow), and shallow water.
// - The player's jumps and landings (by the surface, louder from higher), stepping into the water, jumping in, the
//   strokes while swimming, ducking under, coming up, climbing out.
// The volume is Sound effects (Settings → Sound).
import { groundAt } from '/shared/world-modules.js';
import { S, bus } from '../core/state.js';
import { CLIP_NAMES } from '../render/anim.js';
import { biome } from '/shared/biome.js';

const NEAR = 16, MOST = 8;            // residents' steps: within this many metres, at most this many at once
const PACE = { walk: 'walk', walk_hold: 'walk', walk_phone: 'walk', run: 'run', jog: 'run' };
// where in each loop of the walk and the run clips a heel meets the ground (measured from the characters' own animation:
// the sole's lowest point through every frame, all 48 bodies; each loop is two strides, four steps): a step sounds as
// the animation passes one, so it lands with the foot (2026-10-26: "running and walking should be ... matching the feet
// touching the ground")
const STRIKES = { walk: [0.125, 0.4, 0.625, 0.87], run: [0.18, 0.45, 0.68, 0.95] };
/** Whether the clip's phase went past a heel strike between a and b (0..1, wrapping). */
function struck(pace, a, b) {
  if (a == null || b == null || a === b) return false;
  const d = b - a, fwd = d >= 0 ? d : d + 1;
  if (fwd > 0.5) return false;   // (backwards, or a jump in the clip: no step)
  return STRIKES[pace].some(s => (d >= 0 ? s > a && s <= b : s > a || s <= b));
}
const FLOOR = { shop: 'tile', cafe: 'tile', restaurant: 'tile', gym: 'tile', 'office-lobby': 'tile', 'apartment-lobby': 'tile', office: 'carpet', hq: 'carpet', apartment: 'wood', park: 'grass' };
const GROUND = { beach: 'sand', dune: 'sand', meadow: 'grass', field: 'grass', crop: 'grass', hedge: 'grass', lawn: 'grass', forest: 'dirt', conifer: 'dirt', shore: 'dirt', rock: 'gravel', snow: 'snow', water: 'water' };
const LAND = { concrete: 'land-hard', tile: 'land-hard', carpet: 'land-soft', grass: 'land-soft', dirt: 'land-soft', gravel: 'land-soft', snow: 'land-soft', wood: 'land-wood', sand: 'land-sand', water: 'water-wade' };
let app = null;
const was = { air: false, swim: false, diving: false, vy: 0, stroke: 0, x: 0, z: 0, on: false, ph: null, pace: null, lastPace: null, steps: 0 };
const res = new Map();   // resident index → { x, z, ph, pace, surf, surfAt, steps }

export function init(a) {
  app = a;
  bus.on('frame', update);
  a.footsteps = { surfaceAt, get near() { return [...res.entries()].map(([i, r]) => ({ i, surf: r.surf, steps: r.steps })); }, get you() { return { ...was }; } };
}

/** What is underfoot at (x, z) with the feet at y, in context ctx (a building's floor, or -1 outside). */
export function surfaceAt(x, y, z, ctx = -1) {
  if (ctx >= 0) {
    const B = S.world?.buildings?.[ctx >> 6], f = ctx & 63; if (!B) return 'tile';
    const use = B.type === 'office' || B.type === 'hq' ? (f === 0 ? 'office-lobby' : 'office') : B.type === 'apartment' ? (f === 0 ? 'apartment-lobby' : 'apartment') : B.type;
    return FLOOR[use] || 'tile';
  }
  const T = app.terrain, I = T?.ground?.island, g = S.grid;
  if (g && x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ) return 'concrete';
  if (!T || !I) return 'concrete';
  const h = T.heightAt(x, z), sea = T.params.seaLevel;
  if (h < sea - 0.08 && y < sea + 0.05) return 'water';
  const road = I.roads?.top?.(x, z);
  if (road != null && Math.abs(road - y) < 0.6) return 'concrete';
  const mod = groundAt(S.world, x, z); if (mod) return mod;   // (a world module's paving: a car park, an apron, a plaza; gravel)
  if (y - Math.max(h, sea) > 0.35) return 'wood';   // (above the ground and no road: a deck, a pier, a boardwalk)
  return GROUND[biome(I, x, z, h, 1)?.kind] || 'grass';
}

function step(surf, pace, pos, space, gain) {
  if (surf === 'grass') gain *= 0.6;   // (soft underfoot: 2026-10-27 a field's swish was too much)
  app.sfx.play(`step-${pace}-${surf}`, { pos, space, gain, ref: 3, kind: 'effects', vary: 0.06, floor: 0.003 });
}
function update(dt) {
  const fx = app.sfx; if (!fx?.ready || !dt) return;
  you(dt);
  others(dt);
}

// ------------------------------------------------------------------ the player
function you(dt) {
  const P = app.player, fx = app.sfx;
  if (!P?.active || P.state === 'drive' || P.state === 'fly' || P.state === 'boat') { was.on = false; return; }
  const space = P.ctx >= 0 ? P.ctx >> 6 : P.diving ? 'water' : 'out', pos = { x: P.x, y: P.y + 0.05, z: P.z };
  if (!was.on) { Object.assign(was, { on: true, x: P.x, z: P.z, air: P.air, swim: !!P.swim, diving: !!P.diving, vy: P.vy }); return; }
  const moved = Math.hypot(P.x - was.x, P.z - was.z); was.x = P.x; was.z = P.z;
  const surf = () => P.wet && P.wet.level - P.y > 0.08 ? 'water' : surfaceAt(P.x, P.y, P.z, P.ctx);
  // the water: in, under, up, out
  if (!!P.swim !== was.swim) {
    if (P.swim) fx.play(was.vy < -3 ? 'water-in' : 'water-wade', { pos, space: 'out', gain: was.vy < -3 ? 0.9 : 0.6, kind: 'effects', ref: 4 });
    else if (!P.air) fx.play('water-out', { pos, space: 'out', gain: 0.6, kind: 'effects', ref: 4 });
    was.swim = !!P.swim;
  }
  if (!!P.diving !== was.diving) { fx.play(P.diving ? 'dive' : 'surface', { pos, space: 'any', gain: 0.7, kind: 'effects', ref: 4 }); was.diving = !!P.diving; }
  // jumps and landings
  if (P.air && !was.air && P.vy > 1) fx.play('jump', { pos, space, gain: 0.55, kind: 'effects', ref: 3 });
  if (!P.air && was.air && !P.swim) { const s = surf(), hit = Math.min(1, Math.abs(was.vy) / 7); fx.play(LAND[s] || 'land-hard', { pos, space, gain: 0.4 + 0.6 * hit, kind: 'effects', ref: 3 }); }
  was.air = P.air; was.vy = P.vy;
  if (P.swim) {   // strokes while moving
    if (P.speed > 0.3 && !P.diving && (was.stroke -= dt) <= 0) { was.stroke = 0.75 + Math.random() * 0.2 - Math.min(0.25, P.speed * 0.08); fx.play('swim-stroke', { pos, space: 'out', gain: 0.6, kind: 'effects', ref: 4 }); }
    return;
  }
  const pace = PACE[CLIP_NAMES[P.clip]], ph = P.ph, prev = was.ph;
  was.ph = pace ? ph : null; was.pace = pace;
  if (P.air || P.state !== 'walk' || moved > Math.max(3, dt * 12) || !pace || was.lastPace !== pace) { was.lastPace = pace; return; }   // (a jump, sitting, a teleport, a new clip)
  if (struck(pace, prev, ph)) { was.steps = (was.steps || 0) + 1; step(surf(), pace, pos, space, pace === 'run' ? 0.75 : 0.6); }
}

// ------------------------------------------------------------------ residents near the listener
function others(dt) {
  const A = app.agents, L = app.sfx.listener; if (!A?.n) return;
  const near = [];
  for (let i = 0; i < A.n; i++) {
    if (!A.mov[i]) continue;
    const dx = A.rx[i] - L.x, dz = A.rz[i] - L.z;
    if (Math.abs(dx) > NEAR || Math.abs(dz) > NEAR) continue;
    const d = Math.hypot(dx, A.ry[i] - L.y, dz); if (d > NEAR) continue;
    const pace = PACE[CLIP_NAMES[A.clip?.[i]]]; if (!pace) continue;
    near.push({ i, d, pace });
  }
  near.sort((a, b) => a.d - b.d);
  const keep = new Set();
  for (const { i, pace } of near.slice(0, MOST)) {
    keep.add(i);
    const x = A.rx[i], y = A.ry[i], z = A.rz[i], c = A.ctx[i];
    let r = res.get(i);
    const ph = A.lph?.[i];
    if (!r || r.pace !== pace) { res.set(i, r = { x, z, ph, pace, surf: null, surfAt: 0, steps: r?.steps || 0 }); continue; }
    const moved = Math.hypot(x - r.x, z - r.z), prev = r.ph; r.x = x; r.z = z; r.ph = ph;
    if (moved > Math.max(3, dt * 12)) continue;
    const now = performance.now();
    if (!r.surf || now > r.surfAt) { r.surf = surfaceAt(x, y, z, c); r.surfAt = now + 600; }
    if (struck(pace, prev, ph)) {
      r.steps++;
      step(r.surf, pace, { x, y: y + 0.05, z }, c >= 0 ? c >> 6 : 'out', pace === 'run' ? 0.55 : 0.42);
    }
  }
  for (const i of res.keys()) if (!keep.has(i)) res.delete(i);
}
