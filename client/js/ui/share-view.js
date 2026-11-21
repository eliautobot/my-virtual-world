// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// 📷 Share my view (docs/features/awareness.md): a picture of what this person's screen shows of the world right now, for
// the chat composer to attach to the next message like any picture — and, with it, what the picture shows: where the
// camera stood and which way it looked, and whose characters are on screen in that very frame (the residents and agents
// drawn there, other players, and the person's own character), so the agent is told who it is looking at instead of
// guessing ("a screenshot of someone else"). The server checks all of it (server/chat/chat.js); this only says what the
// page drew.
//
// The world's canvas keeps no copy of a frame once it is on screen (no preserveDrawingBuffer: that costs every frame),
// so the picture is taken in the frame itself — right after it is drawn (the 'postframe' event, main.js), in the same
// task — or, when no frame comes soon (the page in the background, a test holding the loop), by drawing one here.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { GU } from '../render/scene.js';

export const VIEW_M = 80;        // people farther than this from the camera are not "in" the picture
const VISIBLE_MAX = 40;          // at most this many named, the nearest first
const MAX_SIDE = 1920;           // the picture's longest side (the composer makes a large picture smaller still)
const WAIT_MS = 250;             // a frame drawn by the page within this, else one drawn here
const EYE_NEAR = 0.08;           // the near plane from someone's eyes (as first person's: render/camera.js)
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const r2 = n => Math.round(n * 100) / 100;

/** Whether this page shows the world now: its 3D view exists and is laid out on the page. */
export function hasWorld(app) {
  const c = app?.stage?.renderer?.domElement;
  return !!(c && c.isConnected && c.width > 0 && c.height > 0 && c.offsetWidth > 0 && c.offsetHeight > 0 && getComputedStyle(c).visibility !== 'hidden');
}

/** Whether world point (x, y, z) is on the screen of camera `cam`, and how far it is (-1: not on it). */
function onScreen(cam, x, y, z) {
  _v.set(x, y, z);
  const d = _v.distanceTo(cam.position);
  if (d > VIEW_M) return -1;
  _v.project(cam);
  return _v.z < 1 && _v.z > -1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 ? d : -1;
}
/** On screen by its middle or its head (one standing at the bottom edge, one whose feet are cut off). */
const bodyOnScreen = (cam, x, y, z, seated = false) => {
  const a = onScreen(cam, x, y + (seated ? 0.45 : 0.9), z);
  return a >= 0 ? a : onScreen(cam, x, y + (seated ? 0.9 : 1.6), z);
};

/**
 * What the frame just drawn shows: { cam: { x, y, z, ctx, yaw }, visible: [{ kind: 'resident', i } | { kind: 'player', id }],
 * at }. cam.ctx: the floor the view looks at (building × 64 + floor), or -1 outside; cam.yaw: the way it looks, as a body's
 * yaw (it faces (sin yaw, cos yaw)). Players are named by their account (the id the world streams them by). at: when, in
 * the server's time (ms; core/net.js realNow), so a picture sent a while after it was taken is said to be from then.
 */
export function viewOf(app) {
  const cam = app.stage.camera;
  cam.updateMatrixWorld();
  cam.getWorldDirection(_d);
  const fb = S.focus?.b ?? -1, ff = S.focus?.f ?? 0;
  const now = app.net?.realNow ? app.net.realNow() * 1000 : Date.now();
  const out = { cam: { x: r2(cam.position.x), y: r2(cam.position.y), z: r2(cam.position.z), ctx: fb >= 0 ? fb * 64 + ff : -1, yaw: Math.round(Math.atan2(_d.x, _d.z) * 1000) / 1000 }, visible: [], at: Math.round(now) };
  const seen = [], placed = app.carOccupants?.placed;
  // residents and agents: those the frame drew (render/agents.js — on the floor looked at, not hidden), and those in a
  // car's seat (render/car-occupants.js); not one set aside for a screen being used (ui/pc-onscreen.js)
  const A = app.agents;
  if (A?.drawn) {
    const fr = A.frame, add = (i, x, y, z, seated) => {
      if (A.hideFn?.(i, x, y, z)) return;
      const d = bodyOnScreen(cam, x, y, z, seated);
      if (d >= 0) seen.push({ d, v: { kind: 'resident', i } });
    };
    for (let n = 0; n < A.nDrawn; n++) { const i = A.drawn[n]; add(i, A.rx[i], A.ry[i], A.rz[i], false); }
    if (placed) for (const [k, q] of placed) if (k[0] === 'r') { const i = Number(k.slice(1)); if (Number.isInteger(i) && A.carF?.[i] === fr && !seen.some(s => s.v.i === i)) add(i, q.x, q.y, q.z, true); }
  }
  // other players (player/remote.js: drawn this frame, at the wheel of their car or not), fading ones left out
  const ids = new Set(), R = app.remote;
  for (const r of R?.drawn || []) {
    if (r.fade !== undefined && r.fade < 0.5) continue;
    const q = r.driving ? placed?.get('p' + r.pid) : null, X = q || r.extra;
    const d = bodyOnScreen(cam, X.x, X.y, X.z, !!q);
    if (d >= 0 && !ids.has(r.pid)) { ids.add(r.pid); seen.push({ d, v: { kind: 'player', id: r.pid } }); }
  }
  // the person's own character while they play — not in first person (those are its own eyes)
  const P = app.player, me = R?.me?.pid;
  if (P?.active && !app.cam?.fp && Number.isInteger(me) && !ids.has(me)) {
    const q = placed?.get('p' + me), d = q ? bodyOnScreen(cam, q.x, q.y, q.z, true) : bodyOnScreen(cam, P.x, P.y, P.z);
    if (d >= 0) seen.push({ d, v: { kind: 'player', id: me } });
  }
  seen.sort((a, b) => a.d - b.d);
  out.visible = seen.slice(0, VISIBLE_MAX).map(s => s.v);
  return out;
}

/** The picture in `canvas` (the world's, just drawn), at most MAX_SIDE on its longest side, copied now. */
function copyNow(canvas) {
  const k = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

/** Whether picture `c` came out blank (a frame no longer there: all one dark colour, or see-through). */
function blank(c) {
  const s = document.createElement('canvas'); s.width = s.height = 12;
  const g = s.getContext('2d', { willReadFrequently: true });
  g.drawImage(c, 0, 0, 12, 12);
  const px = g.getImageData(0, 0, 12, 12).data;
  for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 8 && px[k] + px[k + 1] + px[k + 2] > 12) return false;
  return true;
}

/**
 * The world drawn once from another pose — `pose`: { x, y, z (the eye), yaw (it faces (sin yaw, cos yaw)), pitch (+ up) } —
 * with this page's own lens, copied, and the page's own frame drawn again at once, in the same task, so the screen never
 * shows the other view (the canvas is shown only once the task ends). Everything the frame set up for its own camera —
 * the camera, its near plane, where the shaders think the camera is, the fade towards the player, the building it is in,
 * the shadow maps (the lights did not move: drawn once in the frame) — is put back as it was. Returns the copy.
 */
function drawFrom(app, pose) {
  const stage = app.stage, cam = stage.camera, r = stage.renderer;
  const p0 = cam.position.clone(), q0 = cam.quaternion.clone(), near0 = cam.near;
  const camP0 = GU.uCamP.value.clone(), fade0 = GU.uFade.value.w, inB0 = GU.uInB.value, auto0 = r.shadowMap.autoUpdate;
  let pic = null;
  try {
    const cp = Math.cos(pose.pitch);
    cam.position.set(pose.x, pose.y, pose.z);
    cam.lookAt(_v.set(pose.x + Math.sin(pose.yaw) * cp, pose.y + Math.sin(pose.pitch), pose.z + Math.cos(pose.yaw) * cp));
    cam.near = EYE_NEAR; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    GU.uCamP.value.copy(cam.position);
    GU.uFade.value.w = 0;   // (nothing between this eye and the player is faded out of the way: that is the orbit's)
    const inB = app.blds ? app.blds.cameraIn(cam.position, cam.near) : -1;
    GU.uInB.value = inB === (S.focus?.b ?? -1) ? -1 : inB;
    r.shadowMap.autoUpdate = false;
    stage.render();
    pic = copyNow(r.domElement);
  } finally {
    cam.position.copy(p0); cam.quaternion.copy(q0); cam.near = near0; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    GU.uCamP.value.copy(camP0); GU.uFade.value.w = fade0; GU.uInB.value = inB0;
    try { stage.render(); } catch { /* the next frame draws it */ }
    r.shadowMap.autoUpdate = auto0;
  }
  return pic;
}

/**
 * The picture from another pose (an agent's eyes: ui/see-for-agent.js), taken right after the page's own frame is drawn
 * (the 'postframe' event: the world as this frame has it — people, cars, the floor looked into) or, with no frame soon,
 * drawn here. Resolves the copy as a canvas (made smaller by whoever sends it: encoded once, not twice); rejects when there
 * is no world to draw or the picture came out empty.
 */
export function captureFrom(app, pose) {
  return new Promise((resolve, reject) => {
    if (!hasWorld(app)) { reject(new Error('There is no view of the world on this page.')); return; }
    if (!pose || ![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) { reject(new Error('Not a place to look from.')); return; }
    let done = false, off = null, timer = 0;
    const take = () => {
      if (done) return;
      done = true; off?.(); clearTimeout(timer);
      let pic;
      try { pic = drawFrom(app, pose); } catch (e) { reject(e); return; }
      if (blank(pic)) { reject(new Error('The picture came out empty. Try again.')); return; }
      resolve(pic);
    };
    off = bus.on('postframe', take);
    timer = setTimeout(take, WAIT_MS);
  });
}

/**
 * Takes the picture: resolves { file (a JPEG File), view (viewOf, from the same frame) }. Rejects when there is no world
 * to take or the picture came out empty.
 */
export function captureView(app) {
  return new Promise((resolve, reject) => {
    if (!hasWorld(app)) { reject(new Error('There is no view of the world on this page.')); return; }
    const stage = app.stage, canvas = stage.renderer.domElement;
    let done = false, off = null, timer = 0;
    const take = () => {
      if (done) return;
      done = true; off?.(); clearTimeout(timer);
      let pic, view;
      try { pic = copyNow(canvas); view = viewOf(app); } catch (e) { reject(e); return; }
      if (blank(pic)) { reject(new Error('The picture came out empty. Try again.')); return; }
      pic.toBlob(blob => {
        if (!blob) { reject(new Error('The picture could not be made. Try again.')); return; }
        const t = new Date(), p = n => String(n).padStart(2, '0');
        resolve({ file: new File([blob], `my-view-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.jpg`, { type: 'image/jpeg' }), view });
      }, 'image/jpeg', 0.9);
    };
    off = bus.on('postframe', take);
    timer = setTimeout(() => { if (done) return; try { stage.render(); } catch { /* the last frame's, if any */ } take(); }, WAIT_MS);
  });
}
