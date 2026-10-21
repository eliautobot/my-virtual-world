// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Motion plan builder: turns routes (indoor A* paths, street polylines, crosswalks with signal waits, elevator rides,
// subway rides, furniture use) into absolute-time piecewise-linear segments in WORLD coordinates.
import { GROUND_Y, floorAt, CROSS_SPEED, ELEVATOR_BASE, ELEVATOR_PER_FLOOR, ctxOf, ctxB, ctxF, pedStart } from '../../shared/constants.js';
import { A, SEATED } from '../../shared/anims.js';
import { F_HIDDEN, F_FACE, CTX_OUT, CTX_UNDER, VEH_CAR, VEH_BOAT } from '../../shared/proto.js';
import { toWorld, toLocal, bRot } from '../../shared/geom.js';
import { elevatorStops } from '../../shared/building.js';
import { USE_ID } from '../../shared/catalog.js';
import { SUBWAY_SPEED } from './nav.js';
import { stationInside, stationY } from '../../shared/stations.js';
import { nextSailing } from '../../shared/ferries.js';
import { walkStart } from '../../shared/road-kit.js';

export const U_WALK = USE_ID.walk, U_WAIT = USE_ID.wait, U_COMMUTE = USE_ID.commute;
const DRIVE_AFTER = 300;   // s: beyond the city, residents drive rather than walk further than this
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export class Plan {
  constructor(t, loc) {
    this.base = t; this.sx = loc.x; this.sy = loc.y; this.sz = loc.z;
    this.segs = [];
    this.t = t; this.x = loc.x; this.y = loc.y; this.z = loc.z; this.yaw = loc.yaw || 0; this.ctx = loc.ctx;
    this.meta = {};
  }
  get end() { return this.t; }
  /** Teleport the (still empty) plan to a location. */
  place(x, y, z, ctx, yaw = this.yaw) {
    if (this.segs.length) return false;
    this.seat = null;
    this.sx = this.x = x; this.sy = this.y = y; this.sz = this.z = z; this.ctx = ctx; this.yaw = yaw; this.base = this.t;
    return true;
  }
  /** Make sure the plan reaches time t (sim lagging): stretch a final hold, else idle in place. */
  extendTo(t) {
    if (this.t >= t) return;
    const last = this.segs[this.segs.length - 1];
    if (last && (last.h || last.up)) { last.dur += t - this.t; this.t = t; return; }
    this.hold(t - this.t + 0.05, 0, 0);
  }
  /** Instant jump (used after edits remove the floor an agent stood on). */
  jump(x, y, z, ctx, yaw = this.yaw) { this.seat = null; return this.seg(0.05, x, y, z, yaw, 0, 0, 0, 8, ctx); }
  seg(dur, x, y, z, yaw, anim, use = 0, prop = 0, flags = 0, ctx = this.ctx, extra = null) {
    if (!(dur > 0.001)) dur = 0.001;
    this.tele = false;
    const s = { dur, x, y, z, yaw, ctx, anim, prop, flags, use };
    if (extra) Object.assign(s, extra);
    this.segs.push(s);
    this.t += dur; this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.ctx = ctx;
    return s;
  }
  /** If the plan currently ends seated / lying, append the stand-up transition. */
  standUp() {
    const st = this.seat; if (!st) return;
    this.seat = null;
    this.seg(0.75, st.up.x, st.up.y, st.up.z, this.yaw, 0, 0, 0, F_FACE, this.ctx, { nocut: 1 });
  }
  hold(dur, anim, use, prop = 0, yaw = this.yaw, flags = 0, extra = null) {
    if (dur <= 0.02) return null;
    if (this.seat && !SEATED.has(anim)) this.standUp();
    return this.seg(dur, this.x, this.y, this.z, yaw, anim, use, prop, flags, this.ctx, extra ? Object.assign({ h: 1 }, extra) : { h: 1 });
  }
  move(x, y, z, speed, anim, use, o = null) {
    if (this.seat) this.standUp();
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz), dy = Math.abs(y - this.y);
    if (d < 0.02 && dy < 0.02) { if (o && o.ctx !== undefined) this.ctx = o.ctx; return null; }
    const yaw = o && o.yaw !== undefined ? o.yaw : (d > 0.02 ? Math.atan2(dx, dz) : this.yaw);
    return this.seg(Math.max(d, dy * 0.6) / speed, x, y, z, yaw, anim, use, o?.prop || 0, o?.flags || 0, o && o.ctx !== undefined ? o.ctx : this.ctx, o?.extra || null);
  }
}

/** Evaluate a plan at time t -> { x, y, z, yaw, ctx, k (segment index), s (segment) }. */
export function evalPlan(P, t) {
  let tt = P.base, px = P.sx, py = P.sy, pz = P.sz;
  const n = P.segs.length;
  for (let k = 0; k < n; k++) {
    const s = P.segs[k];
    if (t < tt + s.dur) {
      const u = Math.max(0, (t - tt) / s.dur);
      return { x: px + (s.x - px) * u, y: py + (s.y - py) * u, z: pz + (s.z - pz) * u, yaw: s.yaw, ctx: s.ctx, k, s, t0: tt };
    }
    tt += s.dur; px = s.x; py = s.y; pz = s.z;
  }
  const s = n ? P.segs[n - 1] : null;
  return { x: px, y: py, z: pz, yaw: s ? s.yaw : 0, ctx: s ? s.ctx : P.ctx, k: n - 1, s, t0: tt };
}
/** New plan cursor that keeps every segment of `old` still running at/after `now` (seamless client hand-over). */
export function continuePlan(old, now) {
  const P = new Plan(old.t, { x: old.x, y: old.y, z: old.z, ctx: old.ctx, yaw: old.yaw });
  let tt = old.base, px = old.sx, py = old.sy, pz = old.sz, started = false;
  for (const s of old.segs) {
    const e = tt + s.dur;
    if (!started && e > now) { started = true; P.base = tt; P.sx = px; P.sy = py; P.sz = pz; }
    if (started) P.segs.push(s);
    tt = e; px = s.x; py = s.y; pz = s.z;
  }
  if (!started) { P.base = old.t; P.sx = old.x; P.sy = old.y; P.sz = old.z; }
  const last = old.segs[old.segs.length - 1];
  if (last && last.up) P.seat = { key: last.sk, up: last.up };
  return P;
}
/** Drop leading segments that ended before tMin (keeps the last one). */
export function trimPlan(P, tMin) {
  let tt = P.base, k = 0;
  const n = P.segs.length;
  while (k < n - 1 && tt + P.segs[k].dur < tMin) { tt += P.segs[k].dur; k++; }
  if (k > 0) {
    const last = P.segs[k - 1];
    P.base = tt; P.sx = last.x; P.sy = last.y; P.sz = last.z;
    P.segs.splice(0, k);
  }
}
/** Cut the plan at time tc. Returns the segment that was cut if the agent was seated in it (caller stands up). */
export function truncatePlan(P, tc) {
  let tt = P.base, px = P.sx, py = P.sy, pz = P.sz;
  for (let k = 0; k < P.segs.length; k++) {
    const s = P.segs[k];
    if (tc < tt + s.dur) {
      const u = Math.max(0, (tc - tt) / s.dur);
      const cut = { ...s, dur: Math.max(0.02, tc - tt), x: px + (s.x - px) * u, y: py + (s.y - py) * u, z: pz + (s.z - pz) * u };
      P.segs.length = k;
      P.segs.push(cut);
      P.t = tt + cut.dur;
      P.x = cut.x; P.y = cut.y; P.z = cut.z; P.yaw = s.yaw; P.ctx = s.ctx;
      return s.up ? s : null;
    }
    tt += s.dur; px = s.x; py = s.y; pz = s.z;
  }
  return null;
}

/** Earliest time >= t at which the plan can be safely interrupted (not mid-crossing / hidden / sitting down). */
export function safeCutTime(P, t) {
  let tt = P.base;
  for (const s of P.segs) {
    const e = tt + s.dur;
    if (t < e) {
      if (!(s.cross || s.nocut || (s.flags & (F_HIDDEN | F_FACE)))) return t;
      // skip the whole non-interruptible run (crossings are several segments)
      let tt2 = e, k = P.segs.indexOf(s) + 1;
      while (k < P.segs.length && (P.segs[k].cross || P.segs[k].nocut || (P.segs[k].flags & (F_HIDDEN | F_FACE)))) { tt2 += P.segs[k].dur; k++; }
      return tt2;
    }
    tt = e;
  }
  return Math.max(t, tt);
}

/** Right-hand ("keep right") lateral offset of a polyline's interior vertices. */
function offsetPolyline(pts, off) {
  const n = pts.length, out = pts.map(p => ({ x: p.x, z: p.z, y: p.y }));
  if (!off || n < 3) return out;
  for (let k = 1; k < n - 1; k++) {
    const a = pts[k - 1], b = pts[k], c = pts[k + 1];
    let d1x = b.x - a.x, d1z = b.z - a.z; const l1 = Math.hypot(d1x, d1z);
    let d2x = c.x - b.x, d2z = c.z - b.z; const l2 = Math.hypot(d2x, d2z);
    if (l1 < 1e-3 || l2 < 1e-3) continue;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    const n1x = -d1z, n1z = d1x, n2x = -d2z, n2z = d2x;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { mx = n1x; mz = n1z; } else { mx /= ml; mz /= ml; }
    const s = off / Math.max(mx * n1x + mz * n1z, 0.55);
    out[k].x = b.x + mx * s; out[k].z = b.z + mz * s;
  }
  return out;
}
function exitT(x0, z0, dx, dz, r) {
  let t = 1;
  if (dx > 1e-6) t = Math.min(t, (r.x1 - x0) / dx); else if (dx < -1e-6) t = Math.min(t, (r.x0 - x0) / dx);
  if (dz > 1e-6) t = Math.min(t, (r.z1 - z0) / dz); else if (dz < -1e-6) t = Math.min(t, (r.z0 - z0) / dz);
  return Math.max(0, t);
}
function enterT(x0, z0, dx, dz, r) {
  let t = 0;
  if (dx > 1e-6) t = Math.max(t, (r.x0 - x0) / dx); else if (dx < -1e-6) t = Math.max(t, (r.x1 - x0) / dx);
  if (dz > 1e-6) t = Math.max(t, (r.z0 - z0) / dz); else if (dz < -1e-6) t = Math.max(t, (r.z1 - z0) / dz);
  return Math.min(1, t);
}

export class Router {
  constructor(world, nav) { this.world = world; this.nav = nav; }

  walkIndoor(P, b, f, lx, lz, o) {
    const cur = toLocal(b, P.x, P.z);
    const pts = this.nav.path(b.lv[f], cur.x, cur.z, lx, lz);
    const y = floorAt(b, f), ctx = ctxOf(b.idx, f);
    for (let k = 1; k < pts.length; k++) {
      const w = toWorld(b, pts[k][0], pts[k][1]);
      P.move(w.x, y, w.z, o.speed, o.anim, o.use, { ctx, prop: o.prop });
    }
    P.ctx = ctx;
  }
  elevator(P, b, fromF, toF, o) {
    const stops = elevatorStops(b);
    if (!stops.length || fromF === toF) return;
    const st = stops[(o.stop || 0) % stops.length];
    const c = b.core, cr = Math.cos(c.r || 0), sr = Math.sin(c.r || 0);
    const lat = o.rng ? (o.rng() - 0.5) * 1.5 : 0, back = o.rng ? o.rng() * 0.7 : 0;
    this.walkIndoor(P, b, fromF, st.x + lat * cr + back * sr, st.z - lat * sr + back * cr, o);
    const yawW = st.yaw + bRot(b);
    P.hold(o.rng ? 1.5 + o.rng() * 5 : 3, A.wait, U_WAIT, o.prop || 0, yawW);
    const inW = toWorld(b, st.ix, st.iz);
    P.move(inW.x, floorAt(b, fromF), inW.z, 1.1, A.walk, U_WAIT, { prop: o.prop });
    const ride = ELEVATOR_BASE + Math.abs(toF - fromF) * ELEVATOR_PER_FLOOR;
    P.seg(ride, inW.x, floorAt(b, toF), inW.z, yawW + Math.PI, A.idle, U_COMMUTE, 0, F_HIDDEN, ctxOf(b.idx, toF));
    const outW = toWorld(b, st.x, st.z);
    P.move(outW.x, floorAt(b, toF), outW.z, 1.1, A.walk, o.use, { ctx: ctxOf(b.idx, toF), prop: o.prop });
  }
  exitBuilding(P, b, acc, o) {
    this.walkIndoor(P, b, 0, acc.lx, acc.lz, o);
    const y = floorAt(b, 0);
    if (b.type === 'park') { P.move(acc.x, y, acc.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop }); return; }
    P.move(acc.sx, y, acc.sz, o.speed, o.anim, o.use, { ctx: ctxOf(b.idx, 0), prop: o.prop });
    P.move(acc.x, y, acc.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
  }
  enterBuilding(P, b, acc, o) {
    const ctx = ctxOf(b.idx, 0), y = floorAt(b, 0);
    if (b.type === 'park') { P.move(acc.wx, y, acc.wz, o.speed, o.anim, o.use, { ctx, prop: o.prop }); return; }
    P.move(acc.sx, y, acc.sz, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    P.move(acc.wx, y, acc.wz, o.speed, o.anim, o.use, { ctx, prop: o.prop });
  }
  walkStreet(P, A0, B0, o) {
    const nav = this.nav;
    const poly = nav.streetPolyline(A0, B0);
    const pts = offsetPolyline(poly, o.off || 0);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k];
      if (poly[k].c) this.crossing(P, poly[k], p, o);
      else if (poly[k].ferry) this.ferry(P, poly[k], p, o);
      else if (poly[k].jx) { this.signalWait(P, poly[k], poly[k + 1] || p, o); P.move(p.x, p.y ?? GROUND_Y, p.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop }); }
      else P.move(p.x, p.y ?? GROUND_Y, p.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    }
  }
  crossing(P, info, p, o) {
    const x0 = P.x, z0 = P.z, dx = p.x - x0, dz = p.z - z0, L = Math.hypot(dx, dz);
    if (L < 0.05) return;
    const speed = Math.max(o.speed, CROSS_SPEED), dur = L / speed;
    const t0 = pedStart(info.ix, P.t, dur + 0.4);
    if (t0 > P.t + 0.05) P.hold(t0 - P.t, A.wait, U_WAIT, o.prop || 0, Math.atan2(dx, dz));
    const ra = this.nav.blockRectOf(info.ba), rb = this.nav.blockRectOf(info.bb);
    const te = exitT(x0, z0, dx, dz, ra), ti = enterT(x0, z0, dx, dz, rb);
    const step = 0.28 / L;
    const X = []; // [t, y]
    if (te > 0.001 && te < ti) {
      X.push([te, GROUND_Y], [Math.min(te + step, ti), 0]);
      X.push([Math.max(ti - step, te + step), 0], [ti, GROUND_Y]);
    }
    X.push([1, GROUND_Y]);
    const ex = { cross: 1 };
    for (const [t, y] of X) P.move(x0 + dx * t, y, z0 + dz * t, speed, o.anim, o.use, { ctx: CTX_OUT, extra: ex, prop: o.prop });
  }
  /** At a signalled junction beyond the city (shared/road-kit.js): wait at the curb for the walk light, long enough to
   *  get across (to `far`) before it ends. */
  signalWait(P, info, far, o) {
    const plan = this.nav.walk()?.plans?.get(info.jx); if (!plan) return;
    const dur = Math.hypot(far.x - P.x, far.z - P.z) / Math.max(o.speed, CROSS_SPEED) + 1;
    const t0 = walkStart(plan, P.t, dur);
    if (t0 > P.t + 0.05) P.hold(t0 - P.t, A.wait, U_WAIT, o.prop || 0, Math.atan2(far.x - P.x, far.z - P.z));
  }
  /** A ferry crossing (shared/ferries.js): wait on the dock for the next sailing, cross hidden on board (the boat is drawn
   *  on the same timetable), step off at the dock across. */
  ferry(P, info, p, o) {
    const f = (this.world.ferries || []).find(x => x.id === info.ferry);
    if (!f) { P.move(p.x, p.y ?? GROUND_Y, p.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop }); return; }
    const s = nextSailing(f, info.from, P.t + 2);
    if (s.depart > P.t + 0.05) P.hold(s.depart - P.t, A.wait, U_WAIT, o.prop || 0, P.yaw);
    P.seg(s.arrive - s.depart, p.x, p.y ?? GROUND_Y, p.z, P.yaw, A.idle, U_COMMUTE, 0, F_HIDDEN, CTX_OUT, { veh: VEH_BOAT });
  }
  subway(P, sa, sb, o) {
    // walk into the kiosk, ride hidden underground, emerge from the destination kiosk
    const ia = stationInside(sa.st), ib = stationInside(sb.st);
    P.move(ia.x, stationY(sa.st), ia.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    const d = hyp(sa.x, sa.z, sb.x, sb.z);
    const ride = (o.rng ? 4 + o.rng() * 14 : 10) + d / SUBWAY_SPEED + 6;
    P.seg(ride, ib.x, stationY(sb.st), ib.z, P.yaw, A.idle, U_COMMUTE, 0, F_HIDDEN, CTX_UNDER);
    P.move(sb.x, stationY(sb.st), sb.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
  }
  /** Beyond the city: walk to the road, drive (hidden at the wheel; the browsers draw the car, WP4.9), walk on. */
  drive(P, A0, B0, r, o) {
    const nav = this.nav;
    if (A0.walk) for (const q of nav.spurPts(A0.x, A0.z, A0.node).slice(1)) P.move(q.x, q.y, q.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    else P.move(A0.bx, GROUND_Y, A0.bz, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    // the car is drawn along the lanes of the route (render/resident-cars.js) while the driver is hidden at the wheel
    const pts = this.onDrive && o.i !== undefined ? nav.carPath(A0, B0) : null;
    if (pts) this.onDrive({ i: o.i, t0: P.t, t1: P.t + r.time, pts });
    P.seg(r.time, r.to.x, r.to.y, r.to.z, P.yaw, A.idle, U_COMMUTE, 0, F_HIDDEN, CTX_OUT, { veh: VEH_CAR });
    if (B0.walk) for (const q of nav.spurPts(B0.x, B0.z, B0.node, true).slice(1)) P.move(q.x, q.y, q.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    else P.move(B0.x, GROUND_Y, B0.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
  }
  /** Street trip between two access records; takes the subway for long walks when it is clearly faster, and beyond
   *  the city drives when walking would take long. */
  streetTrip(P, A0, B0, o) {
    const nav = this.nav;
    const direct = nav.streetCost(A0, B0);
    let sub = null, drive = null;
    if (!o.noSubway && direct > 240 && this.world.stations.length >= 2) {
      const a = nav.nearestStation(A0), b = nav.nearestStation(B0);
      if (a && b && a.s !== b.s) {
        const cost = a.cost + 11 + hyp(a.s.x, a.s.z, b.s.x, b.s.z) / SUBWAY_SPEED + 6 + b.cost;
        if (cost < direct * 0.78) sub = { a, b, cost };
      }
    }
    if ((A0.walk || B0.walk) && direct > DRIVE_AFTER) {
      const r = nav.rideCost(A0, B0);
      if (r && r.cost < direct * 0.8 && (!sub || r.cost < sub.cost * 0.85)) drive = r;   // the subway when it's about as quick
    }
    if (drive) { this.drive(P, A0, B0, drive, o); return 'drive'; }
    if (sub) {
      this.walkStreet(P, A0, sub.a.s, o);
      this.subway(P, sub.a.s, sub.b.s, o);
      this.walkStreet(P, sub.b.s, B0, o);
      return 'subway';
    }
    this.walkStreet(P, A0, B0, o);
    return 'walk';
  }
  /** Rough travel-time estimate (s) between two places, for scheduling. */
  estimate(fromCtx, fx, fz, dest) {
    const W = this.world, nav = this.nav;
    const fb = fromCtx >= 0 ? ctxB(fromCtx) : -1, db = dest.ctx >= 0 ? ctxB(dest.ctx) : -1;
    const ff = ctxF(fromCtx), df = ctxF(dest.ctx);
    const lift = f => (f > 0 ? ELEVATOR_BASE * 2 + f * ELEVATOR_PER_FLOOR + 6 : 0);
    if (fb >= 0 && fb === db) return (ff !== df ? lift(Math.abs(ff - df)) + 12 : 0) + hyp(fx, fz, dest.x, dest.z) / 1.3 + 4;
    const A0 = fb >= 0 ? nav.pickAccess(fb, dest.x, dest.z) : nav.accessAt(fx, fz);
    const B0 = db >= 0 ? nav.pickAccess(db, fx, fz) : nav.accessAt(dest.x, dest.z);
    let c = Math.min(nav.streetCost(A0, B0), 1e6);
    if ((A0.walk || B0.walk) && c > DRIVE_AFTER) { const r = nav.rideCost(A0, B0); if (r) c = Math.min(c, r.cost); }
    if (c > 240 && W.stations.length >= 2) {
      const a = nav.nearestStation(A0), b = nav.nearestStation(B0);
      if (a && b && a.s !== b.s) c = Math.min(c, a.cost + 17 + hyp(a.s.x, a.s.z, b.s.x, b.s.z) / SUBWAY_SPEED + b.cost);
    }
    return c + lift(ff) + lift(df) + 20;
  }
  /**
   * Travel from the plan cursor to dest = { ctx, x, z (world), lx, lz (building-local, indoor) }.
   * o = { speed, anim, use, off, rng, stop }
   */
  travel(P, dest, o) {
    const W = this.world, nav = this.nav;
    if (P.tele) {
      P.tele = false;
      P.place(dest.x, dest.ctx >= 0 ? floorAt(W.buildings[ctxB(dest.ctx)], ctxF(dest.ctx)) : nav.beyond(dest.x, dest.z) ? nav.groundY(dest.x, dest.z) : GROUND_Y, dest.z, dest.ctx);
      return 'tele';
    }
    const cb = P.ctx >= 0 ? ctxB(P.ctx) : -1, cf = ctxF(P.ctx);
    const db = dest.ctx >= 0 ? ctxB(dest.ctx) : -1, df = ctxF(dest.ctx);
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    if (cb >= 0 && cb === db) {
      const b = W.buildings[cb];
      if (cf !== df) this.elevator(P, b, cf, df, o);
      this.walkIndoor(P, b, df, dest.lx, dest.lz, o);
      return 'indoor';
    }
    let from, mode = 'walk';
    if (cb >= 0) {
      const b = W.buildings[cb];
      if (cf > 0) this.elevator(P, b, cf, 0, o);
      from = this.bestAccess(cb, db >= 0 ? W.buildings[db] : null, dest, P);
      this.exitBuilding(P, b, from, o);
    } else from = nav.accessAt(P.x, P.z);
    let to;
    if (db >= 0) to = this.bestAccess(db, null, { x: P.x, z: P.z }, null, dest);
    else to = nav.accessAt(dest.x, dest.z);
    mode = this.streetTrip(P, from, to, o);
    if (db >= 0) {
      const b = W.buildings[db];
      this.enterBuilding(P, b, to, o);
      if (df > 0) this.elevator(P, b, 0, df, o);
      this.walkIndoor(P, b, df, dest.lx, dest.lz, o);
    } else P.move(dest.x, nav.beyond(dest.x, dest.z) ? nav.groundY(dest.x, dest.z) : GROUND_Y, dest.z, o.speed, o.anim, o.use, { ctx: CTX_OUT, prop: o.prop });
    return mode;
  }
  /** Pick the access (door/gate) of building bi that best connects to a target point. */
  bestAccess(bi, otherB, target, P, inner) {
    const list = this.nav.acc[bi];
    if (list.length === 1) return list[0];
    const b = this.world.buildings[bi];
    const tgt = otherB ? this.nav.pickAccess(otherB.idx, b.x, b.z) : this.nav.accessAt(target.x, target.z);
    let best = list[0], bc = Infinity;
    for (const a of list) {
      let c = this.nav.streetCost(a, tgt);
      if (P) { const l = toLocal(b, P.x, P.z); c += hyp(l.x, l.z, a.lx, a.lz) / 1.3; }
      if (inner) c += hyp(inner.lx, inner.lz, a.lx, a.lz) / 1.3;
      if (c < bc) { bc = c; best = a; }
    }
    return best;
  }
}
