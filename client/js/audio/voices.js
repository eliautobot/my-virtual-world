// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' voices in the city (docs/features/companions.md §6; server/voice/lines.js): what an AI agent says out loud is
// heard in its own voice, from where it stands — the way a voice would be heard there (2026-11-15, the product owner:
// "environmental and proximity based, so it makes sense based on location and proximity"):
// - where: a 3D panner at the speaker's body (moving with it), the listener at the player (Play mode) or at the point the
//   camera looks at (sim mode), facing the way the camera faces — so a voice comes from the left or the right, and fades
//   with distance (gone beyond HEAR_M);
// - the place: out in the open, dry with a little air on the far ones; indoors, the room's echo (a short reverb, longer
//   on a bigger floor);
// - what is between: a voice from another floor of the same building, or from inside while you are out (and the other
//   way round), is muffled (low-passed, quieter) and heard only close by;
// - from above: in sim mode, the higher the camera the quieter.
// Who hears it is the server's (the agent's voice audience: everyone near, or only its owner — 'say_voice' to their pages).
// Its owner's own answers (the chat window, talking face to face) come the same way, for its owner alone; the chat
// window's voice mode reads them itself, so never twice. One line at a time per agent; at most MAX_AT_ONCE at once.
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';
import { speak } from '../ui/voice.js';

const HEAR_M = 26;          // m: as far as a voice carries in the same space
const MUFFLED_M = 12;       // m: as far as one is heard through a floor or a wall
const CAM_EXTRA = 10;       // m more round the camera's point in sim mode
const MAX_AT_ONCE = 3;
const PLAYING = new Map();  // body index → { src, nodes, own, until }
let app = null, AC = null, MASTER = null, ROOM = null, ROOM_KEY = '';
export const log = [];      // (lab checks and films: { at, i, kind })

export function init(a) {
  app = a;
  app.voices = { own, stop: stopAll, playing: () => [...PLAYING.keys()] };
  bus.on('msg:say', m => { if (m && m.audio && Number.isInteger(m.i)) line(m.i, m.audio); });
  bus.on('msg:say_voice', m => { if (m && m.audio && Number.isInteger(m.i)) line(m.i, m.audio); });   // (a voice its owner keeps to themselves)
  bus.on('sound', () => { if (MASTER && AC) MASTER.gain.setTargetAtTime(level('voices'), AC.currentTime, 0.05); });
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (AC && AC.state === 'suspended') AC.resume().catch(() => {}); }, { capture: true, passive: true });
  setInterval(update, 100);
}

function ctx() {
  if (AC) return AC;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  AC = new C();
  MASTER = AC.createGain(); MASTER.gain.value = level('voices'); MASTER.connect(AC.destination);
  return AC;
}
/** A room's echo: a decaying noise impulse, longer for a bigger floor (made once per size). */
function room(seconds) {
  const key = seconds.toFixed(1);
  if (ROOM && ROOM_KEY === key) return ROOM;
  const n = Math.max(1, Math.floor(AC.sampleRate * seconds)), buf = AC.createBuffer(2, n, AC.sampleRate);
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 2.6) * (k < AC.sampleRate * 0.012 ? 0.2 : 1); }
  ROOM = buf; ROOM_KEY = key;
  return buf;
}

/** Where the listener is: the player in Play mode, else the point the camera looks at, and how high the camera is. */
function listener() {
  const P = app.player, cam = app.cam;
  if (P?.active) return { x: P.x, y: (P.y || 0) + 1.6, z: P.z, ctx: P.ctx ?? -1, r: HEAR_M, high: 0, yaw: cam?.yaw ?? 0 };
  const t = cam?.target;
  if (!t) return null;
  const ctx = S.focus?.b >= 0 ? S.focus.b * 64 + S.focus.f : -1;
  return { x: t.x, y: (t.y || 0) + 1.6, z: t.z, ctx, r: HEAR_M + CAM_EXTRA, high: Math.max(0, (cam.dist || 40) - 45), yaw: cam.yaw ?? 0 };
}
const building = c => (c >= 0 ? c >> 6 : -1);
const openAir = c => c < 0 || (c % 64 === 0 && S.world?.buildings?.[c >> 6]?.type === 'park');
/** How a voice from body i reaches the listener now: null (not at all), or { x, y, z, d, muffled, indoors, roomS, gain }. */
function path(i, own) {
  const A = app.agents, L = listener();
  if (!A || !L || !(i < A.n)) return null;
  const c = A.ctx[i];
  if (c < -1) return null;   // (underground: the subway)
  const x = A.rx[i], y = (A.ry[i] || 0) + 1.55, z = A.rz[i], d = Math.hypot(x - L.x, z - L.z);
  const same = c === L.ctx || (openAir(c) && openAir(L.ctx));
  // through something: another floor of its building, or the building's walls between inside and out (near its walls)
  const through = !same && (building(c) === building(L.ctx) || (building(c) >= 0) !== (building(L.ctx) >= 0));
  const reach = (same ? L.r : through ? MUFFLED_M : 0) * (own ? 1.3 : 1);
  if (!reach || d > reach) return null;
  const B = c >= 0 ? S.world?.buildings?.[c >> 6] : null, indoors = c >= 0 && !openAir(c);
  const roomS = indoors && B ? Math.min(1.6, 0.45 + Math.sqrt((B.w || 20) * (B.d || 20)) / 60) : 0;
  const fade = Math.pow(Math.max(0, 1 - d / reach), 0.8), high = 1 / (1 + L.high / 70);
  return { x, y, z, d, muffled: through, indoors, roomS, gain: (through ? 0.45 : 1) * (0.35 + 0.65 * fade) * high, L };
}

function stop(i) {
  const p = PLAYING.get(i);
  if (!p) return;
  PLAYING.delete(i);
  try { p.src.onended = null; p.src.stop(); } catch { /* ended */ }
  for (const n of p.nodes) { try { n.disconnect(); } catch { /* gone */ } }
}
function stopAll() { for (const i of [...PLAYING.keys()]) stop(i); }
/** Every tenth of a second: the listener where it is now, each voice from where its speaker is now. */
function update() {
  if (!AC || !PLAYING.size) return;
  const L = listener(), t = AC.currentTime;
  if (L) {
    const li = AC.listener, fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw);   // (the camera looks the way of its yaw + π)
    if (li.positionX) { li.positionX.setTargetAtTime(L.x, t, 0.05); li.positionY.setTargetAtTime(L.y, t, 0.05); li.positionZ.setTargetAtTime(L.z, t, 0.05);
      li.forwardX.setTargetAtTime(fx, t, 0.05); li.forwardY.setTargetAtTime(0, t, 0.05); li.forwardZ.setTargetAtTime(fz, t, 0.05); li.upX.value = 0; li.upY.value = 1; li.upZ.value = 0; }
    else { li.setPosition(L.x, L.y, L.z); li.setOrientation(fx, 0, fz, 0, 1, 0); }
  }
  for (const [i, p] of PLAYING) {
    const w = path(i, p.own);
    const g = w ? w.gain : 0;
    p.gain.gain.setTargetAtTime(g, t, 0.12);
    if (w) {
      if (p.pan.positionX) { p.pan.positionX.setTargetAtTime(w.x, t, 0.05); p.pan.positionY.setTargetAtTime(w.y, t, 0.05); p.pan.positionZ.setTargetAtTime(w.z, t, 0.05); }
      else p.pan.setPosition(w.x, w.y, w.z);
      p.lp.frequency.setTargetAtTime(w.muffled ? 650 : 16000 - Math.min(9000, w.d * 280), t, 0.1);   // (muffled through things; a little air on far ones)
      p.wet.gain.setTargetAtTime(w.indoors ? 0.32 : 0.04, t, 0.2);
    }
  }
}
/** A public line (or one its owner keeps): fetched, decoded, played from its speaker. */
async function line(i, id) {
  if (!path(i, false)) return;
  try {
    const r = await fetch(`/api/voice/line?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!r.ok) return;
    play(i, await r.arrayBuffer(), false);
  } catch { /* the bubble says it */ }
}
async function play(i, data, own) {
  const ac = ctx();
  if (!ac || level('voices') <= 0) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  const w = path(i, own);
  if (!w) return;
  let buf;
  try { buf = await ac.decodeAudioData(data.slice(0)); } catch { return; }
  stop(i);
  if (PLAYING.size >= MAX_AT_ONCE) {
    let far = -1, fd = -1;
    for (const j of PLAYING.keys()) { const q = path(j, PLAYING.get(j).own); const dd = q ? q.d : Infinity; if (dd > fd) { fd = dd; far = j; } }
    if (fd <= w.d) return;
    stop(far);
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.value = w.muffled ? 650 : 16000;
  const pan = ac.createPanner(); Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, maxDistance: 60, rolloffFactor: 0.9 });
  if (pan.positionX) { pan.positionX.value = w.x; pan.positionY.value = w.y; pan.positionZ.value = w.z; } else pan.setPosition(w.x, w.y, w.z);
  const gain = ac.createGain(); gain.gain.value = w.gain;
  const dry = ac.createGain(); dry.gain.value = 1;
  const rev = ac.createConvolver(); rev.buffer = room(w.roomS || 0.5);
  const wet = ac.createGain(); wet.gain.value = w.indoors ? 0.32 : 0.04;
  src.connect(lp); lp.connect(pan); pan.connect(gain);
  gain.connect(dry); dry.connect(MASTER);
  gain.connect(rev); rev.connect(wet); wet.connect(MASTER);
  const p = { src, gain, pan, lp, wet, own, nodes: [src, lp, pan, gain, dry, rev, wet] };
  PLAYING.set(i, p);
  src.onended = () => { if (PLAYING.get(i) === p) setTimeout(() => { if (PLAYING.get(i) === p) stop(i); }, 1600); };   // (the echo dies away)
  src.start();
  log.push({ at: Date.now(), i, kind: own ? 'own' : 'line', muffled: w.muffled, indoors: w.indoors }); if (log.length > 200) log.shift();
}
/** Its owner's answer from agent `rec` (body i), in its voice — when its body is near enough to be heard. */
async function own(rec, i, text) {
  if (!rec || !(i >= 0) || !text || !path(i, true) || level('voices') <= 0) return;
  const t = String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
  try {
    const r = await speak({ agent: rec.id, text: t, plain: true });
    if (!r || r.browser || !r.audio) return;   // (its voice is the browser's: the chat window reads it there)
    play(i, r.audio, true);
  } catch { /* the bubble says it */ }
}
