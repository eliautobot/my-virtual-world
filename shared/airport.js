// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport module (docs/features/play-modules.md §Airport): ring courses flown against the clock from an airport.
// Ten courses, each for one class of aircraft (shared/aircraft-specs.js), harder as they go: more rings, smaller rings,
// farther, lower, twistier. A course is laid out in the airport's own frame (its runway heading), the same for every
// airport, and lifted clear of the ground and the buildings under it - so a course is the same length everywhere and
// its stars are fixed. The clock starts at the first ring (the gate) and stops at the last.
//
// The browser reports the flight path only ([t ms, x, y, z] samples); verify() finds the ring passes in it itself, checks
// the speeds, the order and the time the server saw, and works the time out. Shared by the browser and the server.
import { RNG } from './rng.js';
import { AIRCRAFT, maxRunSpeed } from './aircraft-specs.js';
import { registerPlay } from './play.js';

// ------------------------------------------------------------------------------------------- the courses
// style: loop (a ring of rings round the field), tour (out over the land and back), slalom (left-right down a line and
// back), hop (short low hops for a helicopter). dist: how far out (m); alt: height above the airport (m); r: ring radius.
const SPECS = [
  { id: 'first-flight', label: 'First Flight', aircraft: 'prop', difficulty: 1, n: 6, r: 24, style: 'loop', dist: [450, 650], alt: [45, 60], blurb: 'Six big rings round the field. Take off, bank gently, keep it smooth.' },
  { id: 'coast-cruise', label: 'Coastline Cruise', aircraft: 'prop', difficulty: 2, n: 8, r: 21, style: 'tour', dist: [500, 1000], alt: [40, 80], blurb: 'Out over the land and back - watch the heights change.' },
  { id: 'hover-hop', label: 'Hover Hop', aircraft: 'heli', difficulty: 2, n: 8, r: 18, style: 'hop', dist: [120, 380], alt: [15, 40], blurb: 'Short low hops in a helicopter: slow down, line up, slide through.' },
  { id: 'city-hop', label: 'City Hop', aircraft: 'heli', difficulty: 3, n: 10, r: 16, style: 'tour', dist: [300, 700], alt: [30, 70], blurb: 'Weave between the rooftops - the rings sit just over the buildings.' },
  { id: 'jet-intro', label: 'Jet Familiarisation', aircraft: 'jet', difficulty: 4, n: 8, r: 26, style: 'loop', dist: [1200, 1600], alt: [120, 160], blurb: 'A long take-off run, then wide fast turns. Plan your turns early.' },
  { id: 'island-loop', label: 'Island Loop', aircraft: 'prop', difficulty: 5, n: 14, r: 17, style: 'tour', dist: [700, 1500], alt: [35, 110], blurb: 'Fourteen rings across the island. Pace yourself.' },
  { id: 'rooftop-rally', label: 'Rooftop Rally', aircraft: 'heli', difficulty: 6, n: 14, r: 13, style: 'slalom', dist: [500, 1200], alt: [18, 45], blurb: 'Tight, low and quick: a slalom for helicopter pilots.' },
  { id: 'mountain-pass', label: 'Mountain Pass', aircraft: 'jet', difficulty: 7, n: 12, r: 20, style: 'tour', dist: [1600, 2600], alt: [90, 260], blurb: 'Climb and dive with the land - the rings follow the hills.' },
  { id: 'speed-circuit', label: 'Speed Circuit', aircraft: 'jet', difficulty: 8, n: 16, r: 18, style: 'slalom', dist: [1800, 3400], alt: [80, 140], blurb: 'Flat out down the slalom and back. Every second counts.' },
  { id: 'ace-gauntlet', label: 'Ace Gauntlet', aircraft: 'prop', difficulty: 10, n: 20, r: 11, style: 'tour', dist: [350, 1100], alt: [22, 120], blurb: 'Twenty small rings, low and twisting. Only aces get three stars.' },
];
export const RING_CLEAR = 14;   // a ring's centre sits at least this far over the ground or a roof (+ its radius)
const GATE = { heli: [90, 1], prop: [420, 40], jet: [1000, 60] };   // the first ring: this far out on the runway's heading, at most this high

/** The rings of a course in the airport's own frame: [{ f, s, a, r }] (forward, right, height above the field, radius). */
export function courseLocal(spec) {
  const r = new RNG(`airport:${spec.id}`), n = spec.n, [d0, d1] = spec.dist, [a0, a1] = spec.alt, out = [];
  const heli = AIRCRAFT[spec.aircraft].kind === 'heli';
  const [gf, ga] = GATE[spec.aircraft], gate = { f: gf, s: 0 };
  out.push({ ...gate, a: heli ? a0 : Math.min(a0, ga), r: spec.r * 1.25 });   // the gate: bigger, straight ahead, low enough to reach from the runway
  if (spec.style === 'loop' || spec.style === 'tour' || spec.style === 'hop') {
    // round the field: angles step on (clockwise from the gate), the distance and height wander
    const turn = spec.style === 'hop' ? r.float(1.2, 1.7) * Math.PI : 2 * Math.PI * (spec.style === 'loop' ? 0.92 : r.float(0.85, 1.0));
    const g0 = Math.atan2(gate.s, gate.f);
    let walk = (d0 + d1) / 2;   // a tour's distance wanders from ring to ring (never zig-zags across the field)
    for (let k = 1; k < n; k++) {
      const u = k / (n - 1), ang = g0 + turn * u + (spec.style === 'loop' ? 0 : r.float(-0.12, 0.12));
      walk = Math.max(d0, Math.min(d1, walk + r.float(-0.35, 0.35) * (d1 - d0)));
      const d = spec.style === 'loop' ? (d0 + d1) / 2 + r.float(-0.08, 0.08) * (d1 - d0) : walk;
      const dd = spec.style === 'hop' ? d0 + (d1 - d0) * (0.5 + 0.5 * Math.sin(u * Math.PI * 3)) : d;
      out.push({ f: Math.cos(ang) * dd, s: Math.sin(ang) * dd, a: r.float(a0, a1), r: spec.r });
    }
  } else {   // slalom: out along the heading, left and right, a turn, and back on the other side
    const half = Math.ceil((n - 1) / 2), len = d1 - d0, lane = Math.max(spec.r * 4, len * 0.06), back = len * 0.12;
    for (let k = 1; k < n; k++) {
      const outward = k <= half, j = outward ? k : n - k, u = j / half;
      const f = gate.f + d0 * 0.25 + len * u, side = (k % 2 ? 1 : -1) * lane;
      out.push({ f, s: outward ? side : -2.2 * back + side * 0.7, a: r.float(a0, a1), r: spec.r });
    }
  }
  return out;
}
/** The length of a course in its own frame (gate to last ring, straight lines), metres. */
export const courseLength = rings => rings.slice(1).reduce((L, p, k) => L + Math.hypot(p.f - rings[k].f, p.s - rings[k].s, p.a - rings[k].a), 0);
/** Star times (s) for a course: a good pilot flies its lines at about these shares of the aircraft's cruise speed. */
function starTimes(spec) {
  const L = courseLength(courseLocal(spec)), v = AIRCRAFT[spec.aircraft].cruise, twist = 1 + 0.035 * spec.n;
  const t = share => Math.round((L * twist) / (v * share) * 10) / 10;
  return [t(0.5), t(0.68), t(0.84)];
}

/**
 * The rings of a course over a real airport, in world metres: [{ x, y, z, r, nx, nz }] (n: the way through, level).
 * airport: { x, z, y (the field's height), yaw (the runway heading: forward is (sin yaw, cos yaw))}.
 * clearAt(x, z) → the height of the ground or a roof there (rings are lifted clear of it).
 */
export function courseRings(spec, airport, clearAt = () => -Infinity) {
  const sy = Math.sin(airport.yaw), cy = Math.cos(airport.yaw);
  const pts = courseLocal(spec).map(p => {
    const x = airport.x + p.f * sy + p.s * cy, z = airport.z + p.f * cy - p.s * sy;
    const floor = Math.max(airport.y, clearAt(x, z), clearAt(x + p.r, z), clearAt(x - p.r, z), clearAt(x, z + p.r), clearAt(x, z - p.r));
    return { x, z, y: Math.max(airport.y + p.a, floor + RING_CLEAR + p.r), r: p.r };
  });
  return pts.map((p, k) => {   // each faces the way from the ring before it to the one after
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    let nx = b.x - a.x, nz = b.z - a.z; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    return { ...p, nx: +nx.toFixed(4), nz: +nz.toFixed(4) };
  });
}

/**
 * Finds the ring passes in a flight path: [{ k, t }] in order, each the moment the path crossed ring k's disc going
 * through (the right way). Stops at the first ring it cannot find.
 */
export function ringPasses(rings, path) {
  const out = [];
  let k = 0, i = 1;
  const side = (r, p) => (p[1] - r.x) * r.nx + (p[3] - r.z) * r.nz;
  while (k < rings.length && i < path.length) {
    const R = rings[k], a = path[i - 1], b = path[i], sa = side(R, a), sb = side(R, b);
    if (sa < 0 && sb >= 0) {
      const u = sa === sb ? 0 : -sa / (sb - sa), x = a[1] + (b[1] - a[1]) * u, y = a[2] + (b[2] - a[2]) * u, z = a[3] + (b[3] - a[3]) * u;
      if (Math.hypot(x - R.x, y - R.y, z - R.z) <= R.r * 1.06) { out.push({ k, t: a[0] + (b[0] - a[0]) * u }); k++; continue; }   // the same segment may go through the next ring too
    }
    i++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- the run check
const MAX_SAMPLES = 9000;   // about 37 minutes at four samples a second (the request body stays under 512 KB)
/**
 * Checks a reported run. report: { aircraft, path: [[t ms from the run's start, x, y, z], …] }; ctx: { serverMs, data: {
 * rings } } (the rings the server laid out when the run started). → { ok, score (s), ms, passes } or { ok:false, why }.
 */
export function verifyFlight(course, report, ctx) {
  const rings = ctx?.data?.rings;
  if (!Array.isArray(rings) || rings.length < 2) return { ok: false, why: 'This run has no course' };
  if (report?.aircraft !== course.aircraft) return { ok: false, why: `This course is flown in a ${AIRCRAFT[course.aircraft].label.toLowerCase()}` };
  const P = report.path;
  if (!Array.isArray(P) || P.length < 2 || P.length > MAX_SAMPLES) return { ok: false, why: 'The flight path is missing or too long' };
  const vmax = maxRunSpeed(course.aircraft);
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (!Array.isArray(p) || p.length !== 4 || !p.every(Number.isFinite)) return { ok: false, why: 'The flight path is malformed' };
    if (i) {
      const q = P[i - 1], dt = (p[0] - q[0]) / 1000;
      if (!(dt > 0)) return { ok: false, why: 'The flight path is out of order' };
      if (dt > 12) return { ok: false, why: 'The flight path has a gap (the game was paused)' };   // a slow frame or two is fine; every step is still speed-checked
      if (Math.hypot(p[1] - q[1], p[2] - q[2], p[3] - q[3]) > vmax * dt + 2) return { ok: false, why: 'Faster than that aircraft can fly' };
    }
  }
  const passes = ringPasses(rings, P);
  if (passes.length < rings.length) return { ok: false, why: `Missed ring ${passes.length + 1} of ${rings.length}`, passes: passes.length };
  const ms = Math.round(passes[passes.length - 1].t - passes[0].t);
  if (ms < 1000) return { ok: false, why: 'Too quick to be true' };
  if (Number.isFinite(ctx.serverMs) && P[P.length - 1][0] > ctx.serverMs + 4000) return { ok: false, why: 'The run took longer than the clock says' };
  if (course.limit && ms > course.limit * 1000) return { ok: false, why: 'Out of time', score: ms / 1000 };
  return { ok: true, score: Math.round(ms / 10) / 100, ms, passes: passes.map(p => Math.round(p.t)) };
}

// ------------------------------------------------------------------------------------------- the module
export const COURSES = Object.freeze(SPECS.map((s, k) => {
  const stars = starTimes(s);
  return Object.freeze({ ...s, after: k ? SPECS[k - 1].id : undefined, stars, limit: Math.round(stars[0] * 1.6), tier: s.aircraft });
}));
export const COURSE_BY_ID = Object.freeze(Object.fromEntries(COURSES.map(c => [c.id, c])));

const done = (s, ids) => ids.every(id => (s.best[id]?.stars || 0) >= 1);
const ofKind = k => COURSES.filter(c => c.aircraft === k).map(c => c.id);
export const AIRPORT = registerPlay({
  id: 'airport', version: 1, label: 'Airport', icon: '✈️', venue: 'airport', placement: 'world',
  blurb: 'Fly planes and helicopters through ring courses round the island, against the clock.',
  score: { kind: 'time', unit: 's', better: 'lower' },
  courses: COURSES,
  /** The server lays the rings out over the airport the run starts at (server/play/play.js passes where). */
  prepare: (course, { airport, clearAt }) => (airport ? { rings: courseRings(course, airport, clearAt), airport } : null),
  verify: verifyFlight,
  badges: [
    { id: 'airborne', label: 'Airborne', icon: '🛫', desc: 'Finish your first ring course', tier: 'bronze', when: s => s.runs >= 1 },
    { id: 'barnstormer', label: 'Barnstormer', icon: '🛩️', desc: 'Finish every propeller-plane course', tier: 'silver', when: s => done(s, ofKind('prop')) },
    { id: 'chopper_pilot', label: 'Chopper pilot', icon: '🚁', desc: 'Finish every helicopter course', tier: 'silver', when: s => done(s, ofKind('heli')) },
    { id: 'jet_setter', label: 'Jet setter', icon: '🛫', desc: 'Finish every jet course', tier: 'gold', when: s => done(s, ofKind('jet')) },
    { id: 'ring_master', label: 'Ring master', icon: '⭕', desc: 'Three stars on five courses', tier: 'gold', when: s => Object.values(s.best).filter(b => b.stars >= 3).length >= 5 },
    { id: 'speed_demon', label: 'Speed demon', icon: '⚡', desc: 'Three stars on the Speed Circuit', tier: 'gold', when: s => (s.best['speed-circuit']?.stars || 0) >= 3 },
    { id: 'frequent_flyer', label: 'Frequent flyer', icon: '🎫', desc: 'Finish 50 ring courses', tier: 'silver', when: s => s.runs >= 50 },
    { id: 'top_gun', label: 'Top Gun', icon: '🦅', desc: 'Three stars on every course', tier: 'platinum', when: s => COURSES.every(c => (s.best[c.id]?.stars || 0) >= 3) },
    { id: 'world_record', label: 'Record holder', icon: '🏆', desc: 'Take first place on any airport leaderboard with a three-star run', tier: 'platinum', when: (s, run) => run?.place === 1 && run.stars >= 3 },
  ],
});
