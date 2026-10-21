// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing boats and how they handle (docs/features/fishing.md §Boats) — stepped in the skipper's browser like the
// aircraft (shared/flight-model.js), the server only checking the poses. Arcade-real: the way the boat games and the
// buoyancy tutorials do it, with what a planing hull really does.
//   · It floats in the water the screen shows (2026-10-15, after J. Kerner's model for Just Cause 3): the sea's surface
//     at ~35 points of its bottom (the ocean's own waves and the surf: render/sea-probe.js) — buoyancy where each is
//     under, damping, the pressure of water run into (planing lift; a bow driven into a wave), slamming — summed on a
//     hull with weight and inertia. It lifts and leans with a long swell, carries through short chop at speed (it skims
//     it), the bow climbs a wave and drops off its back, off a big crest it flies and lands with a slam; at the hump
//     the bow rises, on the plane it trims ~4° and rides higher. The surf at a shore lifts it and shoves it in.
//   · An outboard pushes it (the throttle lever: forward, neutral, reverse; the engine spools), its thrust vectored by
//     the wheel: it turns best under power, a little with way on (the lower unit), and in reverse the stern swings.
//   · Its drag rises to the hump near hull speed (the bow climbs), then it gets on the plane: the bow drops, it rises,
//     the drag falls away. The keel holds it sideways (a little skid in a hard turn); it leans into its turns.
//   · Slow, it drifts with the wind; at anchor it swings to it. Shallow water grounds it (a bump, it stops); the docks
//     are solid. Nothing breaks and it can't capsize.
// Frame: the bow along (sin heading, cos heading) — the aircraft's convention; starboard is (−cos, sin); y up.

export const BOATS = Object.freeze({
  coastal: Object.freeze({
    id: 'coastal', label: 'Coastal Fisher 26', icon: '🚤', anglers: 4,
    L: 8.2, B: 2.8, draft: 0.5, free: 1.05, floor: 0.42,           // m: length, beam, below the water, gunwale and cockpit sole over it
    top: 17, thrust: 3.6, reverse: 0.45, spool: 1.6,                // m/s top speed (33 kn) on the base engine; m/s² at full power
    hull: 6.2,                                                      // m/s: hull speed (the hump)
    turn: { kT: 0.42, kR: 0.06, cr: 1.2, cr2: 0.12, lock: 0.55 },  // yaw: from thrust, from way on, damping, at speed; the wheel's lock (rad)
    form: Object.freeze({ free: 0.95, rise: 0.38, draft: 0.55, vee: 0.9, transom: 0.86 }),   // its hull (render/vessels.js lofts it; hullOf samples it): free board at the transom, sheer rise to the bow, keel depth, deep V, transom beam
    // in the water (hullOf, stepBoat): the pressure of water run into (planing lift, a bow into a wave); heave, pitch and
    // roll damping (fractions of critical); more damping on the plane (×1+); how long the hull takes to feel the water a
    // m/s faster (s: it skims chop at speed) unless the water moved more than bigWave m (a big wave gets through)
    ride: Object.freeze({ press: 40, damp: 0.4, pitchDamp: 0.18, rollDamp: 0.1, speedDamp: 3, skim: 0.03, bigWave: 0.12 }),
    lean: 0.012, squat: 0.11, plane: 0.035,                         // bank per (m/s · rad/s); bow rise at the hump; trim on the plane (rad)
    helm: Object.freeze([0, 0.42, -1.2]),                           // where the skipper stands (x port+, y over the water, z forward): behind the console
    probes: Object.freeze([[0, 3.9], [0.95, 2.4], [-0.95, 2.4], [1.3, 0], [-1.3, 0], [1.25, -3.6], [-1.25, -3.6], [0, -4]]),   // (x, z) on the hull
    deck: deckPlan({   // (render/boat-models.js coastal draws these)
      beam: [[-4.1, 0.83], [-3.5, 0.87], [-2.3, 0.95], [-1.2, 1.0], [0, 1.0], [0.6, 0.95], [1.2, 0.8], [1.8, 0.65], [2.35, 0.5], [2.95, 0.33], [3.45, 0.12]],
      floors: [[-4.1, 2.4, 0.42], [2.4, 3.6, 0.66]],                // the cockpit sole, the bow casting deck
      blocks: [[-1.2, 1.2, -4.2, -3.5], [-0.5, 0.5, 0.45, 1.05], [-0.56, 0.56, -0.85, 0.3], [-0.5, 0.5, -2.15, -1.8],   // the transom's livewell, the cooler seat, the console, the leaning post,
        [0.585, 0.655, -1.485, -1.415], [-0.655, -0.585, -1.485, -1.415]],                                              // the T-top's aft posts
      spots: [[0, 0.66, 3.0, 0, 'bow'], [0.62, 0.42, 1.6, Math.PI / 2, 'port'], [-0.62, 0.42, 1.6, -Math.PI / 2, 'starboard'], [0.5, 0.42, -3.2, Math.PI, 'stern']],
    }),
  }),
  skiff: Object.freeze({
    id: 'skiff', label: 'Lake Skiff 16', icon: '🛶', anglers: 2,
    L: 5.0, B: 1.9, draft: 0.28, free: 0.62, floor: 0.2,
    top: 11.5, thrust: 3.0, reverse: 0.5, spool: 2.2,
    hull: 4.4,
    turn: { kT: 0.5, kR: 0.08, cr: 1.5, cr2: 0.14, lock: 0.6 },
    form: Object.freeze({ free: 0.58, rise: 0.16, draft: 0.3, vee: 0.45, transom: 0.92 }),
    ride: Object.freeze({ press: 40, damp: 0.4, pitchDamp: 0.18, rollDamp: 0.1, speedDamp: 3, skim: 0.03, bigWave: 0.12 }),
    lean: 0.012, squat: 0.09, plane: 0.03,
    helm: Object.freeze([-0.6, 0.2, -1.78]),                        // behind the side console, to starboard
    probes: Object.freeze([[0, 2.4], [0.7, 1.4], [-0.7, 1.4], [0.9, -0.2], [-0.9, -0.2], [0.85, -2.3], [-0.85, -2.3], [0, -2.5]]),
    deck: deckPlan({   // (render/boat-models.js skiff)
      beam: [[-2.5, 0.57], [-1.8, 0.6], [-1.0, 0.64], [0.2, 0.64], [0.7, 0.52], [1.1, 0.43], [1.45, 0.32], [1.8, 0.2], [2.05, 0.1]],
      floors: [[-2.45, -2.08, 0.48], [-2.08, 1.15, 0.2], [1.15, 2.1, 0.48]],   // the aft casting deck, the floor, the fore deck
      blocks: [[-0.85, -0.35, -1.45, -0.95], [-0.45, 0.25, -1.0, -0.6], [-0.2, 0.2, 1.65, 2.05]],          // the console, the livewell, the bow seat
      spots: [[0, 0.48, 1.4, 0, 'bow'], [0.15, 0.48, -2.27, Math.PI, 'stern']],
    }),
  }),
});
export const G = 9.81;

// ---------------------------------------------------------------- the deck: walking about the boat, fishing from it
// (docs/features/fishing.md §The angler) Boat frame: x to port, z to the bow, y over the water. A boat's walkable deck
// is its floors (the cockpit sole, the casting decks: [z from, z to, height]) inside the gunwales (beam: the half-width
// one can stand at, along the boat) less what stands on them (blocks: [x0, x1, z0, z1], kept a body's width R from);
// a step up between floors is at most STEP. You can't go over the side. spots: where to fish from — [x, y, z, facing
// (0 toward the bow, π/2 to port), name] — one angler at each.
export const DECK_R = 0.2, DECK_STEP = 0.32;
function deckPlan(d) {
  return Object.freeze({ beam: d.beam, floors: d.floors, blocks: d.blocks, spots: d.spots.map(([x, y, z, yaw, name]) => Object.freeze({ x, y, z, yaw, name })) });
}
function beamAt(D, z) {
  const b = D.beam;
  if (z <= b[0][0]) return b[0][1];
  for (let i = 1; i < b.length; i++) if (z <= b[i][0]) { const [z0, w0] = b[i - 1], [z1, w1] = b[i]; return w0 + (w1 - w0) * (z - z0) / (z1 - z0); }
  return -1;
}
/** The floor's height where someone could stand on the deck at (x, z) of a boat of this type, or null (over the side, in a fixture). */
export function deckFloor(type, x, z) {
  const D = BOATS[type]?.deck;
  if (!D || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const f = D.floors.find(([z0, z1]) => z >= z0 && z < z1);
  if (!f || Math.abs(x) > beamAt(D, z)) return null;
  for (const [x0, x1, z0, z1] of D.blocks) if (x > x0 - DECK_R && x < x1 + DECK_R && z > z0 - DECK_R && z < z1 + DECK_R) return null;
  return f[2];
}
/**
 * A step across the deck from at {x, y, z} by (dx, dz): where it ends up — sliding along a gunwale (in as the hull
 * narrows) or a fixture rather than stopping dead, up or down a step between floors (never a higher one); still at
 * `at` if there's no way.
 */
export function walkDeck(type, at, dx, dz) {
  const D = BOATS[type]?.deck;
  if (!D) return { x: at.x, y: at.y, z: at.z };
  const inside = (x, z) => { const w = beamAt(D, z) - 1e-4; return w < 0 ? x : Math.max(-w, Math.min(w, x)); };
  for (const [ex, ez] of [[dx, dz], [dx, 0], [0, dz]]) {
    if (!ex && !ez) continue;
    const z = at.z + ez, x = inside(at.x + ex, z), y = deckFloor(type, x, z);
    if (y != null && y - at.y <= DECK_STEP && (x !== at.x || z !== at.z)) return { x, y, z };
  }
  return { x: at.x, y: at.y, z: at.z };
}
/** The fishing spot nearest (x, z) on the deck within `reach` m: { i, spot, d } or null. */
export function spotNear(type, x, z, reach = 0.8) {
  const D = BOATS[type]?.deck;
  let best = null;
  (D?.spots || []).forEach((sp, i) => { const d = Math.hypot(sp.x - x, sp.z - z); if (d <= reach && (!best || d < best.d)) best = { i, spot: sp, d }; });
  return best;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the hull in the water
const RHO = 1025;
const HULLS = new Map();
/**
 * The hull's bottom sampled for the water's forces on it (render/vessels.js lofts the same hull from S.form): stations
 * stern to bow × points across, each { x (to port), y (its depth in the boat's frame: y = 0 its waterline), z (forward),
 * a (the waterplane it stands for, m²), n: its outward normal [x, y, z], cap (how deep it can go under: to the
 * gunwale) }, and the hull as a body: its mass (what floats it at its waterline, a little laden), pitch and roll
 * inertias, the water's stiffness under it (heave, pitch, roll) and its damping.
 */
export function hullOf(S) {
  let H = HULLS.get(S.id);
  if (H) return H;
  const F = S.form, L = S.L, v = F.vee, NS = 7, AX = [-0.8, -0.4, 0, 0.4, 0.8];
  const beam = t => { const fw = t > 0.55 ? Math.pow(Math.max(0, 1 - (t - 0.55) / 0.45), 0.75) : 1, af = F.transom + (1 - F.transom) * Math.min(1, t / 0.3); return S.B / 2 * Math.min(fw, af); };
  const keel = t => F.draft * (t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.8 : 1) * (t < 0.08 ? 0.8 + 2.5 * t : 1);
  // the section's bottom (render/vessels.js hull sec): keel, the V, the turn of the bilge to the waterline
  const bottom = (x, t) => {
    const b = beam(t), k = keel(t), P = [[0, -k], [b * (0.42 - 0.2 * v), -k * (0.8 + 0.1 * v)], [b * (0.78 - 0.15 * v), -k * (0.35 + 0.25 * v)], [b * 0.93, 0]], ax = Math.abs(x);
    for (let j = 0; j + 1 < P.length; j++) if (ax <= P[j + 1][0]) return P[j][1] + (P[j + 1][1] - P[j][1]) * (ax - P[j][0]) / Math.max(1e-6, P[j + 1][0] - P[j][0]);
    return 0;
  };
  const el = [];
  for (let i = 0; i < NS; i++) {
    const t = (i + 0.5) / NS, z = -L / 2 + t * L, b = beam(t) * 0.93;
    for (const f of AX) {
      const x = f * b, y = bottom(x, t), e = 0.02, dt = 0.02;
      const dydx = (bottom(x + e, t) - bottom(x - e, t)) / (2 * e), dydz = (bottom(x, t + dt) - bottom(x, t - dt)) / (2 * dt * L);
      const nl = Math.hypot(dydx, 1, dydz);
      el.push({ x, y, z, a: L / NS * 2 * b / AX.length, n: [dydx / nl, -1 / nl, dydz / nl], cap: F.free + F.rise * t * t - y });
    }
  }
  const A = el.reduce((q, e) => q + e.a, 0), vol = el.reduce((q, e) => q + e.a * Math.max(0, 0.04 - e.y), 0);
  const m = RHO * vol;   // (floating a little laden: its frame 4 cm under the water)
  // its weight stands over the middle of what floats it (the hull fuller aft than forward), so it floats level
  const zc = el.reduce((q, e) => q + e.a * Math.max(0, 0.04 - e.y) * e.z, 0) / vol;
  for (const e of el) e.zc = e.z - zc;
  const K = RHO * G * A, Kp = RHO * G * el.reduce((q, e) => q + e.a * e.zc * e.zc, 0), Kr = RHO * G * el.reduce((q, e) => q + e.a * e.x * e.x, 0) * 1.4;   // (its flare stiffens it in roll)
  const Ip = m * (0.27 * L) ** 2, Ir = m * (0.33 * S.B) ** 2, R = S.ride;
  H = { el, A, m, K, Kp, Kr, Ip, Ir,
    c: 2 * R.damp * Math.sqrt(K * m * 1.3) / A,            // heave damping a wet m² (against the water's own rise)
    cp: 2 * R.pitchDamp * Math.sqrt(Kp * Ip), cr: 2 * R.rollDamp * Math.sqrt(Kr * Ir) };
  HULLS.set(S.id, H);
  return H;
}

/** A boat afloat at (x, z), its water at y, its bow along heading. kit: { speed: × top speed (engine upgrades and the
 *  seamanship skill), anchor: hold (1 …) }. */
export function newBoat(type, x, y, z, heading = 0, kit = {}) {
  const S = BOATS[type];
  return {
    type, S, t: 0, x, z, y: y - 0.04, heading, pitch: 0, roll: 0, ew: [],
    u: 0, v: 0, vy: 0, rr: 0, vp: 0, vr: 0,                   // forward, sideways (to starboard), up; turning to starboard; pitch and roll rates
    lever: 0, rpm: 0, wheel: 0, anchor: null, aground: 0, bumped: 0, air: false, slam: 0, planing: 0,
    speedK: kit.speed || 1, hold: kit.anchor || 1, wake: 0,
  };
}

/** Its drag (m/s² at forward speed u): rising to the hump near hull speed, falling away on the plane. */
function drag(S, u, k) {
  const a = Math.abs(u), uh = S.hull, top = S.top * k;
  const pf = 1 + 0.85 * Math.exp(-(((a - uh) / (0.45 * uh)) ** 2)) - 0.5 * sstep(1.25 * uh, 2.3 * uh, a);
  const pfTop = 1 + 0.85 * Math.exp(-(((top - uh) / (0.45 * uh)) ** 2)) - 0.5 * sstep(1.25 * uh, 2.3 * uh, top);
  const c1 = 0.06, c2 = (S.thrust - c1 * top) / (top * top * pfTop);   // (full power holds it at its top speed)
  return Math.sign(u) * (c1 * a + c2 * a * a * pf);
}

/**
 * One step. input: { lever (−1 … 1: the lever moving back or forward while held) | leverTo (a lever position, from a
 * touch slider), steer (−1 port … 1 starboard), neutral (pressed: the lever to the middle), anchor (pressed: drop or
 * raise it) }. env: { plane(x, z, heading) → { h (the water's surface under the hull), sf (its slope rising to the
 * bow), ss (rising to starboard) }, level (the calm water's height), depth(x, z) (water over the bed; 0 on land),
 * solid?(x, z) → true where the hull hits a dock, wind?: { x, z } (m/s), limit?(x, z) → true past the world's edge }.
 * Returns events: 'aground', 'bump', 'slam', 'plane' (got on the plane), 'anchor-down', 'anchor-up'.
 */
export function stepBoat(s, input = {}, env, dt) {
  const S = s.S, ev = [], k = s.speedK;
  s.t += dt;
  // ---- the helm: the lever (a detent at neutral), the wheel (back to the middle when let go), the anchor
  if (input.neutral) s.lever = 0;
  if (Number.isFinite(input.leverTo)) s.lever = clamp(input.leverTo, -1, 1);
  else if (input.lever) {   // held: it moves; coming back it stops in the notch at neutral until let go and pushed again
    if (!s.notch) { const was = s.lever; s.lever = clamp(s.lever + input.lever * 0.65 * dt, -1, 1); if (was !== 0 && was * s.lever <= 0) { s.lever = 0; s.notch = true; } }
  } else s.notch = false;
  const want = clamp(input.steer || 0, -1, 1);
  s.wheel += (want - s.wheel) * Math.min(1, dt * (Math.abs(want) > Math.abs(s.wheel) ? 3.2 : 4.5));
  if (input.anchor) {
    if (s.anchor) { s.anchor = null; ev.push('anchor-up'); }
    else if (Math.abs(s.u) < 2.5) { s.anchor = { x: s.x, z: s.z }; s.lever = 0; ev.push('anchor-down'); }
  }
  // ---- the engine: spools to the lever (a moment to reverse through neutral)
  const target = s.anchor ? 0 : s.lever;
  s.rpm += clamp(target - s.rpm, -S.spool * dt, S.spool * dt);
  const thrust = s.rpm >= 0 ? s.rpm * S.thrust * (k > 1 ? 1 + (k - 1) * 1.6 : k) : s.rpm * S.thrust * S.reverse;
  // ---- the water round the hull: its surface at each of the hull's points (env.water), else from its plane (env.plane)
  const HL = hullOf(S), R = S.ride, U = Math.abs(s.u), at = HL.el.map(e => boatPoint(s, e.x, e.y, e.z));
  let wh;
  if (env.water) wh = env.water(at);
  else { const W0 = env.plane(s.x, s.z, s.heading); wh = HL.el.map(e => W0.h + W0.sf * e.z - W0.ss * e.x); }
  let sz = 0, sh = 0, szz = 0, szh = 0;
  HL.el.forEach((e, i) => { sz += e.z; sh += wh[i]; szz += e.z * e.z; szh += e.z * wh[i]; });
  const nE = HL.el.length, W = { sf: (szh / nE - (sz / nE) * (sh / nE)) / Math.max(1e-6, szz / nE - (sz / nE) ** 2) }, depthHere = env.depth ? env.depth(s.x, s.z) : 99;
  // ---- along: thrust, drag, sliding down a wave's face
  const a = thrust - drag(S, s.u, k) - G * Math.sin(Math.atan(W.sf)) * 0.35 * (s.air ? 0 : 1);
  s.u += a * dt;
  // ---- across: the keel holds it; a little skid outward in a turn
  s.v += (-2.6 * s.v - 0.12 * s.u * s.rr) * dt;
  // ---- turning: the outboard's thrust swung by the wheel, the lower unit with way on, damped more at speed
  const T = S.turn, d = s.wheel * T.lock, rrWant = (T.kT * thrust * Math.sin(d) / 0.55 + T.kR * s.u * d / 0.55);
  const damp = T.cr + T.cr2 * Math.abs(s.u);
  s.rr += (rrWant - damp * s.rr) * dt * 2.2;
  if (s.air) s.rr *= 1 - dt * 0.5;
  const oh = s.heading;
  s.heading -= s.rr * dt;
  // ---- slow: the wind drifts it; anchored: the rode holds it and it swings head to the wind
  const fx = Math.sin(s.heading), fz = Math.cos(s.heading), rx = -Math.cos(s.heading), rz = Math.sin(s.heading);
  let vx = fx * s.u + rx * s.v, vz = fz * s.u + rz * s.v;
  const wind = env.wind || { x: 0, z: 0 }, slow = 1 - sstep(1, 4, Math.abs(s.u));
  vx += wind.x * 0.035 * slow; vz += wind.z * 0.035 * slow;
  // a breaker in the surf carries it toward the shore with the water it moves (env.push: m/s²), whichever way it lies
  const shove = env.push ? env.push(s.x, s.z) : null, sk = Math.exp(-dt / 2);
  s.dx = (s.dx || 0) * sk + (shove && !s.anchor ? shove.x * dt : 0); s.dz = (s.dz || 0) * sk + (shove && !s.anchor ? shove.z * dt : 0);
  vx += s.dx; vz += s.dz;
  if (s.anchor) {
    const ax = s.anchor.x - s.x, az = s.anchor.z - s.z, dist = Math.hypot(ax, az), scope = 6 / s.hold;
    if (dist > scope) { const pull = (dist - scope) * 0.8 * s.hold; vx += ax / dist * pull; vz += az / dist * pull; }
    s.u *= 1 - Math.min(1, dt * 1.5); s.v *= 1 - Math.min(1, dt * 1.5);
    const wl = Math.hypot(wind.x, wind.z);
    if (wl > 0.5) { const want = Math.atan2(-wind.x, -wind.z); let dh = want - s.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); s.rr -= dh * 0.25 * dt; }
  }
  // ---- move; the docks and the shallows stop it
  const ox = s.x, oz = s.z;
  s.x += vx * dt; s.z += vz * dt;
  s.bumped = Math.max(0, s.bumped - dt); s.aground = Math.max(0, s.aground - dt);
  if (env.limit?.(s.x, s.z)) { s.x = ox; s.z = oz; s.u *= -0.2; s.v = 0; }
  // the docks are solid: moving or swinging into one, it's put back (a bump); already caught in one (swung in by a turn,
  // carried by the surf), it may only work its way out — and is eased out, away from where it's caught (2026-10-15: a
  // bow swung into a pier held the boat there for good, the throttle full)
  if (env.solid) {
    const caught = (x, z, h) => hullPoints({ S, x, z, heading: h }).filter(p => env.solid(p[0], p[1]));
    const now = caught(s.x, s.z, s.heading).length;
    if (now) {
      const before = caught(ox, oz, oh).length;
      if (!before || now >= before) {
        s.x = ox; s.z = oz; s.heading = oh;
        if (!s.bumped && Math.hypot(s.u, s.v) > 0.6) ev.push('bump');
        s.u *= -0.25; s.v *= -0.25; s.rr *= -0.3; s.bumped = 0.6;
        s.dx = s.dz = 0;   // (the drift stops against it: the surf's shove held a boat on the quay, 2026-10-15)
        const P = caught(s.x, s.z, s.heading);
        if (P.length) { let cx = 0, cz = 0; for (const p of P) { cx += p[0] - s.x; cz += p[1] - s.z; } const l = Math.hypot(cx, cz) || 1; s.x -= cx / l * 0.03; s.z -= cz / l * 0.03; }
      }
    }
  }
  if (env.depth) {
    const bow = env.depth(s.x + fx * S.L * 0.45, s.z + fz * S.L * 0.45), stern = env.depth(s.x - fx * S.L * 0.45, s.z - fz * S.L * 0.45);
    const shallow = Math.min(bow, depthHere) < S.draft + 0.05, back = stern < S.draft + 0.05 && s.u < 0;
    if ((shallow && s.u > 0 && bow <= depthHere) || back || depthHere < S.draft * 0.6) {
      s.x = ox; s.z = oz;
      if (!s.aground && Math.abs(s.u) > 1) ev.push('aground');
      s.u *= -0.15; s.v *= 0.3; s.aground = 1.2;
    }
  }
  // ---- heave, pitch, roll: the water on the hull (2026-10-15 — the product owner: "it has to feel like a boat going
  // through water, not an object going through potholes"; after J. Kerner's water model for Just Cause 3). At each point
  // of its bottom under the surface: buoyancy (the water it holds out), damping against the water's own rise and fall,
  // the pressure of the water it runs into — lift under a trimmed bottom at speed, a hard shove on a bow driven into a
  // wave — and, where it drives in fast, the slamming that stops it; summed into a force and two moments on a hull with
  // weight (its mass and the water it moves with it). It lifts and leans with a long swell, its weight carries it
  // through short chop, a crest under the bow at speed throws the bow up and a trough drops it; with nothing wet it flies.
  const uh = S.hull;
  const planing = sstep(1.3 * uh, 2.1 * uh, U), hump = Math.exp(-(((U - uh * 1.15) / (0.5 * uh)) ** 2));
  if (planing > 0.6 && s.planing <= 0.6) ev.push('plane');
  s.planing = planing;
  const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch), ka = Math.min(1, dt * 12);
  let Fy = 0, Mp = 0, Mr = 0, wetA = 0, slamDv = 0, wvy = 0, wvn = 0;
  HL.el.forEach((e, i) => {
    const P = at[i];
    // the water as the hull feels it: at speed it skims short chop — its bottom spans it and its weight carries it
    // through — so the surface it meets is smoothed the more the faster it goes (the long swell still lifts it)
    const E = s.ew[i] ||= { h: wh[i], hf: wh[i], v: 0, d: 0 };
    // (a big wave isn't skimmed: the further the water from where the hull last felt it, the sooner it feels it)
    const dh = wh[i] - E.hf, big = 1 + (Math.abs(dh) / (R.bigWave ?? 0.12)) ** 2;
    E.hf += dh * (1 - Math.exp(-dt * big / (0.02 + (R.skim ?? 0.016) * U)));
    const h = E.hf, d = h - P.y;
    E.v += ((h - E.h) / dt - E.v) * ka; E.h = h;   // (the water's rise there, as the hull meets it: its waves' own and running into them)
    if (!(d > 0)) { E.d = d; return; }
    const w = Math.min(1, d / 0.08), dd = Math.min(d, e.cap);
    wetA += e.a * w; wvy += E.v * e.a * w; wvn += e.a * w;
    const vy = s.vy + s.vp * e.zc + s.vr * e.x, vr = vy - E.v;   // (its rise, and against the water's)
    // damped against the water's own rise at rest (it rides the swell), more against its own at speed (it holds its line)
    const vd = vy - E.v * (1 - 0.6 * planing);
    // (its damping no more than a quarter metre of buoyancy there: a big wave's shove gets through)
    const fd = HL.c * (1 + (R.speedDamp ?? 0) * planing) * e.a * w * vd, fdMax = RHO * G * e.a * 0.25;
    let f = RHO * G * e.a * dd - clamp(fd, -fdMax, fdMax) - 0.15 * RHO * e.a * w * vr * Math.abs(vr);
    // the water it runs into: forward (along its trimmed frame), across, up and down — pressing on the faces that meet it
    // (planing lift under the bottom, the bow into a wave), drawing a little at those leaving it
    const vb0 = -s.v, vb1 = vr - s.u * sp, vb2 = s.u * cp, V = Math.hypot(vb0, vb1, vb2);
    if (V > 0.2) {
      const cosA = (vb0 * e.n[0] + vb1 * e.n[1] + vb2 * e.n[2]) / V;
      if (cosA > 0) f += -e.n[1] * R.press * V * V * cosA * e.a * w;
      else f -= -e.n[1] * R.press * 0.3 * V * V * -cosA * e.a * w;
    }
    // slamming: driven in fast, the water stops it — the harder, the more of it at once
    if (vr < -1 && d > E.d) {
      const k01 = Math.min(1, (-vr - 1) / 3.5) ** 1.5, stop = HL.m * e.a / HL.A * -vr / dt * k01 * 0.6;
      f += stop; slamDv += stop * dt / HL.m;
    }
    E.d = d;
    Fy += f; Mp += f * e.zc; Mr += f * e.x;
  });
  const wf = wetA / HL.A, wasAir = s.air;
  s.air = wetA < 0.02 * HL.A;
  if (wasAir && !s.air && s.vy - (wvn > 0 ? wvy / wvn : 0) < -1.6) slamDv = Math.max(slamDv, 0.31);   // (down from a flight, hard)
  // its trim — the bow climbing at the hump, the planing trim — and its lean into a turn, as the hull's own stiffness
  // in the water would set them; damped in pitch and roll by the water it is in
  const wv = wvn > 0 ? wvy / wvn : 0;
  Mp += HL.Kp * (S.squat * hump * Math.sign(s.u || 1) * Math.min(1, Math.abs(s.rpm) * 1.5) + S.plane * planing) * wf - HL.cp * wf * s.vp;
  Mr += HL.Kr * clamp(S.lean * s.u * s.rr, -0.35, 0.35) * wf - HL.cr * wf * s.vr;
  const m = HL.m * (1 + 0.3 * wf), Ip = HL.Ip * (1 + 0.3 * wf), Ir = HL.Ir * (1 + 0.2 * wf);   // (and the water it carries)
  s.vy += (Fy - HL.m * G) / m * dt; s.vp += Mp / Ip * dt; s.vr += Mr / Ir * dt;   // (its weight on its own mass; the water it carries only slows it)
  s.y += s.vy * dt; s.pitch += s.vp * dt; s.roll += s.vr * dt;
  s.wvy = wv; s.wet = wf; s.waterAt = wh.reduce((q, h) => q + h, 0) / wh.length;   // (how much of it is in, the water's mean height round it: effects, checks)
  s.slamT = Math.max(0, (s.slamT || 0) - dt);
  if (slamDv > 0.3) { s.slam = Math.min(1, Math.max(s.slam, slamDv / 2)); if (!s.slamT) { ev.push('slam'); s.slamT = 0.6; } }   // (one a landing)
  s.slam = Math.max(0, s.slam - dt * 2);
  if (Math.abs(s.pitch) > 0.45) { s.pitch = clamp(s.pitch, -0.45, 0.45); s.vp *= -0.2; }
  if (Math.abs(s.roll) > 0.5) { s.roll = clamp(s.roll, -0.5, 0.5); s.vr *= -0.2; }   // (it can't capsize)
  s.wake = U;
  return ev;
}

/** The hull's outline in the world (corners and the bow, at the waterline): [[x, z], ...]. */
export function hullPoints(s) {
  const S = s.S, fx = Math.sin(s.heading), fz = Math.cos(s.heading), rx = -Math.cos(s.heading), rz = Math.sin(s.heading), hl = S.L / 2, hb = S.B / 2;
  return [[hl, 0], [hl * 0.55, hb * 0.9], [hl * 0.55, -hb * 0.9], [-hl, hb], [-hl, -hb], [0, hb], [0, -hb]].map(([a, b]) => [s.x + fx * a + rx * b, s.z + fz * a + rz * b]);
}
/** A point on the boat (x to port, y up from the water line, z forward) in the world, with its pitch and roll. */
export function boatPoint(s, px, py, pz) {
  const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch), cr = Math.cos(s.roll), sr = Math.sin(s.roll);
  // roll about the bow's axis (starboard, −x, down for +roll), then pitch (bow up for +pitch), then the heading
  let x = px * cr - py * sr, y = px * sr + py * cr, z = pz;
  const y2 = y * cp + z * sp, z2 = -y * sp + z * cp; y = y2; z = z2;
  const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
  return { x: s.x + x * ch + z * sh, y: s.y + y, z: s.z - x * sh + z * ch };
}
/** Its orientation as a quaternion { x, y, z, w } (three.js order: heading about y, then pitch, then roll). */
export function boatQuat(s) {
  const h = s.heading / 2, p = -s.pitch / 2, r = s.roll / 2;
  const qy = [0, Math.sin(h), 0, Math.cos(h)], qx = [Math.sin(p), 0, 0, Math.cos(p)], qz = [0, 0, Math.sin(r), Math.cos(r)];
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const q = mul(mul(qy, qx), qz);
  return { x: q[0], y: q[1], z: q[2], w: q[3] };
}
/** The speed a boat may cover by (m/s, for the server's check): its top speed with every upgrade, and some. */
export const maxBoatSpeed = type => BOATS[type].top * 1.75;
/** Knots. */
export const knots = ms => ms * 1.94384;

/**
 * The water's plane under a boat from its probe points' heights (render/sea-probe.js, or any function): a least-squares
 * fit — the height at its middle, the slope rising to the bow and to starboard. heights[i] at S.probes[i] (x port+, z fwd).
 */
export function fitPlane(S, heights) {
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxh = 0, szh = 0;
  S.probes.forEach(([px, pz], i) => { const h = heights[i]; if (!Number.isFinite(h)) return; n++; sx += px; sz += pz; sh += h; sxx += px * px; szz += pz * pz; sxh += px * h; szh += pz * h; });
  if (!n) return null;
  const mx = sx / n, mz = sz / n, mh = sh / n, vx = sxx / n - mx * mx, vz = szz / n - mz * mz;
  const gx = vx > 1e-6 ? (sxh / n - mx * mh) / vx : 0, gz = vz > 1e-6 ? (szh / n - mz * mh) / vz : 0;
  return { h: mh - gx * mx - gz * mz, sf: gz, ss: -gx };   // (x is to port: rising to starboard is falling to port)
}
