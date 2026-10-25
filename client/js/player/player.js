// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play mode: walk the city as your own character. WASD / arrows (relative to the camera), Shift to run, Space to
// jump, E to talk / sit / use things / take the elevator, Z/X/C emotes. Collides with buildings, street furniture,
// subway kiosks, park hedges and furniture (the same nav grid the simulation uses); walks in and out through front
// doors and rides elevators. The character is drawn by the shared instanced renderer (agents.extra).
// Zooming on in past the nearest distance goes into first person (render/camera.js): the camera at the eyes, the body
// facing the way it looks and hidden from its own camera, inside a building full-height walls and a ceiling.
import { moduleBoxes, aircraftSolids, moduleDecks, moduleLadders, deckUnder } from '/shared/world-modules.js';
import { S, bus, setFocus, bld, select, selectBuilding } from '../core/state.js';
import { post } from '../core/net.js';
import { h, esc, clamp, angDiff, isTouch } from '../core/util.js';
import { GROUND_Y, WALL_T, floorAt, ctxOf } from '/shared/constants.js';
import { toWorld, toLocal, bRot, footprint, inFootprint, inItemRect } from '/shared/geom.js';
import { blockAt } from '/shared/city.js';
import { CATALOG, USES } from '/shared/catalog.js';
import { PROP } from '/shared/anims.js';
import { mayEnter } from '../ui/flats.js';
import { buildGrid, walkable, nearestFree, cellCenter, nearWall, wallBetween, furnitureOnly } from '/shared/navgrid.js';
import { STEP, GRAVITY, JUMP_V, topUnder, tallUnder, PARK_EDGE, parkEdgeTop } from '/shared/standable.js';
import { bridgePiers } from '/shared/island-roads.js';
import { airPhase, landPhase, hipLift, LAND_T } from './jump-pose.js';
import { elevatorStops } from '/shared/building.js';
import { interiorBounds } from '/shared/edit.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE, SEATED_CLIPS } from '../render/anim.js';
import { PLAYER_APP } from '../render/agents.js';
import { GU } from '../render/scene.js';
import { loadLook, saveLook } from '../ui/customizer.js';
import { auth } from '../core/auth.js';
import { PF_OBSERVING, PF_USING } from '/shared/playerproto.js';
import { PlayerNav, pushApart, RUN_SPEED } from '/shared/playernav.js';
import { vehicleChaseCamera } from '/shared/vehicle-camera.js';
import { OutdoorGround } from '/shared/city-edge.js';
// The car pose is already smoothed by interpolation, so the chase camera tracks it tighter than the walking camera.
const DRIVE_CAM_RATES = { follow: 18, turn: 14 };

const R = 0.26, WALK = 1.55, RUN = RUN_SPEED, SUB = 0.12, NONE = [];   // (the server holds players to RUN_SPEED)
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const EAT_CODES = new Set([...MOVE_CODES, 'PageUp', 'PageDown', 'BracketLeft', 'BracketRight', 'KeyF', 'KeyT', 'KeyG', 'KeyQ']);
const _l = {}, _eye = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowS = () => performance.now() / 1000;

let app, cam, agents, inter, g;
let hash = null, B0 = null, promptT = 0, busy = false, runToggle = false, saved = null, driveCam = null, handbrakeToggle = false;
// The shared world (WP1.10): moves go to the server about 10 times a second; it corrects impossible ones.
const NET = { seq: 0, at: 0, last: '', beatAt: 0 };
let pnav = null;   // doorways, for the soft push (rebuilt after an edit)
const grids = new Map(), keys = new Set(), joy = { on: false, id: -1, x: 0, y: 0 }, E = {};
const P = {
  active: false, x: 0, y: GROUND_Y, z: 0, yaw: 0, tyaw: 0, ctx: -1, vx: 0, vz: 0, speed: 0, dist: 0,
  state: 'walk', slot: null, emote: null, jumpT: -9, landT: -9, vy: 0, air: false, tween: null, elev: null, target: null,
  clip: CLIP.idle, ph: 0, pclip: CLIP.idle, pph: 0, fadeT: -9, useClip: CLIP.idle, useProp: 0, look: null, extra: null,
};

class Hash {
  constructor(c) { this.c = c; this.m = new Map(); }
  key(i, j) { return (i + 2048) * 8192 + (j + 2048); }
  add(x0, z0, x1, z1, v) {
    const c = this.c;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = this.key(i, j); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(v);
    }
  }
  query(x, z) { return this.m.get(this.key(Math.floor(x / this.c), Math.floor(z / this.c))) || NONE; }
}

export function init(a) {
  app = a; cam = a.cam; agents = a.agents; inter = a.inter; g = S.grid;
  // The walkable area: the island (WP4.2) when the world has one, otherwise the city and its edge.
  B0 = app.terrain ? app.terrain.bounds() : { x0: g.minX - 40, x1: g.maxX + 40, z0: g.minZ - 40, z1: g.maxZ + 40 };
  P.look = loadLook();
  agents.setAppearance(PLAYER_APP, P.look.app);
  P.extra = { x: 0, y: 0, z: 0, yaw: 0, clip: CLIP.idle, ph: 0, pclip: CLIP.idle, pph: 0, w: 0, app: PLAYER_APP, prop: 0, flags: 0 };
  P.setLook = look => {
    P.look = look; agents.setAppearance(PLAYER_APP, look.app); if (E.pn) E.pn.textContent = look.name;
    if (networked()) app.net.send({ t: 'plook', app: look.app });   // saved with the account (I14.12)
  };
  P.warp = warp;
  P.drivingInput = () => {
    const el = document.activeElement, blocked = app.custOpen || busy || ['INPUT','TEXTAREA','SELECT'].includes(el?.tagName) || el?.isContentEditable;
    if (blocked) return { throttle: 0, steer: 0, brake: 1, handbrake: false };
    return { throttle: clamp(Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) - (joy.on ? joy.y : 0), -1, 1),
      steer: clamp(Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight')) - (joy.on ? joy.x : 0), -1, 1),
      brake: 0, boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle, handbrake: keys.has('Space') || handbrakeToggle };   // Shift boosts (S brakes)
  };
  P.onVehicleEnter = (o = {}) => {   // a car, or an aircraft (player/flight.js: o.keys, its own help)
    if (!P.active) return;
    cam.setFP(false);   // first person is on foot only (its angle back before the walking camera is kept)
    driveCam ||= { dist: cam.goalDist, pitch: cam.goalPitch, yaw: cam.goalYaw, fov: app.stage.camera.fov, minDist: cam.minDist };
    P.state = 'drive'; P.slot = null; P.emote = null; P.tween = null; P.vx = P.vz = 0;
    if (E.prompt) { E.prompt.classList.add('hidden'); E.prompt._h = null; }   // (the prompt that offered it)
    runToggle = handbrakeToggle = false; keys.clear(); joy.x = joy.y = 0;
    const i = agents.extra.indexOf(P.extra); if (i >= 0) agents.extra.splice(i, 1);
    app.stage.camera.fov = 62; cam.rates = DRIVE_CAM_RATES; refreshVehicleHud();
    app.toast(o.keys || 'W/S throttle, brake & reverse · A/D steer · Shift boost (from a stop: burnout) · Space handbrake · E exit when stopped', 'good', 6000);
  };
  P.onVehicleExit = point => {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.z)) { P.x = point.x; P.y = point.y; P.z = point.z; P.ctx = -1; }
    P.state = 'walk'; P.vx = P.vz = 0; P.tween = null; runToggle = handbrakeToggle = false; keys.clear(); cam.rates = null;
    if (driveCam) { cam.goalDist = driveCam.dist; cam.goalPitch = driveCam.pitch; app.stage.camera.fov = driveCam.fov; cam.minDist = driveCam.minDist; driveCam = null; }
    cam.follow = () => ({ x: P.x, y: P.y + 1.1, z: P.z });
    if (P.active && !agents.extra.includes(P.extra)) agents.extra.push(P.extra);
    NET.last = ''; promptT = 0; if (E.prompt) E.prompt._h = null; refreshVehicleHud();
  };
  P.refreshVehicleHud = refreshVehicleHud;
  app.player = P;
  buildHud(document.getElementById('ui'));
  rebuildHash();
  app.hooks.key.push(onKey);
  const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  // Driving input leaves the moment the held-key set changes, not on the next frame.
  window.addEventListener('keydown', e => { if (!typing(e) && !e.ctrlKey && !e.metaKey) { keys.add(e.code); if (P.state === 'drive') app.driving?.sendInput(); } });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (P.state === 'drive') app.driving?.sendInput(); });
  window.addEventListener('blur', () => keys.clear());
  bus.on('mode', (m, prev) => { if (m === 'play') enter(); else if (prev === 'play') leave(); });
  bus.on('world', ev => { grids.clear(); pnav = null; if (ev && ev.blds && ev.blds.size) { rebuildHash(); checkGone(); } });
  bus.on('decor', () => rebuildHash());
  bus.on('stations', () => rebuildHash());
  bus.on('wmods', () => rebuildHash());   // a world module placed, moved or removed: its buildings and aircraft
  bus.on('aircraft', () => rebuildHash());   // an aircraft left its stand or came back (render/airport.js)
  bus.on('preframe', (dt, now) => { if (P.active) update(dt, now / 1000); });
  // The server's view of this account's player: its saved look (a brand-new player uploads the one this browser had).
  bus.on('player:you', me => {
    if (me.fresh || !me.look) { if (networked()) app.net.send({ t: 'plook', app: P.look.app }); return; }
    P.look = { name: P.look.name, app: me.look };
    agents.setAppearance(PLAYER_APP, me.look);
    saveLook(P.look);
    if (P.active) app.net.send({ t: 'pobserve', on: false });   // reconnected while playing
  });
  bus.on('msg:pcorr', m => correct(m, false));
  bus.on('msg:pmoved', m => correct(m, true));
}
/** Other players push this one apart softly (I14.10): never in a doorway or at an elevator, and never harder than a
 *  walk, so nobody can block anyone. Only the own player moves; each page pushes its own. */
function softPush(dt) {
  const R = app.remote;
  if (!R || !R.byPid.size) return;
  const near = [];
  for (const r of R.byPid.values()) {
    if (r.you || r.gone || r.ctx !== P.ctx) continue;
    if (Math.abs(r.extra.x - P.x) < 1 && Math.abs(r.extra.z - P.z) < 1) near.push([r.extra.x, r.extra.z]);
  }
  if (!near.length) return;
  pnav ||= new PlayerNav(S.world);
  if (pnav.inDoorway(P.x, P.z, P.ctx)) return;
  const v = pushApart(P.x, P.z, near, dt);
  if (v.dx || v.dz) moveBy(v.dx, v.dz);
}
/** Whether this page's player is in the shared world (a signed-in account whose player the server has sent). */
function networked() { return !!(auth.account && app.remote && app.remote.me && app.net.connected); }
/** The server refused a move (or an edit moved the player): take its position. */
function correct(m, notice) {
  if (app.remote && app.remote.me) Object.assign(app.remote.me, { x: m.x, y: m.y, z: m.z, ctx: m.ctx });
  if (notice) app.toast(m.text || 'You were moved to a free spot', m.home ? 'good' : 'bad', 4500);
  if (homeT) { clearTimeout(homeT); homeT = 0; setTimeout(() => { E.fade.classList.remove('on'); busy = false; }, 200); }
  if (!P.active) return;
  P.x = m.x; P.z = m.z; P.ctx = m.ctx; P.y = groundY(); P.vx = P.vz = 0; P.tween = null; P.air = false; P.vy = 0;
  if (Number.isFinite(m.y) && m.y > P.y) P.y = supportY(m.y + 0.05);   // standing on something
  if (P.state === 'use') { P.state = 'walk'; P.slot = null; }
  if (P.ctx >= 0) setFocus(P.ctx >> 6, P.ctx & 63); else if (S.focus.b >= 0) setFocus(-1);
  if (m.home) { P.state = 'walk'; P.slot = null; P.emote = null; cam.target.set(P.x, P.y + 1.1, P.z); cam.goal.copy(cam.target); }
  NET.last = '';
}
/** "Go home" (the play bar): the server chooses the place (players.js homeFor: a flat this account bought or rents, a
 *  building on a lot it holds, else the starting point) and answers with pmoved; the screen fades meanwhile. */
let homeT = 0;
function goHome() {
  if (!P.active || busy || homeT) return;
  if (app.driving?.id) return app.toast('Leave the vehicle first', 'bad', 2500);
  if (!networked()) return app.toast('Sign in to have a home in the world', 'bad', 3000);
  closeElevator(); busy = true; E.fade.classList.add('on');
  homeT = setTimeout(() => { homeT = 0; E.fade.classList.remove('on'); busy = false; app.toast('Could not reach the server — try again', 'bad', 3000); }, 5000);
  setTimeout(() => app.net.send({ t: 'phome' }), 280);
}
/** Puts this page's player somewhere (admins: players.warp); used by tests and to help someone in person. */
function warp(x, z, ctx = -1, yaw = null) {
  P.x = x; P.z = z; P.ctx = ctx; P.y = groundY(); P.vx = P.vz = 0; P.tween = null; P.air = false; P.vy = 0;
  if (Number.isFinite(yaw)) P.yaw = P.tyaw = yaw;
  if (networked()) app.net.send({ t: 'pwarp', x, z, ctx, yaw: P.yaw, seq: ++NET.seq });
  NET.last = '';
}
/** About 10 times a second while playing: the player's compact state, when it changed (and a beat every 2 s). */
function sendState(t, force = false) {
  if (!networked() || (!force && t - NET.at < 0.1)) return;
  const flags = (P.state === 'use' || P.tween ? PF_USING : 0);
  const key = `${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)},${P.ctx},${P.yaw.toFixed(2)},${P.clip},${flags}`;
  if (!force && key === NET.last && t - NET.beatAt < 2) return;
  NET.at = t; NET.last = key; NET.beatAt = t;
  app.net.send({ t: 'pmove', x: +P.x.toFixed(3), y: +P.y.toFixed(3), z: +P.z.toFixed(3), yaw: +P.yaw.toFixed(4), ctx: P.ctx, clip: P.clip, flags, seq: ++NET.seq & 65535 });
}

// ------------------------------------------------------------------ collision
let decks = [], ladders = [];   // the docks' decks people walk on over the water, and the ladders up to them (shared/dock-layout.js)
function rebuildHash() {
  hash = new Hash(16);
  decks = moduleDecks(S.world); ladders = moduleLadders(S.world);
  for (const B of S.world.buildings) {
    if (!B || B.gone) continue;
    const fp = footprint(B);
    hash.add(fp.x0 - 1, fp.z0 - 1, fp.x1 + 1, fp.z1 + 1, { k: 0, B, fp });
  }
  for (const o of app.city.occ || []) {
    if (o[2] >= 2) continue;                       // subway kiosks are handled as boxes below
    const r = o[2] >= 0.95 ? 0.16 : o[2] >= 0.7 ? 0.2 : 0.24;
    hash.add(o[0] - r - 0.5, o[1] - r - 0.5, o[0] + r + 0.5, o[1] + r + 0.5, { k: 1, x: o[0], z: o[1], r });
  }
  for (const st of S.world.stations) {   // kiosks (turned ones beyond the city): their rectangles
    hash.add(st.x - 3, st.z - 3, st.x + 3, st.z + 3, { k: 3, d: { x: st.x, z: st.z, r: st.rot || 0 }, rect: [-0.66, -1.92, 0.66, 1.84] });
  }
  for (const b of moduleBoxes(S.world)) {   // world modules' buildings (an airport's terminal, tower, hangar): walls
    const e = Math.hypot(b.hw, b.hd) + 1;
    hash.add(b.x - e, b.z - e, b.x + e, b.z + e, { k: 3, d: { x: b.x, z: b.z, r: b.rot }, rect: [-b.hw, -b.hd, b.hw, b.hd] });
  }
  for (const a of aircraftSolids(S.world, app.airports?.away)) {   // standing aircraft: their fuselages and low wings
    const e = Math.hypot(a.rect[2] - a.rect[0], a.rect[3] - a.rect[1]) / 2 + 1;
    hash.add(a.x - e, a.z - e, a.x + e, a.z + e, { k: 3, d: { x: a.x, z: a.z, r: a.rot }, rect: a.rect });
  }
  for (const d of S.world.decorations || []) {   // outdoor decorations (WP4.7): their turned rectangles
    const rect = CATALOG[d.t]?.rect; if (!rect) continue;
    const e = Math.hypot(rect[2] - rect[0], rect[3] - rect[1]) / 2 + 1;
    hash.add(d.x - e, d.z - e, d.x + e, d.z + e, { k: 3, d, rect });
  }
}
function gridFor(B, f) {
  const lv = B.lv[f], key = B.idx * 64 + f + ':' + lv;
  let gr = grids.get(key);
  if (!gr) { gr = buildGrid(B, S.world.levels[lv]); grids.set(key, gr); }
  return gr;
}
function parkBlocked(B, x, z) {
  // hedges (0.97 m) are jumped onto and over, gate posts (1.35 m) are not; inside, benches, picnic tables and the
  // fountain like any furniture (shared/standable.js)
  const l = toLocal(B, x, z, _l), up = P.y - floorAt(B, 0), hw = B.w / 2, hd = B.d / 2, { e, th } = PARK_EDGE;
  if (parkEdgeTop(hw, hd, l.x, l.z, R) > up + STEP) return true;
  if (Math.abs(l.x) < hw - e - th && Math.abs(l.z) < hd - e - th) {
    const gr = gridFor(B, 0);
    if (!walkable(gr, l.x, l.z)) return !furnitureOnly(gr, l.x, l.z) || tallUnder(gr.items, l.x, l.z, R, up);
  }
  return false;
}
function outBlocked(x, z) {
  if (app.driving?.ready && !app.driving.id && app.driving.blocked(P, x, z)) return true;
  if (x < B0.x0 || x > B0.x1 || z < B0.z0 || z > B0.z1) return true;
  if (inPier(x, z, P.y, R)) return true;   // under a bridge: its piers
  const T = S.world.terrain;   // swimming (water no longer stops anyone): as far out as the server lets a player go
  if (T && app.terrain && !nearCity(x, z) && (Math.abs(x - T.center.x) > T.radius * 1.35 || Math.abs(z - T.center.z) > T.radius * 1.35)) return true;
  for (const o of hash.query(x, z)) {
    if (o.k === 0) {
      const B = o.B, fp = o.fp;
      if (B.gone || x < fp.x0 - R || x > fp.x1 + R || z < fp.z0 - R || z > fp.z1 + R) continue;
      if (B.type === 'park') { if (parkBlocked(B, x, z)) return true; continue; }
      const l = toLocal(B, x, z, _l);
      if (Math.abs(l.x) > B.w / 2 + R || Math.abs(l.z) > B.d / 2 + R) continue;   // outside a turned building's walls
      if (B.door && Math.abs(l.x - B.door.x) < B.door.w / 2 - R && l.z > B.d / 2 - WALL_T - 0.9) continue;   // the doorway
      return true;
    }
    if (o.k === 1) { const dx = x - o.x, dz = z - o.z; if (dx * dx + dz * dz < (o.r + R) * (o.r + R)) return true; continue; }
    if (o.k === 3) {   // decorations: ones whose top is below the feet + STEP are climbed onto (standable.js); kiosks are walls
      if (inItemRect(x, z, o.d.x, o.d.z, o.d.r || 0, o.rect, R) && (!o.d.t || tallUnder([o.d], x, z, R, P.y - outdoorGround().height(x, z)))) return true;
      continue;
    }
    if (x > o.x0 - R && x < o.x1 + R && z > o.z0 - R && z < o.z1 + R) return true;
  }
  return false;
}
function inBlocked(B, f, x, z) {
  const l = toLocal(B, x, z, _l), ib = interiorBounds(B);
  const door = f === 0 && B.door && Math.abs(l.x - B.door.x) < B.door.w / 2 - R && l.z > ib.z1 - 1.0 && l.z < B.d / 2 + 1.2;
  if (door) return false;
  if (l.x < ib.x0 + R || l.x > ib.x1 - R || l.z < ib.z0 + R || l.z > ib.z1 - R) return true;
  const units = S.world.levels[B.lv[f]]?.units;   // a locked flat's doorway is shut to a player who isn't one of its people
  if (units) for (let u = 0; u < units.length; u++) { const d = units[u].door; if (d && Math.abs(l.x - d[0]) < 0.6 && Math.abs(l.z - d[1]) < 0.4 + R && !mayEnter(B, f, u, -1)) return true; }
  const gr = gridFor(B, f);
  if (nearWall(gr, l.x, l.z, R)) return true;   // the grid alone lets a body brush through walls
  if (walkable(gr, l.x, l.z)) return false;
  return !furnitureOnly(gr, l.x, l.z) || tallUnder(gr.items, l.x, l.z, R, P.y - floorAt(B, f));   // furniture lower than feet + STEP: climbed onto
}
/** Whether moving from (x0, z0) to (x1, z1) passes through an interior wall (indoors only). */
function throughWall(x0, z0, x1, z1) {
  if (P.ctx < 0) return false;
  const B = bld(P.ctx >> 6);
  if (!B) return false;
  const a = toLocal(B, x0, z0), b = toLocal(B, x1, z1);
  return wallBetween(gridFor(B, P.ctx & 63), a.x, a.z, b.x, b.z);
}
function blocked(x, z) {
  if (P.ctx >= 0) { const B = bld(P.ctx >> 6); return B ? inBlocked(B, P.ctx & 63, x, z) : false; }
  return outBlocked(x, z);
}
function moveBy(dx, dz) {
  const L = Math.hypot(dx, dz); if (L < 1e-5) return 0;
  const n = Math.ceil(L / SUB), sx = dx / n, sz = dz / n, stuck = blocked(P.x, P.z);
  let d = 0;
  for (let k = 0; k < n; k++) {
    // a player who starts inside an obstacle may walk out of it, but never through a wall
    if ((stuck && !throughWall(P.x, P.z, P.x + sx, P.z + sz)) || !blocked(P.x + sx, P.z + sz)) { P.x += sx; P.z += sz; d += Math.hypot(sx, sz); }
    else if (!blocked(P.x + sx, P.z)) { P.x += sx; d += Math.abs(sx); P.vz *= 0.6; }
    else if (!blocked(P.x, P.z + sz)) { P.z += sz; d += Math.abs(sz); P.vx *= 0.6; }
    else { P.vx *= 0.3; P.vz *= 0.3; break; }
  }
  return d;
}
const nearCity = (x, z) => x > g.minX - 40 && x < g.maxX + 40 && z > g.minZ - 40 && z < g.maxZ + 40;
/** The ground under the player: the floor indoors, the city's streets and sidewalks, its apron, then the island's terrain
 *  (the same height function the server checks against). */
function groundY() {
  if (P.ctx >= 0) return floorAt(bld(P.ctx >> 6), P.ctx & 63);
  const dk = deckHere(); if (dk !== null) return dk;   // on a dock's deck over the water
  const u = underDeck(); if (u) return u.h;   // under a bridge: what lies beneath it, not its deck
  return outdoorGround().height(P.x, P.z);
}
/** What the feet rest on at the player's spot for feet no higher than `feet`: the ground or floor, or the top of a
 *  decoration / piece of furniture under the body (shared/standable.js) that is not above feet + STEP. */
function supportY(feet = P.y) {
  const base = groundY(), pad = R * 0.55;
  let top = -Infinity;
  if (P.ctx >= 0) {
    const B = bld(P.ctx >> 6);
    if (B) { const l = toLocal(B, P.x, P.z, _l), gr = gridFor(B, P.ctx & 63); top = topUnder(gr.items, l.x, l.z, pad, feet - base + STEP); }
  } else {
    const ds = [], max = feet - base + STEP;
    for (const o of hash.query(P.x, P.z)) {
      if (o.k === 3 && o.d.t) ds.push(o.d);
      else if (o.k === 0 && o.B.type === 'park' && !o.B.gone && inFootprint(o.B, P.x, P.z)) {   // a park: its hedges and things
        const B = o.B, l = toLocal(B, P.x, P.z, _l), h = parkEdgeTop(B.w / 2, B.d / 2, l.x, l.z, pad);
        if (h <= max) top = Math.max(top, h);
        top = Math.max(top, topUnder(gridFor(B, 0).items, l.x, l.z, pad, max));
      }
    }
    if (ds.length) top = Math.max(top, topUnder(ds, P.x, P.z, pad, max));
  }
  return base + Math.max(0, top);
}
// Swimming (2026-10-05): deeper than SWIM_DEPTH the body floats — upright treading water when still (its neck
// at the surface), prone doing the crawl when moving (its back at the surface) — or dives under; shallower it wades.
const SWIM_DEPTH = 1.15, SWIM_OUT = 1.0, FLOAT_UP = 1.32, FLOAT_PRONE = 0.93, DIVE = 1.6, DIVE_MIN = 2.0, BREATH = 30;
const SWIM = 1.25, SWIM_RUN = 2.0;
/** The water at the player's spot: { level, bed, kind } or null (indoors, dry, or the city). */
// The bridges' piers (shared/island-roads.js bridgePiers, where render/island-roads.js draws them): walls to anyone
// under the deck — swimmers and the camera.
let piersFor = null, piers = [];
function bridgePiersNow() {
  const I = app.terrain?.ground?.island;
  if (!I?.roads) return [];
  if (piersFor !== I.roads) { piersFor = I.roads; piers = bridgePiers(I.roads, (x, z) => I.baseHeight(x, z), (x, z) => x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ); }
  return piers;
}
/** Whether a body at (x, z) with its feet at y (radius pad) is inside a pier (below its top). */
function inPier(x, z, y, pad) {
  for (const p of bridgePiersNow()) {
    if (Math.abs(x - p.x) > p.hw + 4 || Math.abs(z - p.z) > p.hw + 4 || y > p.top - 0.3 || y < p.bottom - 3) continue;
    const dx = x - p.x, dz = z - p.z, u = dx * p.nx + dz * p.nz, v = -dx * p.nz + dz * p.nx;
    if (Math.abs(u) < p.hw + pad && Math.abs(v) < p.hd + pad) return true;
  }
  return false;
}
/** Under a bridge the camera comes down under its deck (lower and closer as it must), so the deck doesn't hide the
 *  player; out from under it the player's own distance and angle come back. */
function deckCamera() {
  const u = underDeck();
  if (u) {
    P.camSave ||= { dist: cam.goalDist, pitch: cam.goalPitch };
    const room = u.deck - 1.35 - (P.y + 1.1), pitch = Math.min(P.camSave.pitch, 0.32);   // the deck is ~0.95 m thick
    let d = Math.max(2.2, Math.min(P.camSave.dist, room / Math.sin(pitch)));
    const cp = Math.cos(pitch), sp = Math.sin(pitch), ty = P.y + 1.1;   // never inside a pier: closer until clear of it
    while (d > 1.2 && inPier(P.x + Math.sin(cam.yaw) * cp * d, P.z + Math.cos(cam.yaw) * cp * d, ty + sp * d - 1.1, 0.4)) d -= 0.25;
    cam.goalPitch = pitch; cam.goalDist = d;
  } else if (P.camSave) { cam.goalDist = P.camSave.dist; cam.goalPitch = P.camSave.pitch; P.camSave = null; }
}
/** Under a bridge's deck (well below it): the ground and water beneath it (GroundQuery.under), else null. */
function underDeck() { return P.ctx < 0 && app.terrain?.ground?.under && !nearCity(P.x, P.z) ? app.terrain.ground.under(P.x, P.z, P.y) : null; }
/** The top of a dock's deck under the player that the feet stand on (or step up to), else null. */
function deckHere(feet = P.y) { return decks.length && P.ctx < 0 ? deckUnder(decks, P.x, P.z, feet) : null; }
function waterHere() {
  if (P.ctx >= 0 || !app.terrain?.ground || nearCity(P.x, P.z)) return null;
  if (deckHere() !== null) return null;   // on a deck, over the water
  const u = underDeck(), w = u ? u.water : app.terrain.ground.water(P.x, P.z);
  return w ? { level: w.level, bed: groundY(), kind: w.kind } : null;
}
/** One frame in the water; false when the body is not swimming (gravity and the ground take over). */
function swimStep(dt, t) {
  const w = P.wet = waterHere(), depth = w ? w.level - w.bed : 0, was = P.swim;
  P.wade = !!w && depth > 0.35;
  if (P.air && w && depth > SWIM_DEPTH && P.y > w.level - FLOAT_UP) return false;   // still coming down into it
  if (was && w && climbOut(w)) return false;   // up on to a floating dock, or up a pier's ladder
  P.swim = !!w && depth > (was ? SWIM_OUT : SWIM_DEPTH);
  if (!P.swim) { if (was) { P.diving = false; refreshVehicleHud(); } return false; }
  if (!was) { P.air = false; P.vy = 0; P.diving = false; refreshVehicleHud(); }
  if (P.diving && (t - P.diveT > BREATH || depth < DIVE_MIN - 0.3)) { P.diving = false; refreshVehicleHud(); if (t - P.diveT > BREATH) app.toast('Up for air', '', 1500); }
  P.swimMove = (P.swimMove || 0) + ((P.speed > 0.3 ? 1 : 0) - (P.swimMove || 0)) * Math.min(1, dt * 2.5);
  const surface = w.level - (FLOAT_UP + (FLOAT_PRONE - FLOAT_UP) * P.swimMove);
  const target = P.diving ? Math.max(w.bed - 0.55, w.level - FLOAT_PRONE - DIVE) : surface;
  P.y += (target - P.y) * Math.min(1, dt * (P.diving ? 2 : 3.5));
  return true;
}
/** A swimmer at a floating dock (its deck low over the water) climbs on to it; at a ladder, up it to the pier. */
function climbOut(w) {
  const low = decks.length ? deckUnder(decks, P.x, P.z, w.level + 0.45) : null;
  let top = low !== null && low <= w.level + 0.8 ? low : null;
  if (top === null) for (const L of ladders) if (Math.hypot(P.x - L.x, P.z - L.z) < 1.1) { top = L.top; break; }
  if (top === null) return false;
  P.y = top; P.swim = false; P.diving = false; P.air = false; P.vy = 0; refreshVehicleHud();
  return true;
}
/** Gravity (2026-10-05, jumping without a physics engine): in the air the body rises and falls; on the ground it
 *  follows what it stands on, steps up to STEP and falls off anything higher. */
function fall(dt, t) {
  const sup = supportY(P.y);
  if (P.air) {
    P.vy -= GRAVITY * dt; P.y += P.vy * dt;
    if (P.vy <= 0 && P.y <= sup) { P.y = sup; P.air = false; P.vy = 0; P.landT = t; }
  } else if (sup < P.y - STEP) { P.air = true; P.vy = 0; P.jumpT = t - 0.47; }   // walked off an edge: already falling
  else P.y += (sup - P.y) * Math.min(1, dt * 16);
}
let outdoor = null;
/** shared/city-edge.js for the current grid, island and roads (rebuilt when any of them changes). */
function outdoorGround() {
  const t = app.terrain || null, roads = S.world?.roads || null;
  if (!outdoor || outdoor.g !== g || outdoor.t !== t || outdoor.roads !== roads) {
    outdoor = new OutdoorGround(g, roads, t && { height: (x, z) => t.heightAt(x, z) });
    Object.assign(outdoor, { t, roads });
  }
  return outdoor;
}

// ------------------------------------------------------------------ first person
/** Where the player's eyes are, for first person (standing, sitting, lying, in the water), or null where it isn't
 *  possible (driving). A hand's width ahead of the head's centre, the way the camera looks; the body (radius R) keeps
 *  them clear of the walls, so the near plane never cuts into one. */
function eyes() {
  if (!P.active || P.state === 'drive' || app.driving?.id || app.driving?.observedDriver) return null;
  const use = P.state === 'use' ? P.useClip : -1;
  let y = P.y + (use === CLIP.lie ? 0.5 : use >= 0 && SEATED_CLIPS.has(use) ? 1.18 : P.diving ? 0.45 : 1.62);   // (diving: lying along the water)
  if (P.swim && P.wet) y = Math.min(y, P.wet.level + 0.2);
  _eye.x = P.x - Math.sin(cam.yaw) * 0.05; _eye.y = y; _eye.z = P.z - Math.cos(cam.yaw) * 0.05;
  return _eye;
}
function onFirstPerson(on) {
  if (S.focus.b >= 0) app.applyFocus();   // inside: full-height walls and a ceiling in first person (interiors.js 'fp')
  if (on) app.toast('First person · zoom out to step back', '', 1800);
}
// ------------------------------------------------------------------ enter / leave play mode
function spawnPoint() {
  const fb = S.focus.b, B = fb >= 0 ? bld(fb) : null;
  if (B && B.type !== 'park') {
    const f = S.focus.f, l = toLocal(B, cam.target.x, cam.target.z), gr = gridFor(B, f), c = nearestFree(gr, l.x, l.z, 24);
    if (c >= 0) { const q = cellCenter(gr, c, {}), w = toWorld(B, q.x, q.z); return { x: w.x, z: w.z, ctx: ctxOf(fb, f), yaw: cam.yaw + Math.PI }; }
  }
  // (no city: where the view is, clear of anything standing there)
  const tx = g.empty ? cam.target.x : clamp(cam.target.x, g.minX, g.maxX), tz = g.empty ? cam.target.z : clamp(cam.target.z, g.minZ, g.maxZ);
  for (let r = 0; r < 70; r += 1) {
    const n = Math.max(1, Math.round(r * 2.5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r;
      if ((g.empty || blockAt(g, x, z)) && !outBlocked(x, z)) return { x, z, ctx: -1, yaw: cam.yaw + Math.PI };
    }
  }
  const hq = app.hq;
  if (!hq) return { x: tx, z: tz, ctx: -1, yaw: cam.yaw + Math.PI };
  const d = toWorld(hq, hq.door ? hq.door.x : 0, hq.d / 2 + 2);
  return { x: d.x, z: d.z, ctx: -1, yaw: bRot(hq) };
}
function enter() {
  if (P.active) return;
  app.stopFollow?.(); select(-1); selectBuilding(-1);
  const me = networked() ? app.remote.me : null;
  // A signed-in player appears where it last stood (or at the spawn point), as the server says (I14.12).
  const sp = me ? { x: me.x, z: me.z, ctx: me.ctx, yaw: me.yaw || 0 } : spawnPoint();
  Object.assign(P, sp, { active: true, tyaw: sp.yaw, vx: 0, vz: 0, speed: 0, state: 'walk', slot: null, emote: null, tween: null, jumpT: -9, landT: -9, air: false, vy: 0, swim: false, diving: false, wade: false, clip: CLIP.idle, pclip: CLIP.idle, fadeT: -9 });
  P.y = groundY();
  if (P.ctx >= 0) setFocus(P.ctx >> 6, P.ctx & 63);
  saved = { minDist: cam.minDist };
  cam.follow = () => ({ x: P.x, y: P.y + 1.1, z: P.z });
  cam.panEnabled = false; cam.keysEnabled = false; cam.eReserved = true; cam.minDist = 3;
  cam.goalDist = me && me.cam ? me.cam.dist : 13; cam.goalPitch = me && me.cam ? me.cam.pitch : 0.62;
  cam.fpEye = eyes; cam.onFP = onFirstPerson;
  // look around: the mouse on a computer (captured now — entering Play is a click or a key), a finger on a touch screen
  cam.look = true;
  cam.lookPaused = () => !!(app.mapOpen || app.custOpen || document.querySelector('.modal-back, .auth-back') || cam.typing({ target: document.activeElement }));
  cam.onLock = on => { if (!on && P.active && !isTouch() && !cam.lookPaused?.()) app.toast('Cursor free — click the world to look around again · Esc again leaves', '', 2600); };
  if (!isTouch()) cam.lockMouse();
  NET.at = 0; NET.beatAt = 0; NET.last = '';   // a fresh throttle for every play session
  if (me) { cam.target.set(P.x, P.y + 1.1, P.z); cam.goal.copy(cam.target); app.net.send({ t: 'pobserve', on: false }); }
  if (!agents.extra.includes(P.extra)) agents.extra.push(P.extra);
  pose(nowS());
  if (app.driving?.id) P.onVehicleEnter();
  document.body.classList.add('play');
  E.hud.classList.remove('hidden'); E.bar.classList.remove('hidden');
  E.pn.textContent = P.look.name;
  const touch = isTouch();
  E.joy.classList.toggle('hidden', !touch); E.btns.classList.toggle('hidden', !touch);
  app.toast(touch ? '🎮 The stick walks, a finger on the world looks around, E interacts' : '🎮 The mouse looks around · WASD to walk · Shift to run · E to interact · Esc frees the cursor', 'good', 3600);
}
function leave() {
  if (!P.active) return;
  cam.setFP(false, true); cam.fpEye = null; cam.onFP = null;   // out of first person before the camera is saved
  if (networked()) {
    sendState(nowS(), true);   // the last state, whatever the throttle says
    app.net.send({ t: 'pcam', dist: cam.goalDist, pitch: cam.goalPitch });
    app.net.send({ t: 'pobserve', on: true });   // the character waits here with an "observing" marker (I14.9)
  }
  P.active = false;
  closeElevator();
  E.fade.classList.remove('on'); busy = false;
  const k = agents.extra.indexOf(P.extra); if (k >= 0) agents.extra.splice(k, 1);
  cam.follow = null; cam.panEnabled = true; cam.keysEnabled = true; cam.eReserved = false;
  cam.look = false; cam.onLock = null; cam.lookPaused = null; cam.unlockMouse();
  if (saved) cam.minDist = saved.minDist;
  cam.goal.copy(cam.target);
  document.body.classList.remove('play');
  for (const el of [E.hud, E.bar, E.joy, E.btns]) el.classList.add('hidden');
  keys.clear(); joy.on = false; joy.x = joy.y = 0;
  app.applyFocus();
}
function checkGone() {
  if (!P.active || P.ctx < 0) return;
  const B = S.world.buildings[P.ctx >> 6];
  if (B && !B.gone && (P.ctx & 63) < B.floors) return;
  const d = B ? toWorld(B, B.door ? B.door.x : 0, B.d / 2 + 1.5) : { x: P.x, z: P.z };
  P.ctx = -1; P.x = d.x; P.z = d.z; P.state = 'walk'; P.slot = null; P.tween = null;
  P.y = groundY();
  if (S.focus.b >= 0 && (!B || S.focus.b === B.idx)) setFocus(-1);
}

// ------------------------------------------------------------------ frame update
function refreshVehicleHud() {
  if (!E.btns || !E.hud) return;
  const driving = !!(app.driving?.id || app.driving?.observedDriver);
  document.body.classList.toggle('driving', driving);
  const jumpButton = E.btns.querySelector('[data-a="jump"]'), runButton = E.btns.querySelector('[data-a="run"]');
  const observing = !!app.driving?.observedDriver;
  for (const b of E.btns.querySelectorAll('button')) b.disabled = observing;
  E.btns.querySelector('[data-a="e"]').textContent = driving ? 'Exit' : 'E';
  jumpButton.textContent = driving ? 'Handbrake' : P.swim ? (P.diving ? '⤒' : '⤓') : '⤒'; jumpButton.title = driving ? 'Handbrake' : P.swim ? (P.diving ? 'Come up' : 'Dive') : 'Jump';
  jumpButton.classList.toggle('on', driving && handbrakeToggle);
  // On foot the stick runs when pushed all the way, so the third button is Chat (like the sim's); driving, it is Boost.
  runButton.classList.toggle('hidden', !driving); E.btns.querySelector('[data-a="chat"]').classList.toggle('hidden', driving);
  runButton.classList.toggle('on', runToggle);
  const text = observing ? 'Your vehicle is controlled in another tab' : driving ? 'W/S throttle, brake & reverse · A/D steer · Shift boost · Space handbrake · E exit when stopped'
    : P.swim ? (isTouch() ? 'Drag the stick to swim · ⤓ dives' : `WASD swim · Shift faster · Space ${P.diving ? 'come up' : 'dive'} · Esc leave`)
    : isTouch() ? 'Stick: walk (all the way: run) · drag the world: look · E: interact or talk · keep zooming in: first person' : 'Mouse look · WASD walk · Shift run · E interact · Space jump · Z/X/C emotes · scroll in: first person · Esc frees the cursor, again leaves';
  E.hud.querySelector('.keys').textContent = text;
}
function updateDriving(dt, t) {
  const d = app.driving.driving || app.driving.observedDriver; if (!d) { P.vx = P.vz = 0; return; }
  if (!driveCam) P.onVehicleEnter();
  P.x = d.x; P.y = d.y; P.z = d.z; P.ctx = -1; P.yaw = P.tyaw = d.yaw + Math.PI / 2; P.speed = Math.abs(d.v);
  const rig = app.driving.rigs[d.k], chase = vehicleChaseCamera(d, rig?.halfLength || 2.3, S.world);
  cam.minDist = 1.5; cam.goalDist = chase.dist; cam.goalPitch = chase.pitch;
  cam.goalYaw = cam.yaw + angDiff(cam.yaw, chase.yaw);
  cam.follow = () => chase.focus;
  if (S.focus.b >= 0) setFocus(-1);
  GU.uFade.value.set(P.x, P.y + 1.0, P.z, 3.4);
  if (t - promptT > .12) { promptT = t; findTarget(); refreshVehicleHud(); }
}
async function vehicleInteract(target) {
  if (!app.driving || busy) return;
  busy = true;
  try { if (target.k === 'vehicle') await app.driving.enter(target.car); else await app.driving.exit(); }
  catch (e) { app.toast(e.message || 'Vehicle action was not confirmed', 'bad', 4500); }
  finally { busy = false; promptT = 0; }
}
async function leaveDriving() {
  if (busy) return;
  busy = true;
  try { await app.driving.exit(); app.setMode('explore'); }
  catch (e) { app.toast(e.message || 'Stop and exit the vehicle first', 'bad', 4000); }
  finally { busy = false; }
}
function update(dt, t) {
  if (app.flight?.active) { app.flight.frame(P, dt, t); return; }   // flying an aircraft (player/flight.js)
  if (app.boating?.active) { app.boating.frame(P, dt, t); return; }   // out in a boat (player/boating.js)
  if (app.driving?.id || app.driving?.observedDriver) { updateDriving(dt, t); return; }
  if (P.state === 'drive' && !app.flight?.active && !app.boating?.active) P.onVehicleExit();
  let ix = 0, iz = 0;
  const free = !app.custOpen && !app.mapOpen && !busy && E.elev.classList.contains('hidden');
  if (free) {
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (joy.on) { ix += joy.x; iz += joy.y; }
  }
  const mag = Math.min(1, Math.hypot(ix, iz));
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle || (joy.on && mag > 0.93);
  if (mag > 0.08) { if (P.state === 'use') standUp(); P.emote = null; }
  let vx = 0, vz = 0;
  if (mag > 0.08 && P.state !== 'use' && !P.tween) {
    const n = Math.hypot(ix, iz), ux = ix / n, uz = iz / n, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const base = P.swim ? (running ? SWIM_RUN : SWIM) * (P.diving ? 0.85 : 1) : (running ? RUN : WALK) * (P.wade ? 0.6 : 1);   // wading: slower
    const dx = ux * c + uz * s, dz = -ux * s + uz * c, sp = base * (joy.on ? Math.max(0.4, mag) : 1);
    vx = dx * sp; vz = dz * sp; P.tyaw = Math.atan2(dx, dz);
  }
  if (cam.fp && P.state !== 'use' && !P.tween) P.tyaw = cam.goalYaw + Math.PI;   // first person: facing the way it looks
  const k = 1 - Math.exp(-dt * 12);
  P.vx += (vx - P.vx) * k; P.vz += (vz - P.vz) * k;
  let moved = 0;
  if (P.tween) {
    const tw = P.tween, u = Math.min(1, (t - tw.t0) / tw.dur), e = u * u * (3 - 2 * u);
    P.x = tw.x0 + (tw.x1 - tw.x0) * e; P.z = tw.z0 + (tw.z1 - tw.z0) * e; P.y = tw.y0 + (tw.y1 - tw.y0) * e;
    if (u >= 1) P.tween = null;
  } else if (P.state !== 'use' && Math.abs(P.vx) + Math.abs(P.vz) > 1e-3) moved = moveBy(P.vx * dt, P.vz * dt);
  if (P.state !== 'use' && !P.tween) softPush(dt);
  P.dist += moved;
  P.speed += ((dt > 0 ? moved / dt : 0) - P.speed) * (1 - Math.exp(-dt * 10));
  if (P.state !== 'use') P.yaw += angDiff(P.yaw, P.tyaw) * (1 - Math.exp(-dt * 13));
  transitions();
  if (P.state !== 'use' && !P.tween) { if (!swimStep(dt, t)) fall(dt, t); }
  if (!cam.fp) deckCamera();
  pose(t);
  // first person: the own body is hidden from its own camera once the camera is nearly in the eyes (others still see it)
  // (at an arcade cabinet the camera is at its screen, inside the player's head: the body is hidden from it too; and at a
  // game machine played for real, where the camera is in the player's eyes: play/machine-play.js)
  const seen = cam.fpK < 0.6 && !((app.arcade?.playing || app.machinePlay?.active) && P.state === 'use'), xi = agents.extra.indexOf(P.extra);
  if (seen && xi < 0) agents.extra.push(P.extra); else if (!seen && xi >= 0) agents.extra.splice(xi, 1);
  if (S.focus.b < 0) GU.uFade.value.set(P.x, P.y + 1.0, P.z, 3.4);
  if (t - promptT > 0.12) { promptT = t; findTarget(); }
  sendState(t);
}
function transitions() {
  if (P.ctx < 0) {
    for (const o of hash.query(P.x, P.z)) {
      if (o.k !== 0 || o.B.gone || o.B.type === 'park') continue;
      const B = o.B, fp = o.fp;
      if (P.x < fp.x0 || P.x > fp.x1 || P.z < fp.z0 || P.z > fp.z1 || !inFootprint(B, P.x, P.z)) continue;
      if (toLocal(B, P.x, P.z, _l).z < B.d / 2 - WALL_T - 0.3) {
        P.ctx = ctxOf(B.idx, 0);
        setFocus(B.idx, 0);
        app.toast(`${app.TYPE_ICON?.[B.type] || '🏢'} ${B.name}`, '', 1500);
      }
      return;
    }
  } else if ((P.ctx & 63) === 0) {
    const B = bld(P.ctx >> 6);
    if (!B) { P.ctx = -1; return; }
    if (toLocal(B, P.x, P.z, _l).z > B.d / 2 + 0.1) { P.ctx = -1; if (S.focus.b === B.idx) setFocus(-1); }
  }
}
function pose(t) {
  let clip, ph, prop = 0;
  // jumping (jump-pose.js): the clip follows the flight, then a short landing (half as long when walking on)
  const landLen = P.speed > 0.5 ? LAND_T * 0.5 : LAND_T, tl = t - P.landT;
  let lift = 0;
  if (P.state === 'use') { clip = P.useClip; ph = t / Math.max(0.3, CLIP_DUR[clip]); prop = P.useProp; }
  else if (P.swim) {   // swimming: treading water, the crawl, or under water (tools/chars/extra-clips.mjs)
    P.emote = null;
    clip = P.diving ? CLIP.swim_under : P.speed > 0.3 ? CLIP.swim : CLIP.swim_idle;
    const st = CLIP_STRIDE[clip];
    ph = st > 0 && P.speed > 0.3 ? P.dist / st : t / Math.max(0.3, CLIP_DUR[clip] * (P.diving ? 2.5 : 1));
  }
  else if (P.air) { clip = CLIP.jump; ph = airPhase(t - P.jumpT); lift = hipLift(ph); }
  else if (P.landT > P.jumpT && tl < landLen) { clip = CLIP.jump; ph = landPhase(tl / landLen); }
  else if (P.emote && t - P.emote.t0 < P.emote.dur) { clip = P.emote.clip; ph = (t - P.emote.t0) / Math.max(0.3, CLIP_DUR[clip]); }
  else {
    P.emote = null;
    clip = P.speed > 2.5 ? CLIP.run : P.speed > 0.14 ? CLIP.walk : CLIP.idle;
    const st = CLIP_STRIDE[clip];
    ph = st > 0 ? P.dist / st : t / Math.max(0.3, CLIP_DUR[clip]);
  }
  ph -= Math.floor(ph);
  if (clip !== P.clip) { P.pclip = P.clip; P.pph = P.ph; P.fadeT = t; P.clip = clip; }
  P.ph = ph;
  const w = Math.max(0, 1 - (t - P.fadeT) / 0.22);
  const X = P.extra;
  X.x = P.x; X.y = P.y - lift; X.z = P.z; X.yaw = P.yaw; X.clip = clip; X.ph = ph; X.pclip = P.pclip; X.pph = P.pph; X.w = w; X.prop = prop;
  X.flags = P.ctx >= 0 ? 4 : 0;
}

// ------------------------------------------------------------------ interaction
function findTarget() {
  if (!P.active) return;
  const drive = app.driving;
  if (drive?.observedDriver) { P.target = null; E.prompt._h = null; E.prompt.innerHTML = 'Your vehicle is controlled in another tab'; E.prompt.classList.remove('hidden'); return; }
  if (drive?.id || drive?.pending) {
    E.prompt._h = null;
    P.target = { k: 'vehicleExit' };
    const speed = Math.abs(drive.driving?.v || 0), text = drive.pending ? 'Confirming vehicle action…' : speed > 1 ? 'Stop to exit vehicle' : 'Exit vehicle';
    E.prompt.innerHTML = '<kbd>E</kbd> ' + text; E.prompt.classList.remove('hidden'); return;
  }
  const car = P.state === 'walk' ? drive?.nearby(P) : null;
  if (car) { E.prompt._h = null; P.target = { k: 'vehicle', car }; E.prompt.innerHTML = '<kbd>E</kbd> Drive ' + esc(drive.rigs[car.k]?.kind || 'vehicle'); E.prompt.classList.remove('hidden'); return; }
  let best = null, bd = 1e9;
  if (P.state === 'use') { best = { k: 'stand' }; }
  else if (!P.tween) {
    for (let n = 0; n < agents.nDrawn; n++) {
      const i = agents.drawn[n];
      if (Math.abs(agents.ry[i] - P.y) > 1.2) continue;
      const d = Math.hypot(agents.rx[i] - P.x, agents.rz[i] - P.z) + 0.25;
      if (d < 2.0 && d < bd) { bd = d; best = { k: 'talk', i }; }
    }
    for (const r of app.remote?.byPid.values() || []) {   // other players: E opens the chat box to talk to them
      if (r.you || r.gone || r.ctx !== P.ctx || Math.abs(r.extra.y - P.y) > 1.2) continue;
      const d = Math.hypot(r.extra.x - P.x, r.extra.z - P.z) + 0.25;
      if (d < 2.6 && d < bd) { bd = d; best = { k: 'player', pid: r.pid, name: r.name }; }
    }
    const f = P.ctx & 63, list = P.ctx >= 0 ? inter.foc.entries : [...inter.park.entries, ...decorNear(P.x, P.z)];
    for (const e of list) {
      if (Math.abs(e.x - P.x) > 4 || Math.abs(e.z - P.z) > 4) continue;
      if (P.ctx >= 0 && (e.b !== (P.ctx >> 6) || e.f !== f)) continue;
      const def = CATALOG[e.t]; if (!def || !def.slots || !def.slots.length) continue;
      const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      for (const sl of def.slots) {
        const sx = e.x + sl.x * c + sl.z * s, sz = e.z - sl.x * s + sl.z * c;
        const al = sl.ax ?? sl.x, bl = sl.az ?? sl.z, ax = e.x + al * c + bl * s, az = e.z - al * s + bl * c;
        const d = Math.min(Math.hypot(sx - P.x, sz - P.z), Math.hypot(ax - P.x, az - P.z));
        if (d >= 1.15 || d >= bd) continue;
        let taken = false;
        for (let n = 0; n < agents.nDrawn && !taken; n++) { const i = agents.drawn[n]; taken = Math.hypot(agents.rx[i] - sx, agents.rz[i] - sz) < 0.4; }
        if (taken) continue;
        bd = d; best = { k: 'slot', e, sl, sx, sz, ax, az };
      }
    }
    if (P.ctx >= 0) {
      const B = bld(P.ctx >> 6);
      if (B && B.floors > 1) elevatorStops(B).forEach((st, k) => {
        const w = toWorld(B, st.x, st.z), d = Math.hypot(w.x - P.x, w.z - P.z);
        if (d < 1.5 && d < bd) { bd = d; best = { k: 'elev', b: B.idx, stop: k }; }
      });
    }
  }
  // other things in reach (render/signs.js: a sign walked up to, or a big one looked at; promotional aircraft): each
  // provider offers { d, html, act } and the nearest wins
  if (!P.tween && P.state === 'walk') for (const fn of app.playerTargets || []) {
    let o = null;
    try { o = fn(P); } catch { o = null; }
    if (o && o.d < bd) { bd = o.d; best = { k: 'ext', html: o.html, act: o.act }; }
  }
  P.target = best;
  let html = '';
  if (best) {
    const K = '<kbd>E</kbd> ';
    if (best.k === 'ext') html = K + best.html;
    else if (best.k === 'stand') html = K + 'Stand up';
    else if (best.k === 'talk') { const p = S.people[best.i]; html = K + `Talk to ${esc(p ? p.n : 'them')}${p && p.v ? ` <span data-avatar>${esc(p.e || '')}</span>` : ''}`; }
    else if (best.k === 'player') html = K + `Talk to ${esc(best.name || 'them')}`;
    else if (best.k === 'elev') html = K + 'Take the elevator';
    else {
      const def = CATALOG[best.e.t], an = CLIP[best.sl.anim];
      const verb = app.arcade?.playable(best.e.t) ? '🕹️ Play' : an === CLIP.lie ? 'Lie down' : SEATED_CLIPS.has(an) ? 'Sit down' : (USES[best.sl.use]?.label || 'Use it');
      html = K + `${esc(verb)} <span class="dim">· ${esc(def.name)}</span>`;
    }
  }
  if (E.prompt._h !== html) { E.prompt._h = html; E.prompt.innerHTML = html; E.prompt.classList.toggle('hidden', !html); }
}
function interact() {
  if (!P.active || busy || app.custOpen) return;
  if (!E.elev.classList.contains('hidden')) return;
  const t = P.target;
  if (!t) return;
  if (t.k === 'vehicle' || t.k === 'vehicleExit') { vehicleInteract(t); return; }
  if (P.air) return;   // land first
  if (t.k === 'ext') { t.act(); promptT = 0; return; }
  if (t.k === 'stand') standUp();
  else if (t.k === 'talk') talk(t.i);
  else if (t.k === 'player') { const r = app.remote?.byPid.get(t.pid); if (r) P.yaw = P.tyaw = Math.atan2(r.extra.x - P.x, r.extra.z - P.z); P.emote = { clip: CLIP.talk, t0: nowS(), dur: 2 }; app.openChat?.(); }
  else if (t.k === 'slot') {
    useSlot(t);
    // an arcade cabinet or game machine: step up to it, then its game (play/arcade.js); leaving it steps back
    if (app.arcade?.playable(t.e.t)) setTimeout(() => { if (P.active && P.state === 'use') app.arcade.playAt(t.e, { onLeave: standUp }); }, 380);
  }
  else if (t.k === 'elev') openElevator(t.b, t.stop);
  promptT = 0;
}
/**
 * The world's outdoor decorations with seats near (x, z) (2026-10-14, the product owner: a dock's benches "aren't
 * functional" — benches, picnic tables placed on the land, a dock's own: shared/dock-layout.js dockDecor): entries like a
 * park's { t, x, z, yaw, y }, from an index by 16 m cell kept while the decorations stay the same.
 */
const DECO_CELL = 16;
let decoIdx = null, decoRef = null;
function decorNear(x, z) {
  const list = S.world?.decorations;
  if (!list?.length) return [];
  if (decoRef !== list) {
    decoRef = list; decoIdx = new Map();
    for (const d of list) {
      if (!CATALOG[d.t]?.slots?.length) continue;
      const k = `${Math.floor(d.x / DECO_CELL)},${Math.floor(d.z / DECO_CELL)}`;
      (decoIdx.get(k) || decoIdx.set(k, []).get(k)).push({ t: d.t, x: d.x, z: d.z, yaw: d.r || 0, y: null, deco: d.id });
    }
  }
  const out = [], i0 = Math.floor(x / DECO_CELL), k0 = Math.floor(z / DECO_CELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let k = k0 - 1; k <= k0 + 1; k++) for (const e of decoIdx.get(`${i},${k}`) || []) {
    if (Math.abs(e.x - x) > 4 || Math.abs(e.z - z) > 4) continue;
    if (e.y === null) e.y = app.terrain?.pointHeight ? app.terrain.pointHeight(e.x, e.z) : GROUND_Y;   // (on the land: its height there)
    out.push(e);
  }
  return out;
}
function useSlot(t) {
  const sl = t.sl, now = nowS();
  P.slot = { x: P.x, z: P.z, ax: t.ax, az: t.az, outY: P.ctx < 0 ? P.y : null };   // (outY: where it stood up from, outdoors)
  P.state = 'use'; P.emote = null; P.vx = P.vz = 0;
  P.useClip = CLIP[sl.anim] ?? CLIP.idle; P.useProp = PROP[sl.prop || 'none'] || 0;
  P.yaw = P.tyaw = t.e.yaw + sl.yaw;
  P.tween = { x0: P.x, z0: P.z, y0: P.y, x1: t.sx, z1: t.sz, y1: t.e.y + (sl.y || 0), t0: now, dur: 0.35 };
  findTarget();
}
function standUp() {
  if (P.state !== 'use') return;
  const s = P.slot;
  P.state = 'walk'; P.slot = null;
  let x1 = P.x, z1 = P.z;
  if (s) { if (!blocked(s.ax, s.az)) { x1 = s.ax; z1 = s.az; } else { x1 = s.x; z1 = s.z; } }
  // (outdoors, beyond the city the land has its own height: a bench on a dock stands well above the city's ground)
  const y1 = P.ctx >= 0 ? floorAt(bld(P.ctx >> 6), P.ctx & 63) : s?.outY ?? GROUND_Y;
  P.tween = { x0: P.x, z0: P.z, y0: P.y, x1, z1, y1, t0: nowS(), dur: 0.3 };
}
async function talk(i) {
  P.yaw = P.tyaw = Math.atan2(agents.rx[i] - P.x, agents.rz[i] - P.z);
  P.emote = { clip: CLIP.talk, t0: nowS(), dur: 3 };
  // an AI agent: its owner's chat window, or a talk through the bar (ui/talk-bar.js — it greets when it only greets)
  if (S.people[i]?.v && app.talk) { app.talk.to(i, { x: P.x, z: P.z }); return; }
  try {
    const r = await post('/api/talk', { i, x: P.x, z: P.z });
    if (r && r.text && S.says) S.says.set(i, { text: r.text, until: S.simT + 10 });
  } catch (err) { app.toast(err.message || String(err), 'bad'); }
}
function jump() {
  if (app.driving?.id) { handbrakeToggle = !handbrakeToggle; refreshVehicleHud(); return; }
  if (P.state === 'use' || P.tween || P.air || !E.elev.classList.contains('hidden')) return;
  if (P.swim) {   // in deep water the jump key dives and comes back up
    if (!P.diving && P.wet && P.wet.level - P.wet.bed < DIVE_MIN) { app.toast('Too shallow to dive here', '', 1500); return; }
    P.diving = !P.diving; P.diveT = nowS(); refreshVehicleHud(); return;
  }
  P.air = true; P.vy = JUMP_V; P.jumpT = nowS(); P.emote = null;
}
function emote(n) {
  if (P.state === 'use' || P.tween) return;
  if (P.emote && P.emote.name === n) { P.emote = null; return; }
  P.emote = { name: n, clip: CLIP[n], t0: nowS(), dur: n === 'dance' ? 1e9 : n === 'wave' ? 2.6 : 2.2 };
}
function openElevator(b, stop) {
  const B = bld(b); if (!B) return;
  P.elev = { b, stop };
  const cur = P.ctx & 63;
  E.elevT.textContent = `🛗 ${B.name}`;
  E.elevGrid.innerHTML = Array.from({ length: B.floors }, (_, f) => `<button class="btn${f === cur ? ' on' : ''}" data-f="${f}" title="Floor ${f + 1}">${f + 1}</button>`).join('');
  E.elev.classList.remove('hidden');
}
function closeElevator() { if (E.elev) E.elev.classList.add('hidden'); P.elev = null; }
async function ride(f2) {
  const el = P.elev; closeElevator();
  if (!el || !P.active) return;
  const B = bld(el.b); if (!B || f2 === (P.ctx & 63) || f2 < 0 || f2 >= B.floors) return;
  busy = true; E.fade.classList.add('on');
  await sleep(280);
  if (!P.active) { busy = false; E.fade.classList.remove('on'); return; }
  const stops = elevatorStops(B), st = stops[el.stop] || stops[0], w = toWorld(B, st.x, st.z);
  P.x = w.x; P.z = w.z; P.ctx = ctxOf(B.idx, f2); P.y = floorAt(B, f2); P.air = false; P.vy = 0;
  P.yaw = P.tyaw = bRot(B) + st.yaw + Math.PI; P.vx = P.vz = 0; P.state = 'walk'; P.slot = null; P.emote = null; P.tween = null;
  setFocus(B.idx, f2);
  cam.target.set(P.x, P.y + 1.1, P.z); cam.goal.copy(cam.target);
  await sleep(170);
  E.fade.classList.remove('on'); busy = false;
  app.toast(`Floor ${f2 + 1}${B.floors > 1 ? ` of ${B.floors}` : ''}`, '', 1300);
}

// ------------------------------------------------------------------ input + HUD
function onKey(e) {
  if (!P.active) return false;
  const c = e.code;
  if (c === 'Escape') {
    // the first Esc frees the captured mouse (the browser does that itself); only the next one leaves
    if (cam.locked || performance.now() - cam.lockEndedAt < 400) { cam.unlockMouse(); return true; }
    if (app.driving?.id) { if (!e.repeat) leaveDriving(); return true; }
    if (!E.elev.classList.contains('hidden')) closeElevator();
    else if (P.state === 'use') standUp();
    else app.setMode('explore');
    return true;
  }
  if (c === 'KeyE') { if (!e.repeat) interact(); return true; }
  if (c === 'Space') { if (!app.driving?.id && !e.repeat) jump(); return true; }
  if (app.driving?.id) return EAT_CODES.has(c) || ['KeyZ', 'KeyX', 'KeyC'].includes(c);
  if (c === 'KeyZ') { if (!e.repeat) emote('wave'); return true; }
  if (c === 'KeyX') { if (!e.repeat) emote('dance'); return true; }
  if (c === 'KeyC') { if (!e.repeat) emote('clap'); return true; }
  if (/^Digit[1-9]$/.test(c) && !E.elev.classList.contains('hidden')) { ride(+c.slice(5) - 1); return true; }
  return EAT_CODES.has(c);
}
function buildHud(root) {
  const keysHtml = 'Mouse look · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> run · <kbd>E</kbd> interact · <kbd>Space</kbd> jump · <kbd>Z</kbd> wave · <kbd>X</kbd> dance · <kbd>C</kbd> clap · <kbd>Esc</kbd> frees the cursor, again leaves';
  E.hud = root.appendChild(h(`<div id="phud" class="hidden"><div class="prompt hidden"></div><div class="keys">${isTouch() ? 'Stick: walk (all the way: run) · drag the world: look · E: interact or talk' : keysHtml}</div></div>`));
  E.prompt = E.hud.querySelector('.prompt');
  E.bar = root.appendChild(h('<div id="playbar" class="panel hidden"><span class="pn"></span><button class="btn small home" title="Go home: your flat, a building on your lot, or the starting point" aria-label="Go home">🏠<span class="pl"> Go home</span></button><button class="btn small look" title="Change how you look" aria-label="My look">🎨<span class="pl"> My look</span></button><button class="btn small leave" title="Leave Play mode (Esc)" aria-label="Leave">✕<span class="pl"> Leave</span></button></div>'));
  E.pn = E.bar.querySelector('.pn');
  E.bar.querySelector('.look').onclick = () => app.openCustomizer?.({ kind: 'player' });
  E.bar.querySelector('.home').onclick = goHome;
  E.bar.querySelector('.leave').onclick = () => { if (app.driving?.id) leaveDriving(); else app.setMode('explore'); };
  E.elev = root.appendChild(h('<div id="elev" class="panel hidden"><div class="row" style="justify-content:space-between"><b class="et">🛗 Elevator</b><button class="btn small icon x" title="Close (Esc)">✕</button></div><div class="hint">Choose a floor</div><div class="grid"></div></div>'));
  E.elevT = E.elev.querySelector('.et'); E.elevGrid = E.elev.querySelector('.grid');
  E.elev.querySelector('.x').onclick = closeElevator;
  E.elevGrid.onclick = e => { const b = e.target.closest('[data-f]'); if (b) ride(+b.dataset.f); };
  E.fade = root.appendChild(h('<div id="fade"></div>'));
  E.joy = root.appendChild(h('<div id="joy" class="hidden"><i></i></div>'));
  E.btns = root.appendChild(h('<div id="pbtns" class="hidden"><button class="btn" data-a="e" title="Interact">E</button><button class="btn" data-a="jump" title="Jump">⤒</button><button class="btn hidden" data-a="run" title="Boost (from a stop: burnout)">🔥</button><button class="btn chat" data-a="chat" title="Chats with your agents">💬</button></div>'));
  const knob = E.joy.querySelector('i');
  const moveJoy = e => {
    const r = E.joy.getBoundingClientRect(), r0 = r.width / 2;
    let dx = (e.clientX - r.left - r0) / r0, dy = (e.clientY - r.top - r0) / r0;
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    joy.x = dx; joy.y = dy;
    knob.style.transform = `translate(${(dx * r0 * 0.6).toFixed(1)}px, ${(dy * r0 * 0.6).toFixed(1)}px)`;
  };
  E.joy.addEventListener('pointerdown', e => { joy.on = true; joy.id = e.pointerId; E.joy.setPointerCapture?.(e.pointerId); moveJoy(e); e.preventDefault(); });
  E.joy.addEventListener('pointermove', e => { if (joy.on && e.pointerId === joy.id) moveJoy(e); });
  const endJoy = e => { if (e.pointerId !== joy.id) return; joy.on = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  E.joy.addEventListener('pointerup', endJoy);
  E.joy.addEventListener('pointercancel', endJoy);
  E.btns.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.a === 'e') interact();
    else if (b.dataset.a === 'jump') jump();
    else if (b.dataset.a === 'run') { runToggle = !runToggle; b.classList.toggle('on', runToggle); }
    else if (b.dataset.a === 'chat') document.querySelector('#floatbtns .fb-chat .chat:not([disabled])')?.click();   // the chat window (ui/chat.js)
  });
}
