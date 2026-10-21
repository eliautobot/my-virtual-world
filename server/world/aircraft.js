// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's aircraft on the server (docs/features/play-modules.md §Airport): one record per stand (shared/
// world-modules.js aircraftStands). A player standing next to a free one boards it (fboard) and flies it in the browser
// (shared/flight-model.js); the server takes its poses (fpose: ten a second, each checked against the aircraft's top
// speed — a jump is refused and the pilot corrected), moves the pilot's player with it (so the area of interest, the
// online list and proximity chat follow), and sends everyone near the aircraft that are off their stands (fleet: five a
// second, nearby ones only; the ids of every aircraft away from its stand to all, so no parked copy is drawn twice).
// Landed and stopped, the pilot gets out (fexit) beside it; an aircraft left away from its stand waits there a few
// minutes for anyone to fly it, then the ground crew returns it. A crash (fcrash) returns it at once and puts the pilot
// beside its stand. A pilot who leaves: the aircraft lands where it is if it is on the ground, else goes home.
import { aircraftStands } from '../../shared/world-modules.js';
import { AIRCRAFT, maxRunSpeed } from '../../shared/aircraft-specs.js';
import { PF_DRIVING, PF_USING, PF_OBSERVING } from '../../shared/playerproto.js';

const BOARD_RANGE = 9;          // m from the aircraft's centre (a wing tip away)
const NEAR = 4000;              // m: aircraft this far from a viewer are sent with their poses
const PARK_MS = 4 * 60e3;       // an aircraft left away from its stand waits this long for a pilot
const HOME_RANGE = 30;          // m: an aircraft left this close to its stand goes straight back onto it
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 1e4) / 1e4;

export class Fleet {
  /** @param o { world() , players (server/world/players.js), now?, log?, groundAt(x, z) } */
  constructor({ world, players, now = () => Date.now(), log = null, groundAt = () => 0 }) {
    this.world = world; this.players = players; this.now = now; this.log = log; this.groundAt = groundAt;
    this.all = new Map();       // stand id → aircraft
    this.byPilot = new Map();   // account id → aircraft
    this.ver = 0; this.sentVer = -1; this.lastFull = 0;
    this.sync();
  }
  /** The stands changed (an airport placed, moved or removed): new aircraft on new stands, gone ones gone. */
  sync() {
    const seen = new Set();
    for (const s of aircraftStands(this.world())) {
      seen.add(s.id);
      const home = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
      const a = this.all.get(s.id);
      if (a) { a.home = home; if (a.mode === 'stand') a.pose = this.standPose(a); continue; }
      const n = { id: s.id, type: s.type, module: s.module, home, mode: 'stand', pilot: null, pilotName: '', pose: null, at: 0, returnAt: 0 };
      n.pose = this.standPose(n);
      this.all.set(s.id, n);
    }
    for (const [id, a] of this.all) if (!seen.has(id)) { if (a.pilot != null) this.release(a, null, 'The airport closed'); this.all.delete(id); }
    this.ver++;
  }
  standPose(a) { return { x: a.home.x, y: a.home.y + AIRCRAFT[a.type].gearH, z: a.home.z, q: yawQ(a.home.yaw), v: 0, g: 1 }; }
  /** A free aircraft's place: on its stand, or where it was left. */
  place(a) { return a.pose || this.standPose(a); }

  // ---------------------------------------------------------------- messages
  board(ws, m) {
    const P = this.players, p = ws.pid != null ? P.byId.get(ws.pid) : null;
    const no = text => this.send(ws, { t: 'fstate', ok: false, text });
    if (!p || !P.canPlay(ws)) return no('Enter Play mode to fly');
    if (p.vehicleId) return no('Leave the car first');
    if (p.aircraftId) return no('You are flying already');
    if (p.ctx !== -1 || (p.flags & (PF_OBSERVING | PF_USING))) return no('Walk up to the aircraft outside');
    const a = this.all.get(String(m.id || ''));
    if (!a) return no('That aircraft is not here any more');
    if (a.pilot != null) return no(`${a.pilotName || 'Someone'} is flying it`);
    const at = this.place(a);
    if (Math.hypot(p.x - at.x, p.z - at.z) > BOARD_RANGE || Math.abs(p.y - (at.y - AIRCRAFT[a.type].gearH)) > 4) return no('Walk up to it first');
    a.pilot = p.id; a.pilotName = p.name || ''; a.mode = 'flying'; a.at = this.now(); a.ts = null; a.returnAt = 0;
    this.byPilot.set(p.id, a);
    p.aircraftId = a.id; p.flags = (p.flags | PF_DRIVING) & ~PF_USING; p.clip = 0; p.ver++; p.dirty = true;
    this.ver++;
    this.send(ws, { t: 'fstate', ok: true, id: a.id, type: a.type, pose: at, home: a.home, module: a.module });
  }
  pose(ws, m) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, a = p ? this.byPilot.get(p.id) : null;
    if (!a) return;
    const x = num(m.x), y = num(m.y), z = num(m.z), q = Array.isArray(m.q) && m.q.length === 4 ? m.q.map(num) : null;
    if (![x, y, z].every(Number.isFinite) || !q || !q.every(Number.isFinite)) return;
    const now = this.now(), last = a.pose;
    // How long passed between this pose and the last: by the time they arrived, or by the flight's own clock (ts, the
    // pilot's simulated seconds) when that says more — two poses arriving together after the pilot's phone or this
    // server stalled were refused as too fast, and the jet stopped dead in the air (2026-10-14, as the car's poses
    // 2026-10-04). The flight's clock can't run ahead: all told, no more than really passed since its first pose, plus 2 s.
    let dt = (now - a.at) / 1000;
    const ts = num(m.ts);
    if (Number.isFinite(ts)) {
      if (a.ts == null || ts < a.ts) Object.assign(a, { ts0: ts, at0: now });   // a new flight's clock (boarded, or the page reloaded)
      else dt = Math.max(dt, Math.min(ts - a.ts, (now - a.at0) / 1000 + 2 - (a.ts - a.ts0)));
    }
    dt = Math.max(0.05, dt);
    const d = Math.hypot(x - last.x, y - last.y, z - last.z);
    if (d > maxRunSpeed(a.type) * dt * 1.5 + 6) {   // faster than it flies: refused, the pilot is put back
      this.send(ws, { t: 'fcorr', pose: last });
      a.at = now;
      return;
    }
    if (Number.isFinite(ts)) a.ts = ts;
    const ql = Math.hypot(...q) || 1;
    a.pose = { x: r2(x), y: r2(y), z: r2(z), q: q.map(c => r4(c / ql)), v: r2(Math.max(0, Math.min(400, num(m.v) || 0))), g: m.g ? 1 : 0, th: Math.max(0, Math.min(1, num(m.th) || 0)) };
    a.at = now;
    p.x = a.pose.x; p.y = a.pose.y; p.z = a.pose.z; p.ctx = -1; p.lastAt = now; p.ver++; p.dirty = true;
    this.ver++;
  }
  exit(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, a = p ? this.byPilot.get(p.id) : null;
    if (!a) return;
    const pose = a.pose, ground = this.groundAt(pose.x, pose.z), S = AIRCRAFT[a.type];
    if (!pose.g || pose.y - S.gearH - ground > 1.2) return this.send(ws, { t: 'fstate', ok: false, text: pose.g ? 'Land on the ground to get out (not on a roof)' : 'Land first' });
    if (pose.v > 3) return this.send(ws, { t: 'fstate', ok: false, text: 'Stop first' });
    const near = Math.hypot(pose.x - a.home.x, pose.z - a.home.z) < HOME_RANGE;
    const point = this.exitPoint(a, pose);
    this.release(a, point, near ? 'Back on its stand' : 'You got out');
    if (near) this.home(a); else { a.mode = 'parked'; a.returnAt = this.now() + PARK_MS; }
    this.ver++;
  }
  /** The pilot leaves Play mode while flying (Esc, Leave, another mode): landed and stopped, out beside it; otherwise the
   *  ground crew takes it home and the pilot stands beside its stand. */
  leave(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, a = p ? this.byPilot.get(p.id) : null;
    if (!a) return;
    const pose = a.pose, S = AIRCRAFT[a.type], landed = pose?.g && pose.v <= 3 && pose.y - S.gearH - this.groundAt(pose.x, pose.z) <= 1.2;
    if (landed) {
      const near = Math.hypot(pose.x - a.home.x, pose.z - a.home.z) < HOME_RANGE;
      this.release(a, this.exitPoint(a, pose), near ? 'Back on its stand' : 'You got out');
      if (near) this.home(a); else { a.mode = 'parked'; a.returnAt = this.now() + PARK_MS; }
    } else {
      this.release(a, this.besideStand(a), 'You left the cockpit — the ground crew took the aircraft back to its stand');
      this.home(a);
    }
    this.ver++;
  }
  crash(ws, m) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, a = p ? this.byPilot.get(p.id) : null;
    if (!a) return;
    const side = this.besideStand(a);
    this.release(a, side, `💥 ${String(m.why || 'Crashed').slice(0, 80)} — the ground crew takes it back to its stand`);
    this.home(a);
    this.ver++;
  }
  /** Where the pilot stands after getting out: beside the left door, else the right, else beside its stand. */
  exitPoint(a, pose) {
    const nav = this.players.nav, h = yawOf(pose.q), S = AIRCRAFT[a.type], off = S.kind === 'heli' ? 2.6 : S.id === 'jet' ? 3.2 : 2.2;
    for (const sgn of [1, -1]) for (const back of [0, -2.5, 2.5]) {
      const x = pose.x + Math.cos(h) * off * sgn + Math.sin(h) * back, z = pose.z - Math.sin(h) * off * sgn + Math.cos(h) * back;
      if (!nav || nav.ok(x, z, -1)) return { x, z, y: this.groundAt(x, z) };
    }
    return this.besideStand(a);
  }
  besideStand(a) {
    const nav = this.players.nav, h = a.home.yaw;
    for (const d of [8, 11, 14]) for (const sgn of [1, -1]) {
      const x = a.home.x + Math.cos(h) * d * sgn, z = a.home.z - Math.sin(h) * d * sgn;
      if (!nav || nav.ok(x, z, -1)) return { x, z, y: this.groundAt(x, z) };
    }
    const v = nav?.nearestValid?.(a.home.x + 10, a.home.z, -1);
    return v ? { x: v.x, z: v.z, y: this.groundAt(v.x, v.z) } : { x: a.home.x + 10, z: a.home.z, y: a.home.y };
  }
  /** The pilot leaves the aircraft (to point, told why). */
  release(a, point, text) {
    const p = this.players.byId.get(a.pilot);
    this.byPilot.delete(a.pilot);
    a.pilot = null; a.pilotName = '';
    if (!p) return;
    p.aircraftId = null; p.flags &= ~PF_DRIVING; p.clip = 0;
    if (point) { p.x = point.x; p.y = point.y; p.z = point.z; p.ctx = -1; }
    p.ver++; p.dirty = true; p.lastAt = this.now();
    this.players.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: -1, yaw: p.yaw, seq: p.seq, text, flight: 'out', home: !String(text).startsWith('💥') });
  }
  home(a) { a.mode = 'stand'; a.pose = this.standPose(a); a.returnAt = 0; }
  /** A player left (the last tab closed) or was deleted: on the ground the aircraft stays there, in the air it goes home. */
  forgetAccount(id) {
    const a = this.byPilot.get(id); if (!a) return;
    const grounded = a.pose?.g;
    this.byPilot.delete(id); a.pilot = null; a.pilotName = '';
    if (grounded && Math.hypot(a.pose.x - a.home.x, a.pose.z - a.home.z) >= HOME_RANGE) { a.mode = 'parked'; a.returnAt = this.now() + PARK_MS; }
    else this.home(a);
    this.ver++;
  }
  /** About five times a second: parked aircraft whose wait is over go home; everyone near an aircraft away hears of it. */
  tick(clients) {
    const now = this.now();
    for (const a of this.all.values()) if (a.mode === 'parked' && a.pilot == null && a.returnAt && now > a.returnAt) { this.home(a); this.ver++; }
    const away = [...this.all.values()].filter(a => a.mode !== 'stand');
    if (this.ver === this.sentVer && now - this.lastFull < 2000) return;
    this.sentVer = this.ver; this.lastFull = now;
    const ids = away.map(a => a.id);
    for (const ws of clients || []) {
      if (ws.readyState !== 1) continue;
      const vx = ws.view?.x, vz = ws.view?.z, me = ws.pid;
      const near = away.filter(a => a.pilot !== me && (!Number.isFinite(vx) || Math.hypot(a.pose.x - vx, a.pose.z - vz) < NEAR))
        .map(a => [a.id, a.type, a.mode === 'flying' ? 1 : 0, a.pose.x, a.pose.y, a.pose.z, ...a.pose.q, a.pose.v, a.pose.th ?? 0, a.pilotName]);
      ws.send(JSON.stringify({ t: 'fleet', away: ids, near }));
    }
  }
  send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  /** What a newly connected page needs (its own flight, if it flies: after a reload it lands back in the cockpit). */
  stateFor(accountId) { const a = this.byPilot.get(accountId); return a ? { t: 'fstate', ok: true, id: a.id, type: a.type, pose: a.pose, home: a.home, module: a.module, resumed: true } : null; }
}
const yawQ = h => [0, r4(Math.sin(h / 2)), 0, r4(Math.cos(h / 2))];
function yawOf(q) {   // the heading of an orientation [x, y, z, w] or {x, y, z, w}
  const [x, y, z, w] = Array.isArray(q) ? q : [q.x, q.y, q.z, q.w];
  const fx = 2 * (x * z + w * y), fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}
