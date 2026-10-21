// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Flying the airport's aircraft (docs/features/play-modules.md §Airport). Walk up to a free aircraft in Play mode and press
// E (the prompt says what it is); the server gives it to you (server/world/aircraft.js) and this page flies it with the
// shared flight model (shared/flight-model.js), stepped at 120 Hz, the chase camera behind it, the instruments on screen;
// it sends the pose ten times a second. Landed and stopped, E gets out beside it. A crash: the screen flashes, the ground
// crew takes it back to its stand and you stand beside it. Everyone else's aircraft near you are drawn here too (one
// instanced mesh per type, smoothed between the server's five updates a second), with their propellers or rotors turning.
//
//   Planes:      W/S pitch (S: nose up) · A/D roll (on the ground: steer) · Z/C rudder · R or Shift: more throttle,
//                F: less · Space: brakes · E: get out (stopped) — the arrow keys work as W/S/A/D
//   Helicopter:  W/S forward/back · A/D turn · Z/C sideways · R or Shift: up · F or Space: down · E: get out (landed)
//
// app.flight: { active, state(), type, module, onFrame(fn), instruments() } — the ring game (play/airport-game.js) uses it.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { auth } from '../core/auth.js';
import { AIRCRAFT } from '/shared/aircraft-specs.js';
import { newFlight, stepFlight, instruments, anglesOf, fromAngles, qrot } from '/shared/flight-model.js';
import { Solids } from '/shared/roofs.js';
import { flyingParts } from '../render/aircraft-models.js';
import { blurMaterial, spinStep, blurOpacity } from '../render/rotors.js';

const DT = 1 / 120, SEND_MS = 100, BOARD_D = 7.5;
const CAM = { prop: { dist: 15, pitch: 0.2 }, jet: { dist: 22, pitch: 0.18 }, heli: { dist: 17, pitch: 0.28 } };
const F = { active: false, s: null, id: null, type: null, module: null, mesh: null, rotors: [], exhausts: [], acc: 0, sentAt: 0, keys: new Set(), pending: false, ending: false, frameFns: [], touch: { x: 0, y: 0, up: false, down: false, brake: false } };
let app = null, E = {}, solids = null, solidsVer = -1, remote = new Map(), rmesh = {}, rrot = null, mat = null;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _mr = new THREE.Matrix4(), _p = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1), _pv = new THREE.Vector3(), _qv = new THREE.Quaternion();
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }, _qa = new THREE.Quaternion();

export function init(a) {
  app = a;
  mat = a.airports?.material || null;
  (app.playerTargets ||= []).push(target);
  app.hooks.key.unshift(onKey);
  window.addEventListener('keydown', e => { if (F.active && !typing(e)) F.keys.add(e.code); });
  window.addEventListener('keyup', e => F.keys.delete(e.code));
  window.addEventListener('blur', () => F.keys.clear());
  bus.on('msg:fstate', onState);
  // a pose the server refused (too far for the time): back where it last agreed — still flying (stopped dead in the air it fell)
  bus.on('msg:fcorr', m => { if (F.active && m.pose) { F.s.p = { x: m.pose.x, y: m.pose.y, z: m.pose.z }; F.prev?.p.set(m.pose.x, m.pose.y, m.pose.z); } });
  bus.on('msg:pmoved', m => { if (m.flight === 'out' && F.active) end(m); });
  bus.on('msg:fleet', onFleet);
  // leaving Play mode while flying (Esc, the Leave button, the mode menu): out of the cockpit, the aircraft looked after
  bus.on('mode', m => { if (m !== 'play' && F.active) leave(); });
  bus.on('frame', (dt) => drawRemote(dt));
  buildHud(document.getElementById('ui'));
  buildTouch(document.getElementById('ui'));
  app.flight = {
    get active() { return F.active; }, get type() { return F.type; }, get module() { return F.module; }, get id() { return F.id; },
    state: () => F.s, instruments: () => (F.s ? instruments(F.s) : null),
    onFrame: fn => F.frameFns.push(fn),
    frame, solids: () => solidsFor(),
    /** The nearest other aircraft to the camera (audio/aircraft-sound.js hears it): { type, d, flying, th } or null. */
    nearest() {
      const c = app.stage.camera.position; let best = null;
      for (const r of remote.values()) { const d = Math.hypot(r.x - c.x, r.y - c.y, r.z - c.z); if (!best || d < best.d) best = { type: r.type, d, flying: r.flying, th: r.th }; }
      return best;
    },
  };
}
const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
const label = type => AIRCRAFT[type]?.label || 'aircraft';

// ------------------------------------------------------------------ boarding
/** The aircraft a walking player could board: free ones on their stands, and ones parked where someone left them. */
function candidates() {
  const out = [];
  for (const s of app.airports?.stands || []) if (!app.airports.isAway(s.id)) out.push({ id: s.id, type: s.type, x: s.x, z: s.z, y: s.y });
  for (const r of remote.values()) if (!r.flying) out.push({ id: r.id, type: r.type, x: r.x, z: r.z, y: r.y - AIRCRAFT[r.type].gearH });
  return out;
}
function target(P) {
  if (F.active || F.pending || !auth.can('play.use') || P.ctx !== -1) return null;
  let best = null, bd = BOARD_D;
  for (const c of candidates()) {
    if (Math.abs(P.y - c.y) > 3) continue;
    const d = Math.hypot(c.x - P.x, c.z - P.z) - (AIRCRAFT[c.type].kind === 'heli' ? 1.5 : 2.5);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return null;
  return { d: Math.max(0.1, bd), html: `Fly the ${esc(label(best.type).toLowerCase())} <span class="dim">· ${AIRCRAFT[best.type].icon}</span>`, act: () => board(best) };
}
function board(c) {
  if (F.pending || F.active) return;
  F.pending = true;
  app.net.send({ t: 'fboard', id: c.id });
  setTimeout(() => { if (F.pending) { F.pending = false; app.toast('No answer from the airport — try again', 'bad', 3000); } }, 5000);
}
function onState(m) {
  F.pending = false;
  if (!m.ok) { app.toast(m.text || 'Not now', 'bad', 3500); return; }
  if (F.active) return;
  start(m);
}

// ------------------------------------------------------------------ flying
function start(m) {
  const P = app.player, Sx = AIRCRAFT[m.type], pose = m.pose;
  const q = { x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }, a = anglesOf(q);
  const ground = groundAt(pose.x, pose.z);
  F.s = newFlight(m.type, pose.x, ground, pose.z, a.heading);
  if (m.resumed && pose.y - Sx.gearH - ground > 2) {   // back in the cockpit in the air (the page reloaded): flying on
    F.s.p.y = pose.y; F.s.onGround = false; F.s.q = fromAngles(a.heading, 0, 0);
    const v = Math.max(pose.v || 0, Sx.kind === 'heli' ? 0 : Sx.cruise), f = qrot(F.s.q, 0, 0, 1);
    F.s.v = { x: f.x * v, y: 0, z: f.z * v }; F.s.engine = F.s.throttle = 0.6; F.s.rpm = 1;
  }
  Object.assign(F, { active: true, id: m.id, type: m.type, module: m.module, acc: 0, sentAt: 0, ending: false, crashAt: 0, lastT: 0 });
  F.prev = { p: new THREE.Vector3(F.s.p.x, F.s.p.y, F.s.p.z), q: new THREE.Quaternion(F.s.q.x, F.s.q.y, F.s.q.z, F.s.q.w) };
  F.render = { p: F.prev.p.clone(), q: F.prev.q.clone() };
  F.keys.clear();
  app.airports?.hide(m.id, true);
  // the body, and its rotors as parts that turn (2026-10-14: the blades were part of the body and stood still under a
  // faint disc): each turns about its hub with the rotor's or the engine's speed, its blur thickening as it speeds up;
  // the jet has no propeller — its exhausts glow with the power
  const parts = flyingParts(m.type), mat = app.airports?.material;
  F.mesh = new THREE.Mesh(parts.body, mat); F.mesh.castShadow = true; F.mesh.frustumCulled = false;
  F.rotors = parts.rotors.map(r => {
    const blades = new THREE.Mesh(r.geo, mat), disc = new THREE.Mesh(r.disc, blurMaterial(r.tip));
    blades.position.set(...r.at); disc.position.set(...r.at); blades.castShadow = true; blades.frustumCulled = disc.frustumCulled = false; disc.renderOrder = 2;
    F.mesh.add(blades, disc);
    return { blades, disc, axis: r.axis, rate: r.rate, n: r.blades, blur: r.blur, a: Math.random() * 6 };
  });
  F.exhausts = parts.exhausts.map(e => { const g = new THREE.CircleGeometry(e.r, 18); g.rotateY(Math.PI); const x = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff9a52, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); x.position.set(...e.at); F.mesh.add(x); return x; });
  app.stage.scene.add(F.mesh);
  if (P?.active) {
    P.onVehicleEnter?.({ keys: Sx.kind === 'heli' ? 'Helicopter: wait for the rotor · R/Shift up · W/S forward/back · A/D turn · F/Space down · E get out when landed' : `${Sx.label}: R/Shift throttle up · S nose up at ${Math.round(Sx.rotate * 1.944)} kt · A/D roll · Space brakes · E get out when stopped` });
    const narrow = innerWidth < 760;   // a phone: further back, so the aircraft doesn't fill the screen
    app.cam.goalDist = CAM[m.type].dist * (narrow ? 1.4 : 1); app.cam.goalPitch = CAM[m.type].pitch; app.stage.camera.fov = narrow ? 70 : 65;
    if (Sx.kind === 'heli') app.cam.rates = { follow: 18, turn: 6 };   // (the camera swings round after a turning helicopter: its bank shows)
  }
  document.body.classList.add('flying');
  E.hud.classList.remove('hidden');
  E.keys.innerHTML = Sx.kind === 'heli'
    ? '<kbd>R</kbd>/<kbd>Shift</kbd> up · <kbd>F</kbd>/<kbd>Space</kbd> down · <kbd>W</kbd><kbd>S</kbd> forward/back · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>Z</kbd><kbd>C</kbd> sideways · <kbd>E</kbd> get out (landed)'
    : '<kbd>R</kbd>/<kbd>Shift</kbd> throttle up · <kbd>F</kbd> down · <kbd>S</kbd> nose up · <kbd>W</kbd> nose down · <kbd>A</kbd><kbd>D</kbd> roll / steer · <kbd>Z</kbd><kbd>C</kbd> rudder · <kbd>Space</kbd> brakes · <kbd>E</kbd> get out (stopped)';
  E.name.textContent = `${Sx.icon} ${Sx.label}`;
  showTouch(Sx);
  bus.emit('flight', { on: true, type: m.type, module: m.module });
}
/** Out of the aircraft (the server put the player beside it). */
function end(m) {
  if (!F.active) return;
  const P = app.player;
  F.active = false; F.ending = false; F.leaving = false;
  if (F.mesh) { app.stage.scene.remove(F.mesh); for (const r of F.rotors) r.disc.material.dispose(); for (const x of F.exhausts) { x.geometry.dispose(); x.material.dispose(); } F.mesh = null; F.rotors = []; F.exhausts = []; }   // (the parts' geometry is shared: kept)
  document.body.classList.remove('flying', 'flying-crash');
  E.hud.classList.add('hidden');
  E.touch.classList.add('hidden'); Object.assign(F.touch, { x: 0, y: 0, up: false, down: false, brake: false });
  P?.onVehicleExit?.({ x: m.x, y: m.y, z: m.z });
  F.s = null; F.type = null; F.id = null; F.keys.clear();
  bus.emit('flight', { on: false });
}
function input() {
  const k = c => F.keys.has(c), Sx = AIRCRAFT[F.type], j = app.player?.joy;
  const ax = (a, b) => (k(a) ? 1 : 0) - (k(b) ? 1 : 0);
  const up = k('KeyR') || k('ShiftLeft') || k('ShiftRight') || k('PageUp'), down = k('KeyF') || k('PageDown') || (Sx.kind === 'heli' && k('Space'));
  const fwd = ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown'), side = ax('KeyD', 'KeyA') + ax('ArrowRight', 'ArrowLeft');
  const T = F.touch, cl = v => Math.max(-1, Math.min(1, v));   // the touch stick and buttons add to the keys
  const thr = (up || T.up ? 1 : 0) - (down || T.down ? 1 : 0);
  if (Sx.kind === 'heli') return { throttle: thr, pitch: cl(-Math.sign(fwd) + T.y), yaw: cl(Math.sign(side) + T.x), strafe: ax('KeyC', 'KeyZ') };
  return { throttle: thr, pitch: cl(-Math.sign(fwd) + T.y), roll: cl(Math.sign(side) + T.x + (j?.on ? j.x : 0)), yaw: ax('KeyC', 'KeyZ'), brake: k('Space') || T.brake };
}
/** The ground's height at one point (worked out there: heightAt would build a whole 122 m chunk each time the aircraft
 *  crosses into a new one — a hitch every few seconds on a phone, 2026-10-14). */
function groundAt(x, z) { return app.terrain ? (app.terrain.pointHeight ? app.terrain.pointHeight(x, z) : app.terrain.heightAt(x, z)) : 0; }
function solidsFor() {
  if (!solids || solidsVer !== S.version) { solids = new Solids(S.world); solidsVer = S.version; }
  return solids;
}
/** The world as the flight model feels it: the ground or a roof under the aircraft, the water, walls. */
function envAt(s) {
  const sol = solidsFor(), Sx = AIRCRAFT[F.type], pad = Sx.kind === 'heli' ? 0.5 : 0;
  // the ground at a point (the model asks where it is each step, and a little ahead): over a roof (not beside it) the
  // roof is the ground
  const ground = (x, z) => { const t = groundAt(x, z), roof = sol.roofAt(x, z, pad); return roof > t && s.p.y - Sx.gearH > roof - 1.5 ? roof : t; };
  const wq = app.terrain?.ground?.water(s.p.x, s.p.z);
  return { ground, water: () => (wq ? wq.level : null), solid: (x, y, z) => { const b = sol.hit(x, y, z); return b ? (b.label || 'a building') : null; } };
}
/** Every frame while flying (player.js hands the frame over). */
function frame(P, dt, t) {
  if (!F.active || !F.s) return;
  const s = F.s, Sx = AIRCRAFT[F.type];
  if (!s.crashed && !F.leaving) {
    const env = envAt(s), inp = app.custOpen || app.mapOpen ? {} : input();
    // by the frame's own time (requestAnimationFrame's, t), as the car since 2026-10-04: the time the code happens to run
    // (performance.now) wanders within a busy phone's frame, and the drawn aircraft wobbled with it — at 125 m/s up to
    // 0.4 m a frame (2026-10-14). Real time even on a slow frame (the page's own dt stops at 0.1 s; a step costs microseconds).
    const real = F.lastT ? Math.max(0, t - F.lastT) : dt; F.lastT = t;
    F.acc = Math.min(F.acc + real, 1.0); F.real = Math.min(real, 1.0);
    while (F.acc >= DT && !s.crashed) {
      F.prev.p.copy(_pv.set(s.p.x, s.p.y, s.p.z)); F.prev.q.set(s.q.x, s.q.y, s.q.z, s.q.w);   // the state before the last step
      stepFlight(s, inp, env, DT); F.acc -= DT;
    }
  }
  // drawn between the last two physics steps (a fixed 120 Hz model under a frame rate that wanders — a phone's — would
  // otherwise move in uneven jumps: the stutter, 2026-10-14)
  const al = s.crashed ? 1 : Math.min(1, F.acc / DT);
  const R = F.render;
  R.p.copy(F.prev.p).lerp(_pv.set(s.p.x, s.p.y, s.p.z), al);
  R.q.copy(F.prev.q).slerp(_qv.set(s.q.x, s.q.y, s.q.z, s.q.w), al);
  F.mesh.position.copy(R.p);
  F.mesh.quaternion.copy(R.q);
  if (Sx.kind === 'heli' && !s.onGround && !s.crashed) {   // hovering it never sits quite still: it bobs and rocks a little (drawn only)
    const calm = Math.max(0, 1 - Math.hypot(s.v.x, s.v.z) / 10);
    F.mesh.position.y += Math.sin(t * 1.9) * 0.14 * calm;
    F.mesh.rotateZ(Math.sin(t * 1.3 + 1) * 0.016 * calm); F.mesh.rotateX(Math.sin(t * 1.05) * 0.011 * calm);
  }
  const spin = s.crashed ? 0 : Sx.kind === 'heli' ? s.rpm : s.engine;
  for (const r of F.rotors) {
    r.a = (r.a + spinStep(r.rate, spin, dt, r.n)) % (Math.PI * 2); r.blades.rotation[r.axis] = r.a;
    r.disc.material.opacity = blurOpacity(spin, r.blur); r.disc.visible = r.disc.material.opacity > 0.01;
  }
  for (const x of F.exhausts) x.material.opacity = 0.08 + 0.6 * s.engine * s.engine;
  P.x = R.p.x; P.y = R.p.y - Sx.gearH; P.z = R.p.z; P.ctx = -1;
  const a = anglesOf(R.q);
  P.yaw = P.tyaw = a.heading;
  // the chase camera: behind, a little above, turning with the aircraft — all from the drawn aircraft (its heading from
  // the model's last step moved in steps of one or two physics steps a frame: the camera's yaw shook in a turn)
  const cam = app.cam, f = qrot(R.q, 0, 0, 1);
  cam.follow = () => ({ x: R.p.x + f.x * 2, y: R.p.y + 1.2, z: R.p.z + f.z * 2 });
  cam.goalYaw = cam.yaw + angDiff(cam.yaw, a.heading + Math.PI);
  cam.followDt = s.crashed || F.leaving ? 0 : F.real;   // (the aircraft moved by this frame's real length: render/camera.js)
  if (S.focus.b >= 0) app.setFocus?.(-1);
  // to the server, ten times a second
  const now = performance.now();
  if (now - F.sentAt > SEND_MS && !s.crashed && !F.leaving) {
    F.sentAt = now;
    const i = instruments(s);
    app.net.send({ t: 'fpose', ts: +s.t.toFixed(3), x: +s.p.x.toFixed(2), y: +s.p.y.toFixed(2), z: +s.p.z.toFixed(2), q: [s.q.x, s.q.y, s.q.z, s.q.w].map(v => +v.toFixed(4)), v: +i.speed.toFixed(2), g: s.onGround ? 1 : 0, th: +s.throttle.toFixed(2) });
  }
  hud(s, t);
  for (const fn of F.frameFns) { try { fn(s, dt, t); } catch (e) { console.error('[flight]', e); } }
  if (s.crashed && !F.crashAt) crashed(s.crashed);
}
const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
function crashed(why) {
  F.crashAt = performance.now();
  document.body.classList.add('flying-crash');
  app.toast(`💥 ${why}`, 'bad', 4500);
  bus.emit('flight-crash', why);
  setTimeout(() => app.net.send({ t: 'fcrash', why }), 1200);   // a moment to see it, then the ground crew
}
function exit() {
  const s = F.s; if (!s || F.ending) return;
  const i = instruments(s);
  if (!s.onGround) { app.toast('Land first', 'bad', 2000); return; }
  if (i.speed > 3) { app.toast(AIRCRAFT[F.type].kind === 'heli' ? 'Settle on the ground first' : 'Stop first (Space brakes)', 'bad', 2000); return; }
  F.ending = true;
  app.net.send({ t: 'fexit' });
  setTimeout(() => { F.ending = false; }, 3000);
}
/** Out of the cockpit because Play mode ends: the server sets the player down (beside it, or beside its stand) and the
 *  answer (pmoved, flight: out) ends the flight here; until then nothing more is sent. */
function leave() {
  if (!F.active || F.leaving) return;
  F.leaving = true;
  app.net.send({ t: 'fleave' });
  setTimeout(() => { F.leaving = false; if (F.active) end({ x: F.s?.p.x ?? 0, y: 0, z: F.s?.p.z ?? 0 }); }, 4000);   // no answer: end here anyway
}
function onKey(e) {
  if (!F.active) return false;
  const c = e.code;
  if (c === 'KeyE') { if (!e.repeat) exit(); return true; }
  if (c === 'Escape') { if (app.cam.locked) return false; if (!e.repeat) { leave(); app.setMode?.('explore'); } return true; }
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyC', 'KeyR', 'KeyF', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(c);
}

// ------------------------------------------------------------------ touch: a stick on the left, buttons on the right
function buildTouch(root) {
  E.touch = root.appendChild(h(`<div id="flighttouch" class="hidden">
    <div class="ft-stick"><i></i><small class="ft-hint"></small></div>
    <div class="ft-btns">
      <button type="button" class="btn ft-b" data-k="up"><b>▲</b><small class="ft-up"></small></button>
      <button type="button" class="btn ft-b" data-k="down"><b>▼</b><small class="ft-down"></small></button>
      <button type="button" class="btn ft-b ft-brake" data-k="brake"><small>Brake</small></button>
      <div class="ft-row"><button type="button" class="btn ft-s" data-a="rings" title="Ring courses">🏁</button><button type="button" class="btn ft-s" data-a="exit" title="Get out (landed and stopped)">Exit</button></div>
    </div></div>`));
  const stick = E.touch.querySelector('.ft-stick'), knob = stick.querySelector('i'), T = F.touch;
  let pid = null;
  const move = e => {
    const r = stick.getBoundingClientRect(), r0 = r.width / 2;
    let dx = (e.clientX - r.left - r0) / r0, dy = (e.clientY - r.top - r0) / r0; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    T.x = Math.abs(dx) < 0.08 ? 0 : dx; T.y = Math.abs(dy) < 0.08 ? 0 : dy;   // a little dead zone in the middle
    knob.style.transform = `translate(${(dx * r0 * 0.62).toFixed(1)}px, ${(dy * r0 * 0.62).toFixed(1)}px)`;
  };
  const end = e => { if (e.pointerId !== pid) return; pid = null; T.x = T.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', e => { pid = e.pointerId; try { stick.setPointerCapture?.(pid); } catch { /* no capture (the finger already lifted): the stick still works */ } move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e); });
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  for (const b of E.touch.querySelectorAll('[data-k]')) {   // held: on while the finger is on it
    const k = b.dataset.k, on = v => e => { T[k] = v; b.classList.toggle('on', v); e.preventDefault(); };
    b.addEventListener('pointerdown', on(true)); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, on(false));
  }
  E.touch.querySelector('[data-a="exit"]').addEventListener('click', () => exit());
  E.touch.querySelector('[data-a="rings"]').addEventListener('click', () => app.ringGame?.open());
}
function showTouch(Sx) {
  const heli = Sx.kind === 'heli';
  E.touch.querySelector('.ft-up').textContent = heli ? 'Up' : 'Power';
  E.touch.querySelector('.ft-down').textContent = heli ? 'Down' : 'Less';
  E.touch.querySelector('.ft-brake').classList.toggle('hidden', heli);
  E.touch.querySelector('.ft-hint').textContent = heli ? 'forward · turn' : 'pull: nose up · tilt: roll';
  E.touch.classList.toggle('hidden', !isTouch());
}

// ------------------------------------------------------------------ the instruments
function buildHud(root) {
  E.hud = root.appendChild(h(`<div id="flighthud" class="hidden">
    <div class="fh-top"><b class="fh-name"></b><span class="fh-warn hidden">STALL</span></div>
    <div class="fh-row">
      <div class="fh-g"><small>AIRSPEED</small><b class="fh-spd">0</b><i>kt</i></div>
      <div class="fh-g"><small>ALTITUDE</small><b class="fh-alt">0</b><i>ft</i></div>
      <div class="fh-g"><small>CLIMB</small><b class="fh-vs">0</b><i>ft/min</i></div>
      <div class="fh-g"><small>HEADING</small><b class="fh-hdg">000</b><i>°</i></div>
      <div class="fh-g fh-thr"><small class="fh-thl">THROTTLE</small><span class="fh-bar"><i></i></span></div>
    </div>
    <div class="fh-att"><div class="fh-hz"></div><div class="fh-wings"></div></div>
    <div class="fh-keys"></div></div>`));
  E.name = E.hud.querySelector('.fh-name'); E.warn = E.hud.querySelector('.fh-warn'); E.spd = E.hud.querySelector('.fh-spd'); E.alt = E.hud.querySelector('.fh-alt');
  E.vs = E.hud.querySelector('.fh-vs'); E.hdg = E.hud.querySelector('.fh-hdg'); E.bar = E.hud.querySelector('.fh-bar i'); E.thl = E.hud.querySelector('.fh-thl');
  E.hz = E.hud.querySelector('.fh-hz'); E.keys = E.hud.querySelector('.fh-keys');
}
let hudAt = 0;
function hud(s, t) {
  if (t - hudAt < 0.08) return; hudAt = t;
  const i = instruments(s), heli = AIRCRAFT[F.type].kind === 'heli';
  E.spd.textContent = Math.round(i.speed * 1.944);
  E.alt.textContent = Math.round(i.agl * 3.281).toLocaleString('en-US');
  E.vs.textContent = (i.vs > 0 ? '+' : '') + Math.round(i.vs * 196.85 / 10) * 10;
  E.hdg.textContent = String(Math.round((360 - i.heading) % 360)).padStart(3, '0');
  E.bar.style.width = `${Math.round(i.throttle * 100)}%`;
  E.thl.textContent = heli ? (s.rpm < 0.85 ? 'ROTOR SPINNING UP' : 'ROTOR') : 'THROTTLE';
  E.warn.classList.toggle('hidden', !i.stall);
  E.hz.style.transform = `translateY(${(i.pitch * 1.6).toFixed(1)}px) rotate(${(-i.bank).toFixed(1)}deg)`;
}

// ------------------------------------------------------------------ everyone else's aircraft
function onFleet(m) {
  const away = new Set(m.away || []);
  if (F.active && F.id) away.add(F.id);
  app.airports?.setAway(away);
  const seen = new Set();
  for (const row of m.near || []) {
    const [id, type, flying, x, y, z, qx, qy, qz, qw, v, th, pilot] = row;
    if (F.active && id === F.id) continue;
    seen.add(id);
    let r = remote.get(id);
    const now = performance.now();
    if (!r) { r = { id, type, x, y, z, q: new THREE.Quaternion(qx, qy, qz, qw), vx: 0, vy: 0, vz: 0, at: now, tx: x, ty: y, tz: z }; remote.set(id, r); }
    else {   // its velocity from the last two updates: drawn where it is now, not where it was (no jumps every 200 ms)
      const dts = Math.max(0.05, (now - r.at) / 1000), k = Math.min(1, dts / 0.4);
      r.vx += ((x - r.tx) / dts - r.vx) * k; r.vy += ((y - r.ty) / dts - r.vy) * k; r.vz += ((z - r.tz) / dts - r.vz) * k;
      if (!flying) r.vx = r.vy = r.vz = 0;
    }
    Object.assign(r, { type, flying: !!flying, tx: x, ty: y, tz: z, at: now, tq: new THREE.Quaternion(qx, qy, qz, qw), v, th: th || 0, pilot });
  }
  for (const id of [...remote.keys()]) if (!seen.has(id)) remote.delete(id);
}
function drawRemote(dt) {
  if (!app.airports?.material) return;
  if (!rrot) {   // per type: the body (instanced) and each rotor's blades and blur (instanced, turned about their hubs)
    rrot = {};
    for (const type of Object.keys(AIRCRAFT)) {
      const P = flyingParts(type), im = new THREE.InstancedMesh(P.body, app.airports.material, 12); im.count = 0; im.frustumCulled = false; im.castShadow = true; rmesh[type] = im; app.stage.scene.add(im);
      rrot[type] = P.rotors.map(R => {
        const blades = new THREE.InstancedMesh(R.geo, app.airports.material, 12), disc = new THREE.InstancedMesh(R.disc, blurMaterial(R.tip), 12);
        disc.material.opacity = blurOpacity(0.9, R.blur); disc.renderOrder = 2;
        for (const x of [blades, disc]) { x.count = 0; x.frustumCulled = false; app.stage.scene.add(x); }
        blades.castShadow = true;
        return { R, blades, disc, nb: 0, nd: 0 };
      });
    }
  }
  const n = { prop: 0, jet: 0, heli: 0 }, k = 1 - Math.exp(-dt * 10);
  for (const list of Object.values(rrot)) for (const x of list) x.nb = x.nd = 0;
  for (const r of remote.values()) {
    const ahead = Math.min(0.5, (performance.now() - r.at) / 1000);   // where it is by now, from its velocity
    r.x += (r.tx + r.vx * ahead - r.x) * k; r.y += (r.ty + r.vy * ahead - r.y) * k; r.z += (r.tz + r.vz * ahead - r.z) * k; r.q.slerp(r.tq, k);
    const im = rmesh[r.type]; if (!im || n[r.type] >= 12) continue;
    im.setMatrixAt(n[r.type]++, _m.compose(_p.set(r.x, r.y, r.z), r.q, _s1));
    // its rotors turn with its throttle (a helicopter's: its rotor's speed), the blur over them at speed
    const level = r.th || 0;
    r.spin = r.spin || [];
    rrot[r.type].forEach((x, j) => {
      r.spin[j] = ((r.spin[j] ?? Math.random() * 6) + spinStep(x.R.rate, level, dt, x.R.blades)) % (Math.PI * 2);
      _mr.makeRotationFromQuaternion(_qa.setFromAxisAngle(AXIS[x.R.axis], r.spin[j])).setPosition(x.R.at[0], x.R.at[1], x.R.at[2]);
      x.blades.setMatrixAt(x.nb++, _m2.multiplyMatrices(_m, _mr));
      if (level > 0.45) x.disc.setMatrixAt(x.nd++, _m2.multiplyMatrices(_m, _mr.makeTranslation(x.R.at[0], x.R.at[1], x.R.at[2])));
    });
  }
  for (const [type, im] of Object.entries(rmesh)) { im.count = n[type]; im.instanceMatrix.needsUpdate = true; }
  for (const list of Object.values(rrot)) for (const x of list) { x.blades.count = x.nb; x.disc.count = x.nd; x.blades.instanceMatrix.needsUpdate = true; x.disc.instanceMatrix.needsUpdate = true; }
}
