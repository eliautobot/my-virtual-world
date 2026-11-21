// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Taking a boat out from a fishing dock (docs/features/fishing.md §Boats). Walk down the dock in Play mode to a free boat
// and press E; the server gives it to you (server/world/boats.js) and this page drives it with the shared boat model
// (shared/boat-model.js) at 60 Hz, floating on the waves the screen shows (render/sea-probe.js), your character at the
// helm, a chase camera behind, the gauges on screen, its wake and spray (render/boat-fx.js); the pose goes to the
// server ten times a second. Stopped alongside a dock or the shore, E steps off. Everyone else's boats near you are
// drawn here too (one instanced mesh per type, smoothed between the server's five updates a second).
//
// Leave the wheel (F) and walk about the deck (shared/boat-model.js deck: its floors, up a step on to a casting deck,
// round the console — never over the side) to a fishing spot (a ring on the deck) and fish from it (E); the lever goes
// to neutral as you leave the wheel (the boat drifts, or lies to its anchor). Where you stand and what you're doing
// go to the server with the boat's pose, so everyone sees you there.
//
//   At the wheel — W / S (↑ ↓): the throttle lever forward / back (through neutral to reverse) · A / D (← →): the
//   wheel · Space: the lever to neutral · Q: drop or raise the anchor · E: step off (stopped, alongside) · F: walk
//   On deck — WASD: walk · E: fish here / take the wheel / stand up · Q: the anchor · F: back to the wheel
//   Esc: leave. Phone: the wheel on the left (slide), the lever on the right (slide; a notch at neutral), Anchor,
//   Neutral, Walk, Off; on deck the stick walks, Fish / Wheel, Anchor.
//
// Fishing together (2026-11-19, co-op): walk up to a boat that's out and stopped and press E to come aboard — the
// skipper's friends at once, anyone else when the skipper says yes (a note on their screen) — as its crew: the boat is
// theirs to drive (drawn here from the harbour's poses, smoothed), you walk its deck and fish from its spots; E at no
// spot steps off when it's stopped alongside, Esc leaves (the harbour launch takes you back to the dock).
//
// app.boating: { active, guest, state(), type, module, id, frame, walking, fishing, deckToWorld, act } — the fishing game uses it.
import * as THREE from 'three';
import { S, bus, holdView, releaseView } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { auth } from '../core/auth.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE } from '../render/anim.js';
import { BOATS, newBoat, stepBoat, hullOf, boatQuat, boatPoint, knots, walkDeck, spotNear } from '/shared/boat-model.js';
import { moduleDecks, moduleBoxes, modulesOf, WORLD_KINDS } from '/shared/world-modules.js';
import { WORLD_HALF } from '/shared/island-chain.js';
import { boatParts, boatGeometry, HULL_FORM } from '../render/boat-models.js';
import { hullAt } from '../render/water-marks.js';
import { heights, waterUnder, probeFrames, surfPush } from '../render/sea-probe.js';
import { BoatFx } from '../render/boat-fx.js';

const DT = 1 / 60, SEND_MS = 100, BOARD_D = 6, WALK = 1.35, REACH = 0.8;
const CAM = { coastal: { dist: 15, pitch: 0.22 }, skiff: { dist: 11, pitch: 0.24 } };
const DECK_CAM = { coastal: { dist: 6.5, pitch: 0.34 }, skiff: { dist: 5.5, pitch: 0.36 } };
const B = { active: false, guest: null, rb: null, s: null, id: null, type: null, module: null, mesh: null, motors: [], acc: 0, sentAt: 0, keys: new Set(), pending: false, leaving: false, ending: false,
  touch: { steer: 0, lever: null, neutral: false, anchor: false }, lastT: 0, real: 0, water: null, solids: [], solidsAt: -1e9,
  walk: null,   // on deck, off the wheel: { x, y, z (boat frame), yaw (0 the bow), fish (the spot fished from, or -1), dist (walked), moving, pose (a clip the fishing game asks for) }
  clip: CLIP.helm, pclip: CLIP.helm, pph: 0, fadeT: 0, ph: 0, camH: null, rings: null };
let app = null, E = {}, mat = null, fx = null, remote = new Map(), rmesh = {}, pressed = { neutral: false, anchor: false }, aboard = new Map();   // (aboard: pid → { boat, x, y, z, yaw } — the players aboard the boats near, on their decks)
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1), _pv = new THREE.Vector3(), _qv = new THREE.Quaternion();

export function init(a) {
  app = a;
  (app.playerTargets ||= []).push(target);
  app.hooks.key.unshift(onKey);
  window.addEventListener('keydown', e => { if (B.active && !typing(e)) { B.keys.add(e.code); if (e.code === 'Space' && !e.repeat && !B.walk) pressed.neutral = true; if (e.code === 'KeyQ' && !e.repeat) pressed.anchor = true; } });
  window.addEventListener('keyup', e => B.keys.delete(e.code));
  window.addEventListener('blur', () => B.keys.clear());
  bus.on('msg:bstate', m => { app.net.take?.('bstate'); onState(m); });
  bus.on('msg:bcorr', m => { if (B.active && m.pose) { B.s.x = m.pose.x; B.s.z = m.pose.z; B.s.u = B.s.v = 0; B.prev?.p.set(m.pose.x, B.s.y, m.pose.z); } });
  bus.on('msg:pmoved', m => { if (m.boat === 'out' && B.active) end(m); });
  // (driving a boat the harbour doesn't give this player — the server restarted, the boat went home —: let go of it, where the
  //  server has the player; 2026-11-19: a page kept steering the old boat, and the one it took next "wasn't moving")
  bus.on('msg:bgone', m => { if (!B.active) return; end({ x: m.x, y: m.y, z: m.z }); if (m.text) app.toast(`⚓ ${m.text}`, '', 3600); });
  bus.on('msg:harbour', onHarbour);
  // (your boat: someone asks to come aboard — a yes from you lets them on; the crew coming and going)
  bus.on('msg:bask', m => { if (!B.active || B.guest) return; app.toast(`${m.name || 'Someone'} wants to come aboard and fish with you`, '', 30000, '', '', { label: 'Let them aboard', run: () => app.net.send({ t: 'banswer', who: m.from, yes: true }) }); });
  bus.on('msg:bcrew', m => { if (B.active && m.text) app.toast(`🚤 ${m.text}`, '', 3000); if (B.active) B.crew = m.crew || B.crew; });
  bus.on('mode', m => { if (m !== 'play' && B.active) leave(); });
  bus.on('frame', (dt, now) => { drawRemote(dt); effects(dt, now / 1000); if (B.top && B.render && B.s) B.top.visible = !B.walk || !topInTheWay(B.walk, B.render, B.s.heading); });   // (the canopy: once the camera has moved this frame)
  buildHud(document.getElementById('ui'));
  buildTouch(document.getElementById('ui'));
  // (loaded after the page connected: its boat, if the server keeps one for its player — told then, kept by core/net.js —
  //  and asked again once the page is ready (every module, its player's own, loaded), so a page never shows its player
  //  swimming while the server has them at the helm; and asked whenever Play mode begins)
  const ask = () => { if (!app.net.send({ t: 'bresync' })) { const off = bus.on('net', on => { if (on) { off(); app.net.send({ t: 'bresync' }); } }); } };
  const ready = () => { const held = app.net.take?.('bstate'); if (held) onState(held); ask(); };
  if (app.ready) ready(); else { const off = bus.on('ready', () => { off(); ready(); }); }
  bus.on('mode', m => { if (m === 'play' && !B.active && app.ready) ask(); });
  app.boating = {
    get active() { return B.active; }, get type() { return B.type; }, get module() { return B.module; }, get id() { return B.id; },
    /** Aboard someone else's boat as its crew: { skipper (account id), name } — or null (your own boat, or none). */
    get guest() { return B.guest ? { ...B.guest } : null; },
    state: () => B.s, frame, envNow: () => (B.s ? envFor(B.s) : null),   // (envNow: the water and docks as it feels them: checks)
    /** On deck (off the wheel): { x, y, z, yaw, fish } in the boat's frame, or null at the wheel. */
    get walking() { return B.walk; },
    /** The spot being fished from ({ i, x, y, z, yaw, name }: shared/boat-model.js deck spots), or null. */
    get fishing() { const W = B.walk; return W && W.fish >= 0 ? { i: W.fish, ...BOATS[B.type].deck.spots[W.fish] } : null; },
    /** A point in the boat's frame where it is drawn now: a THREE.Vector3 (the fishing game hangs the line off it). */
    deckToWorld: (x, y, z, out = new THREE.Vector3()) => { const s = B.s, R = B.render; if (!s) return null; const q = boatPoint({ ...s, x: R.p.x, y: R.p.y, z: R.p.z }, x, y, z); return out.set(q.x, q.y, q.z); },
    /** The fishing game's clip while fishing (CLIP.fish_cast, fish_reel…; null: back to holding the rod ready), at phase ph (null: by the clock). */
    pose: (clip, ph = null) => { if (B.walk) { B.walk.pose = clip ?? null; B.walk.poseph = ph; } },
    /** Held to the spot (a fish on, a cast going out): the walking keys and E don't move you or stand you up. */
    hold: on => { if (B.walk) B.walk.hold = !!on; },
    walk: on => setWalk(on), act: () => deckAct(),
    /** Back to the dock? — asked first (Esc, the play bar's Leave). */
    askLeave: () => askLeave(true),
    /** Auto-cruise to { x, z, label } (the fishing chart's course), or null to stop: the boat steers for it round the shallows and stops there. */
    cruise: to => { if (B.guest) { if (to) app.toast(`${B.guest.name || 'The skipper'} is at the wheel`, '', 2400); return; } B.cruise = to && B.active ? { ...to } : null; B.cruiseLever = B.touch.lever; if (to && B.walk) setWalk(false); bus.emit('boat-cruise', { on: !!B.cruise, to: B.cruise }); },
    get cruising() { return B.cruise; },
    /** Where player pid stands aboard a boat out near here, as this page draws that boat now: { x, y, z, yaw } — or null
     *  (not aboard one; the harbour's rows: server/world/boats.js tick aboard). */
    aboardAt: pid => {
      const a = aboard.get(pid); if (!a) return null;
      const q = app.boating.poseOf(a.boat); if (!q) return null;
      const w = boatPoint({ x: q.x, y: q.y, z: q.z, heading: q.heading, pitch: q.pitch, roll: q.roll }, a.x, a.y, a.z);
      return { x: w.x, y: w.y, z: w.z, yaw: q.heading + a.yaw };
    },
    /** A boat out as this page draws it now — its own, or anyone else's near: { x, y, z, heading, pitch, roll, type } or null
     *  (the companions aboard are drawn at their spots on it: render/boat-crew.js). */
    poseOf: id => {
      if (B.active && id === B.id && B.s && B.render) return { x: B.render.p.x, y: B.render.p.y, z: B.render.p.z, heading: B.s.heading, pitch: B.s.pitch, roll: B.s.roll, type: B.type };
      const r = remote.get(id);
      return r ? { x: r.x, y: r.y, z: r.z, heading: r.h, pitch: r.p, roll: r.r, type: r.type } : null;
    },
    debug: () => ({ keys: [...B.keys], t: B.s?.t, acc: B.acc, lastT: B.lastT, leaving: B.leaving, walk: B.walk && { ...B.walk }, top: B.top?.visible, topBox: B.topBox, 
      cam: app.stage.camera.position.toArray().map(v => +v.toFixed(2)), boat: B.render?.p.toArray().map(v => +v.toFixed(2)), h: B.s?.heading }),
  };
}
const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
const label = type => BOATS[type]?.label || 'boat';

// ------------------------------------------------------------------ boarding
/** The boats a walking player could take: free ones in their slips, and ones moored where someone left them. */
function candidates() {
  const out = [];
  for (const s of app.marinas?.slips || []) if (!app.marinas.isAway(s.id)) out.push({ id: s.id, type: s.kind, x: s.x, z: s.z, y: s.y });
  for (const r of remote.values()) if (!r.out) out.push({ id: r.id, type: r.type, x: r.x, z: r.z, y: r.y });
  return out;
}
function target(P) {
  if (B.active || B.pending || app.flight?.active || !auth.can('play.use') || P.ctx !== -1) return null;
  let best = null, bd = BOARD_D;
  for (const c of candidates()) {
    if (Math.abs(P.y - c.y) > 3) continue;
    const d = Math.hypot(c.x - P.x, c.z - P.z) - BOATS[c.type].L * 0.45;
    if (d < bd) { bd = d; best = c; }
  }
  // (someone's boat out and stopped close by: aboard as its crew, to fish together)
  for (const r of remote.values()) {
    if (!r.out || !r.skipper || Math.abs(r.v || 0) > 1.5 || Math.abs(P.y - r.y) > 4) continue;
    const d = Math.hypot(r.x - P.x, r.z - P.z) - BOATS[r.type].L * 0.5;
    if (d < bd) { bd = d; best = { id: r.id, type: r.type, crewOf: r.skipper }; }
  }
  if (!best) return null;
  if (best.crewOf) return { d: Math.max(0.1, bd), html: `Come aboard ${esc(best.crewOf)}'s ${esc(label(best.type))} <span class="dim">· fish together</span>`, act: () => join(best) };
  return { d: Math.max(0.1, bd), html: `Take the ${esc(label(best.type))} <span class="dim">· ${BOATS[best.type].icon}</span>`, act: () => board(best) };
}
/** Asks to come aboard someone's boat (their friend: at once; anyone else: when they say yes). */
function join(c) {
  if (B.pending || B.active) return;
  B.pending = true;
  app.net.send({ t: 'bjoin', id: c.id });
  setTimeout(() => { if (B.pending) { B.pending = false; app.toast('No answer from the boat — try again', 'bad', 3000); } }, 5000);
}
function board(c) {
  if (B.pending || B.active) return;
  B.pending = true;
  app.net.send({ t: 'bboard', id: c.id });
  setTimeout(() => { if (B.pending) { B.pending = false; app.toast('No answer from the dock — try again', 'bad', 3000); } }, 5000);
}
function onState(m) {
  B.pending = false;
  if (!m.ok && m.none) return;   // (asked where its player is: on no boat — nothing to draw)
  // (back at the helm — or aboard someone's boat — after a reload: in Play mode, as they were; not yet loaded: when it is)
  if (m.ok && m.resumed && !app.ready) { const off = bus.on('ready', () => { off(); onState(m); }); return; }
  if (m.ok && m.resumed && S.mode !== 'play') { app.setMode?.('play'); if (S.mode !== 'play') return; }
  if (!m.ok) { app.toast(m.text || 'Not now', m.pending ? '' : 'bad', m.pending ? 5000 : 3500); return; }
  if (B.active) {
    // (aboard as crew already, the same boat: who's aboard now)
    if (m.guest && B.guest && m.id === B.id) { B.crew = m.crew || B.crew; return; }
    // (its own boat, kept for it across the server's restart: where the server has it now)
    if (m.resumed && m.id === B.id && m.pose && B.s && !m.guest && !B.guest) { Object.assign(B.s, { x: m.pose.x, z: m.pose.z, heading: m.pose.h, u: 0, v: 0 }); B.prev?.p.set(m.pose.x, B.s.y, m.pose.z); return; }
    // (another boat given to it while this page still drove an old one: the server's is the one — never ignored)
    const P = app.player;
    end({ x: P?.x ?? m.pose.x, y: P?.y ?? m.pose.y, z: P?.z ?? m.pose.z });
  }
  start(m);
}

// ------------------------------------------------------------------ out on the water
function start(m) {
  const P = app.player, Sx = BOATS[m.type], pose = m.pose, w = waterUnder(pose.x, pose.z);
  B.s = newBoat(m.type, pose.x, w ? w.level : pose.y, pose.z, pose.h, app.fishStore?.boatKit?.() || {});   // (your engine and anchor upgrades, the seamanship skill: play/fish-store.js)
  if (m.resumed) { B.s.y = pose.y; B.s.pitch = pose.p || 0; B.s.roll = pose.r || 0; }
  Object.assign(B, { active: true, id: m.id, type: m.type, module: m.module, acc: 0, sentAt: 0, leaving: false, ending: false, lastT: 0, water: w, walk: null, clip: CLIP.helm, pclip: CLIP.helm, camH: null, camY: null,
    guest: m.guest ? { skipper: m.skipper, name: m.skipperName || 'the skipper' } : null, crew: m.crew || null, rb: null });
  if (B.guest) {   // (its crew: the boat where the harbour says, on the deck where you stood — or at your fishing spot)
    B.s.y = pose.y; B.s.pitch = pose.p || 0; B.s.roll = pose.r || 0;
    B.rb = { x: pose.x, y: pose.y, z: pose.z, h: pose.h, p: pose.p || 0, r: pose.r || 0, v: 0, vx: 0, vz: 0, tx: pose.x, ty: pose.y, tz: pose.z, th: pose.h, tp: pose.p || 0, tr: pose.r || 0, at: performance.now() };
    const sp = Sx.deck.spots[m.spot] || Sx.deck.spots[0], at = m.dk?.at || [sp.x, sp.y, sp.z];
    B.walk = { x: at[0], y: at[1], z: at[2], yaw: m.dk ? m.dk.yaw || 0 : sp.yaw, fish: -1, dist: 0, moving: false, pose: null };
  }
  holdView('Boat', B.guest ? 'To get off: when the boat is stopped alongside, press E away from a fishing spot — or Esc to go back to the dock' : 'To get off the boat: stop at a dock and press E, or press Esc');   // (only getting off lets go of the view: core/state.js holdView)
  B.prev = { p: new THREE.Vector3(B.s.x, B.s.y, B.s.z), q: new THREE.Quaternion() };
  B.render = { p: B.prev.p.clone(), q: new THREE.Quaternion() };
  B.keys.clear();
  app.marinas?.hide(m.id, true);
  mat ||= app.airports?.material || new THREE.MeshStandardMaterial({ vertexColors: true });
  const parts = boatParts(m.type);
  B.mesh = new THREE.Mesh(parts.body, mat); B.mesh.castShadow = true; B.mesh.frustumCulled = false; B.mesh.name = 'my-boat';
  B.motors = parts.motors.map(mt => { const o = new THREE.Mesh(parts.motor, mat); o.position.set(...mt.at); o.castShadow = true; B.mesh.add(o); return o; });
  B.top = parts.top ? new THREE.Mesh(parts.top, mat) : null; B.topBox = parts.topBox;
  if (B.top) { B.top.castShadow = true; B.mesh.add(B.top); }
  app.stage.scene.add(B.mesh);
  if (P?.active) {
    P.onVehicleEnter?.({ keys: B.guest ? `Aboard ${B.guest.name}'s ${Sx.label}: WASD walk the deck · E fish from a spot / step off when stopped alongside · Esc back to the dock` : matchMedia('(pointer: coarse)').matches ? `${Sx.label}: the lever (right) ahead or astern · the wheel (left) steers · ⚓ anchor · stop alongside a dock to step off` : `${Sx.label}: W/S throttle lever (through neutral to reverse) · A/D wheel · Space neutral · Q anchor · E step off when stopped alongside` });
    if (!app.agents.extra.includes(P.extra)) app.agents.extra.push(P.extra);   // (you're seen at the helm, not hidden as in a car)
    const narrow = innerWidth < 760;
    const cm = B.guest ? DECK_CAM : CAM;
    app.cam.goalDist = cm[m.type].dist * (narrow ? (B.guest ? 1.25 : 1.3) : 1); app.cam.goalPitch = cm[m.type].pitch; app.stage.camera.fov = narrow ? 70 : 62;
    app.cam.rates = { follow: 10, turn: 3.5 };
  }
  document.body.classList.add('boating');
  document.body.classList.toggle('boat-guest', !!B.guest);
  E.hud.classList.remove('hidden');
  E.name.textContent = B.guest ? `${Sx.icon} ${B.guest.name}'s ${Sx.label}` : `${Sx.icon} ${Sx.label}`;
  E.touch.classList.toggle('hidden', !isTouch());
  modeUi();
  bus.emit('boating', { on: true, type: m.type, module: m.module, guest: !!B.guest });
  if (B.guest && !m.resumed) app.toast(`🚤 Aboard ${B.guest.name}'s boat — walk to a fishing spot (a ring on the deck) and press E`, 'good', 4200);
}
/** Off the boat (the server put the player on the dock or the shore). */
function end(m) {
  if (!B.active) return;
  E.leave?.classList.add('hidden');
  const P = app.player;
  B.active = false; B.ending = false; B.leaving = false; B.walk = null; B.guest = null; B.rb = null; B.crew = null;
  releaseView('Boat');
  if (B.mesh) { app.stage.scene.remove(B.mesh); B.mesh = null; B.motors = []; }   // (the geometry is shared: kept)
  if (B.rings) B.rings.visible = false;
  document.body.classList.remove('boating', 'boat-walk', 'boat-guest');
  E.hud.classList.add('hidden'); E.touch.classList.add('hidden');
  Object.assign(B.touch, { steer: 0, lever: null });
  P?.onVehicleExit?.({ x: m.x, y: m.y, z: m.z });
  B.s = null; B.type = null; B.id = null; B.keys.clear();
  bus.emit('boating', { on: false });
}
function input() {
  if (B.walk) { const out = { anchor: pressed.anchor || B.touch.anchor }; pressed.neutral = pressed.anchor = false; B.touch.neutral = B.touch.anchor = false; return out; }   // (on deck: nobody at the wheel)
  const k = c => B.keys.has(c), ax = (a, b) => (k(a) ? 1 : 0) - (k(b) ? 1 : 0), T = B.touch, j = app.player?.joy;
  const lever = ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown'), steer = Math.max(-1, Math.min(1, ax('KeyD', 'KeyA') + ax('ArrowRight', 'ArrowLeft') + T.steer + (j?.on ? j.x : 0)));
  const out = { lever: Math.sign(lever), steer, neutral: pressed.neutral || T.neutral, anchor: pressed.anchor || T.anchor };
  if (T.lever !== null && !B.cruise) out.leverTo = T.lever;
  if (B.cruise) {   // a hand on the wheel or the lever takes over
    if (lever || Math.abs(steer) > 0.05 || out.neutral || (T.lever !== null && T.lever !== B.cruiseLever)) { B.cruise = null; app.toast('Cruise off — you have the wheel', '', 1800); bus.emit('boat-cruise', { on: false }); }
    else Object.assign(out, autopilot(B.s));
  }
  pressed.neutral = pressed.anchor = false; T.neutral = T.anchor = false;
  return out;
}
/**
 * Auto-cruise: the heading for the course, or the nearest one either side that keeps deep water ahead (sampled out to
 * 70 m: round a point, off the shallows), the lever by how far it is still (easing in, a hard turn slower), stopping on
 * arrival. → { leverTo, steer }.
 */
function autopilot(s) {
  const C = B.cruise, dx = C.x - s.x, dz = C.z - s.z, d = Math.hypot(dx, dz), T = app.terrain;
  const stop = (text, kind = 'good') => { B.cruise = null; B.touch.lever = null; E.setLever?.(0); app.toast(text, kind, 2600); bus.emit('boat-cruise', { on: false, arrived: kind === 'good' }); return { leverTo: 0 }; };
  if (s.aground) return stop('⚠️ Aground — the cruise is off: back her off (S)', 'bad');
  if (d < Math.max(20, C.r || 0)) return stop(`⚓ Arrived${C.label ? `: ${C.label}` : ''}`);
  const depthAt = (x, z) => { const w = T?.ground?.water(x, z); return w ? w.level - T.pointHeight(x, z) : 0; }, safe = s.S.draft + 0.9, floor = s.S.draft + 0.35;
  const deep = (h, far) => { for (const r of [12, 28, 45, 70]) { if (r > far + 10) break; if (depthAt(s.x + Math.sin(h) * r, s.z + Math.cos(h) * r) < safe) return false; } return true; };
  // close to a mark in shallow water (a rocky shore, the flats): as near as the depth lets it
  if (d < 140 && depthAt(s.x + Math.sin(s.heading) * 10, s.z + Math.cos(s.heading) * 10) < floor && depthAt(s.x + Math.sin(s.heading) * 20, s.z + Math.cos(s.heading) * 20) < floor) return stop(`⚓ As close as the depth allows${C.label ? `: ${C.label}` : ''} (${Math.round(d)} m)`);
  const want = Math.atan2(dx, dz);
  let head = want;
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.35, -1.35, 1.8, -1.8]) if (deep(want + off, d)) { head = want + off; break; }
  const err = angDiff(s.heading, head), steer = Math.max(-1, Math.min(1, -err * 2.2));
  const shallow = depthAt(s.x, s.z) < safe + 1;   // (in the shallows: dead slow)
  const lv = (d > 160 && !shallow ? 0.85 : d > 70 && !shallow ? 0.5 : 0.24) * (Math.abs(err) > 0.9 ? 0.45 : 1);
  return { leverTo: lv, steer };
}
/** The water as the boat feels it: its surface under the hull (the probe), the depth, the docks, the wind, the edge. */
function envFor(s) {
  const w = B.water || waterUnder(s.x, s.z);
  const T = app.terrain, level = w ? w.level : s.y, lake = !!w?.lake;
  // the water at each of the hull's points (shared/boat-model.js hullOf), asked where they'll be when the answers come
  // (the probe's are a few frames old: render/sea-probe.js)
  const ahead = probeFrames(lake) * (B.real || 1 / 60), vx = (Math.sin(s.heading) * s.u - Math.cos(s.heading) * s.v) * ahead, vz = (Math.cos(s.heading) * s.u + Math.sin(s.heading) * s.v) * ahead;
  const water = pts => heights(`boat:${B.id}`, pts.map(p => ({ x: p.x + vx, z: p.z + vz })), level, lake);
  // asked every frame, stepped or not (a frame with no step of its own let the probe drop its points: for a few frames
  // after, the boat felt a stand-in sea — jumps in the water under it, 2026-10-15)
  water(hullOf(s.S).el.map(e => boatPoint(s, e.x, e.y, e.z)));
  const now = performance.now();
  if (now - B.solidsAt > 1000) { B.solidsAt = now; B.solids = nearSolids(s.x, s.z); }   // the docks within reach: rectangles to hit
  const W = app.terrain?.weather?.wind, wind = W ? { x: Math.cos(W.dir) * W.speed, z: Math.sin(W.dir) * W.speed } : { x: 0, z: 0 };
  return {
    water, level, wind, push: lake ? null : (x, z) => surfPush(x, z, level),   // (the surf's shove toward the shore)
    depth: (x, z) => { const ww = T?.ground?.water(x, z); return ww ? Math.max(0, ww.level - T.pointHeight(x, z)) : 0; },
    solid: (x, z) => B.solids.some(r => Math.abs((x - r.x) * r.c - (z - r.z) * r.n) <= r.hw && Math.abs((x - r.x) * r.n + (z - r.z) * r.c) <= r.hd),
    rects: B.solids,   // (their shapes: the hull pushed off them and sliding along — shared/boat-model.js dockContact)
    limit: (x, z) => Math.abs(x) > WORLD_HALF - 250 || Math.abs(z) > WORLD_HALF - 250,
  };
}
/** The docks' decks and walls near (x, z), as rectangles the hull can't pass: { x, z, hw, hd, c, n }. */
function nearSolids(x, z) {
  const out = [], add = r => { if (Math.hypot(r.x - x, r.z - z) < 160 + Math.hypot(r.hw, r.hd)) out.push({ x: r.x, z: r.z, hw: r.hw + 0.05, hd: r.hd + 0.05, c: Math.cos(r.rot), n: Math.sin(r.rot) }); };
  for (const d of moduleDecks(S.world)) if (d.kind !== 'gang') add(d);
  for (const b of moduleBoxes(S.world)) add(b);
  return out;
}
/** Every frame out on the water (player.js hands the frame over). */
function frame(P, dt, t) {
  if (!B.active || !B.s) return;
  const s = B.s, Sx = s.S;
  if (B.guest) guestFollow(s, t);
  else if (!B.leaving) {
    const env = envFor(s), inp = app.custOpen || app.mapOpen ? {} : input();
    const real = B.lastT ? Math.max(0, t - B.lastT) : dt; B.lastT = t;
    B.acc = Math.min(B.acc + real, 0.5); B.real = Math.min(real, 0.5);
    while (B.acc >= DT) {
      B.prev.p.set(s.x, s.y, s.z); const q0 = boatQuat(s); B.prev.q.set(q0.x, q0.y, q0.z, q0.w);
      for (const ev of stepBoat(s, inp, env, DT)) onEvent(ev);
      inp.neutral = inp.anchor = false; B.acc -= DT;
    }
  }
  // drawn between the last two steps (the frame rate wanders; the model doesn't)
  const al = Math.min(1, B.acc / DT), R = B.render, q = boatQuat(s);
  R.p.copy(B.prev.p).lerp(_pv.set(s.x, s.y, s.z), al);
  R.q.copy(B.prev.q).slerp(_qv.set(q.x, q.y, q.z, q.w), al);
  B.mesh.position.copy(R.p); B.mesh.quaternion.copy(R.q);
  for (const o of B.motors) { o.rotation.y = -s.wheel * Sx.turn.lock * 0.8; o.rotation.x = -0.05 * s.planing; }   // the outboards swing with the wheel
  // you: at the wheel, or wherever you've walked on deck (the boat's heave, pitch and roll carry you)
  const W = B.walk;
  if (W && !B.leaving) walkStep(dt, s);
  const at = W ? [W.x, W.y, W.z] : Sx.helm, yaw = s.heading + (W ? W.yaw : 0);
  const hm = boatPoint({ ...s, x: R.p.x, y: R.p.y, z: R.p.z }, at[0], at[1], at[2]);
  P.x = hm.x; P.y = hm.y; P.z = hm.z; P.ctx = -1; P.yaw = P.tyaw = yaw;
  const clip = !W ? CLIP.helm : W.fish >= 0 ? (W.pose ?? CLIP.fish_idle) : W.moving ? CLIP.walk : CLIP.idle;
  if (clip !== B.clip) { B.pclip = B.clip; B.pph = B.ph; B.fadeT = t; B.clip = clip; }
  B.ph = W && W.fish >= 0 && W.poseph != null ? W.poseph : CLIP_STRIDE[clip] > 0 && W ? (W.dist / CLIP_STRIDE[clip]) % 1 : (t / Math.max(0.3, CLIP_DUR[clip])) % 1;
  const X = P.extra; if (X) { X.x = hm.x; X.y = hm.y; X.z = hm.z; X.yaw = yaw; X.clip = clip; X.ph = B.ph; X.pclip = B.pclip; X.pph = B.pph; X.w = Math.max(0, 1 - (t - B.fadeT) / 0.25); X.flags = 0; X.prop = 0; }
  rings(W, R);
  const cam = app.cam;
  if (!W) {   // at the wheel: the chase camera behind and a little above, turning with the boat
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
    // (its height eased: the camera rides the swell with it but not every bump and slam — the way boat games hold the
    // view steady, 2026-10-15)
    B.camY = B.camY == null ? R.p.y : B.camY + (R.p.y - B.camY) * (1 - Math.exp(-(B.real || 1 / 60) * 2.2));
    cam.follow = () => ({ x: R.p.x + fx * 2, y: B.camY + 1.6, z: R.p.z + fz * 2 });
    cam.goalYaw = cam.yaw + angDiff(cam.yaw, s.heading + Math.PI);
  } else {   // on deck: following you, free to look about — and swinging round with the boat as it turns
    cam.follow = () => ({ x: hm.x, y: hm.y + 1.15, z: hm.z });
    const dh = angDiff(B.camH ?? s.heading, s.heading); cam.goalYaw += dh; cam.yaw += dh;
  }
  B.camH = s.heading;
  cam.followDt = B.leaving ? 0 : B.real;
  if (S.focus.b >= 0) app.setFocus?.(-1);
  const now = performance.now();
  if (now - B.sentAt > SEND_MS && !B.leaving && B.guest) {   // (its crew: only where you stand and what you're doing)
    B.sentAt = now;
    app.net.send({ t: 'bdeck', dk: [+at[0].toFixed(2), +at[1].toFixed(2), +at[2].toFixed(2), +(W ? W.yaw : 0).toFixed(2), clip] });
  } else if (now - B.sentAt > SEND_MS && !B.leaving) {
    B.sentAt = now;
    app.net.send({ t: 'bpose', ts: +s.t.toFixed(3), x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), h: +s.heading.toFixed(4), p: +s.pitch.toFixed(3), r: +s.roll.toFixed(3), v: +s.u.toFixed(2), l: +s.lever.toFixed(2), an: s.anchor ? 1 : 0,
      dk: [+at[0].toFixed(2), +at[1].toFixed(2), +at[2].toFixed(2), +(W ? W.yaw : 0).toFixed(2), clip] });   // (where you stand on it, what you're doing)
  }
  hud(s, t);
}
/** Aboard as crew: the boat where the harbour has it (five times a second), smoothed and run on a little — the deck you
 *  walk moves with it. */
function guestFollow(s, t) {
  const b = B.rb; if (!b) return;
  const real = B.lastT ? Math.max(0, Math.min(0.5, t - B.lastT)) : 1 / 60; B.lastT = t; B.real = real;
  const k = 1 - Math.exp(-real * 8), ahead = Math.min(0.5, (performance.now() - b.at) / 1000);
  b.x += (b.tx + b.vx * ahead - b.x) * k; b.z += (b.tz + b.vz * ahead - b.z) * k; b.y += (b.ty - b.y) * k;
  b.h += angDiff(b.h, b.th) * k; b.p += (b.tp - b.p) * k; b.r += (b.tr - b.r) * k;
  s.x = b.x; s.y = b.y; s.z = b.z; s.heading = b.h; s.pitch = b.p; s.roll = b.r; s.u = b.v || 0; s.lever = b.l || 0; s.anchor = !!b.an;
  const q = boatQuat(s);
  B.prev.p.set(s.x, s.y, s.z); B.prev.q.set(q.x, q.y, q.z, q.w); B.acc = 0;
}
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
function onEvent(ev) {
  if (ev === 'aground') app.toast('⚠️ Aground — back off (S) into deeper water', 'bad', 2600);
  else if (ev === 'bump') app.toast('Bump!', '', 1200);
  // (the lever pushing it into a dock it can't pass, too slow to bump: held there without a word — "the boat wouldn't
  //  move", 2026-11-17 — said, once every few seconds: back off the other way)
  else if (ev === 'pinned') { const now = performance.now(); if (now - (B.pinnedSaid || 0) > 5000) { B.pinnedSaid = now; app.toast(B.s?.lever > 0 ? '⚓ Against the dock ahead — back off with S (reverse), then steer away' : '⚓ Against the dock behind — go ahead with W, then steer away', 'bad', 3200); } }
  else if (ev === 'anchor-down') app.toast('⚓ Anchor down', 'good', 1800);
  else if (ev === 'anchor-up') app.toast('⚓ Anchor up', '', 1500);
  else if (ev === 'plane') bus.emit('boat-plane');
  bus.emit('boat-event', ev);
}
function exit() {
  const s = B.s; if (!s || B.ending) return;
  if (B.walk) { deckAct(); return; }
  stepOff();
}
/** Off the boat: stopped alongside a dock or the shore (the server decides where you step). */
function stepOff() {
  const s = B.s; if (!s || B.ending) return;
  if (Math.abs(s.u) > 1.5) { app.toast(B.guest ? `Wait for ${B.guest.name} to stop` : 'Stop first (Space: the lever to neutral)', 'bad', 2200); return; }
  B.ending = true;
  app.net.send({ t: 'bexit' });
  setTimeout(() => { B.ending = false; }, 3000);
}
function leave() {
  if (!B.active || B.leaving) return;
  B.leaving = true;
  app.net.send({ t: 'bleave' });
  setTimeout(() => { B.leaving = false; if (B.active) end({ x: B.s?.x ?? 0, y: 0, z: B.s?.z ?? 0 }); }, 4000);
}
/** Back to the dock? (Esc): what leaving now means — the trip, the companions, the crew, someone else's boat — Yes / Cancel. */
function askLeave(open) {
  if (!open || !B.active) { E.leave.classList.add('hidden'); return; }
  const trip = app.fishing?.trip, mine = [...(app.boatCrew?.rows?.values() || [])].filter(r => r.boat === B.id).length, crew = (B.crew || []).filter(c => !c.skipper && c.id !== auth.account?.id).length;
  const why = B.guest
    ? `You leave ${esc(B.guest.name)}'s boat and the harbour launch takes you back to the dock${trip ? ' — your fishing trip ends and your catch is weighed in' : ''}.`
    : [`${trip ? 'Your fishing trip ends (your catch is weighed in) and the' : 'The'} harbour master takes the boat back to its slip.`,
      mine ? `Your ${mine === 1 ? 'companion comes' : `${mine} companions come`} ashore with you.` : '',
      crew ? `Your crew (${crew} ${crew === 1 ? 'player' : 'players'}) ${trip ? 'end their trips and ' : ''}go ashore too.` : ''].filter(Boolean).join(' ');
  E.leave.querySelector('.bl-why').innerHTML = why;
  E.leave.classList.remove('hidden');   // (no focus moved: Enter and Esc answer it, the game keeps the keys)
}
function goLeave() { E.leave.classList.add('hidden'); if (!B.active) return; leave(); releaseView('Boat'); app.setMode?.('explore'); }
function onKey(e) {
  if (!B.active) return false;
  const c = e.code;
  if (c === 'KeyE') { if (!e.repeat) exit(); return true; }
  if (c === 'KeyF') { if (!e.repeat) { if (B.guest) app.toast(`${B.guest.name} is at the wheel`, '', 2000); else setWalk(!B.walk); } return true; }
  // Esc asks first (2026-11-20, the product owner: Esc "automatically takes me and the companions off the fishing game"):
  // back to the dock only on a yes; Esc again or Cancel stays aboard
  if (c === 'Escape') { if (!E.leave.classList.contains('hidden')) { if (!e.repeat) askLeave(false); return true; } if (app.cam.locked) return false; if (!e.repeat) askLeave(true); return true; }
  if (c === 'Enter' && !E.leave.classList.contains('hidden')) { if (!e.repeat) goLeave(); return true; }
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(c);
}

// ------------------------------------------------------------------ on deck: walking about, fishing spots
/** Off the wheel (on: true) to walk the deck, or back to it. Leaving it puts the lever in neutral. */
function setWalk(on) {
  if (!B.active || !B.s || B.leaving || !!B.walk === !!on || B.guest) return;
  const Sx = B.s.S, narrow = innerWidth < 760;
  if (on) {
    // the lever to neutral (and the phone's slider with it — but only if the slider was in use: a slider value overrides
    // the keys, so a computer's W/S would do nothing back at the wheel)
    B.s.lever = 0; if (B.touch.lever !== null) B.touch.lever = 0; E.setLever?.(0); B.cruise = null;
    B.walk = { x: Sx.helm[0], y: Sx.helm[1], z: Sx.helm[2], yaw: 0, fish: -1, dist: 0, moving: false, pose: null };
    Object.assign(app.cam, { goalDist: DECK_CAM[B.type].dist * (narrow ? 1.25 : 1), goalPitch: DECK_CAM[B.type].pitch });
    if (Math.abs(B.s.u) > 1.5) app.toast('Off the wheel — the lever is in neutral; she\'ll slow and drift', '', 2600);
  } else {
    B.walk = null;
    Object.assign(app.cam, { goalDist: CAM[B.type].dist * (narrow ? 1.3 : 1), goalPitch: CAM[B.type].pitch });
  }
  B.keys.clear();
  modeUi();
  bus.emit('boat-deck', { walk: !!on });
}
/** What E does on deck: fish from the spot you're at, take the wheel when you're by it, stand up from fishing. */
function deckAct() {
  const W = B.walk; if (!W) return;
  const what = deckTarget();
  if (what?.kind === 'stand') { if (W.hold) return; W.fish = -1; W.pose = null; W.poseph = null; bus.emit('boat-fish', { on: false }); }
  else if (what?.kind === 'fish') {
    const sp = what.spot, narrow = innerWidth < 760, tall = narrow && innerHeight > innerWidth;
    Object.assign(W, { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, fish: what.i, moving: false, pose: null, poseph: null, hold: false });
    // (behind you, looking out over the water; a portrait phone's narrow view from higher and a little to the side, over
    // the canopy's rods rather than through them: 2026-11-14, the phone layout)
    Object.assign(app.cam, { goalYaw: app.cam.yaw + angDiff(app.cam.yaw, B.s.heading + sp.yaw + Math.PI + (tall ? 0.5 : 0)), goalDist: (B.type === 'skiff' ? 4.6 : 5.2) * (tall ? 1.45 : narrow ? 1.2 : 1), goalPitch: tall ? 0.42 : 0.3 });
    bus.emit('boat-fish', { on: true, spot: what.i, name: sp.name });
  }
  else if (what?.kind === 'wheel') setWalk(false);
  else if (B.guest) stepOff();   // (its crew, at no spot: off the boat, when it's stopped alongside)
  else app.toast('Walk to a fishing spot (a ring on the deck) or back to the wheel', '', 2200);
  modeUi();
}
/** What E would do from here: { kind: 'stand' | 'fish' | 'wheel', label, i, spot } or null. */
function deckTarget() {
  const W = B.walk; if (!W) return null;
  if (W.fish >= 0) return { kind: 'stand', label: 'Stand up' };
  const Sx = BOATS[B.type], n = spotNear(B.type, W.x, W.z, REACH);
  if (n && Math.abs(n.spot.y - W.y) < 0.05) return { kind: 'fish', label: `Fish from the ${n.spot.name}`, i: n.i, spot: n.spot };
  if (!B.guest && Math.hypot(W.x - Sx.helm[0], W.z - Sx.helm[2]) < REACH) return { kind: 'wheel', label: 'Take the wheel' };
  return null;
}
/** A frame's walking: the keys or the stick, the way the camera looks, turned into the boat's frame; along the deck. */
function walkStep(dt, s) {
  const W = B.walk, k = c => B.keys.has(c), j = app.player?.joy, busy = app.custOpen || app.mapOpen;
  if (W.hold) { W.moving = false; return; }
  let ix = 0, iz = 0;
  if (!busy) {
    ix = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0) + (j?.on ? j.x : 0);
    iz = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0) + (j?.on ? j.y : 0);
  }
  const mag = Math.min(1, Math.hypot(ix, iz));
  W.moving = false;
  if (mag < 0.12) return;
  if (W.fish >= 0) { W.fish = -1; W.pose = null; bus.emit('boat-fish', { on: false }); modeUi(); }   // (walking off stops fishing)
  const c = Math.cos(app.cam.yaw), sn = Math.sin(app.cam.yaw), n = Math.hypot(ix, iz), ux = ix / n, uz = iz / n;
  const dx = ux * c + uz * sn, dz = -ux * sn + uz * c, ch = Math.cos(s.heading), sh = Math.sin(s.heading);
  const real = Math.min(0.5, B.real || dt), lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;   // (the world's way → the boat's; by the time that really passed, as the boat)
  W.yaw += angDiff(W.yaw, Math.atan2(lx, lz)) * Math.min(1, real * 14);
  const n2 = Math.ceil(WALK * real / 0.08), step = WALK * Math.max(0.45, mag) * real / n2;   // (small steps: never through a post)
  for (let i = 0; i < n2; i++) {
    const to = walkDeck(B.type, W, lx * step, lz * step), d = Math.hypot(to.x - W.x, to.z - W.z);
    if (d < 1e-5) break;
    W.x = to.x; W.y = to.y; W.z = to.z; W.dist += d; W.moving = true;
  }
}
/**
 * On deck, is the T-top's canopy between the camera and you: the camera in under it or close by it at its height, or
 * the sight line from it to your head through it (the boat's frame; its pitch and roll left out).
 */
function topInTheWay(W, R, h) {
  const T = B.topBox, c = app.stage.camera.position, dx = c.x - R.p.x, dz = c.z - R.p.z;
  const cx = dx * Math.cos(h) - dz * Math.sin(h), cz = dx * Math.sin(h) + dz * Math.cos(h), cy = c.y - R.p.y;
  const near = (x, z, m) => Math.abs(x) < T.x + m && z > T.z0 - m && z < T.z1 + m;
  if (near(cx, cz, 1.2) && cy > T.y - 1.2) return true;
  const hy = W.y + 1.5;
  if ((cy - T.y) * (hy - T.y) >= 0) return false;
  const u = (T.y - cy) / (hy - cy);
  return near(cx + (W.x - cx) * u, cz + (W.z - cz) * u, 0.3);
}
/** The fishing spots marked on the deck while you walk it (one mesh, a ring a spot). */
function rings(W, R) {
  const D = BOATS[B.type]?.deck;
  if (!D) return;
  if (!B.rings) {
    const g = new THREE.RingGeometry(0.26, 0.33, 28); g.rotateX(-Math.PI / 2);
    B.rings = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.75, depthWrite: false }), 6);
    B.rings.frustumCulled = false; B.rings.renderOrder = 3; B.rings.name = 'fishing-spots'; app.stage.scene.add(B.rings);
  }
  const on = !!W && W.fish < 0;
  B.rings.visible = on;
  if (!on) return;
  const s = B.s, near = spotNear(B.type, W.x, W.z, REACH);
  D.spots.forEach((sp, i) => {
    const p = boatPoint({ ...s, x: R.p.x, y: R.p.y, z: R.p.z }, sp.x, sp.y + 0.03, sp.z), k = near?.i === i ? 1.25 : 1;
    B.rings.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), R.q, _s1.set(k, 1, k)));
  });
  _s1.set(1, 1, 1);
  B.rings.count = D.spots.length; B.rings.instanceMatrix.needsUpdate = true;
}
/** The screen for where you are: at the wheel (the gauges' keys, the phone's wheel and lever) or on deck (the stick, E). */
function modeUi() {
  const W = B.walk;
  document.body.classList.toggle('boat-walk', !!W);
  E.keys.innerHTML = B.guest
    ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>E</kbd> fish / step off (stopped alongside) · <kbd>Esc</kbd> back to the dock'
    : W
    ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>E</kbd> fish / wheel · <kbd>Q</kbd> anchor · <kbd>F</kbd> back to the wheel'
    : '<kbd>W</kbd><kbd>S</kbd> throttle · <kbd>A</kbd><kbd>D</kbd> wheel · <kbd>Space</kbd> neutral · <kbd>Q</kbd> anchor · <kbd>F</kbd> walk the deck · <kbd>E</kbd> step off';
}

// ------------------------------------------------------------------ the wake and the spray (every boat out near you)
function effects(dt, t) {
  if (!app.stage) return;
  const list = [];
  if (B.active && B.mesh) hullAt('me', HULL_FORM[B.type], { obj: B.mesh });   // (the water keeps out of it and laps at it)
  if (B.active && B.s) { const s = B.s; list.push({ key: 'me', x: B.render.p.x, z: B.render.p.z, y: (B.water?.level ?? s.y), heading: s.heading, u: s.u, planing: s.planing, slam: s.slam, vy: s.vy || 0, L: s.S.L, B: s.S.B }); }
  const c = app.stage.camera.position;
  for (const r of [...remote.values()].filter(r => r.out).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z)).slice(0, 3)) {
    const Sx = BOATS[r.type]; list.push({ key: r.id, x: r.x, z: r.z, y: r.level ?? r.y, heading: r.h, u: r.v, planing: Math.min(1, Math.max(0, (Math.abs(r.v) - Sx.hull * 1.3) / (Sx.hull * 0.8))), slam: 0, L: Sx.L, B: Sx.B });
  }
  if (!list.length && !fx) return;
  fx ||= app.boatFx = new BoatFx(app.stage);
  fx.update(Math.min(dt, 0.1), t, list);
}

// ------------------------------------------------------------------ the phone: the wheel (left), the lever (right), buttons
function buildTouch(root) {
  E.touch = root.appendChild(h(`<div id="boattouch" class="hidden">
    <div class="bt-wheel"><i></i><small>wheel</small></div>
    <div class="bt-right">
      <div class="bt-lever"><span class="bt-n">N</span><i></i><small class="bt-f">AHEAD</small><small class="bt-r">ASTERN</small></div>
      <div class="bt-btns bt-helm"><button type="button" class="btn bt-b" data-a="neutral">Neutral</button><button type="button" class="btn bt-b" data-a="anchor">⚓</button><button type="button" class="btn bt-b" data-a="walk">🚶 Walk</button><button type="button" class="btn bt-b" data-a="exit">Off</button></div>
      <div class="bt-btns bt-deck"><button type="button" class="btn bt-b bt-act" data-a="act">E</button><button type="button" class="btn bt-b" data-a="anchor2">⚓</button><button type="button" class="btn bt-b" data-a="wheel">🛞 Wheel</button></div>
    </div></div>`));
  const T = B.touch, wheelEl = E.touch.querySelector('.bt-wheel'), knob = wheelEl.querySelector('i'), lever = E.touch.querySelector('.bt-lever'), handle = lever.querySelector('i');
  let wp = null, lp = null;
  const wmove = e => { const r = wheelEl.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1; x = Math.max(-1, Math.min(1, x)); T.steer = Math.abs(x) < 0.08 ? 0 : x; knob.style.transform = `translateX(${(x * r.width * 0.38).toFixed(1)}px)`; };
  wheelEl.addEventListener('pointerdown', e => { wp = e.pointerId; try { wheelEl.setPointerCapture?.(wp); } catch { /* lifted already */ } wmove(e); e.preventDefault(); });
  wheelEl.addEventListener('pointermove', e => { if (e.pointerId === wp) wmove(e); });
  for (const ev of ['pointerup', 'pointercancel']) wheelEl.addEventListener(ev, e => { if (e.pointerId !== wp) return; wp = null; T.steer = 0; knob.style.transform = ''; });
  const lmove = e => { const r = lever.getBoundingClientRect(); let y = 1 - (e.clientY - r.top) / r.height * 2; y = Math.max(-1, Math.min(1, y)); if (Math.abs(y) < 0.1) y = 0; T.lever = y; setLever(y); };
  lever.addEventListener('pointerdown', e => { lp = e.pointerId; try { lever.setPointerCapture?.(lp); } catch { /* lifted already */ } lmove(e); e.preventDefault(); });
  lever.addEventListener('pointermove', e => { if (e.pointerId === lp) lmove(e); });
  for (const ev of ['pointerup', 'pointercancel']) lever.addEventListener(ev, e => { if (e.pointerId === lp) lp = null; });   // (the lever stays where it was left)
  E.touch.querySelector('[data-a="neutral"]').addEventListener('click', () => { T.neutral = true; T.lever = 0; setLever(0); });
  E.touch.querySelector('[data-a="anchor"]').addEventListener('click', () => { T.anchor = true; });
  E.touch.querySelector('[data-a="exit"]').addEventListener('click', () => exit());
  E.touch.querySelector('[data-a="walk"]').addEventListener('click', () => setWalk(true));
  E.touch.querySelector('[data-a="wheel"]').addEventListener('click', () => (B.guest ? stepOff() : setWalk(false)));
  E.touch.querySelector('[data-a="anchor2"]').addEventListener('click', () => { T.anchor = true; });
  E.act = E.touch.querySelector('[data-a="act"]'); E.act.addEventListener('click', () => deckAct());
  E.wheelBtn = E.touch.querySelector('[data-a="wheel"]');
  function setLever(y) { handle.style.top = `${((1 - y) / 2 * 100).toFixed(1)}%`; }
  E.setLever = setLever;
  setLever(0);
}

// ------------------------------------------------------------------ the gauges
function buildHud(root) {
  E.hud = root.appendChild(h(`<div id="boathud" class="hidden">
    <div class="bh-top"><b class="bh-name"></b><span class="bh-warn hidden"></span></div>
    <div class="bh-row">
      <div class="bh-g"><small>SPEED</small><b class="bh-spd">0</b><i>kn</i></div>
      <div class="bh-g"><small>HEADING</small><b class="bh-hdg">000</b><i>°</i></div>
      <div class="bh-g"><small>DEPTH</small><b class="bh-dep">0</b><i>m</i></div>
      <div class="bh-g bh-lev"><small>THROTTLE</small><span class="bh-bar"><i class="bh-fwd"></i><i class="bh-rev"></i></span><b class="bh-gear">N</b></div>
    </div>
    <div class="bh-prompt hidden"></div>
    <div class="bh-keys"></div></div>`));
  // (Esc: back to the dock? — asked first)
  E.leave = root.appendChild(h(`<div id="boatleave" class="panel hidden" role="alertdialog" aria-modal="false" aria-labelledby="boatleave-t">
    <h3 id="boatleave-t">⚓ Back to the dock?</h3><p class="bl-why"></p>
    <div class="rr-acts"><button type="button" class="btn" data-a="stay">Cancel <kbd>Esc</kbd></button><button type="button" class="btn primary" data-a="go">Yes, back to the dock <kbd>Enter</kbd></button></div></div>`));
  E.leave.querySelector('[data-a="stay"]').onclick = () => askLeave(false);
  E.leave.querySelector('[data-a="go"]').onclick = () => goLeave();
  const q = s => E.hud.querySelector(s);
  Object.assign(E, { name: q('.bh-name'), warn: q('.bh-warn'), spd: q('.bh-spd'), hdg: q('.bh-hdg'), dep: q('.bh-dep'), fwd: q('.bh-fwd'), rev: q('.bh-rev'), gear: q('.bh-gear'), prompt: q('.bh-prompt'), keys: q('.bh-keys') });
}
let hudAt = 0;
function hud(s, t) {
  if (t - hudAt < 0.1) return; hudAt = t;
  E.spd.textContent = knots(Math.abs(s.u)).toFixed(0);
  E.hdg.textContent = String(Math.round(((Math.PI - s.heading) * 180 / Math.PI % 360 + 540) % 360)).padStart(3, '0');
  const T = app.terrain, w = B.water; E.dep.textContent = w && T ? Math.max(0, w.level - T.pointHeight(s.x, s.z)).toFixed(1) : '–';
  E.fwd.style.width = `${Math.round(Math.max(0, s.lever) * 100)}%`; E.rev.style.width = `${Math.round(Math.max(0, -s.lever) * 100)}%`;
  E.gear.textContent = s.anchor ? '⚓' : s.lever > 0.02 ? 'F' : s.lever < -0.02 ? 'R' : 'N';
  const warn = s.aground ? 'AGROUND' : s.anchor ? 'ANCHORED' : B.cruise ? `CRUISE ▶ ${Math.round(Math.hypot(B.cruise.x - s.x, B.cruise.z - s.z))} m` : s.planing > 0.6 ? 'ON THE PLANE' : '';
  E.warn.textContent = warn; E.warn.classList.toggle('hidden', !warn);
  // on deck: what E does from here (and the phone's button for it)
  const what = deckTarget(), txt = what ? what.label : '';
  if (E.prompt._t !== txt) {
    E.prompt._t = txt; E.prompt.innerHTML = txt ? `<kbd>E</kbd> ${esc(txt)}` : ''; E.prompt.classList.toggle('hidden', !txt || isTouch());
    if (E.act) { E.act.textContent = what ? (what.kind === 'fish' ? '🎣 Fish' : what.kind === 'stand' ? 'Stand' : '🛞 Wheel') : '·'; E.act.disabled = !what; }
    if (E.wheelBtn) E.wheelBtn.textContent = B.guest ? '⚓ Off' : '🛞 Wheel';
  }
}

// ------------------------------------------------------------------ everyone else's boats
function onHarbour(m) {
  const away = new Set(m.away || []);
  if (B.active && B.id) away.add(B.id);
  app.marinas?.setAway(away);
  const seen = new Set(), now = performance.now();
  for (const row of m.near || []) {
    const [id, type, out, x, y, z, hh, p, r, v, l, skipper] = row;
    if (B.active && id === B.id) { if (B.guest && B.rb) follow(B.rb, row, now); continue; }
    seen.add(id);
    let b = remote.get(id);
    if (!b) { b = { id, type, x, y, z, h: hh, p, r, vx: 0, vz: 0, at: now, tx: x, tz: z, ty: y }; remote.set(id, b); }
    else { const dts = Math.max(0.05, (now - b.at) / 1000), k = Math.min(1, dts / 0.4); b.vx += ((x - b.tx) / dts - b.vx) * k; b.vz += ((z - b.tz) / dts - b.vz) * k; if (!out) b.vx = b.vz = 0; }
    Object.assign(b, { type, out: !!out, tx: x, ty: y, tz: z, th: hh, tp: p, tr: r, v, l, at: now, skipper, level: waterUnder(x, z)?.level });
  }
  for (const id of [...remote.keys()]) if (!seen.has(id)) remote.delete(id);
  aboard.clear();
  for (const [boat, pid, x, y, z, yaw] of m.aboard || []) aboard.set(pid, { boat, x, y, z, yaw });
}
/** Aboard as crew: the harbour's newest pose of the boat (its speed worked out between them, as for anyone's boat). */
function follow(b, row, now) {
  const [, , out, x, y, z, hh, p, r, v, l] = row, dts = Math.max(0.05, (now - b.at) / 1000), k = Math.min(1, dts / 0.4);
  b.vx += ((x - b.tx) / dts - b.vx) * k; b.vz += ((z - b.tz) / dts - b.vz) * k; if (!out) b.vx = b.vz = 0;
  Object.assign(b, { tx: x, ty: y, tz: z, th: hh, tp: p, tr: r, v, l, at: now });
}
function drawRemote(dt) {
  if (!remote.size && !Object.keys(rmesh).length) return;
  mat ||= app.airports?.material || new THREE.MeshStandardMaterial({ vertexColors: true });
  const n = {}, k = 1 - Math.exp(-dt * 8);
  for (const b of remote.values()) {
    let im = rmesh[b.type];
    if (!im) { im = rmesh[b.type] = new THREE.InstancedMesh(boatGeometry(b.type), mat, 12); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.name = `boats-${b.type}`; app.stage.scene.add(im); }
    const ahead = Math.min(0.5, (performance.now() - b.at) / 1000);
    b.x += (b.tx + b.vx * ahead - b.x) * k; b.z += (b.tz + b.vz * ahead - b.z) * k; b.y += (b.ty - b.y) * k;
    b.h += angDiff(b.h, b.th) * k; b.p += (b.tp - b.p) * k; b.r += (b.tr - b.r) * k;
    if ((n[b.type] ||= 0) >= 12) continue;
    const q = boatQuat({ heading: b.h, pitch: b.p, roll: b.r });
    im.setMatrixAt(n[b.type]++, _m.compose(_p.set(b.x, b.y, b.z), _q.set(q.x, q.y, q.z, q.w), _s1));
    hullAt(`boat-${b.id}`, HULL_FORM[b.type], { m: _m });
  }
  for (const [type, im] of Object.entries(rmesh)) { im.count = n[type] || 0; im.instanceMatrix.needsUpdate = true; }
}
void modulesOf; void WORLD_KINDS;
