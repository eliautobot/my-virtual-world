// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Vehicles' sounds (2026-10-26, F3 of the sound effects plan; the product owner: "all vehicles don't have sounds, like
// tire effects, revving, engine running"): recorded with ElevenLabs, played by the sound engine (audio/engine.js) from
// where each vehicle is.
// - Your car: the doors and the key as you get in, the engine as you drive: ElevenLabs recordings of an engine sweeping
//   through its revs under load and coasting down, played as grains from the moment of the sweep at the revs it has now
//   (audio/engine.js grain), so its tone changes with the revs as a real engine's does; the revs rise in each gear by its
//   ratio and drop to the next one's at an upshift (a moment off the throttle, the gearbox's clunk), the clutch slips them
//   up pulling away, the throttle revs it at a standstill; on the throttle it sounds pulling, off it coasting; the tyres rolling on what is under them (asphalt, gravel
//   and dirt, grass); a squeal whenever a wheel leaves a tyre mark (the marks' own rule), louder and higher the more wheels
//   and the harder they slip and with the speed, a slide on loose ground; a crash by how
//   hard the car stopped; the horn on H. A bus is a diesel and hisses its air brakes as it stops.
// - The cars around you (traffic, others' cars, residents driving): the nearest few within reach, each its engine at
//   its speed and its tyres, idling while it waits at a light.
// - Boats: your boat's outboard (small boats) or inboard (larger) by the throttle lever's revs, the water along the
//   hull by the speed, its horn on H; the ferries' deep engine while they sail and their horn as they leave the dock.
// The volume is Vehicles (Settings → Sound).
import { S, bus } from '../core/state.js';
import { surfaceAt } from './footsteps.js';
import { BOATS } from '/shared/boat-model.js';
import { boatAt } from '/shared/ferries.js';

const KINDS = ['sedan', 'compact', 'suv', 'van', 'taxi', 'bus'];
const PITCH = { sedan: 1, compact: 1.08, suv: 0.9, van: 0.87, taxi: 1, bus: 1 };   // (a small engine revs higher)
const GEARS = [0, 6.5, 12, 18, 25, 33, 1e9];   // m/s at the top of each gear (a shift drops the revs to the next one's ratio)
const REDLINE = 0.95, HZ_IDLE = 66, HZ_RED = 190;   // (idle: the sweep's start a little slowed; its own idle recording measured rough: 0.38 against 0.22)   // revs 0..1 → the engine's firing frequency (a four: rpm / 30: 800 to 5700 rpm)
const MARK = 0.16;   // a wheel's slip from which it leaves a tyre mark (shared/driving-classic/vehicle-skid-marks.mjs)
/** The tyres' squeal from the wheels: whenever a wheel leaves a mark it squeals, louder and higher the more wheels and
 *  the harder they slip, and with the speed (a burnout at a standstill still screams). */
function squeal(wheels, v) {
  let n = 0, s = 0;
  for (const w of wheels || []) if (w?.contact && (w.slip || 0) >= MARK) { n++; s += Math.min(1, ((w.slip || 0) - MARK) / 0.5); }
  if (!n) return { gain: 0, rate: 1 };
  const k = Math.min(1, s / 2), speed = 0.5 + 0.5 * Math.min(1, v / 12);
  return { gain: (0.32 + 0.6 * k) * speed * Math.min(1, 0.6 + n * 0.2), rate: 0.9 + 0.22 * k + 0.06 * Math.min(1, v / 20) };
}
const NEAR = 70, MOST = 6;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let app = null, mine = null, others = new Map(), boat = null, ferries = new Map(), lastId = null;

export function init(a) {
  app = a;
  bus.on('frame', update);
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyH' || e.repeat || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
    horn();
  });
  a.vehicleSound = { get mine() { return mine && { rpm: +mine.rpm.toFixed(2), gear: mine.gear, kind: mine.kind, load: +mine.load.toFixed(2), squeal: mine.squeal || 0 }; }, get others() { return [...others.keys()]; }, get boat() { return boat && { rpm: boat.rpm }; }, get ferries() { return ferries.size; }, horn };
}
const fx = () => app.sfx;
const kindOf = k => KINDS[k] || 'sedan';
const loop = (name, gain = 0) => fx().loop(name, { kind: 'vehicles', ref: 8, gain });
const grain = (name, grainLen) => fx().grain(name, { kind: 'vehicles', ref: 8, grain: grainLen });
const shot = (name, pos, gain = 0.8, delay = 0) => fx().play(name, { pos, kind: 'vehicles', gain, ref: 6, delay });
const posOf = c => ({ x: c.x, y: (c.y ?? 0) + 0.5, z: c.z });
/** What the tyres roll on: the road, loose ground, or grass. */
function tyreSurface(c) {
  const s = surfaceAt(c.x, c.y ?? 0, c.z, -1);
  return s === 'concrete' || s === 'wood' || s === 'tile' ? 'road' : s === 'grass' || s === 'snow' ? 'grass' : 'gravel';
}

function update(dt) {
  if (!fx()?.ready || !dt) return;
  myCar(dt);
  traffic(dt);
  myBoat(dt);
  ferryEngines();
}

// ------------------------------------------------------------------ your car
function myCar(dt) {
  const D = app.driving, id = D?.id || null, c = id ? D.driving : null;
  if (id !== lastId) {
    if (lastId && mine) { const p = mine.pos; shot('car-stop', p, 0.6); shot('car-door-open', p, 0.6, 0.5); shot('car-door-close', p, 0.7, 1.3); for (const h of mine.loops) h.stop(0.8); mine = null; }
    lastId = id;
    if (id && c) {
      const kind = kindOf(c.k), bus_ = kind === 'bus', p = posOf(c);
      shot('car-door-open', p, 0.6); shot('car-door-close', p, 0.7, 0.7); if (!bus_) shot('car-start', p, 0.7, 1.1);
      mine = { kind, bus: bus_, rpm: 0.13, gear: 1, load: 0, shift: 0, v: 0, t0: performance.now() + (bus_ ? 900 : 2200), pos: p, crashAt: 0,
        idle: loop(bus_ ? 'bus-idle' : 'car-idle'), on: grain(bus_ ? 'engine-bus' : 'engine-on'), off: bus_ ? null : grain('engine-off'),
        tyre: { road: loop('tyre-road'), gravel: loop('tyre-gravel'), grass: loop('tyre-grass') }, skid: loop('skid'), slide: loop('skid-dirt') };
      mine.loops = [mine.idle, mine.on, mine.off, ...Object.values(mine.tyre), mine.skid, mine.slide].filter(Boolean);
    }
  }
  if (!mine || !c) return;
  const v = Math.abs(c.v || 0), p = mine.pos = posOf(c), inp = app.player?.drivingInput?.() || { throttle: 0 };
  const thr = Math.min(1, Math.abs(inp.throttle || 0));
  if (performance.now() < mine.t0) { for (const h of mine.loops) h.set({ gain: 0, pos: p }); return; }   // (the key turning)
  // the revs, as a gearbox makes them: in a gear they rise with the speed (its ratio: REDLINE at the top of the gear); an
  // upshift drops them to the next gear's (the throttle lifted for a moment, the gearbox's clunk); pulling away the
  // clutch slips them up with the throttle; a standstill with the foot down revs it; the foot off, back to idle
  let g = 1; while (v > GEARS[g] && g < GEARS.length - 2) g++;
  if (mine.bus) g = 1;
  let want = mine.bus ? 0.16 + Math.min(1, v / 16) * 0.7 : Math.max(0.13, (v / GEARS[g]) * REDLINE);
  if (!mine.bus && g === 1 && v < 4 && thr > 0.05) want = Math.max(want, 0.2 + 0.35 * thr);   // (the clutch slipping as it pulls away)
  if (v < 0.6) want = thr > 0.05 ? 0.2 + 0.6 * thr : 0.13;   // (revving where it stands, or idling)
  if (g > mine.gear && thr > 0.2 && !mine.bus) { mine.shift = 0.22; shot('gear-shift', p, 0.35); }   // an upshift
  mine.gear = g; mine.shift = Math.max(0, mine.shift - dt);
  const lift = mine.shift > 0, wantLoad = lift ? 0 : thr > 0.05 ? Math.min(1, 0.55 + 0.45 * thr) : 0;
  mine.load += (wantLoad - mine.load) * Math.min(1, dt * (lift ? 20 : 7));
  mine.rpm += (want - mine.rpm) * Math.min(1, dt * (lift ? 16 : want > mine.rpm ? 4 + 4 * thr : 2.5));
  const r = mine.rpm, hz = (mine.bus ? 30 : HZ_IDLE) + r * (mine.bus ? 70 : HZ_RED - HZ_IDLE), L = mine.load, E = 0.8;
  const run = ss(0.12, 0.2, r), tone = 2600 + 6500 * Math.max(L, r * 0.5);
  mine.idle.set({ pos: p, gain: mine.bus ? E * (1 - run) : 0, rate: PITCH[mine.kind] });   // (a bus: its diesel idle)
  mine.on.set({ pos: p, gain: E * (mine.bus ? run * (0.55 + 0.45 * L) : run * L + (1 - run) * 0.75), hz: hz * (mine.bus ? 1 : PITCH[mine.kind]), tone: mine.bus ? tone : Math.max(tone, 3200) });
  mine.off?.set({ pos: p, gain: E * run * (1 - L) * 0.75, hz: hz * PITCH[mine.kind], tone: 1800 + 3000 * r });
  // the tyres: rolling, skidding, sliding
  const surf = tyreSurface(c), roll = Math.min(1, v / 22), contact = (c.wheels || []).some(w => w.contact);
  for (const [s, h] of Object.entries(mine.tyre)) h.set({ pos: p, gain: contact && s === surf ? 0.55 * roll : 0, rate: 0.85 + roll * 0.35 });
  const sk = squeal(c.wheels, v);
  mine.skid.set({ pos: p, gain: surf === 'road' ? sk.gain : 0, rate: sk.rate });
  mine.slide.set({ pos: p, gain: surf !== 'road' ? sk.gain : 0, rate: 0.9 + sk.rate * 0.1 });
  mine.squeal = +sk.gain.toFixed(2);
  // a crash: how hard it stopped
  const dv = mine.v - v, now = performance.now();
  if (mine.v > 3 && dv / dt > 14 && now > mine.crashAt) { mine.crashAt = now + 700; shot(dv > 7 ? 'crash-heavy' : 'crash-light', p, Math.min(1, 0.4 + dv / 10)); }
  if (mine.bus && mine.v > 1.5 && v < 0.2) shot('air-brake', p, 0.6);
  mine.v = v;
}
function horn() {
  if (!fx()?.ready) return;
  if (mine && app.driving?.driving) return shot(mine.bus ? 'bus-horn' : 'car-horn', mine.pos, 0.9);
  const B = app.boating; if (B?.active && B.state()) { const s = B.state(); shot('boat-horn', { x: s.x, y: (s.y ?? 0) + 1.5, z: s.z }, 0.9); }
}

// ------------------------------------------------------------------ the cars around you
/** The moving cars near the listener: the vehicle stream's (traffic, others' cars) and residents driving. */
function nearCars() {
  const L = fx().listener, out = [], ownId = app.driving?.id, t = S.simT;
  for (const c of app.driving?.list?.() || []) {
    if (c.id === ownId) continue;
    const d = Math.hypot(c.x - L.x, (c.y ?? 0) - L.y, c.z - L.z); if (d > NEAR) continue;
    out.push({ id: `v${c.id}`, d, x: c.x, y: c.y, z: c.z, v: Math.abs(c.v || 0), kind: kindOf(c.k), wheels: c.wheels });
  }
  for (const D of app.residentCars?.drives?.values?.() || []) {
    const a = D.at; if (!a || Math.abs(a.t - t) > 2) continue;
    const d = Math.hypot(a.x - L.x, a.y - L.y, a.z - L.z); if (d > NEAR) continue;
    const was = D.atPrev, v = was && a.t > was.t ? Math.abs(a.d - was.d) / (a.t - was.t) : 0;
    if (!was || a.t !== was.t) D.atPrev = { ...a, v };
    out.push({ id: `r${D.i}`, d, x: a.x, y: a.y, z: a.z, v: D.atPrev?.v ?? v, kind: kindOf(D.k % 5) });
  }
  return out.sort((a, b) => a.d - b.d);
}
function traffic(dt) {
  const near = nearCars(), keep = new Set(), now = performance.now();
  for (const c of near) {
    if (keep.size >= MOST) break;
    let o = others.get(c.id);
    if (!o) {
      if (c.v < 0.3) continue;   // (a parked car stays quiet)
      const bus_ = c.kind === 'bus';
      others.set(c.id, o = { bus: bus_, moved: now, v: c.v, eng: grain(bus_ ? 'engine-bus' : 'engine-on'), idle: loop(bus_ ? 'bus-idle' : 'car-idle'), tyre: loop('tyre-road'), skid: loop('skid') });
    }
    if (c.v > 0.3) o.moved = now;
    if (now - o.moved > 20000) continue;   // (stopped for good: parked)
    keep.add(c.id);
    const p = { x: c.x, y: (c.y ?? 0) + 0.5, z: c.z }, pitch = PITCH[c.kind] || 1, mv = ss(0.4, 2.5, c.v);
    let g = 1; while (c.v > GEARS[g] && g < GEARS.length - 2) g++;   // (its revs by the same gearbox as yours)
    const r = o.bus ? 0.16 + Math.min(1, c.v / 16) * 0.7 : Math.max(0.2, (c.v / GEARS[g]) * REDLINE);
    o.eng.set({ pos: p, gain: o.bus ? 0.5 * mv : 0.5 * mv + 0.4 * (1 - mv), hz: o.bus ? 30 + r * 70 : (HZ_IDLE + r * (HZ_RED - HZ_IDLE)) * pitch, tone: 5000 });
    const sk = squeal(c.wheels, c.v); o.skid.set({ pos: p, gain: sk.gain * 0.8, rate: sk.rate });
    o.idle.set({ pos: p, gain: o.bus ? 0.45 * (1 - mv) : 0, rate: pitch });
    o.tyre.set({ pos: p, gain: 0.45 * Math.min(1, c.v / 20), rate: 0.85 + Math.min(0.35, c.v / 60) });
    if (o.bus && o.v > 1.5 && c.v < 0.2) shot('air-brake', p, 0.5);
    o.v = c.v;
  }
  for (const [id, o] of others) if (!keep.has(id)) { o.eng.stop(); o.idle.stop(); o.tyre.stop(); o.skid.stop(); others.delete(id); }
}

// ------------------------------------------------------------------ boats
function myBoat() {
  const B = app.boating, s = B?.active ? B.state() : null;
  if (!s) { if (boat) { for (const h of boat.loops) h.stop(1); boat = null; } return; }
  if (!boat || boat.type !== s.type) {
    if (boat) for (const h of boat.loops) h.stop(0.5);
    const big = (BOATS[s.type]?.L || 6) >= 8;
    boat = { type: s.type, big, idle: loop('outboard-idle'), run: loop(big ? 'inboard-run' : 'outboard-run'), wash: loop('boat-wash') };
    boat.loops = [boat.idle, boat.run, boat.wash];
  }
  const p = { x: s.x, y: (s.y ?? 0) + 0.8, z: s.z }, rpm = Math.min(1, Math.abs(s.rpm || 0)), u = Math.hypot(s.u || 0, s.v || 0);
  boat.rpm = +rpm.toFixed(2);
  boat.idle.set({ pos: p, gain: 0.55 * (1 - ss(0.1, 0.35, rpm)), space: 'out', rate: boat.big ? 0.8 : 1 });
  boat.run.set({ pos: p, gain: 0.7 * ss(0.05, 0.3, rpm), space: 'out', rate: 0.75 + rpm * 0.5, tone: 2500 + 7000 * rpm });
  boat.wash.set({ pos: p, gain: 0.6 * Math.min(1, u / 9), space: 'out', rate: 0.9 + Math.min(0.3, u / 30) });
}
const _f = {};
function ferryEngines() {
  const L = fx().listener, t = S.simT, keep = new Set();
  for (const line of app.ferries?.lines || []) {
    const n = line.f?.boats || 1, level = line.docks?.[0]?.level ?? 0;
    for (let k = 0; k < n; k++) {
      boatAt(line.f, k, t, _f);
      const d = Math.hypot(_f.x - L.x, level - L.y, _f.z - L.z), id = `${line.f.id ?? line.f.name ?? ''}:${k}`;
      if (d > 260) continue;
      keep.add(id);
      let o = ferries.get(id);
      if (!o) ferries.set(id, o = { eng: fx().loop('ferry-engine', { kind: 'vehicles', ref: 25 }), sailing: _f.sailing });
      const p = { x: _f.x, y: level + 3, z: _f.z };
      o.eng.set({ pos: p, gain: _f.sailing ? 0.7 : 0.25 });
      if (_f.sailing && !o.sailing) fx().play('ferry-horn', { pos: p, kind: 'vehicles', ref: 60, gain: 0.9 });
      o.sailing = _f.sailing;
    }
  }
  for (const [id, o] of ferries) if (!keep.has(id)) { o.eng.stop(1.5); ferries.delete(id); }
}
