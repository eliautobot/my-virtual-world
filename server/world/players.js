// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The multiplayer core (PLAN WP1.10, DECISIONS C62, C118): one player per signed-in account, shared by all of its
// tabs; guests have none but see the players' characters and name tags.
// - The browser predicts its own movement and sends compact states about 10 times a second; the server checks each one
//   (speed, walls, walkable space, doors and elevators), relays what it accepts and corrects what it does not.
// - Area of interest: every browser tells the server where it is looking; players within 60 m reach it at the full rate
//   (10 a second), within 250 m at 2 a second, farther ones not at all (they are in the online list, by name).
// - Player state (position, look, camera preferences) is saved per account and restored on any device: a player appears
//   at its last valid position, otherwise at the admin's spawn point (otherwise outside the headquarters).
// - An edit that leaves a player inside a wall moves it to the nearest valid spot, with a notice.
// - Proximity chat (C118): players within 20 m in the same space (outside, or the same floor of a building) hear it,
//   by where their character stands; nothing reaches the disk, the last 10 minutes stay in memory for moderation.
// - Online status (C118): Online or Appear offline. Appearing offline hides the account from the online list, the join
//   and leave lines and friends' notices; its character stays visible to people near it. Admins see the real status.
import { PlayerNav, RUN_SPEED, PLAYER_RADIUS } from '../../shared/playernav.js';
import { encodePlayers, PF_OBSERVING, PF_USING, PF_DRIVING, PF_YOU, PF_OUT } from '../../shared/playerproto.js';
import { sanitizeAppearance, randomAppearance } from '../../shared/appearance.js';
import { floorAt } from '../../shared/constants.js';
import { toWorld } from '../../shared/geom.js';
import { Island, GroundQuery } from '../../shared/terrain.js';
import { OutdoorGround } from '../../shared/city-edge.js';
import { buildingPads } from '../../shared/island-build.js';
import { moduleDecks, deckUnder } from '../../shared/world-modules.js';
import { RNG } from '../../shared/rng.js';

export const NEAR = 60, FAR = 250, CHAT_RANGE = 20, CHAT_MAX = 280, CHAT_KEEP_MS = 10 * 60000;
const TRAVEL_MS = 10000;      // "travel here" from the map: once every 10 s
const GRACE_MS = 5000;          // a reload within this is not a leave (the character waits, then fades)
const SAVE_MS = 10000;
const MOVES_PER_S = 30;         // anything faster is dropped
const CHAT_BURST = 5, CHAT_WINDOW_MS = 10000;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export class Players {
  constructor({ dbs, world, perms, settings, now = () => Date.now(), log = null }) {
    this.dbs = dbs; this.db = dbs.db; this.w = dbs.worldId; this.world = world; this.perms = perms; this.settings = settings;
    this.now = now; this.log = log;
    this.setGround();
    this.byId = new Map();        // account id → player
    this.chatLog = [];            // the last 10 minutes of proximity chat, for moderation (never on disk)
    this.friends = null;          // set by the server (server/world/friends.js)
    this.tickN = 0;
    this.statusCache = new Map();   // account id → 'online' | 'invisible' (cleared when the account changes it)
    this.stats = { tickMs: 0, tickMaxMs: 0, bytes: 0, frames: 0, moves: 0, corrections: 0, chats: 0 };
    this.onJoin = null;           // (player, visible) after the first connection of an account
    this.onLeave = null;          // (player, visible) after its last connection closed (and the grace period passed)
    this.onOnlineChange = null;   // the online list changed (join, leave, status, name)
    this.onUse = null;            // (player) began using something where it stands (PF_USING): server/sim/agents.js playerTook
    this.q = {
      get: this.db.prepare('SELECT * FROM players WHERE world_id = ? AND account_id = ?'),
      put: this.db.prepare(`INSERT INTO players (world_id, account_id, x, y, z, ctx, yaw, look_json, cam_json, needs_json, updated)
        VALUES ($w, $id, $x, $y, $z, $ctx, $yaw, $look, $cam, $needs, $t)
        ON CONFLICT (world_id, account_id) DO UPDATE SET x = $x, y = $y, z = $z, ctx = $ctx, yaw = $yaw, look_json = $look, cam_json = $cam,
        needs_json = $needs, updated = $t`),
      del: this.db.prepare('DELETE FROM players WHERE world_id = ? AND account_id = ?'),
    };
  }
  // ---------------------------------------------------------------- where a player starts
  spawnPoint() {
    let s = null;
    try { const raw = this.settings.get('players.spawn'); s = raw ? JSON.parse(raw) : null; } catch { s = null; }
    if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) { const v = this.nav.openGround(s.x, s.z); if (v) return v; }
    return this.nav.defaultSpawn();
  }
  /** The top of a dock's deck that feet at y stand on at (x, z), or null (the decks kept until the modules change). */
  deckAt(x, z, y) {
    const W = this.world;
    if (!this._decks || this._decksOf !== W.worldModules) { this._decksOf = W.worldModules; this._decks = moduleDecks(W); }
    return this._decks.length ? deckUnder(this._decks, x, z, y, 0.5) : null;
  }
  /** How high feet at y stand above the ground or floor at (x, z) (0 when unknown). */
  upOf(x, y, z, ctx) { try { const g = this.groundY(x, z, ctx); return Number.isFinite(y) && Number.isFinite(g) ? y - g : 0; } catch { return 0; } }
  groundY(x, z, ctx) {
    if (ctx >= 0) return floorAt(this.world.buildings[ctx >> 6], ctx & 63);
    return this.outdoor.height(x, z);
  }
  load(account) {
    const r = this.q.get.get(this.w, account.id);
    let pos = null, look = null, cam = null, needs = {};
    if (r) {
      if (this.nav.ok(r.x, r.z, r.ctx, this.upOf(r.x, r.y, r.z, r.ctx))) pos = { x: r.x, z: r.z, ctx: r.ctx, yaw: r.yaw };
      try { look = r.look_json ? sanitizeAppearance(JSON.parse(r.look_json)) : null; } catch { look = null; }
      try { cam = r.cam_json ? JSON.parse(r.cam_json) : null; } catch { cam = null; }
      try { needs = r.needs_json ? JSON.parse(r.needs_json) || {} : {}; } catch { needs = {}; }
    }
    if (!pos) { const s = this.spawnPoint(); pos = { x: s.x, z: s.z, ctx: s.ctx, yaw: 0 }; }
    if (!look) look = sanitizeAppearance(randomAppearance(new RNG(`player:${this.w}:${account.id}`)));
    return {
      id: account.id, name: account.displayName, x: pos.x, y: this.groundY(pos.x, pos.z, pos.ctx), z: pos.z, ctx: pos.ctx, yaw: pos.yaw || 0,
      clip: 0, flags: PF_OBSERVING, seq: 0, ver: 1, lookVer: 1, look, cam, needs,
      conns: new Set(), lastAt: this.now(), movesAt: [], lastCorr: 0, goneTimer: null, dirty: !r, fresh: !r, chatAt: [], joinedAt: this.now(),
    };
  }
  save(p) {
    if (this.closed) return;
    this.q.put.run({ w: this.w, id: p.id, x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, look: JSON.stringify(p.look),
      cam: p.cam ? JSON.stringify(p.cam) : null, needs: JSON.stringify(p.needs || {}), t: this.now() });
    p.dirty = false;
  }
  saveAll() {
    for (const p of this.byId.values()) if (p.dirty) { try { this.save(p); } catch (e) { this.log?.error('[players] save failed', e.message); } }
  }
  /**
   * Shutdown: everyone's place is saved now and nothing is written after — the database closes next, and the live
   * streams the shutdown closes report their close afterwards (each would save its player into a closed database:
   * "statement has been finalized" in the log at every restart).
   */
  close() {
    this.saveAll();
    this.closed = true;
    for (const p of this.byId.values()) if (p.goneTimer) { clearTimeout(p.goneTimer); p.goneTimer = null; }
  }
  // ---------------------------------------------------------------- connections
  canPlay(ws) { return !!(ws.P && ws.P.account && !ws.P.restricted && this.perms.allowed(ws.P, 'players.move')); }
  /** A live connection opened (or its session changed). Returns the player, or null for guests. */
  attach(ws) {
    if (!this.canPlay(ws)) return null;
    const a = ws.P.account;
    let p = this.byId.get(a.id), first = false;
    if (!p) { p = this.load(a); this.byId.set(a.id, p); first = true; }
    if (p.goneTimer) { clearTimeout(p.goneTimer); p.goneTimer = null; }
    p.name = a.displayName;
    p.conns.add(ws);
    ws.pid = a.id;
    ws.aoi ||= new Map();
    this.send(ws, { t: 'you', pid: p.id, x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, look: p.look, cam: p.cam, status: this.statusOf(p.id), fresh: p.fresh });
    p.fresh = false;
    if (first) { this.onJoin?.(p, this.statusOf(p.id) === 'online'); this.onOnlineChange?.(); }
    return p;
  }
  detach(ws) {
    const id = ws.pid;
    ws.pid = null;
    if (id === null || id === undefined) return;
    const p = this.byId.get(id);
    if (!p) return;
    p.conns.delete(ws);
    if (p.conns.size || p.goneTimer || this.closed) return;
    try { this.save(p); } catch (e) { this.log?.error('[players] save failed', e.message); }
    p.goneTimer = setTimeout(() => this.remove(p), GRACE_MS);
    p.goneTimer.unref?.();
  }
  remove(p) {
    if (this.byId.get(p.id) !== p) return;
    if (p.conns.size) { p.goneTimer = null; return; }
    if (p.vehicleId && !this.vehicles?.closePlayer(p)) {
      p.goneTimer = setTimeout(() => this.remove(p), 500); p.goneTimer.unref?.(); return;
    }
    if (p.aircraftId) this.fleet?.forgetAccount?.(p.id);   // a pilot gone: the aircraft stays where it landed, or goes home
    if (p.boatId) this.harbour?.forgetAccount?.(p.id);   // a skipper gone: the boat back to its slip
    if (p.dirty) { try { this.save(p); } catch { /* logged on the next save */ } }
    this.byId.delete(p.id);   // every browser that saw it gets PF_OUT on the next tick, and the character fades
    this.onLeave?.(p, this.statusOf(p.id) === 'online');
    this.onOnlineChange?.();
  }
  /** A deleted account: its player leaves at once and its saved state goes. */
  forgetAccount(id) {
    this.vehicles?.forgetAccount?.(id);
    this.play?.forgetAccount?.(id);   // its play modules' progress, badges and profile (server/play/play.js)
    this.fleet?.forgetAccount?.(id);   // an aircraft it was flying
    this.harbour?.forgetAccount?.(id);   // a boat it had out
    const p = this.byId.get(id);
    if (p) {
      for (const ws of p.conns) ws.pid = null;
      p.conns.clear();
      if (p.goneTimer) clearTimeout(p.goneTimer);
      this.byId.delete(id);
      this.onOnlineChange?.();
    }
    this.q.del.run(this.w, id);
  }
  send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  toAccount(id, obj) {
    const p = this.byId.get(id);
    if (!p) return;
    const s = JSON.stringify(obj);
    for (const ws of p.conns) if (ws.readyState === 1) ws.send(s);
  }
  // ---------------------------------------------------------------- movement
  correct(p, ws, now, why) {
    this.stats.corrections++;
    if (now - p.lastCorr < 250) return;   // one correction a quarter second is enough to put the browser back
    p.lastCorr = now;
    this.send(ws, { t: 'pcorr', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, why });
  }
  /** Why a move from p's accepted state to (x, z, ctx) is impossible, or null when it is fine. */
  refuse(p, x, z, ctx, flags, dt, up = 0) {
    const nav = this.nav;
    if (!Number.isInteger(ctx) || ctx < -1 || ctx > 64 * 65536) return 'bad_place';
    const using = (flags & PF_USING) !== 0;
    if (ctx !== p.ctx) {
      const Bn = nav.building(ctx), Bo = nav.building(p.ctx);
      if (p.ctx < 0 && ctx >= 0) {   // in through a door
        if (!Bn || (ctx & 63) !== 0 || !nav.nearDoor(Bn, x, z) || !nav.nearDoor(Bn, p.x, p.z, 4)) return 'no_door';
      } else if (p.ctx >= 0 && ctx < 0) {   // out through the door
        const B = this.world.buildings[p.ctx >> 6];
        if (B && !B.gone && (p.ctx & 63) === 0 && !(nav.nearDoor(B, x, z) && nav.nearDoor(B, p.x, p.z, 4))) return 'no_door';
      } else {   // another floor: the same building, by its elevator
        if (!Bn || !Bo || Bn !== Bo || !nav.nearElevator(Bn, x, z) || !nav.nearElevator(Bo, p.x, p.z, 3.5)) return 'no_elevator';
        return nav.ok(x, z, ctx, up) || using ? null : 'blocked';
      }
    }
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > RUN_SPEED * 1.35 * dt + 0.6) return 'too_fast';
    if (ctx < 0 && this.vehicles?.blockedMove(p, x, z)) return 'vehicle';
    if (using) return null;   // seated: the body sits on the furniture, off the walkable grid
    if (!nav.ok(x, z, ctx, up)) return 'blocked';   // up > 0: on top of furniture or decorations (jumping, standable.js)
    if (ctx >= 0 && ctx === p.ctx && nav.wallCrossed(ctx, p.x, p.z, x, z)) return 'wall';
    return null;
  }
  move(ws, m) {
    const p = ws.pid !== null && ws.pid !== undefined ? this.byId.get(ws.pid) : null;
    if (!p) return;
    if (p.vehicleId || p.aircraftId || p.boatId) return;   // confirmed driver moves come only from the vehicle solver (a pilot's from the aircraft, a skipper's from the boat), never pmove flags/poses
    const now = this.now();
    p.movesAt = p.movesAt.filter(t => now - t < 1000);
    if (p.movesAt.length >= MOVES_PER_S) return;
    p.movesAt.push(now);
    const x = num(m.x), z = num(m.z), yaw = num(m.yaw), ctx = Number.isInteger(m.ctx) ? m.ctx : NaN;
    const flags = (m.flags | 0) & (PF_OBSERVING | PF_USING);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isInteger(ctx)) return this.correct(p, ws, now, 'bad_state');
    const dt = Math.min(1.5, Math.max(0.05, (now - p.lastAt) / 1000));
    let g = NaN; const y = num(m.y);
    try { if (ctx >= -1) g = this.groundY(x, z, ctx); } catch { g = NaN; }
    const under = ctx < 0 && this.ground && Number.isFinite(y) ? this.ground.under(x, z, y) : null;   // beneath a bridge
    if (under) g = under.h;
    const deck = ctx < 0 && Number.isFinite(y) ? this.deckAt(x, z, y) : null;   // on a dock's deck over the water
    if (deck !== null) g = deck;
    const why = this.refuse(p, x, z, ctx, flags, dt, Number.isFinite(g) && Number.isFinite(y) ? Math.min(2.4, y - g) : 0);
    if (why) return this.correct(p, ws, now, why);
    p.x = x; p.z = z; p.ctx = ctx;
    const wet = deck !== null ? null : under ? under.water : ctx < 0 && this.ground ? this.ground.water(x, z) : null;   // swimming: on the surface, or diving to the bottom
    p.y = Number.isFinite(y) ? Math.min(Math.max(g, wet ? wet.level : g) + 2.4, Math.max(g - (wet ? 0.8 : 0.2), y)) : g;   // a jump from a counter top
    if (Number.isFinite(yaw)) p.yaw = yaw;
    const took = (flags & PF_USING) && !(p.flags & PF_USING);
    p.clip = (m.clip | 0) & 127; p.flags = flags;   // (a clip of render/anim.js CLIP_NAMES: 128 at most)
    if (took) try { this.onUse?.(p); } catch { /* the sim's own business */ }   // (sat down, or started playing: the sim gives that place to nobody else)
    p.seq = (m.seq | 0) & 65535; p.lastAt = now; p.ver++; p.dirty = true;
    this.stats.moves++;
  }
  /** Play mode began or ended: the character walks, or waits where it is with an "observing" marker. */
  observe(ws, on) {
    const p = this.byId.get(ws.pid);
    if (!p) return;
    if (p.vehicleId && on) { this.vehicles?.requestStop?.(p.vehicleId, ws); return; }
    if (p.aircraftId || p.boatId) return;   // flying, or out in a boat: the cockpit or the helm stays the player's place
    const f = on ? (p.flags | PF_OBSERVING) & ~PF_USING : p.flags & ~PF_OBSERVING;
    if (f !== p.flags) { p.flags = f; p.ver++; }
    if (!on) p.lastAt = this.now();
    this.onOnlineChange?.();
  }
  /** Admins (players.warp) may put their own player anywhere valid: testing, and helping someone in person. */
  warp(ws, m) {
    const p = this.byId.get(ws.pid);
    if (!p) return;
    if (p.vehicleId || p.aircraftId || p.boatId) return this.correct(p, ws, this.now(), 'exit_vehicle_first');
    const x = num(m.x), z = num(m.z), ctx = Number.isInteger(m.ctx) ? m.ctx : -1;
    const v = this.nav.ok(x, z, ctx) ? { x, z, ctx } : Number.isFinite(x) && Number.isFinite(z) ? this.nav.nearestValid(x, z, ctx) : null;
    if (!v) return this.correct(p, ws, this.now(), 'blocked');
    p.x = v.x; p.z = v.z; p.ctx = v.ctx; p.y = this.groundY(v.x, v.z, v.ctx);
    if (Number.isFinite(num(m.yaw))) p.yaw = num(m.yaw);
    p.seq = (m.seq | 0) & 65535; p.lastAt = this.now(); p.ver++; p.dirty = true;
    if (v.x !== x || v.z !== z || v.ctx !== ctx) this.send(ws, { t: 'pcorr', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, why: 'nearest' });
  }
  /** Where "Go home" takes account id: inside a flat it bought or rents, else outside a building on a lot it holds
   *  (lotsOf, set by the server: the lots an account holds), else the spawn point. { x, z, ctx, where }. */
  homeFor(id) {
    const W = this.world, me = String(id), mine = w => w && w.kind === 'account' && String(w.id) === me;
    const flats = Object.entries(W.flats || {}).filter(([, r]) => mine(r.owner) || r.tenants?.some(mine));
    flats.sort(([, a], [, b]) => Number(mine(b.owner)) - Number(mine(a.owner)));   // a flat it owns before one it rents
    for (const [key] of flats) {
      const [b, f, u] = key.split(':').map(Number), B = W.buildings[b];
      const U = B && !B.gone && f < B.floors ? W.levels[B.lv[f]]?.units?.[u] : null;
      if (!U) continue;
      const c = toWorld(B, (U.x0 + U.x1) / 2, (U.z0 + U.z1) / 2), v = this.nav.nearestValid(c.x, c.z, b * 64 + f);
      if (v && v.ctx >= 0) return { ...v, where: `flat ${u + 1}, ${B.name}` };
    }
    const lots = new Set((this.lotsOf?.(id) || []).map(l => String(l.id)));
    if (lots.size) for (const B of W.buildings) {
      if (!B || B.gone || !B.door || !lots.has(String(B.lot))) continue;
      const d = toWorld(B, B.door.x, B.d / 2 + 1.6), v = this.nav.openGround(d.x, d.z);
      if (v) return { ...v, where: B.name };
    }
    return { ...this.spawnPoint(), where: null };
  }
  /** "Go home" (any player): straight to homeFor, told with pmoved; refused while driving. */
  goHome(ws) {
    const p = this.byId.get(ws.pid), now = this.now();
    if (!p || now - (p.homeAt || 0) < 1500) return;   // one trip home a second and a half is plenty
    p.homeAt = now;
    if (p.vehicleId || p.aircraftId || p.boatId) return this.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, text: 'Leave the vehicle first' });
    const h = this.homeFor(p.id);
    p.x = h.x; p.z = h.z; p.ctx = h.ctx; p.y = this.groundY(h.x, h.z, h.ctx);
    p.lastAt = this.now(); p.ver++; p.dirty = true;
    this.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, home: true,
      text: h.where ? `🏠 Home: ${h.where}` : "🏠 You have no home yet, so you're at the starting point" });
  }
  /** The map (ui/worldmap.js): where this account's home is — { t: 'phomeat', x, z, ctx, where } (where: null when it has
   *  none and the starting point stands in). */
  homeAt(ws) {
    const p = this.byId.get(ws.pid);
    if (!p) return;
    const h = this.homeFor(p.id);
    this.send(ws, { t: 'phomeat', x: h.x, z: h.z, ctx: h.ctx, where: h.where });
  }
  /** "Travel here" from the map (2026-10-05, GTA-like): to dry open ground at or near (x, z) on the island, any
   *  player, once every TRAVEL_MS; never while driving, never into a building (they're walked into by their doors). */
  travel(ws, m) {
    const p = this.byId.get(ws.pid), now = this.now();
    if (!p) return;
    const x = num(m.x), z = num(m.z);
    const no = text => this.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, travel: true, text });
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (p.vehicleId || p.aircraftId || p.boatId) return no('Leave the vehicle first');
    if (now - (p.travelAt || 0) < TRAVEL_MS) return no(`You can travel again in ${Math.ceil((TRAVEL_MS - (now - p.travelAt)) / 1000)} s`);
    const v = this.nav.openGround(x, z);
    if (!v) return no('There is nowhere to stand there');
    p.travelAt = now;
    p.x = v.x; p.z = v.z; p.ctx = -1; p.y = this.groundY(v.x, v.z, -1);
    p.lastAt = now; p.ver++; p.dirty = true;
    this.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq, home: true, travel: true, text: '📍 You travelled there' });
  }
  setLook(ws, m) {
    const p = this.byId.get(ws.pid);
    if (!p || !m || typeof m.app !== 'object' || !m.app) return;
    p.look = sanitizeAppearance(m.app, p.look);
    p.lookVer++; p.dirty = true;
  }
  setCam(ws, m) {
    const p = this.byId.get(ws.pid);
    if (!p || !m) return;
    const dist = num(m.dist), pitch = num(m.pitch);
    if (!Number.isFinite(dist) || !Number.isFinite(pitch)) return;
    p.cam = { dist: Math.round(Math.min(60, Math.max(2, dist)) * 100) / 100, pitch: Math.round(Math.min(1.5, Math.max(0.1, pitch)) * 1000) / 1000 };
    p.dirty = true;
  }
  /** Where a browser is looking (its camera's target): the centre of its area of interest. */
  view(ws, m) {
    const x = num(m.x), z = num(m.z);
    if (Number.isFinite(x) && Number.isFinite(z)) ws.view = { x, z };
  }
  /** On an island (WP4.2) players walk its dry land; heights come from the same functions the browsers use
   *  (shared/city-edge.js: the city, its apron, then the terrain with its roads). Rebuilt when the island or its roads change. */
  setGround() {
    const w = this.world;
    const pads = buildingPads(w), padsKey = JSON.stringify(pads);
    if (this.nav && this.groundFor === w.terrain && this.roadsFor === w.roads && this.padsKey === padsKey) return false;
    this.groundFor = w.terrain; this.roadsFor = w.roads; this.padsKey = padsKey;
    this.ground = w.terrain ? new GroundQuery(new Island(w.terrain, { roads: w.roads || null, pads }), { maxChunks: 512 }) : null;
    this.nav = new PlayerNav(w, { ground: this.ground });
    this.outdoor = new OutdoorGround(this.nav.g, w.roads || null, this.ground);
    return true;
  }
  /** After a world edit: players left inside a wall or on a floor that went move to the nearest valid spot. */
  worldChanged() {
    if (!this.setGround()) this.nav.rebuild();
    for (const p of this.byId.values()) {
      if (p.vehicleId || p.aircraftId || p.boatId || this.nav.ok(p.x, p.z, p.ctx, this.upOf(p.x, p.y, p.z, p.ctx))) continue;
      const v = this.nav.nearestValid(p.x, p.z, p.ctx) || this.spawnPoint();
      p.x = v.x; p.z = v.z; p.ctx = v.ctx; p.y = this.groundY(v.x, v.z, v.ctx);
      p.ver++; p.dirty = true; p.lastAt = this.now();
      this.toAccount(p.id, { t: 'pmoved', x: p.x, y: p.y, z: p.z, ctx: p.ctx, yaw: p.yaw, seq: p.seq,
        text: 'The place you were standing changed, so you were moved to the nearest free spot' });
    }
  }
  // ---------------------------------------------------------------- the stream (area of interest)
  /** Called 10 times a second: each browser gets the players in its area of interest that changed. */
  tick(clients) {
    const t0 = performance.now(), n = ++this.tickN, now = this.now();
    for (const ws of clients) {
      if (ws.readyState !== 1 || !ws.P || !this.perms.allowed(ws.P, 'world.view')) continue;
      const me = ws.pid !== null && ws.pid !== undefined ? this.byId.get(ws.pid) : null;
      const c = ws.view || (me ? { x: me.x, z: me.z } : null);
      ws.aoi ||= new Map();
      const out = [];
      for (const [pid, e] of ws.aoi) {
        if (!this.byId.has(pid)) { out.push({ pid, x: 0, y: 0, z: 0, yaw: 0, ctx: -1, clip: 0, flags: PF_OUT, seq: 0 }); ws.aoi.delete(pid); }
        else e.keep = false;
      }
      if (c) {
        for (const p of this.byId.values()) {
          const d = p.id === ws.pid ? 0 : Math.hypot(p.x - c.x, p.z - c.z);
          const tier = d < NEAR ? 0 : d < FAR ? 1 : 2;
          const e = ws.aoi.get(p.id);
          if (tier === 2) {
            if (e) { out.push({ pid: p.id, x: 0, y: 0, z: 0, yaw: 0, ctx: -1, clip: 0, flags: PF_OUT, seq: 0 }); ws.aoi.delete(p.id); }
            continue;
          }
          if (!e || e.look !== p.lookVer) {
            this.send(ws, { t: 'pinfo', pid: p.id, name: p.name, app: p.look, you: p.id === ws.pid });
          }
          const due = !e || e.ver !== p.ver && (tier === 0 || n - e.at >= 5) || (e && e.tier !== tier);
          if (due) {
            out.push({ pid: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ctx: p.ctx, clip: p.clip, flags: p.flags | (p.id === ws.pid ? PF_YOU : 0), seq: p.seq });
            ws.aoi.set(p.id, { ver: p.ver, at: n, tier, look: p.lookVer });
          } else if (e && e.look !== p.lookVer) e.look = p.lookVer;
        }
      }
      if (out.length) {
        const buf = encodePlayers(out, now);
        ws.send(buf);
        ws.playerBytes = (ws.playerBytes || 0) + buf.byteLength;
        this.stats.bytes += buf.byteLength; this.stats.frames++;
      }
    }
    if (n % (SAVE_MS / 100) === 0) this.saveAll();
    const ms = performance.now() - t0;
    this.stats.tickMs = this.stats.tickMs * 0.95 + ms * 0.05;
    this.stats.tickMaxMs = Math.max(this.stats.tickMaxMs * 0.999, ms);
  }
  // ---------------------------------------------------------------- proximity chat
  say(ws, m) {
    const p = ws.pid !== null && ws.pid !== undefined ? this.byId.get(ws.pid) : null;
    if (!p) return this.send(ws, { t: 'chat_refused', why: 'Sign in to chat with people near you' });
    if (!this.settings.get('chat.proximity')) return this.send(ws, { t: 'chat_refused', why: 'Proximity chat is turned off on this server' });
    const text = typeof m.text === 'string' ? m.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!text) return;
    if (text.length > CHAT_MAX) return this.send(ws, { t: 'chat_refused', why: `Keep it under ${CHAT_MAX} characters` });
    const now = this.now();
    p.chatAt = p.chatAt.filter(t => now - t < CHAT_WINDOW_MS);
    if (p.chatAt.length >= CHAT_BURST) return this.send(ws, { t: 'chat_refused', why: 'Slow down a little: a few messages at a time' });
    p.chatAt.push(now);
    const msg = JSON.stringify({ t: 'chat', pid: p.id, name: p.name, text, at: now, ctx: p.ctx });
    let heard = 0;
    for (const q of this.byId.values()) {
      if (q.ctx !== p.ctx || Math.hypot(q.x - p.x, q.z - p.z) > CHAT_RANGE) continue;
      if (q !== p) heard++;
      for (const c of q.conns) if (c.readyState === 1) c.send(msg);
    }
    this.chatLog.push({ at: now, pid: p.id, name: p.name, text, x: p.x, z: p.z, ctx: p.ctx, heard });
    while (this.chatLog.length && now - this.chatLog[0].at > CHAT_KEEP_MS) this.chatLog.shift();
    this.stats.chats++;
  }
  // ---------------------------------------------------------------- online status and the online list
  statusOf(id) {
    let s = this.statusCache.get(id);
    if (s) return s;
    try { s = this.settings.accountValue(id, 'social.status') === 'invisible' ? 'invisible' : 'online'; } catch { s = 'online'; }
    this.statusCache.set(id, s);
    return s;
  }
  /** The account changed its status: the online list and its friends hear at once. Returns [before, after]. */
  statusChanged(id) {
    const before = this.statusCache.get(id) || null;
    this.statusCache.delete(id);
    const after = this.statusOf(id);
    this.onOnlineChange?.();
    return [before, after];
  }
  /** The account's display name changed: its tag and the lists follow. */
  rename(id, name) {
    const p = this.byId.get(id);
    if (!p || p.name === name) return;
    p.name = name; p.lookVer++;
    this.onOnlineChange?.();
  }
  placeOf(p) {
    if (p.ctx < 0) return { outside: true, x: Math.round(p.x), z: Math.round(p.z) };
    const B = this.world.buildings[p.ctx >> 6];
    return B ? { b: B.idx, f: p.ctx & 63, name: B.name, x: Math.round(p.x), z: Math.round(p.z) } : { outside: true, x: Math.round(p.x), z: Math.round(p.z) };
  }
  /** The online list as one signed-in account sees it: friends first, then by name. Appearing offline hides an account
   *  from everyone but itself and admins (who see it marked). */
  onlineFor(P) {
    const me = P && P.account ? P.account.id : null, admin = this.perms.allowed(P, 'players.see_invisible');
    const friendIds = me !== null && this.friends ? this.friends.friendIds(me) : new Set();
    const list = [];
    for (const p of this.byId.values()) {
      const invisible = this.statusOf(p.id) === 'invisible';
      if (invisible && p.id !== me && !admin) continue;
      list.push({ pid: p.id, name: p.name, you: p.id === me, friend: friendIds.has(p.id), invisible, observing: (p.flags & PF_OBSERVING) !== 0, where: this.placeOf(p) });
    }
    list.sort((a, b) => (b.you - a.you) || (b.friend - a.friend) || a.name.localeCompare(b.name));
    return list;
  }
  /** Whether others see this account as online (for friends' lists and notices). */
  visibleOnline(id) { return this.byId.has(id) && this.statusOf(id) === 'online'; }
}
