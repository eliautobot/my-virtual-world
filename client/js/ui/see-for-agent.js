// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's eyes (docs/features/awareness.md §9): when the agent talking with this person needs to see — "what colour is
// that tree" — the server asks this page for one frame ('see': { id, i (its body), x, z, ctx }), and the page draws the
// world from that body's eyes: where it stands on this page, at its eye height (standing, sitting, in a car's seat), a
// step in front of its face so its own head is not in the way, looking where this person looks. One small JPEG goes back
// ('see': { id, mime, data }) — the live connection takes at most 64 KB in one message (server/index.mjs), so the picture
// is fitted to it — or why it can't ('see': { id, error }): this page doesn't draw that body now (another floor, too far,
// hidden), it is in the background (its world stands still), or the view is under water. Never this person's own view in
// its place: a picture the agent is told is "from where you stand" is from there, or there is none.
import { bus } from '../core/state.js';
import { EYES_M } from '/shared/constants.js';
import { CLIP, SEATED_CLIPS } from '../render/anim.js';
import { hasWorld, captureFrom } from './share-view.js';

const BUDGET = 58000;        // base64 characters (a 64 KB WebSocket message holds this and the little else it carries)
const STEPS = [[768, 0.8], [640, 0.72], [512, 0.66], [448, 0.6], [384, 0.55]];
const SLACK_M = 10;          // (as far from this page's own place as the server asks — EYES_M —, its word of where this page
                             //  looks a few metres old)
const SAME_M = 8;            // the body drawn here this close to where the server has it (the same body, a moment apart)
const AHEAD_M = 0.2;         // the eye a step in front of the head: its own head and shoulders behind the lens
// (eye height above the feet: standing, sitting, lying — as first person's, player/player.js eyes())
const EYE_STAND = 1.62, EYE_SIT = 1.18, EYE_LIE = 0.5;

/** The picture at a size and quality: a JPEG Blob. */
function encode(img, side, q) {
  return new Promise((resolve, reject) => {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => (b ? resolve(b) : reject(new Error('no picture'))), 'image/jpeg', q);
  });
}

/** A Blob's bytes as base64, in pieces (a big picture in one call would overflow the stack). */
async function toBase64(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Where this page stands in the world: its player's place while playing, else what its camera looks at. */
function hereOf(app) {
  const P = app.player;
  return P?.active ? { x: P.x, z: P.z } : app.cam?.target ? { x: app.cam.target.x, z: app.cam.target.z } : null;
}

/**
 * The eye of resident `i` as this page draws it now — { x, y, z } — or null when it doesn't: not in a car's seat drawn
 * this frame, not drawn here (indoors on a floor this page doesn't show, hidden), or not where the server has it.
 */
function eyeOf(app, m) {
  const A = app.agents, i = m.i;
  if (!A || !Number.isInteger(i) || i < 0 || i >= A.n) return null;
  const seat = app.carOccupants?.placed?.get('r' + i);
  let x, y, z;
  if (seat) { x = seat.x; z = seat.z; y = Number.isFinite(seat.head) ? seat.head - 0.12 : seat.y + EYE_SIT; }
  else {
    if (!A.vis[i] || A.ctx[i] !== (Number.isFinite(m.ctx) ? m.ctx : -1)) return null;
    const c = A.clip[i];
    x = A.rx[i]; z = A.rz[i]; y = A.ry[i] + (c === CLIP.lie ? EYE_LIE : SEATED_CLIPS.has(c) ? EYE_SIT : EYE_STAND);
  }
  if (![x, y, z].every(Number.isFinite) || Math.hypot(x - m.x, z - m.z) > SAME_M) return null;
  return { x, y, z };
}

/**
 * Which way the eye looks: where this person looks. Its yaw is the camera's; its pitch, in first person, the camera's own
 * (that is where they look), else about level — an orbit camera looks down at its target from behind, not at the ground.
 */
function lookOf(app) {
  const cam = app.stage.camera, d = cam.getWorldDirection(new app.THREE.Vector3());
  const yaw = Math.atan2(d.x, d.z), pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const fp = !!app.cam?.fp;
  return { yaw, pitch: fp ? Math.max(-0.9, Math.min(0.9, pitch)) : Math.max(-0.2, Math.min(0.5, pitch + 0.35)) };
}

export function init(app) {
  bus.on('msg:see', async m => {
    const id = typeof m?.id === 'string' && m.id.length <= 40 ? m.id : null;
    if (!id) return;
    const reply = o => { try { app.net.send({ t: 'see', id, ...o }); } catch { /* the page is closing */ } };
    try {
      if (document.hidden) { reply({ error: 'hidden' }); return; }   // (its world stands still in the background: not now)
      if (!hasWorld(app)) { reply({ error: 'no_world' }); return; }
      if (app.stage.under) { reply({ error: 'under_water' }); return; }
      const here = hereOf(app);
      if (!here || !Number.isFinite(m.x) || !Number.isFinite(m.z) || Math.hypot(here.x - m.x, here.z - m.z) > EYES_M + SLACK_M) { reply({ error: 'not_drawn' }); return; }
      const eye = eyeOf(app, m);
      if (!eye) { reply({ error: 'not_drawn' }); return; }
      const look = lookOf(app);
      const pose = { x: eye.x + Math.sin(look.yaw) * AHEAD_M, y: eye.y, z: eye.z + Math.cos(look.yaw) * AHEAD_M, ...look };
      const img = await captureFrom(app, pose);   // (a canvas: made small and encoded once, below)
      let data = '';
      for (const [side, q] of STEPS) {
        data = await toBase64(await encode(img, side, q));
        if (data.length <= BUDGET) break;
      }
      if (data.length > BUDGET) { reply({ error: 'failed' }); return; }
      reply({ mime: 'image/jpeg', data });
    } catch { reply({ error: 'failed' }); }
  });
}
