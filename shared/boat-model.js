// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing boats and how they handle (docs/features/fishing.md §Boats) — stepped in the skipper's browser like the
// aircraft (shared/flight-model.js), the server only checking the poses. Arcade-real: the way the boat games and the
// buoyancy tutorials do it, with what a planing hull really does.
//   · It floats on the water the screen shows: the surface under the hull (its height and its slope along and across
//     the boat, from the ocean's own waves: render/sea-probe.js) is a target the boat's heave, pitch and roll spring to
//     — each with its own period and damping (a boat rolls slowly and lightly damped, heaves quicker) — so it rides the
//     swell with weight, not glued to it; off a crest it flies (gravity takes over) and slams back.
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
    heave: [2.3, 0.4], pitch: [2.4, 0.45], roll: [1.9, 0.16],       // rad/s natural frequency, damping ratio
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
    heave: [2.8, 0.42], pitch: [3.0, 0.45], roll: [2.4, 0.18],
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

/** A boat afloat at (x, z), its water at y, its bow along heading. kit: { speed: × top speed (engine upgrades and the
 *  seamanship skill), anchor: hold (1 …) }. */
export function newBoat(type, x, y, z, heading = 0, kit = {}) {
  const S = BOATS[type];
  return {
    type, S, t: 0, x, z, y: y - S.draft * 0.35, heading, pitch: 0, roll: 0,
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
  // ---- the water under it
  const W = env.plane(s.x, s.z, s.heading), depthHere = env.depth ? env.depth(s.x, s.z) : 99;
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
  s.heading -= s.rr * dt;
  // ---- slow: the wind drifts it; anchored: the rode holds it and it swings head to the wind
  const fx = Math.sin(s.heading), fz = Math.cos(s.heading), rx = -Math.cos(s.heading), rz = Math.sin(s.heading);
  let vx = fx * s.u + rx * s.v, vz = fz * s.u + rz * s.v;
  const wind = env.wind || { x: 0, z: 0 }, slow = 1 - sstep(1, 4, Math.abs(s.u));
  vx += wind.x * 0.035 * slow; vz += wind.z * 0.035 * slow;
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
  const hull = hullPoints(s);
  if (env.solid && hull.some(p => env.solid(p[0], p[1]))) {
    s.x = ox; s.z = oz;
    if (!s.bumped && Math.hypot(s.u, s.v) > 0.6) ev.push('bump');
    s.u *= -0.25; s.v *= -0.25; s.rr *= 0.5; s.bumped = 0.6;
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
  // ---- heave, pitch, roll: springs to the water under the hull (each its own period), or falling free off a crest
  const U = Math.abs(s.u), uh = S.hull;
  const planing = sstep(1.3 * uh, 2.1 * uh, U), hump = Math.exp(-(((U - uh * 1.15) / (0.5 * uh)) ** 2));
  if (planing > 0.6 && s.planing <= 0.6) ev.push('plane');
  s.planing = planing;
  const yWant = W.h - S.draft * (0.35 + 0.15 * (1 - planing)) + 0.12 * planing;
  const pWant = Math.atan(W.sf) * 0.9 + S.squat * hump * Math.sign(s.u || 1) * Math.min(1, Math.abs(s.rpm) * 1.5) + S.plane * planing;
  const rWant = Math.atan(W.ss) * 0.8 + clamp(S.lean * s.u * s.rr, -0.35, 0.35);
  const [wh, zh] = S.heave, [wp, zp] = S.pitch, [wr, zr] = S.roll;
  const above = s.y - yWant;
  if (above > 0.35 && s.vy > 1.2) s.air = true;   // (thrown off a crest: it flies, and comes down hard)
  if (s.air) {
    s.vy -= G * dt;
    if (s.y <= yWant) { s.air = false; const hit = -s.vy; if (hit > 2.2) { ev.push('slam'); s.slam = Math.min(1, hit / 7); } s.vy *= 0.25; s.u *= 1 - Math.min(0.25, hit * 0.02); }
  } else s.vy += (wh * wh * (yWant - s.y) - 2 * zh * wh * s.vy) * dt;
  s.slam = Math.max(0, s.slam - dt * 2);
  s.y += s.vy * dt;
  s.vp += (wp * wp * (pWant - s.pitch) - 2 * zp * wp * s.vp) * dt * (s.air ? 0.15 : 1); s.pitch += s.vp * dt;
  s.vr += (wr * wr * (rWant - s.roll) - 2 * zr * wr * s.vr) * dt; s.roll += s.vr * dt;
  s.pitch = clamp(s.pitch, -0.45, 0.45); s.roll = clamp(s.roll, -0.5, 0.5);   // (it can't capsize)
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
