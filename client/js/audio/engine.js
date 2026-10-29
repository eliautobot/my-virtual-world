// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The sound engine (2026-10-26, the product owner: "sound needs to be position dependent ... inside sounds different from
// outside"): recorded sounds (client/assets/sfx/, made with ElevenLabs; sfx.json lists each sound's takes) played in one
// audio context, placed in 3D around the listener, and heard through the walls the way they would be.
//
// - The listener sits between the camera and what it looks at (halfway), facing the camera's way: walking, that is just
//   behind the player's head; high above the city, high above it (the ground's small sounds fade out by distance).
// - Where the listener is: outside, inside a building (walking in one, or looking into one of its floors), or
//   underwater. Every sound belongs to a place too: 'out', 'water', or a building's index. The same place: as it is.
//   Outside heard from inside: through the walls (quieter, dull). Inside heard from outside: only near, and dull.
//   Another building: not at all. Underwater: everything outside is far and dull.
// - Each sound has several takes: play() picks one at random (never the one just played), a little higher or lower and
//   louder or softer, so nothing repeats the same way.
// - At most VOICES one-shots at once (the quietest new one is dropped); a sound out of reach is not started at all;
//   nothing is fetched until it is first wanted, and a take is decoded once.
// - The volume of each kind of sound is the mixer's (audio/mixer.js); 'audio:duck' turns everything down to a whisper
//   while the page listens. Nothing starts before the first click or key (browser rules); it sleeps while hidden.
//
// app.sfx = { play(name, o), loop(name, o), listener, ready, stats }:
//   play(name, { pos: {x,y,z} | null, space: 'out'|'water'|b, gain, rate, ref, max, kind }) → a voice or null
//   loop(name, { pos, space, gain, kind }) → { set({ gain, pos, rate, tone }), stop(fade) }   (beds and engines; tone: a lowpass, Hz)
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';

const VOICES = 28, DUCK = 0.08;
// how one place is heard from another: [gain, lowpass Hz]
const THROUGH = { inOut: [0.28, 650], outIn: [0.3, 480], water: [0.22, 320], none: [0, 200] };
let app = null, ctx = null, master = null, index = null, indexP = null;
const kinds = new Map(), buffers = new Map(), last = new Map(), voices = new Set(), loops = new Set(), ducks = new Set(), grains = new Set();
let grainMaps = {};
const L = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, space: 'out', b: -1, f: 0, alt: 0 };

export function init(a) {
  app = a;
  const start = () => { if (!ctx) begin(); else if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start);
  bus.on('sound', () => setVolumes());
  bus.on('audio:duck', ({ who, on } = {}) => { if (!who) return; if (on) ducks.add(who); else ducks.delete(who); setVolumes(); });
  document.addEventListener('visibilitychange', () => { if (ctx) (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {}); });
  bus.on('frame', update);
  a.sfx = {
    play, loop, grain, preload,
    out: kind => ctx ? kindBus(kind) : null,   // (a kind's bus, for players of their own: the radio)
    gain: kind => ctx ? (kinds.get(kind)?.gain.value ?? level(kind)) * master.gain.value : null,
    get ready() { return !!ctx && ctx.state === 'running' && !!index; },
    get ctx() { return ctx; },
    listener: L,
    get stats() { return { voices: voices.size, loops: [...loops].filter(l => l.on).map(l => ({ name: l.name, gain: +l.heard.toFixed(3), space: l.space })), grains: [...grains].filter(g => g.nodes).map(g => ({ name: g.name, gain: +g.heard.toFixed(3), hz: Math.round(g.hz) })), decoded: buffers.size }; },
    /** (lab checks: everything this engine plays, as a MediaStream to record) */
    tap() { if (!ctx) return null; const d = ctx.createMediaStreamDestination(); master.connect(d); return d.stream; },
  };
}
function begin() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  master = ctx.createGain(); master.connect(ctx.destination);
  loadIndex();
  setVolumes();
  bus.emit('sfx:ready');
}
function loadIndex() {
  return indexP || (indexP = fetch('/assets/sfx/sfx.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { sounds: {} }).then(j => { index = j.sounds || {}; grainMaps = j.grains || {}; return index; }).catch(() => { index = {}; return index; }));
}
/** The bus of one kind of sound (world, effects, vehicles…), at its mixer volume. */
function kindBus(kind) {
  let g = kinds.get(kind);
  if (!g) { g = ctx.createGain(); g.gain.value = level(kind); g.connect(master); kinds.set(kind, g); }
  return g;
}
function setVolumes() {
  if (!ctx) return;
  const d = ducks.size ? DUCK : 1;
  master.gain.setTargetAtTime(d, ctx.currentTime, ducks.size ? 0.15 : 0.6);
  for (const [k, g] of kinds) g.gain.setTargetAtTime(level(k), ctx.currentTime, 0.2);
}

// ------------------------------------------------------------------ files
/** A take's audio, decoded once (the MP3's silent padding trimmed from a loop's ends, so it loops without a gap). */
function take(id, isLoop) {
  let p = buffers.get(id);
  if (!p) {
    p = fetch(`/assets/sfx/${id}.mp3`).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b)).then(buf => isLoop ? trimPad(buf) : buf).catch(() => null);
    buffers.set(id, p);
  }
  return p;
}
function trimPad(buf) {
  const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i)), n = buf.length, quiet = i => ch.every(c => Math.abs(c[i]) < 2e-4);
  let a = 0, b = n - 1;
  while (a < n / 4 && quiet(a)) a++;
  while (b > n * 3 / 4 && quiet(b)) b--;
  if (a === 0 && b === n - 1) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, b - a + 1, buf.sampleRate);
  ch.forEach((c, i) => out.copyToChannel(c.subarray(a, b + 1), i));
  return out;
}
/** One take of a sound: at random, never the one played last (when there are others). */
function pick(name) {
  const s = index?.[name]; if (!s?.takes?.length) return null;
  const t = s.takes; if (t.length === 1) return t[0];
  let k = Math.floor(Math.random() * t.length);
  if (t[k] === last.get(name)) k = (k + 1 + Math.floor(Math.random() * (t.length - 1))) % t.length;
  last.set(name, t[k]);
  return t[k];
}
/** Fetches and decodes a sound's takes ahead of use (a loop about to start, the steps of a walk). */
export function preload(name) { if (!ctx || !index?.[name]) return; for (const id of index[name].takes) take(id, index[name].loop); }

// ------------------------------------------------------------------ granular sources (engines)
// A recording of an engine sweeping through its revs (sfx.json grains: its pitch map, [seconds, Hz] rising) played as a
// stream of short overlapping slices, each from the moment of the sweep whose pitch is the one wanted now: the engine's
// sound changes with its revs as a real one does (its tone, not only its pitch), and nothing is bent far from where it
// was recorded (2026-10-26: "it's only a pitch change which makes vehicles sound tinny"). Below or above the sweep, its
// end is bent (at most to 0.5x or 1.2x). Slices of 200 ms, four overlapping (GRAIN, OVERLAP, HANN).
const GRAIN = 0.2, OVERLAP = 4;
// each slice faded in and out by a Hann curve (four at a time sum to an even level: x 0.5); every slice of one pitch read
// from the same moment of the sweep, never jittered: a random offset scrambled the engine's firing rhythm into a rough,
// misfiring sound (2026-10-27: "it sounds like a failing engine not a smooth proper running engine"; measured: jittered
// 0.27, now 0.08 against the recording's own 0.10 on the envelope's flicker)
const HANN = Float32Array.from({ length: 64 }, (_, i) => 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 63)));
/** A granular source: grain(name, { pos, space, kind, ref }) → { set({ gain, hz, pos, tone }), stop(fade) }. */
function grain(name, o = {}) {
  const h = { name, want: 0, hz: 100, pos: o.pos || null, space: o.space ?? 'out', tone: null, o, nodes: null, buf: null, loading: false, next: 0, heard: 0, grain: o.grain || GRAIN };
  h.set = (p = {}) => { if (p.gain != null) h.want = p.gain; if (p.hz != null) h.hz = p.hz; if (p.pos) h.pos = p.pos; if (p.tone != null) h.tone = p.tone; return h; };
  h.stop = (fade = 0.5) => { grains.delete(h); h.want = 0; const n = h.nodes; h.nodes = null; if (n && ctx) { n.g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); setTimeout(() => { n.pan?.disconnect(); n.lp.disconnect(); }, fade * 1000 + 300); } };
  grains.add(h);
  return h;
}
/** Where in the sweep a pitch is: { t, rate }. */
function sweepAt(G, hz) {
  const m = G.map;
  if (hz <= m[0][1]) return { t: m[0][0], rate: Math.max(0.5, hz / m[0][1]) };
  if (hz >= m[m.length - 1][1]) return { t: m[m.length - 1][0], rate: Math.min(1.2, hz / m[m.length - 1][1]) };
  let i = 1; while (m[i][1] < hz) i++;
  const a = m[i - 1], b = m[i], u = (hz - a[1]) / (b[1] - a[1]);
  return { t: a[0] + (b[0] - a[0]) * u, rate: 1 };
}
function grainTick(h, now) {
  const G = grainMaps[h.name]; if (!G || !index?.[h.name]) return;
  if (!h.buf) { if (!h.loading) { h.loading = true; take(index[h.name].takes[0], false).then(b => { h.buf = b; }); } return; }
  const [tg, tf] = through(h.space), ref = h.o.ref ?? 6;
  h.heard = h.want * tg * (h.pos ? atDistance(dist(h.pos), ref) : 1);
  if (h.heard < 0.002) { if (h.nodes) { const n = h.nodes; h.nodes = null; n.g.gain.setTargetAtTime(0, now, 0.1); setTimeout(() => { n.pan?.disconnect(); n.lp.disconnect(); }, 600); } h.next = 0; return; }
  if (!h.nodes) { h.nodes = chain({ ...h.o, pos: h.pos, space: h.space, gain: 0 }); h.next = now + 0.02; }
  h.nodes.g.gain.setTargetAtTime(h.want * tg, now, 0.08);
  h.nodes.lp.frequency.setTargetAtTime(Math.min(tf, h.tone ?? 22000), now, 0.08);
  if (h.pos && h.nodes.pan) setPos(h.nodes.pan, h.pos, false);
  if (h.next < now) h.next = now + 0.01;
  const L = h.grain;
  while (h.next < now + 0.12) {
    const { t, rate } = sweepAt(G, h.hz), src = ctx.createBufferSource(), g = ctx.createGain(), when = h.next;
    src.buffer = h.buf; src.playbackRate.value = rate;
    g.gain.value = 0; g.gain.setValueCurveAtTime(HANN, when, L);
    src.connect(g); g.connect(h.nodes.g);
    const from = Math.max(0, Math.min(h.buf.duration - L * rate - 0.01, t - (L * rate) / 2));
    src.start(when, from, L * rate + 0.005); src.stop(when + L + 0.01);
    src.onended = () => g.disconnect();
    h.next += L / OVERLAP;
  }
}

// ------------------------------------------------------------------ where things are heard
/** How a sound in `space` is heard by the listener now: [gain, lowpass Hz]. */
function through(space) {
  if (space === 'any') return [1, 22000];
  if (L.space === 'water') return space === 'water' ? [1, 22000] : THROUGH.water;
  if (space === 'water') return THROUGH.none;
  if (space === 'out') return L.space === 'out' ? [1, 22000] : THROUGH.inOut;
  if (L.space === 'out') return THROUGH.outIn;   // (inside a building, heard from the street)
  return space === L.b ? [1, 22000] : THROUGH.none;
}
function listen() {
  const cam = app.stage?.camera, t = app.cam?.target; if (!cam || !t) return;
  const P = app.player, cp = cam.position;
  L.x = (cp.x + t.x) / 2; L.y = (cp.y + t.y) / 2; L.z = (cp.z + t.z) / 2;
  const dx = t.x - cp.x, dy = t.y - cp.y, dz = t.z - cp.z, m = Math.hypot(dx, dy, dz) || 1;
  L.fx = dx / m; L.fy = dy / m; L.fz = dz / m;
  const T = app.terrain, sea = T?.params?.seaLevel ?? 0;
  const ground = T ? Math.max(sea, T.heightAt(L.x, L.z)) : 0;
  L.alt = Math.max(0, L.y - ground);
  if (P?.active && P.ctx >= 0) { L.space = 'in'; L.b = P.ctx >> 6; L.f = P.ctx & 63; }
  else if (!P?.active && S.focus && S.focus.b >= 0) { L.space = 'in'; L.b = S.focus.b; L.f = S.focus.f | 0; }
  else if ((P?.active && P.diving) || (cp.y < sea - 0.25 && T?.isWater?.(cp.x, cp.z))) { L.space = 'water'; L.b = -1; }
  else { L.space = 'out'; L.b = -1; }
  const l = ctx.listener, now = ctx.currentTime;
  if (l.positionX) {
    l.positionX.setTargetAtTime(L.x, now, 0.03); l.positionY.setTargetAtTime(L.y, now, 0.03); l.positionZ.setTargetAtTime(L.z, now, 0.03);
    l.forwardX.setTargetAtTime(L.fx, now, 0.03); l.forwardY.setTargetAtTime(L.fy, now, 0.03); l.forwardZ.setTargetAtTime(L.fz, now, 0.03);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else { l.setPosition(L.x, L.y, L.z); l.setOrientation(L.fx, L.fy, L.fz, 0, 1, 0); }
}
const dist = p => p ? Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z) : 0;
/** How loud a placed sound is at the listener by distance alone (the panner's inverse law), for choosing what to play. */
const atDistance = (d, ref) => ref / (ref + Math.max(0, d - ref));

/** source → gain → lowpass → (panner) → its kind's bus */
function chain(o) {
  const g = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 0.5;
  const [tg, tf] = through(o.space ?? 'out');
  g.gain.value = (o.gain ?? 1) * tg; lp.frequency.value = tf;
  g.connect(lp);
  let pan = null;
  if (o.pos) {
    pan = ctx.createPanner();
    pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse';
    pan.refDistance = o.ref ?? 6; pan.maxDistance = 10000; pan.rolloffFactor = o.rolloff ?? 1;
    setPos(pan, o.pos, true);
    lp.connect(pan); pan.connect(kindBus(o.kind || 'world'));
  } else lp.connect(kindBus(o.kind || 'world'));
  return { g, lp, pan };
}
function setPos(pan, p, now) {
  if (pan.positionX) { if (now) { pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z; } else { const t = ctx.currentTime; pan.positionX.setTargetAtTime(p.x, t, 0.05); pan.positionY.setTargetAtTime(p.y, t, 0.05); pan.positionZ.setTargetAtTime(p.z, t, 0.05); } }
  else pan.setPosition(p.x, p.y, p.z);
}

/** Plays one take of a sound once. Not started when nothing would be heard (out of reach, another building, muted). */
function play(name, o = {}) {
  if (!ctx || ctx.state !== 'running' || !index) return null;
  const s = index[name]; if (!s) return null;
  const ref = o.ref ?? 6, heard = (o.gain ?? 1) * through(o.space ?? 'out')[0] * (o.pos ? atDistance(dist(o.pos), ref) : 1) * level(o.kind || 'world');
  if (heard < (o.floor ?? 0.004)) return null;
  if (voices.size >= VOICES) {   // full: the quietest playing one makes way, if it is quieter than this
    let q = null; for (const v of voices) if (!q || v.heard < q.heard) q = v;
    if (!q || q.heard >= heard) return null;
    q.stop();
  }
  const id = pick(name), v = { name, heard, space: o.space ?? 'out', o, g0: (o.gain ?? 1) * (1 + (Math.random() - 0.5) * 0.25), src: null, nodes: null, dead: false };
  v.stop = () => { v.dead = true; try { v.src?.stop(); } catch { /* not started */ } voices.delete(v); };
  voices.add(v);
  take(id, false).then(buf => {
    if (!buf || v.dead || !ctx) { voices.delete(v); return; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = o.rate ?? (1 + (Math.random() - 0.5) * 2 * (o.vary ?? 0.05));
    const n = chain({ ...o, gain: v.g0 });
    src.connect(n.g); v.src = src; v.nodes = n;
    src.onended = () => { voices.delete(v); n.pan?.disconnect(); n.lp.disconnect(); };
    src.start(ctx.currentTime + (o.delay || 0));
  });
  return v;
}

/** A sound looping on (a bed, a room's tone, an engine): set() its level and place each frame; stop() fades it out. A
 *  loop at 0 for a while lets its nodes go, and starts again when wanted. */
function loop(name, o = {}) {
  const h = { name, space: o.space ?? 'out', want: o.gain ?? 0, pos: o.pos || null, rate: o.rate ?? 1, heard: 0, on: false, nodes: null, src: null, idle: 0, o };
  h.set = (p = {}) => { if (p.gain != null) h.want = p.gain; if (p.tone != null) h.tone = p.tone; if (p.pos) h.pos = p.pos; if (p.space != null) h.space = p.space; if (p.rate != null) h.rate = p.rate; return h; };
  h.stop = (fade = 0.6) => { h.want = 0; h.idle = 99; loops.delete(h); off(h, fade); };
  loops.add(h);
  return h;
}
function on(h) {
  if (h.on || !index?.[h.name]) return;
  h.on = true;
  const id = pick(h.name);
  take(id, true).then(buf => {
    if (!buf || !h.on || !ctx) { h.on = false; return; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = h.rate;
    const n = chain({ ...h.o, pos: h.pos, space: h.space, gain: 0 });
    src.connect(n.g); src.start(ctx.currentTime, Math.random() * buf.duration);
    h.src = src; h.nodes = n;
  });
}
function off(h, fade = 0.6) {
  if (!h.on) return;
  h.on = false;
  const { src, nodes } = h; h.src = h.nodes = null;
  if (!nodes) return;
  nodes.g.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
  setTimeout(() => { try { src.stop(); } catch { /* gone */ } nodes.pan?.disconnect(); nodes.lp.disconnect(); }, fade * 1000 + 200);
}

function update(dt = 1 / 60) {
  if (!ctx || ctx.state !== 'running') return;
  listen();
  const now = ctx.currentTime;
  for (const h of loops) {
    const [tg, tf] = through(h.space), ref = h.o.ref ?? 6;
    h.heard = h.want * tg * (h.pos ? atDistance(dist(h.pos), ref) : 1);
    if (h.heard > 0.002) { h.idle = 0; on(h); } else if (h.on && (h.idle += dt) > 4) off(h);
    if (!h.nodes) continue;
    h.nodes.g.gain.setTargetAtTime(h.want * tg, now, 0.25);
    h.nodes.lp.frequency.setTargetAtTime(Math.min(tf, h.tone ?? 22000), now, 0.12);
    if (h.src) h.src.playbackRate.setTargetAtTime(h.rate, now, 0.08);
    if (h.pos && h.nodes.pan) setPos(h.nodes.pan, h.pos, false);
  }
  for (const h of grains) grainTick(h, now);
  for (const v of voices) {   // a one-shot keeps its place, but goes dull as the listener walks in or out
    if (!v.nodes) continue;
    const [tg, tf] = through(v.space);
    v.nodes.g.gain.setTargetAtTime(v.g0 * tg, now, 0.1); v.nodes.lp.frequency.setTargetAtTime(tf, now, 0.1);
  }
}
