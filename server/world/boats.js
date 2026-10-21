// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks' boats on the server (docs/features/fishing.md §Boats): one per slip (shared/world-modules.js
// boatSlips), as the airport's aircraft (server/world/aircraft.js). A player on the dock beside a free boat takes it
// (bboard) and drives it in the browser (shared/boat-model.js); the server takes its poses (bpose: ten a second, each
// checked against the boat's top speed — a jump is refused and the skipper corrected), keeps the skipper's player at its
// helm (so the area of interest, the online list and proximity chat follow, and others see them standing there), and
// sends everyone near the boats that are out of their slips (harbour: five a second, nearby ones only; the ids of every
// boat out to all, so no moored copy is drawn twice). Stopped alongside a dock or the shore, the skipper steps off
// (bexit); a boat left away from its slip waits a few minutes, then the harbour master brings it back. Leaving Play
// mode while out: the boat goes home and the skipper stands on the dock beside its slip.
import { boatSlips, moduleDecks, deckUnder } from '../../shared/world-modules.js';
import { BOATS, maxBoatSpeed, deckFloor } from '../../shared/boat-model.js';

const BOARD_RANGE = 7.5;        // m from the boat's middle (from the walkway at its stern, or a dock alongside)
const NEAR = 3000;              // m: boats this far from a viewer are sent with their poses
const PARK_MS = 5 * 60e3;       // a boat left away from its slip waits this long for its skipper
const HOME_RANGE = 14;          // m: left this close to its slip, it goes straight back in
const STOP = 1.5;               // m/s: slow enough to step off
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

export class Harbour {
  /** @param o { world(), players (server/world/players.js), now?, log?, groundAt(x, z), waterAt(x, z) } */
  constructor({ world, players, now = () => Date.now(), log = null, groundAt = () => 0, waterAt = () => null }) {
    Object.assign(this, { world, players, now, log, groundAt, waterAt });
    this.all = new Map();       // slip id → boat
    this.bySkipper = new Map(); // account id → boat
    this.ver = 0; this.sentVer = -1; this.lastFull = 0; this.decksOf = null; this.decks = [];
    this.sync();
  }
  /** The slips changed (a dock placed, moved or removed): new boats in new slips, gone ones gone. */
  sync() {
    const seen = new Set();
    for (const s of boatSlips(this.world())) {
      seen.add(s.id);
      const home = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, deck: s.deck };
      const b = this.all.get(s.id);
      if (b) { b.home = home; if (b.mode === 'slip') b.pose = this.slipPose(b); continue; }
      const n = { id: s.id, type: s.kind, module: s.module, home, mode: 'slip', skipper: null, skipperName: '', pose: null, at: 0, returnAt: 0 };
      n.pose = this.slipPose(n);
      this.all.set(s.id, n);
    }
    for (const [id, b] of this.all) if (!seen.has(id)) { if (b.skipper != null) this.release(b, null, 'The dock closed'); this.all.delete(id); }
    this.ver++;
  }
  slipPose(b) { return { x: b.home.x, y: b.home.y, z: b.home.z, h: b.home.yaw, p: 0, r: 0, v: 0, l: 0 }; }
  place(b) { return b.pose || this.slipPose(b); }
  decksNow() { const W = this.world(); if (this.decksOf !== W.worldModules) { this.decksOf = W.worldModules; this.decks = moduleDecks(W); } return this.decks; }
  /** Where the skipper stands at the helm (shared/boat-model.js BOATS helm) — or at a point H of the deck — for a pose. */
  helmOf(b, pose, H = BOATS[b.type].helm) {
    const c = Math.cos(pose.h), s = Math.sin(pose.h);
    return { x: pose.x + H[0] * c + H[2] * s, y: pose.y + H[1], z: pose.z - H[0] * s + H[2] * c };
  }
  /**
   * Where on the deck the client says its player is, and what they're doing (dk: [x, y, z, facing, clip], the boat's
   * frame — the fishing game's walking about): { at, yaw, clip } if it's somewhere one can stand on that boat
   * (shared/boat-model.js deckFloor), else the helm.
   */
  deckOf(b, dk) {
    const helm = { at: BOATS[b.type].helm, yaw: 0, clip: 0 };
    if (!Array.isArray(dk) || dk.length < 5) return helm;
    const [x, y, z, yaw] = dk.slice(0, 4).map(num), clip = (num(dk[4]) | 0) & 63;
    if (![x, y, z, yaw].every(Number.isFinite)) return helm;
    const fl = deckFloor(b.type, x, z);
    if (fl == null || Math.abs(fl - y) > 0.06) return { ...helm, clip };
    return { at: [r2(x), fl, r2(z)], yaw: r3(Math.max(-7, Math.min(7, yaw))), clip };
  }

  // ---------------------------------------------------------------- messages
  board(ws, m) {
    const P = this.players, p = ws.pid != null ? P.byId.get(ws.pid) : null;
    const no = text => this.send(ws, { t: 'bstate', ok: false, text });
    if (!p || !P.canPlay(ws)) return no('Enter Play mode to take a boat');
    if (p.vehicleId || p.aircraftId) return no('Leave the vehicle first');
    if (p.boatId) return no('You are in a boat already');
    if (p.ctx !== -1) return no('Walk down to the boat first');
    const b = this.all.get(String(m.id || ''));
    if (!b) return no('That boat is not here any more');
    if (b.skipper != null) return no(`${b.skipperName || 'Someone'} has it out`);
    const at = this.place(b);
    if (Math.hypot(p.x - at.x, p.z - at.z) > BOARD_RANGE || Math.abs(p.y - at.y) > 4) return no('Walk down to it first');
    b.skipper = p.id; b.skipperName = p.name || ''; b.mode = 'out'; b.at = this.now(); b.ts = null; b.returnAt = 0;
    this.bySkipper.set(p.id, b);
    p.boatId = b.id; p.clip = 0; const hm = this.helmOf(b, at); p.x = hm.x; p.y = hm.y; p.z = hm.z; p.yaw = at.h; p.ver++; p.dirty = true;
    this.ver++;
    this.send(ws, { t: 'bstate', ok: true, id: b.id, type: b.type, pose: at, home: b.home, module: b.module });
  }
  pose(ws, m) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = p ? this.bySkipper.get(p.id) : null;
    if (!b) return;
    const x = num(m.x), y = num(m.y), z = num(m.z), h = num(m.h), pi = num(m.p), ro = num(m.r);
    if (![x, y, z, h].every(Number.isFinite)) return;
    const now = this.now(), last = b.pose;
    // how long passed: by arrival, or the boat's own clock (ts) when that says more — never more than really passed
    let dt = (now - b.at) / 1000;
    const ts = num(m.ts);
    if (Number.isFinite(ts)) {
      if (b.ts == null || ts < b.ts) Object.assign(b, { ts0: ts, at0: now });
      else dt = Math.max(dt, Math.min(ts - b.ts, (now - b.at0) / 1000 + 2 - (b.ts - b.ts0)));
    }
    dt = Math.max(0.05, dt);
    const d = Math.hypot(x - last.x, z - last.z);
    if (d > maxBoatSpeed(b.type) * dt * 1.5 + 4 || y < b.home.y - 4 || y > b.home.y + 6) {   // faster than it goes, or off the water: put back
      this.send(ws, { t: 'bcorr', pose: last });
      b.at = now;
      return;
    }
    if (Number.isFinite(ts)) b.ts = ts;
    b.pose = { x: r2(x), y: r2(y), z: r2(z), h: r3(h), p: r3(Number.isFinite(pi) ? Math.max(-0.6, Math.min(0.6, pi)) : 0), r: r3(Number.isFinite(ro) ? Math.max(-0.6, Math.min(0.6, ro)) : 0),
      v: r2(Math.max(-15, Math.min(60, num(m.v) || 0))), l: Math.max(-1, Math.min(1, num(m.l) || 0)), an: m.an ? 1 : 0 };
    b.at = now;
    const dk = this.deckOf(b, m.dk), hm = this.helmOf(b, b.pose, dk.at);
    p.x = hm.x; p.y = hm.y; p.z = hm.z; p.yaw = b.pose.h + dk.yaw; p.clip = dk.clip; p.ctx = -1; p.lastAt = now; p.ver++; p.dirty = true;
    this.ver++;
  }
  /** Off the boat: stopped, alongside a dock or the shore — on to its deck or the dry land beside the boat. */
  exit(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = p ? this.bySkipper.get(p.id) : null;
    if (!b) return;
    const pose = b.pose;
    if (Math.abs(pose.v) > STOP) return this.send(ws, { t: 'bstate', ok: false, text: 'Stop first (Space: the lever to neutral)' });
    const point = this.stepOff(b, pose);
    if (!point) return this.send(ws, { t: 'bstate', ok: false, text: 'Bring it alongside a dock or the shore to step off' });
    const near = Math.hypot(pose.x - b.home.x, pose.z - b.home.z) < HOME_RANGE;
    this.release(b, point, near ? 'Back in its slip' : 'You stepped ashore');
    if (near) this.home(b); else { b.mode = 'moored'; b.returnAt = this.now() + PARK_MS; }
    this.ver++;
  }
  /** The skipper leaves Play mode while out: the boat goes home, the skipper stands on the dock beside its slip. */
  leave(ws) {
    const p = ws.pid != null ? this.players.byId.get(ws.pid) : null, b = p ? this.bySkipper.get(p.id) : null;
    if (!b) return;
    const pose = b.pose, near = Math.hypot(pose.x - b.home.x, pose.z - b.home.z) < HOME_RANGE;
    const point = Math.abs(pose.v) <= STOP ? this.stepOff(b, pose) : null;
    if (point && !near) { this.release(b, point, 'You stepped ashore'); b.mode = 'moored'; b.returnAt = this.now() + PARK_MS; }
    else { this.release(b, this.besideSlip(b), near ? 'Back in its slip' : 'You left the helm — the harbour master brought the boat back to its slip'); this.home(b); }
    this.ver++;
  }
  /** A dock's deck or the dry shore beside the boat within a stride, else null: { x, y, z }. */
  stepOff(b, pose) {
    const S = BOATS[b.type], decks = this.decksNow(), nav = this.players.nav, h = pose.h, fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    for (const side of [1, -1]) for (const out of [S.B / 2 + 0.6, S.B / 2 + 1.4, S.B / 2 + 2.4]) for (const along of [0, -S.L * 0.3, S.L * 0.3, -S.L * 0.48]) {
      const x = pose.x + rx * side * out + fx * along, z = pose.z + rz * side * out + fz * along;
      const top = deckUnder(decks, x, z, pose.y + 2.5, 3);
      if (top !== null && top > pose.y - 1) return { x, y: top, z };
      if (!this.waterAt(x, z) && (!nav || nav.ok(x, z, -1))) { const g = this.groundAt(x, z); if (Math.abs(g - pose.y) < 2.5) return { x, y: g, z }; }
    }
    for (const along of [S.L / 2 + 0.8, S.L / 2 + 1.8]) {   // off the bow on to a dock or the beach it nosed up to
      const x = pose.x + fx * along, z = pose.z + fz * along, top = deckUnder(decks, x, z, pose.y + 2.5, 3);
      if (top !== null && top > pose.y - 1) return { x, y: top, z };
      if (!this.waterAt(x, z) && (!nav || nav.ok(x, z, -1))) { const g = this.groundAt(x, z); if (Math.abs(g - pose.y) < 2.5) return { x, y: g, z }; }
    }
    return null;
  }
  besideSlip(b) { const d = b.home.deck; return d ? { x: d.x, y: d.y, z: d.z } : { x: b.home.x, y: b.home.y + 1, z: b.home.z }; }
  release(b, point, text) {
    const p = this.players.byId.get(b.skipper);
    this.bySkipper.delete(b.skipper);
    b.skipper = null; b.skipperName = '';
    if (!p) return;
    p.boatId = null; p.clip = 0;
    if (point) { p.x = point.x; p.y = point.y; p.z = point.z; p.ctx = -1; }
    p.ver++; p.dirty = true; p.lastAt = this.now();
    this.players.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: -1, yaw: p.yaw, seq: p.seq, text, boat: 'out', home: true });
  }
  home(b) { b.mode = 'slip'; b.pose = this.slipPose(b); b.returnAt = 0; }
  /** A skipper gone (the last tab closed, or deleted): the boat back to its slip. */
  forgetAccount(id) {
    const b = this.bySkipper.get(id); if (!b) return;
    this.bySkipper.delete(id); b.skipper = null; b.skipperName = '';
    this.home(b); this.ver++;
  }
  /** About five times a second: moored boats whose wait is over go home; everyone near a boat out hears of it. */
  tick(clients) {
    const now = this.now();
    for (const b of this.all.values()) if (b.mode === 'moored' && b.skipper == null && b.returnAt && now > b.returnAt) { this.home(b); this.ver++; }
    const away = [...this.all.values()].filter(b => b.mode !== 'slip');
    if (this.ver === this.sentVer && now - this.lastFull < 2000) return;
    this.sentVer = this.ver; this.lastFull = now;
    const ids = away.map(b => b.id);
    for (const ws of clients || []) {
      if (ws.readyState !== 1) continue;
      const vx = ws.view?.x, vz = ws.view?.z, me = ws.pid;
      const near = away.filter(b => b.skipper !== me && (!Number.isFinite(vx) || Math.hypot(b.pose.x - vx, b.pose.z - vz) < NEAR))
        .map(b => [b.id, b.type, b.mode === 'out' ? 1 : 0, b.pose.x, b.pose.y, b.pose.z, b.pose.h, b.pose.p, b.pose.r, b.pose.v, b.pose.l, b.skipperName]);
      ws.send(JSON.stringify({ t: 'harbour', away: ids, near }));
    }
  }
  send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  /** What a newly connected page needs (its own boat, if out: after a reload it is back at the helm). */
  stateFor(accountId) { const b = this.bySkipper.get(accountId); return b ? { t: 'bstate', ok: true, id: b.id, type: b.type, pose: b.pose, home: b.home, module: b.module, resumed: true } : null; }
}
