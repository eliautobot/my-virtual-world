// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The ambient soundscape (WP4.18; redone 2026-10-26, the product owner: "the birds are too fake sounding ... I can hear
// it inside buildings, or at very high altitudes, and it's the same bird track replaying ... the birds need to be location
// based (like all sounds)"). Recorded with ElevenLabs (client/assets/sfx/), played by the sound engine (audio/engine.js),
// which places each sound and hears it through the walls:
// - Beds: wind (soft, strong, and the rush of high air), leaves in the trees, rain (light, heavy, and on the roof when
//   you are inside), surf (calm, rough), a harbour's lapping, streams and rivers, the city by day and by night,
//   crickets and frogs at night, and underwater. Their levels follow the weather (render/weather.js), the hour, and where
//   the listener is (the sea, the city, the country, a river, a lake; height above the ground).
// - Rooms: inside a building, its room's own tone (a home, a shop, a café, a restaurant, an office, a lobby, a gym), and
//   the outside through the walls.
// - Creatures: each one a singer at a real place near you: songbirds and thrushes in the woods, larks over meadows and
//   fields, gulls on the shore, ducks and herons on lakes, sparrows and pigeons in the city; owls and frogs at night.
//   A singer sings its phrases (a different take each time, a little higher or lower) for a while, then another takes
//   its place. Most at dawn, fewer at midday, some at dusk; none in rain or a storm. They are on the ground and in the
//   trees, so high above the world you no longer hear them; inside you hear them only faintly through the walls.
// - Thunder after the lightning, by the distance's delay (a near crack when the flash is close).
import { S, bus } from '../core/state.js';

const SINGERS = 7;            // at most this many creatures singing near you at once
const REACH = 85;             // m: how far around the listener singers may be
// who sings where: [sound, weight, phrases [min, max], gap between phrases s [min, max], hours]
// (no hawk: its screech, a long scream over the woods, is not wanted: the product owner 2026-10-28, "no hawk")
const DAY = h => h >= 5 && h < 20.5, NIGHT = h => h >= 20.5 || h < 5;
const WHO = {
  forest: [['bird-song', 3, [2, 5], [2, 6], DAY], ['bird-wood', 3, [2, 4], [3, 7], DAY], ['bird-peck', 0.8, [1, 3], [4, 9], DAY], ['bird-dove', 1, [2, 4], [4, 8], DAY], ['bird-crow', 0.6, [1, 2], [5, 12], DAY], ['night-owl', 1, [2, 4], [6, 14], NIGHT]],
  meadow: [['bird-meadow', 3, [2, 5], [2, 6], DAY], ['bird-chirp', 2, [2, 5], [1, 4], DAY], ['bird-song', 1.5, [2, 4], [3, 7], DAY], ['bird-dove', 0.6, [1, 3], [4, 9], DAY]],
  field: [['bird-meadow', 2, [2, 4], [3, 7], DAY], ['bird-crow', 1.2, [1, 3], [4, 10], DAY], ['bird-chirp', 1.5, [2, 4], [1, 4], DAY]],
  shore: [['bird-gull', 3, [1, 3], [3, 9], DAY]],
  beach: [['bird-gull', 3, [1, 3], [3, 9], DAY]],
  rock: [['bird-gull', 1.5, [1, 3], [4, 10], DAY]],
  lake: [['bird-duck', 3, [1, 3], [4, 10], DAY], ['bird-heron', 0.5, [1, 1], [10, 20], DAY], ['bird-song', 1, [2, 4], [3, 7], DAY], ['night-frog', 3, [2, 5], [2, 6], NIGHT]],
  city: [['bird-chirp', 2, [2, 4], [1, 4], DAY], ['bird-pigeon', 1.5, [1, 3], [4, 9], DAY]],
};
/** How much creatures sing at this hour, 0..1: the dawn chorus, a quiet midday, some song at dusk; the night's own. */
function chorus(h) {
  if (h >= 5 && h < 8.5) return 1;
  if (h >= 8.5 && h < 11) return 0.7;
  if (h >= 11 && h < 15.5) return 0.35;
  if (h >= 15.5 && h < 20.5) return 0.55;
  return 0.5;   // (owls and frogs)
}
let app = null, beds = null, room = null, roomName = null, nextLook = 0, spots = { list: [], at: null, trees: 0 };
const singers = [];

export function init(a) {
  app = a;
  bus.on('thunder', e => thunder(e));
  bus.on('frame', update);
  a.ambience = { get gain() { return a.sfx?.gain('world') ?? null; }, get beds() { return beds ? Object.fromEntries(Object.entries(beds).map(([k, b]) => [k, +b.heard.toFixed(3)])) : null; }, get room() { return roomName; }, get place() { return beds ? place() : null; }, get trees() { return spots.trees; }, get falls() { return fallLoops.size; }, get people() { return people.n; }, get singers() { return singers.map(s => ({ who: s.who, x: Math.round(s.x), z: Math.round(s.z), left: s.left })); } };
}
function begin() {
  const L = n => app.sfx.loop(n);
  beds = {
    wind: L('bed-wind'), windStrong: L('bed-wind-strong'), windHigh: L('bed-wind-high'), leaves: L('bed-leaves'),
    rain: L('bed-rain-light'), rainHeavy: L('bed-rain-heavy'), rainRoof: app.sfx.loop('bed-rain-roof', { space: 'any' }),
    surf: L('bed-surf'), surfStrong: L('bed-surf-strong'), harbour: L('bed-harbour'), stream: L('bed-stream'), river: L('bed-river'),
    cityDay: L('bed-city-day'), cityNight: L('bed-city-night'), crickets: L('bed-night-field'), frogs: L('bed-frogs'),
    lake: L('bed-lake'), riverWide: L('bed-river-wide'),
    water: app.sfx.loop('bed-underwater', { space: 'water' }),
  };
}

/** Where the listener is: near the sea (0..1), in the city (0..1), the country, height above the ground (m), a river. */
function place() {
  const T = app.terrain, Ls = app.sfx.listener, g = S.grid;
  // the sea: open water round about that is no lake and no river (2026-10-27: a lake sounded like the surf)
  const I = T?.ground?.island, inLake = (x, z) => (T?.lakes || []).some(Lk => Math.hypot(Lk.position.x - x, Lk.position.z - z) < (Lk.userData.r || 60) * 1.15 + 10);
  let sea = 0;
  if (T) for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, x = Ls.x + Math.cos(a) * 140, z = Ls.z + Math.sin(a) * 140;
    if (T.isWater(x, z) && !inLake(x, z) && !(I?.riverAt?.(x, z)?.d < 20)) sea += 1 / 8;
  }
  const out = g ? Math.max(g.minX - Ls.x, Ls.x - g.maxX, g.minZ - Ls.z, Ls.z - g.maxZ) : 0;
  const city = out <= 0 ? 1 : Math.max(0, 1 - out / 250);
  let river = 0, steep = 0, lake = 0, wide = 0;
  if (I?.rivers?.length) for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) {
    const r = I.riverAt(Ls.x + ox, Ls.z + oz);
    if (r) { const v = 1 - r.d / (r.width / 2 + 24); if (v > river) { river = v; steep = Math.min(1, r.slope * 3); wide = Math.min(1, Math.max(0, (r.width - 5) / 12)); } }
  }
  for (const Lk of T?.lakes || []) { if (Lk.userData.frozen || Lk.userData.lake?.pool) continue; const r = Lk.userData.r || 60, d = Math.hypot(Lk.position.x - Ls.x, Lk.position.z - Ls.z) - r; if (d < 80) lake = Math.max(lake, 1 - Math.max(0, d) / 80); }
  return { sea, city, country: (1 - city) * (1 - sea), alt: Ls.alt, river: Math.max(0, river), steep, wide, lake };
}

function update(dt) {
  const fx = app.sfx; if (!fx?.ready) return;
  if (!beds) begin();
  const Ls = fx.listener, w = app.weather?.now || { rain: 0, wind: { speed: 3 }, storm: 0 }, P = place(), night = app.stage.state.night;
  const near = Math.max(0, 1 - P.alt / 220), low = Math.max(0, 1 - P.alt / 90), wind = w.wind?.speed ?? 3;
  const set = (b, v) => b.set({ gain: Math.max(0, v) }), calm0 = 1 - Math.min(1, w.storm);
  // the wind: soft, gusting when strong, the rush of high air above the treetops
  set(beds.wind, (0.12 + 0.03 * wind) * Math.min(1, 0.5 + P.country + P.sea) * (1 - Math.min(1, P.alt / 160) * 0.6));
  set(beds.windStrong, Math.max(0, wind - 7) * 0.05 + w.storm * 0.35);
  set(beds.windHigh, Math.min(1, Math.max(0, P.alt - 40) / 200) * (0.25 + 0.03 * wind));
  set(beds.leaves, spots.trees * P.country * low * (0.05 + 0.012 * Math.min(8, wind)));   // (leaves only where trees stand, soft: 2026-10-27 the fields' rustle was too much)
  // rain: outside on the ground; inside, the same rain heard through the roof and the walls (the engine's through-the-walls
  // filter takes it down to 0.28 and nothing above ~650 Hz: IN_ROOF makes up the level) over a low drumming of the roof
  // (its recording, low-passed to 380 Hz) — 2026-10-28, the product owner: inside it "sound[s] like its water hitting a tin
  // city ... make the rain sound from the inside of the building sound more like a muffled roof" (the roof recording's
  // patter, heard unfiltered, was the tin). Rendered offline: its centre 894 Hz → ~260 Hz, above 2 kHz 7.8% → 0.3%.
  const inside = Ls.space === 'in', IN_ROOF = 4.8;
  const light = Math.min(1, w.rain * 2) * (1 - Math.min(1, w.rain)) * 0.5, heavy = Math.max(0, w.rain - 0.35) * 0.8;
  set(beds.rain, light * (inside ? IN_ROOF : 0.3 + 0.7 * near));
  set(beds.rainHeavy, heavy * (inside ? IN_ROOF : 0.3 + 0.7 * near));
  beds.rainRoof.set({ gain: (inside ? 1 : 0) * w.rain * 0.9, tone: 380 });
  // the sea and the water
  const rough = Math.min(1, Math.max(0, wind - 6) / 8 + w.storm);
  set(beds.surf, P.sea * (1 - P.city * 0.6) * (1 - rough) * 0.55 * (0.3 + 0.7 * near));
  set(beds.surfStrong, P.sea * rough * 0.7 * (0.3 + 0.7 * near));
  set(beds.harbour, P.sea * P.city * 0.35 * low);
  // rivers by their size (2026-10-27: "the rivers sound like a small stream"): a brook babbles, a river rushes, rapids roar;
  // a lake laps at its shore (no surf)
  set(beds.stream, P.river * (1 - P.wide) * (1 - P.steep) * 0.45 * low);
  set(beds.riverWide, P.river * P.wide * (1 - P.steep * 0.5) * 0.75 * low);
  set(beds.river, P.river * P.steep * 0.65 * low);
  set(beds.lake, P.lake * (1 - P.river) * calm0 * 0.55 * low);
  // the city, and the night's crickets and frogs
  set(beds.cityDay, P.city * near * (1 - night) * 0.3);
  set(beds.cityNight, P.city * near * night * 0.25);
  const calm = 1 - Math.min(1, w.rain * 1.5 + w.storm);
  beds.crickets.set({ tone: 6500 });   // (the night field: soft and far, its top rolled off; 2026-10-27 the old crickets were a squeal of static)
  set(beds.crickets, night > 0.5 ? P.country * (1 - P.city) * calm * low * 0.14 * (1 - P.lake * 0.5) : 0);
  set(beds.frogs, night > 0.5 ? Math.max(P.lake, P.river * 0.6) * calm * low * 0.35 : 0);
  set(beds.water, 0.6);
  rooms();
  falls(P);
  creatures(dt, P, calm, low);
}

// ------------------------------------------------------------------ inside
/** The room's tone where the listener is inside: by the building's kind (shared/edit.js floorUse). */
const ROOM = { apartment: 'room-home', house: 'room-home', home: 'room-home', 'apartment-lobby': 'room-hall', 'office-lobby': 'room-hall', office: 'room-office', hq: 'room-office', shop: 'room-shop', cafe: 'room-cafe', restaurant: 'room-restaurant', gym: 'room-gym', hotel: 'room-hall', terminal: 'room-hall', airport: 'room-hall', arcade: 'room-hall' };
/** How many people make a room sound full (its murmur, plates, keyboards at their loudest), by its tone. */
const FULL = { 'room-restaurant': 10, 'room-cafe': 6, 'room-shop': 6, 'room-office': 6, 'room-gym': 5, 'room-hall': 12 };
const QUIET = 6;   // (people on a floor that make no crowd yet: a crowd from 7, the product owner 2026-10-28)
let hum = null, people = { at: 0, key: '', n: 0 };
/** The people on the listener's floor now (residents drawn there, and the player), counted each second. */
function onFloor(b, f) {
  const now = performance.now(), key = `${b}:${f}`;
  if (key === people.key && now - people.at < 1000) return people.n;
  const A = app.agents, c = (b << 6) | f;
  let n = 0;
  if (A?.n) for (let i = 0; i < A.n; i++) if (A.ctx[i] === c && A.vis?.[i] !== 0) n++;
  people = { at: now, key, n };
  return n;
}
/** Inside: the room's own sound by the building's kind, as loud as it is busy (2026-10-26: "I hear plates in an empty
 *  restaurant"): a home's quiet hum always; a shop's, café's, restaurant's, office's, gym's or lobby's people sounds by
 *  how many are on the floor; an empty one only a building's faint hum. */
function rooms() {
  const Ls = app.sfx.listener, B = Ls.space === 'in' ? S.world?.buildings?.[Ls.b] : null;
  let name = null;
  if (B && B.type !== 'park') {
    const use = B.type === 'office' || B.type === 'hq' ? (Ls.f === 0 ? 'office-lobby' : 'office') : B.type === 'apartment' ? (Ls.f === 0 ? (B.mixed || 'apartment-lobby') : 'apartment') : B.type;
    name = ROOM[use] || 'room-home';
  }
  const key = name ? `${name}@${Ls.b}:${Ls.f}` : null;
  if (key !== roomName) {
    room?.stop(1.2); hum?.stop(1.2); room = hum = null; roomName = key;
    if (name) { room = app.sfx.loop(name, { space: Ls.b, gain: 0 }); if (name !== 'room-home') hum = app.sfx.loop('room-home', { space: Ls.b, gain: 0 }); }
  }
  if (!room) return;
  if (name === 'room-home') { room.set({ gain: 0.4 }); return; }
  // a crowd's sound only once there is a crowd (2026-10-28, the product owner: "crowd noises from inside a building when
  // there's very few people"): up to QUIET people make none, only the building's hum; from QUIET on it grows evenly to
  // its loudest when the room is full (it rose steeply before: a lobby with one person in it had a third of its crowd)
  const n = onFloor(Ls.b, Ls.f), full = Math.max(FULL[name] || 6, QUIET + 6),   // (its loudest at least six more on)
    busy = Math.max(0, Math.min(1, (n - QUIET) / Math.max(1, full - QUIET)));
  room.set({ gain: 0.5 * busy });
  hum.set({ gain: 0.18 * (1 - busy) });
}

// ------------------------------------------------------------------ waterfalls
/** Each waterfall near the listener roars where it falls (2026-10-27: "the waterfalls don't seem to be producing any sound"):
 *  a loop at its foot, as loud as it is tall and wide; a cascade's softer. Heard from ~300 m; through walls muffled. */
const fallLoops = new Map();
function falls(P) {
  const I = app.terrain?.ground?.island, Ls = app.sfx.listener; if (!I?.rivers) return;
  const seen = new Set();
  for (const R of I.rivers) for (const [k, d] of (R.drops || []).entries()) {
    const key = `${R.id}:${k}`, dist = Math.hypot(d.x - Ls.x, d.z - Ls.z);
    if (dist > 320) continue;
    seen.add(key);
    let h = fallLoops.get(key);
    const size = Math.min(1, (d.F || 6) / 25) * Math.min(1, 0.5 + (d.w || 6) / 16), big = d.kind !== 'cascade';
    if (!h) fallLoops.set(key, h = app.sfx.loop('bed-waterfall', { pos: { x: d.x, y: d.y + (big ? (d.F || 6) * 0.4 : 1), z: d.z }, ref: big ? 10 + 18 * size : 7, gain: 0 }));
    h.set({ gain: (big ? 0.55 + 0.45 * size : 0.35) * Math.max(0, 1 - P.alt / 260), tone: big ? 22000 : 9000 });
  }
  for (const [key, h] of fallLoops) if (!seen.has(key)) { h.stop(1.5); fallLoops.delete(key); }
}

// ------------------------------------------------------------------ creatures
/** The places near the listener creatures live: the loaded tiles' habitat points (forest, meadow, field, shore, beach,
 *  rock: render/terrain.worker.js), the lakes' shores, and in the city spots along the street. Looked up each second. */
function lookSpots() {
  const T = app.terrain, Ls = app.sfx.listener, list = [], gx = Ls.x, gz = Ls.z;
  if (T) {
    for (const t of T.tiles.values()) {
      if (!t.hab || t.level !== 0) continue;
      if (Math.abs(t.x0 + t.S / 2 - gx) > t.S / 2 + REACH || Math.abs(t.z0 + t.S / 2 - gz) > t.S / 2 + REACH) continue;
      for (const kind of Object.keys(WHO)) {
        const H = t.hab[kind]; if (!H) continue;
        for (let i = 0; i < H.length; i += 3) if (Math.hypot(H[i] - gx, H[i + 2] - gz) < REACH) list.push({ kind, x: H[i], y: H[i + 1], z: H[i + 2] });
      }
    }
    for (const Lk of T.lakes || []) {
      if (Lk.userData.frozen || Lk.userData.lake?.pool) continue;
      const r = Lk.userData.r || 60;
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, x = Lk.position.x + Math.cos(a) * r * 0.9, z = Lk.position.z + Math.sin(a) * r * 0.9; if (Math.hypot(x - gx, z - gz) < REACH) list.push({ kind: 'lake', x, y: Lk.position.y, z }); }
    }
  }
  const g = S.grid;
  if (g && gx > g.minX - 20 && gx < g.maxX + 20 && gz > g.minZ - 20 && gz < g.maxZ + 20) {
    const y = T ? Math.max(T.params.seaLevel, T.heightAt(gx, gz)) : 0;
    for (let k = 0; k < 6; k++) { const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 40; list.push({ kind: 'city', x: gx + Math.cos(a) * d, y, z: gz + Math.sin(a) * d }); }
  }
  spots.list = list;
  let n = 0; for (const p of list) if (p.kind === 'forest' && Math.hypot(p.x - gx, p.z - gz) < 45) n++;
  spots.trees = Math.min(1, n / 10);
}
function creatures(dt, P, calm, low) {
  const now = performance.now() / 1000, h = S.hour ?? 12, fx = app.sfx, Ls = fx.listener;
  if (now > nextLook) { nextLook = now + 1; lookSpots(); }
  // singers sing their phrases; the done ones leave
  for (let i = singers.length - 1; i >= 0; i--) {
    const s = singers[i];
    if (now < s.next) continue;
    if (s.left <= 0 || Math.hypot(s.x - Ls.x, s.y - Ls.y, s.z - Ls.z) > REACH * 1.4) { singers.splice(i, 1); continue; }
    s.left--; s.next = now + s.gap[0] + Math.random() * (s.gap[1] - s.gap[0]);
    fx.play(s.who, { pos: s, ref: s.ref, gain: s.gain, vary: 0.04 });
  }
  // a new singer now and then, where the place and the hour have them; never in rain, faint through walls, none up high
  const mood = chorus(h) * calm * (Ls.space === 'water' ? 0 : Ls.space === 'in' ? 0.3 : 1);
  if (!spots.list.length || mood < 0.05 || low <= 0 || singers.length >= Math.round(SINGERS * mood + 0.4)) return;
  if (Math.random() > dt * 0.9 * mood) return;
  const sp = spots.list[Math.floor(Math.random() * spots.list.length)];
  const cands = WHO[sp.kind].filter(c => c[4](h));
  if (!cands.length) return;
  let r = Math.random() * cands.reduce((a, c) => a + c[1], 0), c = cands[0];
  for (const k of cands) { r -= k[1]; if (r <= 0) { c = k; break; } }
  if (singers.some(s => s.who === c[0] && Math.hypot(s.x - sp.x, s.z - sp.z) < 15)) return;
  const tree = sp.kind === 'forest' || sp.kind === 'meadow' || sp.kind === 'city';
  singers.push({
    who: c[0], x: sp.x + (Math.random() - 0.5) * 14, y: sp.y + (tree ? 2 + Math.random() * 8 : 0.5), z: sp.z + (Math.random() - 0.5) * 14,
    left: c[2][0] + Math.floor(Math.random() * (c[2][1] - c[2][0] + 1)), gap: c[3], next: now + Math.random() * 1.5,
    ref: c[0] === 'bird-gull' || c[0] === 'bird-crow' || c[0] === 'night-owl' ? 12 : 6, gain: c[0].startsWith('night') ? 0.5 : c[0] === 'bird-chirp' ? 0.4 : 0.55,
  });
}

/** Thunder: after the flash by the distance's delay; a near crack when it is close. */
function thunder(e) {
  const fx = app.sfx; if (!fx?.ready) return;
  const loud = Math.max(0.15, e.loud || 0.5), wait = Math.max(0, (e.at - performance.now()) / 1000) + (e.delay || 0);
  fx.play(loud > 0.75 ? 'thunder-near' : 'thunder', { gain: 0.35 + 0.65 * loud, delay: wait, vary: 0.08 });
}
